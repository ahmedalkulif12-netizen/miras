// @ts-nocheck
/**
 * Worker 3 — Email & Support Agent (Node-only).
 * Nodemailer sends customer replies, admin notifications, and HITL approvals
 * from MIRAS_SUPPORT_EMAIL. Sending customer mail waits for Supervisor OK.
 */
import nodemailer from 'nodemailer';
import { SUPPORT_EMAIL } from '../lib/supportContact.ts';

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
  console.log(`[email] SMTP login OK for ${cfg.user} (From: ${cfg.from}, Reply-To: ${cfg.replyTo})`);
  return cfg;
}

/**
 * @param {{ to: string, subject: string, text: string, html?: string, replyTo?: string }} mail
 */
export async function sendMail(mail) {
  const to = String(mail?.to || '').trim();
  if (!to) throw new Error('Cannot send: missing recipient');
  const cfg = getMailConfig();
  const transport = await createMailTransport();
  const fromAddress = cfg.from;
  const replyTo = mail.replyTo || cfg.replyTo || supportEmail();
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
    console.log('[email] Ethereal preview:', previewUrl);
  }
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
  const to = adminEmail();
  if (!to) throw new Error('Set MIRAS_ADMIN_EMAIL before starting agents');
  const from = getMailConfig().from;
  const publicInbox = supportEmail();
  const imap = getImapConfig();
  const watching = Boolean(imap.host && imap.user && imap.pass);
  const extra = String(options.extra || '').trim();
  const text = [
    'Miras Supervisor — operational summary (test)',
    '',
    `Transport From: ${from}`,
    `Reply-To / public support: ${publicInbox}`,
    `To: ${to}`,
    '',
    'Status: multi-agent supervisor is online.',
    `Support inbox watch: ${imap.user || '(none)'}${watching ? ' — IMAP watcher active' : ' — IMAP not configured'}`,
    'Workers: developer, firebase, email (support), payouts',
    '',
    'Customer mail to support@miras.com should be forwarded to the Gmail transport inbox.',
    'The Supervisor emails you a summary so you do not need to open the support inbox.',
    extra ? `\n${extra}` : '',
    '',
    'This is a test notification. No customer ticket was executed.',
  ]
    .filter((line) => line !== '')
    .join('\n');

  const result = await sendMail({
    to,
    subject: '[Miras] Operational summary — multi-agent supervisor is online',
    text,
  });
  console.log(`[email] operational summary sent from ${from} to ${to} (${result.messageId})`);
  return result;
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
  return sendToAdmin(formatAdminSupportBrief(payload), { subject });
}

const processedMessageIds = new Set();

async function parseImapMessage(message) {
  const { simpleParser } = await import('mailparser');
  const parsed = await simpleParser(message.source || Buffer.from(''));
  const from =
    parsed.from?.value?.[0]?.address ||
    message.envelope?.from?.[0]?.address ||
    '';
  return {
    messageId: String(parsed.messageId || message.envelope?.messageId || message.uid || ''),
    from,
    subject: String(parsed.subject || message.envelope?.subject || '(no subject)'),
    text: String(parsed.text || parsed.html || '').replace(/<[^>]+>/g, ' ').trim(),
    date: parsed.date || null,
  };
}

/**
 * Continuously watch the support@miras.com inbox for customer mail.
 * @param {(mail: { from: string, subject: string, text: string, messageId: string }) => void | Promise<void>} onMail
 */
export async function startSupportInboxWatcher(onMail) {
  const cfg = getImapConfig();
  if (!cfg.host || !cfg.user || !cfg.pass) {
    console.warn(
      '[email] IMAP not configured — set IMAP_USER / IMAP_PASS (or SMTP_USER / SMTP_PASS) to watch the Gmail inbox.'
    );
    return () => {};
  }

  const { ImapFlow } = await import('imapflow');
  let stopped = false;
  let client = null;

  const drainUnseen = async (imap) => {
    const lock = await imap.getMailboxLock('INBOX');
    try {
      for await (const message of imap.fetch({ seen: false }, { envelope: true, source: true, uid: true })) {
        if (stopped) break;
        let mail;
        try {
          mail = await parseImapMessage(message);
        } catch (error) {
          console.warn('[email] failed to parse inbound message:', error?.message || error);
          continue;
        }
        const id = mail.messageId || `uid-${message.uid}`;
        if (processedMessageIds.has(id)) continue;
        processedMessageIds.add(id);
        try {
          await imap.messageFlagsAdd({ uid: message.uid }, ['\\Seen'], { uid: true });
        } catch {
          /* mark-seen is best-effort */
        }
        if (sameMailbox(mail.from, supportEmail())) continue;
        if (sameMailbox(mail.from, getMailConfig().from) && /^\[Miras /i.test(mail.subject || '')) continue;
        await onMail(mail);
      }
    } finally {
      lock.release();
    }
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
        console.log(`[email] watching ${cfg.user} on ${cfg.host}:${cfg.port}`);
        while (!stopped && client.usable) {
          await drainUnseen(client);
          await new Promise((resolve) => setTimeout(resolve, cfg.pollMs));
        }
      } catch (error) {
        console.warn('[email] IMAP watcher error:', error?.message || error);
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
  });
}
