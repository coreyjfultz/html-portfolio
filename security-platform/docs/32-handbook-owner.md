# Owner handbook

For the owner (the **Owner / Global admin** role). You can do everything in SecureOps. This handbook covers what only you can do, the alerts that come to you, how to keep an eye on the business, and a daily / weekly / monthly / yearly routine. The other handbooks explain each job in detail: [technician](30-handbook-technician.md), [HR](31-handbook-hr.md), [office/dispatch](33-handbook-office-dispatch.md), [sales](34-handbook-sales.md), [accounting](35-handbook-accounting.md).

---

## 1. What only the owner can do

| Only owners can… | Where |
|---|---|
| Create, change or remove **other owners and administrators** | Settings → Users & logins |
| Create and edit **custom roles** and their permissions | Settings → Roles & permissions ([11](11-roles-and-permissions.md#custom-roles)) |
| Set the **backup password**, local backup and **off-site backup** settings | Settings → Backup & data ([19](19-backups-and-security.md#setting-up-backups-owner)) |
| **Restore** a backup, or recover a **deleted customer** | Backups ([19](19-backups-and-security.md#restoring)) |
| Receive the alerts listed below by default | Dashboard → Alerts, phone notifications |

Keep **two owner accounts** (yourself plus one trusted person), so the company isn't locked out if you're unavailable. Store the **backup password** somewhere safe offline (a sealed envelope, a password manager): without it, backups can't be opened.

Owners and administrators can also **override** the guard rails that stop everyone else:

- book a job despite a scheduling conflict (double booking, travel time, time off, blocked time, holiday): **Book anyway**;
- complete a job missing photos, parts, signature or serials, with a reason;
- pre-approve a job for **no customer signature**;
- let a tech **start without the start-of-day check**;
- grant a technician **temporary access** to a customer.

Every override is recorded with your name and reason in the **Activity log**.

---

## 2. Alerts that come to you

They appear under **Dashboard → Alerts** (with **Open** and **Dismiss**) and as phone notifications:

| Alert | What to do |
|---|---|
| **Clock-in away from the office** / no location | Usually fine (supply house). Ask if it repeats. Map link included. |
| **Truck count difference** (items, $ value) | Look at which items. Usually parts used but not recorded on jobs. Talk to the tech; mark the count reviewed on Truck stock. |
| **Missing tool** | Find it or mark it *Missing*; replace if needed. |
| **Tech short on equipment** at start of day | The office restocks or swaps the job; you can approve the start. |
| **Vehicle check problem** (with photos) | Book the repair; take the truck out of service if unsafe. |
| **Low customer survey score** | Call the customer back. Ratings by technician: Menu → Customer ratings. |
| **Voicemail / missed call** on the company line | Listen and call back (or have the office). |
| **Backup failed** / off-site copy failed / restore test failed | Fix the same day ([19](19-backups-and-security.md)). |
| **Chat records review started** | Someone (HR/admin) opened chat records with a reason; check it's legitimate. |
| **Time-off requests** (if *owners also get every request* is on) | Approve/deny, or leave it to the supervisor. |

Turn off alerts you don't want in the related settings (e.g. *Also alert on clock-outs away*, off by default).

---

## 3. Watching the business

| Question | Where to look |
|---|---|
| How much recurring revenue do we have? | Dashboard: **MRR** (monthly recurring revenue). Reports → Residential vs commercial (MRR and ARR by segment). Quarterly and yearly charges count at their monthly rate. |
| Are we making money? | Reports → **Profit & loss** by month (billed, collected, expenses by category, labor cost, net). |
| Which jobs lose money? | Reports → **Job profitability** (billed vs parts, labor, expenses; margin). |
| Who owes us? | Reports → **Accounts receivable** (aging: current, 30, 60, 90+). |
| Who's overloaded / who has room? | Reports → **Technician workload**; Dispatch board. |
| Where are the trucks? | **Live map** (with GPS tracking connected). |
| Are customers happy? | **Customer ratings** (by technician, on-time %), alerts for low scores. |
| What's due for maintenance / inspection? | **Maintenance Due** (cameras, alarm tests, fire inspections, extinguishers, vehicles). |
| How's the sales pipeline? | **Pipeline** board (leads, surveys, bids out, accepted). |
| Is inventory leaking? | Truck stock (count differences, shortages, extras), Inventory → item history. |
| Who did what? | **Activity log** (every change, password reveal, override, login). |

---

## 4. People

- **Adding people:** Settings → Users & logins → + Add user (name, email, temporary password, role, title, *Reports to*). For technicians, also create their **technician profile** (Technicians: phone, calendar color, labor rate, hourly cost) and link it. Details in the [HR handbook](31-handbook-hr.md#3-people-hiring-changes-and-leaving).
- **Roles:** use the built-in roles where possible; make a **custom role** for in-between jobs (e.g. "Dispatcher": customers and scheduling, no billing; "Inventory manager": inventory, receiving, truck stock). Give each person the least they need ([11](11-roles-and-permissions.md)).
- **Org chart:** set *Reports to* for everyone. Supervisors approve their team's time off. Decide in *Settings → HR & time off* whether owners/admins/HR also get every request and can decide.
- **Leaving:** untick **Active** immediately (signs them out everywhere). Change any shared passwords they knew (Wi-Fi, distributor portals).

---

## 5. Timecards, time off and payroll (owner's view)

- **Time clock:** you see who's on the clock now and everyone's timesheets (regular and overtime over 40 h/week). Corrections require a reason and are kept with the name of whoever made them. HR or accounting usually export payroll ([HR handbook](31-handbook-hr.md#1-timecards)).
- **Time off:** set company allowances, holidays and the approval policy in *Settings → HR & time off*. Approved time off blocks scheduling automatically.
- **Pay & benefits add-on:** turn on **My pay & benefits** to give employees one place for the payroll site link, benefit plans and pay documents ([17](17-the-team.md#pay-and-benefits-optional-add-on)).

---

## 6. Inventory and trucks (owner's view)

How stock stays honest:

1. Stock comes in through **Receiving** (supplier invoices read automatically; trusted distributors only).
2. It moves to trucks by **Restock**, **Load from warehouse** or **job materials checkout**.
3. It leaves trucks only by being **added to a job** (and billed).
4. Every week, each tech does a **blind count**; differences come to you with a dollar value.

If counts keep coming up short for one truck, look at that tech's jobs: parts used but not added. Keep **standard truck stock** minimums/maximums realistic so trucks carry what they need without piles of extras. Inventory value (cost) is on the Inventory page.

Vehicles: the daily/weekly **vehicle check** reports problems to you with photos; **Maintenance Due** shows oil changes (by mileage), registration and insurance dates.

---

## 7. Backups and security (your job)

The short version of [19](19-backups-and-security.md):

- [ ] **Backup password** set and stored safely offline.
- [ ] **Local backups** on (daily), with retention you're happy with.
- [ ] **Off-site backup** to a second company's storage (e.g. Backblaze B2, Wasabi, AWS S3) with **Object Lock**, so even someone who breaks into the server can't delete old backups.
- [ ] **Restore test** passing (the app tests the newest backup automatically and alerts you if it fails).
- [ ] Practice a **real restore** on a spare server once a year.
- [ ] Everyone uses their **own login**; nobody shares passwords.
- [ ] Look at the **Activity log** now and then, especially password reveals and overrides.
- [ ] Keep the server updated (or have your IT person do it).

If you suspect a break-in: follow [19 → If you suspect a break-in or a leak](19-backups-and-security.md#if-you-suspect-a-break-in-or-a-leak).

---

## 8. Settings you should decide

| Setting | Why it matters |
|---|---|
| Company details, logo, license #, terms & conditions | Printed on proposals, invoices, inspection reports. Have your attorney review the terms. |
| Sales tax rate, payment terms, labor rate | Defaults on every proposal and invoice. Confirm tax with your accountant. |
| **Field rules** | Which job completion rules apply (photos, parts, signature, serials), vehicle check frequency, count day, office location and radius for the time clock. |
| **Phone & on-call** | Business hours, after-hours routing, on-call rotation, voicemail. |
| **HR & time off** | Allowances, holidays, who approves. |
| Payments (Stripe), QuickBooks | How you get paid and how the books stay in sync. |
| Help assistant (Claude API) | Optional; answers employees' how-to questions from your own library. |

All of them are explained in [21 — Settings reference](21-settings-reference.md).

---

## 9. Your routine

### Every day (10 minutes)

- [ ] Dashboard → **Alerts**: open and dismiss each one.
- [ ] **Today's jobs** and any open **emergencies**; unassigned calls.
- [ ] Time-off requests waiting (if they come to you).
- [ ] Monitoring accounts **on test** that should have come off.

### Every week

- [ ] **Truck stock**: count results (after count day), shortages, extras; mark counts reviewed.
- [ ] **Pipeline**: bids out with no answer; ask sales to follow up.
- [ ] **Customer ratings**: any low scores.
- [ ] **Maintenance Due**: overdue inspections and services are being booked.
- [ ] **Backups** page: last backup and off-site copy succeeded.

### Every month

- [ ] Make sure **monthly billing** was run (dashboard button disappears once done), including quarterly and yearly charges due that month.
- [ ] **A/R aging**: who's 60+ days; decide on collections.
- [ ] **Profit & loss** and **Job profitability** with accounting.
- [ ] **Technician workload**: hiring or overtime decisions.
- [ ] Review the **Activity log** for overrides and password reveals.

### Every year

- [ ] **January:** carryover and allowances for the new year (HR); review labor rates and prices.
- [ ] **Fall:** next year's **holidays**; benefits open enrollment.
- [ ] Practice a **full restore** from backup.
- [ ] Review **roles**: does everyone still need what they have?
- [ ] Review **terms & conditions** with your attorney, sales tax with your accountant.
- [ ] Renew licenses, insurance and vehicle registrations (Maintenance Due shows vehicle dates).
