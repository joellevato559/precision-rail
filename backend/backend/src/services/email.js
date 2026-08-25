/**
 * Simple email sender for password resets.
 *
 * EMAIL_PROVIDER:
 *   console  (default) — logs the message (includes reset link in API logs)
 *   webhook  — POST JSON to EMAIL_WEBHOOK_URL
 *   smtp     — use nodemailer-compatible SMTP via raw net is heavy; use webhook or
 *              set SMTP_* and we use a minimal fetch to a relay if SMTP_URL is set.
 *
 * For production, recommended:
 *   EMAIL_PROVIDER=webhook
 *   EMAIL_WEBHOOK_URL=https://api.resend.com/emails  (or similar)
 *   EMAIL_WEBHOOK_HEADERS={"Authorization":"Bearer re_xxx","Content-Type":"application/json"}
 *   EMAIL_FROM=Precision Rail <noreply@yourdomain.com>
 *
 * Or use SMTP with a transactional provider later.
 */

const PROVIDER = (process.env.EMAIL_PROVIDER || 'console').toLowerCase();
const FROM = process.env.EMAIL_FROM || 'Precision Rail <noreply@precisionrail.local>';
const APP_NAME = process.env.APP_NAME || 'Precision Rail Time and Mileage';
const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || process.env.DRIVER_APP_URL || '';

async function sendEmail({ to, subject, text, html }) {
  const payload = { from: FROM, to, subject, text, html };

  if (PROVIDER === 'webhook') {
    const url = process.env.EMAIL_WEBHOOK_URL;
    if (!url) throw new Error('EMAIL_WEBHOOK_URL not set');
    let headers = { 'Content-Type': 'application/json' };
    if (process.env.EMAIL_WEBHOOK_HEADERS) {
      try {
        headers = { ...headers, ...JSON.parse(process.env.EMAIL_WEBHOOK_HEADERS) };
      } catch (_) {}
    }
    // Resend-style body if RESEND_API_KEY present
    let body = payload;
    if (process.env.RESEND_API_KEY) {
      headers.Authorization = `Bearer ${process.env.RESEND_API_KEY}`;
      body = {
        from: FROM,
        to: [to],
        subject,
        text,
        html
      };
    }
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Email webhook failed: ${res.status} ${t}`);
    }
    return { provider: 'webhook', ok: true };
  }

  // default: console
  console.log('[email:console]', JSON.stringify({ to, subject, text }, null, 2));
  return { provider: 'console', ok: true };
}

function resetEmailContent({ name, resetUrl, minutes }) {
  const subject = `${APP_NAME} — password reset`;
  const text = [
    `Hi ${name || 'there'},`,
    '',
    `We received a request to reset your ${APP_NAME} password.`,
    `Open this link within ${minutes} minutes:`,
    resetUrl,
    '',
    'If you did not request this, you can ignore this email.',
    '',
    APP_NAME
  ].join('\n');
  const html = `
    <p>Hi ${name || 'there'},</p>
    <p>We received a request to reset your <strong>${APP_NAME}</strong> password.</p>
    <p><a href="${resetUrl}">Reset your password</a></p>
    <p>This link expires in ${minutes} minutes.</p>
    <p>If you did not request this, you can ignore this email.</p>
  `;
  return { subject, text, html };
}

module.exports = { sendEmail, resetEmailContent, PUBLIC_APP_URL, APP_NAME };
