# 11 — Roles and permissions

Every login has exactly one **role**. The role decides which menu items a person sees, which records they can open, and what they can change. The server enforces it, so hiding a menu item isn't the only protection: someone who types a hidden address directly is refused too.

Roles are separate from **supervisors** (who reports to whom). A supervisor approves time off for their team whatever their role; see [17](17-the-team.md#supervisors-and-the-org-chart).

---

## The built-in roles

| Role | In one sentence |
|---|---|
| **Owner / Global admin** | Everything, including other owners and administrators, backups, roles, and restoring data. |
| **Administrator** | Runs the business day to day: customers, scheduling, billing, inventory, the team and settings, but not owner accounts, backups or roles. |
| **Sales** | Leads, the pipeline, site surveys, estimates, proposals and agreements. No invoices or financial reports. |
| **Accounting** | Invoices, payments, expenses, receiving, reports, QuickBooks, pay stubs & benefits. Can see (not edit) proposals. |
| **Technician** | Their own jobs and schedule, the customers on that schedule (systems, passwords, monitoring), photos, signatures, their truck's inventory. No billing. |
| **HR** | Everyone's timesheets, time off, balances and holidays, users and supervisors, pay stubs & benefits, chat records. **No customers, jobs or billing.** |

### What each built-in role can do

✅ = yes · 👁 = view only · ➖ = no · 🔸 = limited (see notes)

| Area | Owner | Admin | Sales | Accounting | Technician | HR |
|---|---|---|---|---|---|---|
| Dashboard | ✅ | ✅ | ✅ | ✅ (with money figures) | ✅ (their jobs) | 🔸 simple |
| **Customers**: view | ✅ | ✅ | ✅ | ✅ | 🔸 own schedule | ➖ |
| Customers: add / edit | ✅ | ✅ | ✅ | ✅ | ➖ | ➖ |
| Systems on file & stored passwords (Show) | ✅ | ✅ | ✅ | ✅ | 🔸 own schedule | ➖ |
| Monitoring accounts, put on test | ✅ | ✅ | ✅ | ✅ | 🔸 own schedule | ➖ |
| Pipeline | ✅ | ✅ | ✅ | ✅ | ➖ | ➖ |
| **Proposals & agreements**: create, send | ✅ | ✅ | ✅ | 👁 | ➖ | ➖ |
| Site survey photos (take, mark up, put on proposals) | ✅ | ✅ | ✅ | 👁 | ➖ | ➖ |
| **Service calls**: view / create / update | ✅ | ✅ | ✅ | ✅ | 🔸 own customers | ➖ |
| Override scheduling conflicts (double booking, travel time, time off, blocked time) | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ |
| Override job completion rules, pre-approve "no signature" | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ |
| Let a tech start without the start-of-day check | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ |
| Calendar, dispatch board | ✅ | ✅ | ✅ | ✅ | ✅ (own calendar by default) | 🔸 calendar |
| Live map, customer ratings | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ |
| Fire inspections | ✅ | ✅ | ✅ | ✅ | 🔸 own customers | ➖ |
| **Invoices, payments, expenses** | ✅ | ✅ | ➖ | ✅ | ➖ | ➖ |
| Reports, accounting, QuickBooks | ✅ | ✅ | ➖ | ✅ | ➖ | ➖ |
| Inventory: view | ✅ | ✅ | ✅ | ✅ | ✅ | ➖ |
| Receiving, truck stock admin | ✅ | ✅ | ➖ | ✅ | ➖ | ➖ |
| Own truck: count, load, start-of-day check | — | — | — | — | ✅ | — |
| Vehicles: view | ✅ | ✅ | ✅ | ✅ | ✅ | ➖ |
| Vehicles: add / edit | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ |
| Inventory items & tools: add / edit, product photos | ✅ | ✅ | ➖ | ✅ | ➖ | ➖ |
| Time clock (own) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Timesheets for everyone: view, correct, export | ✅ | ✅ | ➖ | ✅ | ➖ | ✅ |
| Time off: request | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Time off: decide for **everyone**, set balances, holidays | ✅ | ✅ | ➖ | ➖ | ➖ | ✅ |
| Users & logins, supervisors, job titles | ✅ | ✅ | ➖ | ➖ | ➖ | 🔸 not admin accounts |
| Roles & permissions | ✅ edit | 👁 | ➖ | ➖ | ➖ | 👁 |
| Pay & benefits admin (post pay stubs, benefit plans) | ✅ | ➖ | ➖ | ✅ | ➖ | ✅ |
| Chat records (incident review) | ✅ | ✅ | ➖ | ➖ | ➖ | ✅ |
| Tasks: own, assign to anyone | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Tasks: see everyone's | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ |
| Team chat, in-app calls, training library, Our team | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Training library: add / edit | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ |
| Support contacts: add / edit | ✅ | ✅ | ✅ | ✅ | ➖ | ➖ |
| Settings (company, payments, texts, phone, field rules, tracking…) | ✅ | ✅ | ➖ | ➖ | ➖ | 🔸 HR tab only |
| **Backups**, restore, recover a deleted customer | ✅ | ➖ | ➖ | ➖ | ➖ | ➖ |
| Activity log | ✅ | ✅ | ➖ | ➖ | ➖ | ➖ |

"Own schedule" is explained next.

---

## Technicians see only their own customers

A technician (or any role set to "only customers on their own schedule") sees a customer, with its sites, systems, stored passwords, monitoring accounts and history, only when:

- they have a job for that customer from **7 days ago to 14 days ahead**, or an open unscheduled job; **or**
- an owner or administrator gave them **temporary access** (customer → **Tech access** → choose the tech and how long, up to 14 days); **or**
- they **answered an after-hours call** from that customer through the company phone line, which gives them access for **24 hours** (Settings → Phone & on-call → *Hours the answering tech can see that customer*).

Everything outside that is invisible: lists leave those customers out, search doesn't find them, and opening a link to one says *"Not found — this customer is not on your schedule."* Asking the office for access is the intended workflow.

---

## Who can give which roles

- **Owners** can create and edit anyone, including other owners.
- **Administrators** can create and edit anyone except owners.
- People with **Users & supervisors** but not *Operations admin* (e.g. HR) can create and edit **regular accounts only**. They can't create, edit or promote anyone to Owner, Administrator, or a custom role that includes *Operations admin*.
- There must always be at least **one active owner**.

Changing someone's role takes effect on their next screen load. Making a user **inactive** or **resetting their password** signs them out everywhere immediately.

---

## Custom roles

For anything in between the built-in roles (a *Dispatcher*, *Service manager*, *Office assistant*, *Lead technician*…), an **owner** builds a custom role in **Settings → Roles & permissions**.

### Creating one

1. **Settings → Roles & permissions → + New role** (or **Copy** next to a built-in role to start from it).
2. **Name** (must be unique) and an optional **description**.
3. **Customers & jobs:** choose one:

   | Choice | Means |
   |---|---|
   | **All customers and jobs** | Like office staff: sees every customer, job and system. |
   | **Only customers on their own schedule (field technician)** | Like a technician: scoped as described above, and gets My Day, the vehicle check, the start-of-day check and their truck. Link their login to a technician profile. |
   | **No customers or jobs** | Like HR: no customer data at all. Customer and field menus are hidden. |

4. **Can also:** tick any of:

   | Permission | Gives |
   |---|---|
   | **Office basics** | Pipeline, dashboard alerts, CSV exports, editing support contacts, address and drive-time lookups. |
   | **Edit customers** | Add and change customers, sites and contacts; send customer-portal invites. |
   | **Sales** | Leads, proposals and agreements (create, send, duplicate), site surveys and estimates. |
   | **Billing & accounting** | Invoices, payments, expenses, receiving, reports, QuickBooks, truck-stock administration, timesheets for everyone. |
   | **Operations admin** | **Everything an Administrator can do**: scheduling for everyone and conflict overrides, settings, live map, customer ratings, completion-rule overrides, the training library. |
   | **Time off for everyone** | Approve or deny anyone's time off, set balances and company holidays, change the time-off settings. |
   | **Users & supervisors** | Add and edit users, job titles and supervisors (not owner/administrator accounts). |
   | **Pay & benefits admin** | Post pay stubs and tax forms, manage benefit plans (when the add-on is on). |
   | **Chat records** | Review any conversation after an incident (logged; owners are alerted). |

5. **Create role**. It now appears in the role list when adding or editing a user (*Settings → Users & logins*).

Everyone, whatever their role, can always use: their dashboard, the time clock, tasks, team chat and in-app calls, time-off requests, Our team, the training library and support contacts (reading), and the calendar.

### Examples

| Custom role | Customers & jobs | Can also |
|---|---|---|
| Dispatcher | All | Office basics, Edit customers |
| Office assistant | All | Office basics |
| Service manager | All | Office basics, Edit customers, Operations admin |
| Lead technician | Own schedule | Time off for everyone |
| Bookkeeper (outside) | None | Billing & accounting |
| Payroll clerk | None | Pay & benefits admin |

### Changing or deleting a custom role

- **Edit** changes take effect right away for everyone with that role (they may need to reopen the app to see menu changes).
- A role **can't be deleted while anyone has it**: give those people another role first.
- Built-in roles can't be edited; copy one instead.
- Every create/change/delete is written to the **Activity log**.

---

## Good practice

- Give people the **smallest role that lets them do their job**. Most office staff don't need *Operations admin*.
- Keep **two owners** (e.g. the owner and a trusted manager) so the company is never locked out if one person is unavailable.
- Review **Settings → Users & logins** every few months: deactivate people who've left, check roles.
- Use **Our team** and *Reports to* for approval chains, rather than making everyone an administrator.
