import { loadServerEnv } from '../server/config/env.ts';
import { sendMail, supportEmail, verifyMailTransport } from '../src/agents/email.js';

const TO = 'ahmed.alkhulif.12@gmail.com';

loadServerEnv();
await verifyMailTransport();

const publicInbox = supportEmail();
const LOGO_URL = 'https://hamula-cfc6c.web.app/jz-app-icon.png';
const text = [
    'مرحباً،',
    '',
    'تم ربط نظام JZ Logistics بخدمة البريد بنجاح.',
    `صندوق الدعم العام: ${publicInbox}`,
    'ردود العملاء تصل إلى هذا الحساب عبر SMTP، والمراقبة تتم عبر IMAP.',
    '',
    'هذه رسالة ترحيب وتأكيد من وكيل الدعم الذكي. لا يلزم اتخاذ أي إجراء.',
    '',
    'Hello,',
    '',
    'The JZ Logistics AI support agent is successfully linked to this mailbox.',
    `Public support address (Reply-To): ${publicInbox}`,
    'Outbound mail is sent through Gmail SMTP. Inbound tickets are watched over IMAP.',
    '',
    'This is a welcome and confirmation message. No action is required.',
    '',
    '— JZ Logistics Support Agent',
  ].join('\n');

const html = `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#000000;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#000000;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
            <tr>
              <td align="center" style="padding:8px 0 24px;">
                <img src="${LOGO_URL}" width="96" height="96" alt="JZ Logistics" style="display:block;border:0;border-radius:22px;" />
                <p style="margin:16px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:1.2;font-weight:800;color:#FFCC00;">JZ Logistics</p>
              </td>
            </tr>
            <tr>
              <td style="background:#111111;border-radius:18px;padding:28px 24px;font-family:Arial,Helvetica,sans-serif;color:#ffffff;font-size:15px;line-height:1.7;">
                <p style="margin:0 0 12px;">مرحباً،</p>
                <p style="margin:0 0 12px;">تم ربط نظام JZ Logistics بخدمة البريد بنجاح.</p>
                <p style="margin:0 0 12px;">صندوق الدعم العام: <a href="mailto:${publicInbox}" style="color:#FFCC00;text-decoration:none;">${publicInbox}</a></p>
                <p style="margin:0 0 20px;">هذه رسالة ترحيب وتأكيد. لا يلزم اتخاذ أي إجراء.</p>
                <p style="margin:0 0 12px;">Hello,</p>
                <p style="margin:0 0 12px;">The JZ Logistics support mailbox is linked and this message confirms outbound delivery.</p>
                <p style="margin:0;">Reply-To: <a href="mailto:${publicInbox}" style="color:#FFCC00;text-decoration:none;">${publicInbox}</a></p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:20px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#FFCC00;">
                JZ Logistics Support
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

const result = await sendMail({
  to: TO,
  subject: 'JZ Logistics — welcome. Email integration is linked',
  text,
  html,
});

console.log(
  JSON.stringify(
    {
      ok: result.ok,
      to: result.to,
      from: result.from,
      replyTo: result.replyTo,
      messageId: result.messageId,
      previewUrl: result.previewUrl,
    },
    null,
    2
  )
);
