/* ============================================================================
   Sound Provider Service - Frontend SPA (vanilla JS, no framework/build step)
   Pure presentation layer: every validation/business rule here mirrors the
   server for instant feedback, but the server is always the source of truth.
   ============================================================================ */

const root = document.getElementById("app");

let state = {
  user: null,
  screen: "login",
  authMode: "customer", // for register screen: 'customer' | 'technician'
  errors: {},
  loading: false,
  notice: null,

  services: [],
  bookingDraft: {},
  editingBookingId: null,
  priceQuote: null,
  availableTechnicians: [],

  myBookings: [],
  assignedJobs: [],
  availableJobs: [],
  techTab: "assigned", // 'assigned' | 'available'

  allBookings: [],
  allTechnicians: [],
  allInvoices: [],
  dashboardStats: null,
  editingTechnicianId: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function sar(amount) {
  return `SAR ${Number(amount || 0).toFixed(2)}`;
}

function statusClass(status) {
  return { Pending: "pending", "In Progress": "progress", Completed: "completed", Cancelled: "pending" }[status] || "pending";
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function setState(patch) {
  state = { ...state, ...patch };
  render();
}

// Screens that should re-fetch fresh data every time the user navigates to
// them (as opposed to once and cached) - keyed by the "loaded" flag to reset.
const REFRESH_ON_VISIT = {
  "customer-my-bookings": "_myBookingsLoaded",
  "tech-dashboard": "_techLoaded",
  "admin-dashboard": "_dashLoaded",
  "admin-bookings": "_bookingsLoaded",
  "admin-technicians": "_rosterLoaded",
  "admin-invoices": "_invoicesLoaded",
};

function goto(screen, patch = {}) {
  const resetFlag = REFRESH_ON_VISIT[screen];
  const reset = resetFlag ? { [resetFlag]: false } : {};
  setState({ screen, errors: {}, notice: null, ...reset, ...patch });
}

function fieldHtml({ id, label, type = "text", value = "", error, extra = "", full = false }) {
  const tag = type === "textarea"
    ? `<textarea id="${id}" ${extra}>${escapeHtml(value)}</textarea>`
    : type === "select"
      ? "" // selects are built by caller directly
      : `<input id="${id}" type="${type}" value="${escapeHtml(value)}" ${extra} />`;

  return `
    <div class="field ${full ? "full" : ""} ${error ? "invalid" : ""}">
      <label for="${id}">${label}</label>
      ${tag}
      <div class="field-error">${error ? escapeHtml(error) : ""}</div>
    </div>
  `;
}

function val(id) {
  const el = document.getElementById(id);
  return el ? el.value : "";
}

function checkedValues(name) {
  return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`)).map((el) => el.value);
}

async function withLoading(fn) {
  setState({ loading: true });
  try {
    await fn();
  } catch (err) {
    setState({ loading: false, notice: { type: "error", text: err.message } });
    return;
  }
  setState({ loading: false });
}

// ---------------------------------------------------------------------------
// Bootstrap: check for existing session
// ---------------------------------------------------------------------------
async function init() {
  const token = getToken();
  if (!token) return goto("login");

  try {
    const { user } = await api.me();
    setState({ user });
    routeHome();
  } catch (e) {
    setToken(null);
    goto("login");
  }
}

function routeHome() {
  if (!state.user) return goto("login");

  // If we just came back from a payment (see payment-callback.html), land
  // on the screen it asked for instead of the role's default home screen.
  const forced = localStorage.getItem("sps_redirect_screen");
  if (forced) {
    localStorage.removeItem("sps_redirect_screen");
    return goto(forced);
  }

  if (state.user.role === "customer") return goto("customer-services", { bookingDraft: {} });
  if (state.user.role === "technician") return goto("tech-dashboard", { techTab: "assigned" });
  if (state.user.role === "admin") return goto("admin-dashboard");
}

async function logout() {
  try { await api.logout(); } catch (e) { /* ignore */ }
  setToken(null);
  setState({
    user: null,
    screen: "login",
    errors: {},
    notice: null,
    bookingDraft: {},
    editingBookingId: null,
    priceQuote: null,
    availableTechnicians: [],
  });
}
window.logout = logout;

// ---------------------------------------------------------------------------
// AUTH SCREENS
// ---------------------------------------------------------------------------
function renderLogin() {
  return `
    <div class="auth-page">
      <div class="auth-box">
        <h1>Sound Provider Service</h1>
        <div class="subtitle">Log in to your account</div>
        ${noticeHtml()}
        ${fieldHtml({ id: "login-email", label: "Email", type: "email", error: state.errors.email })}
        ${fieldHtml({ id: "login-password", label: "Password", type: "password", error: state.errors.password })}
        <button class="btn block" ${state.loading ? "disabled" : ""} onclick="submitLogin()">
          ${state.loading ? "Logging in..." : "Log In"}
        </button>
        <div class="auth-switch">
          New customer? <a onclick="goto('register', {authMode:'customer'})">Register</a>
          &nbsp;|&nbsp;
          Technician? <a onclick="goto('register', {authMode:'technician'})">Register as Technician</a>
        </div>
      </div>
    </div>
  `;
}

async function submitLogin() {
  const email = val("login-email");
  const password = val("login-password");
  await withLoading(async () => {
    const { user, token } = await api.login(email, password);
    setToken(token);
    setState({ user });
    routeHome();
  });
}
window.submitLogin = submitLogin;

function renderRegister() {
  const isTech = state.authMode === "technician";
  return `
    <div class="auth-page">
      <div class="auth-box">
        <h1>Create an Account</h1>
        <div class="subtitle">Register as a ${isTech ? "technician" : "customer"}</div>

        <div class="role-tabs">
          <button class="${!isTech ? "active" : ""}" onclick="goto('register', {authMode:'customer'})">Customer</button>
          <button class="${isTech ? "active" : ""}" onclick="goto('register', {authMode:'technician'})">Technician</button>
        </div>

        ${noticeHtml()}
        ${fieldHtml({ id: "reg-name", label: "Full Name", error: state.errors.name })}
        ${fieldHtml({ id: "reg-email", label: "Email", type: "email", error: state.errors.email })}
        ${fieldHtml({ id: "reg-phone", label: "Phone Number", error: state.errors.phone })}
        ${isTech ? fieldHtml({ id: "reg-whatsapp", label: "WhatsApp Number", error: state.errors.whatsapp }) : ""}
        ${isTech ? `
          <div class="field ${state.errors.specialties ? "invalid" : ""}">
            <label>Specialties (select at least one)</label>
            <div class="checkbox-row">
              <label><input type="checkbox" name="specialty" value="door" /> Door</label>
              <label><input type="checkbox" name="specialty" value="window" /> Window</label>
              <label><input type="checkbox" name="specialty" value="repair" /> Repair</label>
            </div>
            <div class="field-error">${escapeHtml(state.errors.specialties || "")}</div>
          </div>
        ` : ""}
        ${fieldHtml({ id: "reg-password", label: "Password", type: "password", error: state.errors.password, extra: 'placeholder="At least 8 characters, letters and numbers"' })}
        ${fieldHtml({ id: "reg-confirm", label: "Confirm Password", type: "password", error: state.errors.confirm_password })}

        <button class="btn block" ${state.loading ? "disabled" : ""} onclick="submitRegister()">
          ${state.loading ? "Creating account..." : "Register"}
        </button>
        <div class="auth-switch">Already have an account? <a onclick="goto('login')">Log In</a></div>
      </div>
    </div>
  `;
}

async function submitRegister() {
  const isTech = state.authMode === "technician";
  const payload = {
    role: isTech ? "technician" : "customer",
    name: val("reg-name"),
    email: val("reg-email"),
    phone: val("reg-phone"),
    password: val("reg-password"),
    confirm_password: val("reg-confirm"),
  };
  if (isTech) {
    payload.whatsapp = val("reg-whatsapp");
    payload.specialties = checkedValues("specialty");
  }

  await withLoading(async () => {
    const { user, token } = await api.register(payload);
    setToken(token);
    setState({ user });
    routeHome();
  });
}
window.submitRegister = submitRegister;

function noticeHtml() {
  if (!state.notice) return "";
  return `<div class="notice ${state.notice.type === "error" ? "error" : ""}">${escapeHtml(state.notice.text)}</div>`;
}

window.goto = goto;

// ---------------------------------------------------------------------------
// LAYOUT (header + nav, shared by all logged-in screens)
// ---------------------------------------------------------------------------
function navItemsFor(role) {
  if (role === "customer") {
    return [
      ["customer-services", "Book a Service"],
      ["customer-my-bookings", "My Bookings"],
      ["customer-profile", "My Profile"],
    ];
  }
  if (role === "technician") {
    return [
      ["tech-dashboard", "My Jobs"],
      ["tech-profile", "My Profile"],
    ];
  }
  return [
    ["admin-dashboard", "Dashboard"],
    ["admin-bookings", "All Bookings"],
    ["admin-technicians", "Technicians"],
    ["admin-invoices", "Invoices & Payments"],
  ];
}

function layout(innerHtml) {
  const user = state.user || {};
  const role = user.role || "customer";
  const items = navItemsFor(role);
  const statusBadge = role === "technician"
    ? `<button class="btn small ${user.tech_status === "Busy" ? "gray" : "green"}" onclick="toggleMyStatus()">
         Status: ${escapeHtml(user.tech_status || "Available")} (tap to toggle)
       </button>`
    : "";

  return `
    <header class="site-header">
      <div class="logo">Sound Provider Service<span>${escapeHtml(user.name || "")}${role ? ` · ${escapeHtml(role)}` : ""}</span></div>
      <div class="nav">
        ${items.map(([screen, label]) => `<button class="${state.screen === screen ? "active" : ""}" onclick="goto('${screen}')">${label}</button>`).join("")}
        ${statusBadge}
        <button onclick="logout()">Log Out</button>
      </div>
    </header>
    <div class="container">
      ${noticeHtml()}
      ${innerHtml}
    </div>
  `;
}

async function toggleMyStatus() {
  const next = state.user.tech_status === "Busy" ? "Available" : "Busy";
  await withLoading(async () => {
    await api.setTechnicianStatus(state.user.id, next);
    setState({ user: { ...state.user, tech_status: next } });
  });
}
window.toggleMyStatus = toggleMyStatus;

// ---------------------------------------------------------------------------
// CUSTOMER: Services
// ---------------------------------------------------------------------------
async function loadServices() {
  const services = await api.getServices();
  setState({ services });
}

function renderCustomerServices() {
  if (!state.services.length) {
    loadServices();
    return layout(`<p>Loading services...</p>`);
  }
  return layout(`
    <div class="hero">
      <h1>Automatic Door &amp; Window Services</h1>
      <p>Installation, maintenance, and repair for automatic doors and windows in Dammam. Choose a service below to book.</p>
    </div>
    <div class="section-title">Our Services</div>
    <div class="grid">
      ${state.services.map((s) => `
        <div class="card service-card">
          <img src="${escapeHtml(s.image)}" alt="${escapeHtml(s.name)}" />
          <div class="service-content">
            <h3>${escapeHtml(s.name)}</h3>
            <p>${escapeHtml(s.description)}</p>
            <button class="btn block" onclick="startBooking('${s.id}')">Book Now</button>
          </div>
        </div>
      `).join("")}
    </div>
  `);
}

function startBooking(serviceId) {
  goto("customer-booking-form", { bookingDraft: { service_id: serviceId }, editingBookingId: null });
}
window.startBooking = startBooking;

// ---------------------------------------------------------------------------
// CUSTOMER: Booking Form (step 2)
// ---------------------------------------------------------------------------
const REPAIR_PROBLEMS = ["Broken Door", "Broken Window", "Door Not Opening", "Door Not Closing", "Sensor Problem", "Motor Problem", "Glass Damage", "Other"];

function renderCustomerBookingForm() {
  const d = state.bookingDraft;
  const isRepair = d.service_id === "repair";
  const service = state.services.find((s) => s.id === d.service_id);
  const user = state.user || {};

  return layout(`
    <div class="section-title">${escapeHtml(service ? service.name : "Book a Service")} - Details</div>
    <div class="card">
      ${noticeHtml()}
      <div class="form-grid">
        ${fieldHtml({ id: "bf-name", label: "Your Full Name", value: d.customer_name || user.name || "", error: state.errors.customer_name })}
        ${fieldHtml({ id: "bf-phone", label: "Contact Number", value: d.phone || user.phone || "", error: state.errors.phone })}
        ${fieldHtml({ id: "bf-location", label: "Service Location / Address", value: d.location, error: state.errors.location, full: true })}
        ${isRepair ? `
          <div class="field ${state.errors.problem ? "invalid" : ""}">
            <label for="bf-problem">What's the problem?</label>
            <select id="bf-problem">
              <option value="">Select a problem</option>
              ${REPAIR_PROBLEMS.map((p) => `<option value="${p}" ${d.problem === p ? "selected" : ""}>${p}</option>`).join("")}
            </select>
            <div class="field-error">${escapeHtml(state.errors.problem || "")}</div>
          </div>
        ` : `
          ${fieldHtml({ id: "bf-quantity", label: "Quantity (number of units)", type: "number", value: d.quantity || 1, error: state.errors.quantity, extra: 'min="1" max="20"' })}
          ${fieldHtml({ id: "bf-item-type", label: "Item Type (e.g. sliding door, sensor window)", value: d.item_type, error: state.errors.item_type })}
        `}
        ${fieldHtml({ id: "bf-description", label: "Additional details (optional)", type: "textarea", value: d.description, error: state.errors.description, full: true })}
      </div>
      <div class="actions">
        <button class="btn gray" onclick="goto('customer-services')">Back</button>
        <button class="btn" ${state.loading ? "disabled" : ""} onclick="submitBookingForm()">Next: Schedule</button>
      </div>
    </div>
  `);
}

function submitBookingForm() {
  const d = { ...state.bookingDraft };
  d.customer_name = val("bf-name");
  d.phone = val("bf-phone");
  d.location = val("bf-location");
  if (d.service_id === "repair") {
    d.problem = val("bf-problem");
  } else {
    d.quantity = val("bf-quantity");
    d.item_type = val("bf-item-type");
  }
  d.description = val("bf-description");

  const errors = {};
  if (!d.customer_name || d.customer_name.trim().length < 2) errors.customer_name = "Name must be at least 2 characters.";
  if (!d.phone || d.phone.trim().length < 7) errors.phone = "A valid contact number is required.";
  if (!d.location || d.location.trim().length < 3) errors.location = "Please enter a service location.";
  if (d.service_id === "repair") {
    if (!REPAIR_PROBLEMS.includes(d.problem)) errors.problem = "Please select a problem.";
  } else {
    const q = Number(d.quantity);
    if (!Number.isInteger(q) || q < 1 || q > 20) errors.quantity = "Quantity must be between 1 and 20.";
  }

  if (Object.keys(errors).length) return setState({ errors, bookingDraft: d });

  setState({ bookingDraft: d, errors: {} });
  goto("customer-schedule", { bookingDraft: d });
}
window.submitBookingForm = submitBookingForm;

// ---------------------------------------------------------------------------
// CUSTOMER: Schedule (step 3)
// ---------------------------------------------------------------------------
function renderCustomerSchedule() {
  const d = state.bookingDraft;
  return layout(`
    <div class="section-title">Choose Date &amp; Time</div>
    <div class="card">
      ${noticeHtml()}
      <div class="notice">Working hours: 10:00 - 18:00. Closed on Fridays.</div>
      <div class="form-grid">
        ${fieldHtml({ id: "sch-date", label: "Service Date", type: "date", value: d.service_date || todayIso(), error: state.errors.service_date, extra: `min="${todayIso()}"` })}
        <div class="field ${state.errors.service_time ? "invalid" : ""}">
          <label for="sch-time">Service Time</label>
          <select id="sch-time">
            ${["10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00"]
              .map((t) => `<option value="${t}" ${d.service_time === t ? "selected" : ""}>${t}</option>`).join("")}
          </select>
          <div class="field-error">${escapeHtml(state.errors.service_time || "")}</div>
        </div>
      </div>
      <div class="actions">
        <button class="btn gray" onclick="goto('customer-booking-form')">Back</button>
        <button class="btn" ${state.loading ? "disabled" : ""} onclick="submitSchedule()">Next: Choose Technician</button>
      </div>
    </div>
  `);
}

async function submitSchedule() {
  const service_date = val("sch-date");
  const service_time = val("sch-time");
  const errors = {};

  const date = new Date(service_date + "T12:00:00");
  const today = new Date(); today.setHours(0,0,0,0);
  if (!service_date || isNaN(date.getTime())) errors.service_date = "Please choose a valid date.";
  else if (date < today) errors.service_date = "Date cannot be in the past.";
  else if (date.getDay() === 5) errors.service_date = "Friday is a holiday. Please pick another day.";

  if (Object.keys(errors).length) return setState({ errors });

  const d = { ...state.bookingDraft, service_date, service_time };
  setState({ bookingDraft: d, errors: {}, loading: true });

  try {
    const technicians = await api.availableTechnicians(d.service_id, service_date, service_time);
    setState({ availableTechnicians: technicians, loading: false });
    goto("customer-technician-select", { bookingDraft: d });
  } catch (err) {
    setState({ loading: false, notice: { type: "error", text: err.message } });
  }
}
window.submitSchedule = submitSchedule;

// ---------------------------------------------------------------------------
// CUSTOMER: Technician Selection (step 4)
// ---------------------------------------------------------------------------
function renderCustomerTechnicianSelect() {
  const techs = state.availableTechnicians;
  return layout(`
    <div class="section-title">Choose a Technician</div>
    ${!techs.length ? `<div class="notice warn">No technicians are available for this exact date/time yet - you can continue without selecting one and our team will assign someone.</div>` : ""}
    <div class="grid">
      ${techs.map((t) => `
        <div class="card">
          <h3>${escapeHtml(t.name)}</h3>
          <p>Specialties: ${t.specialties.map(escapeHtml).join(", ")}<br/>WhatsApp: ${escapeHtml(t.whatsapp || "-")}</p>
          <button class="btn block" onclick="chooseTechnician(${t.id})">Select</button>
        </div>
      `).join("")}
    </div>
    <div class="actions">
      <button class="btn gray" onclick="goto('customer-schedule')">Back</button>
      <button class="btn" onclick="chooseTechnician(null)">Continue Without Selecting</button>
    </div>
  `);
}

async function chooseTechnician(technicianId) {
  const d = { ...state.bookingDraft, technician_id: technicianId };
  setState({ bookingDraft: d, loading: true });
  try {
    const quote = await api.quote(d.service_id, d.quantity);
    setState({ priceQuote: quote, loading: false });
    goto("customer-confirm", { bookingDraft: d });
  } catch (err) {
    setState({ loading: false, notice: { type: "error", text: err.message } });
  }
}
window.chooseTechnician = chooseTechnician;

// ---------------------------------------------------------------------------
// CUSTOMER: Confirm & Pay Deposit (step 5)
// ---------------------------------------------------------------------------
function renderCustomerConfirm() {
  const d = state.bookingDraft;
  const q = state.priceQuote || {};
  const service = state.services.find((s) => s.id === d.service_id);
  const tech = state.availableTechnicians.find((t) => t.id === d.technician_id);

  return layout(`
    <div class="section-title">Confirm Your Booking</div>
    <div class="card invoice">
      <div class="invoice-header">
        <div>
          <h3>${escapeHtml(service ? service.name : "")}</h3>
          <p>${escapeHtml(d.location)}</p>
          <p>${escapeHtml(d.service_date)} at ${escapeHtml(d.service_time)}</p>
          <p>Technician: ${tech ? escapeHtml(tech.name) : "To be assigned"}</p>
        </div>
        <div>
          <p>Estimated amount: ${sar(q.amount)}</p>
          <p>VAT (15%): ${sar(q.vat)}</p>
          <p class="price">Total: ${sar(q.total)}</p>
        </div>
      </div>
      <div class="notice">A deposit of <strong>${sar(q.deposit)}</strong> is required to confirm this booking. The remaining balance is paid after the job is completed.</div>
      <div class="actions">
        <button class="btn gray" onclick="goto('customer-technician-select')">Back</button>
        <button class="btn green" ${state.loading ? "disabled" : ""} onclick="confirmAndPay()">
          ${state.loading ? "Processing..." : "Confirm Booking & Pay Deposit"}
        </button>
      </div>
    </div>
  `);
}

async function confirmAndPay() {
  const d = state.bookingDraft;
  setState({ loading: true });
  try {
    const booking = await api.createBooking(d);
    try {
      const { checkout_url } = await api.payDeposit(booking.id);
      window.location.href = checkout_url;
      return;
    } catch (payErr) {
      setState({
        loading: false,
        notice: { type: "error", text: `Booking created, but the deposit payment could not be started: ${payErr.message}` },
      });
      goto("customer-my-bookings");
      return;
    }
  } catch (err) {
    setState({ loading: false, notice: { type: "error", text: err.message } });
  }
}
window.confirmAndPay = confirmAndPay;

// ---------------------------------------------------------------------------
// CUSTOMER: My Bookings
// ---------------------------------------------------------------------------
async function loadMyBookings() {
  const myBookings = await api.myBookings();
  setState({ myBookings });
}

function paidAndDueFor(b) {
  // Before job completion, only the deposit exists as a payable amount.
  // After completion, an invoice exists and amount_due tracks the balance.
  if (b.invoice_total != null) {
    const paid = Number((b.invoice_total - b.invoice_amount_due).toFixed(2));
    return { paid, due: b.invoice_amount_due, invoiced: true };
  }
  const depositPaid = b.deposit_status === "paid" || b.deposit_status === "waived";
  return {
    paid: b.deposit_status === "paid" ? b.deposit_amount : 0,
    due: depositPaid ? 0 : b.deposit_amount,
    invoiced: false,
  };
}

function paymentActionFor(b) {
  if (b.status === "Cancelled") return "";
  if (b.deposit_status === "unpaid") {
    return `<button class="btn small" onclick="payDepositFor(${b.id})">Pay Deposit (${sar(b.deposit_amount)})</button>`;
  }
  if (b.invoice_status === "Unpaid" && b.invoice_amount_due > 0) {
    return `<button class="btn small green" onclick="payFinalFor(${b.id})">Pay Balance (${sar(b.invoice_amount_due)})</button>`;
  }
  if (b.status === "Completed" && (!b.invoice_status || b.invoice_amount_due <= 0)) {
    return `<span class="status paid">Fully Paid</span>`;
  }
  return `<span class="status ${b.deposit_status}">Deposit ${escapeHtml(b.deposit_status)}</span>`;
}

function renderCustomerMyBookings() {
  if (!state.myBookings.length && !state._myBookingsLoaded) {
    loadMyBookings().then(() => setState({ _myBookingsLoaded: true }));
    return layout(`<p>Loading your bookings...</p>`);
  }
  return layout(`
    <div class="section-title">My Bookings</div>
    ${!state.myBookings.length ? `<div class="card"><p>You have no bookings yet.</p></div>` : `
      <div class="table-container">
        <table>
          <thead><tr><th>Service</th><th>Date</th><th>Technician</th><th>Status</th><th>Paid</th><th>Due</th><th>Actions</th></tr></thead>
          <tbody>
            ${state.myBookings.map((b) => {
              const { paid, due } = paidAndDueFor(b);
              return `
              <tr>
                <td>${escapeHtml(b.service_name)}</td>
                <td>${escapeHtml(b.service_date)} ${escapeHtml(b.service_time)}</td>
                <td>${escapeHtml(b.technician_name || "Unassigned")}</td>
                <td><span class="status ${statusClass(b.status)}">${escapeHtml(b.status)}</span></td>
                <td>${sar(paid)}</td>
                <td>${due > 0 ? `<strong>${sar(due)}</strong>` : sar(0)}</td>
                <td>
                  ${b.status === "Pending" ? `<button class="btn small red" onclick="cancelMyBooking(${b.id})">Cancel</button>` : ""}
                  ${paymentActionFor(b)}
                  ${b.invoice_status ? `<button class="btn small gray" onclick="printInvoiceForBooking(${b.id})">Print Invoice</button>` : ""}
                </td>
              </tr>
            `; }).join("")}
          </tbody>
        </table>
      </div>
    `}
  `);
}
async function cancelMyBooking(id) {
  if (!confirm("Cancel this booking?")) return;
  await withLoading(async () => {
    await api.cancelBooking(id);
    await loadMyBookings();
  });
}
window.cancelMyBooking = cancelMyBooking;

async function payDepositFor(id) {
  await withLoading(async () => {
    const { checkout_url } = await api.payDeposit(id);
    window.location.href = checkout_url;
  });
}
window.payDepositFor = payDepositFor;

async function payFinalFor(id) {
  await withLoading(async () => {
    const { checkout_url } = await api.payFinal(id);
    window.location.href = checkout_url;
  });
}
window.payFinalFor = payFinalFor;

// ---------------------------------------------------------------------------
// CUSTOMER: My Profile
// ---------------------------------------------------------------------------
function renderCustomerProfile() {
  const u = state.user;
  return layout(`
    <div class="section-title">My Profile</div>
    <div class="card" style="max-width:480px">
      ${noticeHtml()}
      ${fieldHtml({ id: "prof-name", label: "Full Name", value: u.name, error: state.errors.name })}
      ${fieldHtml({ id: "prof-phone", label: "Phone Number", value: u.phone, error: state.errors.phone })}
      ${fieldHtml({ id: "prof-email", label: "Email", value: u.email, extra: "disabled" })}
      <button class="btn block" ${state.loading ? "disabled" : ""} onclick="saveProfile()">Save Changes</button>
    </div>
  `);
}

async function saveProfile() {
  await withLoading(async () => {
    const { user } = await api.updateProfile({ name: val("prof-name"), phone: val("prof-phone") });
    setState({ user, notice: { type: "ok", text: "Profile updated." } });
  });
}
window.saveProfile = saveProfile;

// ---------------------------------------------------------------------------
// TECHNICIAN: Dashboard (Assigned Jobs / Available Jobs tabs)
// ---------------------------------------------------------------------------
async function loadTechDashboard() {
  const [assignedJobs, availableJobs] = await Promise.all([api.assignedBookings(), api.availableJobs()]);
  setState({ assignedJobs, availableJobs, _techLoaded: true });
}

function renderTechDashboard() {
  if (!state._techLoaded) {
    loadTechDashboard();
    return layout(`<p>Loading your jobs...</p>`);
  }

  const rows = state.techTab === "assigned" ? state.assignedJobs : state.availableJobs;

  return layout(`
    <div class="section-title">My Jobs</div>
    <div class="tabs">
      <button class="${state.techTab === "assigned" ? "active" : ""}" onclick="setTechTab('assigned')">Assigned to Me (${state.assignedJobs.length})</button>
      <button class="${state.techTab === "available" ? "active" : ""}" onclick="setTechTab('available')">Available Jobs (${state.availableJobs.length})</button>
    </div>
    ${!rows.length ? `<div class="card"><p>Nothing here right now.</p></div>` : `
      <div class="table-container">
        <table>
          <thead><tr><th>Service</th><th>Customer</th><th>Location</th><th>Date</th><th>Status</th><th>Deposit</th><th>Actions</th></tr></thead>
          <tbody>
            ${rows.map((b) => `
              <tr>
                <td>${escapeHtml(b.service_name)}</td>
                <td>${escapeHtml(b.customer_name)}<br/><small>${escapeHtml(b.phone)}</small></td>
                <td>${escapeHtml(b.location)}</td>
                <td>${escapeHtml(b.service_date)} ${escapeHtml(b.service_time)}</td>
                <td><span class="status ${statusClass(b.status)}">${escapeHtml(b.status)}</span></td>
                <td><span class="status ${b.deposit_status}">${escapeHtml(b.deposit_status)}</span></td>
                <td>${techActionButtons(b)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `}
  `);
}

function techActionButtons(b) {
  if (state.techTab === "available") {
    return `<button class="btn small" onclick="claimJob(${b.id})">Claim</button>`;
  }
  if (b.status === "Pending") {
    const depositOk = b.deposit_status === "paid" || b.deposit_status === "waived";
    return depositOk
      ? `<button class="btn small" onclick="setJobStatus(${b.id}, 'In Progress')">Start Work</button>`
      : `<span title="Deposit not paid yet">Waiting on deposit</span>`;
  }
  if (b.status === "In Progress") {
    return `<button class="btn small green" onclick="setJobStatus(${b.id}, 'Completed')">Mark Completed</button>`;
  }
  if (b.status === "Completed") {
    return `<button class="btn small gray" onclick="printInvoiceForBooking(${b.id})">Print Invoice</button>`;
  }
  return "-";
}

function setTechTab(tab) { setState({ techTab: tab }); }
window.setTechTab = setTechTab;

async function claimJob(id) {
  await withLoading(async () => {
    await api.claimBooking(id);
    await loadTechDashboard();
  });
}
window.claimJob = claimJob;

async function setJobStatus(id, status) {
  await withLoading(async () => {
    await api.setBookingStatus(id, status);
    await loadTechDashboard();
  });
}
window.setJobStatus = setJobStatus;

// ---------------------------------------------------------------------------
// TECHNICIAN: Profile
// ---------------------------------------------------------------------------
function renderTechProfile() {
  const u = state.user;
  const specialties = u.specialties || [];
  return layout(`
    <div class="section-title">My Profile</div>
    <div class="card" style="max-width:480px">
      ${noticeHtml()}
      ${fieldHtml({ id: "tprof-name", label: "Full Name", value: u.name, error: state.errors.name })}
      ${fieldHtml({ id: "tprof-phone", label: "Phone Number", value: u.phone, error: state.errors.phone })}
      ${fieldHtml({ id: "tprof-whatsapp", label: "WhatsApp Number", value: u.whatsapp, error: state.errors.whatsapp })}
      <div class="field">
        <label>Specialties</label>
        <div class="checkbox-row">
          ${["door", "window", "repair"].map((s) => `
            <label><input type="checkbox" name="tspecialty" value="${s}" ${specialties.includes(s) ? "checked" : ""} /> ${s[0].toUpperCase() + s.slice(1)}</label>
          `).join("")}
        </div>
      </div>
      <p style="margin-bottom:16px;color:var(--muted)">Employee code: ${escapeHtml(u.employee_code)} &nbsp;·&nbsp; Email: ${escapeHtml(u.email)}</p>
      <button class="btn block" ${state.loading ? "disabled" : ""} onclick="saveTechProfile()">Save Changes</button>
    </div>
  `);
}

async function saveTechProfile() {
  await withLoading(async () => {
    const { user } = await api.updateProfile({
      name: val("tprof-name"),
      phone: val("tprof-phone"),
      whatsapp: val("tprof-whatsapp"),
      specialties: checkedValues("tspecialty"),
    });
    setState({ user, notice: { type: "ok", text: "Profile updated." } });
  });
}
window.saveTechProfile = saveTechProfile;

// ---------------------------------------------------------------------------
// ADMIN: Dashboard
// ---------------------------------------------------------------------------
async function loadDashboardStats() {
  const dashboardStats = await api.dashboardStats();
  setState({ dashboardStats, _dashLoaded: true });
}

function renderAdminDashboard() {
  if (!state._dashLoaded) {
    loadDashboardStats();
    return layout(`<p>Loading dashboard...</p>`);
  }
  const s = state.dashboardStats;
  const cards = [
    ["Total Customers", s.totalCustomers],
    ["Total Technicians", s.totalTechnicians],
    ["Bookings Today", s.todaysServices],
    ["Pending", s.pending],
    ["In Progress", s.inProgress],
    ["Completed", s.completed],
    ["Cancelled", s.cancelled],
    ["Unpaid Deposits", s.unpaidDeposits],
    ["Today's Revenue", sar(s.todaysRevenue)],
    ["Pending Payments", sar(s.pendingPayments)],
  ];
  return layout(`
    <div class="section-title">Admin Dashboard</div>
    <div class="grid">
      ${cards.map(([label, value]) => `
        <div class="card">
          <div class="stat-label">${label}</div>
          <div class="stat">${value}</div>
        </div>
      `).join("")}
    </div>
  `);
}

// ---------------------------------------------------------------------------
// ADMIN: All Bookings (assign/reassign, status override, waive deposit)
// ---------------------------------------------------------------------------
async function loadAllBookingsAndTechnicians() {
  const [allBookings, allTechnicians] = await Promise.all([api.allBookings(), api.allTechnicians()]);
  setState({ allBookings, allTechnicians, _bookingsLoaded: true });
}

function renderAdminBookings() {
  if (!state._bookingsLoaded) {
    loadAllBookingsAndTechnicians();
    return layout(`<p>Loading bookings...</p>`);
  }
  return layout(`
    <div class="section-title">All Bookings</div>
    <div class="table-container">
      <table>
        <thead><tr><th>#</th><th>Service</th><th>Customer</th><th>Date</th><th>Technician</th><th>Status</th><th>Deposit</th><th>Actions</th></tr></thead>
        <tbody>
          ${state.allBookings.map((b) => `
            <tr>
              <td>${b.id}</td>
              <td>${escapeHtml(b.service_name)}</td>
              <td>${escapeHtml(b.customer_name)}<br/><small>${escapeHtml(b.phone)}</small></td>
              <td>${escapeHtml(b.service_date)} ${escapeHtml(b.service_time)}</td>
              <td>
                <select onchange="reassignTechnician(${b.id}, this.value)" ${["Completed","Cancelled"].includes(b.status) ? "disabled" : ""}>
                  <option value="">Unassigned</option>
                  ${state.allTechnicians.map((t) => `<option value="${t.id}" ${b.technician_id === t.id ? "selected" : ""}>${escapeHtml(t.name)} (${t.specialties.join("/")})</option>`).join("")}
                </select>
              </td>
              <td><span class="status ${statusClass(b.status)}">${escapeHtml(b.status)}</span></td>
              <td><span class="status ${b.deposit_status}">${escapeHtml(b.deposit_status)}</span></td>
              <td>
                ${b.status === "Pending" ? `<button class="btn small red" onclick="adminCancelBooking(${b.id})">Cancel</button>` : ""}
                ${b.deposit_status === "unpaid" ? `<button class="btn small" onclick="adminWaiveDeposit(${b.id})">Waive Deposit</button>` : ""}
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `);
}

async function reassignTechnician(bookingId, technicianId) {
  if (!technicianId) return;
  await withLoading(async () => {
    await api.assignTechnician(bookingId, Number(technicianId));
    await loadAllBookingsAndTechnicians();
  });
}
window.reassignTechnician = reassignTechnician;

async function adminCancelBooking(id) {
  if (!confirm("Cancel this booking?")) return;
  await withLoading(async () => {
    await api.cancelBooking(id);
    await loadAllBookingsAndTechnicians();
  });
}
window.adminCancelBooking = adminCancelBooking;

async function adminWaiveDeposit(id) {
  if (!confirm("Waive the deposit for this booking?")) return;
  await withLoading(async () => {
    await api.waiveDeposit(id);
    await loadAllBookingsAndTechnicians();
  });
}
window.adminWaiveDeposit = adminWaiveDeposit;

// ---------------------------------------------------------------------------
// ADMIN: Technicians roster
// ---------------------------------------------------------------------------
async function loadTechnicianRoster() {
  const allTechnicians = await api.allTechnicians();
  setState({ allTechnicians, _rosterLoaded: true });
}

function renderAdminTechnicianEditRow(t) {
  const specialtyOptions = ["door", "window", "repair"];
  return `<tr>
    <td colspan="8">
      <div class="card">
        <div class="section-title" style="margin-bottom:12px">Edit Technician</div>
        <div class="grid" style="grid-template-columns: repeat(2, minmax(180px, 1fr));">
          <div class="field">
            <label>Name</label>
            <input id="admin-tech-edit-name-${t.id}" value="${escapeHtml(t.name)}" />
          </div>
          <div class="field">
            <label>Email</label>
            <input id="admin-tech-edit-email-${t.id}" value="${escapeHtml(t.email)}" />
          </div>
          <div class="field">
            <label>Phone</label>
            <input id="admin-tech-edit-phone-${t.id}" value="${escapeHtml(t.phone)}" />
          </div>
          <div class="field">
            <label>WhatsApp</label>
            <input id="admin-tech-edit-whatsapp-${t.id}" value="${escapeHtml(t.whatsapp || "")}" />
          </div>
          <div class="field">
            <label>Status</label>
            <select id="admin-tech-edit-status-${t.id}">
              <option value="Available" ${t.tech_status === "Available" ? "selected" : ""}>Available</option>
              <option value="Busy" ${t.tech_status === "Busy" ? "selected" : ""}>Busy</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label>Specialties</label>
          <div class="checkbox-row">
            ${specialtyOptions.map((s) => `
              <label><input type="checkbox" name="admin-tech-edit-specialty-${t.id}" value="${s}" ${t.specialties.includes(s) ? "checked" : ""} /> ${s[0].toUpperCase() + s.slice(1)}</label>
            `).join("")}
          </div>
        </div>
        <div class="actions">
          <button class="btn green" onclick="adminSaveTechnician(${t.id})">Save</button>
          <button class="btn gray" onclick="adminCancelEditTechnician()">Cancel</button>
        </div>
      </div>
    </td>
  </tr>`;
}

function renderAdminTechnicians() {
  if (!state._rosterLoaded) {
    loadTechnicianRoster();
    return layout(`<p>Loading technicians...</p>`);
  }
  return layout(`
    <div class="section-title">Technicians</div>
    <div class="table-container">
      <table>
        <thead><tr><th>Code</th><th>Name</th><th>Email</th><th>Phone</th><th>WhatsApp</th><th>Specialties</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          ${state.allTechnicians.map((t) => `
            <tr>
              <td>${escapeHtml(t.employee_code)}</td>
              <td>${escapeHtml(t.name)}</td>
              <td>${escapeHtml(t.email)}</td>
              <td>${escapeHtml(t.phone)}</td>
              <td>${escapeHtml(t.whatsapp)}</td>
              <td>${t.specialties.map(escapeHtml).join(", ")}</td>
              <td>
                <select onchange="adminSetTechStatus(${t.id}, this.value)">
                  <option value="Available" ${t.tech_status === "Available" ? "selected" : ""}>Available</option>
                  <option value="Busy" ${t.tech_status === "Busy" ? "selected" : ""}>Busy</option>
                </select>
              </td>
              <td>
                <button class="btn small" onclick="adminEditTechnician(${t.id})">Edit</button>
              </td>
            </tr>
            ${state.editingTechnicianId === t.id ? renderAdminTechnicianEditRow(t) : ""}
          `).join("")}
        </tbody>
      </table>
    </div>
  `);
}

function adminEditTechnician(id) {
  setState({ editingTechnicianId: id, notice: null, errors: {} });
}
window.adminEditTechnician = adminEditTechnician;

function adminCancelEditTechnician() {
  setState({ editingTechnicianId: null, errors: {} });
}
window.adminCancelEditTechnician = adminCancelEditTechnician;

async function adminSaveTechnician(id) {
  const payload = {
    name: val(`admin-tech-edit-name-${id}`),
    email: val(`admin-tech-edit-email-${id}`),
    phone: val(`admin-tech-edit-phone-${id}`),
    whatsapp: val(`admin-tech-edit-whatsapp-${id}`),
    tech_status: val(`admin-tech-edit-status-${id}`),
    specialties: checkedValues(`admin-tech-edit-specialty-${id}`),
  };

  await withLoading(async () => {
    await api.updateTechnician(id, payload);
    await loadTechnicianRoster();
    setState({ editingTechnicianId: null, notice: { type: "ok", text: "Technician updated." } });
  });
}
window.adminSaveTechnician = adminSaveTechnician;

async function adminSetTechStatus(id, status) {
  await withLoading(async () => {
    await api.setTechnicianStatus(id, status);
    await loadTechnicianRoster();
  });
}
window.adminSetTechStatus = adminSetTechStatus;

// ---------------------------------------------------------------------------
// ADMIN: Invoices & Payments
// ---------------------------------------------------------------------------
async function loadAllInvoices() {
  const allInvoices = await api.allInvoices();
  setState({ allInvoices, _invoicesLoaded: true });
}

function renderAdminInvoices() {
  if (!state._invoicesLoaded) {
    loadAllInvoices();
    return layout(`<p>Loading invoices...</p>`);
  }
  return layout(`
    <div class="section-title">Invoices &amp; Payments</div>
    <div class="table-container">
      <table>
        <thead><tr><th>Invoice #</th><th>Booking</th><th>Amount</th><th>VAT</th><th>Total</th><th>Amount Due</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          ${state.allInvoices.map((inv) => `
            <tr>
              <td>${escapeHtml(inv.invoice_number)}</td>
              <td>#${inv.booking_id}</td>
              <td>${sar(inv.amount)}</td>
              <td>${sar(inv.vat)}</td>
              <td>${sar(inv.total)}</td>
              <td>${sar(inv.amount_due)}</td>
              <td><span class="status ${inv.status.toLowerCase()}">${escapeHtml(inv.status)}</span></td>
              <td>
                <button class="btn small gray" onclick="printInvoice(${inv.id})">Print</button>
                ${inv.status === "Unpaid" ? `<button class="btn small green" onclick="markInvoicePaid(${inv.id})">Mark Paid (cash)</button>` : ""}
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `);
}

async function printInvoice(id) {
  try {
    const invoice = await api.getInvoice(id);
    const booking = await api.getBooking(invoice.booking_id);
    const date = new Date(invoice.created_at || Date.now()).toLocaleDateString();
    const total = Number(invoice.total || 0).toFixed(2);
    const amount = Number(invoice.amount || 0).toFixed(2);
    const vat = Number(invoice.vat || 0).toFixed(2);
    const amountDue = Number(invoice.amount_due || 0).toFixed(2);

    const html = `
      <html>
        <head>
          <title>Invoice ${escapeHtml(invoice.invoice_number)}</title>
          <style>
            body { font-family: Arial, sans-serif; color: #172033; padding: 30px; }
            .invoice { max-width: 780px; margin: 0 auto; border: 1px solid #e5e8ee; border-radius: 12px; padding: 30px; }
            .title { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #10213d; padding-bottom: 14px; }
            .title h1 { font-size: 30px; color: #10213d; margin: 0; }
            .meta { display: grid; grid-template-columns: repeat(2, minmax(160px, 1fr)); gap: 12px; margin: 20px 0; color: #687386; }
            .meta strong { display: block; color: #10213d; margin-bottom: 4px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { padding: 12px; border-bottom: 1px solid #e5e8ee; text-align: left; }
            th { background: #f1f4f9; color: #10213d; }
            .totals { margin-top: 20px; display: flex; justify-content: flex-end; }
            .totals table { width: 280px; }
            .totals td:last-child { text-align: right; }
            .status { display: inline-block; padding: 4px 10px; border-radius: 20px; background: #dff6e9; color: #157243; }
            @media print { body { padding: 0; } .invoice { border: none; box-shadow: none; } }
          </style>
        </head>
        <body>
          <div class="invoice">
            <div class="title">
              <div>
                <h1>Invoice</h1>
                <div>${escapeHtml(invoice.invoice_number)}</div>
              </div>
              <div class="status">${escapeHtml(invoice.status)}</div>
            </div>
            <div class="meta">
              <div><strong>Booking</strong>#${escapeHtml(invoice.booking_id)}</div>
              <div><strong>Date</strong>${escapeHtml(date)}</div>
              <div><strong>Service</strong>${escapeHtml(booking.service_name || booking.service_id || "Service")}</div>
              <div><strong>Customer</strong>${escapeHtml(booking.customer_email || "Customer")}</div>
            </div>
            <table>
              <thead>
                <tr><th>Item</th><th>Amount</th></tr>
              </thead>
              <tbody>
                <tr><td>Service Amount</td><td>${sar(invoice.amount)}</td></tr>
                <tr><td>VAT (15%)</td><td>${sar(invoice.vat)}</td></tr>
              </tbody>
            </table>
            <div class="totals">
              <table>
                <tr><td><strong>Total</strong></td><td>${sar(invoice.total)}</td></tr>
                <tr><td><strong>Amount Due</strong></td><td>${sar(invoice.amount_due)}</td></tr>
              </table>
            </div>
          </div>
        </body>
      </html>`;

    const printWindow = window.open('', '_blank', 'width=900,height=720');
    if (!printWindow) {
      alert("Please allow pop-ups to print the invoice.");
      return;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 250);
  } catch (err) {
    setState({ loading: false, notice: { type: "error", text: err.message } });
  }
}
window.printInvoice = printInvoice;

async function printInvoiceForBooking(bookingId) {
  try {
    const invoice = await api.getInvoiceByBooking(bookingId);
    await printInvoice(invoice.id);
  } catch (err) {
    setState({ loading: false, notice: { type: "error", text: err.message } });
  }
}
window.printInvoiceForBooking = printInvoiceForBooking;

async function markInvoicePaid(id) {
  if (!confirm("Mark this invoice as paid manually (e.g. cash payment received on-site)?")) return;
  await withLoading(async () => {
    await api.setInvoiceStatus(id, "Paid");
    await loadAllInvoices();
  });
}
window.markInvoicePaid = markInvoicePaid;

// ---------------------------------------------------------------------------
// RENDER DISPATCHER
// ---------------------------------------------------------------------------
function render() {
  let html;
  switch (state.screen) {
    case "login": html = renderLogin(); break;
    case "register": html = renderRegister(); break;

    case "customer-services": html = renderCustomerServices(); break;
    case "customer-booking-form": html = renderCustomerBookingForm(); break;
    case "customer-schedule": html = renderCustomerSchedule(); break;
    case "customer-technician-select": html = renderCustomerTechnicianSelect(); break;
    case "customer-confirm": html = renderCustomerConfirm(); break;
    case "customer-my-bookings": html = renderCustomerMyBookings(); break;
    case "customer-profile": html = renderCustomerProfile(); break;

    case "tech-dashboard": html = renderTechDashboard(); break;
    case "tech-profile": html = renderTechProfile(); break;

    case "admin-dashboard": html = renderAdminDashboard(); break;
    case "admin-bookings": html = renderAdminBookings(); break;
    case "admin-technicians": html = renderAdminTechnicians(); break;
    case "admin-invoices": html = renderAdminInvoices(); break;

    default: html = renderLogin();
  }
  root.innerHTML = html;
}

init();
