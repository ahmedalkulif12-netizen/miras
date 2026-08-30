import { loadServerEnv } from '../server/config/env.ts';
import { sendMail, supportEmail, verifyMailTransport } from '../src/agents/email.js';

const TO = 'ahmed.alkhulif.12@gmail.com';

loadServerEnv();
await verifyMailTransport();

const publicInbox = supportEmail();
const result = await sendMail({
  to: TO,
  subject: 'Miras — welcome. Email integration is linked',
  text: [
    'مرحباً،',
    '',
    'تم ربط نظام مَرَاس (Miras) بخدمة البريد بنجاح.',
    `صندوق الدعم العام: ${publicInbox}`,
    'ردود العملاء تصل إلى هذا الحساب عبر SMTP، والمراقبة تتم عبر IMAP.',
    '',
    'هذه رسالة ترحيب وتأكيد من وكيل الدعم الذكي. لا يلزم اتخاذ أي إجراء.',
    '',
    'Hello,',
    '',
    'The Miras AI support agent is successfully linked to this mailbox.',
    `Public support address (Reply-To): ${publicInbox}`,
    'Outbound mail is sent through Gmail SMTP. Inbound tickets are watched over IMAP.',
    '',
    'This is a welcome and confirmation message. No action is required.',
    '',
    '— Miras Support Agent',
  ].join('\n'),
});

console.log(`Welcome email sent to ${result.to} (${result.messageId})`);
