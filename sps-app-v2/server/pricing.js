/**
 * Pricing & deposit engine.
 *
 * Deposit rule (per business decision):
 *  - door / window: percentage of the estimated price (DEPOSIT_PERCENT)
 *  - repair: flat SAR amount (REPAIR_DEPOSIT_FLAT), since repair pricing itself
 *    is just a flat diagnostic call-out fee quoted before inspection.
 *
 * These constants are intentionally isolated here so they're easy to tune
 * without touching route logic.
 */

const VAT_RATE = 0.15;
const DEPOSIT_PERCENT = 0.20; // 20% of estimated price for door/window
const REPAIR_DEPOSIT_FLAT = 100; // flat SAR deposit for repair diagnostic visits

function calculatePrice(db, booking) {
  const service = db.prepare("SELECT * FROM services WHERE id = ?").get(booking.service_id);
  if (!service) throw new Error("Unknown service.");

  const quantity = Math.max(1, Number(booking.quantity) || 1);
  const amount = service.id === "repair"
    ? service.base_price
    : service.base_price + service.price_per_unit * quantity;

  return { amount: Number(amount.toFixed(2)), service, quantity };
}

function calculateDeposit(db, booking) {
  const { amount, service } = calculatePrice(db, booking);
  const deposit = service.id === "repair"
    ? REPAIR_DEPOSIT_FLAT
    : Number((amount * DEPOSIT_PERCENT).toFixed(2));
  return deposit;
}

module.exports = { VAT_RATE, DEPOSIT_PERCENT, REPAIR_DEPOSIT_FLAT, calculatePrice, calculateDeposit };
