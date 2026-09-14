/**
 * Payment gateway integration - supports two modes, controlled by PAYMENT_MODE:
 *
 *   PAYMENT_MODE=mock (default)    - no real gateway, no real money. Generates
 *                                    a fake checkout session pointing at our
 *                                    own /mock-checkout.html page, where you
 *                                    can simulate a successful or failed
 *                                    payment with a button click.
 *   PAYMENT_MODE=moyasar            - real Moyasar sandbox/live integration.
 *                                    Requires MOYASAR_SECRET_KEY etc.
 *
 * Every route that talks to "the gateway" goes through this module and
 * doesn't know which mode is active - so flipping PAYMENT_MODE later is the
 * only change needed to go from dummy to real payments.
 *
 * NOTE: when you do switch to 'moyasar', verify field names/endpoints against
 * Moyasar's current docs (https://docs.moyasar.com) before going live -
 * integrations can drift from what's written here.
 */

const crypto = require("crypto");

const MOYASAR_API_BASE = "https://api.moyasar.com/v1";

function mode() {
  return (process.env.PAYMENT_MODE || "mock").toLowerCase();
}

function isMock() {
  return mode() !== "moyasar";
}

function isConfigured() {
  if (isMock()) return true; // mock mode always "works", by design
  return Boolean(process.env.MOYASAR_SECRET_KEY);
}

function notConfiguredError() {
  const err = new Error("Payments are not configured on this server yet.");
  err.code = "PAYMENTS_NOT_CONFIGURED";
  return err;
}

function moyasarClient() {
  // Lazy require: axios is only needed in real ('moyasar') mode, so mock
  // mode (the default) works without it even being installed.
  const axios = require("axios");
  return axios.create({
    baseURL: MOYASAR_API_BASE,
    auth: { username: process.env.MOYASAR_SECRET_KEY, password: "" },
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Creates a checkout session for the given amount (in SAR).
 * Returns { id, url } - `url` is where the customer should be redirected.
 */
async function createInvoice({ amountSar, description, callbackUrl, metadata }) {
  if (isMock()) {
    const id = "mock_" + crypto.randomBytes(8).toString("hex");
    const base = process.env.APP_BASE_URL || "http://localhost:3000";
    const params = new URLSearchParams({
      payment_id: id,
      amount: amountSar.toFixed(2),
      description: description || "",
      callback_url: callbackUrl,
    });
    return { id, url: `${base}/mock-checkout.html?${params.toString()}`, raw: { mock: true } };
  }

  if (!isConfigured()) throw notConfiguredError();

  const response = await moyasarClient().post("/invoices", {
    amount: Math.round(amountSar * 100), // halalas
    currency: "SAR",
    description,
    callback_url: callbackUrl,
    metadata,
  });
  return { id: response.data.id, url: response.data.url, raw: response.data };
}

async function getInvoice(invoiceId) {
  if (isMock()) return { id: invoiceId, status: "initiated", mock: true };
  if (!isConfigured()) throw notConfiguredError();
  const response = await moyasarClient().get(`/invoices/${invoiceId}`);
  return response.data;
}

async function refundPayment(gatewayPaymentId, amountSar) {
  if (isMock()) return { id: gatewayPaymentId, status: "refunded", mock: true };
  if (!isConfigured()) throw notConfiguredError();
  const body = amountSar ? { amount: Math.round(amountSar * 100) } : {};
  const response = await moyasarClient().post(`/payments/${gatewayPaymentId}/refund`, body);
  return response.data;
}

/**
 * Real-mode webhook verification (Moyasar appends ?secret_token=... to the
 * webhook URL you register in their dashboard). Not used in mock mode - the
 * mock checkout page calls a dedicated dev-only endpoint instead (see
 * routes/payments.js), since there's no external gateway to call us back.
 */
function verifyWebhookRequest(req) {
  if (isMock()) return false;
  const expected = process.env.MOYASAR_WEBHOOK_SECRET;
  if (!expected) return false;
  return req.query.secret_token === expected;
}

module.exports = {
  isMock, isConfigured, createInvoice, getInvoice, refundPayment, verifyWebhookRequest,
};
