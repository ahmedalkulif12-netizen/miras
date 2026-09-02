/**
 * IMAP inbox diagnostic for miras-agents.
 * Loads SMTP/IMAP env, connects, lists recent messages, highlights yesterday.
 * Never prints passwords.
 *
 *   npm run diag:imap
 */
import { loadServerEnv } from '../server/config/env.ts';
import { getImapConfig, getMailConfig, supportEmail } from '../src/agents/email.js';

function envelopeAddress(list) {
  const first = list?.[0];
  if (!first) return '(unknown)';
  const email = first.address || '';
  const name = first.name ? `${first.name} ` : '';
  return email ? `${name}<${email}>` : name.trim() || '(unknown)';
}

function normalize(value) {
  const raw = String(value || '');
  const angle = raw.match(/<([^>]+)>/);
  return String(angle ? angle[1] : raw)
    .trim()
    .toLowerCase();
}

function startOfLocalDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function formatLocalYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isSameLocalDay(a, b) {
  return startOfLocalDay(a).getTime() === startOfLocalDay(b).getTime();
}

function hasFlag(flags, name) {
  const needle = String(name).replace(/^\\/, '').toLowerCase();
  for (const flag of flags || []) {
    if (String(flag).replace(/^\\/, '').toLowerCase() === needle) return true;
  }
  return false;
}

loadServerEnv();
const imap = getImapConfig();
const smtp = getMailConfig();

if (!imap.host || !imap.user || !imap.pass) {
  throw new Error('IMAP_USER / IMAP_PASS (or SMTP_USER / SMTP_PASS) are missing');
}

const selfMailboxes = new Set(
  [imap.user, smtp.user, smtp.from, supportEmail(), process.env.MIRAS_ADMIN_EMAIL]
    .map(normalize)
    .filter(Boolean)
);

const now = new Date();
const yesterday = new Date(now);
yesterday.setDate(now.getDate() - 1);
const yesterdayStart = startOfLocalDay(yesterday);

console.log('[imap-diag] CONNECTING');
console.log(`[imap-diag] host=${imap.host}:${imap.port} user=${imap.user} secure=${imap.secure}`);
console.log(
  `[imap-diag] local now=${now.toString()} today=${formatLocalYmd(now)} yesterday=${formatLocalYmd(yesterdayStart)}`
);

const { ImapFlow } = await import('imapflow');
const client = new ImapFlow({
  host: imap.host,
  port: imap.port,
  secure: imap.secure,
  auth: { user: imap.user, pass: imap.pass },
  logger: false,
});

try {
  await client.connect();
  const box = await client.mailboxOpen('INBOX');
  console.log(
    `[imap-diag] AUTH OK — INBOX exists=${box.exists} unseen=${box.unseen ?? 'n/a'}`
  );

  const status = await client.status('INBOX', { messages: true, unseen: true });
  console.log(
    `[imap-diag] STATUS messages=${status.messages ?? box.exists} unseen=${status.unseen ?? 'n/a'}`
  );

  const fromSeq = Math.max(1, Number(box.exists || 0) - 79);
  const recent = [];
  if (box.exists > 0) {
    for await (const message of client.fetch(`${fromSeq}:*`, {
      envelope: true,
      flags: true,
      uid: true,
      internalDate: true,
    })) {
      const from = envelopeAddress(message.envelope?.from);
      const fromEmail = normalize(from);
      const date = message.internalDate || message.envelope?.date || null;
      const seen = hasFlag(message.flags, 'Seen');
      recent.push({
        uid: message.uid,
        from,
        fromEmail,
        subject: String(message.envelope?.subject || '(no subject)'),
        date,
        seen,
        unread: !seen,
        external: fromEmail && !selfMailboxes.has(fromEmail),
        yesterday: date ? isSameLocalDay(date, yesterday) : false,
      });
    }
  }

  recent.sort((a, b) => {
    const ta = a.date ? new Date(a.date).getTime() : 0;
    const tb = b.date ? new Date(b.date).getTime() : 0;
    return tb - ta;
  });

  console.log(`[imap-diag] RECENT ${recent.length} message(s) (latest up to 80)`);
  for (const row of recent) {
    const flags = [
      row.unread ? 'UNREAD' : 'read',
      row.external ? 'external' : 'self/known',
      row.yesterday ? 'YESTERDAY' : '',
    ]
      .filter(Boolean)
      .join(',');
    console.log(
      `[imap-diag] uid=${row.uid} ${flags} date=${row.date ? new Date(row.date).toISOString() : 'n/a'} from=${row.from} subject=${row.subject}`
    );
  }

  const yesterdayRows = recent.filter((row) => row.yesterday);
  const unseenSearch = await client.search({ seen: false }, { uid: true });
  const unseenUids = Array.isArray(unseenSearch) ? unseenSearch : [];
  console.log(`[imap-diag] SEARCH UNSEEN uid count=${unseenUids.length}`);

  const unreadYesterday = yesterdayRows.filter((row) => row.unread);
  const externalYesterday = yesterdayRows.filter((row) => row.external);
  const unreadExternalYesterday = yesterdayRows.filter((row) => row.unread && row.external);

  console.log('[imap-diag] YESTERDAY SUMMARY');
  console.log(`[imap-diag]   total=${yesterdayRows.length} unread=${unreadYesterday.length} external=${externalYesterday.length} unread+external=${unreadExternalYesterday.length}`);
  if (!yesterdayRows.length) {
    console.log('[imap-diag]   no messages dated yesterday in this inbox');
  }
  for (const row of yesterdayRows) {
    console.log(
      `[imap-diag]   YESTERDAY uid=${row.uid} ${row.unread ? 'UNREAD' : 'read'} ${row.external ? 'external' : 'self/known'} from=${row.from} subject=${row.subject}`
    );
  }

  const unreadRecent = recent.filter((row) => row.unread);
  console.log(`[imap-diag] UNREAD in recent window=${unreadRecent.length}`);
  console.log('[imap-diag] CONNECTIVITY OK — IMAP credentials accepted and messages listed without parse errors');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const authFail = /auth|invalid credentials|login|authentication/i.test(message);
  console.error(`[imap-diag] ${authFail ? 'AUTH FAILED' : 'ERROR'}: ${message}`);
  process.exitCode = 1;
} finally {
  try {
    await client.logout();
  } catch {
    /* ignore */
  }
}
