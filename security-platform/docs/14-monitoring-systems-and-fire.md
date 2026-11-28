# 14 — Monitoring, systems and fire

This guide covers what you keep on file about each customer's equipment: camera, alarm and fire systems with their (encrypted) passwords; alarm **monitoring accounts** at the central station; the **Maintenance Due** list; **fire inspection reports**; and **fire extinguishers**.

---

## Systems on file

On a customer → **Systems** tab, add each system. Every system can be tied to a **site** (location).

### Camera systems

Recorder (NVR / DVR / cloud), brand, model, serial #, number of cameras, **IP address**, HTTP port, **remote access** (DDNS name or P2P ID), **viewing app**, **admin username / password**, **customer (viewer) username / password**, storage (TB), retention (days), install date, warranty expiry, last service, **next service due** and **service interval (months)**, notes.

### Alarm systems

Panel brand and model, monitoring center, monitoring account #, communicator, number of zones, **master code**, **installer code**, install date, battery replaced, last test, **next test due** and **test interval (months)**, notes.

### Fire systems

System type (fire alarm, sprinkler, kitchen hood suppression, special-hazard suppression: clean agent / CO2 / dry chemical / water mist, fire pump, emergency lighting…), area/building, panel/equipment brand and model, monitoring account #, **panel access code**, number of devices/heads, **AHJ** (fire marshal / jurisdiction), install date, last inspection, **next inspection due** and **inspection interval (months)**. Suppression systems default to a 6-month interval.

### Stored passwords and codes

Admin and viewer passwords, master/installer codes, panel codes, gate codes, monitoring passcodes and duress words are **encrypted** in the database. They show as `••••••` until someone clicks **Show**; the value appears for **30 seconds** and every reveal is written to the **Activity log** (who, what, when). Technicians can only reveal them for customers on their schedule. Details: [19](19-backups-and-security.md#stored-passwords-and-codes).

---

## Alarm monitoring

**Menu → Monitoring** lists every monitoring account with status, station and account number. Each account belongs to a customer (and site) and is also on the customer's **Monitoring** tab.

### Central stations

**Monitoring → Stations → + Station.** One record per monitoring company you use:

| Field | Notes |
|---|---|
| Station name | e.g. "CMS", "Rapid Response". |
| Automation software | Manitou, MASterMind, stages, SIMS… (for reference). |
| Connection | Today: *Manual* (see below). |
| Operator / dealer line | The number your techs call to put accounts on test. |
| Our dealer number, dealer web portal | Your login details live in your password manager, not here. |
| Receiver phone numbers / IP receivers | What panels are programmed to report to. |
| **Account number prefix, next account number, digits** | If you number accounts yourself, new accounts get the next number automatically (e.g. prefix `C1`, next `0042`, 4 digits → `C10042`). |
| **Signal feed key** | Private address for receiving alarm signals (below). |

### Monitoring accounts

On a customer → **Monitoring → + Account** (or **Import from alarm systems** to turn the station/account numbers already typed on alarm systems into accounts):

| Field | Notes |
|---|---|
| Site, **station**, **account number** | Leave the number empty to get the station's next number. |
| **Status** | Pending, Active, On test, Out of service, Cancelled. |
| **Monitored for** | Burglary, fire, burglary + fire, video, medical, environmental. |
| Alarm system, panel, communicator, **communicator / radio ID**, receiver / line # | Technical details. |
| **Customer passcode (verbal)**, **duress word / code** | Encrypted, behind **Show**. |
| Alarm permit #, permit expires | City/county alarm permits. |
| Monitoring started | |
| **Dispatch / special instructions** | What the station should do ("call keyholder before police", "dog inside"). |
| Internal notes | |

Each account has:

- **Zones:** zone #, description, type (entry/exit, perimeter, interior/motion, smoke, heat, CO, glass break, panic, medical, water, low temp, tamper, keypad/fob, other), device make/model, serial / TX ID, where it is, in service. **Removing** a zone keeps it as history (with the date removed).
- **Call list:** in call order (# 1, 2, 3…): name, relation, phone, has a key, notes. Change a person's *Call order* number to reorder.
- **Activity:** every alarm, trouble, restore, opening/closing, test and every change made here, newest first, filterable by type and date.

### "Confirmed with station"

**Today the station connection is manual.** Changing an account, zones or the call list in SecureOps does **not** change anything at the central station by itself; someone must call the station or use its dealer portal. To keep everyone honest, each account, zone and call-list change shows **not confirmed with station** until someone clicks **Confirmed with station** after doing it there.

### Putting an account on test

From the account or from the job on a tech's phone: **Put on test** → how long (30 minutes, 1, 2, 4, 8, 24 or 48 hours; default 2 hours) and a reason → the account shows **On test until 3:45 PM** everywhere (including the office dashboard). **Take off test** ends it; otherwise it **ends automatically** when the time is up and the account returns to its previous status.

> ⚠️ Remember the station must also be told (call the operator line). The app reminds you of this.

### Receiving alarm signals (signal feed)

Each station has a private **signal feed** address (**Stations → Signal feed**). The station, or a receiver/middleware service, can send alarm events to it; they appear in the matching account's **Activity** (matched by account number). Standard **Contact ID** (E130 burglary, E110 fire, R401 opening, E602 test…) and **SIA** codes (BA, FA, OP, CL, RP…) are understood. Signals received while an account is on test are marked as tests; repeated copies of the same event are ignored. Customers see their recent alarm activity in the portal.

### A direct station connection (future)

A developer can add a connector for your station's dealer integration (most wholesale stations offer an API to dealers). Accounts would then be created at the station automatically, and tests, zone and call-list changes would go straight to the station. The screens are already built for it (see the README, *Alarm monitoring*).

---

## Maintenance Due

**Menu → Maintenance Due.** One list of everything **overdue** and **due soon** (choose 30, 60, 90, 180 or 365 days ahead):

- camera **service** (next service due),
- alarm **tests**,
- fire system **inspections**,
- extinguisher **annual**, **6-year maintenance**, **hydrostatic test** and **replacement** (disposable units),
- vehicle **service**, **registration** and **insurance**.

For each item:

- **Mark done:** records today as the last date and rolls the next due date forward by its interval.
- **Schedule:** creates a service call for it.
- For commercial customers with many extinguishers, **mark several inspected at once**.

The dashboard shows the overdue count; the list can be filtered by customer, type and technician scope (techs see their own customers).

---

## Fire inspection reports

**Menu → Fire inspections** (also from a job or a fire system). Reports are filled in on the phone at the site.

### Report types

| Type | Standard | Frequencies |
|---|---|---|
| Fire alarm system | NFPA 72 | annual, semi-annual, quarterly |
| Sprinkler system | NFPA 25 | annual, quarterly, monthly |
| Kitchen suppression (hood) | NFPA 96 / NFPA 17A | semi-annual |
| Fire suppression (special hazard: clean agent, CO2, dry chemical, water mist) | NFPA 2001 / 12 / 17 / 750 | semi-annual, annual |
| Fire extinguishers | NFPA 10 | annual |
| Emergency lighting & exit signs | NFPA 101 | annual, monthly |
| Other | — | any |

> The checklists are plain-language starting points. **Check them against the code editions your AHJ enforces**; a developer can adjust them in `public/js/inspections.js`.

### Filling one in

1. **+ Inspection report** → customer, site, **system** (the type is suggested from the system), frequency, inspection date. The inspector's name and license # come from your user and Settings.
2. **Checklist:** sections of items (e.g. *Control panel & power*, *Initiating devices*, *Notification appliances*), each **Pass / Fail / N/A** with a note; some items take a **reading** (battery voltage, static/residual pressure, agent weight, cylinder date…).
3. **Device list** (fire alarm, sprinkler…): device-by-device results (location, type, result). The list **carries over** to next year's report for the same system, so only results need entering.
4. **Extinguisher walk-through** (extinguisher reports): every extinguisher on file at that site appears; for each, *pass / fail / replaced / removed / missing* and the service done (annual, 6-year, hydro, recharge). New units found on site can be added.
5. **Deficiencies:** every *Fail* becomes a line in the deficiency list, with a place for notes and the recommended correction. When completing, tick **create a follow-up job** to book the repairs as a service call with the deficiencies listed.
6. **Overall result:** **Pass**, **Deficiencies found**, or **Fail — impairment** (suggested from the answers).
7. **Customer signature** on the screen, then **Complete**.

**Save draft** keeps your progress; drafts can be finished later on any device.

### What completing does

- The report is **locked** (it can't be changed afterwards).
- The **fire system's** last/next inspection dates roll forward by its interval.
- Each **extinguisher's** dates roll forward according to what was done (annual, 6-year, hydro, recharge), and each action is written to that extinguisher's **history**.
- If ticked, a **follow-up service call** is created with the deficiencies.

### Sending the report

**Send report** emails a private link to the customer, the **AHJ / fire marshal** (the *AHJ email* on the report, pre-filled from the system) and any other address you add. The link opens a clean, printable report (with your logo, the signature and deficiencies) without a login. Customers also see completed reports in the portal.

---

## Fire extinguishers

On a customer → **Systems → Extinguishers**, one record **per unit**:

| Field | Notes |
|---|---|
| **Tag / barcode #** | The number on your inspection tag; searchable. |
| Spot, building / floor | "Kitchen by back exit", "2nd floor". |
| **Type** | ABC dry chemical, BC dry chemical, CO2, Class K (wet chemical), Water, Clean agent, Class D. |
| Size, **UL rating** (e.g. 2-A:10-B:C), brand, serial #, **manufacture date** | |
| **Kind** | Stored pressure (rechargeable), Cartridge operated, Disposable (non-rechargeable). |
| Mounting | Wall hook, bracket, cabinet, floor stand, vehicle, other. |
| Status | In service, removed… |
| Last / next annual, last / next 6-year maintenance, last / next hydrostatic test, hydro interval, last recharged, **replace by** | Worked out automatically (below). |

### How due dates are worked out

- **Annual inspection:** 12 months after the last one.
- **6-year maintenance:** stored-pressure (not cartridge-operated, not disposable) **dry chemical** units: 6 years after the latest of the manufacture date, the last 6-year maintenance or the last hydro test.
- **Hydrostatic test:** every *Hydro interval (years)* on the unit (default **12**; set **5** for CO2, water and Class K units), counted from the manufacture date or the last hydro test.
- **Disposable units:** **replace by** 12 years from the manufacture date (no hydro / 6-year).

Every inspection, recharge, 6-year, hydro and replacement (from inspection reports or entered by hand) is kept in the unit's **History**. These dates feed **Maintenance Due**.
