const express = require("express");
const db = require("../db");
const { requireAuth, destroySessionsExcept } = require("../auth");

const router = express.Router();

router.delete("/admin/data", requireAuth(["admin"]), (req, res) => {
  if (!req.body || req.body.confirmation !== "CLEAR ALL DATA") {
    return res.status(400).json({ error: "Confirmation text did not match." });
  }

  const clearApplicationData = db.transaction(() => {
    for (const table of [
      "payments",
      "invoices",
      "booking_status_history",
      "bookings",
      "technician_specialties",
    ]) {
      db.prepare(`DELETE FROM "${table}"`).run();
    }

    db.prepare("DELETE FROM users WHERE role != 'admin'").run();

    const hasMeetingsTable = db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meetings'"
    ).get();
    if (hasMeetingsTable) db.prepare("DELETE FROM meetings").run();
  });

  clearApplicationData();
  destroySessionsExcept(req.user.id);
  console.log(`Application data cleared by administrator ${req.user.id}.`);
  res.json({ ok: true, message: "Customer, technician, booking, payment, invoice, and meeting data were cleared. The administrator account and service catalog were kept." });
});

router.get("/dashboard/stats", requireAuth(["admin"]), (req, res) => {
  const totalCustomers = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'customer'").get().c;
  const totalTechnicians = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'technician'").get().c;
  const todaysServices = db.prepare("SELECT COUNT(*) c FROM bookings WHERE date(created_at) = date('now')").get().c;
  const pending = db.prepare("SELECT COUNT(*) c FROM bookings WHERE status = 'Pending'").get().c;
  const inProgress = db.prepare("SELECT COUNT(*) c FROM bookings WHERE status = 'In Progress'").get().c;
  const completed = db.prepare("SELECT COUNT(*) c FROM bookings WHERE status = 'Completed'").get().c;
  const cancelled = db.prepare("SELECT COUNT(*) c FROM bookings WHERE status = 'Cancelled'").get().c;
  const unpaidDeposits = db.prepare("SELECT COUNT(*) c FROM bookings WHERE deposit_status = 'unpaid'").get().c;
  const todaysRevenue = db.prepare("SELECT COALESCE(SUM(total),0) t FROM invoices WHERE date(created_at) = date('now')").get().t;
  const pendingPayments = db.prepare("SELECT COALESCE(SUM(amount_due),0) t FROM invoices WHERE status = 'Unpaid'").get().t;

  res.json({
    totalCustomers, totalTechnicians, todaysServices,
    pending, inProgress, completed, cancelled, unpaidDeposits,
    todaysRevenue, pendingPayments,
    vatRate: 0.15,
  });
});

module.exports = router;
