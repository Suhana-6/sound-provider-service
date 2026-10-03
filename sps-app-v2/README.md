# Sound Provider Service — v2

A ground-up rebuild of the booking & management platform for automatic door/window
installation, repair, and maintenance (Dammam, Saudi Arabia). See
`REBUILD_PLAN.md` and `PAYMENTS_FEATURE_SPEC.md` (folded into the rebuild plan)
for the full design rationale.

## What's new in v2

- **Three roles**: `customer`, `technician`, `admin`. Customers and technicians
  self-register with full field validation; the single admin account is seeded
  once from environment variables at startup.
- **Technician = one account.** Login and technician profile (specialties,
  WhatsApp, availability) are merged into a single `users` record — no more
  disconnected roster table.
- **Specialty-based technician matching** — customers only see technicians
  who actually offer the booked service.
- **Self-claim + admin-assign** — technicians can claim unassigned jobs
  matching their specialty; admins can assign/reassign anyone.
- **Deposit + final payment** via Moyasar (sandbox-friendly, free to build
  against). Booking creation is never blocked by a failed/abandoned deposit —
  it's just flagged `unpaid` for follow-up.
- **Technician email notifications** on both deposit and final payment,
  sent via Nodemailer/SMTP.
- **bcrypt password hashing** (v1 stored plain text — fixed).
- Every screen redesigned with inline field-level validation.

## Setup

```bash
cd sps-app-v2
npm install
cp .env.example .env
# edit .env: set ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME / ADMIN_PHONE at minimum
npm start
```

Visit `http://localhost:3000`. The admin account is created automatically on
first startup from your `.env` values — log in with those credentials.

## Deploy to Render (free)

The repository includes a Render Blueprint in `../render.yaml`. In Render,
create a new Blueprint instance from this GitHub repository, then provide
`ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`, `ADMIN_PHONE`, and
`APP_BASE_URL` when prompted. Set `APP_BASE_URL` to the deployed HTTPS URL
(for example, `https://sound-provider-service.onrender.com`). Payments default
to mock mode; no real payment gateway is used.

The free service stores SQLite at `/tmp/data.sqlite3`, which is temporary.
Users, bookings, and other database records can be lost when the service
restarts or is redeployed. In-memory login sessions are also lost on restart.
Use a paid service with a persistent disk before relying on this deployment
for real customer data.

### Payments — dummy mode by default, no real money

`PAYMENT_MODE=mock` (the default) means **no real payment gateway is
involved at all**. When a customer pays a deposit or final balance, they're
sent to `/mock-checkout.html` — a page on this same app with a fake card form
and two buttons: **"Simulate Successful Payment"** and **"Simulate Failed
Payment"**. Clicking one calls our own backend, which processes the outcome
through the exact same code path a real gateway webhook would use (update
payment status → update booking/invoice → email the technician). This lets
you test the entire flow — booking → deposit → work → completion → final
payment — end to end, with zero external accounts and zero real money.

When you're ready for real payments:
1. Create a free Moyasar account and grab your **test/sandbox** secret +
   publishable keys.
2. Set `PAYMENT_MODE=moyasar`, `MOYASAR_SECRET_KEY`, `MOYASAR_PUBLISHABLE_KEY` in `.env`.
3. In the Moyasar dashboard, register your webhook URL as
   `https://<your-domain>/api/payments/webhook?secret_token=<pick-a-random-string>`
   and put that same random string in `MOYASAR_WEBHOOK_SECRET`.
4. Verify the integration shape against Moyasar's current docs
   (https://docs.moyasar.com) before going live — `server/payments.js` is the
   only file that talks to their API, so it's the one place to check.

The mock checkout is automatically and completely disabled the moment
`PAYMENT_MODE=moyasar` is set — its backend endpoint returns 404, so there's
no way to "fake" a payment once real mode is on.

### Email notifications (optional for local testing)

Leave `SMTP_HOST` blank to log notification emails to the console instead of
sending them. To enable real sending, set `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` — works with Brevo's free SMTP relay
(300 emails/day, no card required) or Gmail SMTP with an app password.

## Project structure

```
server/
├── index.js            Express bootstrap
├── db.js                Schema, admin seeding, and service catalog data
├── auth.js               bcrypt + session middleware
├── validators.js         All field validation rules
├── pricing.js             Price & deposit calculation
├── payments.js            Moyasar gateway client
├── notifications.js        Nodemailer wrapper
└── routes/
    ├── auth.js            register / login / logout / me / profile
    ├── services.js         catalog + pricing quotes
    ├── technicians.js       availability, self/admin status toggle, roster
    ├── bookings.js           full lifecycle: create/edit/cancel/assign/claim/status
    ├── payments.js            deposit/final checkout, webhook, refund
    ├── invoices.js             invoice lookup + manual mark-paid
    └── admin.js                  dashboard stats

public/
├── index.html
├── css/styles.css
└── js/
    ├── api.js             fetch wrapper for every endpoint
    └── app.js              full SPA: auth + customer + technician + admin screens
```

## Known non-goals (see REBUILD_PLAN.md §9)

- No forgot-password / email verification flow
- No account deactivation
- Sessions remain in-memory (lost on restart, single-process only)
- No automatic refunds on cancellation (admin-triggered only)
