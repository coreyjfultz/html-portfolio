# Going live — checklist

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

Camera passwords, alarm codes and saved service passwords are encrypted with a key that is created the first time one is saved. **If the key is lost, those passwords can't be recovered — backups don't contain it.** After entering the first camera password:

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

## 8. Payments (Stripe)

Create a Stripe account, start in **test mode** (`sk_test_…`), add the webhook endpoint shown in Settings → Payments, run a test payment, then switch to live keys.

## 9. Optional connections

QuickBooks Online (Accounting page), GPS tracking and maps (Settings → Tracking & maps), supplier-invoice email intake (Settings → Receiving), Claude API key for reading PDFs (`ANTHROPIC_API_KEY` in `.env`, then `docker compose up -d`).

## 10. Load your data

Technicians and vehicles, inventory items (use your distributors' part numbers), then customers with their locations, systems and monitoring accounts. A developer can bulk-import an existing customer list from a CSV.

## 11. Phones

Each person opens the site on their phone and **installs the app** (iPhone: Safari → Share → Add to Home Screen; Android: Chrome → Install app). Allow **location** (time clock) and **camera** (job photos) when asked.

## Backups

- **Nightly, automatic:** database + photos, signatures and supplier invoices, at `BACKUP_HOUR` (2 AM) in the data volume; the last `BACKUP_KEEP` (14) are kept. See them under Settings → Backup & data, or make one now with **Back up now** / `docker compose exec app npm run backup`.
- **Off-site copies:** backups on the same server don't help if the server is lost. Either download one weekly from Settings → Backup & data, or copy them nightly to cloud storage from the server, for example with [rclone](https://rclone.org) (configure once with `rclone config`):

  ```bash
  # crontab -e   (runs at 3:30 AM, after the nightly backup)
  30 3 * * * rclone sync $(docker volume inspect -f '{{ .Mountpoint }}' security-platform_secureops-data)/backups remote:secureops-backups
  ```

- **Restore:** `docker compose stop app`, then
  `docker compose run --rm app npm run restore -- <backup name>` (the current data is moved aside, not deleted), then `docker compose start app`.
- **Test a restore** once after going live, on a spare server or your laptop.

## Updating

```bash
cd /opt/secureops && git pull
cd security-platform && docker compose up -d --build
```

The database upgrades itself on start. A backup before updating doesn't hurt: `docker compose exec app npm run backup`.

## Keeping an eye on it

- `https://app.yourcompany.com/api/health` answers `{"ok":true}` when the app and database are up. Point a free uptime monitor (UptimeRobot, Better Stack) at it to get a text if it goes down.
- Logs: `docker compose logs -f app`.
- Keep the server patched: `sudo apt update && sudo apt upgrade` monthly (or turn on unattended upgrades).
