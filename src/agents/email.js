// @ts-nocheck
/**
 * Worker 3 — Email & Support Agent (Node-only).
 * Nodemailer sends customer replies, admin notifications, and HITL approvals
 * from MIRAS_SUPPORT_EMAIL. Sending customer mail waits for Supervisor OK.
 */
import nodemailer from 'nodemailer';
import { SUPPORT_EMAIL } from '../lib/supportContact.ts';
import { classifyInboundMail, isPromoSkipCode, verbosePromoLogs } from './mailFilter.js';

function mailLog(channel, event, details = {}) {
  const parts = Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${String(value).replace(/\s+/g, ' ').slice(0, 160)}`);
  console.log(`[${channel}] ${event}${parts.length ? ` — ${parts.join(' ')}` : ''}`);
}

export function supportEmail() {
  return String(
    process.env.MIRAS_SUPPORT_EMAIL || SUPPORT_EMAIL || 'support@miras.com'
  ).trim();
}

export function adminEmail() {
  return String(process.env.MIRAS_ADMIN_EMAIL || '').trim();
}

export function getMailConfig() {
  const host = String(process.env.SMTP_HOST || 'smtp.gmail.com').trim();
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '').trim().replace(/\s+/g, '');
  const isGmail = /gmail\.com$/i.test(host) || /gmail\.com$/i.test(user);
  const requestedFrom = String(process.env.SMTP_FROM || supportEmail()).trim();
  // Gmail only delivers as the authenticated account unless "Send mail as" is verified.
  const from = isGmail && user ? user : requestedFrom || user;
  return {
    host,
    port: Number(process.env.SMTP_PORT || (isGmail ? 587 : 587)),
    secure: process.env.SMTP_SECURE === 'true',
    user,
    pass,
    from,
    replyTo: supportEmail(),
    isGmail,
  };
}

/** @type {import('nodemailer').Transporter | null} */
let cachedTransport = null;
let usingEthereal = false;

export async function createMailTransport() {
  if (cachedTransport) return cachedTransport;
  const cfg = getMailConfig();
  if (!cfg.user || !cfg.pass) {
    throw new Error(
      'SMTP_USER / SMTP_PASS are empty. Set SMTP_PASS to a Google App Password (not the Gmail login password).'
    );
  }
  cachedTransport = cfg.isGmail
    ? nodemailer.createTransport({
        service: 'gmail',
        auth: { user: cfg.user, pass: cfg.pass },
      })
    : nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure,
        auth: { user: cfg.user, pass: cfg.pass },
      });
  usingEthereal = false;
  return cachedTransport;
}

export async function verifyMailTransport() {
  const cfg = getMailConfig();
  const transport = await createMailTransport();
  await transport.verify();
  mailLog('smtp', 'LOGIN OK', { user: cfg.user, from: cfg.from, replyTo: cfg.replyTo });
  return cfg;
}

/**
 * @param {{ to: string, subject: string, text: string, html?: string, replyTo?: string }} mail
 */
export async function sendMail(mail) {
  const to = String(mail?.to || '').trim();
  if (!to) throw new Error('Cannot send: missing recipient');
  const kind = String(mail.kind || 'smtp');
  const cfg = getMailConfig();
  const transport = await createMailTransport();
  const fromAddress = cfg.from;
  const replyTo = mail.replyTo || cfg.replyTo || supportEmail();
  mailLog(kind === 'auto-ack' ? 'ack' : kind.startsWith('admin') ? 'admin' : 'smtp', 'DISPATCH', {
    kind,
    to,
    subject: mail.subject || 'Miras',
  });
  const info = await transport.sendMail({
    from: `"Miras Support" <${fromAddress}>`,
    to,
    subject: mail.subject || 'Miras',
    text: mail.text || '',
    html: mail.html,
    replyTo,
  });
  const previewUrl = nodemailer.getTestMessageUrl(info) || null;
  if (previewUrl) {
    mailLog('smtp', 'ETHEREAL PREVIEW', { url: previewUrl });
  }
  mailLog(kind === 'auto-ack' ? 'ack' : kind.startsWith('admin') ? 'admin' : 'smtp', 'DELIVERED', {
    kind,
    to,
    id: info.messageId,
  });
  return {
    ok: true,
    messageId: info.messageId,
    previewUrl,
    from: fromAddress,
    replyTo,
    to,
    ethereal: usingEthereal,
  };
}

export async function sendToAdmin(text, options = {}) {
  const to = adminEmail();
  if (!to) throw new Error('MIRAS_ADMIN_EMAIL is not set');
  return sendMail({
    to,
    subject: options.subject || 'Miras supervisor',
    text: String(text || ''),
    html: options.html,
    kind: options.kind || 'admin-alert',
  });
}

export async function sendApprovalEmail(interruptValue, threadId) {
  const payload = interruptValue || {};
  const text = [
    'Miras — approval required',
    '',
    `Worker: ${payload.worker || 'unknown'}`,
    `Action: ${payload.summary || 'sensitive operation'}`,
    payload.payloadPreview && payload.payloadPreview !== payload.summary
      ? `\n${String(payload.payloadPreview).slice(0, 4000)}`
      : '',
    '',
    `Thread: ${threadId}`,
    '',
    'Reply to this email with OK to execute, or NO to reject.',
    'You can also type OK / NO in the agent terminal if you are running locally.',
  ]
    .filter((line) => line !== '')
    .join('\n');

  return sendToAdmin(text, {
    subject: `[Miras approval] ${payload.worker || 'agent'} — ${threadId}`,
  });
}

/**
 * Boot-time check used by `npm run agents`.
 */
export async function sendTestOperationalSummaryEmail(options = {}) {
  return sendOperationalDigestEmail({
    reason: 'boot',
    extra: options.extra,
  });
}

/** @deprecated use sendTestOperationalSummaryEmail */
export async function sendTestApprovalEmail() {
  return sendTestOperationalSummaryEmail();
}

export function getImapConfig() {
  const user = String(
    process.env.IMAP_USER || process.env.SMTP_USER || ''
  ).trim();
  return {
    host: String(process.env.IMAP_HOST || (user ? 'imap.gmail.com' : '')).trim(),
    port: Number(process.env.IMAP_PORT || 993),
    secure: process.env.IMAP_SECURE !== 'false',
    user,
    pass: String(process.env.IMAP_PASS || process.env.SMTP_PASS || '').trim().replace(/\s+/g, ''),
    pollMs: Math.max(5000, Number(process.env.IMAP_POLL_MS || 15_000)),
  };
}

/** Fail fast on the 24/7 worker — missing mail secrets used to leave IMAP silently off. */
export function requireMailSecrets() {
  const smtp = getMailConfig();
  if (!smtp.user || !smtp.pass) {
    throw new Error(
      'SMTP_USER / SMTP_PASS are required. Use a Gmail App Password, not the account login password.'
    );
  }
  if (!adminEmail()) {
    throw new Error('MIRAS_ADMIN_EMAIL is required so operational reports can be delivered.');
  }
  const imap = getImapConfig();
  if (!imap.host || !imap.user || !imap.pass) {
    throw new Error(
      'IMAP_USER / IMAP_PASS are required (or set SMTP_USER / SMTP_PASS so IMAP can inherit them). Enable Gmail IMAP.'
    );
  }
  return { smtp, imap, admin: adminEmail(), support: supportEmail() };
}

export async function verifyImapConnection() {
  const cfg = getImapConfig();
  const { ImapFlow } = await import('imapflow');
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  });
  try {
    await client.connect();
    const box = await client.mailboxOpen('INBOX');
    mailLog('imap', 'CONNECT OK', {
      user: cfg.user,
      host: `${cfg.host}:${cfg.port}`,
      messages: box.exists,
    });
    return { ok: true, exists: box.exists };
  } catch (error) {
    mailLog('imap', 'CONNECT FAILED', { error: error?.message || error });
    throw error;
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }
}

export function autoAckEnabled() {
  const raw = String(process.env.MIRAS_AUTO_ACK ?? 'true').trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'off';
}

/** @type {{ at: string, from: string, subject: string, urgency: string, acked: boolean }[]} */
const handledTickets = [];
let workerStartedAt = null;
let promoSkippedTotal = 0;

function notePromoSkip() {
  promoSkippedTotal += 1;
}

export function markWorkerStarted() {
  workerStartedAt = new Date();
}

export function recordSupportTicket(entry = {}) {
  handledTickets.push({
    at: new Date().toISOString(),
    from: String(entry.from || ''),
    subject: String(entry.subject || ''),
    urgency: String(entry.urgency || 'normal'),
    acked: Boolean(entry.acked),
    snippet: String(entry.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 400),
    actions: Array.isArray(entry.actions) ? entry.actions.map(String) : [],
    source: entry.source === 'historical' ? 'historical' : 'live',
  });
  if (handledTickets.length > 200) handledTickets.shift();
}

export function getWorkerStats() {
  return {
    startedAt: workerStartedAt ? workerStartedAt.toISOString() : null,
    ticketsHandled: handledTickets.length,
    promoSkipped: promoSkippedTotal,
    lastTicket: handledTickets[handledTickets.length - 1] || null,
    autoAck: autoAckEnabled(),
    admin: adminEmail(),
    support: supportEmail(),
  };
}

export async function sendCustomerAcknowledgement(mail) {
  const to = normalizeAddress(mail?.from);
  if (!to) return null;
  if (
    sameMailbox(to, adminEmail()) ||
    sameMailbox(to, supportEmail()) ||
    sameMailbox(to, getMailConfig().from)
  ) {
    mailLog('ack', 'SKIP self/admin sender', { to });
    return null;
  }
  const classified = classifyInboundMail(mail);
  if (classified.skip) {
    mailLog('ack', 'SKIP promo sender', { to, reason: classified.reason });
    return null;
  }
  const subject = String(mail?.subject || '').trim();
  const re = !subject ? 'Re: Miras Support' : subject.startsWith('Re:') ? subject : `Re: ${subject}`;
  const text = [
    'مرحباً / Hello,',
    '',
    'تم استلام رسالتك لدى دعم مِراس وسنراجعها قريباً.',
    'Miras Support received your message. Our team is reviewing it and will follow up if needed.',
    subject ? `\nRegarding: ${subject}` : '',
    '',
    `مع التحية،\nفريق دعم مِراس\n${supportEmail()}`,
  ]
    .filter((line) => line !== '')
    .join('\n');
  const result = await sendMail({
    to,
    subject: re,
    text,
    replyTo: supportEmail(),
    kind: 'auto-ack',
  });
  mailLog('ack', 'AUTO-REPLY SENT', { to, subject: re, id: result.messageId });
  return result;
}

/**
 * Admin operational report (boot, interval digest, or on-demand).
 */
export async function sendOperationalDigestEmail(options = {}) {
  const to = adminEmail();
  if (!to) throw new Error('Set MIRAS_ADMIN_EMAIL before sending operational reports');
  const reason = options.reason || 'interval';
  const stats = getWorkerStats();
  const smtp = getMailConfig();
  const imap = getImapConfig();
  const extra = String(options.extra || '').trim();
  const recent = handledTickets.slice(-20);
  const ticketLines = recent.length
    ? recent.map((ticket, index) => {
        const actions = (ticket.actions || []).map((item) => `     - ${item}`).join('\n');
        return [
          `${index + 1}. [${ticket.source || 'live'}] ${ticket.at}`,
          `   From: ${ticket.from}`,
          `   Subject: ${ticket.subject}`,
          `   Urgency: ${ticket.urgency} | Auto-ack: ${ticket.acked ? 'sent' : 'skipped'}`,
          ticket.snippet ? `   Content: ${ticket.snippet}` : '',
          actions ? `   Actions:\n${actions}` : '',
        ]
          .filter(Boolean)
          .join('\n');
      })
    : ['(no customer tickets in this process yet)'];
  const text = [
    `Miras Supervisor — operational ${reason === 'boot' ? 'startup' : 'digest'} report`,
    '',
    `Admin: ${to}`,
    `Public support: ${supportEmail()}`,
    `SMTP login: ${smtp.user}`,
    `IMAP watch: ${imap.user} @ ${imap.host}:${imap.port}`,
    `Worker started: ${stats.startedAt || 'now'}`,
    `Tickets handled this process: ${stats.ticketsHandled}`,
    `Promotional mail ignored: ${stats.promoSkipped}`,
    `Customer auto-ack: ${autoAckEnabled() ? 'on' : 'off'}`,
    extra ? `\n${extra}` : '',
    '',
    'Recent tickets',
    '--------------',
    ...ticketLines,
    '',
    'Customer mail to support@miras.com should be forwarded to the Gmail transport inbox.',
    'Reply OK / NO on approval emails to send the drafted follow-up from support.',
  ]
    .filter((line) => line !== '')
    .join('\n');

  const result = await sendMail({
    to,
    subject: `[Miras] Operational ${reason === 'boot' ? 'startup' : 'digest'} — ${stats.ticketsHandled} ticket(s)`,
    text,
    kind: 'admin-report',
  });
  mailLog('admin', 'REPORT SENT', { reason, to, tickets: stats.ticketsHandled, id: result.messageId });
  return result;
}

export function normalizeAddress(value) {
  const raw = String(value || '');
  const angle = raw.match(/<([^>]+)>/);
  return String(angle ? angle[1] : raw)
    .trim()
    .toLowerCase();
}

function sameMailbox(a, b) {
  return normalizeAddress(a) && normalizeAddress(a) === normalizeAddress(b);
}

function heuristicEvaluation({ from, subject, text }) {
  const body = String(text || '').trim();
  const snippet = body.replace(/\s+/g, ' ').slice(0, 400);
  const lowered = `${subject} ${body}`.toLowerCase();
  const urgency = /\b(urgent|asap|immediately|فوري|عاجل|cancel|cancelled|refund|استرجاع)\b/i.test(
    lowered
  )
    ? 'high'
    : 'normal';
  const actions = [
    'Review the customer request',
    'Approve the draft reply (reply OK) or reject it (reply NO)',
  ];
  if (/\b(payout|withdraw|iban|سحب|دفعة)\b/i.test(lowered)) {
    actions.unshift('Check the related payout / withdrawal in Firebase');
  }
  const draftBody =
    `Thank you for contacting Miras Support. We received your message` +
    (subject ? ` about "${subject}"` : '') +
    `. Our team is reviewing it and will follow up shortly.\n\n` +
    (snippet ? `We understood your request as: ${snippet}` : '');
  return {
    from,
    subject: subject || '(no subject)',
    summary: snippet || 'Customer emailed support with no readable body.',
    urgency,
    actions,
    draftBody,
  };
}

export async function evaluateSupportIssue(mail) {
  const from = mail?.from || '';
  const subject = mail?.subject || '(no subject)';
  const text = String(mail?.text || '');
  const fallback = heuristicEvaluation({ from, subject, text });
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return fallback;

  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: process.env.MIRAS_AGENT_MODEL || 'gemini-2.0-flash',
      contents:
        'You are the Miras logistics support agent. Read the customer email and reply with ONLY JSON:\n' +
        '{"summary":"2-4 sentence issue summary","urgency":"low|normal|high","actions":["admin action 1","admin action 2"],"draft":"customer-facing reply body in the customer language, no JSON"}\n\n' +
        `From: ${from}\nSubject: ${subject}\n\n${text.slice(0, 6000)}`,
    });
    const raw = String(response.text || '').trim();
    const jsonText = raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    const parsed = JSON.parse(jsonText);
    return {
      from,
      subject,
      summary: String(parsed.summary || fallback.summary),
      urgency: ['low', 'normal', 'high'].includes(parsed.urgency) ? parsed.urgency : fallback.urgency,
      actions: Array.isArray(parsed.actions) && parsed.actions.length ? parsed.actions.map(String) : fallback.actions,
      draftBody: String(parsed.draft || fallback.draftBody),
    };
  } catch (error) {
    console.warn('[email] AI evaluation fallback:', error?.message || error);
    return fallback;
  }
}

export function formatAdminSupportBrief({ mail, evaluation, threadId }) {
  const evaln = evaluation || {};
  const actions = (evaln.actions || []).map((item, i) => `${i + 1}. ${item}`);
  return [
    'Miras Supervisor — customer support ticket (you do not need to open the support inbox)',
    '',
    `From (customer): ${mail?.from || evaln.from || 'unknown'}`,
    `Subject: ${mail?.subject || evaln.subject || '(no subject)'}`,
    `Urgency: ${evaln.urgency || 'normal'}`,
    `Support mailbox: ${supportEmail()}`,
    threadId ? `Thread: ${threadId}` : '',
    '',
    'Summary',
    '-------',
    evaln.summary || '',
    '',
    'Action items',
    '------------',
    actions.join('\n') || '1. Review and reply OK / NO',
    '',
    'Suggested reply to the customer',
    '-------------------------------',
    evaln.draftBody || '',
    '',
    'Reply OK to send the draft from support@miras.com, or NO to reject it.',
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}

export async function sendAdminSupportBrief(payload) {
  const evaluation = payload.evaluation || {};
  const subject = `[Miras support] ${evaluation.urgency === 'high' ? 'HIGH — ' : ''}${payload.mail?.subject || 'Customer ticket'}`;
  mailLog('admin', 'ALERT DISPATCH', {
    to: adminEmail(),
    from: payload.mail?.from,
    urgency: evaluation.urgency || 'normal',
    thread: payload.threadId,
    subject: payload.mail?.subject,
  });
  const result = await sendToAdmin(formatAdminSupportBrief(payload), {
    subject,
    kind: 'admin-alert',
  });
  mailLog('admin', 'ALERT DELIVERED', { to: adminEmail(), id: result.messageId, thread: payload.threadId });
  return result;
}

const processedMessageIds = new Set();

function shouldSkipInboundMail(mail) {
  if (sameMailbox(mail.from, supportEmail())) {
    return 'support-self';
  }
  if (sameMailbox(mail.from, getMailConfig().from)) {
    const hitlSubject = /\[Miras /i.test(mail.subject || '');
    const hitlBody = /^\s*(ok|yes|approve|no|reject|قبول|رفض)\b/i.test(mail.text || '');
    if (!hitlSubject && !hitlBody) return 'outbound-echo';
    return '';
  }
  const classified = classifyInboundMail(mail);
  if (classified.skip) {
    return `promo:${classified.reason}`;
  }
  return '';
}

function logInboundSkip(source, skip, mail) {
  if (isPromoSkipCode(skip)) {
    notePromoSkip();
    if (verbosePromoLogs()) {
      mailLog('imap', 'SKIP promo', {
        from: mail.from,
        subject: mail.subject,
        reason: skip.replace(/^promo:/, ''),
        source,
      });
    }
    return;
  }
  const label = source === 'historical' ? `HISTORICAL SKIP ${skip}` : `SKIP ${skip.replace(/-/g, ' ')}`;
  mailLog('imap', label, { from: mail.from, subject: mail.subject });
}

/**
 * Connect once, fetch every UNSEEN inbox message, mark seen, return processable mail.
 * Used for boot catch-up so no unread customer mail is left behind.
 */
export async function fetchUnreadInboxMessages(options = {}) {
  const source = options.historical ? 'historical' : 'live';
  const cfg = getImapConfig();
  if (!cfg.host || !cfg.user || !cfg.pass) {
    throw new Error('IMAP is not configured — cannot fetch unread messages');
  }
  const { ImapFlow } = await import('imapflow');
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  });
  const collected = [];
  let skipped = 0;
  let promoSkipped = 0;
  try {
    await client.connect();
    const box = await client.mailboxOpen('INBOX');
    mailLog('imap', 'HISTORICAL FETCH START', {
      user: cfg.user,
      inboxMessages: box.exists,
      source,
    });
    const lock = await client.getMailboxLock('INBOX');
    try {
      for await (const message of client.fetch(
        { seen: false },
        { envelope: true, source: true, uid: true }
      )) {
        let mail;
        try {
          mail = await parseImapMessage(message);
        } catch (error) {
          skipped += 1;
          mailLog('imap', 'HISTORICAL PARSE FAILED', {
            uid: message.uid,
            error: error?.message || error,
          });
          continue;
        }
        const id = mail.messageId || `uid-${message.uid}`;
        try {
          await client.messageFlagsAdd({ uid: message.uid }, ['\\Seen'], { uid: true });
        } catch {
          /* mark-seen is best-effort */
        }
        if (processedMessageIds.has(id)) {
          skipped += 1;
          mailLog('imap', 'HISTORICAL SKIP duplicate', { from: mail.from, subject: mail.subject });
          continue;
        }
        processedMessageIds.add(id);
        const skip = shouldSkipInboundMail(mail);
        if (skip) {
          skipped += 1;
          if (isPromoSkipCode(skip)) promoSkipped += 1;
          logInboundSkip(source, skip, mail);
          continue;
        }
        collected.push({
          ...mail,
          uid: message.uid,
          source,
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }
  mailLog('imap', 'HISTORICAL FETCH DONE', {
    queued: collected.length,
    skipped,
    promoSkipped,
    source,
  });
  collected.promoSkipped = promoSkipped;
  collected.skipped = skipped;
  return collected;
}

export async function sendUnreadCatchupReport(processed = []) {
  const to = adminEmail();
  if (!to) throw new Error('MIRAS_ADMIN_EMAIL is not set');
  const ok = processed.filter((item) => item.ok);
  const failed = processed.filter((item) => !item.ok);
  const promoSkipped = Number(processed.promoSkipped || 0);
  const blocks = processed.length
    ? processed.map((item, index) => {
        const mail = item.mail || {};
        const evaln = item.result?.evaluation || {};
        const snippet = String(mail.text || evaln.summary || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 400);
        const actions = (evaln.actions || []).map((action) => `   - ${action}`).join('\n');
        return [
          `${index + 1}. From: ${mail.from || evaln.from || 'unknown'}`,
          `   Subject: ${mail.subject || '(no subject)'}`,
          `   Status: ${item.ok ? 'processed' : `FAILED — ${item.error || 'unknown error'}`}`,
          `   Auto-ack: ${item.result?.acked ? 'sent via SMTP' : 'skipped'}`,
          `   Admin brief: ${item.result?.brief?.ok ? 'sent' : item.ok ? 'see HITL' : 'not sent'}`,
          `   Urgency: ${evaln.urgency || 'n/a'}`,
          snippet ? `   Content: ${snippet}` : '   Content: (empty)',
          actions ? `   Actions taken / requested:\n${actions}` : '   Actions: auto-ack + admin notification',
        ].join('\n');
      })
    : ['(inbox had no processable unread customer messages)'];

  const text = [
    'Miras Supervisor — unread inbox catch-up report',
    '',
    `Admin: ${to}`,
    `Support: ${supportEmail()}`,
    `Historical unread processed: ${ok.length}`,
    `Failed: ${failed.length}`,
    `Promotional / newsletter ignored: ${promoSkipped}`,
    '',
    'Customer messages',
    '-----------------',
    ...blocks,
    '',
    'Only genuine customer or personal messages receive an automated acknowledgement.',
    'Promotional, marketing, and newsletter mail is ignored and is not listed above.',
    'Reply OK / NO on individual [Miras support] emails to send the drafted follow-up.',
  ].join('\n');

  const result = await sendMail({
    to,
    subject: `[Miras] Unread catch-up — ${ok.length} processed, ${failed.length} failed`,
    text,
    kind: 'admin-report',
  });
  mailLog('admin', 'REPORT SENT', {
    reason: 'historical-unread',
    to,
    processed: ok.length,
    failed: failed.length,
    promoSkipped,
    id: result.messageId,
  });
  return result;
}

/**
 * Fetch all UNSEEN mail, run the same customer pipeline (auto-ack + admin brief), then report.
 */
export async function processHistoricalUnreadMail(onMail) {
  mailLog('imap', 'HISTORICAL CATCH-UP START', { inbox: getImapConfig().user });
  const unread = await fetchUnreadInboxMessages({ historical: true });
  mailLog('imap', 'HISTORICAL UNREAD FOUND', {
    count: unread.length,
    promoSkipped: unread.promoSkipped || 0,
  });
  const processed = [];
  for (const mail of unread) {
    mailLog('imap', 'HISTORICAL PROCESSING', {
      from: mail.from,
      subject: mail.subject,
      uid: mail.uid,
    });
    try {
      const result = await onMail(mail);
      processed.push({ mail, result, ok: true });
      mailLog('imap', 'HISTORICAL PROCESSED', {
        from: mail.from,
        acked: result?.acked,
        thread: result?.threadId,
      });
    } catch (error) {
      processed.push({ mail, ok: false, error: error?.message || String(error) });
      mailLog('imap', 'HISTORICAL FAILED', {
        from: mail.from,
        error: error?.message || error,
      });
    }
  }
  mailLog('imap', 'HISTORICAL CATCH-UP DONE', {
    processed: processed.filter((item) => item.ok).length,
    failed: processed.filter((item) => !item.ok).length,
    promoSkipped: unread.promoSkipped || 0,
  });
  processed.promoSkipped = unread.promoSkipped || 0;
  processed.skipped = unread.skipped || 0;
  return processed;
}

async function parseImapMessage(message) {
  const { simpleParser } = await import('mailparser');
  const parsed = await simpleParser(message.source || Buffer.from(''));
  const from =
    parsed.from?.value?.[0]?.address ||
    message.envelope?.from?.[0]?.address ||
    '';
  const headerObject = {};
  if (parsed.headers && typeof parsed.headers.forEach === 'function') {
    parsed.headers.forEach((value, key) => {
      headerObject[String(key).toLowerCase()] = value;
    });
  }
  return {
    messageId: String(parsed.messageId || message.envelope?.messageId || message.uid || ''),
    from,
    subject: String(parsed.subject || message.envelope?.subject || '(no subject)'),
    text: String(parsed.text || parsed.html || '').replace(/<[^>]+>/g, ' ').trim(),
    date: parsed.date || null,
    headers: headerObject,
    listUnsubscribe: String(headerObject['list-unsubscribe'] || ''),
    listId: String(headerObject['list-id'] || ''),
    precedence: String(headerObject.precedence || ''),
    autoSubmitted: String(headerObject['auto-submitted'] || ''),
  };
}

/**
 * Continuously watch the support@miras.com inbox for customer mail.
 * @param {(mail: { from: string, subject: string, text: string, messageId: string }) => void | Promise<void>} onMail
 */
export async function startSupportInboxWatcher(onMail) {
  const cfg = getImapConfig();
  if (!cfg.host || !cfg.user || !cfg.pass) {
    mailLog('imap', 'NOT CONFIGURED', { hint: 'set IMAP_USER/IMAP_PASS or SMTP_USER/SMTP_PASS' });
    return () => {};
  }

  const { ImapFlow } = await import('imapflow');
  let stopped = false;
  let client = null;
  let pollCount = 0;

  const drainUnseen = async (imap) => {
    const lock = await imap.getMailboxLock('INBOX');
    let fetched = 0;
    let promoSkipped = 0;
    let customers = 0;
    try {
      for await (const message of imap.fetch({ seen: false }, { envelope: true, source: true, uid: true })) {
        if (stopped) break;
        fetched += 1;
        let mail;
        try {
          mail = await parseImapMessage(message);
        } catch (error) {
          mailLog('imap', 'PARSE FAILED', { uid: message.uid, error: error?.message || error });
          continue;
        }
        const id = mail.messageId || `uid-${message.uid}`;
        if (processedMessageIds.has(id)) {
          continue;
        }
        processedMessageIds.add(id);
        try {
          await imap.messageFlagsAdd({ uid: message.uid }, ['\\Seen'], { uid: true });
        } catch {
          /* mark-seen is best-effort */
        }
        const skip = shouldSkipInboundMail(mail);
        if (skip) {
          if (isPromoSkipCode(skip)) promoSkipped += 1;
          logInboundSkip('live', skip, mail);
          continue;
        }
        customers += 1;
        if (sameMailbox(mail.from, getMailConfig().from)) {
          mailLog('imap', 'ADMIN HITL REPLY', { from: mail.from, subject: mail.subject });
        } else {
          mailLog('imap', 'INCOMING DETECTED', {
            from: mail.from,
            subject: mail.subject,
            uid: message.uid,
          });
        }
        await onMail({ ...mail, source: mail.source || 'live', uid: message.uid });
      }
    } finally {
      lock.release();
    }
    return { fetched, promoSkipped, customers };
  };

  const loop = async () => {
    while (!stopped) {
      try {
        client = new ImapFlow({
          host: cfg.host,
          port: cfg.port,
          secure: cfg.secure,
          auth: { user: cfg.user, pass: cfg.pass },
          logger: false,
        });
        await client.connect();
        await client.mailboxOpen('INBOX');
        mailLog('imap', 'WATCHING', { user: cfg.user, host: `${cfg.host}:${cfg.port}`, pollMs: cfg.pollMs });
        while (!stopped && client.usable) {
          const batch = await drainUnseen(client);
          pollCount += 1;
          if (pollCount === 1 || pollCount % 4 === 0 || batch.customers > 0) {
            mailLog('imap', 'POLL heartbeat', {
              n: pollCount,
              unseenBatch: batch.fetched,
              customers: batch.customers,
              promoSkipped: batch.promoSkipped,
              inbox: cfg.user,
            });
          }
          await new Promise((resolve) => setTimeout(resolve, cfg.pollMs));
        }
      } catch (error) {
        mailLog('imap', 'WATCHER ERROR', { error: error?.message || error });
      } finally {
        try {
          await client?.logout();
        } catch {
          /* ignore */
        }
        client = null;
      }
      if (!stopped) {
        await new Promise((resolve) => setTimeout(resolve, cfg.pollMs));
      }
    }
  };

  void loop();
  return () => {
    stopped = true;
    void client?.logout?.();
  };
}

function parseEmailTask(task) {
  const raw = String(task || '');
  const to = (raw.match(/\bto=(\S+)/i) || [])[1] || '';
  const subject =
    (raw.match(/\bsubject=([^\n]+)/i) || [])[1]?.trim() ||
    'Miras support';
  const bodyMatch = raw.match(/\bbody=([\s\S]+)/i);
  const body = bodyMatch ? bodyMatch[1].trim() : raw.replace(/^email:\s*/i, '').trim();
  return { to, subject, body };
}

function draftReply({ to, subject, body }) {
  const greeting = 'مرحباً / Hello,';
  const closing =
    `\n\nمع التحية،\nفريق دعم مِراس\n${supportEmail()}\n\nBest regards,\nMiras Support`;
  return {
    to,
    from: supportEmail(),
    subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
    text: `${greeting}\n\n${body}${closing}`,
  };
}

/**
 * @param {{ task?: string }} state
 */
export async function runEmailAgent(state) {
  const parsed = parseEmailTask(state.task);
  if (!parsed.body) {
    const report =
      'Email agent: send a support issue, e.g.\n' +
      `email: to=customer@example.com subject=Order delay body=العميل يسأل عن الطلب\n` +
      `Support mailbox: ${supportEmail()}`;
    return {
      nextWorker: 'email',
      workerResults: { email: report },
      pendingAction: {
        worker: 'email',
        type: 'none',
        sensitive: false,
        summary: 'No email to send',
        payload: null,
      },
      finalResponse: report,
    };
  }

  const draft = draftReply(parsed);
  const summary = `Send support email from ${supportEmail()} to ${draft.to || '(missing recipient)'} — ${draft.subject}`;
  return {
    nextWorker: 'email',
    workerResults: { email: draft.text },
    pendingAction: {
      worker: 'email',
      type: 'send_email',
      sensitive: true,
      summary,
      payload: draft,
    },
    finalResponse: `Draft for Supervisor confirmation (from ${supportEmail()}):\nTo: ${draft.to}\nSubject: ${draft.subject}\n\n${draft.text}`,
  };
}

/**
 * @param {{ type?: string, payload?: { to: string, from: string, subject: string, text: string } }} action
 */
export async function executeEmailAction(action) {
  if (action?.type !== 'send_email') {
    return { ok: true, skipped: true };
  }
  const draft = action.payload || {};
  if (!draft.to) {
    throw new Error('Cannot send: missing recipient');
  }
  return sendMail({
    to: draft.to,
    subject: draft.subject,
    text: draft.text,
    replyTo: draft.from || supportEmail(),
    kind: 'follow-up',
  });
}
