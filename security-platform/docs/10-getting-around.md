# 10 — Getting around

This guide explains the parts of SecureOps everyone uses: signing in, the menu, the dashboard, **My Day**, search, notifications and your own account.

---

## Signing in

Go to your company's address (or open the installed app) and enter your **email** and **password**. You stay signed in on that device for a long time; use **Sign out** (top right) on shared computers.

- After **10 wrong passwords within 15 minutes** sign-in is paused (this stops password-guessing). Wait 15 minutes, or ask an administrator to reset your password.
- Passwords must be at least 8 characters; longer is better. Change yours under **My account**.

---

## The screen layout

| Part | What it does |
|---|---|
| **Menu (left)** | Every area you have access to. On a phone, tap **☰** (top left) to open it. Red numbers show unread chat messages and tasks due today or overdue. |
| **Search (top)** | Finds customers, phone numbers, invoice #s, service call #s, parts and serial numbers. |
| **💬 (top right)** | Team chat, with the unread count. |
| **Your name (top right)** | **My account**: change password, who you report to, how to install the app. |
| **Sign out** | Ends your session on this device. |

The menu only shows what your **role** allows ([11](11-roles-and-permissions.md)). If you can't find something a colleague has, it's probably not part of your role.

### The menu, section by section

| Section | Items |
|---|---|
| *(top)* | Dashboard, **My Day** (technicians), Time clock, **Tasks**, Team chat, Time off, **Our team**, My pay & benefits (if turned on), Training library, Support contacts |
| **Customers** | Customers, Pipeline, Proposals, Monitoring, Maintenance Due, Fire inspections |
| **Field work** | Service Calls, Calendar, Dispatch board, Live map, Technicians, Customer ratings, On-call & phone |
| **Billing** | Invoices, Payments, Expenses |
| **Operations** | Inventory, Receiving, Truck stock, Tools, Vehicles |
| **Insights** | Reports, Accounting, Settings |

---

## The dashboard

The first screen for office staff. From top to bottom:

1. **Greeting and quick buttons:** *+ Service call*, *+ Customer*, and **Run monthly billing** when this month's recurring invoices haven't been made yet.
2. **Warnings:** monitoring accounts currently **on test** (with when the test ends) and any open **emergency** calls.
3. **Time clock:** clock in or out right from the dashboard.
4. **Time-off approvals:** "🌴 2 time-off requests waiting for your approval" if you're someone's supervisor (or an owner/admin/HR).
5. **My tasks:** your tasks due today or overdue, with checkboxes.
6. **Who's out today** (approved time off).
7. **Alerts:** things the owner should know (truck count differences, missing tools, techs short on equipment, clock-ins away from the office, voicemails and missed calls, failed backups, low survey scores…). Click **Open** to go to it, and **Dismiss** once it's handled.
8. **Key numbers:** monthly recurring revenue, billed and collected this month, outstanding and overdue balances (billing roles only), active customers, open and unassigned service calls, overdue maintenance.
9. **Today's jobs**, **maintenance due soon** and **low stock**.

Roles without access to customers (for example HR) see a simpler dashboard: the time clock, approvals and tasks.

---

## My Day (technicians)

A technician's home screen on the phone. It's built for the start of the day, top to bottom:

1. **Time clock:** clock in.
2. **Banners:** approved time off coming up, a company holiday in the next two weeks, your on-call shift ("You're on call until Monday 7:00 AM").
3. **My tasks:** due today or overdue (tick them off here).
4. **Vehicle check:** if it's due, the truck checklist (oil, tires, lights, walk-around…). See [15](15-inventory-trucks-and-fleet.md#vehicle-checklist).
5. **Start-of-day check:** confirm you have the materials for today's jobs and your tools. Until it's done, you can't tap *On my way* or *Start* on a job. See [13](13-service-calls-and-scheduling.md#start-of-day-equipment-check).
6. **Weekly truck count:** shown on count day, or if the truck is overdue.
7. **Today's jobs**, in order, with time, customer, address, phone and status. Tap one to open it.
8. **Coming up (next 7 days)** and **Assigned to you, not scheduled**.
9. **On my truck:** what's on your vehicle right now, plus **Load from warehouse**.

Buttons at the top: **Add to my phone calendar** (subscribe to your own job feed), **My calendar**, **+ Service call**.

---

## Search

Type at least two characters in the search box at the top. Results are grouped: **customers** (name, phone, email, address), **service calls** (number, summary, description), **invoices** (number; billing roles only), **installed equipment** (by **serial number**, e.g. to find where a camera with serial `ABC123` was installed), **inventory items** (name or part #, with quantity on hand), **vehicles** and **technicians**. Click a result to open it.

Technicians only find customers on their own schedule ([11](11-roles-and-permissions.md#technicians-see-only-their-own-customers)). Roles without customer access don't see the search box.

---

## Lists, forms and records

Most areas work the same way:

- **Lists** have a search box and filters (status, type, technician, dates…) at the top. Click a row to open it.
- **+ New** (or *+ Customer*, *+ Service call*…) opens a form. Required fields are marked; the form won't save until they're filled.
- **Edit** opens the same form with the current values. **Delete** (where allowed) asks for confirmation. Records that other things depend on (a customer with invoices, an item with stock history) can't be deleted; mark them **inactive** instead.
- Dates use your browser's date picker; money fields accept numbers only.
- Changes save to the server immediately. Everyone sees them the next time their screen refreshes (open the page again or pull down on a phone).

### Hidden passwords and codes

Alarm codes, camera passwords, panel codes and passcodes show as `••••••`. Click **Show** to see one for 30 seconds; every *Show* is recorded in the **Activity log** with who and when. See [19](19-backups-and-security.md#stored-passwords-and-codes).

---

## Notifications

SecureOps can notify you on your phone or computer when the app is closed:

| Notification | When |
|---|---|
| 💬 New chat message | Someone writes to you, a group you're in, or *Everyone* (unless you muted it) |
| 📞 Incoming call / missed call | A team member calls you in the app |
| ✅ New task / task done | Someone gives you a task, or finishes one you gave them |
| 🗓️ Tasks for today | A morning reminder when you have tasks due |
| 🌴 Time-off request / decision | Someone you supervise asks for time off; your request is approved or denied |

Turn them on per device: **Team chat → Turn on** ([02](02-install-devices.md)). Owners also get **email** (and optionally **text**) alerts for important events; see *Settings → Field rules → Owner alerts*.

---

## My account

Click your name (top right):

- **Change password:** enter the current one, then the new one.
- **Reports to / Your team:** who your supervisor is and who reports to you ([17](17-the-team.md#supervisors-and-the-org-chart)).
- **Install the app:** quick reminders for iPhone, Android and computers.

---

## Tips

- **Pull down / refresh** to see others' latest changes.
- **Phone in landscape** gives wide tables more room; most screens are designed for portrait.
- Links in emails and texts (invoices, agreements, surveys, inspection reports) are for **customers** and open without a login. Staff use the app.
- If something looks wrong after an update, close the app completely and reopen it.
