# HR handbook

For the person who handles people matters: timecards, time off and balances, holidays, hiring and leaving, supervisors, pay documents and benefits, and reviewing chat records after an incident. The built-in **HR** role has exactly these permissions and **no access to customers, jobs or billing**; owners and administrators can do all of this too ([roles](11-roles-and-permissions.md)).

Your menu: Dashboard, Time clock, Tasks, Team chat, Time off, Our team, My pay & benefits (if on), Training library, Support contacts, Calendar, Settings (HR & time off, Users & logins, Roles & permissions).

---

## 1. Timecards

### How punches work

- Everyone **clocks in and out** in the app (phone or computer). Each punch saves the time and **where they were at that moment** (no tracking in between).
- Each punch is labeled:

  | Badge | Meaning |
  |---|---|
  | **Office** | Within the office radius (default 300 m; Settings → Field rules → Time clock). |
  | **Job site** | At a job they're scheduled for that day. |
  | **Away** | Somewhere else (e.g. supply house, home). The owner is alerted for clock-ins away. |
  | **No location** | Location wasn't shared (permission off, GPS off, computer). The owner is alerted. |

- A "missed" punch shows as an open shift (clocked in, never out).

### Reading timesheets

**Time clock** page (you, owners, admins and accounting see everyone):

- **On the clock now:** who's clocked in, since when, where.
- **Timesheets:** choose **From / To** (default: last 2 weeks). For each person: total hours, **regular** and **overtime** (over **40 hours in a week**, Monday–Sunday).
- Open a person to see **every punch** with times, location badges and map links.

### Correcting a timecard

When someone forgets to clock in/out, or clocked the wrong time:

1. Open the person's punches.
2. **Edit** the punch (or **+ Manual entry** for a missing one): set the correct time.
3. **Enter the reason** ("Forgot to clock out; left at 5:10 per supervisor"). The reason and your name are kept with the change.

Good practice: ask employees to report mistakes **the same day**, and fix them before payroll is exported.

### Exporting for payroll

**Export timesheets (CSV)** for the pay period: one row per punch with person, in/out times, hours and locations. Import it into the payroll system (QuickBooks Payroll, Gusto, ADP…) or give it to accounting. Do this after corrections, and after any approved time off is entered.

---

## 2. Time off

### How requests flow

1. An employee requests time off (type, whole days or hours, note).
2. Their **supervisor** is notified (phone + email), and, by default, **owners, admins and HR** too. You see it in **Time off → Waiting for approval** and as a banner on your dashboard.
3. Anyone allowed (the supervisor or someone above them; owners/admins/HR unless your settings say *supervisors only*) clicks **Approve** or **Deny** (with a reason the employee will see).
4. The employee gets a text/email with the decision.
5. Approved time off **blocks scheduling** that person, shows on calendars and in "Who's out", and is subtracted from their balance.

Each request shows any **jobs already booked** in that window and **on-call shifts**. After approving, make sure the office reassigns them.

**Who handles requests** is set in *Settings → HR & time off*: whether owners/admins/HR also get every request, and whether they can decide or it's *supervisors only*. People without a supervisor always come to owners/admins/HR.

### Entering time off directly

**+ Add for someone:** for time off agreed outside the app (a call-in sick day, jury duty, planned leave). It's approved immediately and can go over the person's balance. Past dates are allowed for you (employees can't request past dates).

### Balances

Each person's balance per type (vacation, sick, personal), per **calendar year**:

> **Available** = yearly allowance + carryover − approved time off this year (pending requests shown separately)

- Hours per day: *Hours in a workday* (Settings, default 8). Weekends and company holidays inside a request aren't charged.
- **Company defaults** (Settings → HR & time off): default **80 h vacation, 40 h sick, 16 h personal** per year.
- **Per person:** **Time off → Balances → Set**: their yearly hours for each type and their **carryover**, for that year. Use this for seniority, part-time staff, or new hires part-way through the year (prorate).
- **Over-balance requests** are refused unless *Let people request more than they have left* is on.

### Start of a new year (important)

Balances start fresh on January 1. **Carryover isn't automatic**: in early January, for each person, open **Balances → Set** for the new year and enter how many hours carry over (per your policy, e.g. up to 40 h vacation), and any changed allowances.

### Company holidays

*Settings → HR & time off → Holidays:*

- **Add US holidays for [year]**: tick the federal holidays you observe. Observed dates are handled (a Saturday holiday on Friday, a Sunday one on Monday).
- **+ Other holiday**: company-specific days (day after Thanksgiving, Christmas Eve).
- Holidays show on every calendar, feed and My Day; they aren't charged against time off; booking a job on one asks first (emergencies excepted).

Add next year's holidays every fall.

---

## 3. People: hiring, changes and leaving

### Adding a new employee

*Settings → Users & logins → + Add user:*

1. **Name** and **email** (their login).
2. **Temporary password**: tell them in person or by phone; they change it under *My account*.
3. **Role**: technician, sales, accounting, HR, or a custom role. You can't create owners, administrators or roles with admin rights (an owner or administrator does those).
4. **Job title** (shows on the org chart).
5. **Reports to**: their supervisor (approves their time off).
6. **Technician profile**: for field techs, link to their profile under *Technicians* (an administrator creates the technician profile: phone, calendar color, rates).
7. Then set their **time-off allowance** for the year if it isn't the default (prorated for a mid-year start).
8. Make sure they install the app and turn on notifications ([02](02-install-devices.md)).

### Changes

Edit the user: title, supervisor, role (within your limits), reset password (signs them out everywhere).

### Someone leaves

1. **Settings → Users & logins → Edit → untick Active.** This signs them out everywhere immediately. Anyone who reported to them moves up to their supervisor automatically.
2. Make sure their **open tasks** are reassigned (Tasks → Everyone, or ask the owner).
3. **Export their timesheet** and settle final pay and remaining vacation per your policy.
4. Remove them from outside accounts (email, payroll, phone).
5. Their history (jobs, punches, chats, documents) stays for records.

---

## 4. Supervisors and the org chart

- Set **Reports to** for everyone (*Users & logins → Edit*). **Our team** shows the org chart to all employees.
- A supervisor approves time off for everyone below them, can add or cancel time off for their team, and sees their team's tasks.
- The app refuses loops (someone can't report to a person below them).

---

## 5. Pay & benefits (if turned on)

*Settings → HR & time off → Turn on "My pay & benefits"* (an owner or administrator decides). Then on **My pay & benefits**:

- **Payroll provider link:** choose the provider (QuickBooks Workforce, Gusto, ADP, Paychex, other), the employee sign-in link, who to contact with payroll questions, and a note (pay schedule…). Pay stubs, W-2s, bank and W-4 changes are made **in the payroll provider's site**; SecureOps never stores bank details.
- **Benefit plans:** **+ Plan** for each: name, type (health, dental, vision, life, disability, retirement, HSA/FSA…), provider, group #, summary, member phone, website, enrollment rules. Everyone can read these.
- **Posting documents:** **+ Post documents** → employee, type (pay stub, W-2, benefits, tax form, other), pay date / period, files (PDF/JPG/PNG). The employee sees them as **New**; you see whether they've been **opened**. Only the employee, the owner, accounting and HR can open someone's documents, and viewing someone else's document is logged.

---

## 6. Chat records (incident review)

Team chat is a company record, and employees are told so on the chat screen. When there's a complaint or incident:

1. **Team chat → Records** → enter the **reason** (e.g. "Harassment complaint #4, filed 3/12 by J. Doe").
2. For **30 minutes** you can search by person or words, read any conversation (direct, group, job threads) **including deleted messages**, view photos, and **export** a conversation to CSV for the file.
3. Every conversation you open is logged with your reason, and the owner is alerted that a review started.

Only open what's relevant to the incident, and keep exports with the incident file.

---

## 7. Tasks for HR

Use **Tasks** for recurring HR work:

- **Monthly:** "Check timecards for missed punches" (monthly, 25th).
- **Quarterly:** "Review time-off balances" (every 3 months).
- **Yearly:** "Enter carryover for new year" (January 2), "Add next year's holidays" (October 1), "Open enrollment reminder" (October 15).
- Give tasks to employees ("Bring I-9 documents", "Sign handbook acknowledgment").

---

## 8. HR settings you control

*Settings → HR & time off:* hours in a workday, default allowances, allow negative balances, who handles requests (owners/admins also notified; can decide), ask before booking on holidays, holidays, and the pay & benefits section (provider, link, contact, note). Turning the pay add-on on/off is usually the owner's decision.

---

## 9. What HR doesn't see

No customers, jobs, systems, passwords, monitoring, invoices, payments, proposals or inventory. Customer-related menus are hidden and the search box is off. That's deliberate: HR handles people, not customer data.
