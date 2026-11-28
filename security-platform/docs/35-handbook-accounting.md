# Accounting handbook

For whoever keeps the money side: invoicing jobs, the monthly billing run (monthly, quarterly, 6-month and yearly charges), payments and collections, expenses and supplier invoices, inventory value, reports, QuickBooks, timesheets for payroll and pay documents. This is the **Accounting** role. Owners and administrators can do all of it too. Accounting also sees customers, service calls and (read-only) proposals.

---

## 1. Daily

- [ ] **Clock in.**
- [ ] **Payments** received: Stripe card/ACH payments are recorded **automatically**. Record **checks and cash** (invoice → **Record payment** → method, date, check #).
- [ ] **Completed jobs to invoice:** Service calls → *Completed*, not yet invoiced → open → **Create invoice** (labor, parts and the customer's signature are filled in). Check the resolution text (it prints), hours, parts, billable or not.
- [ ] **Receiving** review inbox: supplier invoices that weren't received automatically. Match lines against the original (side by side), **Receive into stock** (adds stock, logs the expense, updates costs if on) or **Reject** ([15](15-inventory-trucks-and-fleet.md#receiving-supplier-invoices)).
- [ ] **Deliver invoices:** with Stripe, **Get paid online → Send a "Pay now" link**; otherwise **Print / PDF** and email/mail it. **Mark sent**.

---

## 2. Invoices

| Kind | Comes from |
|---|---|
| **Monthly** | The billing run (recurring charges due that month) |
| **Service** | A completed service call (**Create invoice**) |
| **Installation** | Installs and **deposit invoices** (created when a proposal is signed) |
| **Other** | **+ New invoice** |

**Statuses:** Draft → Sent → Partial → Paid; **Void** (kept on record; **Restore** if done by mistake). Past due with a balance = **overdue**.

**Editing:** dates, notes and tax via **Edit details**; lines until it's paid. Tax-exempt customers get 0% automatically. Numbers continue from *Next invoice #* (Settings).

**Never delete** a sent invoice to "fix" it: void it and issue a new one, so QuickBooks and the customer's history stay right.

---

## 3. Recurring charges and the monthly billing run

### How recurring charges work

Each customer's recurring charges (customer → Billing → Recurring charges):

| Field | Meaning |
|---|---|
| Description | Printed on the invoice ("Alarm monitoring") |
| **Monthly rate** | Always **per month**, whatever the frequency |
| **Billed** | Monthly · Every 3 months (quarterly) · Every 6 months · Yearly (annually) |
| **First billed in (YYYY-MM)** | The first month a quarterly/6-month/yearly charge is billed; then every 3/6/12 months. Blank = this month |
| Taxable, active | |

Charges from signed agreements are created automatically with the frequency on the proposal, first billed in the month it was signed.

**Examples** (billing in advance):

| Charge | Billed in | Invoice line |
|---|---|---|
| $40/mo, monthly | every month | "Alarm monitoring — March 2026", $40.00 |
| $40/mo, quarterly, first 2026-01 | Jan, Apr, Jul, Oct | "Alarm monitoring — January 2026 to March 2026 (3 months × $40.00)", $120.00 |
| $25/mo, every 6 months, first 2026-02 | Feb, Aug | "… — February 2026 to July 2026 (6 months × $25.00)", $150.00 |
| $30/mo, yearly, first 2026-05 | every May | "… — May 2026 to April 2027 (12 months × $30.00)", $360.00 |

A customer with a monthly and a yearly charge gets the monthly line every month, and both lines in the yearly month.

**Changing a customer to yearly / quarterly:** edit the charge → **Billed** and **First billed in** (the month their next bill should be). Make sure you don't bill them twice for months already invoiced monthly: set *First billed in* to the first month not yet billed.

**Price changes:** edit the monthly rate; it applies from the next bill.

**Cancellations:** untick **Active** (don't delete; history stays).

### Running it (once a month)

The dashboard shows **Run monthly billing** until this month's invoices exist.

1. **Invoices → Run monthly billing** → choose the **month**.
2. The preview lists every customer **with something due that month**, the total, and which charges are quarterly/yearly. Customers with only a yearly charge appear only in that month.
3. Tick **Create as drafts for review** if you want to check first.
4. **Create invoices.** Customers already billed for that month are skipped, so running it twice can't double-bill.
5. Review drafts → **Mark drafts sent**.
6. Deliver: **Pay now** links (Stripe) or Print/PDF. Customers with saved payment methods: **Charge a saved payment method** (with their authorization), and portal customers see the invoices there.

---

## 4. Payments

**Record payment:** amount (defaults to the balance; less = partial), **method** (cash, check, credit card, bank ACH, other), date, reference (check #, last 4, transaction ID). Edit or remove a payment entered by mistake.

**Stripe** ([16](16-billing-and-accounting.md#online-payments-with-stripe)):

- **Send a "Pay now" link** or **Copy link** (text it).
- **Charge a saved payment method** for customers who saved a card/bank (portal or when paying).
- Payments are recorded automatically when Stripe confirms them; **ACH takes a few days**.
- Card and bank numbers stay with Stripe, never in SecureOps.
- Fees (check Stripe's current pricing): about 2.9% + 30¢ per card, 0.8% capped at $5 per ACH. They show in your Stripe payouts, not on the invoice.

**Deposits:** the deposit invoice created at signing is a normal invoice; record or collect it like any other.

---

## 5. Collections

1. **Reports → Accounts receivable**: aging per customer (current / 30 / 60 / 90+).
2. **Invoices → Overdue** filter.
3. Re-send the **Pay now** link; call 30+ days; escalate 60+ to the owner.
4. Use **tasks** to track promises ("Becker said check by Friday").
5. Notes go on the customer (internal notes) so the office knows before booking more work.

---

## 6. Expenses

**Menu → Expenses → + Expense:** date, category, vendor, description, amount, paid with, and optionally the **vehicle**, **technician** or **service call** (counts against that job's profit). Supplier invoices received through **Receiving** add their expense **automatically**; don't enter those twice. Monthly bills (insurance, rent, phone, the central station's monitoring fees, fuel cards) go in by hand or by your QuickBooks bank feed, not both ([16](16-billing-and-accounting.md#expenses)).

---

## 7. Inventory: the accounting side

- **Costs:** each item's **unit cost** (updated from supplier invoices if *update costs* is on) drives inventory value and job profit.
- **Product photos:** add one on the item (**📷 Add photo**); shows in lists and on proposals.
- **Inventory value:** the Inventory page (warehouse + trucks at cost).
- **Weekly count differences** come with a dollar value. Big or repeated ones: tell the owner. Counts correct the stock automatically; the difference is your shrinkage.
- **Truck stock:** you can restock trucks and return extras (Truck stock page).
- **Parts used on jobs** come off the tech's truck and onto the job (billed on the invoice, cost on job profitability).

---

## 8. Timesheets and payroll

**Time clock → Timesheets** for the pay period (From/To): per person, total, **regular** and **overtime** (over 40 h/week), and every punch.

1. Before payroll, check for **open shifts** (clocked in, never out) and odd punches; get them corrected (**Edit** / **+ Manual entry**, with a reason) by you or HR.
2. Make sure approved **time off** for the period is in (Time off page).
3. **Export timesheets (CSV)** and import into payroll (QuickBooks Payroll, Gusto, ADP…).

**Pay documents** (if the pay & benefits add-on is on): **My pay & benefits → + Post documents**: pay stubs, W-2s, tax forms, for each employee. They see them as **New**; you see when they've been opened ([31](31-handbook-hr.md#5-pay--benefits-if-turned-on)).

---

## 9. QuickBooks and exports

- **QuickBooks Online sync** ([16](16-billing-and-accounting.md#quickbooks-online-automatic-sync)): customers, invoices (including edits and voids) and payments go over automatically. **Accounting** page: last sync, failures with reasons, **Sync now**. Fix failures (usually a QuickBooks setting or a missing item) and sync again.
- **Other software:** Accounting → exports for a date range (QuickBooks Desktop IIF, QuickBooks Online CSV, Xero CSV, invoice lines CSV, payments CSV). Set income and sales tax account names (ask your accountant).

---

## 10. Month-end close

- [ ] **Monthly billing run** done for the month (including quarterly/yearly charges due).
- [ ] Every **completed job** invoiced (or marked not billable).
- [ ] All **checks and cash** recorded; Stripe payouts match recorded card/ACH payments.
- [ ] **Receiving** inbox empty; supplier invoices received.
- [ ] **Expenses** entered (no duplicates with Receiving).
- [ ] **QuickBooks** sync clean (no failures), or exports downloaded.
- [ ] **Reports:** Profit & loss, Job profitability, A/R aging; send to the owner.
- [ ] Payroll for the period exported.

## 11. Year-end

- [ ] Review **recurring charge prices** (annual increase?) with the owner.
- [ ] Yearly charges: check *First billed in* months are right for the next year.
- [ ] **Sales tax** rate for the new year (Settings), confirmed with your accountant.
- [ ] Post **W-2s** to employees (pay & benefits).
- [ ] Inventory value at year-end (after a full count) for your accountant.
- [ ] *Next invoice #* continues; nothing to reset.

---

## 12. Your own time clock, time off and tasks

Same as everyone: clock in/out; **Request time off**; tasks on your dashboard. Repeating tasks are handy: "Run monthly billing" (monthly, 1st), "A/R review" (weekly), "Quarterly sales tax filing" (every 3 months) ([17](17-the-team.md#repeating-tasks)).
