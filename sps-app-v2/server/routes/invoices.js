const express = require("express");
const db = require("../db");
const { requireAuth } = require("../auth");

const router = express.Router();

function canAccessInvoice(req, invoice) {
  if (req.user.role === "admin") return true;
  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(invoice.booking_id);
  if (!booking) return false;
  if (req.user.role === "customer") return booking.customer_id === req.user.id;
  if (req.user.role === "technician") return booking.technician_id === req.user.id;
  return false;
}

router.get("/invoices", requireAuth(["admin"]), (req, res) => {
  res.json(db.prepare("SELECT * FROM invoices ORDER BY created_at DESC").all());
});

router.get("/invoices/:id", requireAuth(), (req, res) => {
  const invoice = db.prepare("SELECT * FROM invoices WHERE id = ?").get(req.params.id);
  if (!invoice) return res.status(404).json({ error: "Invoice not found." });
  if (!canAccessInvoice(req, invoice)) return res.status(403).json({ error: "You do not have access to this invoice." });
  res.json(invoice);
});

router.get("/invoices/by-booking/:bookingId", requireAuth(), (req, res) => {
  const invoice = db.prepare("SELECT * FROM invoices WHERE booking_id = ?").get(req.params.bookingId);
  if (!invoice) return res.status(404).json({ error: "No invoice exists for this booking yet." });
  if (!canAccessInvoice(req, invoice)) return res.status(403).json({ error: "You do not have access to this invoice." });
  res.json(invoice);
});

// Manual override for staff (e.g. customer paid cash on-site) - separate from
// the gateway-verified webhook path, admin-only.
router.patch("/invoices/:id/status", requireAuth(["admin"]), (req, res) => {
  const { status } = req.body;
  const valid = ["Unpaid", "Paid"];
  if (!valid.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${valid.join(", ")}` });
  }
  const invoice = db.prepare("SELECT * FROM invoices WHERE id = ?").get(req.params.id);
  if (!invoice) return res.status(404).json({ error: "Invoice not found." });

  db.prepare("UPDATE invoices SET status = ? WHERE id = ?").run(status, req.params.id);
  res.json(db.prepare("SELECT * FROM invoices WHERE id = ?").get(req.params.id));
});

module.exports = router;
