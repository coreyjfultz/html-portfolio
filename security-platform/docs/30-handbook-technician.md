# Technician handbook

Everything a field technician needs to know to use SecureOps every day: the time clock, the truck, jobs from start to finish, inventory, inspections, on-call, time off, tasks, chat and calls. Keep the app installed on your phone ([how to install](02-install-devices.md)).

> **The golden rules**
> 1. Clock in when you start working and out when you stop. Your location is recorded only at that moment.
> 2. Do the **vehicle check** and **start-of-day check** before your first job; the app won't let you start without them.
> 3. Every part you use goes on the job, from your truck. Your truck count depends on it.
> 4. Before and after photos, the customer's signature, serial numbers and label photos are required to finish a job.
> 5. Never put alarm codes or passwords in chat, tasks or notes; they live (encrypted) on the customer's system record.

---

## 1. Your phone setup (once)

1. Install the app from the company address ([iPhone](02-install-devices.md#iphone-and-ipad) / [Android](02-install-devices.md#android-phones-and-tablets)) and sign in with the email and temporary password the office gave you.
2. Change your password: tap your name (top right) → **My account**.
3. Turn on notifications: **Team chat → Turn on → Allow**.
4. Allow **location** (time clock), **camera** (photos) and **microphone** (in-app calls) when asked.
5. Optional: **My Day → Add to my phone calendar** to see your jobs in your phone's calendar app too.

---

## 2. What you can see

- **Your jobs**, and the customers on your schedule from **7 days ago to 14 days ahead** (plus any open job assigned to you). For those customers you see their sites, systems, stored passwords (with **Show**), monitoring accounts and history.
- **Other customers are hidden** on purpose. If you need one (looking at a system before a quote, helping a coworker), ask the office; an owner or administrator can give you **temporary access** for a few hours or days.
- If you answer an **after-hours call** through the company line, you can see that caller's account for 24 hours.
- You don't see billing, invoices, prices paid, or other people's time off details.

---

## 3. Your day, step by step

### Start of day

1. **Clock in** (My Day → time clock card). Allow location. Where you are is recorded once:
   - **at the office** (within about 300 m of the shop): normal;
   - **at a job you're scheduled for today**: normal;
   - **anywhere else, or no location**: allowed, but the owner gets an alert with a map link. If you start somewhere unusual (supply house first thing), say so in the office chat.
2. **Vehicle check** (if due; usually every day). See [section 4](#4-your-truck).
3. **Start-of-day check:** the app lists what today's jobs need (plus spares) and your tools; confirm you have them. Missing something? Say what's missing; the office is alerted. If you really must go without it, an owner/administrator can approve the start.
4. **Weekly count** on count day (usually Friday), see [section 5](#5-inventory-what-you-need-to-know).
5. Check **My tasks** (pick-ups, returns, errands) and any **banners** (on call tonight, holiday coming, approved time off).

### During the day

For each job, open it from **My Day** and follow [section 6](#6-a-job-from-start-to-finish).

### End of day

1. Make sure every job you worked on is **completed** or has a note explaining why not (status *On hold* with the reason in the description).
2. Tick off finished **tasks**.
3. **Clock out.** Clock-outs away from the office are normal.
4. If you forgot to clock in or out, message the office right away; only the office can fix a punch, and they must write down why.

---

## 4. Your truck

### Vehicle check (daily or weekly)

From **My Day**, go through the list honestly. It protects you and the company:

| Section | What to check |
|---|---|
| Under the hood | Engine oil (dipstick between the marks), coolant and washer fluid, no leaks under the truck |
| Tires | **Enter each tire's pressure** (compared with your truck's target), tread and sidewalls |
| Lights | Headlights low/high, brake lights, signals and hazards, reverse lights / backup alarm, amber/work lights |
| Walk-around | No new dents or damage (**photo required if there is**), glass and mirrors, wipers, no dashboard warning lights, ladder rack and ladders secured, fire extinguisher and first-aid kit present |
| Clean truck | Cab and cargo organized, outside clean |
| Odometer | Current mileage (keeps oil-change and service reminders accurate) |

Anything marked as a problem alerts the owner and admins with your notes and photos. That's how things get fixed. You can't start your first job until the check is done (if your company requires it).

### Standard truck stock

Every truck carries a **standard set** of everyday parts (batteries, contacts, motion sensors, wire, connectors…): a minimum and a maximum for each. The office sees each truck's **shortages** and **extras** and restocks you or takes extras back. **Don't hoard**: extras over the maximum show up and get returned to the shop.

### Loading from the warehouse

**My Day → On my truck → Load from warehouse:** pick the item and quantity you took from the shop. This moves it from the warehouse to your truck in the system. If the office checks out **job materials** to you (e.g. the cameras for an install), they appear on your truck automatically.

---

## 5. Inventory: what you need to know

Inventory only stays right if every movement is recorded. Here's how your actions affect it:

| You do | What happens in inventory |
|---|---|
| Add a **part** to a job | Deducted from **your truck** (the *Taken from* field; change it if it came from the warehouse or another truck). |
| Remove a part from a job | Returned to where it was taken from. |
| **Load from warehouse** | Warehouse −, your truck +. |
| Office checks out **job materials** to you | Warehouse −, your truck +, listed on the job. |
| Office **returns unused** materials | Your truck −, warehouse +. Bring the items back to the shop. |
| **Weekly count** | Your truck is set to what you actually counted; differences are recorded and reported. |

### Weekly blind count

On count day you count **every item and every tool** on your truck and enter what you find. The app **doesn't show what it expects**, so count, don't guess. When you submit:

- your truck's stock is corrected to your counts;
- if anything's different, the **owner and inventory manager** see the items and the dollar difference;
- **missing tools** are flagged.

Differences usually mean a part was used but not added to a job, or loaded without recording it. Recording parts on every job is how you keep your count clean.

### Tools

Ladders, meters, drills and other tools assigned to your truck are part of the weekly count and the start-of-day check. If a tool breaks or goes missing, tell the office (they mark it *Needs repair* or *Missing*).

---

## 6. A job from start to finish

Open the job from **My Day** (or the calendar). The top shows the customer, site, **address (tap for directions)**, **phone (tap to call)**, gate code and access notes.

1. **Read the job:** summary, problem / work requested, systems on file. Stored passwords: tap **Show** (visible for 30 seconds; every reveal is logged with your name).
2. **🚗 On my way:** tap it when you leave for the job. The customer gets a text/email that you're coming (if they want those). Status → *En route*.
3. **Start job** when you arrive. Status → *In progress*.
4. **Before photos:** **📷 Before**: the panel, the problem area, the wall before you drill. At least one is required.
5. **Monitoring tests:** before testing anything that reports to the central station, **Put on test** on the job (choose how long, add a reason) **and call the station** (their number is on the station / monitoring account); the app doesn't tell the station by itself. Tests end automatically, or **Take off test** when done.
6. **Do the work.** Use **💬 Message the office** for questions; photos can go in the chat.
7. **Parts:** **+ Add part** for everything you used (taken from your truck). If you used nothing, tick **No parts or equipment were used on this job**.
8. **Serial numbers:** for serial-tracked equipment (cameras, recorders, panels…) each unit has a line: enter the **serial #**, **where it's installed**, and take a **photo of the label / warranty sticker**. Duplicate serials are flagged; check you typed it right.
9. **After photos:** **📷 After**: finished work, labels, the clean area. At least one is required.
10. **Labor and resolution:** actual hours, and **what you did** in plain words (this prints on the customer's invoice).
11. **Get customer signature:** hand the phone to the customer to sign with their finger, and type their name. If nobody's there to sign, the job must have been approved for no signature by the office beforehand (*Customer won't be on site*), or call the office; you can't skip it yourself.
12. **Complete job.** If something's missing, the app lists it. Fix it, or ask an owner/admin to complete it with a reason.

After you complete it, the customer may get a short **survey** a couple of hours later (stars for the visit and for you, and whether you were on time). Owners see the results by technician.

### Fire inspections

For inspection jobs, open **Fire inspections** (or the link from the job/system) and fill in the report on the phone: Pass / Fail / N/A for each item, readings (battery voltage, pressures…), the device list (carried over from last year), the extinguisher walk-through, deficiencies, the customer's signature, then **Complete**. **Save draft** keeps your progress. Details: [14](14-monitoring-systems-and-fire.md#fire-inspection-reports).

### Calling customers

Tap the customer's phone number in the app. The first time, it asks for your mobile number. Your phone rings first; answer it and you're connected. **The customer sees the company number, not yours.**

---

## 7. On call

**On-call & phone** shows who's on call now and next. My Day shows a banner when it's you. You get a calendar invite for your shift and a text before it starts.

When an after-hours call comes in, your phone rings with the company number. You'll hear *"After hours call from [customer]. Press 1 to accept."* **Press 1** to be connected. If you don't answer (or don't press 1), the **backup** tech is tried, then voicemail. After you answer, you can see that customer in the app for 24 hours. Create a service call for the visit if one is needed.

Can't cover your shift? Tell the office **before** it starts so they can change the schedule.

---

## 8. Time clock and your timecard

- Clock in when you start work, out when you stop. Use clock out / in around unpaid breaks if that's company policy.
- Your **recent punches** are on the Time clock page.
- Hours over **40 in a week** are overtime.
- **Mistakes** (forgot to clock out, clocked in late): message the office/HR the same day. They correct it with a reason, and the change is kept with their name. You can't edit punches yourself.
- Location is checked **only at each punch**. Truck GPS (if the company has it) is separate.

---

## 9. Time off

**Time off → Request time off:**

1. Pick the type (**Vacation**, **Sick**, **Personal**, **Training**, **Other**); the hours you have left show next to each.
2. **Whole days** (first and last day), or untick for **part of a day** (from–until).
3. Add a note if helpful, then **Send request**.

Your **supervisor** (shown in the dialog) is notified, and usually the office too. You get a text/email when it's approved or denied. Approved time off blocks the schedule, so nobody can book you then.

**Balances** at the top of the page show what's left this year (in days and hours). Weekends and company holidays inside a request aren't counted. Sick time for a sudden illness: request it as soon as you can (even the same morning) and message your supervisor.

Cancel a request you no longer need from **My requests → Cancel**.

---

## 10. Tasks

Errands and to-dos that aren't jobs: "pick up 6 panels at ADI", "return the Amazon order", "drop off keys at Rosie's".

- They show on **My Day** and under **Tasks**. The menu count shows how many are due today or overdue.
- Tick the circle when done (you can add a note). Whoever gave it to you is notified.
- You can make your own (**+ New task**) and give tasks to others.
- A task with ⛔ **blocked time** (a class, a safety meeting) means the office can't book you jobs then.
- A **repeating** task (e.g. "wash the truck every Friday") makes a new to-do on each date.

---

## 11. Team chat and calls

- **Team chat:** 📣 *Everyone* for announcements, one-to-one messages, groups, and a **thread per job** (*Message the office*). Send photos with 📷. Delete your own message within 15 minutes.
- **Chats are company records:** owners/admins/HR can review any conversation (including deleted messages) if there's an incident. Keep it professional.
- **In-app calls:** call a coworker free from Team chat (📞) or **Our team**. When someone calls you, answer on the full-screen card or from the notification.
- **Our team** shows who's who, who's in the app, and who's out today.

---

## 12. Help when you're stuck

- **Training library:** how-to videos, manuals (PDF) and step-by-step articles, searchable by model or keywords.
- **Help assistant** (if your company turned it on): ask a question in plain words on the Training library page; it answers from the company's own library and manuals. Always follow life-safety steps and the AHJ / NFPA; never bypass a life-safety device.
- **Support contacts:** manufacturer tech support, RMA, the central station: tap to call, with the company's dealer/account numbers.

---

## 13. Pay and benefits

If your company turned it on, **My pay & benefits** links to the payroll site (pay stubs, W-2s, direct deposit, W-4), lists the benefit plans, shows your time-off balances, and holds documents posted just for you (marked **New** until opened). Only you, the owner, accounting and HR can open your documents.

---

## 14. Quick answers

| Question | Answer |
|---|---|
| Can't tap *On my way* | Do the vehicle check and start-of-day check first. |
| Can't complete the job | Read the list it shows: photos, parts, signature, serials or label photos. |
| Customer isn't there to sign | Call the office before leaving; only an owner/admin can approve no signature. |
| Need a customer I can't see | Ask the office for temporary access. |
| Wrong part count on my truck | Add missing parts to the jobs they were used on; your weekly count corrects the rest. |
| Forgot to clock out | Message the office/HR today. |
| Notifications stopped | Open the app from the Home Screen icon; Team chat → Turn on; check phone notification settings. |
| App acting strange | Close it completely and reopen. |
