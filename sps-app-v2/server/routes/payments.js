const express = require("express");
const db = require("../db");
const { requireAuth } = require("../auth");
const gateway = require("../payments");
const notifications = require("../notifications");
const { bookingWithJoins } = require("./bookings");

const router = express.Router();

function appBaseUrl() {
  return process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:3000";
}

function canAccessBooking(req, booking) {
  if (req.user.role === "admin") return true;
  if (req.user.role === "customer") return booking.customer_id === req.user.id;
  if (req.user.role === "technician") return booking.technician_id === req.user.id;
  return false;
}

/**
 * Shared outcome handler for both the real Moyasar webhook and the mock
 * checkout's "complete" endpoint - whichever gateway mode is active, this is
 * the single place that turns "gateway says X" into DB updates + technician
 * email. Idempotent: calling it twice with the same already-applied outcome
 * is a no-op for the DB update (still returns ok), and only emails once
 * (guarded by the payment.status !== 'paid' check).
 */
async function applyPaymentOutcome(gatewayId, gatewayStatus) {
  const payment = db.prepare("SELECT * FROM payments WHERE moyasar_payment_id = ?").get(gatewayId);
  if (!payment) return { ok: false, error: "Payment not found." };

  if (gatewayStatus === "paid") {
    if (payment.status !== "paid") {
      db.prepare("UPDATE payments SET status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(payment.id);

      const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(payment.booking_id);

      if (payment.type === "deposit") {
        db.prepare("UPDATE bookings SET deposit_status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .run(booking.id);
      } else if (payment.type === "final" && payment.invoice_id) {
        db.prepare("UPDATE invoices SET status = 'Paid' WHERE id = ?").run(payment.invoice_id);
      }

      const bookingForEmail = bookingWithJoins(booking.id);

      // Customer always gets a receipt-style confirmation, regardless of
      // whether a technician is assigned yet.
      await notifications.sendCustomerPaymentNotification(bookingForEmail, {
        type: payment.type,
        amount: payment.amount,
      });

      if (booking.technician_id) {
        const technician = db.prepare("SELECT * FROM users WHERE id = ?").get(booking.technician_id);
        await notifications.sendPaymentNotification(bookingForEmail, technician, {
          type: payment.type,
          amount: payment.amount,
        });
      }
    }
  } else if (["failed", "expired", "cancelled"].includes(gatewayStatus)) {
    db.prepare("UPDATE payments SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(payment.id);
  }

  return { ok: true, payment: db.prepare("SELECT * FROM payments WHERE id = ?").get(payment.id) };
}

// ---------------------------------------------------------------------------
// DEPOSIT - create a checkout session for the booking's deposit
// ---------------------------------------------------------------------------
router.post("/payments/deposit/:bookingId", requireAuth(["customer", "admin"]), async (req, res) => {
  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(req.params.bookingId);
  if (!booking) return res.status(404).json({ error: "Booking not found." });
  if (!canAccessBooking(req, booking)) return res.status(403).json({ error: "You do not have access to this booking." });

  if (booking.deposit_status === "paid") {
    return res.status(409).json({ error: "Deposit has already been paid for this booking." });
  }
  if (booking.deposit_status === "waived") {
    return res.status(409).json({ error: "The deposit for this booking has been waived." });
  }

  try {
    const invoice = await gateway.createInvoice({
      amountSar: booking.deposit_amount,
      description: `Deposit for booking #${booking.id}`,
      callbackUrl: `${appBaseUrl()}/payment-callback.html?booking_id=${booking.id}&type=deposit`,
      metadata: { booking_id: String(booking.id), type: "deposit" },
    });

    db.prepare(`
      INSERT INTO payments (booking_id, type, amount, currency, moyasar_payment_id, status)
      VALUES (?, 'deposit', ?, 'SAR', ?, 'initiated')
    `).run(booking.id, booking.deposit_amount, invoice.id);

    res.json({ checkout_url: invoice.url, payment_reference: invoice.id, mock: gateway.isMock() });
  } catch (err) {
    if (err.code === "PAYMENTS_NOT_CONFIGURED") {
      return res.status(503).json({ error: "Online payments are not configured yet. Please contact the office." });
    }
    console.error("Deposit checkout creation failed:", err.message);
    res.status(502).json({ error: "Could not start the payment. Please try again shortly." });
  }
});

// ---------------------------------------------------------------------------
// FINAL PAYMENT - only after Completed, against invoice.amount_due
// ---------------------------------------------------------------------------
router.post("/payments/final/:bookingId", requireAuth(["customer", "admin"]), async (req, res) => {
  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(req.params.bookingId);
  if (!booking) return res.status(404).json({ error: "Booking not found." });
  if (!canAccessBooking(req, booking)) return res.status(403).json({ error: "You do not have access to this booking." });

  if (booking.status !== "Completed") {
    return res.status(409).json({ error: "Final payment is only available once the job is Completed." });
  }

  const invoice = db.prepare("SELECT * FROM invoices WHERE booking_id = ?").get(booking.id);
  if (!invoice) return res.status(404).json({ error: "No invoice exists for this booking yet." });
  if (invoice.status === "Paid" || invoice.amount_due <= 0) {
    return res.status(409).json({ error: "This invoice is already fully paid." });
  }

  try {
    const gatewayInvoice = await gateway.createInvoice({
      amountSar: invoice.amount_due,
      description: `Final payment for booking #${booking.id} (invoice ${invoice.invoice_number})`,
      callbackUrl: `${appBaseUrl()}/payment-callback.html?booking_id=${booking.id}&type=final`,
      metadata: { booking_id: String(booking.id), invoice_id: String(invoice.id), type: "final" },
    });

    db.prepare(`
      INSERT INTO payments (booking_id, invoice_id, type, amount, currency, moyasar_payment_id, status)
      VALUES (?, ?, 'final', ?, 'SAR', ?, 'initiated')
    `).run(booking.id, invoice.id, invoice.amount_due, gatewayInvoice.id);

    res.json({ checkout_url: gatewayInvoice.url, payment_reference: gatewayInvoice.id, mock: gateway.isMock() });
  } catch (err) {
    if (err.code === "PAYMENTS_NOT_CONFIGURED") {
      return res.status(503).json({ error: "Online payments are not configured yet. Please contact the office." });
    }
    console.error("Final payment checkout creation failed:", err.message);
    res.status(502).json({ error: "Could not start the payment. Please try again shortly." });
  }
});

// ---------------------------------------------------------------------------
// STATUS CHECK - frontend polls this after redirect back from checkout
// ---------------------------------------------------------------------------
router.get("/payments/:id", requireAuth(), (req, res) => {
  const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(req.params.id);
  if (!payment) return res.status(404).json({ error: "Payment not found." });

  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(payment.booking_id);
  if (!canAccessBooking(req, booking)) return res.status(403).json({ error: "You do not have access to this payment." });

  res.json(payment);
});

// ---------------------------------------------------------------------------
// REAL WEBHOOK (used only when PAYMENT_MODE=moyasar) - the only trusted
// source of "payment succeeded" in real mode. Moyasar appends
// ?secret_token=... to this URL as configured in their dashboard.
// ---------------------------------------------------------------------------
router.post("/payments/webhook", express.json(), async (req, res) => {
  if (!gateway.verifyWebhookRequest(req)) {
    return res.status(401).json({ error: "Invalid webhook signature." });
  }

  // Acknowledge quickly - Moyasar retries on non-200, which could
  // double-process if we made it wait on slow downstream work like email.
  res.status(200).json({ received: true });

  try {
    const payload = req.body || {};
    const data = payload.data || payload;
    const gatewayId = data.id;
    const gatewayStatus = (data.status || payload.status || "").toLowerCase();
    if (!gatewayId) return;
    await applyPaymentOutcome(gatewayId, gatewayStatus);
  } catch (err) {
    console.error("Error processing payment webhook:", err.message);
  }
});

// ---------------------------------------------------------------------------
// MOCK COMPLETE (dev-only, used only when PAYMENT_MODE=mock) - called by
// mock-checkout.html when the tester clicks "Pay" or "Simulate Failure".
// Stands in for the real gateway's webhook call, using the exact same
// outcome-handling logic. Automatically disabled (404) outside mock mode, so
// there is no way to reach this once PAYMENT_MODE=moyasar is set.
// ---------------------------------------------------------------------------
router.post("/payments/mock/:paymentRef/complete", express.json(), async (req, res) => {
  if (!gateway.isMock()) return res.status(404).json({ error: "Not found." });

  const { status } = req.body;
  if (!["paid", "failed"].includes(status)) {
    return res.status(400).json({ error: "status must be 'paid' or 'failed'." });
  }

  const result = await applyPaymentOutcome(req.params.paymentRef, status);
  if (!result.ok) return res.status(404).json({ error: result.error });
  res.json({ ok: true, payment: result.payment });
});

// ---------------------------------------------------------------------------
// REFUND (admin only, manual trigger)
// ---------------------------------------------------------------------------
router.post("/payments/:id/refund", requireAuth(["admin"]), async (req, res) => {
  const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(req.params.id);
  if (!payment) return res.status(404).json({ error: "Payment not found." });
  if (payment.status !== "paid") return res.status(409).json({ error: "Only a paid payment can be refunded." });

  try {
    await gateway.refundPayment(payment.moyasar_payment_id, payment.amount);
    db.prepare("UPDATE payments SET status = 'refunded', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(payment.id);
    res.json(db.prepare("SELECT * FROM payments WHERE id = ?").get(payment.id));
  } catch (err) {
    if (err.code === "PAYMENTS_NOT_CONFIGURED") {
      return res.status(503).json({ error: "Online payments are not configured yet." });
    }
    console.error("Refund failed:", err.message);
    res.status(502).json({ error: "Refund could not be processed. Please try again shortly." });
  }
});

module.exports = router;