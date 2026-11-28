# SecureOps documentation

SecureOps is one system for the whole company: customers, sales, jobs, scheduling, fire inspections, alarm monitoring records, inventory, trucks, billing, the team (time clock, time off, chat, calls, tasks) and the company phone line. It runs on one server you control and is used from any phone, tablet or computer through the web browser, where it can also be **installed like an app**.

## Which document do I need?

| I want to… | Read |
|---|---|
| Put SecureOps on a server for the first time | [01 — Installing the server](01-install-server.md) |
| Install it on iPhones, Android phones, Windows PCs and Macs | [02 — Installing on phones and computers](02-install-devices.md) |
| Set everything up after installing, in the right order | [03 — First-time setup checklist](03-first-time-setup.md) |
| Learn the screens, the menu, the dashboard, My Day and search | [10 — Getting around](10-getting-around.md) |
| Understand who can see and do what, and make custom roles | [11 — Roles and permissions](11-roles-and-permissions.md) |
| Work with customers, sites, contacts, the sales pipeline, proposals, e-signatures and the customer portal | [12 — Customers and sales](12-customers-and-sales.md) |
| Book, dispatch and complete jobs (photos, signatures, serial numbers, materials, surveys) | [13 — Service calls and scheduling](13-service-calls-and-scheduling.md) |
| Track alarm monitoring accounts, customer systems, passwords, maintenance, fire inspections and extinguishers | [14 — Monitoring, systems and fire](14-monitoring-systems-and-fire.md) |
| Manage inventory, supplier invoices, truck stock, tools, vehicles, GPS and the live map | [15 — Inventory, trucks and the fleet](15-inventory-trucks-and-fleet.md) |
| Invoice, take payments, track expenses, run reports, connect QuickBooks | [16 — Billing and accounting](16-billing-and-accounting.md) |
| Use the time clock, time off, the org chart, tasks, team chat, in-app calls, the training library, the help assistant, and pay & benefits | [17 — The team](17-the-team.md) |
| Set up Twilio for texts, the company phone line, on-call routing and click-to-call | [18 — Phone, texting and Twilio](18-phone-texting-and-twilio.md) |
| Set up and use backups; understand the security features | [19 — Backups and security](19-backups-and-security.md) |
| Connect email, Stripe, QuickBooks, calendars, GPS tracking, maps and the Claude API | [20 — Connecting outside services](20-integrations.md) |
| Look up any setting | [21 — Settings reference](21-settings-reference.md) |
| Fix a problem | [22 — Troubleshooting and FAQ](22-troubleshooting-and-faq.md) |

## Is there a Windows .exe, or an App Store / Play Store app?

**No, and you don't need one.** SecureOps is a *Progressive Web App*: the same website installs as an app.

- **Windows and Mac:** open the site in Microsoft Edge or Google Chrome and click **Install** in the address bar. You get a Start-menu / Dock icon, its own window without browser tabs, a taskbar pin and notifications. To the person using it, it looks and behaves like an installed program.
- **iPhone / iPad:** Safari → Share → **Add to Home Screen**.
- **Android:** Chrome → **Install app**.

A separate Windows program (an `.exe` built with Electron or similar) would only wrap this same website, so it would add work without adding features:

- it would need its own installer and auto-updates;
- it would need a paid code-signing certificate, or Windows would show "unknown publisher" warnings;
- it wouldn't work offline either, because everything lives on your server.

The installed web app updates itself the moment the server is updated. App Store / Play Store versions are possible later if a customer or IT department requires them (see [02](02-install-devices.md#do-we-need-app-store-or-windows-exe-versions)).

## Handbooks by job

Step-by-step guides written for each person's job: their day, what they can and can't see, and how timecards, time off, inventory, tasks and the rest work from their side.

| I am… | Read |
|---|---|
| A **field technician** | [30 — Technician handbook](30-handbook-technician.md) |
| **HR** | [31 — HR handbook](31-handbook-hr.md) |
| The **owner** | [32 — Owner handbook](32-handbook-owner.md) |
| In the **office / dispatch** (administrator) | [33 — Office and dispatch handbook](33-handbook-office-dispatch.md) |
| In **sales** (quotes, bids, site surveys) | [34 — Sales handbook](34-handbook-sales.md) |
| In **accounting** | [35 — Accounting handbook](35-handbook-accounting.md) |

## Words used in these documents

| Word | Meaning |
|---|---|
| **Owner** | The top account. Can do everything, including backups, roles and other owners. |
| **Office** | Owners, administrators, sales, accounting, HR and custom office roles. |
| **Tech / technician** | Field staff. They see only the customers on their own schedule. |
| **Service call / job** | A work order: an install, repair, inspection, estimate… |
| **Site / location** | One address belonging to a customer (a business can have several). |
| **Central station** | The monitoring company that receives alarm signals (e.g. CMS). |
| **AHJ** | Authority Having Jurisdiction: the fire marshal / inspector who enforces the fire code. |
| **The server** | The computer (usually a rented cloud server) the app runs on. |
| **Twilio** | The phone/texting company the app uses for texts and the company phone line. |
| **Stripe** | The payment company for card and bank (ACH) payments. |

## Keeping these documents current

These documents live with the code (`security-platform/docs`). When a feature changes, update the matching document in the same change. GitHub shows them formatted; any Markdown viewer, Word, or Google Docs can open them, and they print or export to PDF.
