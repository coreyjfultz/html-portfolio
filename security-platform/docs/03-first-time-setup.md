# 03 — First-time setup checklist

Do these in order after [installing the server](01-install-server.md). Each step links to the detailed guide. You don't have to finish everything on day one: steps 1–6 make the system usable, and the rest switch on more features.

Use **company-owned accounts** (a company email, the company card) for every outside service, so nothing is tied to one person.

---

## Day one: the basics

### 1. Company details — *Settings → Company & billing*

Fill in: company name, phone, email, license number and address (printed on invoices and agreements); sales tax rate; payment terms (days); default labor rate per hour; the next invoice, service call and proposal numbers (set these to continue your current numbering, e.g. if your last invoice was 4317, set 4318); invoice footer (payment instructions such as "Make checks payable to…"); how long proposals stay valid; and your **terms & conditions** for proposals and agreements.

> ⚖️ The default terms are a plain starting point. **Have your attorney review them** for your state and services before customers sign anything.

Click **Upload logo** (PNG or JPG, wide is best). It appears on invoices, agreements, inspection reports, the customer portal and the sign-in page.

### 2. Time zone and web address — *Settings → Calendars*

- **Company time zone:** used for calendars, reminders and times in texts/emails.
- **Public web address:** `https://app.yourcompany.com`. Links in texts and emails (sign this agreement, pay this invoice, survey, inspection report) and the Twilio phone webhooks use it. Set it now.

### 3. Backups — *Settings → Backup & data*

Set a **backup password** today (12+ characters; write it in the password manager and on paper in the safe). Set up the **off-site copy** before you rely on the system. → [19 — Backups](19-backups-and-security.md)

### 4. Email — *Settings → Texts & email → Email (SMTP)*

Enter the company mailbox details and click **Send test email**. Without email, techs don't get calendar invites and customers don't get confirmations, invoices or signing links. → [20 — Email](20-integrations.md#email-smtp)

### 5. Technicians — *Technicians*

Add each field tech: name, mobile, email, calendar color, skills/certifications, hourly cost (for job profitability) and billing rate. The calendar color is used on every calendar and the map.

### 6. Users — *Settings → Users & logins*

Add a login for every person (office and field). For each: name, email (their login), a temporary password, **role**, **job title**, **reports to** (their supervisor) and, for techs, their **technician profile** (this links their login to their jobs, My Day and truck). Tell each person their temporary password in person or by phone and have them change it under *My account*. → [11 — Roles](11-roles-and-permissions.md)

At this point the team can install the app on their phones ([02](02-install-devices.md)) and start using the schedule.

---

## Week one: your operation

### 7. Vehicles — *Vehicles*

Unit name/number, year/make/model, plate, VIN, **assigned technician**, mileage, **tire pressure target** (for the vehicle check), next service mileage/date, registration and insurance expiry. Optional: GPS tracker ID, tracking-page link and dash-cam link. → [15](15-inventory-trucks-and-fleet.md#vehicles)

### 8. Inventory — *Inventory*

Add the items you stock: name, **your part number**, the **distributors' part numbers** (so supplier invoices match automatically), unit cost, sell price, reorder level, whether to **track serial numbers** (cameras, recorders, panels…), warranty months, and the standard truck minimum/maximum. Then receive or count your current warehouse stock and load each truck. → [15](15-inventory-trucks-and-fleet.md)

### 9. Standard truck stock and tools — *Truck stock*, *Tools*

Set the standard minimum/maximum each truck should carry, any per-truck exceptions, the weekly **count day**, and the **inventory manager**. Add tools (ladders, meters, drills…) with asset tags and which truck they're on. → [15](15-inventory-trucks-and-fleet.md#truck-stock-and-weekly-counts)

### 10. Central stations — *Monitoring → Stations*

Add each monitoring company you use (operator phone, dealer number, account-number prefix if you number accounts). → [14](14-monitoring-systems-and-fire.md#central-stations)

### 11. Customers

Add customers (or have a developer import your existing list from a spreadsheet). For each: residential/commercial, contacts, sites (locations), systems on file (camera, alarm, fire, extinguishers), monitoring accounts and **monthly recurring charges** (monitoring, service plans). → [12](12-customers-and-sales.md), [14](14-monitoring-systems-and-fire.md)

### 12. Field rules — *Settings → Field rules*

Decide what's required to complete a job (photos, parts, customer signature, serial numbers), the vehicle check, the start-of-day equipment check, surveys and owner alerts, and set the **office location** for the time clock. → [13](13-service-calls-and-scheduling.md#job-completion-rules), [21](21-settings-reference.md#field-rules)

### 13. HR & time off — *Settings → HR & time off*

Hours in a workday, yearly vacation/sick/personal hours, who handles requests, and **company holidays** (one click adds the US holidays). Set individual allowances and carryover on the **Time off** page. → [17](17-the-team.md#time-off)

---

## When you're ready: phone, payments and accounting

### 14. Texting and the company phone line — Twilio

Create the Twilio account, buy (or port) a number, **register for A2P 10DLC** (US business texting; takes days, so start early), then enter the details under *Settings → Texts & email* and *Settings → Phone & on-call*. Build the **on-call rotation**. → [18](18-phone-texting-and-twilio.md)

### 15. Online payments — Stripe

Create the Stripe account, start in **test mode**, add the webhook, test a payment, then switch to live keys. → [20 — Stripe](20-integrations.md#stripe-card-and-bank-payments)

### 16. QuickBooks Online (optional)

Connect once under *Accounting*; customers, invoices and payments then sync automatically. Try the sandbox first. → [20 — QuickBooks](20-integrations.md#quickbooks-online)

---

## Optional features

| Feature | Where | Guide |
|---|---|---|
| Outlook / Google calendar feeds | Calendar → *Sync to Outlook / Google* | [13](13-service-calls-and-scheduling.md#outlook-google-and-iphone-calendars) |
| GPS tracking, live map, drive-time checks | Settings → Tracking & maps | [15](15-inventory-trucks-and-fleet.md#gps-tracking-and-the-live-map) |
| Supplier invoices by email, automatic reading | Settings → Receiving | [15](15-inventory-trucks-and-fleet.md#receiving-supplier-invoices) |
| Customer portal | Customer → *Invite to the customer portal* | [12](12-customers-and-sales.md#the-customer-portal) |
| Training library and support contacts | Training library, Support contacts | [17](17-the-team.md#training-library-and-support-contacts) |
| Help assistant (AI) | Settings → Help assistant | [17](17-the-team.md#help-assistant-optional) |
| Pay & benefits | Settings → HR & time off | [17](17-the-team.md#pay-and-benefits-optional-add-on) |
| Custom roles | Settings → Roles & permissions | [11](11-roles-and-permissions.md#custom-roles) |
| In-app calls relay server | Settings → Phone & on-call | [18](18-phone-texting-and-twilio.md#relay-server-for-in-app-calls) |

---

## Practice run before going live

With two or three people, walk through a full day using a **test customer**:

1. Create the customer, a site and an alarm system with a test code (check **Show** works and is logged).
2. Create a proposal, send it, sign it on a phone → confirm the installation job, deposit invoice and monthly charge were created.
3. Book a job for a tech; check the tech got the calendar invite and the customer got the confirmation.
4. On the tech's phone: vehicle check, start-of-day check, **On my way**, before/after photos, parts, serial number + label photo, customer signature, complete.
5. Create the invoice from the job, send it, pay it with a Stripe **test** card (`4242 4242 4242 4242`, any future date, any CVC).
6. Clock in/out, request time off, approve it, send a chat message, make an in-app call, create a task.
7. Make a backup, run a restore test.

Then delete the test customer (or mark it inactive) and you're ready.
