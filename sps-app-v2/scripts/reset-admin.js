/**
 * One-off CLI to create-or-reset the admin account without touching any
 * other data. Run manually whenever admin login is broken (lost password,
 * wrong value shipped to .env, etc) - normal server startup will NOT do
 * this for you (see server/db.js seedAdmin, which only fires once, ever).
 *
 * Usage:
 *   node scripts/reset-admin.js
 *
 * Reads ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME / ADMIN_PHONE from .env
 * (same variables used at first boot). If an admin with that email already
 * exists, its password/name/phone are updated in place. Otherwise a new
 * admin row is inserted. Existing bookings, customers, technicians, etc.
 * are untouched.
 */

require("dotenv").config();
const path = require("path");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");

const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME, ADMIN_PHONE } = process.env;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !ADMIN_NAME || !ADMIN_PHONE) {
  console.error(
    "❌ ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME and ADMIN_PHONE must all be set in .env before running this script."
  );
  process.exit(1);
}

if (ADMIN_PASSWORD.length < 8 || !/[A-Za-z]/.test(ADMIN_PASSWORD) || !/[0-9]/.test(ADMIN_PASSWORD)) {
  console.error("❌ ADMIN_PASSWORD must be at least 8 characters and include a letter and a number.");
  process.exit(1);
}

const DB_PATH = path.join(__dirname, "..", "data.sqlite3");
const db = new Database(DB_PATH);

const email = ADMIN_EMAIL.trim().toLowerCase();
const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);

const existingByEmail = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

if (existingByEmail) {
  if (existingByEmail.role !== "admin") {
    console.error(
      `❌ A ${existingByEmail.role} account already uses ${email}. Choose a different ADMIN_EMAIL or free up that address first.`
    );
    process.exit(1);
  }
  db.prepare(
    "UPDATE users SET password_hash = ?, name = ?, phone = ? WHERE id = ?"
  ).run(hash, ADMIN_NAME, ADMIN_PHONE, existingByEmail.id);
  console.log(`✅ Existing admin (${email}) password/name/phone reset.`);
} else {
  // Handles both "no admin exists yet" and "admin exists under a different email"
  // (in the latter case this simply adds a second admin login - both will work).
  db.prepare(
    "INSERT INTO users (email, password_hash, name, phone, role) VALUES (?,?,?,?,'admin')"
  ).run(email, hash, ADMIN_NAME, ADMIN_PHONE);
  console.log(`✅ New admin account created: ${email}`);
}

console.log("You can now log in with the ADMIN_EMAIL / ADMIN_PASSWORD currently in your .env.");
