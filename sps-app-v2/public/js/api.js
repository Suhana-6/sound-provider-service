const API_BASE = "/api";

function getToken() {
  return localStorage.getItem("sps_token");
}

function setToken(token) {
  if (token) localStorage.setItem("sps_token", token);
  else localStorage.removeItem("sps_token");
}

async function request(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }

  if (!res.ok) {
    const message = (data && (data.error || (data.errors && data.errors[0]))) || "Something went wrong. Please try again.";
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const api = {
  // auth
  register: (payload) => request("POST", "/auth/register", payload),
  login: (email, password) => request("POST", "/auth/login", { email, password }),
  logout: () => request("POST", "/auth/logout"),
  me: () => request("GET", "/auth/me"),
  updateProfile: (payload) => request("PATCH", "/auth/me", payload),

  // services & pricing
  getServices: () => request("GET", "/services"),
  quote: (service_id, quantity) => request("POST", "/pricing/quote", { service_id, quantity }),

  // technicians
  availableTechnicians: (service_id, date, time) =>
    request("GET", `/technicians/available?service_id=${encodeURIComponent(service_id)}` +
      (date ? `&date=${encodeURIComponent(date)}` : "") +
      (time ? `&time=${encodeURIComponent(time)}` : "")),
  allTechnicians: () => request("GET", "/technicians"),
  updateTechnician: (id, payload) => request("PATCH", `/technicians/${id}`, payload),
  setTechnicianStatus: (id, status) => request("PATCH", `/technicians/${id}/status`, { status }),

  // bookings
  createBooking: (payload) => request("POST", "/bookings", payload),
  updateBooking: (id, payload) => request("PATCH", `/bookings/${id}`, payload),
  cancelBooking: (id) => request("POST", `/bookings/${id}/cancel`),
  myBookings: () => request("GET", "/bookings/mine"),
  assignedBookings: () => request("GET", "/bookings/assigned"),
  availableJobs: () => request("GET", "/bookings/available-jobs"),
  claimBooking: (id) => request("POST", `/bookings/${id}/claim`),
  allBookings: () => request("GET", "/bookings"),
  getBooking: (id) => request("GET", `/bookings/${id}`),
  assignTechnician: (id, technician_id) => request("PATCH", `/bookings/${id}/assign`, { technician_id }),
  setBookingStatus: (id, status) => request("PATCH", `/bookings/${id}/status`, { status }),
  waiveDeposit: (id) => request("PATCH", `/bookings/${id}/waive-deposit`),

  // payments
  payDeposit: (bookingId) => request("POST", `/payments/deposit/${bookingId}`),
  payFinal: (bookingId) => request("POST", `/payments/final/${bookingId}`),
  getPayment: (id) => request("GET", `/payments/${id}`),
  refundPayment: (id) => request("POST", `/payments/${id}/refund`),

  // invoices
  getInvoice: (id) => request("GET", `/invoices/${id}`),
  getInvoiceByBooking: (bookingId) => request("GET", `/invoices/by-booking/${bookingId}`),
  allInvoices: () => request("GET", "/invoices"),
  setInvoiceStatus: (id, status) => request("PATCH", `/invoices/${id}/status`, { status }),

  // admin dashboard
  dashboardStats: () => request("GET", "/dashboard/stats"),
};
