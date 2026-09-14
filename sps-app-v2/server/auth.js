/**
 * Auth layer: bcrypt password hashing + token-based sessions.
 *
 * Sessions are still an in-memory Map (lost on restart, single-process only) -
 * this was an explicit non-goal to change in this rebuild pass. Passwords,
 * however, are now bcrypt-hashed (v1 stored them in plain text - fixed here).
 */

const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const sessions = new Map(); // token -> { id, email, name, role, createdAt }
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const SALT_ROUNDS = 10;

function hashPassword(plain) {
  return bcrypt.hashSync(plain, SALT_ROUNDS);
}

function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

function createSession(user) {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: Date.now(),
  });
  return token;
}

function getSession(token) {
  const session = sessions.get(token);
  if (!session) return null;

  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function destroySession(token) {
  sessions.delete(token);
}

/**
 * Express middleware factory.
 * requireAuth() - any logged-in user.
 * requireAuth(['admin']) - only that role.
 * requireAuth(['technician', 'admin']) - either role.
 */
function requireAuth(allowedRoles = null) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: "Authentication required. Please log in." });
    }

    const session = getSession(token);
    if (!session) {
      return res.status(401).json({ error: "Session expired or invalid. Please log in again." });
    }

    if (allowedRoles && !allowedRoles.includes(session.role)) {
      return res.status(403).json({ error: "You do not have permission to perform this action." });
    }

    req.user = session;
    next();
  };
}

module.exports = {
  hashPassword, verifyPassword,
  createSession, getSession, destroySession, requireAuth,
};
