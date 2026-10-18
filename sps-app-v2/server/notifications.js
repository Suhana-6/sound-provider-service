/**
 * Uses Brevo's HTTPS API when configured (suitable for Render free services),
 * and SMTP for local development or hosts that allow outbound SMTP.
 */
const axios = require("axios");
const nodemailer = require("nodemailer");

function missingConfiguration() {
  if (process.env.NODE_ENV === "production" || process.env.BREVO_API_KEY) {
    const missing = [];
    if (!process.env.BREVO_API_KEY) missing.push("BREVO_API_KEY");
    if (!process.env.EMAIL_FROM) missing.push("EMAIL_FROM");
    return missing;
  }
  return ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"]
    .filter((key) => !process.env[key]);
}

function isConfigured() {
  return missingConfiguration().length === 0;
}

let transporter = null;
function getTransporter() {
  if (!isConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      tls: process.env.SMTP_ALLOW_SELF_SIGNED === "true" ? { rejectUnauthorized: false } : undefined,
    });
  }
  return transporter;
}

async function sendNotification(to, subject, body, type) {
  if (!to) return false;

  const missing = missingConfiguration();
  if (missing.length) {
    console.error(`Email not sent; missing configuration: ${missing.join(", ")}`);
    return false;
  }

  try {
    let messageId;
    if (process.env.NODE_ENV === "production" || process.env.BREVO_API_KEY) {
      const sender = /^(.*?)\s*<([^<>]+)>$/.exec(process.env.EMAIL_FROM);
      const response = await axios.post(
        "https://api.brevo.com/v3/smtp/email",
        {
          sender: sender
            ? { name: sender[1].replace(/^["']|["']$/g, "").trim(), email: sender[2].trim() }
            : { email: process.env.EMAIL_FROM.trim() },
          to: [{ email: to }],
          subject,
          textContent: body,
        },
        { headers: { "api-key": process.env.BREVO_API_KEY }, timeout: 10000 }
      );
      messageId = response.data.messageId;
    } else {
      const result = await getTransporter().sendMail({
        from: process.env.EMAIL_FROM || "no-reply@soundprovider.com",
        to,
        subject,
        text: body,
      });
      messageId = result.messageId;
    }
    console.log(`Sent ${type} email. Message ID: ${messageId}`);
    return true;
  } catch (err) {
    const providerMessage = err.response && err.response.data && err.response.data.message;
    console.error(`Failed to send ${type} email:`, providerMessage || err.message);
    return false;
  }
}

async function sendWelcomeNotification(user) {
  if (!user || !user.email) return false;

  return sendNotification(
    user.email,
    "Welcome to Project Sound Company",
    [
      `Hi ${user.name},`,
      "",
      `Your ${user.role} account has been created successfully.`,
      "You can now log in to Project Sound Company to manage your account.",
    ].join("\n"),
    "welcome"
  );
}

async function sendBookingNotification(booking) {
  if (!booking || !booking.customer_email) return false;

  return sendNotification(
    booking.customer_email,
    `Booking received - Booking #${booking.id}`,
    [
      `Hi ${booking.customer_name},`,
      "",
      `We've received your booking request (#${booking.id}).`,
      `Service: ${booking.service_name || booking.service_id}`,
      `Location: ${booking.location}`,
      `Scheduled: ${booking.service_date} at ${booking.service_time}`,
      `Deposit: SAR ${Number(booking.deposit_amount).toFixed(2)}`,
      "",
      "You can log in to view your booking and its status.",
    ].join("\n"),
    "booking"
  );
}

/**
 * booking: the booking row (with service_name joined in, if available)
 * technician: the users row for the assigned technician
 * payment: { type: 'deposit'|'final', amount }
 */
async function sendPaymentNotification(booking, technician, payment) {
  if (!technician || !technician.email) return false;

  const subject = payment.type === "deposit"
    ? `Deposit received - Booking #${booking.id}`
    : `Final payment received - Booking #${booking.id}`;

  const body = [
    `Hi ${technician.name},`,
    "",
    payment.type === "deposit"
      ? `The deposit for booking #${booking.id} has been paid (SAR ${payment.amount.toFixed(2)}).`
      : `The final payment for booking #${booking.id} has been paid (SAR ${payment.amount.toFixed(2)}). The job is now fully settled.`,
    "",
    `Customer: ${booking.customer_name}`,
    `Service: ${booking.service_name || booking.service_id}`,
    `Location: ${booking.location}`,
    `Scheduled: ${booking.service_date} at ${booking.service_time}`,
  ].join("\n");

  return sendNotification(technician.email, subject, body, "technician payment notification");
}

/**
 * booking: the booking row (needs customer_email - see bookingWithJoins)
 * payment: { type: 'deposit'|'final', amount }
 */
async function sendCustomerPaymentNotification(booking, payment) {
  if (!booking || !booking.customer_email) return false;

  const subject = payment.type === "deposit"
    ? `Your deposit was received - Booking #${booking.id}`
    : `Your payment was received - Booking #${booking.id}`;

  const body = [
    `Hi ${booking.customer_name},`,
    "",
    payment.type === "deposit"
      ? `We've received your deposit of SAR ${payment.amount.toFixed(2)} for booking #${booking.id}. A technician will be in touch before your appointment.`
      : `We've received your final payment of SAR ${payment.amount.toFixed(2)} for booking #${booking.id}. Your job is now fully settled - thank you!`,
    "",
    `Service: ${booking.service_name || booking.service_id}`,
    `Location: ${booking.location}`,
    `Scheduled: ${booking.service_date} at ${booking.service_time}`,
  ].join("\n");

  return sendNotification(booking.customer_email, subject, body, "customer payment notification");
}

module.exports = {
  isConfigured,
  sendWelcomeNotification,
  sendBookingNotification,
  sendPaymentNotification,
  sendCustomerPaymentNotification,
};
