const express = require("express");
const db = require("../db");
const { requireAuth } = require("../auth");
const notifications = require("../notifications");
const v = require("../validators");
const { calculatePrice, calculateDeposit, VAT_RATE } = require("../pricing");
const { isTechnicianBooked } = require("./technicians");

const router = express.Router();

const STATUS_TRANSITIONS = {
  Pending: ["In Progress", "Cancelled"],
  "In Progress": ["Completed"],
  Completed: [],
  Cancelled: [],
};

function recordStatusChange(bookingId, fromStatus, toStatus, changedByUserId) {
  db.prepare(`
    INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by_user_id)
    VALUES (?,?,?,?)
  `).run(bookingId, fromStatus, toStatus, changedByUserId || null);
}

function bookingWithJoins(id) {
  return db.prepare(`
    SELECT b.*, s.name AS service_name,
           t.name AS technician_name, t.email AS technician_email,
           c.email AS customer_email
    FROM bookings b
    LEFT JOIN services s ON s.id = b.service_id
    LEFT JOIN users t ON t.id = b.technician_id
    LEFT JOIN users c ON c.id = b.customer_id
    WHERE b.id = ?
  `).get(id);
}

function buildInvoiceForBooking(booking) {
  const existing = db.prepare("SELECT * FROM invoices WHERE booking_id = ?").get(booking.id);
  if (existing) return existing; // idempotent

  const { amount } = calculatePrice(db, booking);
  const vat = Number((amount * VAT_RATE).toFixed(2));
  const total = Number((amount + vat).toFixed(2));

  const depositPaid = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS s FROM payments
    WHERE booking_id = ? AND type = 'deposit' AND status = 'paid'
  `).get(booking.id).s;

  const amountDue = Math.max(0, Number((total - depositPaid).toFixed(2)));
  const invoiceNumber = "SP" + String(Date.now()).slice(-6) + String(booking.id).padStart(3, "0");

  const info = db.prepare(`
    INSERT INTO invoices (booking_id, invoice_number, amount, vat, total, amount_due, currency, status)
    VALUES (?,?,?,?,?,?, 'SAR', 'Unpaid')
  `).run(booking.id, invoiceNumber, amount, vat, total, amountDue);

  return db.prepare("SELECT * FROM invoices WHERE id = ?").get(info.lastInsertRowid);
}

// ---------------------------------------------------------------------------
// LIST / READ
// ---------------------------------------------------------------------------

// Admin: full booking list.
router.get("/bookings", requireAuth(["admin"]), (req, res) => {
  const rows = db.prepare(`
    SELECT b.*, s.name AS service_name, t.name AS technician_name
    FROM bookings b
    LEFT JOIN services s ON s.id = b.service_id
    LEFT JOIN users t ON t.id = b.technician_id
    ORDER BY b.created_at DESC
  `).all();
  res.json(rows);
});

// Customer: own bookings.
router.get("/bookings/mine", requireAuth(["customer"]), (req, res) => {
  const rows = db.prepare(`
    SELECT b.*, s.name AS service_name, t.name AS technician_name,
           i.total AS invoice_total, i.amount_due AS invoice_amount_due,
           i.status AS invoice_status
    FROM bookings b
    LEFT JOIN services s ON s.id = b.service_id
    LEFT JOIN users t ON t.id = b.technician_id
    LEFT JOIN invoices i ON i.booking_id = b.id
    WHERE b.customer_id = ?
    ORDER BY b.created_at DESC
  `).all(req.user.id);
  res.json(rows);
});

// Technician: bookings assigned to me.
router.get("/bookings/assigned", requireAuth(["technician"]), (req, res) => {
  const rows = db.prepare(`
    SELECT b.*, s.name AS service_name,
           i.id AS invoice_id,
           i.invoice_number,
           i.status AS invoice_status,
           i.amount_due AS invoice_amount_due,
           i.total AS invoice_total
    FROM bookings b
    LEFT JOIN services s ON s.id = b.service_id
    LEFT JOIN invoices i ON i.booking_id = b.id
    WHERE b.technician_id = ?
    ORDER BY b.created_at DESC
  `).all(req.user.id);
  res.json(rows);
});

// Technician: unassigned Pending bookings matching my specialties (Available Jobs).
router.get("/bookings/available-jobs", requireAuth(["technician"]), (req, res) => {
  const specialties = db.prepare(
    "SELECT specialty FROM technician_specialties WHERE user_id = ?"
  ).all(req.user.id).map((r) => r.specialty);

  if (!specialties.length) return res.json([]);

  const placeholders = specialties.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT b.*, s.name AS service_name
    FROM bookings b
    LEFT JOIN services s ON s.id = b.service_id
    WHERE b.status = 'Pending' AND b.technician_id IS NULL AND b.service_id IN (${placeholders})
    ORDER BY b.created_at ASC
  `).all(...specialties);
  res.json(rows);
});

router.get("/bookings/:id", requireAuth(), (req, res) => {
  const booking = bookingWithJoins(req.params.id);
  if (!booking) return res.status(404).json({ error: "Booking not found." });

  if (req.user.role === "customer" && booking.customer_id !== req.user.id) {
    return res.status(403).json({ error: "You do not have access to this booking." });
  }
  if (req.user.role === "technician" && booking.technician_id !== req.user.id) {
    return res.status(403).json({ error: "You do not have access to this booking." });
  }
  res.json(booking);
});

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------
router.post("/bookings", requireAuth(["customer"]), async (req, res) => {
  const isRepair = req.body.service_id === "repair";
  const errors = v.validateBookingPayload(req.body, isRepair);
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  const {
    service_id, customer_name, phone, quantity,
    location, item_type, description, problem,
    service_date, service_time, technician_id,
  } = req.body;

  let assignedBy = null;
  if (technician_id) {
    const technician = db.prepare(
      "SELECT * FROM users WHERE id = ? AND role = 'technician'"
    ).get(technician_id);
    if (!technician) return res.status(400).json({ error: "Selected technician does not exist." });
    if (technician.tech_status !== "Available") {
      return res.status(409).json({ error: "Selected technician is not currently available." });
    }
    const hasSpecialty = db.prepare(
      "SELECT 1 FROM technician_specialties WHERE user_id = ? AND specialty = ?"
    ).get(technician_id, service_id);
    if (!hasSpecialty) {
      return res.status(400).json({ error: "Selected technician does not offer this service." });
    }
    if (isTechnicianBooked(technician_id, service_date, service_time)) {
      return res.status(409).json({ error: "This technician is already booked at the selected date and time." });
    }
    assignedBy = "customer_pick";
  }

  const depositAmount = calculateDeposit(db, { service_id, quantity });

  const stmt = db.prepare(`
    INSERT INTO bookings
      (customer_id, service_id, customer_name, phone, quantity, location, item_type,
       description, problem, service_date, service_time, technician_id, assigned_by,
       status, deposit_amount, deposit_status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'Pending', ?, 'unpaid')
  `);

  const info = stmt.run(
    req.user.id, service_id, customer_name.trim(), phone.trim(),
    isRepair ? null : Number(quantity), location.trim(), item_type ? item_type.trim() : null,
    description ? description.trim() : null, isRepair ? problem : null,
    service_date, service_time, technician_id || null, assignedBy, depositAmount
  );

  recordStatusChange(info.lastInsertRowid, null, "Pending", req.user.id);

  const booking = bookingWithJoins(info.lastInsertRowid);
  await notifications.sendBookingNotification(booking);
  res.status(201).json(booking);
});

// ---------------------------------------------------------------------------
// EDIT (owner only, while Pending)
// ---------------------------------------------------------------------------
router.patch("/bookings/:id", requireAuth(["customer"]), (req, res) => {
  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(req.params.id);
  if (!booking) return res.status(404).json({ error: "Booking not found." });
  if (booking.customer_id !== req.user.id) {
    return res.status(403).json({ error: "You do not have access to this booking." });
  }
  if (booking.status !== "Pending") {
    return res.status(409).json({ error: `This booking can no longer be edited (status: ${booking.status}).` });
  }

  const merged = { ...booking, ...req.body };
  const isRepair = merged.service_id === "repair";
  const errors = v.validateBookingPayload(merged, isRepair);
  if (errors.length) return res.status(400).json({ error: errors[0], errors });

  if (merged.technician_id && (
    merged.technician_id !== booking.technician_id ||
    merged.service_date !== booking.service_date ||
    merged.service_time !== booking.service_time
  )) {
    if (isTechnicianBooked(merged.technician_id, merged.service_date, merged.service_time, booking.id)) {
      return res.status(409).json({ error: "This technician is already booked at the selected date and time." });
    }
  }

  db.prepare(`
    UPDATE bookings SET
      customer_name = ?, phone = ?, quantity = ?, location = ?, item_type = ?,
      description = ?, problem = ?, service_date = ?, service_time = ?, technician_id = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    merged.customer_name.trim(), merged.phone.trim(),
    isRepair ? null : Number(merged.quantity), merged.location.trim(),
    merged.item_type ? merged.item_type.trim() : null,
    merged.description ? merged.description.trim() : null,
    isRepair ? merged.problem : null,
    merged.service_date, merged.service_time, merged.technician_id || null,
    booking.id
  );

  res.json(bookingWithJoins(booking.id));
});

// ---------------------------------------------------------------------------
// CANCEL (owner or admin, while Pending)
// ---------------------------------------------------------------------------
router.post("/bookings/:id/cancel", requireAuth(["customer", "admin"]), (req, res) => {
  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(req.params.id);
  if (!booking) return res.status(404).json({ error: "Booking not found." });

  if (req.user.role === "customer" && booking.customer_id !== req.user.id) {
    return res.status(403).json({ error: "You do not have access to this booking." });
  }
  if (!STATUS_TRANSITIONS[booking.status].includes("Cancelled")) {
    return res.status(409).json({ error: `A booking with status '${booking.status}' can no longer be cancelled.` });
  }

  db.prepare(`
    UPDATE bookings SET status = 'Cancelled', cancelled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(booking.id);
  recordStatusChange(booking.id, booking.status, "Cancelled", req.user.id);

  res.json(bookingWithJoins(booking.id));
});

// ---------------------------------------------------------------------------
// ASSIGN (admin - any technician, any specialty) / REASSIGN
// ---------------------------------------------------------------------------
router.patch("/bookings/:id/assign", requireAuth(["admin"]), (req, res) => {
  const { technician_id } = req.body;
  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(req.params.id);
  if (!booking) return res.status(404).json({ error: "Booking not found." });

  if (["Completed", "Cancelled"].includes(booking.status)) {
    return res.status(409).json({ error: `Cannot reassign a booking that is ${booking.status}.` });
  }

  const technician = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'technician'").get(technician_id);
  if (!technician) return res.status(400).json({ error: "Selected technician does not exist." });
  if (isTechnicianBooked(technician_id, booking.service_date, booking.service_time, booking.id)) {
    return res.status(409).json({ error: "This technician is already booked at that date and time." });
  }

  db.prepare(
    "UPDATE bookings SET technician_id = ?, assigned_by = 'admin', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(technician_id, booking.id);

  res.json(bookingWithJoins(booking.id));
});

// ---------------------------------------------------------------------------
// SELF-CLAIM (technician claims an unassigned Pending booking matching specialty)
// ---------------------------------------------------------------------------
router.post("/bookings/:id/claim", requireAuth(["technician"]), (req, res) => {
  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(req.params.id);
  if (!booking) return res.status(404).json({ error: "Booking not found." });

  if (booking.status !== "Pending") {
    return res.status(409).json({ error: "Only Pending, unassigned bookings can be claimed." });
  }
  if (booking.technician_id) {
    return res.status(409).json({ error: "This booking is already assigned to a technician." });
  }

  const hasSpecialty = db.prepare(
    "SELECT 1 FROM technician_specialties WHERE user_id = ? AND specialty = ?"
  ).get(req.user.id, booking.service_id);
  if (!hasSpecialty) {
    return res.status(403).json({ error: "This booking is outside your registered specialties." });
  }

  if (isTechnicianBooked(req.user.id, booking.service_date, booking.service_time, booking.id)) {
    return res.status(409).json({ error: "You already have another booking at that date and time." });
  }

  db.prepare(
    "UPDATE bookings SET technician_id = ?, assigned_by = 'self_claim', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  ).run(req.user.id, booking.id);

  res.json(bookingWithJoins(booking.id));
});

// ---------------------------------------------------------------------------
// STATUS PROGRESSION (assigned technician or admin)
// ---------------------------------------------------------------------------
router.patch("/bookings/:id/status", requireAuth(["technician", "admin"]), (req, res) => {
  const { status: toStatus } = req.body;
  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(req.params.id);
  if (!booking) return res.status(404).json({ error: "Booking not found." });

  if (req.user.role === "technician" && booking.technician_id !== req.user.id) {
    return res.status(403).json({ error: "You are not assigned to this booking." });
  }

  const allowedNext = STATUS_TRANSITIONS[booking.status] || [];
  if (!allowedNext.includes(toStatus)) {
    return res.status(409).json({
      error: `Cannot move a booking from '${booking.status}' to '${toStatus}'. Allowed next step(s): ${allowedNext.join(", ") || "none"}.`,
    });
  }

  if (toStatus === "In Progress") {
    if (!booking.technician_id) {
      return res.status(400).json({ error: "A technician must be assigned before work can start." });
    }
    if (!["paid", "waived"].includes(booking.deposit_status)) {
      return res.status(409).json({ error: "Deposit not yet paid. An admin can waive this to proceed." });
    }
  }

  const startTime = toStatus === "In Progress" ? new Date().toISOString() : null;
  const endTime = toStatus === "Completed" ? new Date().toISOString() : null;

  db.prepare(`
    UPDATE bookings SET status = ?, start_time = COALESCE(?, start_time), end_time = COALESCE(?, end_time), updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(toStatus, startTime, endTime, booking.id);

  recordStatusChange(booking.id, booking.status, toStatus, req.user.id);

  let invoice = null;
  if (toStatus === "Completed") {
    const freshBooking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(booking.id);
    invoice = buildInvoiceForBooking(freshBooking);
  }

  res.json({ booking: bookingWithJoins(booking.id), invoice });
});

// ---------------------------------------------------------------------------
// WAIVE DEPOSIT (admin only)
// ---------------------------------------------------------------------------
router.patch("/bookings/:id/waive-deposit", requireAuth(["admin"]), (req, res) => {
  const booking = db.prepare("SELECT * FROM bookings WHERE id = ?").get(req.params.id);
  if (!booking) return res.status(404).json({ error: "Booking not found." });
  if (booking.deposit_status === "paid") {
    return res.status(409).json({ error: "Deposit has already been paid; no need to waive it." });
  }

  db.prepare("UPDATE bookings SET deposit_status = 'waived', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(booking.id);

  res.json(bookingWithJoins(booking.id));
});

module.exports = { router, buildInvoiceForBooking, bookingWithJoins };
