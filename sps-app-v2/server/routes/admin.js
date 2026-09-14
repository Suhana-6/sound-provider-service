const express = require("express");
const db = require("../db");
const { requireAuth } = require("../auth");

const router = express.Router();

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
