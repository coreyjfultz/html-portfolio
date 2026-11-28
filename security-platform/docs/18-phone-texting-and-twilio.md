# 18 — Phone, texting and Twilio

SecureOps uses **Twilio** (twilio.com), a phone and texting service for businesses, for:

| Feature | What it does |
|---|---|
| **Texts to customers** | Appointment confirmations, "on my way", survey links. |
| **Texts to staff** | On-call shift reminders, truck count reminders, time-off decisions, important owner alerts. |
| **Company phone line** | Office hours → rings the office; after hours → rings the **on-call tech**, then the **backup**, then **voicemail**. |
| **Click-to-call** | Staff call customers from the app; the customer sees the **company number**, never a personal one. |
| **Direct numbers** (optional) | A business number per technician that rings them directly. |
| **Relay for in-app calls** (optional) | Helps team-to-team app calls connect on strict networks. |

Everything works without Twilio, minus these features. Plan **one to three weeks** from start to fully working, mostly waiting for texting registration (A2P 10DLC) or a number port.

---

## Part 1 — Create the Twilio account

1. Go to **twilio.com** → **Sign up**. Use a **company email** (e.g. `it@` or `office@`), not a personal one, and a strong password.
2. Verify the email and a mobile phone number.
3. Answer the onboarding questions (product: SMS and Voice; "with code"/"no code" doesn't matter).
4. **Upgrade** the account: **Admin → Account billing → Upgrade**, and add the company card. Trial accounts can only text and call numbers you've verified, and add "Sent from a Twilio trial account" to every text, so the real setup needs an upgraded account. Turn on **auto-recharge** (e.g. recharge $20 when the balance drops under $10) so service never stops.
5. Turn on **two-factor authentication**: **User settings → Two-factor authentication**.

**Your keys:** on the **Console home page**, under *Account Info*: the **Account SID** (starts with `AC`) and **Auth Token** (click *Show*). SecureOps needs both. Treat the Auth Token like a password.

---

## Part 2 — Get a phone number

### Option A: a new number

1. **Phone Numbers → Manage → Buy a number.**
2. Country: United States. Search by **area code** (your local one). Make sure **Voice**, **SMS** and **MMS** are ticked under *Capabilities*.
3. **Buy** (about $1–2/month).

### Option B: keep your existing office number (porting)

You can move the number customers already know to Twilio:

1. **Phone Numbers → Manage → Port & Host → Port a number**. Enter the number; Twilio checks it can be ported.
2. Fill in the **Letter of Authorization** exactly as the current carrier has the account: business name, service address, account number, PIN/passcode (ask the current carrier), and upload a recent **bill**.
3. Porting usually takes **1–4 weeks**. **Don't cancel the old service** until the port completes; the carrier cancels it when it moves.
4. Tip: start with a new Twilio number to set everything up and test, then port the main number and switch.

> Some numbers (especially landlines bundled with internet) need extra paperwork; Twilio's porting team will tell you.

---

## Part 3 — Register for business texting (A2P 10DLC)

US carriers **block business texts from unregistered numbers**. Registration is mandatory and takes **a few days to two weeks**. Start early.

1. **Messaging → Regulatory Compliance** (or *Trust Hub*) → **Register for A2P 10DLC / US A2P Messaging**.
2. **Customer Profile / Business profile:** legal business name **exactly as on IRS records**, **EIN**, business type, address, website, and an authorized representative (name, title, email, phone). Sole proprietors without an EIN can use the *Sole Proprietor* option (lower volume limits).
3. **Brand registration:** submit; there's a one-time fee. Approval is often minutes to a few days.
4. **Campaign registration:**
   - **Use case:** *Customer Care* or *Mixed* (appointment confirmations + service notifications + surveys).
   - **Description:** e.g. *"Appointment confirmations, technician on-the-way notices and post-service satisfaction surveys for customers of [Company], a security and fire protection company."*
   - **Sample messages** (use your real wording from *Settings → Texts & email → Message wording*):
     - *"[Company]: Your alarm service appointment is confirmed for Tue Mar 4 at 9:00 AM. Reply STOP to opt out."*
     - *"[Company]: Mike is on the way to your appointment and should arrive in about 20 minutes."*
     - *"[Company]: How did we do today? Tap to rate your visit: https://app.yourcompany.com/survey/… Reply STOP to opt out."*
   - **How customers opt in:** e.g. *"Customers give their mobile number and agree to appointment texts when booking service by phone, on our website or in the customer portal; each customer's text preference is recorded on their account."*
   - **Opt-out:** STOP (Twilio handles STOP/START/HELP automatically). **Help:** HELP returns your company name and phone.
   - Tick that messages include links and may include phone numbers.
   - There's a vetting fee and a monthly campaign fee (check Twilio's current pricing).
5. When asked, create (or select) a **Messaging Service** and **add your phone number to it**. The number must be in the registered campaign's Messaging Service to send.
6. Wait for **Campaign approved**. Before that, texts may be filtered or fail (error 30034 in Twilio's logs).

---

## Part 4 — Connect texting to SecureOps

*Settings → Texts & email → Text messages (Twilio):*

| Field | Value |
|---|---|
| **Account SID** | From the Twilio console home (`AC…`). |
| **Auth token** | From the console home. Saved encrypted; leave blank later to keep it. |
| **Texting number** | Your Twilio number in full international form: `+15555550100`. |

**Save**, then **Send test text** (to your mobile). The badge changes to **Ready**.

### When texts go out

*Settings → Texts & email → When to send:*

- **Confirm with the customer when a job is scheduled or moved** (email and/or text, per customer).
- **Text/email the customer when the technician taps "On my way".**
- **Email technicians a calendar invite** (email only).

Each customer's own preference (email, text, both, neither) is on their record (*Email / Text appointment updates*). Customers who reply **STOP** are blocked by Twilio from then on (they can reply START to resume).

**Message wording:** edit the *Appointment text*, *On-my-way text* and the email versions. Placeholders are filled in for each message: `{company}`, `{company_phone}`, `{customer}`, `{type}` (service, installation…), `{date}`, `{time}`, `{tech}`, `{address}` and, in on-my-way messages, `{eta}`. The default appointment text is: *"{company}: your {type} is scheduled for {date} at {time} with {tech}. Questions? Call {company_phone}. Reply STOP to opt out."* Keep texts short (under 160 characters is one message segment; longer ones cost more).

**Recent messages** at the bottom shows every email and text sent: to whom, when, and whether it was **sent** or **failed** with the reason. Every message is also logged on its job.

---

## Part 5 — The company phone line

### Set the public web address first

*Settings → Calendars → Public web address* = `https://app.yourcompany.com`. Twilio needs it to reach the app.

### Turn on call routing

*Settings → Phone & on-call → Company phone line (Twilio):*

| Field | Notes |
|---|---|
| **Route calls through the app** | Tick to turn on. |
| **Company Twilio number** | Blank = the texting number. A separate number for calls is fine. |
| **Office phone to ring during business hours** | The desk phone / office cell / existing phone system that should ring during the day. |
| **Office days** | `1,2,3,4,5` = Monday–Friday (0 = Sunday … 6 = Saturday). |
| **Opens / Closes** | e.g. 08:00 and 17:00. |

The box at the top says **connected** when everything needed is in place, or lists what's missing.

### Point the Twilio number at SecureOps

1. Copy the **webhook address** shown in that box (it looks like `https://app.yourcompany.com/api/inbound/voice/<private key>/incoming`).
2. In Twilio: **Phone Numbers → Manage → Active numbers →** your number → **Voice configuration**:
   - **Configure with:** Webhook…
   - **A call comes in:** *Webhook*, paste the address, **HTTP POST**.
   - **Call status changes:** paste the *status* address shown in SecureOps.
3. **Save configuration** in Twilio.

Every request from Twilio is checked against your Auth Token, so nobody else can fake calls into the app. If the address ever leaks, click **Make a new link** and paste the new one into Twilio.

### What callers hear and what happens

*Settings → Phone & on-call → Messages callers hear* (editable; spoken by a natural voice):

- **Greeting:** "Thank you for calling {company}."
- **After hours:** "Our office is closed. Please hold while we connect you to the technician on call."
- **Voicemail prompt:** "Sorry, we could not reach anyone right now. Please leave your name, number and address after the tone…"

**During office hours:** greeting → the **office phone** rings (about 25 seconds); if nobody answers, the caller can leave a **voicemail**.

**After hours (and weekends):**

1. Greeting + after-hours message.
2. The **on-call technician's** mobile rings. With **Announce the caller** on (default), the tech hears *"After hours call from Harbor Dental. Press 1 to accept"* before being connected. This stops the call going into the tech's personal voicemail if they don't answer.
3. No answer or no "1" → the **backup** technician is tried the same way.
4. Still no one → the caller hears the **voicemail prompt** and can leave a message.
5. **Voicemails and missed calls alert the office** (dashboard, email; text if turned on) with a link to play the recording.

The caller is matched to a customer by phone number. If the on-call tech answers, they can see that customer in the app for **24 hours** (*Hours the answering tech can see that customer*), even if they're not on their schedule.

**On-call & phone → Call log:** every call with time, caller (customer name when known), who it rang, who answered, duration, and voicemail playback.

---

## Part 6 — The on-call schedule

**Menu → On-call & phone → On-call schedule.**

- **Now:** who's on call and who's the backup right now, and the next shift.
- **+ Shift:** on-call tech, backup, starts, ends, notes. Overlapping shifts are refused.
- **Build rotation:** tick who's in the rotation (in order), when the **first shift starts**, the **handoff time** (default 8:00 AM), **days per shift** (default 7 = weekly), **how many shifts** to create (default 8), and whether to **replace** shifts already scheduled then. Each tech takes a turn; the next person in line is their backup.

With *Email calendar invites and text techs about their on-call shifts* on (default): each tech gets a **calendar invite** for their shifts, shifts appear in their **calendar feed**, and they get a **text reminder** before a shift starts. My Day shows "You're on call until…".

---

## Part 7 — Click-to-call (calling customers from the app)

With the phone line connected, **phone numbers in the app become call buttons** (on customers, jobs, My Day):

1. Tap a customer's number.
2. The first time, the app asks for **your mobile number** (saved to your account).
3. Twilio **rings your phone**. Answer it.
4. You're connected to the customer, who sees the **company number** (or the tech's direct business number, if they have one), never your personal number.

Technicians can only call numbers on file for customers on their schedule; the office can call any number. Calls appear in the call log. Without the phone line set up, numbers open the phone's normal dialer.

### Direct numbers per technician (optional)

Buy an extra Twilio number per tech (Part 2), point its *A call comes in* webhook at the same SecureOps address, and enter it on the tech: **Technicians → Edit → Direct business number**. Calls to it ring that tech directly (then voicemail), and their click-to-call calls show that number.

---

## Relay server for in-app calls

In-app calls between team members ([17](17-the-team.md#in-app-calls)) go **directly between devices** and don't use Twilio minutes. On some cell networks and office firewalls the devices can't reach each other: the call rings and is answered, then says *"couldn't connect"*. A **relay server** (TURN) fixes that by passing the audio through.

*Settings → Phone & on-call → In-app calls (team to team):*

| Setting | Choose |
|---|---|
| **Allow in-app calls** | On (default). |
| **Relay server** | **None** (default; works on most networks), **Twilio** (uses the account above; Twilio's Network Traversal Service, billed per GB relayed, typically pennies per call-hour), or **Our own relay server (coturn)**. |
| Own relay addresses, shared secret | Only for "our own" (below). |
| Address-lookup (STUN) servers | Leave the default unless you know you need to change it. |

**Twilio relay:** nothing to install. Choose *Twilio* and save.

**Your own relay (free, runs on your server):**

1. On the server, generate a secret: `openssl rand -hex 32`.
2. In `.env` add:
   ```
   TURN_SECRET=<that secret>
   TURN_URLS=turn:app.yourcompany.com:3478?transport=udp,turn:app.yourcompany.com:3478?transport=tcp
   ```
3. Open the firewall: `ufw allow 3478 && ufw allow 49160:49200/udp`.
4. Start it: `docker compose -f docker-compose.yml -f deploy/docker-compose.turn.yml up -d`.

The app uses it automatically and gives each call short-lived relay passwords.

---

## Costs (approximate; check twilio.com/pricing)

| Item | Typical US price |
|---|---|
| Local phone number | ~$1–2 / month each |
| Text message (SMS) | under 1¢ per segment, plus carrier fees (~0.3–0.5¢) |
| Incoming calls | ~1¢ / minute |
| Outgoing calls (forwarding to on-call, click-to-call) | ~1.5¢ / minute per leg (click-to-call uses two legs) |
| Voicemail recording / storage | fractions of a cent per minute |
| A2P 10DLC | one-time brand + vetting fees, plus a monthly campaign fee |
| Relay (Twilio NTS) | per GB relayed (a voice call uses very little) |

A small company typically spends **$20–60 a month**.

---

## Troubleshooting

| Problem | Check |
|---|---|
| Test text fails | Account SID / token correct? Number in `+1…` form? Account upgraded (not trial)? Look at **Recent messages** and Twilio **Monitor → Logs → Messaging** for the error code. |
| Texts "sent" but not received | A2P 10DLC not approved yet, or the number isn't in the campaign's Messaging Service (error 30034/30007). The customer may have replied STOP. |
| Calls don't reach the app (Twilio says "application error") | Public web address set? Webhook pasted exactly, **HTTP POST**? Server reachable over HTTPS? Twilio's **Monitor → Logs → Calls** shows the request and response. |
| "403" in Twilio's call logs | The Auth Token in SecureOps doesn't match Twilio's (it was regenerated?). Re-enter it. |
| After hours goes straight to voicemail | No on-call shift right now (On-call & phone → Now), or the tech has no mobile number on their technician profile. |
| Tech's voicemail picked up | Turn on **Announce the caller… press 1**. |
| Click-to-call: "Add your mobile number first" | Enter your mobile when asked (saved on your account). |
| In-app calls ring but don't connect | Turn on a relay server (above). |
