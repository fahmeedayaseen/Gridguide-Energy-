import sgMail from "@sendgrid/mail";

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
if (SENDGRID_API_KEY) sgMail.setApiKey(SENDGRID_API_KEY);

const FROM = { email: process.env.FROM_EMAIL || "noreply@gridguide.ai", name: "GridGuide" };
const BASE  = process.env.NEXT_PUBLIC_APP_URL || "https://gridguide.ai";

// ─── Generic send — for ad-hoc internal notifications that don't fit a fixed
// template (e.g. an internal sales alert). Prefer a specific named function
// above for anything user-facing and repeated. ──────────────────────────────
export async function sendEmail({ to, subject, text, html }) {
  return send(to, subject, html || `<pre style="font-family:sans-serif;white-space:pre-wrap">${text}</pre>`, text);
}

// ─── Core send helper ─────────────────────────────────────────────────────────
async function send(to, subject, html, text) {
  if (process.env.NODE_ENV === "development") {
    console.log(`[Email DEV] To: ${to} | Subject: ${subject}`);
    return { success: true, dev: true };
  }
  try {
    if (!SENDGRID_API_KEY) throw new Error("SENDGRID_API_KEY is not configured");
    const [response] = await sgMail.send({ to, from: FROM, subject, html, text });
    const providerId = response?.headers?.["x-message-id"] || null;
    return { success: true, providerId };
  } catch (err) {
    console.error("[Email] SendGrid error:", err.response?.body || err.message);
    // Throw so callers (campaign send, delivery worker) can persist the failure
    const emailError = new Error(err.message || "Email send failed");
    emailError.statusCode = err.code || err.response?.statusCode;
    emailError.response   = err.response?.body;
    throw emailError;
  }
}

// ─── Email verification ────────────────────────────────────────────────────────
export async function sendVerificationEmail(user, token) {
  const url = `${BASE}/verify-email?token=${token}`;
  return send(
    user.email,
    "Verify your GridGuide account",
    `<div style="font-family:sans-serif;max-width:520px;margin:0 auto">
      <h2 style="color:#00D4AA">Welcome to GridGuide, ${user.name}!</h2>
      <p>Please verify your email to activate your account.</p>
      <a href="${url}" style="display:inline-block;background:#00D4AA;color:#0A0F1E;padding:12px 28px;border-radius:8px;font-weight:700;text-decoration:none;margin:16px 0">
        Verify Email
      </a>
      <p style="color:#666;font-size:13px">Link expires in 24 hours. If you didn't create an account, ignore this email.</p>
    </div>`,
    `Welcome to GridGuide, ${user.name}! Verify your email: ${url}`
  );
}

// ─── Password reset ───────────────────────────────────────────────────────────
export async function sendPasswordResetEmail(user, token) {
  const url = `${BASE}/reset-password?token=${token}`;
  return send(
    user.email,
    "Reset your GridGuide password",
    `<div style="font-family:sans-serif;max-width:520px;margin:0 auto">
      <h2 style="color:#00D4AA">Password Reset</h2>
      <p>We received a request to reset your password for <strong>${user.email}</strong>.</p>
      <a href="${url}" style="display:inline-block;background:#00D4AA;color:#0A0F1E;padding:12px 28px;border-radius:8px;font-weight:700;text-decoration:none;margin:16px 0">
        Reset Password
      </a>
      <p style="color:#666;font-size:13px">This link expires in 1 hour. If you didn't request a reset, you can safely ignore this email.</p>
    </div>`,
    `Reset your GridGuide password: ${url}`
  );
}

// ─── Order confirmation ────────────────────────────────────────────────────────
export async function sendOrderConfirmation(user, order) {
  const itemsList = order.items
    .map(i => `<li>${i.product.name} × ${i.quantity} — $${(i.price * i.quantity).toFixed(2)}</li>`)
    .join("");
  return send(
    user.email,
    `GridGuide Order Confirmed — #${order.id.slice(-8).toUpperCase()}`,
    `<div style="font-family:sans-serif;max-width:520px;margin:0 auto">
      <h2 style="color:#00D4AA">Order Confirmed ✓</h2>
      <p>Hi ${user.name}, your order has been confirmed.</p>
      <ul>${itemsList}</ul>
      <p><strong>Total: $${order.total.toFixed(2)}</strong></p>
      <a href="${BASE}/platform?tab=orders" style="display:inline-block;background:#00D4AA;color:#0A0F1E;padding:12px 28px;border-radius:8px;font-weight:700;text-decoration:none;margin:16px 0">
        View Order
      </a>
    </div>`,
    `Order confirmed: $${order.total.toFixed(2)}. View at ${BASE}/platform?tab=orders`
  );
}

// ─── VPP payout ───────────────────────────────────────────────────────────────
export async function sendVppPayoutEmail(user, payout, event) {
  return send(
    user.email,
    `VPP Payout Sent — $${payout.netAmount.toFixed(2)} from ${event.name}`,
    `<div style="font-family:sans-serif;max-width:520px;margin:0 auto">
      <h2 style="color:#00D4AA">⚡ VPP Earnings Sent</h2>
      <p>Hi ${user.name}, your earnings from <strong>${event.name}</strong> have been sent to your bank account.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr style="border-bottom:1px solid #eee"><td style="padding:8px;color:#666">Event</td><td style="padding:8px;font-weight:600">${event.name}</td></tr>
        <tr style="border-bottom:1px solid #eee"><td style="padding:8px;color:#666">Energy dispatched</td><td style="padding:8px">${payout.kwhDispatched} kWh</td></tr>
        <tr style="border-bottom:1px solid #eee"><td style="padding:8px;color:#666">Gross reward</td><td style="padding:8px">$${payout.grossAmount.toFixed(2)}</td></tr>
        <tr style="border-bottom:1px solid #eee"><td style="padding:8px;color:#666">GridGuide fee (10%)</td><td style="padding:8px;color:#e55">−$${payout.fee.toFixed(2)}</td></tr>
        <tr><td style="padding:8px;color:#666"><strong>Net to you</strong></td><td style="padding:8px;color:#00D4AA;font-weight:700;font-size:18px">$${payout.netAmount.toFixed(2)}</td></tr>
      </table>
      <p style="color:#666;font-size:13px">ACH transfers typically settle in 1–2 business days depending on your bank.</p>
      <a href="${BASE}/platform?tab=vpp" style="display:inline-block;background:#00D4AA;color:#0A0F1E;padding:12px 28px;border-radius:8px;font-weight:700;text-decoration:none;margin:16px 0">
        View VPP Dashboard
      </a>
    </div>`,
    `VPP payout of $${payout.netAmount.toFixed(2)} sent from ${event.name}.`
  );
}

// ─── Installer lead alert ──────────────────────────────────────────────────────
export async function sendLeadAlert(installer, lead) {
  return send(
    installer.user.email,
    `New Lead: ${lead.projectType} in ${lead.address.split(",")[1] || lead.address}`,
    `<div style="font-family:sans-serif;max-width:520px;margin:0 auto">
      <h2 style="color:#00D4AA">🔧 New Lead Assigned</h2>
      <p>Hi ${installer.companyName}, you have a new project lead.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr style="border-bottom:1px solid #eee"><td style="padding:8px;color:#666">Project type</td><td style="padding:8px;font-weight:600">${lead.projectType}</td></tr>
        <tr style="border-bottom:1px solid #eee"><td style="padding:8px;color:#666">Location</td><td style="padding:8px">${lead.address}</td></tr>
        ${lead.estimatedValue ? `<tr style="border-bottom:1px solid #eee"><td style="padding:8px;color:#666">Est. value</td><td style="padding:8px;font-weight:600;color:#F5C842">$${lead.estimatedValue.toLocaleString()}</td></tr>` : ""}
      </table>
      <a href="${BASE}/portals/installer?tab=leads" style="display:inline-block;background:#00D4AA;color:#0A0F1E;padding:12px 28px;border-radius:8px;font-weight:700;text-decoration:none;margin:16px 0">
        View Lead
      </a>
    </div>`,
    `New lead: ${lead.projectType} at ${lead.address}`
  );
}

// ─── Seller product approved ───────────────────────────────────────────────────
export async function sendProductApproved(seller, product) {
  return send(
    seller.user.email,
    `Your product "${product.name}" is now live on GridGuide`,
    `<div style="font-family:sans-serif;max-width:520px;margin:0 auto">
      <h2 style="color:#F5C842">🏪 Product Approved!</h2>
      <p>Hi ${seller.businessName}, your product listing is now live on the GridGuide Marketplace.</p>
      <p style="font-size:18px;font-weight:700">${product.name}</p>
      <p>Price: <strong>$${product.price.toLocaleString()}</strong></p>
      <a href="${BASE}/portals/seller?tab=products" style="display:inline-block;background:#F5C842;color:#0A0F1E;padding:12px 28px;border-radius:8px;font-weight:700;text-decoration:none;margin:16px 0">
        View Your Listings
      </a>
    </div>`,
    `Your product "${product.name}" is now live on GridGuide Marketplace.`
  );
}

// ─── Seller payout ────────────────────────────────────────────────────────────
export async function sendSellerPayout(seller, payout) {
  return send(
    seller.user.email,
    `GridGuide Payout — $${payout.netAmount.toFixed(2)} sent`,
    `<div style="font-family:sans-serif;max-width:520px;margin:0 auto">
      <h2 style="color:#F5C842">💰 Payout Sent</h2>
      <p>Hi ${seller.businessName}, your payout has been transferred to your Stripe account.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr style="border-bottom:1px solid #eee"><td style="padding:8px;color:#666">Sale amount</td><td style="padding:8px">$${payout.grossAmount.toFixed(2)}</td></tr>
        <tr style="border-bottom:1px solid #eee"><td style="padding:8px;color:#666">Commission (${(payout.commission/payout.grossAmount*100).toFixed(0)}%)</td><td style="padding:8px;color:#e55">−$${payout.commission.toFixed(2)}</td></tr>
        <tr style="border-bottom:1px solid #eee"><td style="padding:8px;color:#666">Processing fee</td><td style="padding:8px;color:#e55">−$${payout.processingFee.toFixed(2)}</td></tr>
        <tr><td style="padding:8px;color:#666"><strong>Net payout</strong></td><td style="padding:8px;color:#F5C842;font-weight:700;font-size:18px">$${payout.netAmount.toFixed(2)}</td></tr>
      </table>
    </div>`,
    `Payout of $${payout.netAmount.toFixed(2)} sent.`
  );
}

// ─── Enterprise homeowner invite (Phase 2) ──────────────────────────────────────
export async function sendHomeownerInvite(emailAddr, org, token, options = {}) {
  // Fix 2: suppression check before send
  const suppressed = await isSuppressed(emailAddr).catch(() => null);
  if (suppressed) {
    const err = new Error(`Email suppressed: ${emailAddr}`);
    err.suppressed = true;
    throw err;
  }

  // Fix 2: accept click-tracker URL from delivery worker
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://gridguide.ai';
  const inviteUrl = options.clickUrl ?? `${baseUrl}/invite/homeowner/${token}`;

  // Fix 2: issue unsubscribe token for CAN-SPAM compliance
  const unsubToken = await issueUnsubscribeToken(emailAddr).catch(() => null);
  const unsubUrl = unsubToken
    ? `${baseUrl}/unsubscribe/${unsubToken}`
    : `${baseUrl}/preferences/email`;

  return send(
    emailAddr,
    options.subject || `${org.name} invited you to GridGuide`,
    `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
      <div style="background:#0D1526;border-radius:12px;padding:28px;margin-bottom:20px">
        <h2 style="color:#06B6D4;font-family:sans-serif;margin:0 0 8px">${org.name}</h2>
        <p style="color:#8890A8;font-size:13px;margin:0">invited you to manage your energy with GridGuide</p>
      </div>
      <p style="color:#555;font-size:14px;line-height:1.7;">
        <strong>${org.name}</strong> has invited you to connect your home energy account with GridGuide —
        monitor solar production, track battery storage, manage EV charging, and discover rebates.
        Your account is free to start.
      </p>
      <div style="text-align:center;margin:28px 0">
        <a href="${inviteUrl}"
           style="background:#06B6D4;color:#0A0F1E;padding:14px 32px;border-radius:10px;
                  text-decoration:none;font-weight:700;font-size:15px;display:inline-block">
          View Invitation →
        </a>
      </div>
      <p style="color:#888;font-size:12px;text-align:center">
        This invitation expires in 30 days. If you don't recognize ${org.name}, you can safely ignore this email.
      </p>
      <p style="color:#aaa;font-size:11px;text-align:center;margin-top:8px">
        <a href="${unsubUrl}" style="color:#aaa">Unsubscribe from GridGuide emails</a>
      </p>
    </div>`,
    `${org.name} invited you to GridGuide. View: ${inviteUrl} (expires in 30 days). Unsubscribe: ${unsubUrl}`
  );
}

export async function sendInstallerInvite(to, { installerName, inviteUrl, landingUrl, firstName, subject, body }) {
  // Check suppression before any send attempt
  const suppressed = await isSuppressed(to).catch(() => null);
  if (suppressed) {
    const err = new Error(`Email suppressed: ${to}`);
    err.suppressed = true;
    throw err;
  }

  const resolvedLandingUrl = landingUrl || inviteUrl; // landingUrl = page; inviteUrl = click tracker
  const greeting = firstName ? `Hi ${firstName},` : 'Hi there,';
  const customBody = body
    ? `<p style="color:#666;font-size:14px;line-height:1.7;">${body.replace(/\n/g, '<br/>')}</p>`
    : '';

  // Issue an unsubscribe token for CAN-SPAM compliance
  const unsubToken = await issueUnsubscribeToken(to).catch(() => null);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://gridguide.ai';
  const unsubUrl = unsubToken ? `${baseUrl}/unsubscribe/${unsubToken}` : `${baseUrl}/preferences/email`;

  return send(
    to,
    subject || `${installerName} invited you to GridGuide`,
    `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
      <div style="background:#0D1526;border-radius:12px;padding:28px;margin-bottom:20px">
        <h2 style="color:#06B6D4;font-family:sans-serif;margin:0 0 8px">
          ${installerName}
        </h2>
        <p style="color:#8890A8;font-size:13px;margin:0">
          invited you to manage your energy system with GridGuide
        </p>
      </div>
      <p style="color:#333;font-size:15px;">${greeting}</p>
      ${customBody}
      <p style="color:#555;font-size:14px;line-height:1.7;">
        Your installer, <strong>${installerName}</strong>, uses GridGuide to help their customers
        monitor solar production, track battery storage, manage EV charging, and discover
        rebates — all in one place. Your account is free to start.
      </p>
      <div style="text-align:center;margin:28px 0">
        <a href="${inviteUrl}"
           style="background:#06B6D4;color:#0A0F1E;padding:14px 32px;border-radius:10px;
                  text-decoration:none;font-weight:700;font-size:15px;display:inline-block">
          Accept Invitation →
        </a>
      </div>
      <p style="color:#888;font-size:12px;text-align:center">
        This invitation was sent by ${installerName} through GridGuide.
        If you didn't request this, you can safely ignore this email.
      </p>
      <p style="color:#aaa;font-size:11px;text-align:center">
        <a href="${landingUrl}?action=decline" style="color:#aaa">Decline this invitation</a>
        &nbsp;·&nbsp;
        <a href="${unsubUrl}" style="color:#aaa">Unsubscribe from all GridGuide emails</a>
      </p>
    </div>`
  );
}

// ─── Enterprise account provisioned ─────────────────────────────────────────────
export async function sendEnterpriseAccountProvisioned(user, org, setupToken) {
  const setupUrl = `${BASE}/reset-password?token=${setupToken}`;
  return send(
    user.email,
    `Your GridGuide Business account is ready — ${org.name}`,
    `<div style="font-family:sans-serif;max-width:520px;margin:0 auto">
      <h2 style="color:#7B5CF5">Welcome to GridGuide Business</h2>
      <p><strong>${org.name}</strong> has been approved and your Enterprise Portal account is ready.</p>
      <p>Set your password to get started:</p>
      <a href="${setupUrl}" style="display:inline-block;background:#7B5CF5;color:#fff;padding:12px 28px;border-radius:8px;font-weight:700;text-decoration:none;margin:16px 0">
        Set Your Password
      </a>
      <p style="color:#888;font-size:12px">This link expires in 1 hour. Once set, sign in at the Enterprise Portal with this email address.</p>
    </div>`,
    `${org.name} has been approved. Set your password: ${setupUrl} (expires in 1 hour)`
  );
}

// ─── Enterprise team invite ─────────────────────────────────────────────────────
export async function sendTeamInvite(member, org, inviterName, token) {
  const acceptUrl = `${BASE}/invite/team/${token}`;
  return send(
    member.email,
    `You've been invited to ${org.name} on GridGuide`,
    `<div style="font-family:sans-serif;max-width:520px;margin:0 auto">
      <h2 style="color:#7B5CF5">You're invited!</h2>
      <p>${inviterName} invited you to join <strong>${org.name}</strong>'s GridGuide Business portal as a <strong>${member.role}</strong>.</p>
      <a href="${acceptUrl}" style="display:inline-block;background:#7B5CF5;color:#fff;padding:12px 28px;border-radius:8px;font-weight:700;text-decoration:none;margin:16px 0">
        Accept Invite
      </a>
      <p style="color:#888;font-size:12px">This invitation expires in 7 days.</p>
    </div>`,
    `${inviterName} invited you to join ${org.name}'s GridGuide Business portal as a ${member.role}. Accept: ${acceptUrl} (expires in 7 days)`
  );
}

// ─── Weekly energy digest ──────────────────────────────────────────────────────
export async function sendWeeklyDigest(user, stats) {
  return send(
    user.email,
    `Your GridGuide Weekly Energy Report`,
    `<div style="font-family:sans-serif;max-width:520px;margin:0 auto">
      <h2 style="color:#00D4AA">⚡ Weekly Energy Summary</h2>
      <p>Hi ${user.name}, here's how your home performed this week.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr style="border-bottom:1px solid #eee"><td style="padding:8px;color:#666">Solar produced</td><td style="padding:8px;font-weight:600;color:#F5C842">${stats.solarKwh} kWh</td></tr>
        <tr style="border-bottom:1px solid #eee"><td style="padding:8px;color:#666">Home consumed</td><td style="padding:8px">${stats.consumedKwh} kWh</td></tr>
        <tr style="border-bottom:1px solid #eee"><td style="padding:8px;color:#666">VPP earnings</td><td style="padding:8px;font-weight:600;color:#00D4AA">$${stats.vppEarnings.toFixed(2)}</td></tr>
        <tr><td style="padding:8px;color:#666">Energy savings</td><td style="padding:8px;font-weight:600;color:#22C55E">$${stats.savings.toFixed(2)}</td></tr>
      </table>
      <a href="${BASE}/platform" style="display:inline-block;background:#00D4AA;color:#0A0F1E;padding:12px 28px;border-radius:8px;font-weight:700;text-decoration:none;margin:16px 0">
        View Full Dashboard
      </a>
    </div>`,
    `Your GridGuide weekly summary: ${stats.solarKwh} kWh solar, $${stats.vppEarnings.toFixed(2)} VPP earnings.`
  );
}

// ─── Partner Invitation Email ──────────────────────────────────────────────
export async function sendPartnerInvitationEmail(invitation) {
  const appUrl    = process.env.NEXT_PUBLIC_APP_URL || "https://gridguide.ai";
  const url       = `${appUrl}/partner-invite/${invitation.token}`;
  const roleLabel = {
    INSTALLER:  "installer partner",
    ENTERPRISE: "enterprise organization",
    SELLER:     "marketplace seller",
  }[invitation.type] || "partner";

  return sendEmail({
    to:      invitation.email,
    subject: `You're invited to join GridGuide as a ${roleLabel}`,
    html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
      <div style="background:#0D1526;border-radius:12px;padding:28px;margin-bottom:20px">
        <h2 style="color:#06B6D4;margin:0 0 8px;font-size:22px">${invitation.companyName}</h2>
        <p style="color:#8890A8;font-size:13px;margin:0">
          has been invited to join GridGuide as a ${roleLabel}
        </p>
      </div>
      <p style="color:#555;font-size:14px;line-height:1.7">
        ${invitation.contactName ? `Hi ${invitation.contactName},<br/><br/>` : ""}
        GridGuide is inviting <strong>${invitation.companyName}</strong> to onboard
        as a <strong>${roleLabel}</strong>. Review and accept your invitation to begin
        the onboarding process.
      </p>
      ${invitation.assignedPlan ? `
        <div style="margin:16px 0;padding:12px 16px;background:#06B6D414;border-radius:8px;font-size:13px;color:#06B6D4">
          Assigned plan: <strong>${invitation.assignedPlan}</strong>
        </div>` : ""}
      <div style="text-align:center;margin:28px 0">
        <a href="${url}" style="background:#06B6D4;color:#0A0F1E;padding:14px 32px;
          border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block">
          Review Invitation →
        </a>
      </div>
      <p style="color:#888;font-size:12px;text-align:center">
        Expires ${invitation.expiresAt.toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}.
        Sent to ${invitation.email}.
      </p>
    </div>`,
    text: `${invitation.companyName} has been invited to join GridGuide as a ${roleLabel}. Accept: ${url}`,
  });
}
