# Office and dispatch handbook

For the people who run the day: answering calls, booking and dispatching jobs, keeping technicians stocked, handling monitoring tests, closing out jobs, and keeping maintenance and inspections on schedule. This is the **Administrator** role (or a custom "Dispatcher" role, [11](11-roles-and-permissions.md#custom-roles)). Administrators can do everything except owner-only things (other owners/administrators, roles, backups).

---

## 1. Start of the day

- [ ] **Clock in** (dashboard).
- [ ] **Dashboard:** emergencies, accounts **on test**, alerts (techs short on equipment, vehicle problems), unassigned calls, today's jobs.
- [ ] **Dispatch board** (this week): everyone has a full, realistic day; nobody is booked while out (🌴) or during blocked time (⛔).
- [ ] **Who's out today:** reassign any of their jobs.
- [ ] **Start-of-day checks:** if a tech reported something missing, restock them, swap the job, or (owner/admin) **approve the start**.
- [ ] **My tasks** and the **job chats** (techs' questions come in as *Message the office*).

---

## 2. A customer calls

1. **Search** (top bar) by name, phone, address or account #.
2. New caller? **+ Customer** (type, name, phone, email, address, lead source). If it's a sales inquiry, leave them as a **Lead** and give it to sales (a task, or book an **Estimate**).
3. **+ Service call** from the customer page ([13](13-service-calls-and-scheduling.md#creating-a-service-call---new-service-call)):
   - **call type** (service, installation, maintenance, inspection, estimate, warranty) and **priority** (low, normal, high, **emergency**);
   - **site** and **system** it's about;
   - **summary** and the problem in the customer's words;
   - **technician**, **date and time**, **duration**;
   - **billable** or not (warranty, callback).
4. The app checks the schedule: double booking, time off, blocked time, travel time, holidays. If there's a conflict it tells you why; pick another time or tech, or (owner/admin) **Book anyway** with a reason.
5. The customer gets a confirmation (email/text per their preference). The tech gets a notification and it's on their calendar.

Customers can also **request service** in the portal; those arrive as new service calls (status *New*) for you to schedule.

**Emergencies** show at the top of the dashboard until someone takes them.

---

## 3. Dispatching

- **Calendar:** month view; filter by technician; double-click a day to book.
- **Dispatch board:** a week, a row per tech. **Drag** a job to move or reassign (the same checks apply); double-click an empty cell to add. Unscheduled jobs wait below.
- **Live map** (with GPS connected): where each truck is; useful for squeezing in an urgent call.
- **Drive times:** the travel check uses real drive times (with routing set up) plus the extra minutes between jobs from Settings.
- **Tasks with blocked time** (training, meetings) block booking; plain tasks just show on the calendar.

---

## 4. Getting equipment to the job

| Situation | What you do |
|---|---|
| A proposal was signed | The install job already lists the **materials**. Assign the tech, then **Check out** (warehouse → their truck). |
| A job needs specific parts | Add them to the job's **Materials**, then **Check out**. |
| Job is done, parts left over | **Return** unused materials (truck → warehouse); the tech brings them back. |
| Trucks running low on everyday stock | **Truck stock → Restock from warehouse** (fills every shortage). |
| A truck carries too much | **Return extras**. |
| Warehouse running low | Inventory → **Low stock only**; order from the distributor. Their invoice comes in through **Receiving**. |

Details: [15](15-inventory-trucks-and-fleet.md).

---

## 5. During jobs

- **Job chat:** answer techs' questions on the job thread; photos come through there too.
- **Monitoring tests:** techs put an account **on test** from the job (with an end time) and call the central station. You see every account on test on the dashboard. Make sure tests are taken off when work is done.
- **Customer won't be on site** (after-hours commercial): pre-approve **no signature** on the job before the tech goes (owner/admin).
- **Tech can't complete:** the app tells them what's missing (photos, parts, signature, serials, label photos). If there's a real reason, owner/admin can complete it with a reason.
- **Tech access:** a tech needs to look at a customer not on their schedule? Customer → **Tech access** → tech, hours, reason.

---

## 6. Closing out jobs

1. **Service calls** list → filter *Completed* (not invoiced).
2. Open each: check the resolution text (it prints on the invoice), parts and hours.
3. **Create invoice** (if you have billing permission; otherwise accounting does). Labor, parts and the customer's signature are filled in.
4. Not billable (warranty/callback)? Make sure **billable** is off.

Customers get a short **survey** after completion; low scores alert the owner.

---

## 7. Keeping things on schedule

### Maintenance Due

**Menu → Maintenance Due** every week: camera services, alarm tests, fire inspections, extinguishers (annual, 6-year, hydrostatic, replacement) and vehicle dates. **Schedule** creates a service call; **Mark done** rolls the date forward ([14](14-monitoring-systems-and-fire.md#maintenance-due)).

### Fire inspections

Inspection jobs: the tech fills the report on the phone. When completed, the next inspection date rolls forward and the report can be **sent** to the customer (and AHJ, if required) as a link or PDF ([14](14-monitoring-systems-and-fire.md#fire-inspection-reports)).

### On call

**On-call & phone:** keep the rotation filled (primary and backup). Swap shifts when someone's out; techs get a calendar invite and a text before each shift. After-hours calls ring the on-call tech; missed calls and voicemails alert the owner ([18](18-phone-texting-and-twilio.md#part-6--the-on-call-schedule)).

---

## 8. Inventory: the office's part

- **Receiving:** check the **review inbox** daily. Invoices from trusted distributors with every line matched are received automatically; the rest wait for you, side by side with the original. Match lines, then **Receive into stock** ([15](15-inventory-trucks-and-fleet.md#receiving-supplier-invoices)).
- **Product photos:** add a photo to items you quote often (open the item → **📷 Add photo**). They show in lists and on proposals.
- **Weekly counts:** after count day, look at Truck stock for differences and overdue counts; **Mark reviewed**.
- **Tools:** set status (*Needs repair*, *Missing*) and which truck they live on.
- **Never edit stock by hand** to "fix" a number without a count: use **Physical count** so the difference is recorded.

---

## 9. Tasks

Use tasks for anything that isn't a job:

- Errands for techs: "Pick up 6 panels at ADI", "Return the RMA camera to Hikvision".
- Office follow-ups: "Call Becker about the quote", "Renew truck 3 registration".
- Meetings and training with **Block this time**, so nobody gets booked.
- **Repeating:** "Order batteries" every month, "Safety meeting" every other Monday.

You see **everyone's** tasks (Tasks → Everyone) and who's late. Whoever gave a task is notified when it's done ([17](17-the-team.md#tasks)).

---

## 10. Time off and the schedule

- Approved time off **blocks booking** that tech. When a request shows **jobs already booked** in that window, move them as soon as it's approved.
- Company holidays ask before booking (emergencies excepted).
- You may approve/deny if you're their supervisor, or if your company lets owners/admins decide everyone's requests ([17](17-the-team.md#time-off)).
- Your own time off: **Time off → Request time off**.

---

## 11. Your own timecard

Clock in and out like everyone else (dashboard or Time clock). Administrators also see everyone's timesheets and can correct a punch (with a reason). Payroll export is usually done by HR or accounting.

---

## 12. End of the day

- [ ] Tomorrow's schedule is full and sensible; materials checked out for tomorrow's installs.
- [ ] Every job today is completed or has a note; nothing still **on test** that shouldn't be.
- [ ] Unanswered job chats and voicemails handled.
- [ ] Tomorrow's on-call is covered.
- [ ] **Clock out.**
