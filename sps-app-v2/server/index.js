require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const serviceRoutes = require("./routes/services");
const { router: technicianRoutes } = require("./routes/technicians");
const { router: bookingRoutes } = require("./routes/bookings");
const paymentRoutes = require("./routes/payments");
const invoiceRoutes = require("./routes/invoices");
const adminRoutes = require("./routes/admin");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api", serviceRoutes);
app.use("/api", technicianRoutes);
app.use("/api", bookingRoutes);
app.use("/api", paymentRoutes);
app.use("/api", invoiceRoutes);
app.use("/api", adminRoutes);

// Static frontend (pure presentation layer)
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Sound Provider Service v2 running at http://localhost:${PORT}`);
});
