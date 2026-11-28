# Sales handbook

For whoever brings in the work: leads, site surveys, photos of where things go, quotes and bids, agreements and e-signatures. This is the **Sales** role. Owners and administrators can do all of it too. Sales sees customers, sites, systems, monitoring and service calls, and works the pipeline and proposals. It doesn't see invoices, payments or financial reports.

---

## 1. The sales flow at a glance

```
Lead → Site survey → Bid sent → Accepted → Installation → Active
                                    ↘ Lost
```

| Step | You do | The app does automatically |
|---|---|---|
| **Lead** | Add the customer (or they sign up in the portal / request equipment). | Portal sign-ups and equipment requests arrive as leads / draft quotes. |
| **Site survey** | Book an **Estimate** service call for yourself; visit; take **survey photos** with markup and notes. | Booking the estimate moves them to *Site survey*. |
| **Bid sent** | Build the **proposal** (items with product photos, labor, monthly fee and how often it's billed, survey photos), **Send**. | Sending moves them to *Bid sent*; you see when they **view** it. |
| **Accepted** | Answer questions; the customer **signs** online. | Signing moves them to *Accepted*, creates the install job with materials, the deposit invoice and the recurring charge. |
| **Installation / Active** | Hand over to the office for scheduling. | Install scheduled → *Installation*; completed → *Active*. |
| **Lost** | Drag to *Lost* with the reason. | Kept in the stage history. |

---

## 2. Leads

**+ Customer**: type (residential/commercial), name, contact, phone, email, address, **lead source** (referral, website, Google, Facebook, yard sign, builder/contractor, repeat customer, portal sign-up, other). Leave **Stage = Lead**.

Where leads come from without you typing them:

- **Portal sign-up** that doesn't match an existing customer → new lead, office emailed.
- **Request equipment** in the portal (existing customers wanting more cameras, sensors…) → a **draft quote** for sales.
- Office takes a call and creates the customer.

Use a **task** to follow up ("Call Becker back Thursday"), with a due date, so it shows on your dashboard and My tasks.

---

## 3. The pipeline

**Menu → Pipeline:** a column per stage. **Drag a card** to move a customer by hand (add a reason, especially for *Lost*). Stages only move **forward** automatically. Every move is in the customer's **stage history**.

Weekly habit: look at **Bid sent** cards. Anyone who has *viewed* the proposal but not signed is worth a call.

---

## 4. The site survey

### Booking it

**+ Service call** on the customer, **call type: Estimate**, date/time, duration, and the **technician** who goes. Jobs are assigned to technician profiles: if you do your own surveys, ask an administrator to create a technician profile for you so estimates land on your calendar and the scheduling checks protect your time. The customer gets a confirmation and moves to *Site survey*.

### On site: what to look at

- Existing equipment (panel make/model, cameras, wiring, monitoring company) → add to **Systems** if you'll keep it.
- Entry points, rooms, outdoor coverage, lighting, Wi-Fi/internet, power outlets, attic/basement access for wire runs.
- For fire: occupancy, existing devices, extinguishers, the AHJ.
- Ladders/lifts needed, hours the site is open, parking, who signs.

### Survey photos with markup and notes

On the customer's **Site survey** tab (or the proposal's **Site survey photos** card):

1. **📷 Take photo** (the phone's camera opens). **Upload** adds photos already on the phone, several at once.
2. On the **markup** screen:
   - **Draw** freehand: circle the camera spot, trace the wire run;
   - **Arrow**: drag from start to the point ("outlet here");
   - **Label**: tap and type a short label right on the picture ("Cam 1", "Keypad", "Through attic");
   - pick one of **5 colors**; **Undo** the last mark; **Clear** goes back to the plain photo.
3. **Title** ("Front entry — camera 1") and **notes** (height, mounting, power, wire path, ladder, anything the installer must know).
4. **Save photo.**

Take one photo per device location, plus the panel/recorder location and any tricky wire runs. Good notes save the installer a phone call.

**Mark up / edit** re-opens a photo later (marks, title, notes). **Delete** removes it.

Who sees them: sales, owners, administrators; accounting can view. They're internal until you choose to show them to the customer (below).

---

## 5. Building the proposal

**+ Proposal** (Menu → Proposals, or the customer's Proposals tab).

### Type

| Type | Use for | After signing |
|---|---|---|
| **Proposal** | A quote for equipment + install | Install job, materials, deposit invoice, recurring charge |
| **Installation agreement** | A signed install contract | Same |
| **Monitoring agreement** | Monitoring only, monthly fee for a term | Recurring charge; no install job |
| **Service agreement** | Maintenance/service plan | Recurring charge; no install job |

### Fill it in

1. **Customer, site, title, valid until** (default from Settings, usually 30 days).
2. **Scope of work:** plain language. "Install 4 outdoor 4MP cameras covering the driveway, front entry, back yard and side gate, with an 8-channel recorder in the office closet, and phone viewing."
3. **Line items:**
   - **Inventory items:** pick the item; description and sell price fill in. Change the price if needed.
   - **Labor:** hours × rate.
   - quantity, price, taxable for each.
4. **Monthly service fee** and its description ("24/7 monitoring, cellular communicator", "Cloud video, 30 days").
5. **Bill the monthly fee:** **Monthly**, **Every 3 months (quarterly)**, **Every 6 months** or **Yearly (annually)**. The fee is always entered **per month**. The customer sees, e.g., *"$40.00/month"* with *"Billed quarterly: $120.00 every 3 months"* under it.
6. **Agreement term** (months), **deposit at signing (%)**, **tax rate**.
7. **Show product photos on the proposal** (on by default): items that have a photo in Inventory show a thumbnail next to the line, so the customer sees the actual camera, keypad or detector. Untick for a text-only proposal. Ask the office to add photos for items you quote often.
8. **Site survey photos:** on the proposal's **Site survey photos** card, tick **On proposal** for the photos the customer should see. They print in a **Site survey** section with their titles and notes. Photos you take from the proposal card are ticked automatically; untick internal ones ("ceiling is asbestos tile, careful").
9. **Terms & conditions:** pre-filled; adjust for this customer only if the owner agrees.
10. **Preview** shows exactly what the customer will see.

**Tips:**

- Offer **options** as separate proposals (Good / Better / Best): **Duplicate**, then change the items.
- **Yearly billing** is popular with businesses; some companies give a small discount (lower the monthly fee on the yearly option).
- Keep the scope readable by a non-technical customer; put technical detail in the survey photo notes.

---

## 6. Sending, viewing and signing

1. **Send:** the customer gets an email with a private link. Status: *Draft → Sent*. The customer moves to *Bid sent*.
2. When they open it: **Viewed** (you can see the date).
3. They read it on any phone or computer, enter **name, title, email**, tick that they agree, and **sign with a finger or mouse**. Or **Decline** with a reason (the office is emailed).
4. Both sides get an email with a link to the signed copy.

The signature records name, title, email, date/time, IP address, device and a **SHA-256 fingerprint of the exact document** (items, prices, photos shown, terms). A **signed proposal is locked**: no edits, and the survey photos shown on it can't be changed or removed. Need a change after signing? **Duplicate**, change, and have them sign the new one.

Statuses: *Draft → Sent → Viewed → Signed* (or *Declined*, or *Expired* after *valid until*).

### What signing does by itself

1. Customer → **Accepted**.
2. **Recurring charge** created with the monthly fee and the billing frequency you chose, first billed this month; customer marked **Active**.
3. **Install service call** created (status *New*) with the items as its **materials**, ready for the office to schedule and check out to a truck.
4. **Deposit invoice** created (if a deposit %).

Tell the office it's signed (or they'll see the new job). Mention anything special from your survey notes.

---

## 7. After the sale

- The **install job** shows the materials; the installer sees the job and its notes. Point the installer to your survey photos (the office can open them on the customer's Site survey tab) or copy key notes into the job description.
- Watch the customer move to *Installation* and *Active*.
- Upsell later: the **Systems** and **Equipment** tabs show what they have and warranty dates; **Maintenance Due** shows upcoming inspections and services.

---

## 8. Your timecard, time off and tasks

- **Time clock:** clock in when you start and out when you finish, from the phone or computer. Each punch records where you are at that moment; site visits are normal. Forgot a punch? Message HR/the office the same day ([17](17-the-team.md#time-clock)).
- **Time off:** Time off → **Request time off** (type, days or hours, note). Your supervisor approves; balances show at the top. Approved time off blocks anyone booking estimates for you then.
- **Tasks:** your follow-ups and to-dos; set **Block this time** for things like a trade show so nobody books you.
- **Calendar:** your estimates and tasks; subscribe from Outlook/Google if you like ([13](13-service-calls-and-scheduling.md#outlook-google-and-iphone-calendars)).
- **Team chat** and **in-app calls** for talking to the office and techs.

---

## 9. Quick answers

| Question | Answer |
|---|---|
| Customer wants yearly billing | Set **Bill the monthly fee → Yearly** (fee stays per month). |
| Product has no picture on the proposal | The item has no photo in Inventory; ask the office to add one. |
| Survey photo isn't on the proposal | Tick **On proposal** on that photo in the proposal's card. |
| Can't edit a signed proposal | It's locked; **Duplicate** and send the new one. |
| Customer didn't get the email | Check their email address; **Send** again, or copy the link and text it. |
| Proposal expired | **Duplicate** (new valid-until date) and send. |
| Need to see past jobs or invoices | Jobs: customer → Service calls. Invoices: ask accounting (sales doesn't see billing). |
