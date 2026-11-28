# 13 — Service calls and scheduling

A **service call** (job, work order) is any visit: an installation, repair, maintenance, inspection, estimate / site survey or warranty work. This guide follows a job from booking to invoice, then covers the calendars, the dispatch board, the scheduling checks and the rules for completing a job.

---

## The service calls list

**Menu → Service Calls.** Quick filters at the top: **Open**, **My calls** (technicians), **Unassigned**, **Completed**, **All**, plus *Not invoiced* (completed jobs without an invoice yet). Search by number, summary or description.

## Creating a service call — **+ New service call**

| Field | Notes |
|---|---|
| **Customer**, **Site** | Pick the customer; if they have several locations, pick the site. |
| **Summary** | One line: "Panel beeping — trouble on zone 4", "Install 6 cameras". |
| **Call type** | Service, Installation, Maintenance, Inspection, Estimate (site survey), Warranty. Installation and Estimate move the customer through the pipeline ([12](12-customers-and-sales.md#automatic-moves)). |
| **System** | Camera, alarm, fire alarm, sprinkler, extinguisher, access control, other. |
| **Priority** | Low, Normal, High, **Emergency** (emergencies show at the top of the dashboard and can be booked on holidays). |
| **Status** | New → Scheduled → En route → In progress → Completed (or On hold / Cancelled). Mostly changes by itself as the tech works. |
| **Technician** | Who's doing it. Leave empty for *Unassigned*. |
| **Scheduled for** | Date and start time. Setting it changes the status to *Scheduled*. |
| **Est. duration (hours)** | How long to block on the calendar. |
| **Problem / work requested** | What the customer reported or what's to be done. |
| Actual labor hours, labor rate, **Billable** | Filled in at the end; used for the invoice and job profitability. |
| **Work performed / resolution** | What the tech did. Printed on the invoice. |
| **Customer won't be on site — no signature needed** | Owners/admins only, see [Customer sign-off](#customer-sign-off). |

When a job is saved with a technician and a time:

- the **customer** gets a confirmation by email and/or text (per their preferences, if *Settings → Texts & email* has it turned on);
- the **technician** gets an **email calendar invite**, so it appears in their Outlook/Gmail calendar (and is updated or cancelled if the job moves);
- the job appears on every calendar and the tech's **My Day**.

**Resend confirmation** sends the customer the details again.

---

## Scheduling checks

When you book or move a job, SecureOps checks the technician's time. If there's a problem it explains it; **owners and administrators** can click **Book anyway**, everyone else picks another time or tech.

| Check | Stops booking when… |
|---|---|
| **Double booking** | The tech already has a job that overlaps. |
| **Time off** | The tech has approved time off then ([17](17-the-team.md#time-off)). |
| **Blocked time** | The tech has a task with **Block this time** then (a class, a meeting…) ([17](17-the-team.md#tasks)). |
| **Travel time** | The tech can't drive from the previous job in time, or won't make the next one (*Settings → Tracking & maps*; uses real drive times when routing is set up, plus the *extra minutes between jobs*) ([15](15-inventory-trucks-and-fleet.md#drive-time-checks-when-scheduling)). |
| **Company holiday** | Asks before booking on a company holiday (emergencies excepted) (*Settings → HR & time off*). |

---

## The calendar

**Menu → Calendar.** A month view of every job.

- **Chips at the top** filter by technician (each in their calendar color), **Everyone**, or **Unassigned**. Technicians see their own jobs by default.
- Each day shows holidays (🎉), who's off (🌴), tasks (☐ to-do, ⛔ **blocked time**) and up to three jobs; "+N more" when there are more.
- **Click a day** to see its full list below the calendar (jobs and tasks). **Double-click a day** to book a job that day.
- **‹ Today ›** move between months. **+ Task** and **+ Service call** start a new one on the selected day.
- **Sync to Outlook / Google** gives you a link to subscribe ([below](#outlook-google-and-iphone-calendars)).

## The dispatch board

**Menu → Dispatch board** (the *Technician schedule*). A **week** at a time (**‹ Prev**, **This week**, **Next ›**): a row per technician plus an **Unassigned** row, a column per day. **Drag** a job to another technician or day to reassign or move it (the same scheduling checks apply); **double-click** an empty cell to add a job there. Below the board, jobs that aren't scheduled yet wait in a list.

## Outlook, Google and iPhone calendars

Two ways jobs reach everyone's normal calendar:

1. **Email invites (automatic):** each tech gets an invite when they're booked, moved or unassigned (*Settings → Texts & email → When to send*, needs email set up). It works like any meeting invite.
2. **Subscribed feeds:** **Calendar → Sync to Outlook / Google** (or *Settings → Calendars*) shows:
   - a **central feed** with every tech's jobs (owners/admins), and
   - a **feed per technician**, which also includes their on-call shifts, approved time off, tasks and company holidays.

   Copy the link and add it in Outlook (*Add calendar → Subscribe from web*), Google Calendar (*Other calendars → + → From URL*) or iPhone (*Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar*). Outside calendars refresh feeds on their own schedule (Google can take several hours; Outlook ~1–3 hours).

Feeds are **read-only**: change jobs in SecureOps and the changes flow out. Each feed link contains a private key; if one leaks, make a new link on the Calendars settings page.

---

## A job on the technician's phone

Open the job from **My Day** or the calendar. From top to bottom:

1. **Customer and site:** name, address (tap for **directions**), **phone** (tap to call through the company number when the phone line is set up: [18](18-phone-texting-and-twilio.md#part-7--click-to-call-calling-customers-from-the-app)), gate code and access notes.
2. **Systems on file** and **monitoring accounts** for this site, with stored passwords behind **Show**, and **Put on test / Take off test** ([14](14-monitoring-systems-and-fire.md#putting-an-account-on-test)).
3. **🚗 On my way:** texts/emails the customer that the tech is coming (per their preferences); status → *En route*.
4. **Start job:** status → *In progress*.
5. **Photos:** **📷 Before**, **📷 After**, **+ Other**. On a phone this opens the camera; photos are resized and uploaded. Delete with ✕.
6. **Parts used:** **+ Add part** picks items from the tech's **truck** (quantity is deducted from the truck automatically). **Remove** returns a part to stock. Or tick **No parts or equipment were used on this job**.
7. **Serial numbers:** for serial-tracked items (cameras, recorders, panels…) each unit gets a line for the **serial #**, where it's installed and a **photo of the label / warranty info**.
8. **Materials for this job:** equipment checked out of the warehouse for this job ([below](#job-materials)).
9. **Labor and resolution:** actual hours and what was done.
10. **Get customer signature / Complete job:** the customer signs on the screen with a finger, then **Complete job**.

Plus **💬 Message the office** (a chat thread for this job with the office) and, for the office, **Create invoice**.

> The tech must finish the **vehicle check** and the **start-of-day equipment check** before *On my way* / *Start job* work, if those are turned on ([below](#start-of-day-equipment-check)).

---

## Job completion rules

*Settings → Field rules → Completing a job* decides what must be done before **Complete job** works. Defaults are all on:

| Rule | Meaning | Default exemptions |
|---|---|---|
| **Photos** | At least one *Before* and one *After* photo. | Job types listed under *Job types that don't need photos* (default: `estimate`). |
| **Parts** | The parts used are recorded, or *No parts used* is ticked. | — |
| **Customer signature** | The customer signed on the phone. | Job types under *don't need a signature* (default `estimate`); jobs pre-approved by an owner/admin (below). |
| **Serial numbers** | Every serial-tracked item used has its serial # entered… | — |
| **Serial photos** | …and a photo of its label / warranty info. | — |

If something's missing, **Complete job** lists exactly what. An **owner or administrator** can complete it anyway by giving a **reason**, which is saved on the job (*Completion rule override*) and in the activity log.

### Customer sign-off

The tech can't skip the signature. It can only be skipped when an owner/admin decided so:

- **Before the visit:** on the job, tick **Customer won't be on site — no signature needed** (records who approved it). Typical for commercial work after hours.
- **For a customer in general:** on the customer, tick **Usually nobody on site to sign** (e.g. a business serviced at night).
- **At completion:** an owner/admin completes with a reason (override above).

The signature (with the signer's name and time) prints on the invoice and shows in the customer portal.

---

## Serial numbers and warranty photos

Inventory items marked **Track serial numbers** create one line per unit when added as parts on a job. For each unit the tech enters:

- **Serial #** (automatically capitalized; a serial already installed elsewhere is flagged as a duplicate),
- **Installed where** (e.g. "NE corner, warehouse"),
- a **photo of the label / warranty sticker**.

Everything lands on the customer's **Equipment** tab: description, model, serial, MAC address, location, install date, **warranty end date** (install date + the item's *manufacturer warranty months*), **status** (installed / replaced / removed / RMA) and photos. Search a serial from the top bar to find where it is. Removing the part from the job removes its equipment line.

---

## Job materials

Equipment for a job (for example the cameras and recorder for an install) is listed under the job's **Materials**:

- When a proposal is signed, its items become the install job's materials automatically ([12](12-customers-and-sales.md#what-happens-automatically-when-its-signed)). The office can add more.
- **Check out** moves the materials from the warehouse onto the assigned tech's **truck** (inventory follows).
- On the job, the tech adds what they used as **parts** (deducted from the truck).
- **Return** sends unused materials back to the warehouse.

## Start-of-day equipment check

*Settings → Field rules → Start-of-day check* (on by default). Each morning before the first job, the tech confirms on **My Day** that they have:

- the materials for **today's jobs**, plus the number of **spares** set in Settings (default 1), based on what's on their truck;
- their **tools**.

Anything missing is listed and **alerts the office**. Until the check is done (or approved), **On my way** and **Start job** won't work. If the tech is short but has to go anyway, only an **owner or administrator** can approve it, with a reason (*Approve* on the alert or the technician).

---

## Customer surveys and technician ratings

*Settings → Field rules → Customer surveys* (on by default). A few hours after a job is completed (default **2 hours**), the customer gets a short text and/or email (per their preferences) with a link:

- **Overall** stars (1–5), stars for the **technician**, **arrived on time?** yes/no, and a comment.
- Customers are surveyed at most **once every 30 days**; job types listed in *skip* (default `estimate`) and customers marked *Don't send surveys* never get one.
- **5-star** customers are offered your **Google review link** (set it in Settings).
- A score at or below the alert level (default **3 stars**) or a "late" answer **alerts the owner** right away. The follow-up (call the customer, note what was done) is recorded on the rating.

**Menu → Customer ratings** (owners/admins): company average, response rate, on-time %, low scores, and per technician: average rating, responses, on-time %, low scores, a 6-month trend and every comment. Period: last 30 / 90 days / 12 months / all time. The office can also send a survey manually from any completed job.

---

## From job to invoice

On a completed job, **Create invoice** builds an invoice from the **labor** (hours × rate, if billable) and **parts** (sell prices), with tax per Settings or the customer's exemption, and the **signature**. Review, then send it ([16](16-billing-and-accounting.md)). The *Not invoiced* filter on Service Calls shows completed jobs still waiting.

---

## Job chat

**💬 Message the office** (techs) / **Job chat** (office) opens a chat thread for that job, with the assigned tech and owners/admins. Use it for questions and photos during the job, so the conversation stays with the job ([17](17-the-team.md#team-chat)).
