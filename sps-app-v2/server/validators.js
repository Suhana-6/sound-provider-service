/**
 * Centralized input validation.
 * Every function returns null when valid, or an error message string when invalid.
 */

const WORK_START = "10:00";
const WORK_END = "18:00";
const HOLIDAY_DAY = 5; // Friday
const MAX_QUANTITY = 20;
const REPAIR_PROBLEMS = [
  "Broken Door", "Broken Window", "Door Not Opening", "Door Not Closing",
  "Sensor Problem", "Motor Problem", "Glass Damage", "Other",
];
const SPECIALTIES = ["door", "window", "repair"];

function isNonEmptyString(v, { min = 1, max = 500 } = {}) {
  return typeof v === "string" && v.trim().length >= min && v.trim().length <= max;
}

function validateEmail(email) {
  if (!isNonEmptyString(email, { min: 5, max: 200 })) return "Email is required.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "Please enter a valid email address.";
  return null;
}

// v2: minimum 8 characters, at least one letter and one number (v1 allowed a 4-char minimum).
function validatePassword(password) {
  if (!isNonEmptyString(password, { min: 8, max: 200 })) {
    return "Password must be at least 8 characters.";
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must include at least one letter and one number.";
  }
  return null;
}

function validateConfirmPassword(password, confirmPassword) {
  if (password !== confirmPassword) return "Passwords do not match.";
  return null;
}

function validatePhone(phone) {
  if (!isNonEmptyString(phone, { min: 7, max: 20 })) return "A valid contact number is required.";
  const cleaned = phone.replace(/[\s-]/g, "");
  if (!/^\+?[0-9]{7,15}$/.test(cleaned)) return "Contact number format is invalid.";
  return null;
}

function validateName(name) {
  if (!isNonEmptyString(name, { min: 2, max: 100 })) return "Name must be between 2 and 100 characters.";
  return null;
}

function validateLocation(location) {
  if (!isNonEmptyString(location, { min: 3, max: 200 })) return "Service location must be between 3 and 200 characters.";
  return null;
}

function validateQuantity(quantity) {
  const n = Number(quantity);
  if (!Number.isInteger(n) || n < 1 || n > MAX_QUANTITY) {
    return `Quantity must be a whole number between 1 and ${MAX_QUANTITY}.`;
  }
  return null;
}

function validateProblem(problem) {
  if (!REPAIR_PROBLEMS.includes(problem)) {
    return `Problem must be one of: ${REPAIR_PROBLEMS.join(", ")}.`;
  }
  return null;
}

function validateServiceDate(dateStr) {
  if (!isNonEmptyString(dateStr, { min: 8, max: 10 }) || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return "A valid service date (YYYY-MM-DD) is required.";
  }
  const date = new Date(dateStr + "T12:00:00");
  if (isNaN(date.getTime())) return "Service date is not a valid calendar date.";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (date < today) return "Service date cannot be in the past.";

  if (date.getDay() === HOLIDAY_DAY) return "Friday is a holiday. Please select another day.";

  return null;
}

function validateServiceTime(timeStr) {
  if (!isNonEmptyString(timeStr, { min: 4, max: 5 }) || !/^\d{2}:\d{2}$/.test(timeStr)) {
    return "A valid service time (HH:MM) is required.";
  }
  if (timeStr < WORK_START || timeStr > WORK_END) {
    return `Working time is ${WORK_START} to ${WORK_END}.`;
  }
  return null;
}

function validateOptionalText(value, max = 1000) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > max) {
    return `Text must be no more than ${max} characters.`;
  }
  return null;
}

function validateSpecialties(specialties) {
  if (!Array.isArray(specialties) || specialties.length === 0) {
    return "Select at least one specialty.";
  }
  const invalid = specialties.filter((s) => !SPECIALTIES.includes(s));
  if (invalid.length) {
    return `Specialties must be one of: ${SPECIALTIES.join(", ")}.`;
  }
  return null;
}

/**
 * Validates a registration payload. `role` is 'customer' or 'technician'.
 * Returns an array of error strings (empty array = valid).
 */
function validateRegistrationPayload(body, role) {
  const errors = [];

  const nameErr = validateName(body.name);
  if (nameErr) errors.push(nameErr);

  const emailErr = validateEmail(body.email);
  if (emailErr) errors.push(emailErr);

  const phoneErr = validatePhone(body.phone);
  if (phoneErr) errors.push(phoneErr);

  const passErr = validatePassword(body.password);
  if (passErr) errors.push(passErr);

  const confirmErr = validateConfirmPassword(body.password, body.confirm_password);
  if (confirmErr) errors.push(confirmErr);

  if (role === "technician") {
    const whatsappErr = validatePhone(body.whatsapp);
    if (whatsappErr) errors.push(`WhatsApp number: ${whatsappErr}`);

    const specialtiesErr = validateSpecialties(body.specialties);
    if (specialtiesErr) errors.push(specialtiesErr);
  }

  return errors;
}

/**
 * Validates a full booking payload. `isRepair` changes which fields are required.
 */
function validateBookingPayload(body, isRepair) {
  const errors = [];

  const nameErr = validateName(body.customer_name);
  if (nameErr) errors.push(nameErr);

  const phoneErr = validatePhone(body.phone);
  if (phoneErr) errors.push(phoneErr);

  const locationErr = validateLocation(body.location);
  if (locationErr) errors.push(locationErr);

  if (!body.service_id || !["door", "window", "repair"].includes(body.service_id)) {
    errors.push("A valid service_id is required.");
  }

  if (isRepair) {
    const problemErr = validateProblem(body.problem);
    if (problemErr) errors.push(problemErr);
  } else {
    const qtyErr = validateQuantity(body.quantity);
    if (qtyErr) errors.push(qtyErr);
  }

  const dateErr = validateServiceDate(body.service_date);
  if (dateErr) errors.push(dateErr);

  const timeErr = validateServiceTime(body.service_time);
  if (timeErr) errors.push(timeErr);

  const descErr = validateOptionalText(body.description, 1000);
  if (descErr) errors.push(descErr);

  const itemTypeErr = validateOptionalText(body.item_type, 100);
  if (itemTypeErr) errors.push(itemTypeErr);

  return errors;
}

module.exports = {
  WORK_START, WORK_END, HOLIDAY_DAY, MAX_QUANTITY, REPAIR_PROBLEMS, SPECIALTIES,
  validateEmail, validatePassword, validateConfirmPassword, validatePhone, validateName,
  validateLocation, validateQuantity, validateProblem, validateServiceDate,
  validateServiceTime, validateOptionalText, validateSpecialties,
  validateRegistrationPayload, validateBookingPayload,
};
