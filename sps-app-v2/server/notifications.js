/**
 * Technician email notifications, sent when a deposit or final payment clears.
 *
 * Uses Nodemailer over SMTP - works with any provider (Brevo's free tier,
 * Gmail SMTP for local dev, etc). If SMTP isn't configured, notifications are
 * logged to the console instead of failing the request that triggered them -
 * email delivery must never block a webhook or the payment flow itself.
 */

const nodemailer = require("nodemailer");

function isConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
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

/**
 * booking: the booking row (with service_name joined in, if available)
 * technician: the users row for the assigned technician
 * payment: { type: 'deposit'|'final', amount }
 */
async function sendPaymentNotification(booking, technician, payment) {
  if (!technician || !technician.email) return; // no one to notify

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

  const t = getTransporter();
  if (!t) {
    console.log(`📧 [EMAIL DISABLED - would send] To: ${technician.email}\nSubject: ${subject}\n${body}\n`);
    return;
  }

  try {
    await t.sendMail({
      from: process.env.EMAIL_FROM || "no-reply@soundprovider.com",
      to: technician.email,
      subject,
      text: body,
    });
  } catch (err) {
    // Never let email failure break the caller (e.g. a webhook handler) -
    // log it for manual follow-up instead.
    console.error("Failed to send technician notification email:", err.message);
  }
}

/**
 * booking: the booking row (needs customer_email - see bookingWithJoins)
 * payment: { type: 'deposit'|'final', amount }
 */
async function sendCustomerPaymentNotification(booking, payment) {
  if (!booking || !booking.customer_email) return; // no address to send to

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

  const t = getTransporter();
  if (!t) {
    console.log(`📧 [EMAIL DISABLED - would send] To: ${booking.customer_email}\nSubject: ${subject}\n${body}\n`);
    return;
  }

  try {
    await t.sendMail({
      from: process.env.EMAIL_FROM || "no-reply@soundprovider.com",
      to: booking.customer_email,
      subject,
      text: body,
    });
  } catch (err) {
    // Never let email failure break the caller (e.g. a webhook handler) -
    // log it for manual follow-up instead.
    console.error("Failed to send customer notification email:", err.message);
  }
}

module.exports = { isConfigured, sendPaymentNotification, sendCustomerPaymentNotification };
