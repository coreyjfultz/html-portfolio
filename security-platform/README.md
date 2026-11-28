# SecureOps — all-in-one platform for a security & fire protection company

One system for the office and the field. It runs as a **website** and installs on phones, tablets and computers as an **app** (a Progressive Web App), so it's one codebase with no app-store fees.

## What it does

| Area | Features |
|---|---|
| **Customers** | Residential vs. commercial accounts; **multiple locations** per customer (each with its own systems, jobs, access notes and gate code); **businesses grouped under one owner** (parent account); multiple contacts; map/directions links; monitoring account #s; text/email preferences |
| **Alarm monitoring** | Every customer or site links to its **central-station account(s)**: station, account #, status, communicator ID, permit, encrypted passcode/duress, dispatch notes. Account numbers can be **assigned automatically** from each station's numbering. **Zones/sensors** are added and removed (removed ones stay as history), the **call list** is kept in order, and **all activity** — alarms, troubles, restores, openings/closings, tests and every change — shows on the account. Techs **put systems on test** (from the job on their phone) and tests end automatically. Customers see their alarm activity in the portal |
| **Sales pipeline** | Every customer has a stage — **Lead → Site survey → Bid sent → Accepted → Installation → Active** (or Lost) — shown on a drag-and-drop board, with history. Stages move automatically: scheduling a site survey, sending a proposal, the customer signing, booking and finishing the install |
| **Proposals & agreements** | Sales builds proposals and installation / monitoring / service agreements from inventory and labor, with monthly fees, term and deposit. Customers **review and sign online** on any device (finger or mouse). Each signature records name, time, IP, device and a **SHA-256 fingerprint of the exact document**; signed documents are locked. Signing automatically starts monthly billing, creates the installation job and a deposit invoice |
| **Systems on file** | **Camera systems**: NVR/DVR, IPs, ports, remote access, viewing app, admin and viewer logins. **Alarm systems**: panel, monitoring center, master/installer codes, zones. **Fire systems**: fire alarm, sprinkler, kitchen hood, fire pump, AHJ, panel codes. **Fire extinguishers**: one record per unit with location, type, size, annual and hydrostatic test dates |
| **Password security** | Camera passwords and alarm/panel/gate codes are **encrypted (AES-256-GCM)** in the database, hidden until someone clicks **Show**, auto-hidden after 30 s, and every reveal is written to the activity log |
| **Fire inspection reports** | Inspection reports for **fire alarm (NFPA 72), sprinkler (NFPA 25), kitchen suppression / hoods (NFPA 96 / 17A), special-hazard fire suppression — clean agent, CO2, dry chemical, water mist (NFPA 2001 / 12 / 17 / 750), extinguishers (NFPA 10), emergency lighting (NFPA 101)** and other systems. The tech fills them in on the phone: Pass / Fail / N/A checklists with readings (battery voltage, pressures, agent weights), a **device-by-device test list** that carries over to next year, and an **extinguisher walk-through** (pass / fail / replaced / removed / missing, plus annual, 6-year, hydro and recharge). Failures become a **deficiency list** and, if wanted, a follow-up job. The customer signs on screen; completing the report locks it and rolls the system's and each extinguisher's due dates forward. **Send** emails the customer and the **fire marshal (AHJ)** a private link to view or print it; customers also see their reports in the portal. Checklists live in `public/js/inspections.js` — plain-language starting points, to be checked against the code editions your AHJ enforces |
| **Fire extinguishers** | One record per unit: tag/barcode #, spot and floor, type, size, UL rating, brand, serial, manufacture date, stored-pressure / cartridge / disposable, mounting. Due dates are worked out automatically: **annual**, **6-year maintenance** (stored-pressure dry chemical), **hydrostatic test** (5 or 12 years from manufacture or the last test), and **12-year replacement for disposable units**. Every inspection, recharge, hydro and replacement is kept in the unit's **history** |
| **Maintenance due** | One list of overdue and upcoming camera service, alarm tests, fire inspections, extinguisher annuals and hydro tests, plus vehicle service/registration/insurance. **Mark done** rolls the next due date forward automatically; **Schedule** turns it into a service call. Commercial customers' extinguishers can be marked inspected in bulk |
| **Service calls** | Work orders with type, priority, technician, schedule, labor, parts and resolution. Techs tap **On my way** (texts the customer), take **before/after photos**, and get the **customer's signature** on the phone when they finish; the signature prints on the invoice. **A job can't be completed without at least one before and one after photo and the parts used (or "No parts used")** — owners/admins can override with a reason that's saved on the job (Settings → Field rules) |
| **Customer sign-off** | A job can't be completed without the customer's signature on the phone, unless an owner/admin approved it beforehand ("Customer won't be on site" on the job, or "Usually nobody on site" on the customer for after-hours commercial work) or approves it at completion with a reason. Technicians can't skip it themselves |
| **Equipment, serial numbers & warranty** | Items marked "track serial numbers" (cameras, recorders, panels…) create a line on the job for each unit used: the tech enters the **serial #** and where it's installed and photographs the **label / warranty info** — required to complete the job. Everything lands on the customer's **Equipment** tab with warranty end dates (from the item's warranty months), status (installed / replaced / removed / RMA) and photos. Search any serial number from the top bar; duplicate serials are caught |
| **Vehicle checklist** | Daily (or weekly) truck check on the phone before the first job: oil and fluids, each tire's pressure against the truck's target, tread, every light, glass and wipers, a damage walk-around (photos required for damage), warning lights, safety gear, clean cab and outside. Problems alert the owner/admins; the odometer reading keeps mileage current; history with photos on the vehicle page |
| **Customer surveys & technician ratings** | A couple of hours after a job is completed, the customer gets a short text/email link (per their preferences, at most once a month, never to customers who opted out): overall stars, stars for the technician, on time yes/no and a comment. Five-star customers are offered your Google review link; low scores or a late arrival alert the owner right away, and the follow-up is logged. **Customer ratings** shows each technician's average, response rate, on-time %, low scores, a 6-month trend and every comment. The office can also send one from any completed job |
| **Team chat** | Built-in chat for the whole team: an **Everyone** channel, one-to-one messages, group chats, and a **thread per job** ("Message the office" on the job page — the assigned tech plus owners/admins). Photos in messages, unread counts in the menu, live delivery while the app is open, and **push notifications** on phones and computers that allow them (on iPhone, install the app to the home screen first). Mute any conversation; delete your own message within 15 minutes. **Chats are company records:** for an incident, owners and administrators can open **Chat records**, give a reason, and search or read any conversation, including direct messages and deleted messages, and export it to CSV. Every conversation opened is written to the activity log with the reason, owners are alerted when an administrator starts a review, and the chat screen tells employees this |
| **Time off** | Anyone requests time off (vacation, sick, personal, training; whole days or part of a day). Owners/admins are alerted, see any jobs or on-call shifts already booked in that window, and approve or deny with a note; the person gets a text/email. Approved time off **blocks scheduling** that tech (owners/admins can book anyway), appears on their Outlook/Google calendar feed and the central one, and shows as “Out today” on the dashboard. The office can add time off for someone directly. **Balances:** everyone sees how much vacation, sick and personal time they have left this year (yearly allowance + carryover − approved; weekends and company holidays aren't charged). Company defaults are set in Settings → HR & time off, with per-person amounts and carryover on the Time off page; requests over the balance are refused unless allowed. **Company holidays** (US preset with observed dates, plus your own) show on the in-app calendar, everyone's Outlook/Google feeds and My Day, and booking a job on one asks first (emergencies excepted) |
| **Pay & benefits (optional add-on)** | Off until an owner turns it on (Settings → HR & time off). Adds **My pay & benefits** for everyone: a one-tap link to the payroll provider's employee site (QuickBooks Workforce by default, or Gusto / ADP / Paychex / other), where pay stubs, W-2s, direct deposit and W-4 changes live; the company's **benefit plans** (coverage, member phone, website, enrollment); their time-off balances; and **private documents** the owner or accounting post for them (pay stubs, W-2s, benefit papers). Only the employee, the owner and accounting can open someone's documents, and the office sees when they've been opened |
| **Backups** | Nightly, automatic, as one file: database plus photos, signatures, invoices, HR documents and manuals. **Encrypted** with a backup password, which also carries the app's encryption key, so the password alone restores everything. **Local**: a folder on the server or a second disk; every backup from the last 14 days, then one per week (8) and per month (12). **Off-site**: each backup is uploaded to S3-compatible storage at another company (Backblaze B2, Amazon S3, Cloudflare R2, Wasabi) and **locked against deletion** (Object Lock) so even someone who breaks into the server can't erase it; the app never deletes off-site. **Checks**: the owner is alerted on failures or if backups stop; a **restore test** runs monthly (and on demand). **Recover a deleted customer** from any backup without rolling back anything else. Full restore on this server or a brand-new one (`npm run restore -- --offsite latest`). Optional continuous database backup with Litestream |
| **Supervisors & org chart** | Each person can have a job title and a supervisor (Settings → Users → *Reports to*). **Our team** shows the org chart to everyone, with one-tap message and call. A supervisor approves or denies time off for the people under them (directly or further down): they get a phone notification and email, see a *Waiting for your approval* card on My Day / the dashboard and the Time off page, can add or cancel time off for their team, and see their team's tasks (Tasks → My team). Your own requests go to your supervisor. By default owners and admins **also get every request** (phone notification + email) and can approve or deny any of them but their own; Settings → HR & time off can switch either off for "supervisors only" (anyone without a supervisor still goes to owners/admins). Loops are refused, and when a supervisor leaves, their team moves up to the next level |
| **In-app calls** | Team members call each other from Team chat (📞 in the list, or **Call** in a one-to-one conversation), phone or computer, over the internet, with no phone numbers and no per-minute cost. The other person gets a full-screen incoming call with Answer / Decline (and a phone notification if the app is closed), then a call screen with mute and a timer. Calls are logged in their chat ("📞 Call · 3:12", "Missed call"). Audio goes device to device; when a cell network or firewall blocks that, a **relay server** fixes it: Twilio (uses the existing account) or your own free relay (`deploy/docker-compose.turn.yml`). One-to-one calls only |
| **Tasks** | To-dos for yourself or anyone on the team ("pick up panels at ADI", "return the Amazon order", "deposit checks"), with a due date, priority, place and notes. **Repeating tasks**: daily or every few days, every weekday, weekly on chosen days (or every other week), or monthly on a day (31 = last day of the month), with an optional end date. A new to-do appears on each date; if the last one is still open it isn't doubled up. The person gets a phone notification and email when given a task, and the person who assigned it is told when it's done. A morning reminder goes to anyone with tasks due. Tasks show on **My Day** and the **dashboard**, with a count in the menu. Managers can see everyone's open tasks. **On the calendar:** every dated task shows on the in-app calendar and the Outlook/Google feeds, all day or at a set time. Tick **Block this time** and nobody can book a job for that person then (the whole day, or e.g. 1–2:30 pm); owners/admins can book anyway, like time off. Repeating blocks (a weekly safety meeting) block their future dates too. Others' blocked time shows as "Busy" unless you made or manage the task |
| **Training library & support contacts** | A searchable library of how-to **videos** (YouTube and Vimeo play right in the app), **manual PDFs**, how-to articles and links, grouped by category (alarm panels, cameras, fire alarm, suppression, extinguishers, safety, company policies…). Owners/admins add items and upload PDFs; everyone can read them on a phone. **Support contacts** lists manufacturer tech support, RMA desks, distributor reps and the central station, with tap-to-call, hours, and your dealer/account numbers |
| **Help assistant (optional)** | Off until an owner turns it on (Settings → Help assistant) and the server has `ANTHROPIC_API_KEY`. Techs type a question on the Training library page and get a short answer from Claude that uses your own library items, manual PDFs and support contacts, names the library items it used, and stresses life-safety steps (notify the central station, follow NFPA/AHJ). Follow-up questions work. A daily per-person limit keeps costs down, and owners can see recent questions (and which answers were marked helpful) to spot gaps in the library. Only the question and matching library content are sent, never customer records |
| **Technicians see only their customers** | On the phone app and the website, a technician only sees customers, systems, passwords and monitoring accounts for jobs on their schedule (last 7 days to next 14). The office can give temporary access (customer → *Tech access*), and answering an after-hours call gives the on-call tech 24 hours of access to that caller automatically |
| **Scheduling & calendars** | Central **month calendar** (all techs, or filter to one) and a drag-and-drop **dispatch board**. **Double-booking a technician is blocked** (owners/admins can override). Jobs appear in **Outlook / Google / iPhone calendars**: techs get an email calendar invite when booked, moved or unassigned, and everyone can subscribe to a live feed (central or per tech) |
| **Texts & emails** | Customers get a confirmation when a job is scheduled or moved and an **"on the way"** text/email from the tech (per their preferences). Wording is editable. Works with any email account (SMTP: Microsoft 365, Gmail…) and Twilio for texting; every message is logged on the job |
| **Billing & payments** | Recurring monthly charges; **Run monthly billing** creates every invoice in one click; invoices from completed jobs (labor + parts); sales tax; partial payments; overdue tracking; polished printable/PDF invoices. Payments by **cash, check, credit card and bank ACH** — card/ACH online through Stripe: "Pay now" links, saved cards/bank accounts, **charge on file**, automatic recording |
| **Customer portal** | Customers sign up (email verified) or are invited, then land in their own portal: balance and invoices, **pay online**, **change payment method**, past and upcoming service with photos, **request service** (preferred day/time), **request equipment** (becomes a draft quote for sales), sign agreements, see their systems, update contact info and text/email preferences. Owners of several businesses switch between them |
| **QuickBooks & accounting** | **QuickBooks Online sync** (connect once; customers, invoices — including edits and voids — and payments flow over automatically). Export files for **QuickBooks Desktop (IIF)**, QuickBooks Online import, **Xero**, and a generic CSV for FreshBooks, Wave, Zoho, Sage or Excel |
| **Inventory** | Warehouse stock **plus inventory on each vehicle**. Receive (optionally logged as an expense), transfer/load trucks, physical counts, reorder alerts, full movement history. Parts used on a job are deducted from the tech's truck automatically |
| **Truck stock & weekly counts** | A **standard truck stock** (minimum and maximum per item — batteries, contacts, wire, connectors… a spare or two, not a pile of extras) applies to every truck, with per-truck exceptions. Each truck shows what's **short** and what's **too many**; one tap restocks from the warehouse or returns extras. Every week (day of your choice) each tech does a **blind count of every item and tool on their truck**; differences correct the stock and **alert the owner and the inventory manager** with the dollar value, and techs get a reminder text on count day. Items used repeatedly from a truck but not on its list are suggested for it |
| **Tools** | Ladders, meters, drills and other equipment with asset tags, serials, cost, which truck they're on and status (in service / needs repair / missing). Tools are part of the weekly truck count; missing tools alert the owner |
| **Job materials & start-of-day check** | Equipment for a job (copied automatically from a signed proposal, or added by the office) is **checked out of the warehouse onto the tech's truck**, and unused items are returned. Each morning, before the first job, the tech does a **start-of-day check** — confirming they have the materials for today's jobs (with spares) and their tools. **They can't start a job ("On my way" / "Start") until it's done**; anything missing alerts the office, and **only an owner or administrator can let them start anyway** (with a reason) |
| **Receiving (supplier invoices)** | Distributor invoices that are **emailed in, uploaded, or photographed** are read automatically (PDF, photo, email text or CSV), matched to your inventory by part #, and **added to stock**, with the purchase logged as an expense and item costs updated. Anything uncertain waits in a review inbox, shown side by side with the original document. The system learns each distributor's part numbers as you match them |
| **Vehicles** | Fleet list, assigned tech, mileage, service/registration/insurance dates, on-board stock and its value, per-vehicle expenses; live location, and links to the vehicle in your tracking system and its **dash cam** (owners/admins) |
| **Live map & travel time** | Connects to your **GPS tracking** (Samsara built in; any other provider through a JSON feed or webhook). **Live map** of every truck, today's jobs and the office, with a **team dashboard**: who's clocked in, current job, next job, drive time and **whether they'll make it on time**. When scheduling, the app **blocks booking a tech somewhere they can't reach in time** from their previous job (or make their next one), using real drive times (OSRM or Google with traffic) or an estimate; owners/admins can book anyway |
| **Time clock** | Everyone clocks in and out from the app (phone or computer); the location is recorded with each punch. **Clocking in away from the office — or without sharing a location — alerts the owner** with a map link (a job the tech is scheduled at today counts as OK). Timesheets with regular/overtime hours, corrections with a reason, CSV export for payroll |
| **On-call & company phone** | An **on-call rotation** (primary + backup) that lands on each tech's **Outlook/Google calendar** (feed + emailed invite) with a text before each shift. A **company phone number (Twilio)**: during office hours calls ring the office; after hours they ring the **on-call tech, then the backup, then voicemail**. The tech hears who's calling ("After hours call from Harbor Dental — press 1 to accept"). Techs and the office **call customers from the app** — their own phone rings first, then the customer, who sees the **company number**, so personal numbers stay private. Optional direct numbers per tech. Call log with voicemail playback; missed calls and voicemails alert the office |
| **Owner alerts** | Truck count differences, missing tools, techs short on equipment, clock-ins away from the office, voicemails and missed calls show on the dashboard and are emailed (optionally texted) to the owner |
| **Expenses & profit** | Categorized expenses; **Profit & loss** by month (residential vs. commercial revenue, collected, expenses, estimated labor cost, net); **Job profitability** per completed call |
| **Reports** | **Technician workload** (busiest tech, booked hours vs. capacity, calls, emergencies, labor billed/cost, backlog); **Residential vs. commercial** (customers, MRR/ARR, revenue, open balance); **A/R aging** (current / 30 / 60 / 90+) |
| **Team & roles** | **Owner / Global admin** (everything, incl. admins and backups), **Administrator** (runs the business, but not owner accounts or backups), **Sales** (leads, pipeline, proposals, site surveys; no invoices or financials), **Accounting** (invoices, payments, expenses, receiving, reports, QuickBooks), **Technician** (their jobs, schedule, systems & passwords, photos, signatures, truck inventory), **HR** (everyone's time off, balances, holidays, users & supervisors, pay stubs & benefits, chat records; no customers, jobs or billing). **Custom roles** (Settings → Roles & permissions, owner only): pick which customers the role sees (all / only their own schedule like a technician / none) and what else it can do (office basics, edit customers, sales, billing & accounting, operations admin, time off for everyone, users & supervisors, pay & benefits admin, chat records). Changes apply right away; built-in roles can be copied as a starting point. Activity log, CSV exports |

## Try it in 2 minutes

Requires **Node.js 22.13 or newer**. The database (SQLite) is built into Node.

```bash
cd security-platform
npm install      # the Claude SDK (supplier-invoice reading) and nodemailer (email)
npm run seed     # loads demo data (optional)
npm start        # http://localhost:3000
```

Demo logins (password `demo1234`): `owner@demo.local`, `admin@demo.local`, `sales@demo.local`, `accounting@demo.local`, `hr@demo.local`, and technicians `jen@demo.local`, `mike@demo.local`, `sam@demo.local`.
Customer portal: http://localhost:3000/portal — `becker@example.com` / `demo1234`.

For real use, **skip `npm run seed`**. The first visit asks you to create the owner account. Then add your team (Settings → Users), technicians, vehicles, inventory items and customers.

Upgrading an existing database is automatic: old *admin* users become **Owners** and old *office* users become **Administrators**.

Run the tests with `npm test`.

## Going live

**Step-by-step checklist: [`deploy/GO-LIVE.md`](deploy/GO-LIVE.md).** In short: a small Linux VPS (~$6–12/mo), point `app.yourcompany.com` at it, then

```bash
cp .env.example .env    # set DOMAIN and TZ
docker compose up -d --build
```

That runs the app plus [Caddy](https://caddyserver.com), which gets and renews the HTTPS certificate automatically. Nightly encrypted backups, with an optional off-site copy, are built in; `/api/health` is there for uptime monitoring. Without Docker, use `deploy/secureops.service` (systemd) behind Caddy or nginx.

Settings (environment variables):

| Variable | Purpose |
|---|---|
| `PORT` | Port to listen on (default 3000) |
| `DATA_DIR` | Where the database and secret key live (default `./data`). **Must be on persistent storage** |
| `APP_SECRET` | Optional 64-hex-char encryption key for stored passwords. If not set, one is generated in `DATA_DIR/secret.key` |
| `COOKIE_SECURE=1` | Set when served over HTTPS (it always should be in production) |
| `TRUST_PROXY=1` | Set when the app sits behind Caddy/nginx/a load balancer, so it uses the real visitor address and https from the proxy's headers. **Leave unset if the app is reachable directly**, or people could fake those headers |
| `TZ` | Time zone for schedules, timesheets, reminders and backups, e.g. `America/New_York` |
| `BACKUP_HOUR`, `BACKUP_DIR`, `BACKUP_PASSPHRASE`, `OFFSITE_*` | Normally set in Settings → Backup & data; these override it (useful when restoring onto a new server, see deploy/GO-LIVE.md). `BACKUP_DISABLED=1` turns nightly backups off |
| `ANTHROPIC_API_KEY` | Claude API key, used to read supplier invoice PDFs, photos and emails, and for the optional help assistant. Optional: without it, CSV invoices still work, other documents are entered by hand, and the assistant stays hidden |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Outgoing email (or enter them in Settings → Texts & email) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Text messages (or Settings → Texts & email) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Online card/ACH payments (or Settings → Payments) |
| `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET` | QuickBooks Online app keys (or Accounting page) |

Secrets entered in Settings are stored encrypted with the same key as camera passwords and are never shown again after saving.

**Set up backups before real data goes in:** Settings → Backup & data — a backup password, then an off-site copy (deploy/GO-LIVE.md walks through Backblaze B2). Keep the backup password, and a copy of `secret.key` (or `APP_SECRET`), somewhere safe and separate.

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

## Connecting the outside services

Everything works without these; each one switches on a feature. Owners/admins set them up in the app.

| Service | What it enables | Where | Notes |
|---|---|---|---|
| **Email (SMTP)** | Appointment confirmations, invites to techs' calendars, invoice and signing links, portal invites, receipts | Settings → Texts & email | Microsoft 365 needs SMTP AUTH enabled for the sending mailbox; Gmail needs an app password. "Send test email" checks it |
| **Twilio** | Text confirmations and "on my way" | Settings → Texts & email | US business texting requires registering your number for **A2P 10DLC** in Twilio (a few days). Customers can reply STOP |
| **Stripe** | Card and ACH payments, saved payment methods | Settings → Payments | Add the webhook endpoint shown there with the listed events. Start with test keys (`sk_test_…`) |
| **QuickBooks Online** | Automatic invoice/customer/payment sync | Accounting | Create an app at developer.intuit.com, add the redirect URI shown, paste the keys, click Connect. Try the sandbox first |
| **Outlook / Google calendars** | Jobs in everyone's normal calendar | Calendar → "Sync to Outlook / Google", Settings → Calendars | Invites need email set up; subscription feeds work right away |
| **Claude API** | Reading supplier-invoice PDFs/photos; the optional help assistant | `ANTHROPIC_API_KEY` | See Receiving below; turn the assistant on in Settings → Help assistant |
| **Twilio Voice** (same account as texting) | Company phone line: office hours / on-call routing, voicemail, click-to-call | Settings → Phone & on-call | Buy a local number (or port your existing one) in Twilio, then paste the webhook address shown there into the number's *Voice configuration*. Needs the public web address set (Settings → Calendars). Every webhook is verified with your Twilio auth token |
| **GPS tracking** (Samsara or other) | Live map, team ETAs, links to dash cams | Settings → Tracking & maps | Samsara: create an API token with read access to vehicles. Others: a JSON feed URL, or have the provider POST to the push address shown. Put each vehicle's tracker ID and its tracking / dash-cam links on the vehicle |
| **Maps & routing** | Addresses on the map; real drive times for scheduling | Settings → Tracking & maps | Free: OpenStreetMap (address lookup, 1/second) + public OSRM routing (fine for light use; run your own OSRM or use Google for heavy use). Google Maps (Geocoding + Distance Matrix API key) adds live traffic |

Things to have a professional review before relying on them:
- **Agreement terms:** the default terms in Settings → Company are a starting point; have your attorney adjust them for your state and services. Electronic signatures capture consent, identity details and a tamper-evident fingerprint in line with the U.S. ESIGN Act / UETA.
- **Sales tax:** confirm rates and taxable items with your accountant (and the QuickBooks item used for tax).

## Alarm monitoring & connecting a central station

Set up under **Monitoring → Stations**: add the station you use (e.g. CMS) with its operator line, dealer number and, if you number accounts yourself, the prefix and next number. Then add a monitoring account from any customer's **Monitoring** tab (or click **Import from alarm systems** to convert the station/account numbers already typed on alarm systems).

**Today the station connection is "manual".** Everything is tracked here, and the screens say so plainly: putting an account on test, adding/removing a zone or changing the call list does **not** change anything at the station until someone calls the station or uses its dealer portal. Each account shows "not confirmed with station" until someone clicks **Confirmed with station**. This avoids anyone assuming an account is on test when the station doesn't know.

**Signals in:** each station has a private **signal feed** address (Stations → Signal feed). The station, or a middleware/receiver service, can POST alarm events to it and they appear in the account's activity, matched by account number. Contact ID (`E130`, `R401`, `E602`…) and SIA (`BA`, `OP`, `RP`…) codes are recognized; signals received while an account is on test are marked as test; resent events are ignored.

**Next step: a direct connection.** To create station accounts automatically when a customer is created, and to send tests and zone/call-list changes straight to the station, a connector is added in `server/monitoring.js` (`CONNECTORS`). It implements `createAccount`, `updateAccount`, `saveZone`, `removeZone`, `putOnTest`, `clearTest` and optionally `fetchEvents`; the screens already call these. What's needed from the station: its dealer integration (most wholesale stations run Manitou, MASterMind, stages or SIMS and offer an API or data exchange to dealers) and API credentials for your dealer account.

## How it's built

- `server/` — plain Node.js (no web framework; packages: the Anthropic SDK for invoice reading, nodemailer for email): HTTP server, SQLite via `node:sqlite`, auth (scrypt password hashing, HttpOnly session cookies, CSRF header check, login rate limiting), AES-GCM encryption, business rules, reports.
- `public/js/schema.js` — **the data model, shared by server and browser**. Adding a field here adds the database column, the form input and the validation, with no other changes.
- `public/` — the web app (vanilla JavaScript modules), installable via `manifest.webmanifest` + `sw.js`.
- `server/receiving.js` + `server/extract.js` — supplier-invoice intake, CSV parsing, matching, auto-receive rules, and the Claude call.
- `server/proposals.js` — proposals, signing links, e-signature and what happens after signing. `public/sign.html` is the customer's signing page.
- `server/portal.js` + `public/portal.html` — the customer portal (its own logins, separate from staff).
- `server/monitoring.js` — monitoring accounts, zones, test mode, signal feed and the station connector slot.
- `server/truckstock.js` — standard truck stock, weekly counts, tools, job materials and the start-of-day check. `server/alerts.js` — owner alerts.
- `server/timeclock.js` — clock in/out, geofence, timesheets. `server/phone.js` — on-call shifts and the Twilio voice line. `server/tracking.js` — GPS providers, geocoding, drive times, travel-time checks, team status.
- Maps: [Leaflet](https://leafletjs.com) 1.9.4 (BSD-2), served from `public/vendor/leaflet`; map tiles from OpenStreetMap (configurable).
- `server/notify.js` (email/text), `server/calendar.js` (Outlook/Google feeds and invites), `server/payments.js` (Stripe), `server/quickbooks.js` (QuickBooks sync and exports), `server/media.js` (photos, signatures, logo).
- `public/js/doc.js` — the shared invoice and agreement document layout.
- Icons: [Lucide](https://lucide.dev) (ISC); font: Inter (SIL Open Font License), both served from this app.
- `server/inspections.js` + `public/js/inspections.js` — fire inspection reports and their checklists; `public/report.html` is the customer / fire-marshal view.
- `server/vehiclechecks.js` + `public/js/vehicle-checks.js` — the vehicle checklist. `public/js/pages/equipment.js` — installed equipment and serial numbers.
- `server/surveys.js` + `public/survey.html` — post-job surveys and technician ratings.
- `server/chat.js` + `server/push.js` — team chat (live via Server-Sent Events) and Web Push notifications (VAPID, no message text sent through the push services).
- `server/timeoff.js` + `server/hr.js` — time-off requests, balances, company holidays and the scheduling blocks.
- `server/pay.js` — the optional pay & benefits add-on (documents stored in `DATA_DIR/hrdocs`, included in backups).
- `server/backup.js` — backups: the encrypted `.sobak` format, retention, off-site upload, restore tests, alerts, recovering a deleted customer, restore (`npm run backup`, `npm run restore -- <name>|--offsite latest`). `server/s3.js` — small S3-compatible client (Signature V4, multipart, Object Lock). `server/net.js` — reverse-proxy header handling.
- `Dockerfile`, `docker-compose.yml`, `deploy/` — production setup (Caddy HTTPS, systemd unit, go-live checklist).
- `test/` — end-to-end API tests (`node --test`). Outside services (Claude, Twilio, Stripe, QuickBooks, email) are tested against local stand-ins, so the tests run offline.

## Handing this project off

Everything needed is in this folder. To pick it up:

1. Clone the repo, `cd security-platform`, `npm install`, `npm test` (all tests should pass), `npm run seed && npm start` to explore with demo data.
2. Read `public/js/schema.js` first: it defines every record type and field. Then `server/routes.js` (business endpoints) and `public/js/pages/` (one file per screen).
3. To go live: follow **Going live**, then **Connecting the outside services** and **Supplier invoices → Connecting email**, using accounts owned by the company (email, Twilio, Stripe, Intuit, Anthropic).
4. Start a real database empty (no `seed`): create the admin account, then enter technicians, vehicles, inventory items (with part #s matching your distributors' where possible) and customers. Existing customer lists can be imported by asking a developer to load a CSV.

## Good next steps

1. **Autopay** for monthly monitoring (charge saved cards/ACH automatically after the monthly billing run).
2. **Two-way calendar sync** with Microsoft 365 / Google (today the app sends invites and feeds; edits made in Outlook don't flow back).
3. **Deficiency quotes**: turn an inspection’s deficiency list into a priced proposal the customer can sign online.
4. **Purchase orders & reorder emails** from low-stock items, matched against incoming supplier invoices.
5. **Dash-cam video in the app**: today vehicles link to the provider's live view; Samsara's media API could show recent clips right on the vehicle page.
6. **Automatic dispatch suggestions**: use live truck positions and drive times to suggest the closest available tech for an emergency call.
7. **Group calls / video** (in-app calls are one-to-one voice today).
8. **Native app store listing** (the installable web app already covers phones; a store listing adds push notifications on iPhone).
