const express = require("express");
const db = require("../db");
const { hashPassword, verifyPassword, createSession, destroySession, requireAuth } = require("../auth");
const notifications = require("../notifications");
const v = require("../validators");

const router = express.Router();

function nextEmployeeCode() {
  const row = db.prepare(
    "SELECT employee_code FROM users WHERE employee_code IS NOT NULL ORDER BY id DESC LIMIT 1"
  ).get();
  if (!row) return "SP101";
  const n = parseInt(row.employee_code.replace("SP", ""), 10) || 100;
  return "SP" + (n + 1);
}

// ---------------------------------------------------------------------------
// REGISTER (customer or technician only - admin is seeded separately)
// ---------------------------------------------------------------------------
router.post("/register", async (req, res) => {
  const role = req.body.role;
  if (!["customer", "technician"].includes(role)) {
    return res.status(400).json({ error: "Role must be 'customer' or 'technician'." });
  }

  const errors = v.validateRegistrationPayload(req.body, role);
  if (errors.length) {
    return res.status(400).json({ error: errors[0], errors });
  }

  const email = req.body.email.trim().toLowerCase();
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }

  const passwordHash = hashPassword(req.body.password);
  const name = req.body.name.trim();
  const phone = req.body.phone.trim();

  let userId;
  if (role === "customer") {
    const info = db.prepare(
      "INSERT INTO users (email, password_hash, name, phone, role) VALUES (?,?,?,?,'customer')"
    ).run(email, passwordHash, name, phone);
    userId = info.lastInsertRowid;
  } else {
    const employeeCode = nextEmployeeCode();
    const whatsapp = req.body.whatsapp.trim();
    const info = db.prepare(`
      INSERT INTO users (email, password_hash, name, phone, role, employee_code, whatsapp, tech_status)
      VALUES (?,?,?,?,'technician',?,?, 'Available')
    `).run(email, passwordHash, name, phone, employeeCode, whatsapp);
    userId = info.lastInsertRowid;

    const insertSpecialty = db.prepare(
      "INSERT INTO technician_specialties (user_id, specialty) VALUES (?, ?)"
    );
    for (const specialty of [...new Set(req.body.specialties)]) {
      insertSpecialty.run(userId, specialty);
    }
  }

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  const token = createSession(user);
  const { password_hash: _ph, ...safeUser } = user;

  if (role === "technician") {
    safeUser.specialties = db.prepare(
      "SELECT specialty FROM technician_specialties WHERE user_id = ?"
    ).all(userId).map((r) => r.specialty);
  }

  await notifications.sendWelcomeNotification(user);
  res.status(201).json({ user: safeUser, token });
});

// ---------------------------------------------------------------------------
// LOGIN (email + password only - role is looked up, not selected)
// ---------------------------------------------------------------------------
router.post("/login", (req, res) => {
  const { email, password } = req.body;

  const emailErr = v.validateEmail(email);
  if (emailErr) return res.status(400).json({ error: emailErr });
  if (typeof password !== "string" || password.length === 0) {
    return res.status(400).json({ error: "Password is required." });
  }

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.trim().toLowerCase());

  // Generic error either way - never reveal whether the email exists (avoids
  // account enumeration; v1 leaked this via role-specific error messages).
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  const token = createSession(user);
  const { password_hash: _ph, ...safeUser } = user;

  if (user.role === "technician") {
    safeUser.specialties = db.prepare(
      "SELECT specialty FROM technician_specialties WHERE user_id = ?"
    ).all(user.id).map((r) => r.specialty);
  }

  res.json({ user: safeUser, token });
});

router.post("/logout", requireAuth(), (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) destroySession(token);
  res.json({ ok: true });
});

router.get("/me", requireAuth(), (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  const { password_hash: _ph, ...safeUser } = user;
  if (user.role === "technician") {
    safeUser.specialties = db.prepare(
      "SELECT specialty FROM technician_specialties WHERE user_id = ?"
    ).all(user.id).map((r) => r.specialty);
  }
  res.json({ user: safeUser });
});

// ---------------------------------------------------------------------------
// PROFILE (view/edit own name & phone - customer "My Profile" screen, also
// usable by technicians/admin for the same basic fields)
// ---------------------------------------------------------------------------
router.patch("/me", requireAuth(), (req, res) => {
  const nameErr = req.body.name !== undefined ? v.validateName(req.body.name) : null;
  if (nameErr) return res.status(400).json({ error: nameErr });

  const phoneErr = req.body.phone !== undefined ? v.validatePhone(req.body.phone) : null;
  if (phoneErr) return res.status(400).json({ error: phoneErr });

  const current = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  const name = req.body.name !== undefined ? req.body.name.trim() : current.name;
  const phone = req.body.phone !== undefined ? req.body.phone.trim() : current.phone;

  let whatsapp = current.whatsapp;
  let specialtiesErr = null;
  if (current.role === "technician") {
    if (req.body.whatsapp !== undefined) {
      const wErr = v.validatePhone(req.body.whatsapp);
      if (wErr) return res.status(400).json({ error: `WhatsApp number: ${wErr}` });
      whatsapp = req.body.whatsapp.trim();
    }
    if (req.body.specialties !== undefined) {
      specialtiesErr = v.validateSpecialties(req.body.specialties);
      if (specialtiesErr) return res.status(400).json({ error: specialtiesErr });
    }
  }

  db.prepare("UPDATE users SET name = ?, phone = ?, whatsapp = ? WHERE id = ?")
    .run(name, phone, whatsapp, req.user.id);

  if (current.role === "technician" && req.body.specialties !== undefined) {
    db.prepare("DELETE FROM technician_specialties WHERE user_id = ?").run(req.user.id);
    const insertSpecialty = db.prepare(
      "INSERT INTO technician_specialties (user_id, specialty) VALUES (?, ?)"
    );
    for (const specialty of [...new Set(req.body.specialties)]) {
      insertSpecialty.run(req.user.id, specialty);
    }
  }

  const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  const { password_hash: _ph, ...safeUser } = updated;
  if (updated.role === "technician") {
    safeUser.specialties = db.prepare(
      "SELECT specialty FROM technician_specialties WHERE user_id = ?"
    ).all(updated.id).map((r) => r.specialty);
  }
  res.json({ user: safeUser });
});

module.exports = router;
