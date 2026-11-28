# 22 — Troubleshooting and FAQ

Start with the section that matches the problem. Many answers point to the detailed guides.

---

## Signing in

| Problem | What to do |
|---|---|
| "Wrong email or password" | Check for typos and Caps Lock. An owner/administrator can reset it: *Settings → Users & logins → Edit → Reset password*. |
| "Too many attempts" | 10 wrong tries in 15 minutes pauses sign-in. Wait 15 minutes. |
| Signed out on a phone | The installed app keeps its own sign-in; sign in inside the app. A password reset or being made inactive signs you out everywhere. |
| "Your role does not have access" | That screen isn't part of your role ([11](11-roles-and-permissions.md)). Ask an owner. |
| A tech can't find a customer | Technicians see only customers on their schedule. Book the job, or an owner/admin grants **Tech access** on the customer ([11](11-roles-and-permissions.md#technicians-see-only-their-own-customers)). |

## Phones and the installed app

| Problem | What to do |
|---|---|
| No notifications on iPhone | iOS 16.4+ and the app must be opened **from the Home Screen icon**; then Team chat → **Turn on**. Check iPhone Settings → Notifications → SecureOps, and Focus modes ([02](02-install-devices.md#iphone-and-ipad)). |
| No notifications on Android | App info → Notifications on; battery → **Unrestricted** ([02](02-install-devices.md#android-phones-and-tablets)). |
| Clock-in says "no location" | Allow location for the app/browser ([02](02-install-devices.md)); turn on the phone's location services; step outside if GPS is weak. |
| Camera doesn't open for photos | Allow camera permission; if a photo is huge or fails, try again on Wi-Fi. |
| App shows old screens after an update | Close it fully (swipe away) and reopen. |
| Can't install on iPhone | Use Safari (or Chrome/Edge on iOS 16.4+) → Share → **Add to Home Screen**. |

## Jobs and scheduling

| Problem | What to do |
|---|---|
| "Can't complete the job" | The message lists what's missing: before/after photos, parts (or *No parts used*), the customer signature, serial numbers or label photos. An owner/admin can complete with a reason ([13](13-service-calls-and-scheduling.md#job-completion-rules)). |
| Customer isn't there to sign | An owner/admin ticks *Customer won't be on site* on the job (or *Usually nobody on site* on the customer) ([13](13-service-calls-and-scheduling.md#customer-sign-off)). |
| "On my way" / "Start job" won't work | Finish the **vehicle check** and **start-of-day check** on My Day, or ask an owner/admin to approve the start ([13](13-service-calls-and-scheduling.md#start-of-day-equipment-check)). |
| Can't book a tech: conflict | Double booking, time off, blocked time, travel time or a holiday. Pick another time/tech, or an owner/admin clicks **Book anyway** ([13](13-service-calls-and-scheduling.md#scheduling-checks)). |
| Tech didn't get the calendar invite | Email must be set up (*Settings → Texts & email*), the technician needs an email, and *Email technicians a calendar invite* must be on. Check *Recent messages*. |
| Outlook/Google calendar not updating | Subscribed calendars refresh on the provider's schedule (Google: up to several hours). Email invites are instant. |
| Customer didn't get the confirmation | Their record must allow email/text, the setting must be on, and email/Twilio set up. *Recent messages* shows failures. Texts need A2P 10DLC approval ([18](18-phone-texting-and-twilio.md#part-3--register-for-business-texting-a2p-10dlc)). |

## Inventory and trucks

| Problem | What to do |
|---|---|
| Truck stock looks wrong | Do a **weekly count**; differences correct the stock automatically ([15](15-inventory-trucks-and-fleet.md#weekly-blind-count)). Check the item's movement history. |
| Supplier invoice stuck in review | Lines didn't all match, or the sender isn't trusted. Match the lines and **Receive into stock**; add the distributor's domain to trusted domains. |
| PDF invoices aren't read automatically | The server needs `ANTHROPIC_API_KEY` ([20](20-integrations.md#claude-api)). *Settings → Receiving* shows On/Off. |
| Truck not on the live map | Tracking provider set? Vehicle's **GPS tracker / vehicle ID** matches the tracking system exactly? |
| Customer not on the map | Address lookup must be on; fix the address (or enter latitude/longitude) if marked *Address not found on map*. |

## Money

| Problem | What to do |
|---|---|
| "Get paid online" missing | Stripe isn't connected, or the invoice has no balance / is void. |
| Customer paid but the invoice isn't updated | Stripe webhook missing or wrong signing secret. Check Stripe → Developers → Webhooks for failed deliveries ([20](20-integrations.md#stripe-card-and-bank-payments)). ACH takes a few days. |
| Monthly billing made no invoices | No active recurring charges, or that month was already billed (it never double-bills). |
| QuickBooks sync errors | Accounting page lists each failure and why. Reconnect if disconnected. |

## Phone and calls

See the table in [18 — Troubleshooting](18-phone-texting-and-twilio.md#troubleshooting). Quick ones:

- **After-hours calls go straight to voicemail:** no on-call shift now, or the tech has no mobile on their technician profile.
- **In-app call rings but won't connect:** turn on a relay server ([18](18-phone-texting-and-twilio.md#relay-server-for-in-app-calls)).
- **No sound in an in-app call:** allow the microphone; check the right headset is selected; unmute.

## Backups

| Problem | What to do |
|---|---|
| "Off-site upload failed" alert | **Test connection** shows the reason: wrong key or secret, bucket name, expired key, or no Object Lock on the bucket. Fix and **Back up now** ([19](19-backups-and-security.md#step-3--off-site-copy)). |
| "No backup in 2 days" | Was the server off? Is the disk full (`df -h`)? Check History for the error. |
| "Wrong backup password" when restoring | Use the password that was in effect when that backup was made (the app remembers past ones on the same server; on a new server, set `BACKUP_PASSPHRASE` to the right one). |
| Disk filling up | Move backups to a second disk (`BACKUP_DIR`), lower the retention numbers, or resize the server's disk. |

## Server

| Problem | What to do |
|---|---|
| Site down | On the server: `cd /opt/secureops/security-platform && docker compose ps`; if not running, `docker compose up -d`; look at `docker compose logs --tail=200 app`. |
| Certificate warning | DNS wrong or Cloudflare proxy on; `docker compose logs caddy` ([01](01-install-server.md#if-something-goes-wrong)). |
| Slow | Check `docker stats` and `df -h`. A 2 GB server handles a typical small company; upgrade the plan if busy. |

---

## FAQ

**Is there a Windows .exe or an App Store app?**
No, and it isn't needed: the web app installs on Windows, Mac, iPhone and Android with its own icon and notifications ([02](02-install-devices.md#do-we-need-app-store-or-windows-exe-versions)).

**Does it work without internet?**
No. Everything lives on the server, so a connection is needed. The phone app works on cellular data; photos upload when sent.

**Where is our data?**
On your own server (the database and uploaded files in the data folder), plus your encrypted off-site backups. Nothing is stored by the developers.

**Can customers see our internal notes, codes or other customers?**
No. The portal and emailed links show only that customer's own documents and data, never internal notes, codes or passwords.

**Does the app track technicians' locations all day?**
No. The phone records location only at clock-in and clock-out. Truck locations come from the vehicles' GPS trackers if you connect one.

**Can we change the inspection checklists or job types?**
The checklists, job types and categories are defined in code (`public/js/inspections.js`, `public/js/schema.js`); a developer can change them in minutes.

**Can we import our existing customers?**
Yes. Export them from the old system or a spreadsheet as CSV; a developer can load them (customers, sites, contacts, systems, recurring charges).

**What happens when we update the app?**
The database upgrades itself; nothing is lost. Make a backup first ([01](01-install-server.md#updating-to-a-new-version)).

**Who do we call for help?**
Whoever maintains your installation (developer/IT). These documents and the README in the repository describe how everything works.
