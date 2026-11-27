# SecureOps — all-in-one platform for a security & fire protection company

One system for the office and the field. It runs as a **website** and installs on phones, tablets and computers as an **app** (a Progressive Web App), so it's one codebase with no app-store fees.

## What it does

| Area | Features |
|---|---|
| **Customers** | Residential vs. commercial accounts; multiple contacts per account (emails, phones, roles, who gets invoices); billing and service addresses with map/directions links; monitoring account #s; site-access notes; encrypted gate/door codes |
| **Systems on file** | **Camera systems**: NVR/DVR, IPs, ports, remote access, viewing app, admin and viewer logins. **Alarm systems**: panel, monitoring center, master/installer codes, zones. **Fire systems**: fire alarm, sprinkler, kitchen hood, fire pump, AHJ, panel codes. **Fire extinguishers**: one record per unit with location, type, size, annual and hydrostatic test dates |
| **Password security** | Camera passwords and alarm/panel/gate codes are **encrypted (AES-256-GCM)** in the database, hidden until someone clicks **Show**, auto-hidden after 30 s, and every reveal is written to the activity log |
| **Maintenance due** | One list of overdue and upcoming camera service, alarm tests, fire inspections, extinguisher annuals and hydro tests, plus vehicle service/registration/insurance. **Mark done** rolls the next due date forward automatically; **Schedule** turns it into a service call. Commercial customers' extinguishers can be marked inspected in bulk |
| **Service calls** | Work orders with type, priority (including emergency), technician, schedule, labor, parts used and resolution. Techs can start and complete jobs from their phone |
| **Scheduling** | Week board by technician with drag-and-drop rescheduling and booked-hours vs. 40-hour load bars; a "needs scheduling" queue; a day list on phones; a **My Day** screen for technicians |
| **Billing** | Recurring monthly charges per customer (monitoring, cloud video, service plans); **Run monthly billing** creates every invoice for the month in one click (safe to re-run); invoices from completed service calls (labor + parts); sales tax per line; partial payments; overdue tracking; printable/PDF invoices; email links; payments ledger |
| **Inventory** | Warehouse stock **plus inventory on each vehicle**. Receive (optionally logged as an expense), transfer/load trucks, physical counts, reorder alerts, full movement history. Parts used on a job are deducted from the tech's truck automatically |
| **Vehicles** | Fleet list, assigned tech, mileage, service/registration/insurance dates, on-board stock and its value, per-vehicle expenses |
| **Expenses & profit** | Categorized expenses; **Profit & loss** by month (residential vs. commercial revenue, collected, expenses, estimated labor cost, net); **Job profitability** per completed call |
| **Reports** | **Technician workload** (busiest tech, booked hours vs. capacity, calls, emergencies, labor billed/cost, backlog); **Residential vs. commercial** (customers, MRR/ARR, revenue, open balance); **A/R aging** (current / 30 / 60 / 90+) |
| **Team & security** | Roles: **Admin** (everything), **Office** (everything except users/settings), **Technician** (field work only, no billing or financials). Activity log, CSV exports, one-click database backup |

## Try it in 2 minutes

Requires **Node.js 22.5 or newer**. No other installs: the database (SQLite) is built into Node.

```bash
cd security-platform
npm run seed     # loads demo data (optional)
npm start        # http://localhost:3000
```

Demo logins (password `demo1234`): `admin@demo.local`, `office@demo.local`, `jen@demo.local` (technician).

For real use, **skip `npm run seed`**. The first visit asks you to create the owner/admin account. Then add technicians, vehicles, inventory items and customers.

Run the tests with `npm test`.

## Going live

The app has to run on a server everyone can reach. Options:

- **A small VPS** (DigitalOcean, Linode, Hostinger VPS, etc., ~$6–12/mo) running Node 22, behind **Caddy** or **nginx** for HTTPS.
- **Hostinger Node.js hosting**, or any host that runs Node.js apps with a persistent disk.

Settings (environment variables):

| Variable | Purpose |
|---|---|
| `PORT` | Port to listen on (default 3000) |
| `DATA_DIR` | Where the database and secret key live (default `./data`). **Must be on persistent storage** |
| `APP_SECRET` | Optional 64-hex-char encryption key for stored passwords. If not set, one is generated in `DATA_DIR/secret.key` |
| `COOKIE_SECURE=1` | Set when served over HTTPS (it always should be in production) |

**Back up both the database and the secret key.** Settings → Backup & data downloads the database. Stored passwords can't be decrypted without the key, so keep a copy of `secret.key` (or `APP_SECRET`) somewhere safe and separate.

Installing on phones: open the site, then **Add to Home Screen** (iPhone, from Safari) or **Install app** (Android, from Chrome).

## How it's built

- `server/` — plain Node.js (no frameworks or third-party packages): HTTP server, SQLite via `node:sqlite`, auth (scrypt password hashing, HttpOnly session cookies, CSRF header check, login rate limiting), AES-GCM encryption, business rules, reports.
- `public/js/schema.js` — **the data model, shared by server and browser**. Adding a field here adds the database column, the form input and the validation, with no other changes.
- `public/` — the web app (vanilla JavaScript modules), installable via `manifest.webmanifest` + `sw.js`.
- `test/` — end-to-end API tests (`node --test`).

## Good next steps

1. **Online card/ACH payments** via Stripe, with a "Pay now" link on each invoice and autopay for monthly monitoring.
2. **Send invoices by email automatically** (SMTP / SendGrid) instead of the current email link.
3. **Customer portal**: customers view and pay invoices and request service.
4. **QuickBooks export/sync** for the accountant.
5. **Text reminders** to customers before appointments and inspections.
6. **Photo uploads and signatures** on service calls (before/after pictures, inspection sign-off).
7. **Inspection checklists / NFPA report forms** for fire inspections.
