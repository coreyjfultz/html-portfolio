# Going live — checklist

> Detailed step-by-step versions are in [`docs/`](../docs/README.md): [installing the server](../docs/01-install-server.md), [first-time setup](../docs/03-first-time-setup.md), [Twilio](../docs/18-phone-texting-and-twilio.md), [backups](../docs/19-backups-and-security.md).

About an hour of work for someone comfortable with a terminal, plus a few days of waiting on Twilio text registration (step 7). Use accounts **owned by the company** (not a personal email) for everything below.

## 1. Get a server and a web address

- **Server:** a small Linux VPS with 1–2 GB RAM and 25 GB+ disk (Ubuntu 24.04). Examples: Hostinger VPS, DigitalOcean, Linode/Akamai, AWS Lightsail — about $6–12/month. Shared "website" hosting won't do: the app needs to keep its database on disk and run all the time.
- **Web address:** a subdomain of the company's domain, e.g. `app.yourcompany.com`. In the domain's DNS settings, add an **A record** for `app` pointing to the server's IP address.
- **Firewall:** allow ports 22 (SSH), 80 and 443 only.

## 2. Install and start (Docker — recommended)

On the server:

```bash
# Docker (official script)
curl -fsSL https://get.docker.com | sh

# The app
git clone <this repository> /opt/secureops
cd /opt/secureops/security-platform
cp .env.example .env
nano .env            # set DOMAIN and TZ (and ANTHROPIC_API_KEY if you have one)
docker compose up -d --build
```

Caddy gets the HTTPS certificate automatically within a minute. Open `https://app.yourcompany.com`.

> Without Docker: install Node.js 22.13+ and Caddy, use `deploy/secureops.service` (systemd) and a Caddyfile like `deploy/Caddyfile` with `reverse_proxy 127.0.0.1:3000`.

## 3. Create the owner account — right away

The first person to open the site creates the **owner** account, so do it immediately after it starts. Don't load demo data (`npm run seed`) on the live server.

## 4. Save the encryption key (important)

Camera passwords, alarm codes and saved service passwords are encrypted with a key that is created the first time one is saved. **If the key is lost, those passwords can't be recovered.** Once a backup password is set (see Backups below), every backup carries the key, encrypted, so the backup password restores it too. Keep your own copy anyway. After entering the first camera password:

```bash
docker compose exec app cat /data/secret.key
```

Save that line in the company's password manager (or a sealed envelope in the safe). To restore on a new server, put it back as `/data/secret.key` (or set `APP_SECRET` in `.env`).

## 5. In the app: Settings

- **Company & billing:** name, address, phone, logo, tax rate, payment terms, invoice numbering (continue from your current number), agreement terms (have your attorney review).
- **Calendars:** set the **public web address** to `https://app.yourcompany.com` — links in emails, the phone line and payment pages use it.
- **Users & logins:** add each person with the right role; link technician logins to their technician profile.
- **Field rules:** office address/location (for the time clock), count day, inventory manager, alert phone.

## 6. Email

Settings → Texts & email → SMTP. Microsoft 365: enable "Authenticated SMTP" for the sending mailbox (e.g. `service@yourcompany.com`); Gmail/Workspace: use an app password. Click **Send test email**.
Add the app's mail server to your domain's SPF record if your provider asks, so emails don't land in spam.

## 7. Twilio (texts + phone line)

1. Create a Twilio account (company card), buy a local number — or port the existing office number later once everything works.
2. **Register for A2P 10DLC** (Twilio console → Messaging → Regulatory compliance). US carriers block business texts from unregistered numbers; approval takes a few days.
3. Settings → Texts & email: Account SID, auth token, number. Send a test text.
4. Settings → Phone & on-call: turn routing on, enter the office phone and hours, then paste the webhook address shown there into the Twilio number's **Voice configuration**.
5. Build the on-call rotation (On-call & phone → Build rotation).

### In-app calls (team to team)

Team members can call each other from **Team chat** (📞), free, over the internet. Try a call between two phones on cell data (not Wi-Fi). If calls ring but never connect, the network needs a **relay server**; pick one in Settings → Phone & on-call → *In-app calls*:

- **Twilio** — uses the Twilio account above; billed per GB relayed (a few cents per call-hour). Nothing to install.
- **Your own relay** — free, runs next to the app: follow the steps at the top of `deploy/docker-compose.turn.yml` (set `TURN_SECRET` and `TURN_URLS` in `.env`, open ports 3478 and 49160–49200/UDP, start it with the extra compose file).

Phones need **notifications turned on** (Team chat → Turn on) to hear about calls when the app is closed. iPhones only ring for calls when the app was added to the Home Screen.

## 8. Payments (Stripe)

Create a Stripe account, start in **test mode** (`sk_test_…`), add the webhook endpoint shown in Settings → Payments, run a test payment, then switch to live keys.

## 9. Optional connections

QuickBooks Online (Accounting page), GPS tracking and maps (Settings → Tracking & maps), supplier-invoice email intake (Settings → Receiving), Claude API key for reading PDFs (`ANTHROPIC_API_KEY` in `.env`, then `docker compose up -d`).

## 10. Load your data

Technicians and vehicles, inventory items (use your distributors' part numbers), then customers with their locations, systems and monitoring accounts. A developer can bulk-import an existing customer list from a CSV.

## 11. Phones

Each person opens the site on their phone and **installs the app** (iPhone: Safari → Share → Add to Home Screen; Android: Chrome → Install app). Allow **location** (time clock) and **camera** (job photos) when asked.

## Backups

Set these up **before** real data goes in. Settings → **Backup & data** (owner only) shows a green "Backups look healthy" banner when everything below is working.

1. **Backup password.** Settings → Backup & data → *Backups on this server* → set a backup password (12+ characters; four or five random words is good). Every backup is then encrypted, and carries the app's encryption key, so **this password alone restores everything on a new server.** Save it in the company password manager *and* on paper in a safe. Nobody can recover it.
2. **Local backups (automatic).** Every night at the chosen hour: the database plus photos, signatures, supplier invoices, HR documents and manuals, as one file. Kept: every backup from the last 14 days, one a week for 8 weeks, one a month for 12 months (adjustable). If the server has a second disk or a network drive, point *Backup folder* at it (with Docker, mount it into the container and set `BACKUP_DIR`).
3. **Off-site copy (strongly recommended).** Backups on the same server don't help if the server is lost, the hosting account is closed, or someone breaks in. Use storage at a *different company*:
   - **Backblaze B2** (simple, inexpensive): create a bucket that is **private** with **Object Lock enabled** (only possible when creating it). Add a lifecycle rule to delete old versions after e.g. 400 days. Create an **application key for that bucket only** that can read, list and write but **not delete**.
   - Amazon S3, Cloudflare R2 and Wasabi work the same way.
   - In Settings → *Off-site copy*: storage address (the bucket's S3 endpoint), bucket, key ID and key; tick *Upload every backup off-site*; **Save**; **Test connection**.
   - Each night's backup is uploaded encrypted and locked against deletion for 30 days (Compliance mode): nobody — not an intruder with the server's keys, not you — can delete or change it early. The app never deletes anything off-site; the lifecycle rule ages old copies out.
   - Save the storage account's login somewhere other than this server, with two-step sign-in on.
4. **Alerts and checks (automatic).** The owner is alerted if a backup or upload fails, or if there's been no off-site copy for 2 days. On the 1st of each month the newest off-site backup is downloaded, decrypted and checked (database integrity, record counts, files). Results are under *History*. You can run a restore test any time.
5. **Hosting snapshots.** Also turn on the hosting company's server snapshots/backups if offered (Hostinger VPS has them). They're at the same company, so they don't replace step 3.
6. **Optional: continuous database backup** with Litestream (restore to a moment, e.g. "10:41 this morning"). See `deploy/docker-compose.litestream.yml`. Use a separate bucket *without* Object Lock.

### Restoring

- **One customer deleted by mistake:** Settings → Backup & data → on a backup from before it happened, **Recover a customer…**. Brings back the customer with its sites, contacts, systems, passwords, jobs, invoices and photos. Nothing else is rolled back.
- **Everything, on this server** (bad import, damaged data):
  ```bash
  docker compose stop app
  docker compose run --rm app npm run restore -- <backup name>     # names are listed in Settings
  docker compose start app
  ```
  The data that was there is moved aside (`before-restore-…` in the data volume), not deleted.
- **On a new server** (this one is gone): install the app as in step 2, add to `.env`:
  ```
  BACKUP_PASSPHRASE=<the backup password>
  OFFSITE_ENDPOINT=https://s3.us-west-004.backblazeb2.com
  OFFSITE_BUCKET=<bucket>
  OFFSITE_PREFIX=secureops            # the "Folder in the bucket" setting
  OFFSITE_KEY_ID=<key id>
  OFFSITE_SECRET=<key>
  ```
  then `docker compose run --rm app npm run restore -- --offsite latest` (or a backup name instead of `latest`), and `docker compose up -d`. Then remove `BACKUP_PASSPHRASE` and the `OFFSITE_*` lines from `.env` again (they're saved in the restored settings), point DNS at the new server, and sign in as usual.
- **Without the app at all:** a `.sobak` file can be downloaded from the storage company's website and restored with `npm run restore -- /path/to/file.sobak` (with `BACKUP_PASSPHRASE` set).
- **Practice once** after going live: restore the latest off-site backup onto a spare machine or a laptop.

## Updating

```bash
cd /opt/secureops && git pull
cd security-platform && docker compose up -d --build
```

The database upgrades itself on start. Make a backup first (Settings → Backup & data → **Back up now**, or `docker compose exec app npm run backup`).

## Keeping an eye on it

- `https://app.yourcompany.com/api/health` answers `{"ok":true}` when the app and database are up. Point a free uptime monitor (UptimeRobot, Better Stack) at it to get a text if it goes down.
- Logs: `docker compose logs -f app`.
- Keep the server patched: `sudo apt update && sudo apt upgrade` monthly (or turn on unattended upgrades).
