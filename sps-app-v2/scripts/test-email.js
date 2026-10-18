require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const notifications = require("../server/notifications");

const recipient = process.argv[2] || process.env.TEST_EMAIL || "mdrinos2005@gmail.com";

async function main() {
  if (!notifications.isConfigured()) {
    throw new Error("Email is not configured. Check the provider settings in .env.");
  }

  const sent = await notifications.sendCustomerPaymentNotification(
    {
      id: 999,
      customer_name: "Test Customer",
      customer_email: recipient,
      service_name: "Automatic Door Service",
      location: "Test Location",
      service_date: "2026-01-01",
      service_time: "10:00",
    },
    { type: "deposit", amount: 150 }
  );

  if (!sent) throw new Error("The email provider did not accept the test message.");
  console.log(`Test email accepted for ${recipient}. Check its inbox and spam folder.`);
}

main().catch((err) => {
  console.error("Email test failed:", err.message);
  process.exitCode = 1;
});