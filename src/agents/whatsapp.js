// @ts-nocheck
/**
 * Email HITL runtime — sole admin interface for the Miras supervisor.
 * The Support Agent watches support@miras.com; the Supervisor emails
 * MIRAS_ADMIN_EMAIL from that mailbox so the admin never needs the support inbox.
 */
import http from 'node:http';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  formatApprovalMessage,
  handleInboundCustomerEmail,
  invokeTask,
  isApprovalReply,
  isRejectionReply,
  notifyAdminByEmail,
  requestEmailApproval,
  resumeWithAdminReply,
} from './supervisor.js';
import {
  adminEmail,
  getWorkerStats,
  markWorkerStarted,
  normalizeAddress,
  requireMailSecrets,
  sendOperationalDigestEmail,
  startSupportInboxWatcher,
  supportEmail,
  verifyImapConnection,
  verifyMailTransport,
} from './email.js';
import { startPayoutWatcher } from './payouts.js';

/** @type {{ threadId: string } | null} */
let pendingApproval = null;

function extractDecision(text) {
  const first = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return first || '';
}

async function deliverRunResult(result) {
  if (result.status === 'interrupted') {
    pendingApproval = { threadId: result.threadId };
    await requestEmailApproval(result.interrupt, result.threadId);
    console.log('[agents] approval email sent — reply OK or NO (email or terminal)');
    console.log(formatApprovalMessage(result.interrupt, result.threadId));
    return;
  }
  pendingApproval = null;
  const text = result.text || result.values?.finalResponse || 'Done.';
  await notifyAdminByEmail(text, { subject: 'Miras supervisor — result' });
}

export async function handleAdminText(text, options = {}) {
  const body = String(text || '').trim();
  if (!body) return;

  if (pendingApproval) {
    if (isApprovalReply(body) || isRejectionReply(body)) {
      const threadId = pendingApproval.threadId;
      const result = await resumeWithAdminReply(threadId, body);
      await deliverRunResult(result);
      return result;
    }
    await notifyAdminByEmail(
      'A sensitive action is waiting. Reply OK to execute or NO to reject before sending a new task.',
      { subject: 'Miras supervisor — approval pending' }
    );
    return null;
  }

  const threadId =
    options.threadId || `miras-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const result = await invokeTask(body, threadId);
  await deliverRunResult(result);
  return result;
}

async function onInboundSupportMail(mail) {
  const from = normalizeAddress(mail?.from);
  const decision = extractDecision(mail?.text);
  if (from && from === normalizeAddress(adminEmail())) {
    if (pendingApproval && (isApprovalReply(decision) || isRejectionReply(decision))) {
      console.log(`[imap] ADMIN DECISION from=${from} decision=${decision}`);
      await handleAdminText(decision);
      return;
    }
  }
  console.log(`[imap] CUSTOMER MAIL from=${mail.from} subject=${mail.subject}`);
  const routed = await handleInboundCustomerEmail(mail);
  console.log(
    `[ack] customer auto-reply ${routed?.acked ? 'SENT' : 'SKIPPED'} from=${mail.from}`
  );
  console.log(
    `[admin] ticket brief ${routed?.brief?.ok ? 'SENT' : 'PENDING'} thread=${routed?.threadId || 'n/a'} urgency=${routed?.evaluation?.urgency || 'n/a'}`
  );
  if (routed?.result?.status === 'interrupted') {
    pendingApproval = { threadId: routed.threadId };
    console.log(`[admin] HITL approval waiting thread=${routed.threadId}`);
  }
}

function listenHealthServer() {
  const port = Number(process.env.PORT || 0);
  if (!port) {
    console.log('[agents] PORT unset — skipping HTTP health server (OK for Render/Railway workers)');
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = String(req.url || '');
      if (url === '/health' || url === '/' || url.startsWith('/health?')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
            JSON.stringify({
              ok: true,
              service: 'miras-agents',
              support: supportEmail(),
              ...getWorkerStats(),
            })
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.on('error', reject);
    server.listen(port, '0.0.0.0', () => {
      console.log(`[agents] health server on 0.0.0.0:${port}/health`);
      resolve();
    });
  });
}

function startTerminalApprovalListener() {
  if (!process.stdin.isTTY) return () => {};
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('[agents] Type a task, or OK / NO for a pending approval, then press Enter.');
  rl.on('line', (line) => {
    void handleAdminText(line).catch((error) => {
      console.error('[agents] handler failed:', error?.message || error);
    });
  });
  return () => rl.close();
}

function startOperationalDigestTimer() {
  const ms = Number(process.env.MIRAS_REPORT_INTERVAL_MS || 6 * 60 * 60 * 1000);
  if (!Number.isFinite(ms) || ms <= 0) {
    console.log('[agents] periodic admin digest disabled (MIRAS_REPORT_INTERVAL_MS<=0)');
    return;
  }
  setInterval(() => {
    void sendOperationalDigestEmail({ reason: 'interval' }).catch((error) => {
      console.warn('[agents] digest email failed:', error?.message || error);
    });
  }, ms);
  console.log(`[agents] admin digest every ${Math.round(ms / 60000)} minute(s)`);
}

/**
 * Boot env, verify SMTP/IMAP, notify admin, watch support@miras.com, payouts.
 */
export async function startAgentRuntime() {
  process.on('unhandledRejection', (reason) => {
    console.error('[agents] unhandledRejection:', reason);
  });
  const { loadServerEnv } = await import('../../server/config/env.ts');
  loadServerEnv();

  const mail = requireMailSecrets();
  markWorkerStarted();

  console.log(`[agents] support mailbox: ${mail.support}`);
  console.log(`[agents] admin mailbox:   ${mail.admin}`);
  console.log(`[agents] SMTP user:       ${mail.smtp.user}`);
  console.log(`[agents] IMAP user:       ${mail.imap.user}`);

  await listenHealthServer();
  await verifyMailTransport();
  await verifyImapConnection();

  if (process.env.MIRAS_AGENTS_SKIP_BOOT_EMAIL === 'true') {
    console.log('[agents] skipping boot operational email (MIRAS_AGENTS_SKIP_BOOT_EMAIL)');
  } else {
    const test = await sendOperationalDigestEmail({
      reason: 'boot',
      extra: 'Status: multi-agent supervisor is online. IMAP watcher starting.',
    });
    console.log('[agents] startup operational report sent', {
      from: test.from,
      to: test.to,
      messageId: test.messageId,
    });
  }

  try {
    const { getServerConfig } = await import('../../server/config/env.ts');
    const { initFirebaseAdmin } = await import('../../server/lib/firebaseAdmin.ts');
    const config = getServerConfig();
    initFirebaseAdmin(config.firebaseProjectId);
  } catch (error) {
    console.warn('[agents] Firebase Admin init skipped:', error?.message || error);
  }

  await startSupportInboxWatcher(async (mail) => {
    try {
      await onInboundSupportMail(mail);
    } catch (error) {
      console.error('[agents] inbound support handler failed:', error?.message || error);
    }
  });

  startPayoutWatcher(async (task) => {
    try {
      if (pendingApproval) {
        await notifyAdminByEmail(`New payout activity while approval is pending:\n${task}`, {
          subject: 'Miras supervisor — payout activity',
        });
        return;
      }
      await handleAdminText(task.startsWith('payouts') ? task : `payouts: ${task}`);
    } catch (error) {
      console.warn('[agents] payout watch task failed:', error?.message || error);
    }
  });

  startOperationalDigestTimer();
  startTerminalApprovalListener();
  console.log('[agents] Miras multi-agent supervisor is online (email HITL)');
  await new Promise(() => {});
}

function isDirectRun() {
  try {
    if (!import.meta.url) return false;
    const self = fileURLToPath(import.meta.url);
    const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
    return Boolean(invoked && path.normalize(self) === path.normalize(invoked));
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  startAgentRuntime().catch((error) => {
    console.error('[agents] fatal:', error);
    process.exit(1);
  });
}
