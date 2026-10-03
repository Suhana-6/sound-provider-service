/**
 * Email notifications sent through SMTP. If SMTP is not configured, messages
 * are logged instead of failing the request that triggered them.
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

async function sendNotification(to, subject, body, type) {
  if (!to) return;

  const t = getTransporter();
  if (!t) {
    console.log(`📧 [EMAIL DISABLED - would send] To: ${to}\nSubject: ${subject}\n${body}\n`);
    return;
  }

  try {
    await t.sendMail({
      from: process.env.EMAIL_FROM || "no-reply@soundprovider.com",
      to,
      subject,
      text: body,
    });
  } catch (err) {
    console.error(`Failed to send ${type} email:`, err.message);
  }
}

async function sendWelcomeNotification(user) {
  if (!user || !user.email) return;

  await sendNotification(
    user.email,
    "Welcome to Sound Provider Service",
    [
      `Hi ${user.name},`,
      "",
      `Your ${user.role} account has been created successfully.`,
      "You can now log in to Sound Provider Service to manage your account.",
    ].join("\n"),
    "welcome"
  );
}

async function sendBookingNotification(booking) {
  if (!booking || !booking.customer_email) return;

  await sendNotification(
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
  if (!technician || !technician.email) return;

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

  await sendNotification(technician.email, subject, body, "technician payment notification");
}

/**
 * booking: the booking row (needs customer_email - see bookingWithJoins)
 * payment: { type: 'deposit'|'final', amount }
 */
async function sendCustomerPaymentNotification(booking, payment) {
  if (!booking || !booking.customer_email) return;

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

  await sendNotification(booking.customer_email, subject, body, "customer payment notification");
}

module.exports = {
  isConfigured,
  sendWelcomeNotification,
  sendBookingNotification,
  sendPaymentNotification,
  sendCustomerPaymentNotification,
};
