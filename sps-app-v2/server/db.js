const path = require("path");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, "..", "data.sqlite3");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ---------------------------------------------------------------------------
// Schema (fresh v2 design - see REBUILD_PLAN.md)
// ---------------------------------------------------------------------------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('customer','technician','admin')),
  employee_code TEXT UNIQUE,
  whatsapp TEXT,
  tech_status TEXT CHECK(tech_status IN ('Available','Busy')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS technician_specialties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  specialty TEXT NOT NULL CHECK(specialty IN ('door','window','repair')),
  UNIQUE(user_id, specialty)
);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  image TEXT,
  base_price REAL NOT NULL DEFAULT 0,
  price_per_unit REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES users(id),
  service_id TEXT NOT NULL REFERENCES services(id),
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  quantity INTEGER,
  location TEXT NOT NULL,
  item_type TEXT,
  description TEXT,
  problem TEXT,
  service_date TEXT NOT NULL,
  service_time TEXT NOT NULL,
  technician_id INTEGER REFERENCES users(id),
  assigned_by TEXT CHECK(assigned_by IN ('customer_pick','admin','self_claim')),
  status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','In Progress','Completed','Cancelled')),
  deposit_amount REAL DEFAULT 0,
  deposit_status TEXT NOT NULL DEFAULT 'unpaid' CHECK(deposit_status IN ('unpaid','paid','waived')),
  start_time TEXT,
  end_time TEXT,
  cancelled_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS booking_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_by_user_id INTEGER REFERENCES users(id),
  changed_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER REFERENCES bookings(id),
  invoice_number TEXT UNIQUE NOT NULL,
  amount REAL NOT NULL,
  vat REAL NOT NULL,
  total REAL NOT NULL,
  amount_due REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'SAR',
  status TEXT NOT NULL DEFAULT 'Unpaid' CHECK(status IN ('Unpaid','Paid')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  invoice_id INTEGER REFERENCES invoices(id),
  type TEXT NOT NULL CHECK(type IN ('deposit','final')),
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'SAR',
  moyasar_payment_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'initiated' CHECK(status IN ('initiated','paid','failed','refunded')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// ---------------------------------------------------------------------------
// Admin seeding (idempotent - only acts while no admin row exists)
// ---------------------------------------------------------------------------
function seedAdmin() {
  const existing = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get().c;
  if (existing > 0) return;

  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME, ADMIN_PHONE } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !ADMIN_NAME || !ADMIN_PHONE) {
    console.warn(
      "⚠️  No admin account exists yet, and ADMIN_EMAIL/ADMIN_PASSWORD/ADMIN_NAME/ADMIN_PHONE " +
      "are not fully set in the environment. Set them (see .env.example) and restart the " +
      "server to create the admin account."
    );
    return;
  }

  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  db.prepare(
    "INSERT INTO users (email, password_hash, name, phone, role) VALUES (?,?,?,?,'admin')"
  ).run(ADMIN_EMAIL.trim().toLowerCase(), hash, ADMIN_NAME, ADMIN_PHONE);
  console.log(`✅ Admin account created: ${ADMIN_EMAIL}`);
}

// ---------------------------------------------------------------------------
// Service catalog seed (idempotent)
// ---------------------------------------------------------------------------
function seedServices() {
  const count = db.prepare("SELECT COUNT(*) AS c FROM services").get().c;
  if (count > 0) return;

  const insert = db.prepare(
    "INSERT INTO services (id, name, description, image, base_price, price_per_unit) VALUES (?,?,?,?,?,?)"
  );
  insert.run(
    "door", "Automatic Door Service",
    "Automatic sliding doors, sensor doors, motorized doors, installation and maintenance.",
    "https://images.unsplash.com/photo-1511818966892-d7d671e672a2?auto=format&fit=crop&w=900&q=80",
    300, 450
  );
  insert.run(
    "window", "Automatic Window Service",
    "Motorized windows, automatic opening systems, installation and maintenance.",
    "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=80",
    300, 400
  );
  insert.run(
    "repair", "Broken Door / Window Repair",
    "Repair and replacement service for broken doors, windows, sensors and motors.",
    "https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=900&q=80",
    250, 0
  );
}

seedAdmin();
seedServices();

module.exports = db;
