# 21 — Settings reference

Every setting, tab by tab, with its default and what it does. **Menu → Settings.** Owners and administrators see every tab; HR sees *HR & time off*, *Users & logins* and *Roles & permissions*; backup settings are owner-only. Changes take effect immediately after **Save**.

Fields marked 🔒 are secrets: stored encrypted, never shown again (*Saved — leave blank to keep*).

---

## Company & billing

| Setting | Default | What it does |
|---|---|---|
| Company name, phone, email, license # | — | Printed on invoices, agreements, inspection reports, emails, texts (`{company}`), the portal. The company email also receives notices (declined proposals, portal sign-ups). |
| Address (printed on invoices) | — | |
| Sales tax rate % | 0 | Default tax on new invoices and proposals (tax-exempt customers get 0). |
| Payment terms (days) | 30 | Invoice due date = issue date + this. |
| Default labor rate / hr | 95 | Used on jobs and proposals unless the technician or job has its own. |
| Next invoice # / service call # / proposal # | 1001 | Numbering continues from here. Set to continue your existing numbers. |
| Invoice footer | "Thank you for your business!" | Payment instructions printed on every invoice. |
| Proposals valid for (days) | 30 | Default expiry of new proposals. |
| Default terms & conditions | starter text | Printed on proposals/agreements. **Have your attorney review.** |
| **Logo** | — | **Upload logo** / Remove. Used on documents, portal, sign-in page. |

## Payments

| Setting | Default | What it does |
|---|---|---|
| Secret key 🔒 | — | Stripe secret key (`sk_test_…` / `sk_live_…`). |
| Webhook signing secret 🔒 | — | From the Stripe webhook (`whsec_…`). The page shows the webhook URL and events to add. |
| Offer bank (ACH) payments as well as cards | on | |

Guide: [20 — Stripe](20-integrations.md#stripe-card-and-bank-payments).

## Texts & email

| Setting | Default | What it does |
|---|---|---|
| SMTP server, port, username, password 🔒, send-from address | port 587 | Company mailbox for sending. **Send test email.** |
| Account SID, Auth token 🔒, Texting number | — | Twilio. **Send test text.** |
| Confirm with the customer when a job is scheduled or moved | on | Per customer's email/text preference. |
| Text/email the customer when the technician taps "On my way" | on | |
| Email technicians a calendar invite | on | When booked, moved or unassigned. |
| Appointment text / On-my-way text / Appointment email / On-my-way email | built-in wording | Editable; placeholders `{company}` `{company_phone}` `{customer}` `{type}` `{date}` `{time}` `{tech}` `{address}` `{eta}`. |
| Recent messages | — | Log of every email/text with status. |

Guides: [20 — Email](20-integrations.md#email-smtp), [18 — Twilio](18-phone-texting-and-twilio.md).

## Calendars

| Setting | Default | What it does |
|---|---|---|
| Company time zone | America/New_York | Calendar feeds, invites and times in messages. |
| Public web address | — | `https://app.yourcompany.com`. **Required** for links in emails/texts, Twilio webhooks, Stripe/QuickBooks addresses. |
| Calendar feeds | — | Central and per-technician subscription links; make new links if one leaks. |

## Receiving

| Setting | Default | What it does |
|---|---|---|
| **Add stock automatically** when every line matches a part # you stock | on | Only for trusted senders / uploads. |
| Update each item's unit cost to the price on the latest invoice | on | |
| Trusted distributor email domains | — | e.g. `adiglobal.com, anixter.com`. Others always wait for review. |
| Reading PDFs & photos | — | Shows **On** when the server has `ANTHROPIC_API_KEY`. |
| Email intake address | — | Private address for forwarded invoices; **Make a new address** if it leaks. |

Guide: [15 — Receiving](15-inventory-trucks-and-fleet.md#receiving-supplier-invoices), [20 — Supplier invoices by email](20-integrations.md#supplier-invoices-by-email).

## Field rules

**Completing a job**

| Setting | Default |
|---|---|
| Require at least one "before" and one "after" photo | on |
| Job types that don't need photos | `estimate` |
| Require the parts used to be recorded, or "No parts used" ticked | on |
| Require the customer's signature | on |
| Job types that don't need a signature | `estimate` |
| Require serial numbers for serial-tracked equipment | on |
| …and a photo of each one's label / warranty info | on |

**Truck stock**

| Setting | Default |
|---|---|
| Weekly truck count day | Friday |
| Text each tech a reminder on count day; flag overdue trucks | on |
| Inventory manager (also gets count results) | — |

**Customer surveys**

| Setting | Default |
|---|---|
| Text / email a short survey after each completed job | on |
| Hours after the job to send it | 2 |
| Survey the same customer at most once every (days) | 30 |
| Job types to skip | `estimate` |
| Alert the owner at this many stars or fewer | 3 |
| Google review link (offered to 5-star customers) | — |
| Text message wording (`{company} {tech} {link}`) | built-in |

**Vehicle checklist**

| Setting | Default |
|---|---|
| How often techs check their truck | Every day (or Once a week / Off) |
| Must be done before starting the first job | on |
| Photos | Only when there's damage (or every check: front, back, left, right) |

**Start-of-day check**

| Setting | Default |
|---|---|
| Technicians must confirm their equipment before starting their first job | on |
| Spares to carry beyond what the jobs need | 1 |

**Alerts to the owner**

| Setting | Default |
|---|---|
| Email alerts to the owner(s) | on |
| Also text important alerts | off |
| Owner mobile for alert texts | — |

**Time clock & office location**

| Setting | Default |
|---|---|
| Office address, latitude, longitude | — (**Look up the address** / **Use this device's location**) |
| Counts as "at the office" within (metres) | 300 |
| Alert the owner when someone clocks in away from the office or without a location | on |
| Also alert on clock-outs away from the office | off |
| Clocking in at a job you're scheduled for today is OK (no alert) | on |

## Phone & on-call

**Company phone line (Twilio)**

| Setting | Default |
|---|---|
| Route calls through the app | off |
| Company Twilio number | blank = texting number |
| Office phone to ring during business hours | — |
| Office days (0 = Sun … 6 = Sat) | `1,2,3,4,5` |
| Opens / Closes | 08:00 / 17:00 |
| Webhook address to paste into Twilio, status address, **Make a new link** | — |

**Messages callers hear**: Greeting ("Thank you for calling {company}."), After hours, Voicemail prompt.

**On-call**

| Setting | Default |
|---|---|
| Announce the caller to the tech, who presses 1 to accept | on |
| Hours the answering tech can see that customer in the app | 24 |
| Email calendar invites and text techs about their on-call shifts | on |

**In-app calls (team to team)**

| Setting | Default |
|---|---|
| Allow in-app calls | on |
| Relay server | None (or Twilio / our own coturn) |
| Own relay addresses, own relay shared secret 🔒 | — |
| Address-lookup (STUN) servers | `stun:stun.l.google.com:19302` |

Guide: [18](18-phone-texting-and-twilio.md).

## Tracking & maps

| Setting | Default |
|---|---|
| Tracking provider | Not connected (or Samsara / Other provider) |
| Samsara API token 🔒 | — |
| Other provider: JSON feed URL, feed token 🔒; push address shown | — |
| Check every (minutes) | 2 |
| Find addresses on the map with | Off (or OpenStreetMap / Google Maps) |
| Drive times from | Straight-line estimate (or OSRM / Google Maps with live traffic) |
| Google Maps API key 🔒 | — |
| OSRM server | `https://router.project-osrm.org` |
| Average speed for estimates (mph) | 30 |
| Map tiles URL | OpenStreetMap |
| Block booking a tech where they can't get there in time | On |
| Extra minutes between jobs | 10 |

Guide: [15](15-inventory-trucks-and-fleet.md#gps-tracking-and-the-live-map).

## HR & time off

| Setting | Default |
|---|---|
| Hours in a workday | 8 |
| Vacation / Sick / Personal hours per year (defaults) | 80 / 40 / 16 |
| Let people request more than they have left | off |
| **Who handles time-off requests:** Owners and admins also get every request | on |
| Owners and admins can approve or deny any request (off = supervisors only) | on |
| Turn on "My pay & benefits" for everyone | off |
| Payroll provider | QuickBooks Payroll (Workforce) (or Gusto / ADP / Paychex / Other) |
| Employee payroll site, name for "Other", payroll questions go to, note for employees | — |
| Ask before booking a job on a company holiday (emergencies excepted) | on |
| Holidays: **Add US holidays for {year}**, **+ Other holiday**, Remove | — |

Per-person allowances and carryover: **Time off → Balances → Set**. Guide: [17](17-the-team.md#time-off).

## Help assistant

| Setting | Default |
|---|---|
| Turn on the help assistant | off |
| Questions per person per day (0 = no limit) | 25 |
| Answer depth | Balanced (or Quick / Thorough) |
| Recent questions | log with answers and ratings |

Needs `ANTHROPIC_API_KEY` on the server. Guide: [17](17-the-team.md#help-assistant-optional).

## Users & logins

The list of everyone who can sign in: name, title, email, role, **reports to**, technician profile, last sign-in, status. **+ Add user** / **Edit**: name, email, temporary password, role, job title, reports to, technician profile, **Active** (untick to block sign-in), reset password. Guide: [11](11-roles-and-permissions.md).

## Roles & permissions

Built-in roles (read-only, **Copy**) and custom roles (**+ New role**, **Edit**, delete when unused); owner-only to change. Guide: [11 — Custom roles](11-roles-and-permissions.md#custom-roles).

## Activity log

Read-only list of sign-ins, changes, deletes, password reveals, exports, chat reviews and backup actions (latest 500). Guide: [19](19-backups-and-security.md#the-activity-log).

## Backup & data (owner)

**Backups on this server**

| Setting | Default |
|---|---|
| Backup folder on the server | data folder → `backups` (or `BACKUP_DIR`) |
| Time of the nightly backup | 2 AM |
| Keep every backup from the last … days | 14 |
| Then one per week for … weeks | 8 |
| And one per month for … months | 12 |
| Backup password 🔒 | — (12+ characters) |

**Off-site copy**

| Setting | Default |
|---|---|
| Upload every backup off-site | off (needs a backup password) |
| Storage company | Backblaze B2 (or Amazon S3 / Cloudflare R2 / Wasabi / Other) |
| Storage address (S3 endpoint), bucket name | — |
| Folder in the bucket | `secureops` |
| Key ID, Secret key 🔒 | — |
| Lock each backup against deletion for … days | 30 |
| Lock type | Compliance |
| Region | worked out from the address |

Plus **Test connection**, **Show off-site backups**, the backups list, **Back up now**, **Run a restore test**, History, restore instructions, and **Export to spreadsheet** (CSV of customers, contacts, invoices, payments, expenses, service calls, inventory, systems, vehicles; passwords never included). Non-owners see only the spreadsheet exports. Guide: [19](19-backups-and-security.md).

---

## Server settings (`.env`)

A few things are set on the server instead of in the app ([01](01-install-server.md#step-7--settings-file-env)):

| Variable | Purpose |
|---|---|
| `DOMAIN` | The web address (Docker/Caddy HTTPS). |
| `TZ` | Server time zone. |
| `ANTHROPIC_API_KEY` | Claude API (invoice reading, help assistant). |
| `BACKUP_DIR`, `BACKUP_HOUR`, `BACKUP_DISABLED=1` | Override backup folder/time; turn nightly backups off. |
| `BACKUP_PASSPHRASE`, `OFFSITE_ENDPOINT`, `OFFSITE_BUCKET`, `OFFSITE_PREFIX`, `OFFSITE_KEY_ID`, `OFFSITE_SECRET` | Used when restoring onto a new server. |
| `TURN_SECRET`, `TURN_URLS` | Your own relay server for in-app calls. |
| `LITESTREAM_*` | Continuous database backup. |
| `APP_SECRET` | Use a fixed encryption key instead of `secret.key`. |
| `SMTP_*`, `TWILIO_*`, `STRIPE_*`, `QBO_*`, `SAMSARA_API_TOKEN`, `GOOGLE_MAPS_KEY` | Optional overrides of the in-app values. |
