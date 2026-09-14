const express = require("express");
const db = require("../db");
const { requireAuth } = require("../auth");
const v = require("../validators");

const router = express.Router();

function isTechnicianBooked(technicianId, date, time, excludeBookingId = null) {
  if (!technicianId || !date || !time) return false;
  const row = db.prepare(`
    SELECT COUNT(*) AS c FROM bookings
    WHERE technician_id = ?
      AND service_date = ?
      AND service_time = ?
      AND status IN ('Pending','In Progress')
      AND (? IS NULL OR id != ?)
  `).get(technicianId, date, time, excludeBookingId, excludeBookingId);
  return row.c > 0;
}

function techniciansWithSpecialty(serviceId) {
  return db.prepare(`
    SELECT u.* FROM users u
    JOIN technician_specialties ts ON ts.user_id = u.id
    WHERE u.role = 'technician' AND ts.specialty = ? AND u.tech_status = 'Available'
  `).all(serviceId);
}

function attachSpecialties(technicians) {
  return technicians.map((t) => {
    const specialties = db.prepare(
      "SELECT specialty FROM technician_specialties WHERE user_id = ?"
    ).all(t.id).map((r) => r.specialty);
    const { password_hash: _ph, ...safe } = t;
    return { ...safe, specialties };
  });
}

// Technicians available for a given service + date/time, filtered by specialty.
// Used during customer booking flow's Technician Selection screen.
router.get("/technicians/available", (req, res) => {
  const { service_id, date, time } = req.query;

  if (!service_id || !["door", "window", "repair"].includes(service_id)) {
    return res.status(400).json({ error: "A valid service_id is required." });
  }

  const candidates = techniciansWithSpecialty(service_id);

  if (!date || !time) {
    return res.json(attachSpecialties(candidates));
  }

  const dateErr = v.validateServiceDate(date);
  const timeErr = v.validateServiceTime(time);
  if (dateErr || timeErr) return res.status(400).json({ error: dateErr || timeErr });

  const free = candidates.filter((t) => !isTechnicianBooked(t.id, date, time));
  res.json(attachSpecialties(free));
});

// Admin-only: full technician roster.
router.get("/technicians", requireAuth(["admin"]), (req, res) => {
  const technicians = db.prepare("SELECT * FROM users WHERE role = 'technician'").all();
  res.json(attachSpecialties(technicians));
});

// Admin-only: edit technician profile fields and specialty assignments.
router.patch("/technicians/:id", requireAuth(["admin"]), (req, res) => {
  const targetId = Number(req.params.id);
  const technician = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'technician'").get(targetId);
  if (!technician) return res.status(404).json({ error: "Technician not found." });

  const name = req.body.name !== undefined ? req.body.name.trim() : technician.name;
  const email = req.body.email !== undefined ? req.body.email.trim().toLowerCase() : technician.email;
  const phone = req.body.phone !== undefined ? req.body.phone.trim() : technician.phone;
  const whatsapp = req.body.whatsapp !== undefined ? req.body.whatsapp.trim() : (technician.whatsapp || "");
  const status = req.body.tech_status !== undefined ? req.body.tech_status : technician.tech_status;

  const nameErr = v.validateName(name);
  if (nameErr) return res.status(400).json({ error: nameErr });

  const emailErr = v.validateEmail(email);
  if (emailErr) return res.status(400).json({ error: emailErr });

  const phoneErr = v.validatePhone(phone);
  if (phoneErr) return res.status(400).json({ error: phoneErr });

  if (whatsapp) {
    const whatsappErr = v.validatePhone(whatsapp);
    if (whatsappErr) return res.status(400).json({ error: `WhatsApp number: ${whatsappErr}` });
  }

  if (!["Available", "Busy"].includes(status)) {
    return res.status(400).json({ error: "Status must be 'Available' or 'Busy'." });
  }

  const emailConflict = db.prepare("SELECT id FROM users WHERE email = ? AND id != ?").get(email, targetId);
  if (emailConflict) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }

  const specialtyList = req.body.specialties !== undefined ? req.body.specialties : null;
  let specialtyErr = null;
  if (specialtyList !== null) {
    specialtyErr = v.validateSpecialties(specialtyList);
    if (specialtyErr) return res.status(400).json({ error: specialtyErr });
  }

  db.prepare("UPDATE users SET email = ?, name = ?, phone = ?, whatsapp = ?, tech_status = ? WHERE id = ?")
    .run(email, name, phone, whatsapp, status, targetId);

  if (specialtyList !== null) {
    db.prepare("DELETE FROM technician_specialties WHERE user_id = ?").run(targetId);
    const insertSpecialty = db.prepare(
      "INSERT INTO technician_specialties (user_id, specialty) VALUES (?, ?)"
    );
    for (const specialty of [...new Set(specialtyList)]) {
      insertSpecialty.run(targetId, specialty);
    }
  }

  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(targetId);
  res.json(attachSpecialties([updated])[0]);
});

// Technician toggles their own status; admin can override any technician's status.
router.patch("/technicians/:id/status", requireAuth(["technician", "admin"]), (req, res) => {
  const { status } = req.body;
  if (!["Available", "Busy"].includes(status)) {
    return res.status(400).json({ error: "Status must be 'Available' or 'Busy'." });
  }

  const targetId = Number(req.params.id);
  if (req.user.role === "technician" && req.user.id !== targetId) {
    return res.status(403).json({ error: "You can only change your own availability status." });
  }

  const technician = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'technician'").get(targetId);
  if (!technician) return res.status(404).json({ error: "Technician not found." });

  db.prepare("UPDATE users SET tech_status = ? WHERE id = ?").run(status, targetId);
  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(targetId);
  res.json(attachSpecialties([updated])[0]);
});

module.exports = { router, isTechnicianBooked, techniciansWithSpecialty, attachSpecialties };
