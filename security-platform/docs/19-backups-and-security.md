# 19 — Backups and security

Part 1 explains SecureOps backups: what's saved, where, how to set up the off-site copy, and how to restore after a mistake, a broken server or a break-in. Part 2 explains the security features and good habits. **Backups are owner-only.**

---

# Part 1 — Backups

## What a backup contains

Each backup is **one file** named like `secureops-2026-03-14_020000.sobak`, containing:

- the **database**: every customer, job, invoice, setting, chat message, time entry…, copied consistently while the app keeps running;
- all **uploaded files**: job photos, signatures, supplier invoices, HR documents, training PDFs, the logo;
- when a backup password is set, the app's **encryption key** (so stored alarm codes and passwords can be read after a restore).

With a **backup password** the whole file is **encrypted** (AES-256-GCM, with the key derived from the password). Without the password, nobody can read it: not the storage company, not a thief. The file also detects tampering: a changed byte makes it refuse to open.

## The three layers

| Layer | Protects against | Set up in |
|---|---|---|
| **1. Local backups** (nightly, on the server or a second disk) | Mistakes: deleted customer, bad import, wrong bulk change | Settings → Backup & data |
| **2. Off-site copy** (another company's storage, locked against deletion) | Lost server, closed hosting account, fire/flood at the data center, **break-in / ransomware** | Settings → Backup & data |
| **3. Hosting snapshots** (optional) | A quick whole-server rollback | Your hosting provider's panel |

This follows the **3-2-1 rule**: three copies, on two kinds of storage, one with a different company.

---

## Setting up backups (owner)

**Settings → Backup & data.** The banner at the top says **"Backups look healthy"** or lists exactly what needs attention.

### Step 1 — Backup password

*Backups on this server → Backup password*: at least **12 characters**. Four or five random words work well (e.g. `maple-orbit-cactus-lantern`). **Save**.

> 🔑 **Write it down in two places**: the company password manager, and on paper in a sealed envelope in the safe. It's the only way to open a backup on a new server. **Nobody can recover a lost backup password**, including the developers.

Changing it later is fine: new backups use the new password, and the app remembers earlier ones so older backups still open. Keep the old one on file too.

### Step 2 — Local backup settings

| Setting | Default | Notes |
|---|---|---|
| **Backup folder on the server** | the data folder's `backups` | Better: a **second disk** or network drive. With Docker, mount it into the container and set `BACKUP_DIR` in `.env` ([01](01-install-server.md#optional-add-ons-on-the-server)). |
| **Time of the nightly backup** | 2 AM | When nobody's working. |
| **Keep every backup from the last … days** | 14 | |
| **Then one per week for … weeks** | 8 | |
| **And one per month for … months** | 12 | |

So by default you can go back to any day in the last two weeks, any week in the last two months, and any month in the last year. Older ones are removed automatically. The page shows the free disk space.

### Step 3 — Off-site copy

Use storage at a **different company** from your server host. **Backblaze B2** is simple and inexpensive; **Amazon S3**, **Cloudflare R2** and **Wasabi** work the same way. Step by step for Backblaze:

1. Create an account at **backblaze.com** (B2 Cloud Storage) with a company email; turn on **two-step verification** (*My Settings → Security*).
2. **B2 Cloud Storage → Buckets → Create a Bucket:**
   - **Bucket name:** unique, e.g. `acme-secureops-backups`;
   - **Files in bucket:** **Private**;
   - **Default encryption:** Enable;
   - **Object Lock: Enable**. ⚠️ This can only be chosen when the bucket is created.
3. Open the bucket's **Lifecycle Settings** → *Keep only the last version* or a custom rule that deletes old versions after e.g. **400 days**. This is what eventually removes old backups; the app itself never deletes anything off-site.
4. Note the bucket's **Endpoint** (e.g. `s3.us-west-004.backblazeb2.com`).
5. **Application Keys → Add a New Application Key:**
   - name `secureops-server`;
   - **Allow access to bucket:** only this bucket;
   - **Type of access:** Read and Write;
   - if your account offers per-capability keys, leave out **deleteFiles**.

   Copy the **keyID** and **applicationKey**; the key is shown **once**.
6. In SecureOps, *Off-site copy*:

   | Field | Enter |
   |---|---|
   | Upload every backup off-site | ✓ |
   | Storage company | Backblaze B2 |
   | Storage address (S3 endpoint) | `https://s3.us-west-004.backblazeb2.com` (yours) |
   | Bucket name | `acme-secureops-backups` |
   | Folder in the bucket | `secureops` (or the company name) |
   | Key ID / Secret key | from step 5 |
   | Lock each backup against deletion for … days | **30** |
   | Lock type | **Compliance** (recommended) |

7. **Save**, then **Test connection**: it writes a small test file and reads it back. ✅ means ready.
8. **Back up now** to send the first copy. Then **Run a restore test**.

**What the lock means:** each uploaded backup can't be deleted or changed by anyone for 30 days. In **Compliance** mode that includes the Backblaze account owner. **Governance** mode lets the storage account owner override it. Combined with a key that can't delete, someone who breaks into the server can't erase your history.

**Storage cost:** you pay the storage company for the space (for a small company's data, typically a few dollars a month). Check current pricing.

### Step 4 — Hosting snapshots (optional)

In your hosting panel (e.g. Hostinger VPS → *Snapshots & backups*), turn on automatic snapshots. They roll back the whole server but live at the same company, so they **don't replace** the off-site copy.

---

## What runs automatically

| When | What |
|---|---|
| **Every night** at the backup hour | Local backup → off-site upload (if on) → old local backups pruned. |
| **The 1st of each month** (after the nightly backup) | **Restore test**: the newest off-site backup (or local, if no off-site) is downloaded, decrypted and unpacked into a scratch folder; the database's integrity is checked and record counts and files are compared with what the backup says it contains. |
| **If something fails** | The **owner is alerted** (dashboard + email): backup failed, upload failed (with the reason, e.g. wrong key), restore test failed. |
| **Hourly check** | If there's been **no backup in 2 days**, or **no off-site copy in 2 days**, the owner is alerted (e.g. the server was off, or storage keys expired). |

**History** on the Backup & data page lists recent backups, uploads and restore tests with results and details.

---

## The backups list

Each backup shows its date, type (nightly / manual), size and protection (**Encrypted** or not), with actions:

- **Download:** save the backup file to your computer (encrypted; useful as an extra copy).
- **Send off-site:** upload it now (if it isn't already; uploaded ones show ✓ off-site).
- **Recover a customer…:** see below.
- **Back up now** and **Run a restore test** at the top.

**Show off-site backups** (in the Off-site card) lists what's in the bucket, with **Copy to this server** for any that aren't local (e.g. to recover a customer from an older backup).

---

## Restoring

### A customer was deleted by mistake

You don't need to roll back the whole system:

1. *Settings → Backup & data* → on a backup **from before it was deleted**, click **Recover a customer…**.
2. The list shows customers that are in that backup but no longer in the system. Click **Recover**, then confirm.
3. The customer comes back with everything attached: sites, contacts, systems and stored passwords, monitoring accounts, jobs, proposals, invoices, payments and photos. Links to things that no longer exist (e.g. a technician who was removed) are left empty. **Nothing else changes**: work done since the backup stays.

Each recovery is written to the Activity log.

### Everything, on the same server (bad import, damaged data)

Restoring replaces **all** data with the backup's: anything entered after it is lost. That's why the app first moves the current data aside instead of deleting it.

```bash
cd /opt/secureops/security-platform
docker compose stop app
docker compose run --rm app npm run restore                  # lists the backups
docker compose run --rm app npm run restore -- secureops-2026-03-14_020000.sobak
docker compose start app
```

The previous data is kept in the data volume in a `before-restore-…` folder, in case you need something from it.

### On a brand-new server (the old one is gone or compromised)

You need: the **off-site storage details** (endpoint, bucket, folder, key ID, secret) and the **backup password**.

1. Install SecureOps on the new server ([01](01-install-server.md)) up to Step 8, but **don't create an owner account**.
2. Add to `.env`:
   ```
   BACKUP_PASSPHRASE=<the backup password>
   OFFSITE_ENDPOINT=https://s3.us-west-004.backblazeb2.com
   OFFSITE_BUCKET=acme-secureops-backups
   OFFSITE_PREFIX=secureops
   OFFSITE_KEY_ID=<key id>
   OFFSITE_SECRET=<key>
   ```
   (If the old server was broken into, make a **new** application key in Backblaze first and delete the old one.)
3. Restore the newest backup (or name a specific one instead of `latest`):
   ```bash
   docker compose run --rm app npm run restore -- --offsite latest
   docker compose up -d
   ```
4. Remove `BACKUP_PASSPHRASE` and the `OFFSITE_*` lines from `.env` (they're in the restored settings) and run `docker compose up -d` again.
5. Point the domain's DNS at the new server; everyone signs in as before. Update the Twilio webhook address if the web address changed.

### Without the app, from a downloaded file

Any `.sobak` file (downloaded from the bucket's web page or the Backups list) can be restored with
`npm run restore -- /path/to/secureops-….sobak` with `BACKUP_PASSPHRASE` set.

### Practice

**After going live, do one practice restore** onto a spare machine or a laptop ([01 — Trying it on a computer](01-install-server.md#trying-it-on-a-windows-or-mac-computer)). Knowing it works, and how long it takes, is the whole point.

---

## Continuous database backup (Litestream)

Nightly backups can lose up to a day of work. **Litestream** (optional) streams every database change to storage **within seconds**, so the database can be restored to a specific moment ("10:41 this morning, before the bad import"). It covers the database only; photos and documents stay in the nightly backups.

1. Create a **second bucket without Object Lock** (Litestream deletes its own old files) and an application key with read, write **and delete** for that bucket only.
2. In `.env`: `LITESTREAM_BUCKET`, `LITESTREAM_ENDPOINT`, `LITESTREAM_REGION`, `LITESTREAM_ACCESS_KEY_ID`, `LITESTREAM_SECRET_ACCESS_KEY`.
3. `docker compose -f docker-compose.yml -f deploy/docker-compose.litestream.yml up -d`
4. Restoring to a moment is in the comments at the top of `deploy/docker-compose.litestream.yml`. It keeps 7 days of history by default.

---

# Part 2 — Security

## What SecureOps does to protect data

| Protection | Details |
|---|---|
| **HTTPS everywhere** | Caddy gets and renews certificates automatically; browsers are told to always use HTTPS (HSTS). |
| **Passwords** | Never stored, only a salted **scrypt** hash. Minimum 8 characters. |
| **Sign-in limits** | 10 wrong passwords in 15 minutes pauses sign-in from that address. |
| **Sessions** | Secure, HttpOnly cookies; requests must come from the app itself (protection against cross-site attacks). Making a user inactive or resetting their password signs them out everywhere. |
| **Roles** | Every request is checked on the server against the person's role ([11](11-roles-and-permissions.md)). |
| **Technicians see only their customers** | A lost tech phone exposes only that tech's current customers. |
| **Stored passwords and codes encrypted** | See below. |
| **Activity log** | Sign-ins, changes, deletes, every password reveal, chat reviews, backup actions. |
| **Customer documents** | Invoice, agreement, survey and inspection links use long random keys and show only that document. |
| **Uploads** | Only real images, PDFs and CSVs are accepted; files are served with strict security headers. |
| **Outside services** | Webhooks from Twilio, Stripe and others are verified with their signatures; secrets (tokens, keys) are encrypted in the database and never sent back to the browser. |
| **Card / bank data** | Never touches SecureOps; Stripe handles it. |
| **Backups** | Encrypted; off-site copies locked against deletion. |

## Stored passwords and codes

Camera admin/viewer passwords, alarm master/installer codes, fire panel codes, gate codes, monitoring passcodes and duress words are encrypted with **AES-256-GCM** using the server's key (`secret.key` in the data folder, or `APP_SECRET` in `.env`).

- In the app they show as `••••••`. **Show** reveals one for 30 seconds.
- **Every reveal is logged** (who, which, when) in the Activity log.
- Technicians can only reveal them for customers on their schedule.
- **Keep a copy of the key** in the password manager ([01](01-install-server.md#step-10--save-the-encryption-key)). Backups with a password include it.

## The Activity log

*Settings → Activity log* (owners/admins): when, who, what action, which record, details. Includes sign-ins, creates/updates/deletes, **reveals**, exports, role changes, supervisor changes, chat record reviews, backup/restore/recovery actions, time-off decisions, user changes. Use it to answer "who changed this?" or after an incident.

## Good habits (please follow)

1. **Everyone has their own login.** No shared accounts.
2. **Two owners**, so the company is never locked out.
3. **Strong, unique passwords** in a password manager, plus **two-factor sign-in** on every outside account: hosting, domain/DNS, GitHub, Twilio, Stripe, Backblaze, QuickBooks, the company email.
4. **Remove access the day someone leaves:** *Settings → Users & logins → Edit → untick Active*. Also remove them from outside accounts.
5. **Keep the server updated:** automatic security updates are on ([01](01-install-server.md#step-4--secure-and-update-the-server)); update SecureOps when new versions come out.
6. **Watch the backup banner** on Settings → Backup & data, and act on backup alerts.
7. **Give the smallest role** that does the job ([11](11-roles-and-permissions.md#good-practice)).
8. Never put customer codes or passwords in chat messages, task notes or the help assistant; use the systems on file.

## If you suspect a break-in or a leak

1. **Don't panic, don't wipe anything yet**: evidence matters.
2. **Change passwords:** owners and admins first; deactivate any account you don't recognize (*Settings → Users & logins*).
3. Review the **Activity log** for unusual sign-ins, reveals, exports or deletes.
4. **Rotate outside keys** that live in SecureOps: Twilio Auth Token, Stripe secret key and webhook secret, off-site storage key, Google Maps / Samsara tokens, the Anthropic API key. Enter the new ones in Settings.
5. If data was changed or deleted, **restore** (a customer, or everything) from a backup before the incident. Off-site copies are locked, so they're intact.
6. If the **server itself** is compromised, build a new server and restore from off-site ([above](#on-a-brand-new-server-the-old-one-is-gone-or-compromised)), with new keys.
7. Check with your attorney/insurer about **notification duties** if customer data may have been exposed (state breach-notification laws), and tell affected customers' central station if alarm codes may have leaked so codes can be changed.
