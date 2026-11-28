# 17 — The team

Everything for the people side of the company: the time clock and timesheets, time off with balances and holidays, supervisors and the org chart, tasks, team chat (and chat records for incidents), in-app calls, the training library and support contacts, the optional help assistant, and the optional pay & benefits add-on.

---

## Time clock

**Menu → Time clock**, or the clock card on the dashboard and My Day.

### Clocking in and out

Tap **Clock in** at the start of the day and **Clock out** at the end (and around unpaid breaks, if that's company policy). The phone asks for **location** the first time; each punch records where you were **at that moment only**. The app does not track you in between.

What happens with the location:

| Where you clock in | Result |
|---|---|
| Within the office radius (default **300 m** around the office location in Settings) | Marked **at the office**. |
| At a job you're scheduled for **today** (if *clocking in at a job you're scheduled for is OK* is on, the default) | Marked **at job site**, no alert. |
| Anywhere else | Marked **away**, and the **owner is alerted** with a map link. |
| No location (permission denied, GPS off, computer without location) | Marked **no location**, and the owner is alerted. |

Clock-outs away from the office alert the owner only if *Also alert on clock-outs away* is on (off by default). Set the **office location** in *Settings → Field rules → Time clock*: type the address and click **Look up the address**, or stand in the office and click **Use this device's location**, then save.

### Timesheets (owners, admins, accounting, HR)

The Time clock page shows **On the clock now** (who's clocked in, since when, where) and **Timesheets** for a date range (**From / To**): per person, total, **regular and overtime hours** (overtime = over **40 hours per week**). Open a person to see **every punch** with times and location badges (office / job site / away / no location, with map links).

- **+ Manual entry** for a forgotten punch, or **Edit** one: a **reason is required** and the change is kept with who made it.
- **Export timesheets (CSV)** for payroll (QuickBooks Payroll, Gusto, ADP…).

Everyone else sees **My recent punches**.

---

## Time off

**Menu → Time off.**

### Requesting

**Request time off:**

- **Type:** 🏖️ Vacation, 🤒 Sick, Personal, 🎓 Training, Other. The available hours for each show in the list.
- **Whole days** (first and last day), or untick for **part of a day** (from–until time).
- **Note** (optional): "Family trip".

The request goes to your **supervisor**, and by default also to owners, admins and HR (see *Who decides* below). You get a text/email when it's decided. **My requests** lists yours; **Cancel** a pending or approved one that hasn't started.

### Balances

The cards at the top show what you have **left this year** for vacation, sick and personal time, in days and hours:

> **Left** = yearly allowance + carried over from last year − approved time off this year (pending requests are shown separately)

Weekends and **company holidays** inside a request aren't counted. Hours per day come from *Hours in a workday* (Settings, default 8). Requests bigger than what's left are refused unless *Let people request more than they have left* is on; owners/admins/HR adding time off directly can go over.

**Setting allowances:** company defaults in *Settings → HR & time off* (default **80 h vacation, 40 h sick, 16 h personal** per year). For a person, on the Time off page → **Balances → Set**: their yearly hours and **carryover** for each type.

### Who decides

- The person's **supervisor** (*Reports to*, or anyone above them in the org chart) can approve or deny.
- **Owners, admins and HR** (and roles with *Time off for everyone*) get every request too and can decide any of them, unless *Settings → HR & time off → Who handles time-off requests* is switched to supervisors only.
- Someone with **no supervisor** always goes to owners/admins/HR.
- Nobody approves **their own** request, except the owner.

Waiting requests appear in **Waiting for your approval** on the Time off page, with a banner on the dashboard / My Day. Each shows any **jobs already booked** in that window and **on-call shifts** that overlap. **Approve**, or **Deny** with a reason (they'll see it). After approving, reassign the listed jobs.

**+ Add for someone / for my team** enters time off that's already agreed (approved straight away).

### What approved time off does

- **Blocks scheduling** that person (owners/admins can book anyway).
- Shows on the **calendar** (🌴), on their and the central **Outlook/Google feed**, and in **Who's out** (Time off page and the dashboard's "Out today").
- Counts against their balance.

### Company holidays

*Settings → HR & time off → Holidays:* **Add US holidays for 2027…** adds the federal holidays with their **observed** dates (a Saturday holiday is observed Friday, a Sunday one Monday); tick which ones the company observes. **+ Other holiday** adds your own (day after Thanksgiving, Christmas Eve…).

Holidays show on every calendar and feed and on My Day, aren't charged against time off, and **booking a job on a holiday asks first** (emergencies excepted) if that option is on.

---

## Supervisors and the org chart

Each person can have a **job title** and a **supervisor** (*Settings → Users & logins → Edit → Reports to*).

- **Our team** (menu) shows the **org chart** to everyone: who reports to whom, titles, who's in the app right now, who's out today, with **💬 message** and **📞 call** buttons on each person.
- **My account** shows who you report to and who reports to you.
- A supervisor:
  - approves time off for everyone below them (directly or further down);
  - can add or cancel time off for their team;
  - sees their team's tasks (**Tasks → My team**) and can help complete them.
- Nobody can report to themselves or to someone below them (the app refuses loops).
- When a supervisor is made **inactive**, their people move up to the next supervisor automatically.

---

## Tasks

**Menu → Tasks** (also on the dashboard and My Day). To-dos that aren't jobs: "pick up 6 panels at ADI", "return the Amazon order", "deposit checks", "renew the alarm permit".

### Creating a task — **+ New task**

| Field | Notes |
|---|---|
| **What needs to be done?** | Short title. |
| **Who** | You (default), anyone on the team, or "Anyone / unassigned". |
| **Due** | Date (optional). |
| **From / To** | Optional time (e.g. 1:00–2:30 pm). A start without an end gets one hour. |
| **Block this time on the calendar** | See below. |
| **Priority** | Low, Normal, High. |
| **Where** | "ADI Dayton will-call", "Fifth Third Bank". |
| **Notes** | Details. |
| **Repeat** | See *Repeating tasks*. |

The person gets a **phone notification** and an **email** ("New task from Office Admin"). When they tick it done (optionally with a note), whoever assigned it is notified. Each morning, anyone with tasks due today or overdue gets a reminder notification.

### Views

**My tasks** (overdue, today, coming up, no date, done today), **Assigned by me**, **My team** (supervisors), **Everyone** (owners/admins), **Repeating**, **Done** (last 60 days). Tick the circle to complete; tap a task to open, edit or delete it. The creator, the assignee, their supervisors and owners/admins can edit; the creator and owners/admins can delete.

### Repeating tasks

Choose **Repeat**:

| Option | Example |
|---|---|
| **Daily / every few days** | Every day; every 3 days. |
| **Every weekday (Mon–Fri)** | Check the voicemail box. |
| **Weekly** | Every Tuesday and Friday; every other Monday (*Every 2 weeks*). Tick the days. |
| **Monthly** | On the 1st; on the 31st = the **last day** of shorter months. Every 3 months = quarterly. |

Plus **Starting** and **Until** (optional). A new to-do appears **on each date**. If the previous one is still open, a duplicate isn't created; the open one just stays overdue. **Tasks → Repeating** lists them; open one to change the schedule, the person or the time, or **Stop repeating** (which also removes its open to-do).

### Tasks on the calendar, and blocked time

Every task with a date appears on the **calendar** (and Outlook/Google feeds): ☐ for a to-do, ⛔ for blocked time, at its time or all day.

**Block this time on the calendar:** while the task is open, **no job can be booked for that person** in that time: the whole day if no times are set (a training class), or the window (a 7:00–7:30 safety meeting every Monday). Owners/admins can book anyway. If you block time when the person already has jobs then, you're asked first. Repeating blocks also block their **future** dates. Others see your blocked time as **"Busy"** unless they created the task or manage you.

---

## Team chat

**Menu → Team chat** (💬 at the top shows unread messages).

### Conversations

| Kind | Who's in it |
|---|---|
| 📣 **Everyone** | The whole company. Announcements. |
| **One-to-one** | **+ New → Message one person**. |
| **Groups** | **+ New → start a group**: name it ("Miller install crew") and pick people. Whoever made it (or an admin) changes members (**Members**). |
| 🔧 **Job threads** | From a job: **💬 Message the office** (tech) / **Job chat** (office). The assigned tech plus owners/admins. |

Type and **Send**, or **📷** to attach a photo. Messages arrive instantly while the app is open, and as **notifications** when it isn't (turn them on: **Turn on** at the top of the chat list, per device). **🔕 Mute** a conversation to stop its notifications. You can **delete your own message within 15 minutes**. The conversation list shows who's online (green dot).

### Chats are company records

The chat screen tells everyone: *"Chats are company records."* If there's an incident (harassment complaint, safety issue, dispute), people with the **Chat records** permission (owners, admins, HR) can review conversations:

1. **Team chat → Records** → enter the **reason** (e.g. "Complaint #12 from J. Smith").
2. For the next **30 minutes**, search conversations by person or words, read any conversation **including direct messages and deleted messages**, view photos, and **Export** a conversation to CSV.
3. Every conversation opened is written to the **Activity log** with the reason, and **owners are alerted** whenever someone other than an owner starts a review.

---

## In-app calls

Free voice calls between team members over the internet, from phone or computer, without using anyone's phone number.

- **Call:** **Team chat → 📞** (pick a person; a green dot means they have the app open), the **Call** button in a one-to-one chat, or 📞 on **Our team**.
- **Receive:** a full-screen card with the caller's name, a ring and vibration, **Answer** / **Decline**. If the app is closed, a notification ("📞 Mike is calling"); tap it to open the call. It rings for about **35 seconds**, then counts as missed.
- **During the call:** timer, **Mute**, **Hang up**. Use a headset or earbuds in noisy places.
- **Call log:** each call is noted in that pair's chat ("📞 Call · 3:12", "📞 Missed call", "📞 Call declined"); a missed call also sends a notification.
- If someone is already on a call, you're told; send a message instead.
- One-to-one calls only (no group calls or video yet).

**Permissions:** the first call asks for the **microphone** ([02](02-install-devices.md)). If a call rings but "couldn't connect", one of the networks (some cell carriers, office firewalls) blocks direct audio; an owner can turn on a **relay server** under *Settings → Phone & on-call → In-app calls* ([18](18-phone-texting-and-twilio.md#relay-server-for-in-app-calls)). Owners can also turn in-app calls off there.

---

## Training library and support contacts

### Training library

**Menu → Training library.** How-to material for the field, searchable from a phone.

- **Item types:** **Video** (YouTube and Vimeo play right inside the app), **Manual (PDF)**, **How-to article** (text, step by step), **Web link**.
- **Categories:** alarm panels, cameras & NVRs, fire alarm, sprinkler & suppression, extinguishers, access control, networking, wiring & tools, safety, company policies, using SecureOps, other.
- **Search** by title, manufacturer, model, search words (tags) and article text; filter by category and type.
- **Adding** (owners/admins): **+ Add** → title, type, category, manufacturer, model(s), video/web link, article text, search words. For a manual, save, open it and **Upload PDF** (up to 30 MB). **Replace file** / **Remove file** later.

### Support contacts

**Menu → Support contacts.** Who to call for help: manufacturer **tech support**, **warranty / RMA**, distributor **sales reps**, **customer service**, **billing**, the **central station**, **software / IT helpdesk**. Each card has company, department, products, contact name, **tap-to-call phone**, email, website, **hours**, **your account / dealer #**, and notes ("Press 2 then 1 for dealer support"). Office staff add and edit; everyone can read.

---

## Help assistant (optional)

An AI assistant (Claude, by Anthropic) on the **Training library** page that answers how-to questions: "How do I default the installer code on a Qolsys IQ4?", "What's the hydro interval for a CO2 extinguisher?"

**How it answers:** it searches your library for matching items and reads the best matches (including up to two manual PDFs), plus your support contacts, then answers briefly. It **names the library items** it used (click to open them) and **puts life safety first**: notify the central station before testing, follow NFPA and the AHJ, never bypass a life-safety device. If it doesn't know, it says so and suggests who to call. Follow-up questions keep the context. Rate answers 👍 / 👎.

**Privacy:** only the question and the matching library content (and contact list) are sent to Anthropic; **no customer records**. The screen reminds people not to type customer names, codes or passwords.

**Turning it on** (owner): *Settings → Help assistant*: tick **Turn on the help assistant**; set **questions per person per day** (default 25; 0 = no limit) and **answer depth** (quick / balanced / thorough). The server needs `ANTHROPIC_API_KEY` ([20](20-integrations.md#claude-api)); Anthropic bills that account per question (typically a few cents). The same page lists **recent questions** with the answers and ratings, so you can see what the library is missing.

---

## Pay and benefits (optional add-on)

Off until an owner turns it on: *Settings → HR & time off → Turn on "My pay & benefits" for everyone*. It adds **My pay & benefits** to everyone's menu:

| Section | What it shows |
|---|---|
| **Pay stubs, W-2s & direct deposit** | A button to your **payroll provider's employee site** (QuickBooks Workforce by default; or Gusto, ADP, Paychex, or another with your own link), where pay stubs, W-2s, bank changes and W-4 changes are made. Plus the company's note (pay schedule…) and who to ask. |
| **Time off left** | Vacation / sick / personal balances. |
| **Benefits** | The company's benefit plans: health, dental, vision, life, disability, retirement, HSA/FSA…, each with provider, group #, summary, member phone, website and enrollment rules. |
| **My documents** | Private documents posted for you: pay stubs, W-2s, benefits paperwork. **New** until you open them. |

**For owners, accounting and HR** (*Pay & benefits admin*): **+ Plan** to add or edit benefit plans; **+ Post documents** to upload PDFs/photos for an employee (type, pay date). Only the employee, the owner, accounting and HR can open someone's documents; the office sees whether they've been opened, and viewing someone else's document is logged.

> SecureOps doesn't run payroll or store bank details. Bank and tax changes are made in the payroll provider's own site, which is the safest place for them.
