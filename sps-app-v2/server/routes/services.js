const express = require("express");
const db = require("../db");
const v = require("../validators");
const { calculatePrice, calculateDeposit, VAT_RATE } = require("../pricing");

const router = express.Router();

router.get("/services", (req, res) => {
  res.json(db.prepare("SELECT * FROM services").all());
});

router.post("/pricing/quote", (req, res) => {
  const { service_id, quantity } = req.body;

  if (!service_id || !["door", "window", "repair"].includes(service_id)) {
    return res.status(400).json({ error: "A valid service_id is required." });
  }
  if (service_id !== "repair") {
    const qtyErr = v.validateQuantity(quantity);
    if (qtyErr) return res.status(400).json({ error: qtyErr });
  }

  try {
    const booking = { service_id, quantity };
    const { amount } = calculatePrice(db, booking);
    const vat = Number((amount * VAT_RATE).toFixed(2));
    const total = Number((amount + vat).toFixed(2));
    const deposit = calculateDeposit(db, booking);
    res.json({ amount, vat, total, vatRate: VAT_RATE, deposit });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
