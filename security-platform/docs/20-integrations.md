# 20 — Connecting outside services

Every outside service is **optional**: SecureOps runs without any of them. Each one switches on features. Create every account with a **company email**, pay with the **company card**, and turn on **two-factor sign-in**. Keys and passwords you paste into SecureOps are stored encrypted and never shown again (fields say *Saved — leave blank to keep*).

| Service | Turns on | Guide |
|---|---|---|
| Email (SMTP) | Confirmations, calendar invites, invoices/pay links, signing links, portal invites, alerts | [Email](#email-smtp) |
| Twilio | Texts, the company phone line, click-to-call | [18](18-phone-texting-and-twilio.md) |
| Stripe | Card and bank (ACH) payments, saved payment methods | [Stripe](#stripe-card-and-bank-payments) |
| QuickBooks Online | Automatic accounting sync | [QuickBooks](#quickbooks-online) |
| Outlook / Google / iPhone calendars | Jobs in everyone's normal calendar | [Calendars](#calendars) |
| GPS tracking (Samsara or other) | Live map, ETAs, dash-cam links | [GPS](#gps-tracking) |
| Maps & routing (OpenStreetMap, OSRM, Google) | Addresses on the map, drive times | [Maps](#maps-and-drive-times) |
| Claude API (Anthropic) | Reading supplier invoices, the help assistant | [Claude](#claude-api) |
| Inbound email (Postmark, Power Automate…) | Supplier invoices by email | [Supplier invoices](#supplier-invoices-by-email) |
| Off-site storage (Backblaze B2, S3…) | Off-site backups | [19](19-backups-and-security.md#step-3--off-site-copy) |
| Push notifications | Phone/computer notifications | [Nothing to set up](#push-notifications) |

---

## Email (SMTP)

*Settings → Texts & email → Email (SMTP).* SecureOps sends mail through a normal company mailbox, e.g. `office@yourcompany.com` (a shared or dedicated mailbox is best).

| Field | Microsoft 365 / Outlook.com | Google Workspace / Gmail | Other (your host's mail) |
|---|---|---|---|
| SMTP server | `smtp.office365.com` | `smtp.gmail.com` | from your email provider |
| Port | `587` | `587` | usually `587` (or `465`) |
| Username | the mailbox address | the mailbox address | the mailbox address |
| Password | the mailbox password (see below) | an **app password** (see below) | the mailbox password |
| Send from address | the same mailbox (or an alias it may send as) | the same mailbox | the same mailbox |

**Microsoft 365:** an administrator must allow **SMTP AUTH** for that mailbox: Microsoft 365 admin center → **Users → Active users →** the mailbox → **Mail → Manage email apps → tick "Authenticated SMTP"**. If the organization has *Security defaults* on, SMTP AUTH may be blocked; a dedicated mailbox with an exception, or an app password where allowed, solves it.

**Gmail / Google Workspace:** turn on 2-Step Verification for the account, then create an **App password** (Google Account → Security → 2-Step Verification → *App passwords*) and paste that 16-character password.

Click **Send test email**; the badge turns **Ready**. The *Recent messages* table on the same page shows every email/text with sent/failed status.

To improve delivery (avoid spam folders), ask whoever manages the domain to make sure **SPF and DKIM** are set up for the company domain (standard for Microsoft 365 / Google).

---

## Stripe (card and bank payments)

1. Create an account at **stripe.com** with the company's legal details and bank account (for payouts). Turn on two-step authentication.
2. Start in **Test mode** (toggle in the Stripe dashboard).
3. **Developers → API keys:** copy the **Secret key** (`sk_test_…` in test mode, `sk_live_…` later).
4. **Developers → Webhooks → Add endpoint:**
   - **Endpoint URL:** the address shown in SecureOps (*Settings → Payments*), e.g. `https://app.yourcompany.com/api/stripe/webhook`;
   - **Events:** `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `payment_intent.succeeded`, `payment_intent.payment_failed`.

   Save, then reveal and copy the **Signing secret** (`whsec_…`).
5. In SecureOps, *Settings → Payments → Stripe connection*: paste the **Secret key** and **Webhook signing secret**; choose whether to **offer bank (ACH) payments as well as cards**; **Save**.
6. **Test:** make a small invoice → **Get paid online → Copy link** → pay with test card `4242 4242 4242 4242` (any future date, any CVC, any ZIP). The payment should appear on the invoice within seconds.
7. **Go live:** switch Stripe to live mode, create the **live** webhook (same URL and events) and paste the **live** secret key and **live** signing secret into SecureOps.

For ACH, also turn on **US bank account / ACH Direct Debit** under Stripe *Settings → Payment methods*. Stripe's fees are deducted from payouts (about 2.9% + 30¢ per card payment; 0.8% capped at $5 for ACH; check current pricing).

---

## QuickBooks Online

**Menu → Accounting → QuickBooks Online.** One-time setup (allow 20 minutes). The screen repeats these steps with your exact *Redirect URI*:

1. Sign in at **developer.intuit.com** with the company's QuickBooks login → **Dashboard → Create an app** → *QuickBooks Online and Payments* → scope **Accounting**.
2. In the app's **Keys & credentials** (or *Keys & OAuth*), add the **Redirect URI** shown in SecureOps (`https://app.yourcompany.com/api/qbo/callback`).
3. Copy the **Client ID** and **Client Secret** into SecureOps.
4. **Environment:** start with **Sandbox (testing)** using the development keys and Intuit's sandbox company. Click **Connect to QuickBooks**, approve, then try **Sync now** with a test invoice.
5. For real use: in Intuit's portal complete the production questionnaire to get **production keys**, add the same redirect URI under *Production*, paste the production keys, set **Environment: Production**, **Connect to QuickBooks** again and choose the real company.
6. Pick the QuickBooks **item for invoice lines** and the **sales tax item** (your accountant can advise).

From then on customers, invoices (with edits and voids) and payments sync automatically ([16](16-billing-and-accounting.md#quickbooks-online-automatic-sync)). The connection renews itself as long as it's used; if it goes unused for about 100 days (or someone revokes it in QuickBooks), the Accounting page shows it's disconnected; click **Connect to QuickBooks** again.

---

## Calendars

Nothing to sign up for:

- **Email invites to technicians** need [email](#email-smtp) set up.
- **Subscribed feeds** work right away: **Calendar → Sync to Outlook / Google** ([13](13-service-calls-and-scheduling.md#outlook-google-and-iphone-calendars)).
- Set the **company time zone** and **public web address** in *Settings → Calendars*.

---

## GPS tracking

*Settings → Tracking & maps → Tracking provider.*

**Samsara:**

1. In Samsara: **Settings → Organization → API Tokens → Add an API token**, name it "SecureOps", scope **Read** for *Vehicles* (and *Vehicle locations*).
2. Paste it as **Samsara API token**; save.
3. On each SecureOps vehicle, set **GPS tracker / vehicle ID** to the vehicle's name or ID in Samsara. Optionally paste the vehicle's Samsara page as **Tracking page link** and the dash-cam view as **Dash cam link**.

**Any other provider** (Verizon Connect, Motive/KeepTruckin, GPS Insight, Linxup, Bouncie…):

- **JSON feed:** if they offer a URL that returns current positions, paste it (and a token if needed). Each vehicle record needs an ID and `lat`/`lng` (or `latitude`/`longitude`), optionally speed, heading, time and address.
- **Push (webhook):** have them POST positions to the private **push address** shown on the settings page, in the same JSON shape.

Then set each vehicle's tracker ID to match.

---

## Maps and drive times

*Settings → Tracking & maps.*

| Setting | Free option | Paid option |
|---|---|---|
| **Find addresses on the map with** | **OpenStreetMap** (Nominatim; about 1 lookup/second; fine for a small company) | **Google Maps** (Geocoding API) |
| **Drive times from** | **Straight-line estimate** (no service), or **OSRM** road routing (public server, light use; or run your own) | **Google Maps with live traffic** (Distance Matrix API) |

**Google Maps key:** in **console.cloud.google.com** create a project → enable **Geocoding API** and **Distance Matrix API** → *APIs & Services → Credentials → Create credentials → API key* → **restrict** it to those two APIs (and ideally to your server's IP address) → paste as *Google Maps API key*. Google bills per request after a monthly free allowance; set a **budget alert** in Google Cloud billing.

---

## Claude API

Used for two optional features: **reading supplier invoices** (PDFs, photos, email text) and the **help assistant**.

1. Create an account at **console.anthropic.com** (company email), add a payment method, and set a **monthly spend limit** (*Settings → Limits*).
2. **API keys → Create key**, name it "SecureOps server". Copy it (shown once).
3. On the server, put it in `.env`: `ANTHROPIC_API_KEY=sk-ant-…`, then `docker compose up -d`.
4. *Settings → Receiving* shows **On** for automatic reading. For the assistant, also tick *Settings → Help assistant → Turn on*.

**Costs:** pay-as-you-go. A one-page supplier invoice typically costs a few cents to read; an assistant question similar. The assistant has a per-person daily limit.

**Data:** supplier invoice documents, and assistant questions with the matching training-library content, are sent to Anthropic's API to be processed. Customer records are not sent.

---

## Supplier invoices by email

*Settings → Receiving → Email intake* shows a **private address** (keep it secret). Get distributor invoice emails to it one of two ways:

**Postmark Inbound** (simplest; free tier fits typical volume):

1. Create a Postmark account → a **Server** → **Inbound** stream.
2. Set the inbound stream's **Webhook URL** to SecureOps' private address.
3. Postmark gives you an inbound email address (`…@inbound.postmarkapp.com`).
4. In Outlook / Microsoft 365 or Gmail, add a **rule**: emails **from your distributors** (or sent to `invoices@yourcompany.com`) → **forward** to the Postmark address.

**Microsoft Power Automate / Zapier / Make:** a flow *"When a new email arrives"* (filter by sender or folder) → **HTTP POST** to the private address with JSON:

```json
{ "from": "billing@adiglobal.com", "subject": "Invoice 12345", "text": "email body",
  "attachments": [ { "filename": "12345.pdf", "contentType": "application/pdf", "content": "<base64 file contents>" } ] }
```

Each PDF, image or CSV attachment becomes its own Receiving entry. Then add your distributors' email domains under **Trusted distributor email domains** (e.g. `adiglobal.com, anixter.com, wesco.com`) so their fully-matched invoices are received automatically; mail from anyone else always waits for review. If the address ever leaks, **Make a new address**.

---

## Push notifications

Nothing to sign up for. The server creates its own notification keys automatically; each person just taps **Turn on** in Team chat on each device ([02](02-install-devices.md)). Notifications go through Apple's, Google's or Microsoft's push service **without the message text**: the app fetches the text privately when the notification arrives.

---

## Alarm monitoring stations

See [14 — Receiving alarm signals](14-monitoring-systems-and-fire.md#receiving-alarm-signals-signal-feed). Give the station (or your receiver/middleware provider) the station's private **signal feed** address.
