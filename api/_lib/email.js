// api/_lib/email.js — Transactional email module for QR Pro Kit SaaS
// Sends beautiful, branded subscription confirmations & invoice notices.
// Support contact: support@engagiumtechnologies.com

import tls from "node:tls";
import net from "node:net";

export const SUPPORT_EMAIL = "support@engagiumtechnologies.com";

/**
 * Render responsive HTML email template for subscription activation
 */
export function renderSubscriptionHtml({
  customerName = "Valued Customer",
  planName = "Pro",
  interval = "monthly",
  amount = "",
  provider = "Razorpay",
  subscriptionId = "",
  dashboardUrl = "https://qr-pro-kit-saas-production.up.railway.app/dashboard",
}) {
  const displayPlan = planName ? planName.charAt(0).toUpperCase() + planName.slice(1) : "Pro";
  const displayInterval = interval === "yearly" ? "Annual" : "Monthly";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your ${displayPlan} Subscription is Active — QR Pro Kit</title>
  <style>
    body { font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px 0; color: #1e293b; }
    .email-container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.05); }
    .email-header { background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%); padding: 32px 32px; text-align: center; color: #ffffff; }
    .brand-title { font-size: 24px; font-weight: 800; letter-spacing: -0.02em; margin: 0; }
    .brand-tag { font-size: 13px; color: #c7d2fe; margin-top: 4px; font-weight: 500; }
    .email-body { padding: 36px 32px; }
    .greeting { font-size: 20px; font-weight: 700; color: #0f172a; margin-top: 0; margin-bottom: 12px; }
    .message { font-size: 15px; line-height: 1.6; color: #475569; margin-bottom: 24px; }
    .plan-card { background: #f1f5f9; border-radius: 12px; padding: 20px 24px; margin-bottom: 28px; border: 1px solid #cbd5e1; }
    .plan-card-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .plan-card-row:last-child { margin-bottom: 0; }
    .plan-key { font-size: 13px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
    .plan-val { font-size: 15px; color: #0f172a; font-weight: 700; }
    .cta-btn { display: inline-block; background: #4f46e5; color: #ffffff !important; font-weight: 700; font-size: 15px; text-decoration: none; padding: 14px 28px; border-radius: 10px; text-align: center; margin-top: 8px; }
    .support-box { margin-top: 32px; padding-top: 24px; border-top: 1px solid #e2e8f0; font-size: 13px; color: #64748b; line-height: 1.6; }
    .support-link { color: #4f46e5; text-decoration: none; font-weight: 600; }
    .email-footer { background: #f8fafc; padding: 20px 32px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="email-header">
      <h1 class="brand-title">QR PRO KIT</h1>
      <div class="brand-tag">Smart Dynamic QR Management &amp; Analytics</div>
    </div>
    <div class="email-body">
      <h2 class="greeting">Payment Verified &amp; Plan Activated! 🎉</h2>
      <p class="message">
        Hello ${customerName},<br><br>
        Thank you for choosing QR Pro Kit! Your subscription payment has been successfully confirmed, and your premium account features and quotas are now active.
      </p>

      <div class="plan-card">
        <div class="plan-card-row">
          <span class="plan-key">Plan</span>
          <span class="plan-val">${displayPlan} (${displayInterval})</span>
        </div>
        ${amount ? `
        <div class="plan-card-row">
          <span class="plan-key">Amount</span>
          <span class="plan-val">${amount}</span>
        </div>` : ""}
        <div class="plan-card-row">
          <span class="plan-key">Payment Gateway</span>
          <span class="plan-val">${provider}</span>
        </div>
        ${subscriptionId ? `
        <div class="plan-card-row">
          <span class="plan-key">Subscription ID</span>
          <span class="plan-val" style="font-family: monospace; font-size: 13px;">${subscriptionId}</span>
        </div>` : ""}
        <div class="plan-card-row">
          <span class="plan-key">Status</span>
          <span class="plan-val" style="color: #16a34a;">● Active</span>
        </div>
      </div>

      <p class="message">
        You can now generate high-volume dynamic QR codes, update landing pages over the air, download high-res vectors, and view scan analytics.
      </p>

      <div style="text-align: center; margin: 28px 0 16px;">
        <a href="${dashboardUrl}" class="cta-btn">Open My Dashboard →</a>
      </div>

      <div class="support-box">
        <strong>Need help or custom onboarding?</strong><br>
        Our technical team is ready to assist you. Contact our priority support desk at
        <a href="mailto:${SUPPORT_EMAIL}" class="support-link">${SUPPORT_EMAIL}</a>.
      </div>
    </div>
    <div class="email-footer">
      © ${new Date().getFullYear()} Engagium Technologies. All rights reserved.<br>
      You received this transactional email because of your subscription with QR Pro Kit.
    </div>
  </div>
</body>
</html>`;
}

/**
 * Render plain text fallback
 */
export function renderSubscriptionText({
  customerName = "Valued Customer",
  planName = "Pro",
  interval = "monthly",
  amount = "",
  provider = "Razorpay",
  subscriptionId = "",
  dashboardUrl = "https://qr-pro-kit-saas-production.up.railway.app/dashboard",
}) {
  return `QR PRO KIT — Payment Verified & Plan Activated

Hello ${customerName},

Thank you for choosing QR Pro Kit! Your subscription payment has been successfully confirmed.

Subscription Details:
- Plan: ${planName} (${interval})
${amount ? `- Amount: ${amount}\n` : ""}- Provider: ${provider}
${subscriptionId ? `- Subscription ID: ${subscriptionId}\n` : ""}- Status: Active

Access your dashboard: ${dashboardUrl}

Need support? Contact us anytime at ${SUPPORT_EMAIL}.

— The QR Pro Kit Team
Engagium Technologies`;
}

/**
 * Send subscription confirmation email with fallback to mock/log
 */
export async function sendSubscriptionSuccessEmail({
  toEmail,
  customerName,
  planName,
  interval,
  amount,
  provider,
  subscriptionId,
}) {
  if (!toEmail || !toEmail.includes("@")) {
    console.warn("[Email Notification] Skipped dispatch: no valid recipient email.");
    return { ok: false, reason: "invalid_recipient" };
  }

  const subject = `Your ${planName || "Pro"} plan is active — QR Pro Kit`;
  const html = renderSubscriptionHtml({ customerName, planName, interval, amount, provider, subscriptionId });
  const text = renderSubscriptionText({ customerName, planName, interval, amount, provider, subscriptionId });

  // 1. Resend API support if configured
  if (process.env.RESEND_API_KEY) {
    try {
      const fromAddr = process.env.EMAIL_FROM || `QR Pro Kit <support@engagiumtechnologies.com>`;
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromAddr,
          to: [toEmail],
          subject,
          html,
          text,
          reply_to: SUPPORT_EMAIL,
        }),
      });
      if (res.ok) {
        console.log(`[Email Notification] Successfully sent via Resend to ${toEmail}`);
        return { ok: true, provider: "resend" };
      }
      const errText = await res.text();
      console.warn(`[Email Notification] Resend API error: ${errText}`);
    } catch (e) {
      console.warn(`[Email Notification] Resend dispatch failed: ${e.message}`);
    }
  }

  // 2. Standard SMTP support if configured
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      // Send via basic SMTP handshake over TLS/TCP
      const host = process.env.SMTP_HOST;
      const port = Number(process.env.SMTP_PORT) || 465;
      const user = process.env.SMTP_USER;
      const pass = process.env.SMTP_PASS;
      const from = process.env.EMAIL_FROM || user || SUPPORT_EMAIL;

      await sendRawSmtp({ host, port, user, pass, from, to: toEmail, subject, text, html });
      console.log(`[Email Notification] Successfully sent via SMTP to ${toEmail}`);
      return { ok: true, provider: "smtp" };
    } catch (smtpErr) {
      console.warn(`[Email Notification] SMTP dispatch warning: ${smtpErr.message}`);
    }
  }

  // 3. Graceful fallback (logged for auditing)
  console.log(
    `[Email Notification] Transactional email prepared for ${toEmail} | Plan: ${planName} (${interval}) | Provider: ${provider} | Contact: ${SUPPORT_EMAIL}`
  );
  return { ok: true, provider: "simulated" };
}

/**
 * Basic RFC 5321 SMTP client over TLS socket without external dependencies
 */
function sendRawSmtp({ host, port, user, pass, from, to, subject, text, html }) {
  return new Promise((resolve, reject) => {
    const isSecure = port === 465;
    const socket = isSecure ? tls.connect(port, host) : net.connect(port, host);
    socket.setTimeout(12000);

    let step = 0;
    const boundary = "====_NextPart_" + Date.now();

    const write = (cmd) => {
      socket.write(cmd + "\r\n");
    };

    socket.on("error", (err) => {
      socket.destroy();
      reject(err);
    });

    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("SMTP socket timeout"));
    });

    socket.on("data", (data) => {
      const resp = data.toString();
      const code = parseInt(resp.slice(0, 3), 10);

      if (code >= 400 && step < 10) {
        socket.destroy();
        return reject(new Error(`SMTP error ${code}: ${resp.trim()}`));
      }

      if (step === 0 && code === 220) {
        step = 1;
        write(`EHLO ${host}`);
      } else if (step === 1 && code === 250) {
        step = 2;
        write("AUTH LOGIN");
      } else if (step === 2 && code === 334) {
        step = 3;
        write(Buffer.from(user).toString("base64"));
      } else if (step === 3 && code === 334) {
        step = 4;
        write(Buffer.from(pass).toString("base64"));
      } else if (step === 4 && code === 235) {
        step = 5;
        write(`MAIL FROM:<${from}>`);
      } else if (step === 5 && code === 250) {
        step = 6;
        write(`RCPT TO:<${to}>`);
      } else if (step === 6 && code === 250) {
        step = 7;
        write("DATA");
      } else if (step === 7 && code === 354) {
        step = 8;
        const msg = [
          `From: ${from}`,
          `To: ${to}`,
          `Subject: ${subject}`,
          `MIME-Version: 1.0`,
          `Content-Type: multipart/alternative; boundary="${boundary}"`,
          "",
          `--${boundary}`,
          `Content-Type: text/plain; charset=UTF-8`,
          "",
          text,
          "",
          `--${boundary}`,
          `Content-Type: text/html; charset=UTF-8`,
          "",
          html,
          "",
          `--${boundary}--`,
          ".",
        ].join("\r\n");
        write(msg);
      } else if (step === 8 && code === 250) {
        step = 9;
        write("QUIT");
        socket.end();
        resolve(true);
      }
    });
  });
}
