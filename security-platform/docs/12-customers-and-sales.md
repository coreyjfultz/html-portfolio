# 12 — Customers and sales

This guide covers customer records (with their sites, contacts and parent accounts), the sales pipeline, proposals and agreements with electronic signatures, and the customer portal.

---

## Customers

**Menu → Customers.** The list shows every customer with type, stage, phone, city and status. Use the search box and filters (residential/commercial, stage, status).

### Adding a customer — **+ Customer**

| Field | Notes |
|---|---|
| **Type** | Residential or Commercial. Reports split revenue by this. |
| **Name / Business name** | For homes, the household name ("Smith, John & Mary"); for businesses, the business. |
| **Stage** | Where they are in the sales pipeline (see below). New leads start at *Lead*. |
| **Parent account / owner** | For businesses with one owner (e.g. three restaurants owned by one person): pick the parent customer. The parent sees all of them in the customer portal. |
| Primary contact, email, phone, alt. phone | Main contact details. Add more people under **Contacts**. |
| **Monitoring account #** | Quick reference; full monitoring details live under the **Monitoring** tab. |
| **Status** | Active, Inactive (no longer a customer; kept for history) or Prospect. |
| Billing address, city, state, ZIP | Printed on invoices. Used for the map unless there's a service address. |
| Service address (if different) | Where the work is, if different from billing. Customers with several sites use **Locations** instead. |
| **Preferred payment** | Check, card, ACH or cash. A hint for the office and for the portal. |
| **Email / text appointment updates** | Per customer: whether they get appointment confirmations and "on my way" by email, by text, both or neither. |
| **Invite to the customer portal** | Ticking this emails them a sign-in link ([portal](#the-customer-portal)). |
| **Don't send this customer satisfaction surveys** | Opt-out (owners/admins). |
| **Usually nobody on site to sign** | For after-hours commercial work: jobs don't need a customer signature (owners/admins) ([13](13-service-calls-and-scheduling.md#customer-sign-off)). |
| **Lead source** | Referral, website, Google, Facebook, yard sign, builder / contractor, repeat customer, portal sign-up, other. |
| **Tax exempt** | No sales tax on their invoices. |
| **Gate / door code**, **Site access notes** | Shown to the tech on the job (keys, dogs, hours, where to park). |
| Notes | Internal only. |

Addresses are placed on the map automatically when an address lookup service is turned on ([15](15-inventory-trucks-and-fleet.md#gps-tracking-and-the-live-map)); if an address can't be found, the record says *Address not found on map*: check the spelling, or enter latitude/longitude.

### The customer page

Opening a customer shows a header (name, type, stage, phone/email buttons, directions link) and tabs:

| Tab | What's there |
|---|---|
| **Overview** | Contact details, balance, recurring charges, recent jobs, notes, *Tech access* (owners/admins). |
| **Locations** | Each site with its own address, site contact, gate code and access notes. Jobs and systems can be tied to a site. |
| **Contacts** | Everyone you deal with: name, role (owner, manager, tenant, accounts payable…), email, phone, **Primary contact**, **Receives invoices**. |
| **Systems** | Camera, alarm and fire systems, and fire extinguishers on file ([14](14-monitoring-systems-and-fire.md#systems-on-file)). |
| **Equipment** | Every serial-numbered device installed, with warranty end dates and photos ([13](13-service-calls-and-scheduling.md#serial-numbers-and-warranty-photos)). |
| **Monitoring** | Central-station accounts, zones, call list, activity ([14](14-monitoring-systems-and-fire.md)). |
| **Service calls** | All service calls, past and upcoming. |
| **Proposals** | Proposals and agreements for this customer. |
| **Site survey** | Photos taken on a site visit, marked up to show where equipment goes, with notes ([below](#site-survey-photos)). Sales, owners, admins and accounting. |
| **Billing** | Invoices, payments, saved payment methods, recurring charges (monthly, quarterly, every 6 months or yearly). |

Fire inspection reports for the customer are listed under **Fire inspections** (menu) and on their systems.

### Recurring charges (monthly, quarterly, every 6 months, yearly)

Under **Billing → Recurring charges**:

| Field | Notes |
|---|---|
| Description | "Alarm monitoring", "Camera service plan", "Cloud video storage"… |
| **Monthly rate** | Always the price **per month**, even for charges billed less often. |
| **Billed** | **Monthly**, **Every 3 months (quarterly)**, **Every 6 months** or **Yearly (annually)**. |
| **First billed in (YYYY-MM)** | For quarterly, 6-month and yearly charges: the first month it's billed; it's then billed every 3 / 6 / 12 months after. Blank = this month. |
| Taxable, active | Tax applies if taxable; inactive charges are never billed. |

Example: monitoring at **$40/month, billed quarterly, first billed in 2026-01** is invoiced **$120** in January, April, July and October, with the line *"Alarm monitoring — January 2026 to March 2026 (3 months × $40.00)"*. Nothing is billed in the other months.

The **monthly billing run** picks up whatever is due that month ([16](16-billing-and-accounting.md#monthly-billing)). A signed agreement with a monthly fee adds its charge automatically, with the billing frequency chosen on the proposal and starting the month it's signed.

### Parent accounts (one owner, several businesses)

Set **Parent account / owner** on each business to the owner's record. The owner's customer page lists the businesses; in the customer portal they can switch between them. Each business keeps its own sites, systems, jobs and invoices.

### Tech access

Technicians normally see only customers on their own schedule ([11](11-roles-and-permissions.md#technicians-see-only-their-own-customers)). To let a tech see a customer anyway (looking up a system before quoting, or helping another tech), an owner or administrator opens the customer → **Tech access** → picks the technician, how many hours (up to 14 days) and a reason. Access ends by itself. Every grant is logged.

### Inactive customers and deleting

Customers with invoices, payments or other history **can't be deleted**. Set **Status → Inactive** instead: they disappear from everyday lists but their history stays. (If a customer is deleted by mistake, an owner can bring it back from a backup without undoing anything else: [19](19-backups-and-security.md#a-customer-was-deleted-by-mistake).)

---

## The sales pipeline

**Menu → Pipeline.** Every customer has a **stage**:

| Stage | Meaning |
|---|---|
| **Lead** | New inquiry. |
| **Site survey** | A visit to look at the property is booked. |
| **Bid sent** | A proposal has been sent. |
| **Accepted** | The customer signed. |
| **Installation** | The install is scheduled or under way. |
| **Active** | Installed; an ongoing customer. |
| **Lost** | Didn't go ahead. |

The board shows a column per stage. **Drag a card** to move a customer by hand; you can add a reason (e.g. why a lead was lost). Every move, by hand or automatic, is kept in the customer's stage history.

### Automatic moves

Stages only ever move **forward** automatically:

| When… | The customer moves to |
|---|---|
| A service call of type **Estimate** is scheduled | Site survey |
| A proposal is **sent** | Bid sent |
| A proposal or agreement is **signed** | Accepted |
| An **Installation** call is scheduled | Installation |
| An **Installation** call is completed | Active |

---

## Proposals and agreements

**Menu → Proposals** (or a customer's **Proposals** tab).

### Document types

| Type | Use it for | After signing… |
|---|---|---|
| **Proposal** | A quote for equipment and installation | Install job, materials, deposit invoice, monthly charge (if any) |
| **Installation agreement** | A signed contract for an install | Same as a proposal |
| **Monitoring agreement** | Ongoing monitoring at a monthly fee for a term | Monthly charge starts; no install job |
| **Service agreement** | A maintenance/service plan | Monthly charge starts; no install job |

### Building one

1. **+ Proposal**: customer, site, type, title, valid until (default: today + *Proposals valid for* days from Settings).
2. **Scope of work / summary:** plain-language description of what you'll do.
3. **Line items:** add **inventory items** (description and price fill in from Inventory) and **labor** (hours × rate), each with quantity, price and taxable yes/no.
4. **Monthly service fee** and its description (e.g. "24/7 monitoring, cellular"), **agreement term** (months), **deposit due at signing (%)**, **tax rate**.
5. **Terms & conditions:** pre-filled from Settings → Company; adjust for this customer if needed.
6. **Preview** shows exactly what the customer will see, with your logo.

### Billing frequency on the proposal

**Bill the monthly fee:** Monthly, Every 3 months (quarterly), Every 6 months or Yearly. The fee is still entered **per month**; the proposal shows the customer both, e.g. *"$40.00/month"* with *"Billed quarterly: $120.00 every 3 months"* under it. When signed, the recurring charge is created with that frequency. Offer yearly billing as an option (some companies give a discount: lower the monthly fee for yearly customers).

### Product photos on the proposal

Inventory items can have a photo ([15](15-inventory-trucks-and-fleet.md#items---new-item)). With **Show product photos on the proposal** ticked (default), each line item from inventory shows a small picture of the product, so the customer sees what a "4MP turret camera" actually looks like. Untick it for a text-only proposal. Lines without a photo just show the text.

### Site survey photos

The person putting the quote together can take pictures on the site visit of **where things will go**, draw on them, and write notes, all from the phone.

**Where:** the customer's **Site survey** tab (all photos for that customer), or the **Site survey photos** card on a proposal (photos for that proposal).

**Taking one:**

1. **📷 Take photo** opens the phone's camera (or **Upload** for photos already taken, several at once).
2. The **markup** screen opens:
   - **Draw**: freehand, e.g. circle where the camera mounts, trace the wire path;
   - **Arrow**: drag from start to point, e.g. pointing at the outlet;
   - **Label**: tap and type a short label right on the picture ("Cam 1", "Panel", "Run through attic");
   - **5 colors**, **Undo**, **Clear** (back to the original photo).
3. Give it a **title** ("Front entry — camera 1") and **notes** ("Mount above the door at 9 ft. Outlet inside the coat closet. Needs 24 ft ladder.").
4. **Save photo.**

**On the proposal:** in the proposal's card, tick **On proposal** for the photos the customer should see. They print in a **Site survey** section of the proposal, with the title and notes, so the customer sees exactly where each device goes. Photos left unticked stay internal (for the installers and your own notes).

**Editing:** **Mark up / edit** re-opens the markup on the photo (title and notes too). **Delete** removes it.

**Signed proposals:** once signed, the photos shown on it are **locked** (they're part of the signed document and its fingerprint): they can't be edited, removed or unticked. Other photos can still be added to the customer.

**Who:** sales, owners and administrators add and edit; accounting can view. Technicians and HR don't see survey photos. Installers can be shown them by the office, or use the job's notes.

### Sending and signing

- **Send** emails the customer a private link to review and sign (it needs email set up). Status goes *Draft → Sent*, and *Viewed* the first time they open it.
- The customer reads it on any phone or computer, types their **name**, **title** and **email**, ticks that they agree, and **signs with a finger or mouse**. They can also **decline** with a reason; the office is emailed.
- The signature records **name, title, email, date and time, IP address, device**, and a **SHA-256 fingerprint of the exact document**. Any later change would no longer match the fingerprint. A **signed document is locked**: it can't be edited or deleted.
- Both sides get an email with a link to the signed copy.
- **Duplicate** makes an editable copy (for a revised quote).

> Electronic signatures captured this way follow the U.S. ESIGN Act / UETA principles (intent, consent, identity, record integrity). Have your attorney confirm your terms and any state-specific requirements.

### What happens automatically when it's signed

1. The customer moves to **Accepted** in the pipeline.
2. If there's a **monthly fee**, a recurring charge is added (with the proposal's billing frequency, first billed this month) and the customer is marked **Active**.
3. For proposals and installation agreements with line items, an **installation service call** is created (status *New*, 4 hours, with the items listed) and the equipment is added to that job's **materials** list, ready to check out to a truck ([13](13-service-calls-and-scheduling.md#job-materials)).
4. If there's a **deposit %**, a **deposit invoice** is created and marked sent.

The proposal page links to the job and invoice it created.

### Statuses

*Draft* → *Sent* → *Viewed* → **Signed** (or *Declined*, or *Expired* after the valid-until date).

---

## The customer portal

Customers get their own sign-in at **`https://app.yourcompany.com/portal`**, completely separate from staff logins. They can never see staff screens.

### How customers get in

- **Invite:** on the customer, tick **Invite to the customer portal** (or use the invite button on the customer page). They get an email with a link to set their password.
- **Sign up themselves:** on the portal page, *Create an account* with the email you have on file; they confirm it from an email (verification required). Once confirmed, they're linked to the customer with that email; a sign-up that doesn't match any customer becomes a new **Lead** (lead source *portal sign-up*, status *Prospect*) and the office is emailed.
- **Forgot password:** on the portal sign-in page.

### What customers can do in the portal

| Area | What they see / do |
|---|---|
| **Home** | Balance due, next appointment, recent service. |
| **Invoices** | Every invoice; open, print/save as PDF; **Pay now** by card or bank (with Stripe set up). |
| **Payment methods** | Save a card or bank account, choose the default, remove one. Card and bank numbers stay with Stripe ([16](16-billing-and-accounting.md#online-payments-with-stripe)). |
| **Service** | Past and upcoming service calls with the technician's **before/after photos** and the sign-off. |
| **Request service** | Describe the problem, preferred day/time; it arrives as a new service call for the office. |
| **Request equipment** | Ask for more cameras, sensors, etc.; it arrives as a draft quote for sales. |
| **Agreements** | Their proposals and agreements; sign ones waiting for signature. |
| **Systems** | The systems you have on file for them (no passwords or codes are shown), with upcoming inspection dates and their **fire inspection reports**. |
| **Monitoring** | Their monitoring account(s) and recent alarm activity. |
| **Profile** | Update contact details and **text/email preferences**, change password. |
| **Switch business** | Owners with several businesses (parent account) switch between them. |

The customer portal is optional: everything also works by email links (pay this invoice, sign this agreement) without customers ever creating an account.
