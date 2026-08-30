import { loadServerEnv } from '../server/config/env.ts';
import { getImapConfig, verifyMailTransport } from '../src/agents/email.js';

loadServerEnv();
await verifyMailTransport();
const imap = getImapConfig();
if (!imap.user || !imap.pass) {
  throw new Error('IMAP user/pass missing after env load');
}
console.log('IMAP watcher credentials are present (host ' + imap.host + ')');
