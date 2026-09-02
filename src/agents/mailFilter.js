/**
 * Classify inbound IMAP mail so promotional / newsletter / automated
 * marketing never triggers customer auto-ack or admin support alerts.
 */

function normalizeAddress(value) {
  const raw = String(value || '');
  const angle = raw.match(/<([^>]+)>/);
  return String(angle ? angle[1] : raw)
    .trim()
    .toLowerCase();
}

const BULK_LOCAL_PART =
  /^(no-?reply|do-?not-?reply|donotreply|noreply-\w+|notify|notifications?|newsletter|newsletters|news|marketing|promo|promotions?|deals?|offers?|digest|mailer|bounces?|auto(?:mated)?|updates?|mail-en|topcompanies|newjobs)$/i;

const MAILER_HOST_PREFIX =
  /^(mail|e|news|notify|notifications|marketing|engage|info|deals|newsletter|newsletters|bounce|bounces|updates|email|emarketing|promo|noreply|no-reply)\./i;

/** Registrable domains (and suffixes) that send job alerts, shopping, social, or campaigns. */
const MARKETING_DOMAINS = new Set([
  'bayt.com',
  'naukrigulf.com',
  'linkedin.com',
  'facebookmail.com',
  'facebook.com',
  'aliexpress.com',
  'canva.com',
  'made-in-china.com',
  'jobs2web.com',
  'notion.so',
  'insideapple.apple.com',
  'accounts.google.com',
  'googleplay-noreply.google.com',
]);

const PROMO_SUBJECT =
  /وظائف جديدة|أبرز أصحاب العمل|متسوق لأول مرة|تنبيه أمني|تنبيه بشأن أمان|job alert|new jobs|newsletter|weekly digest|unsubscribe|% off|otp code|reset your password|welcome to moyasar|n نقاط |كشف حساب|اشترِ 1|view in browser|you.?re invited|password reset|new jobs posted/i;

const PROMO_BODY =
  /unsubscribe|إلغاء الاشتراك|الغاء الاشتراك|view this (email|message) in (your )?browser|this is an automated (message|email)|manage (your )?preferences|one-click unsubscribe|إذا كنت لا ترغب/i;

const CUSTOMER_INQUIRY =
  /\b(order|booking|shipment|delivery|pickup|driver|quote|invoice|refund|complaint|support|ticket)\b|طلب|شحنة|توصيل|سائق|حجز|سعر|استرجاع|شكوى|دعم|موعد|فاتورة/i;

function isBulkLocal(local) {
  const part = String(local || '');
  return BULK_LOCAL_PART.test(part) || /no[_-]?reply/i.test(part);
}

function extraPromoDomains() {
  return String(process.env.MIRAS_PROMO_DOMAINS || '')
    .split(/[,;\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function verbosePromoLogs() {
  const raw = String(process.env.MIRAS_LOG_PROMO || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export function parseMailbox(value) {
  const email = normalizeAddress(value);
  const at = email.lastIndexOf('@');
  if (at < 1) return { email, local: email, host: '' };
  return {
    email,
    local: email.slice(0, at),
    host: email.slice(at + 1),
  };
}

function hostMatchesDomain(host, domain) {
  const h = String(host || '').toLowerCase();
  const d = String(domain || '').toLowerCase();
  if (!h || !d) return false;
  return h === d || h.endsWith(`.${d}`);
}

function isMarketingHost(host) {
  const h = String(host || '').toLowerCase();
  if (!h) return false;
  if (MAILER_HOST_PREFIX.test(h)) return true;
  for (const domain of MARKETING_DOMAINS) {
    if (hostMatchesDomain(h, domain)) return true;
  }
  for (const domain of extraPromoDomains()) {
    if (hostMatchesDomain(h, domain)) return true;
  }
  return false;
}

function headerValue(headers, name) {
  if (!headers) return '';
  const key = String(name).toLowerCase();
  if (typeof headers.get === 'function') {
    const raw = headers.get(key) ?? headers.get(name);
    return stringifyHeader(raw);
  }
  return stringifyHeader(headers[key] ?? headers[name]);
}

function stringifyHeader(raw) {
  if (raw == null || raw === false) return '';
  if (Array.isArray(raw)) return raw.map(stringifyHeader).join(' ');
  if (typeof raw === 'object') {
    if (raw.text) return String(raw.text);
    if (raw.value) return String(raw.value);
  }
  return String(raw).trim();
}

function collectHeaders(mail) {
  const fromMail = mail?.headers && typeof mail.headers === 'object' ? mail.headers : {};
  return {
    listUnsubscribe: headerValue(fromMail, 'list-unsubscribe') || String(mail?.listUnsubscribe || ''),
    listId: headerValue(fromMail, 'list-id') || String(mail?.listId || ''),
    listSubscribe: headerValue(fromMail, 'list-subscribe'),
    precedence: headerValue(fromMail, 'precedence') || String(mail?.precedence || ''),
    autoSubmitted: headerValue(fromMail, 'auto-submitted') || String(mail?.autoSubmitted || ''),
    suppress: headerValue(fromMail, 'x-auto-response-suppress'),
    feedbackId: headerValue(fromMail, 'feedback-id'),
    campaign:
      headerValue(fromMail, 'x-campaign-id') ||
      headerValue(fromMail, 'x-mailgun-campaign-id') ||
      headerValue(fromMail, 'x-campaignid'),
  };
}

function hasBulkHeaders(headers) {
  if (headers.listUnsubscribe || headers.listId || headers.listSubscribe) {
    return 'list-unsubscribe';
  }
  if (/^(bulk|junk|list)$/i.test(headers.precedence)) return 'precedence-bulk';
  if (headers.autoSubmitted && !/^no$/i.test(headers.autoSubmitted)) return 'auto-submitted';
  if (headers.suppress) return 'auto-response-suppress';
  if (headers.feedbackId) return 'feedback-id';
  if (headers.campaign) return 'campaign';
  return '';
}

/**
 * True when the message looks like a real person asking about a shipment / booking.
 * Never overrides known marketing domains or noreply senders.
 */
function looksLikeCustomerInquiry(mail, box, bulkHeader) {
  if (bulkHeader) return false;
  if (isBulkLocal(box.local)) return false;
  if (isMarketingHost(box.host)) return false;
  if (PROMO_SUBJECT.test(String(mail?.subject || ''))) return false;
  if (PROMO_BODY.test(String(mail?.text || ''))) return false;
  const blob = `${mail?.subject || ''} ${mail?.text || ''}`;
  return CUSTOMER_INQUIRY.test(blob);
}

/**
 * @param {{ from?: string, subject?: string, text?: string, headers?: object }} mail
 * @returns {{ skip: boolean, kind: 'customer' | 'promo', reason: string }}
 */
export function classifyInboundMail(mail) {
  const box = parseMailbox(mail?.from);
  const headers = collectHeaders(mail);
  const bulkHeader = hasBulkHeaders(headers);

  if (looksLikeCustomerInquiry(mail, box, bulkHeader)) {
    return { skip: false, kind: 'customer', reason: 'inquiry' };
  }

  if (bulkHeader) {
    return { skip: true, kind: 'promo', reason: bulkHeader };
  }
  if (box.local && isBulkLocal(box.local)) {
    return { skip: true, kind: 'promo', reason: 'bulk-sender' };
  }
  if (isMarketingHost(box.host)) {
    return { skip: true, kind: 'promo', reason: 'marketing-domain' };
  }
  if (PROMO_SUBJECT.test(String(mail?.subject || ''))) {
    return { skip: true, kind: 'promo', reason: 'promo-subject' };
  }
  if (PROMO_BODY.test(String(mail?.text || ''))) {
    return { skip: true, kind: 'promo', reason: 'promo-body' };
  }

  return { skip: false, kind: 'customer', reason: 'direct' };
}

export function isPromoSkipCode(code) {
  return String(code || '').startsWith('promo');
}
