# 01 — Installing the server

This guide puts SecureOps on a server on the internet with a secure web address (HTTPS), ready for the company to use. It assumes no prior server experience; every command is given. Allow **about an hour**, plus time for the web address (DNS) to start working.

If you only want to **try SecureOps on your own computer** first, skip to [Trying it on a Windows or Mac computer](#trying-it-on-a-windows-or-mac-computer).

---

## What you need before starting

| Item | Details | Approx. cost |
|---|---|---|
| A **server** (VPS) | A small Linux virtual server: **Ubuntu 24.04 LTS**, 2 GB RAM (1 GB works for a small team), 2 vCPU, **40 GB+ disk** (job photos add up). Hostinger VPS, DigitalOcean, Linode/Akamai, Vultr and AWS Lightsail all work. | ~$6–15 / month |
| A **domain name** | The company's domain (e.g. `yourcompany.com`). You'll make a sub-address like `app.yourcompany.com`. | Already owned, or ~$15 / year |
| **Access to the domain's DNS** | The account where the domain is registered or its DNS is managed (GoDaddy, Namecheap, Cloudflare, Hostinger…). | — |
| A **company email account** | For the owner login and for sending email from the app. Use a company address, not a personal one. | — |
| A **password manager** | For the server password, the backup password and the encryption key. | — |
| A computer with a **terminal** | Windows: *PowerShell* or *Windows Terminal* (built in). Mac: *Terminal* (built in). | — |
| Access to the **code** | The Git repository (GitHub). If it's private, a GitHub account that can read it. | — |

> ⚠️ **Shared "website hosting" plans (the kind used for WordPress sites) will not work.** SecureOps needs a server that runs all the time and keeps its database on disk. Buy a **VPS** plan.

---

## Step 1 — Rent the server

Example with **Hostinger VPS** (other providers are nearly identical):

1. Buy a **KVM VPS** plan (KVM 1 or KVM 2 is plenty to start).
2. When asked for the operating system, choose **Ubuntu 24.04** (plain OS, *not* a control-panel template).
3. Pick the data-center **closest to the company** (e.g. a US location).
4. Set a **root password** (long, random, saved in the password manager). If offered, also add an **SSH key** (more secure; see "Optional: SSH keys" below).
5. Wait for the server to finish setting up (a few minutes). Write down its **IPv4 address** (four numbers, like `203.0.113.25`).

Also in the provider's panel, if available:

- Turn on **automatic snapshots / weekly backups**. It's a cheap extra safety net; it does not replace the app's own backups ([19](19-backups-and-security.md)).
- Turn on **two-factor sign-in** for the hosting account itself.

---

## Step 2 — Point the web address at the server

In the domain's DNS settings:

1. Add a record:
   - **Type:** `A`
   - **Name / Host:** `app` (this makes `app.yourcompany.com`; use another word if you prefer)
   - **Value / Points to:** the server's IPv4 address
   - **TTL:** default (or 300 seconds)
2. If you use **Cloudflare**, set the record to **DNS only** (grey cloud), at least until the certificate has been issued.
3. Save. It usually works within minutes but can take up to a few hours.

Check it from your computer's terminal:

```bash
nslookup app.yourcompany.com
```

When the answer shows the server's IP address, continue. (You can do Step 3 while waiting.)

---

## Step 3 — Connect to the server

From your computer's terminal (PowerShell on Windows, Terminal on Mac):

```bash
ssh root@203.0.113.25
```

Use the server's IP. The first time, type `yes` to trust the server, then enter the root password. (Nothing appears while typing a password; that's normal.) Your prompt changes to something like `root@srv123:~#`. **Every command from here on is typed on the server.**

> Hostinger also offers a **Browser terminal** button in its VPS panel if you'd rather not use SSH from your computer.

---

## Step 4 — Secure and update the server

Copy and paste these one block at a time.

**Update everything:**

```bash
apt update && apt -y upgrade
```

**Install security updates automatically from now on:**

```bash
apt -y install unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades
```

**Turn on the firewall** (only SSH and the website get through):

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
ufw status
```

> If you later run your own relay server for in-app calls ([18](18-phone-texting-and-twilio.md#relay-server-for-in-app-calls)), you'll also open `3478` and `49160:49200/udp`.

**Set the server's time zone** (use the company's):

```bash
timedatectl set-timezone America/New_York
```

Other common values: `America/Chicago`, `America/Denver`, `America/Phoenix`, `America/Los_Angeles`.

**Optional but recommended: block repeated password guessing on SSH:**

```bash
apt -y install fail2ban
systemctl enable --now fail2ban
```

---

## Step 5 — Install Docker

Docker runs the app and its web server (Caddy) in tidy, self-contained boxes and restarts them automatically.

```bash
curl -fsSL https://get.docker.com | sh
docker --version
docker compose version
```

Both commands should print a version number.

---

## Step 6 — Get the app's code onto the server

```bash
apt -y install git
git clone https://github.com/<owner>/<repository>.git /opt/secureops
cd /opt/secureops/security-platform
```

Replace the address with the real repository.

- **Private repository:** GitHub asks for a username and password. For the password, use a **personal access token** with read-only access to that one repository (GitHub → Settings → Developer settings → Fine-grained tokens), *not* your GitHub password.
- Alternatively, add a **deploy key** (read-only SSH key) to the repository and clone with the `git@github.com:` address.

---

## Step 7 — Settings file (`.env`)

```bash
cp .env.example .env
nano .env
```

`nano` is a simple editor: use the arrow keys to move, type to change, **Ctrl+O** then **Enter** to save, **Ctrl+X** to exit.

Set at least:

| Line | Set it to | Notes |
|---|---|---|
| `DOMAIN=` | `app.yourcompany.com` | Exactly the address from Step 2, no `https://`. |
| `TZ=` | e.g. `America/New_York` | Used for schedules, timesheets, reminders and the nightly backup time. |
| `ANTHROPIC_API_KEY=` | Optional | Only if you'll use automatic supplier-invoice reading or the help assistant ([20](20-integrations.md#claude-api)). Can be added later. |

Leave the rest as is. Almost everything else (email, Twilio, Stripe, backups…) is set up inside the app, not here.

> 🔒 `.env` contains secrets. Never email it, paste it into chat, or commit it to Git.

---

## Step 8 — Start SecureOps

```bash
docker compose up -d --build
```

The first build takes a few minutes. Then check:

```bash
docker compose ps
```

You should see two services, `app` and `caddy`, both **running** (or "Up"). Within a minute Caddy obtains the HTTPS certificate from Let's Encrypt.

To watch what's happening (press **Ctrl+C** to stop watching; the app keeps running):

```bash
docker compose logs -f
```

---

## Step 9 — Create the owner account **immediately**

Open `https://app.yourcompany.com` in a browser.

The first person to open a brand-new SecureOps **creates the owner account**, so do this right away, before anyone else could. Enter:

- your name,
- the **company name**,
- your **company email** (this is your login),
- a strong password (12+ characters).

You're now signed in as the owner.

> Never run `npm run seed` (demo data) on the real server. It's only for trying the app out.

---

## Step 10 — Save the encryption key

Alarm codes, camera passwords and other stored passwords are encrypted with a key the app creates the first time one is saved. **If that key is lost, those passwords can't be recovered.**

After you (or anyone) save the first customer password or alarm code, run:

```bash
docker compose exec app cat /data/secret.key
```

Copy the line it prints into the password manager, labelled *SecureOps encryption key*. Once backups have a backup password ([19](19-backups-and-security.md)), every backup also carries this key, encrypted; keep your own copy anyway.

---

## Step 11 — Set up backups before entering real data

Go to **Settings → Backup & data** and follow [19 — Backups and security](19-backups-and-security.md). At minimum, set a **backup password** today. Set up the **off-site copy** before the company relies on the system.

Then continue with [03 — First-time setup](03-first-time-setup.md).

---

## Day-to-day server care

All commands run in `/opt/secureops/security-platform` on the server (`cd /opt/secureops/security-platform` first).

| Task | Command |
|---|---|
| See if it's running | `docker compose ps` |
| See recent logs | `docker compose logs --tail=200 app` |
| Restart the app | `docker compose restart app` |
| Stop everything | `docker compose down` (data is kept in the `secureops-data` volume) |
| Start again | `docker compose up -d` |
| Make a backup now | `docker compose exec app npm run backup` (or Settings → Backup & data → **Back up now**) |
| Disk space | `df -h` |
| Health check (for uptime monitors) | `https://app.yourcompany.com/api/health` returns `{"ok":true}` |

### Updating to a new version

```bash
cd /opt/secureops/security-platform
docker compose exec app npm run backup      # safety backup first
git pull
docker compose up -d --build
docker compose ps
```

The database upgrades itself on start. Users get the new version the next time they open the app; installed apps refresh themselves.

### Uptime monitoring (recommended)

Use a free uptime service (UptimeRobot, Better Stack, Healthchecks…) to check `https://app.yourcompany.com/api/health` every few minutes and email or text you if it stops answering. It reveals nothing and needs no login.

### Optional: SSH keys instead of the root password

On your own computer: `ssh-keygen -t ed25519` (press Enter through the questions), then `ssh-copy-id root@<server IP>` (Mac/Linux) or paste the contents of `~/.ssh/id_ed25519.pub` into the hosting panel's SSH keys. Once key login works, you can turn off password login in `/etc/ssh/sshd_config` (`PasswordAuthentication no`, then `systemctl restart ssh`). Keep a way back in (the hosting panel's browser terminal) before doing this.

---

## Optional add-ons on the server

| Add-on | What it's for | How |
|---|---|---|
| **Relay server for in-app calls** (coturn) | Calls between team members that won't connect on some cell networks / office firewalls | `deploy/docker-compose.turn.yml` — see [18](18-phone-texting-and-twilio.md#relay-server-for-in-app-calls) |
| **Litestream** | Continuous database backup: restore to any minute | `deploy/docker-compose.litestream.yml` — see [19](19-backups-and-security.md#continuous-database-backup-litestream) |
| **Second disk for backups** | Local backups on a separate disk | Mount the disk, add it as a volume in `docker-compose.yml` (e.g. `- /mnt/backup:/backups`) and set `BACKUP_DIR=/backups` in `.env` |

To run with an add-on, list its file after the main one, e.g.:

```bash
docker compose -f docker-compose.yml -f deploy/docker-compose.turn.yml up -d
```

---

## Installing without Docker (advanced)

For an IT person who prefers a plain service:

1. Install **Node.js 22.13 or newer** (`node -v` to check) and **Caddy** (or nginx).
2. Create a user and data folder: `useradd -r -s /usr/sbin/nologin secureops && mkdir -p /var/lib/secureops && chown secureops /var/lib/secureops`.
3. Put the code in `/opt/secureops`, then `cd /opt/secureops/security-platform && npm ci --omit=dev`.
4. Optional settings in `/etc/secureops.env` (same names as `.env`).
5. `cp deploy/secureops.service /etc/systemd/system/ && systemctl enable --now secureops`
6. Caddy: use `deploy/Caddyfile` but with `reverse_proxy 127.0.0.1:3000`.
7. Back up `/var/lib/secureops` (the app's built-in backups do this; see [19](19-backups-and-security.md)).

---

## Trying it on a Windows or Mac computer

To explore SecureOps with demo data, without a server:

1. Install **Node.js 22 LTS** (version 22.13 or newer) from nodejs.org.
2. Download the code (GitHub → **Code → Download ZIP**, then unzip) or `git clone` it.
3. Open a terminal in the `security-platform` folder and run:
   ```bash
   npm install
   npm run seed
   npm start
   ```
4. Open `http://localhost:3000` and sign in with `owner@demo.local` / `demo1234`. Other demo logins: `admin@`, `sales@`, `accounting@`, `hr@`, and technicians `mike@`, `sam@`, `jen@demo.local` (same password).

This is for trying it only. Some phone features (installing the app, notifications, location, camera, in-app calls) need the real HTTPS address and won't work from other devices on `localhost`.

---

## If something goes wrong

| Symptom | Likely cause and fix |
|---|---|
| Browser says the site can't be reached | DNS not pointing at the server yet (`nslookup`), or the firewall blocks 80/443 (`ufw status`), or the app isn't running (`docker compose ps`). |
| Certificate / "not secure" warning | DNS wasn't ready when Caddy started, or Cloudflare proxy (orange cloud) is on. Fix DNS, then `docker compose restart caddy` and check `docker compose logs caddy`. |
| `docker compose up` fails with "Set DOMAIN in .env" | `DOMAIN=` is empty in `.env`. |
| Someone else created the owner account first | Stop the app, remove the data and start fresh **only if no real data was entered**: `docker compose down -v && docker compose up -d`. |
| Out of disk space | `df -h`; old backups are pruned automatically, but photos grow. Resize the server's disk or move backups to a second disk. |

More in [22 — Troubleshooting](22-troubleshooting-and-faq.md).
