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
| **Receiving (supplier invoices)** | Distributor invoices that are **emailed in, uploaded, or photographed** are read automatically (PDF, photo, email text or CSV), matched to your inventory by part #, and **added to stock**, with the purchase logged as an expense and item costs updated. Anything uncertain waits in a review inbox, shown side by side with the original document. The system learns each distributor's part numbers as you match them |
| **Vehicles** | Fleet list, assigned tech, mileage, service/registration/insurance dates, on-board stock and its value, per-vehicle expenses |
| **Expenses & profit** | Categorized expenses; **Profit & loss** by month (residential vs. commercial revenue, collected, expenses, estimated labor cost, net); **Job profitability** per completed call |
| **Reports** | **Technician workload** (busiest tech, booked hours vs. capacity, calls, emergencies, labor billed/cost, backlog); **Residential vs. commercial** (customers, MRR/ARR, revenue, open balance); **A/R aging** (current / 30 / 60 / 90+) |
| **Team & security** | Roles: **Admin** (everything), **Office** (everything except users/settings), **Technician** (field work only, no billing or financials). Activity log, CSV exports, one-click database backup |

## Try it in 2 minutes

Requires **Node.js 22.5 or newer**. The database (SQLite) is built into Node.

```bash
cd security-platform
npm install      # one dependency: the Claude SDK used to read supplier invoices
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
| `ANTHROPIC_API_KEY` | Claude API key, used only to read supplier invoice PDFs, photos and emails. Optional: without it, CSV invoices still work and other documents are entered by hand |

**Back up both the database and the secret key.** Settings → Backup & data downloads the database. Stored passwords can't be decrypted without the key, so keep a copy of `secret.key` (or `APP_SECRET`) somewhere safe and separate.

Installing on phones: open the site, then **Add to Home Screen** (iPhone, from Safari) or **Install app** (Android, from Chrome).

## Supplier invoices → inventory (Receiving)

How it works:

1. A distributor invoice or packing slip comes in by **email** (see below), by **Upload**, or by **📷 Photo of slip** on a phone (Receiving page).
2. It's read automatically: **CSV** files directly; **PDFs, photos and email text** by Claude (Anthropic's AI). The system extracts vendor, invoice #, date, totals, and each line's part #, description, quantity *shipped*, and unit cost.
3. Each line is matched to an inventory item by part #, then by distributor part numbers it has learned, then by exact name. Claude may *suggest* a match, but a suggestion is never received without a person confirming it.
4. **Auto-receive** (Settings → Receiving): when every line matches by part #, the line total agrees with the invoice subtotal, it isn't a duplicate (same vendor + invoice #), and an emailed invoice comes from a **trusted distributor domain**, the stock is added straight away. Item costs are updated and one *Parts & equipment* expense is recorded.
5. Everything else lands in **Receiving → Needs review**. The original document is shown next to the lines, so you can fix a quantity, pick or create the item, skip a line, choose which truck/warehouse it goes into, and click **Receive into stock**. The part # you matched is remembered for that item, so next time it matches automatically.

### Turning on AI reading of PDFs/photos

1. Create an API key at console.anthropic.com (pay-as-you-go; a one-page invoice typically costs a few cents to read).
2. Set it on the server as the environment variable `ANTHROPIC_API_KEY` and restart. Settings → Receiving shows **On** when it's picked up.

Invoice documents are sent to Anthropic's API to be read. The model is `claude-opus-5-5` (override with `CLAUDE_MODEL`). Server-side refusal fallbacks are enabled, so if the model declines a document the API automatically retries it on a fallback model.

### Connecting email

Use the private webhook address shown in **Settings → Receiving** (admins only). Pick one:

- **Postmark Inbound** (simplest; free tier covers typical volume): create an Inbound stream, set its webhook URL to the address above, then in Outlook/Microsoft 365 or Gmail add a rule that **forwards emails from your distributors** (or everything sent to e.g. `invoices@yourcompany.com`) to the Postmark inbound address.
- **Microsoft Power Automate / Zapier / Make**: trigger "When a new email arrives" (filter by sender or folder), then an HTTP **POST** to the webhook address with a JSON body:
  ```json
  { "from": "billing@adiglobal.com", "subject": "Invoice 12345", "text": "email body",
    "attachments": [ { "filename": "12345.pdf", "contentType": "application/pdf", "content": "<base64 file contents>" } ] }
  ```

Each PDF, image or CSV attachment becomes its own entry (small signature images are ignored). An email with no attachment is read from its text. Add your distributors' email domains (e.g. `adiglobal.com, anixter.com`) under **Trusted distributor email domains** so their invoices can be received automatically. Mail from anyone else always waits for review, so a spoofed email can't change your stock. If the address ever leaks, click **Make a new address**.

Try it with `samples/adi-invoice-sample.csv` on the Receiving page.

## How it's built

- `server/` — plain Node.js (no web framework; the only package is the Anthropic SDK, loaded only for invoice reading): HTTP server, SQLite via `node:sqlite`, auth (scrypt password hashing, HttpOnly session cookies, CSRF header check, login rate limiting), AES-GCM encryption, business rules, reports.
- `public/js/schema.js` — **the data model, shared by server and browser**. Adding a field here adds the database column, the form input and the validation, with no other changes.
- `public/` — the web app (vanilla JavaScript modules), installable via `manifest.webmanifest` + `sw.js`.
- `server/receiving.js` + `server/extract.js` — supplier-invoice intake, CSV parsing, matching, auto-receive rules, and the Claude call.
- `test/` — end-to-end API tests (`node --test`), including the receiving flow against a stand-in Claude API.

## Handing this project off

Everything needed is in this folder. To pick it up:

1. Clone the repo, `cd security-platform`, `npm install`, `npm test` (all tests should pass), `npm run seed && npm start` to explore with demo data.
2. Read `public/js/schema.js` first: it defines every record type and field. Then `server/routes.js` (business endpoints) and `public/js/pages/` (one file per screen).
3. To go live: follow **Going live**, then **Supplier invoices → Connecting email**, using the company's own mailbox and a Claude API key on the company's account.
4. Start a real database empty (no `seed`): create the admin account, then enter technicians, vehicles, inventory items (with part #s matching your distributors' where possible) and customers. Existing customer lists can be imported by asking a developer to load a CSV.

## Good next steps

1. **Online card/ACH payments** via Stripe, with a "Pay now" link on each invoice and autopay for monthly monitoring.
2. **Send invoices by email automatically** (SMTP / SendGrid) instead of the current email link.
3. **Customer portal**: customers view and pay invoices and request service.
4. **QuickBooks export/sync** for the accountant.
5. **Text reminders** to customers before appointments and inspections.
6. **Photo uploads and signatures** on service calls (before/after pictures, inspection sign-off).
7. **Inspection checklists / NFPA report forms** for fire inspections.
8. **Purchase orders & reorder emails**: create POs from low-stock items and match incoming invoices against them.
