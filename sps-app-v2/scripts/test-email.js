require("dotenv").config();
const notifications = require("../server/notifications");

console.log("SMTP configured:", notifications.isConfigured());

notifications.sendCustomerPaymentNotification(
  {
    id: 999,
    customer_name: "Test Customer",
    customer_email: "mdrinos2005@gmail.com", // <-- change this
    service_name: "Automatic Door Service",
    location: "Test Location",
    service_date: "2026-01-01",
    service_time: "10:00",
  },
  { type: "deposit", amount: 150 }
).then(() => console.log("Done - check the inbox (and spam folder)."));