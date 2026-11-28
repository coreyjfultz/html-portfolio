# 16 — Billing and accounting

This guide covers invoices (one-off, from jobs and monthly), payments (cash, check, card, bank ACH), online payments through Stripe, expenses, the reports, and QuickBooks / other accounting software. These areas are for **owners, administrators and accounting** (and custom roles with *Billing & accounting*).

---

## Invoices

**Menu → Invoices.** Filter by status (draft, sent, partial, paid, void, **overdue**), kind, customer and date.

### Kinds

| Kind | Comes from |
|---|---|
| **Monthly** | **Run monthly billing**: every recurring charge due that month (monitoring, service plans), whether billed monthly, quarterly, every 6 months or yearly. |
| **Service** | A completed service call (**Create invoice** on the job). |
| **Installation** | Installs, and **deposit invoices** created automatically when a proposal is signed. |
| **Other** | Anything else (**+ New invoice**). |

### Statuses

**Draft** (not sent yet) → **Sent** → **Partial** (some paid) → **Paid**. **Void** cancels an invoice but keeps it on record (**Restore (un-void)** if done by mistake). An invoice past its due date with a balance shows as **overdue**.

### Creating and editing

- **+ New invoice:** customer, kind, issue date, due date (issue date + *Payment terms* from Settings), tax rate (from Settings; 0 for tax-exempt customers), notes (printed).
- **+ Line item:** description, quantity, unit price, taxable. Pick an inventory item to fill in its description and sell price.
- **From a job:** on a completed service call → **Create invoice** adds labor (hours × rate if billable) and parts, and prints the customer's signature.
- **Edit details** changes dates, notes and tax; lines can be edited until the invoice is paid.
- **Print / PDF** opens a clean invoice with your logo, company details, the *invoice footer* (payment instructions) and, for job invoices, the work performed and signature. Use the browser's *Save as PDF* to keep a file.
- **Mark sent** (or **Mark drafts sent** for many) when you've delivered it.
- **Delivering invoices:** with Stripe connected, **Get paid online → Send a "Pay now" link** emails the customer the amount due and a secure payment link; otherwise use **Print / PDF** and send the file. Portal customers see every invoice in the portal.

Invoice numbers continue from *Next invoice #* in Settings.

### Monthly billing

Once a month (the dashboard reminds you): **Invoices → Run monthly billing**.

1. Choose the **billing period** (month).
2. The list shows every customer with a recurring charge **due that month** and what they'll be billed (charges are summed per customer, with tax where marked taxable). Charges billed less often are marked, e.g. *"Cloud storage (quarterly)"*; on the invoice the line says what it covers, e.g. *"Cloud storage — January 2026 to March 2026 (3 months × $15.00)"*.
3. Optionally tick **Create as drafts for review** to check them before sending.
4. **Create invoices.** Customers already billed for that month are skipped, so running it twice doesn't double-bill.
5. If drafts: review, then **Mark drafts sent** (or send each).

**How often each charge is billed.** Each recurring charge has a **monthly rate** and a frequency ([12](12-customers-and-sales.md#recurring-charges-monthly-quarterly-every-6-months-yearly)):

| Billed | Invoiced in | Amount on the invoice |
|---|---|---|
| Monthly | every month | the monthly rate |
| Every 3 months (quarterly) | the *first billed* month, then every 3 months | 3 × the monthly rate |
| Every 6 months | the *first billed* month, then every 6 months | 6 × the monthly rate |
| Yearly | the *first billed* month each year | 12 × the monthly rate |

In the months between, the charge is skipped (a customer with only a yearly charge doesn't appear). The invoice line says which months it covers. Billing is **in advance**: the January quarterly invoice covers January to March. To change when a quarterly or yearly customer is billed, change *First billed in*. Monthly recurring revenue on the reports always uses the monthly rate, whatever the frequency.

Creating invoices doesn't email them by itself. To deliver them: with Stripe connected, send each customer a **Pay now** link (**Get paid online → Send a "Pay now" link**) — the email contains the invoice amount and a secure payment page; or **Print / PDF** and mail or email the file yourself. Customers using the portal also see new invoices there.

---

## Payments

**Record payment** on an invoice:

| Field | Notes |
|---|---|
| Amount | Defaults to the balance; less is a partial payment. |
| **Method** | Cash, Check, Credit card, Bank ACH, Other. |
| Date, reference | Check #, last 4 digits, transaction ID… |

The invoice status updates (Partial / Paid). Every payment is listed under **Menu → Payments**, and on the customer's Billing tab. Payments can be edited (**Edit**) or removed if entered by mistake.

Cash and checks are simply recorded. Card and ACH payments are recorded **automatically** when paid online.

### Online payments with Stripe

With Stripe connected ([20](20-integrations.md#stripe-card-and-bank-payments)), each unpaid invoice has **Get paid online ▾**:

| Option | What happens |
|---|---|
| **Send a "Pay now" link** | Emails the customer a secure Stripe payment page for the balance (card, or bank ACH if enabled). |
| **Copy link** | Copy the same link to send by text or paste anywhere. |
| **Charge a saved payment method** | If the customer saved a card or bank account (in the portal, or by ticking *save* when paying), **Charge $… now** charges it on the spot, e.g. after a phone call. |

When the customer pays, Stripe tells SecureOps (webhook) and the payment is recorded on the invoice with the method and Stripe reference. ACH payments take a few days to clear; they're recorded when Stripe confirms them.

Card and bank numbers are **never stored in SecureOps**; they stay with Stripe. Stripe's fees are about 2.9% + 30¢ per card payment and 0.8% (capped at $5) for ACH; check Stripe's current pricing.

Customers can also pay from the **customer portal**, and save or change their payment method there ([12](12-customers-and-sales.md#the-customer-portal)).

---

## Expenses

**Menu → Expenses → + Expense:** date, **category** (Parts & equipment, Fuel, Vehicle maintenance, Payroll, Subcontractors, Tools, Insurance, Rent & utilities, Phone & software, Monitoring center fees, Marketing, Office supplies, Licenses & permits, Other), vendor, description, amount, **paid with** (card, check, ACH, cash, other), and optionally the **vehicle**, **technician** or **service call** it belongs to. Receiving a supplier invoice adds its expense automatically ([15](15-inventory-trucks-and-fleet.md#receiving-supplier-invoices)). Expenses tied to a job count against that job's profit; vehicle expenses show on the vehicle.

---

## Reports

**Menu → Reports.** Choose the period (this week, this month, last 90 days) where the report offers it.

| Report | Shows |
|---|---|
| **Profit & loss** | By month: revenue billed (residential vs commercial), collected, expenses by category, estimated labor cost (technician hours × hourly cost), **net**. |
| **Job profitability** | Each completed job: billed, parts cost, labor cost, expenses, profit and margin. Find the jobs that lose money. |
| **Technician workload** | Per tech: booked hours vs capacity, number of calls, emergencies, labor billed and labor cost, backlog. Who's busiest, who has room. |
| **Residential vs commercial** | Customers, monthly recurring revenue (MRR) and yearly (ARR), revenue, open balance, by segment. |
| **Accounts receivable** | **A/R aging**: what each customer owes, split current / 30 / 60 / 90+ days. Use it for collections. |

The dashboard shows the headline numbers (MRR, billed and collected this month, outstanding / overdue).

---

## Accounting and QuickBooks

**Menu → Accounting.**

### QuickBooks Online (automatic sync)

After a one-time connection ([20](20-integrations.md#quickbooks-online)), SecureOps keeps QuickBooks Online up to date by itself:

- **Customers** are created/updated in QuickBooks.
- **Invoices** are created, and later **edits and voids** are sent too.
- **Payments** are recorded against the matching invoices.

**Sync now** pushes anything pending immediately; otherwise it happens automatically. The page shows the last sync and any item that failed, with the reason (e.g. a QuickBooks setting). **Disconnect** stops syncing (nothing is deleted in QuickBooks).

Choose the QuickBooks **item** used for invoice lines and for sales tax on the Accounting page. Ask your accountant which to use.

### Other accounting software (exports)

For QuickBooks Desktop, Xero, FreshBooks, Wave, Zoho, Sage or Excel, download files for a date range:

| Export | For |
|---|---|
| **QuickBooks Desktop — invoices (IIF)** | QuickBooks Desktop (File → Utilities → Import → IIF Files). |
| **QuickBooks Online — invoices (CSV)** | QuickBooks Online's own invoice import (if you don't use the sync). |
| **Xero — sales invoices (CSV)** | Xero's sales invoice import. |
| **Any software — invoice lines (CSV)** | FreshBooks, Wave, Zoho, Sage, Excel… |
| **Payments (CSV)** | Payments received in the period. |

Set the **income account** and **sales tax account** names used in exports (ask your accountant).

> 🧾 Have your accountant confirm the **sales tax rate** and which items are taxable in your state, and the QuickBooks items/accounts to use.
