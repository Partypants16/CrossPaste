# CrossPaste

A self-hosted, single shared clipboard for moving formatted text and images between
your own devices — laptop, phone, tablet — over your home network or your own VPN.
No accounts, no cloud, no public internet exposure.

Paste something on one device, open CrossPaste on another, and it's there.

## 1. Project overview

CrossPaste is one shared text area and one shared image tray, synced in real time to
every device that has the page open. There is exactly one clipboard — no folders, no
documents, no per-user data. It's meant to replace "email it to yourself" or "send it
to yourself on chat" when you just need to move something between your own devices.

## 2. Main features

- Rich-text editor (bold, italic, underline, strikethrough, headings, lists, links)
  with paste-and-normalise support from websites, Word, email, and chat apps.
- Autosave with conflict detection — no accidental overwrites between devices.
- Up to 10 shared images (PNG, JPEG, WebP, animated GIF), with thumbnails, download,
  and clipboard copy.
- Real-time sync across every open device via Server-Sent Events.
- Works over plain HTTP on your LAN; optional internal HTTPS for full clipboard-button
  support.
- No accounts. Optionally, a single shared access token if you want a light gate.
- Everything — text, images, thumbnails, database — lives in one folder on your own
  server, backed by SQLite and the filesystem. No cloud services of any kind.

## 3. Architecture

- **Frontend**: static HTML5 + CSS + vanilla JavaScript ES modules. No framework, no
  build step — the browser loads the files directly from `public/`.
- **Backend**: Node.js + Express, serving both the static frontend and a small JSON
  API under `/api`.
- **Database**: SQLite (via `better-sqlite3`), one file, WAL mode, foreign keys on.
- **File storage**: uploaded images and generated thumbnails on the local filesystem.
- **Real-time sync**: Server-Sent Events (`/api/events`) — one persistent connection
  per open tab, broadcasting text and image changes.
- **Reverse proxy (optional)**: Caddy, for an internal HTTPS hostname using its
  built-in local certificate authority (`tls internal`).
- **Packaging**: Docker + Docker Compose. Two containers: `app` (Node) and `caddy`.

```text
Browser  <---HTTP/HTTPS--->  Caddy (ports 80/443)  <---internal Docker network--->  Node/Express app  <--->  SQLite + filesystem (./data)
```

## 4. Network model

CrossPaste is built to run entirely inside a network you control — no public IP,
domain, or port forwarding required.

```text
Local device
    |
Home LAN
    |
Ubuntu Server running CrossPaste
```

```text
Remote device
    |
User-managed VPN
    |
Home LAN or Ubuntu Server VPN interface
    |
CrossPaste
```

The app listens on `0.0.0.0` by default (configurable via `APP_HOST`), so it accepts
connections from the LAN and from any routed VPN interface, not just from the server
itself.

**Important:** `localhost` / `127.0.0.1` only ever refers to the device you're using
_right now_. If you open `http://localhost:3000` on your phone, it looks for a server
running on the phone itself — which doesn't exist. Other devices must use the Ubuntu
Server's actual LAN IP address (e.g. `http://192.168.1.50:3000`), its VPN-reachable
address, or the internal hostname you configure (e.g. `https://crosspaste.home`).

## 5. Privacy and access model

There are no user accounts, no registration, and no login screen by default. Anyone
who can reach the server over your LAN or VPN can view and edit the one shared
clipboard. This is intentional — see [SECURITY.md](SECURITY.md) for the full threat
model. An optional shared access token is available if you want a light gate (section
23 below and `OPTIONAL_ACCESS_TOKEN` in `.env`); it is disabled by default and is not a
user account system.

No analytics, telemetry, or third-party services are contacted by the app at runtime.

## 6. Prerequisites

- An Ubuntu Server machine (or any Linux host) on your home network.
- Docker Engine and the Docker Compose plugin (installed below).
- A terminal / SSH access to that server.
- Optionally, a VPN already reachable to that server (configured separately — see
  section 15).

## 7. Ubuntu Server preparation

```bash
sudo apt update
sudo apt upgrade -y
```

Make sure the server has a stable LAN IP. Either set a static IP/DHCP reservation on
your router, or note the current IP with:

```bash
ip -4 addr show | grep inet
```

## 8. Installing Docker Engine

Follow Docker's official Ubuntu instructions (summarised here):

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Let your user run Docker without `sudo` (log out and back in afterwards):

```bash
sudo usermod -aG docker "$USER"
```

Verify:

```bash
docker --version
docker compose version
```

## 9. Installing Docker Compose

The Compose plugin is already installed in step 8 (`docker-compose-plugin`), which
provides the `docker compose` (with a space) command used throughout this README.

## 10. Downloading or cloning the repository

```bash
git clone https://github.com/YOUR_USERNAME/crosspaste.git
cd crosspaste
```

(If you received this project as a ZIP file instead, extract it and `cd` into the
extracted folder.)

## 11. Creating `.env`

```bash
cp .env.example .env
nano .env
```

At minimum, review:

- `INTERNAL_HOSTNAME` — only matters if you set up internal HTTPS (section 20).
- `OPTIONAL_ACCESS_TOKEN` — leave blank unless you want the optional token gate.
- The limits (`TEXT_CHARACTER_LIMIT`, `IMAGE_COUNT_LIMIT`, `IMAGE_SIZE_LIMIT_MB`, …) —
  the defaults match the ones described in this README.

`.env` is ignored by git (see `.gitignore`) — it holds settings and secrets specific to
your deployment and must never be committed.

## 12. Finding the Ubuntu Server's LAN IP address

```bash
ip -4 addr show | grep inet
```

Look for an address like `192.168.x.x` or `10.x.x.x` on your main network interface
(commonly `eth0` or `enp...`). That is the address other LAN devices will use.

## 13. Starting CrossPaste

```bash
docker compose up -d --build
```

This builds the `app` image, starts both containers, and creates `./data`,
`./caddy/data`, and `./caddy/config` on the host if they don't already exist (all three
are bind-mounted into the containers, so your data survives container recreation).

Check that both containers are healthy:

```bash
docker compose ps
```

Confirm the server responds:

```bash
curl http://localhost:80/api/health
```

## 14. Opening CrossPaste from another LAN device

On any other device connected to the same network, open:

```text
http://SERVER_LAN_IP
```

replacing `SERVER_LAN_IP` with the address you found in section 12 (e.g.
`http://192.168.1.50`). This works on laptops, desktops, Android phones, and iPhones —
just a normal web page, no app install required.

## 15. Opening CrossPaste through a VPN

CrossPaste doesn't know or care which VPN you use — it just needs the network path to
exist. Once your VPN (WireGuard, Tailscale, OpenVPN, your router's built-in VPN, etc.)
gives your remote device a route to the server, open the same URL as in section 14,
using whichever address the VPN makes reachable:

- the server's LAN IP (if the VPN routes your whole home subnet), or
- the server's VPN-assigned IP, or
- the internal hostname (section 21), if your VPN resolves it.

See section 15's networking notes below in "VPN compatibility" and the troubleshooting
section if a VPN-connected device can't reach the server.

**VPN networking requirements (product-neutral):**

- The VPN client must have a routed path to the server (its LAN IP, VPN IP, or subnet).
  Some VPN apps only route "internet" traffic and explicitly exclude your home LAN by
  default — check for a "local network access" or "subnet routing" option.
- The VPN's firewall (if any) must allow traffic to whatever port CrossPaste is
  reachable on (80/443 via Caddy, or your chosen `APP_PORT` in development mode).
- If you want to use the internal hostname over VPN, the VPN must also provide DNS
  resolution for it (or you add a hosts-file entry on the remote device pointing it at
  the VPN-reachable IP).
- Test connectivity before troubleshooting the app itself:

  ```bash
  ping SERVER_IP
  curl http://SERVER_IP:PORT/api/health
  ```

  If `ping` fails, the problem is routing/firewall, not CrossPaste. If `ping` works but
  `curl` doesn't, check the port and any firewall rules (section 24).

A short, optional note on WireGuard: if you use WireGuard, giving the CrossPaste
server's WireGuard peer an `AllowedIPs` that includes your home LAN subnet (not just
the server's single VPN IP) is what lets remote devices reach other LAN devices too;
if you only need to reach the server itself, its single VPN IP is enough. This project
does not install or configure WireGuard — configure your VPN separately.

## 16. Stopping CrossPaste

```bash
docker compose down
```

This stops and removes the containers but leaves `./data`, `./caddy/data`, and
`./caddy/config` untouched on disk.

## 17. Restarting CrossPaste

```bash
docker compose restart
```

or, after a reboot of the Ubuntu Server, since `restart: unless-stopped` is set in
`compose.yaml`, both containers start automatically with Docker.

## 18. Viewing logs

```bash
docker compose logs -f app
docker compose logs -f caddy
```

Logs are structured JSON lines (one per event) and never contain clipboard text, image
bytes, or secrets — see [SECURITY.md](SECURITY.md).

## 19. Updating CrossPaste

```bash
git pull
docker compose build --pull
docker compose up -d
```

Your data in `./data` is untouched by an update — only the application code and image
change.

## 20. Configuring internal HTTPS

Plain HTTP always works for the core app — typing, autosave, image upload/download,
and normal Ctrl+C/Ctrl+V. However, browsers restrict the dedicated **Paste**/**Copy**
buttons' use of the full Clipboard API to "secure contexts" (HTTPS, or localhost).
Internal HTTPS gets you that on your LAN without a public certificate.

Caddy is already configured (see `Caddyfile`) to serve your chosen internal hostname
over HTTPS using its own internal certificate authority (`tls internal`) — no public
CA, no public DNS, nothing external is contacted.

Steps:

1. Pick a hostname (section 21) and set `INTERNAL_HOSTNAME` in `.env`.
2. Restart Caddy so it picks up the hostname: `docker compose up -d`.
3. Trust Caddy's internal root certificate on each device you'll use (section 22).
4. Visit `https://YOUR_HOSTNAME` (not `http://`) to get the secure context.

## 21. Configuring a local hostname

Choose something clearly internal, e.g. `crosspaste.home`, and set it as
`INTERNAL_HOSTNAME` in `.env`. Then make it resolve to the server's LAN IP, either:

- **Router-level DNS** (preferred if your router supports local DNS records) — add an
  A record for `crosspaste.home` → the server's LAN IP.
- **Per-device hosts file** (works everywhere, but must be repeated per device):
  - Linux/macOS: add a line to `/etc/hosts`:
    ```text
    192.168.1.50   crosspaste.home
    ```
  - Windows: edit `C:\Windows\System32\drivers\etc\hosts` (as Administrator) and add
    the same line.
  - Android/iOS: typically requires a third-party hosts-editing or DNS app, or use the
    LAN IP address directly instead.

No public domain registration or public DNS is involved at any point.

## 22. Trusting the internal certificate

Caddy's internal CA issues a certificate for your chosen hostname, but browsers won't
trust it until the CA's root certificate is trusted on each device.

**Locate/export the root certificate** from the Caddy container:

```bash
docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt > crosspaste-internal-ca.crt
```

Copy `crosspaste-internal-ca.crt` to each device you want to trust it on.

- **Windows**: double-click the `.crt` file → *Install Certificate* → *Local Machine* →
  *Place all certificates in the following store* → *Trusted Root Certification
  Authorities* → Finish. Restart your browser.
- **macOS**: double-click the `.crt` file to add it to *Keychain Access*, then open it
  in Keychain Access, expand *Trust*, and set *When using this certificate* to
  *Always Trust*.
- **Ubuntu / other Linux**:
  ```bash
  sudo cp crosspaste-internal-ca.crt /usr/local/share/ca-certificates/crosspaste-internal-ca.crt
  sudo update-ca-certificates
  ```
  (Firefox and Chrome on Linux may also need the certificate imported into the
  browser's own certificate store, depending on distro/browser settings.)
- **Android**: Settings → Security (or "Security & privacy") → *Encryption & credentials*
  → *Install a certificate* → *CA certificate* → select the file. Newer Android
  versions show a warning about user-installed CAs; this is expected for a
  self-managed internal CA.
- **iOS / iPadOS**: AirDrop or email the file to the device, open it (Settings will
  prompt to install a profile), then go to **Settings → General → About → Certificate
  Trust Settings** and enable full trust for the CrossPaste root certificate. Both
  steps are required — installing the profile alone is not enough.

**Removing the certificate later**: reverse the same steps (delete it from Keychain
Access, `Trusted Root Certification Authorities`, `update-ca-certificates` after
removing the file, or the device's certificate list) if you decommission the server or
regenerate the CA.

## 23. HTTP clipboard limitations

Over plain HTTP (no internal HTTPS configured), the following still work normally:

- Typing, editing, and formatting text.
- Autosave.
- Image upload, download, drag-and-drop, and paste-into-the-page.
- Native keyboard copy/paste (Ctrl+C / Ctrl+V or Cmd+C / Cmd+V).

The dedicated **Paste**/**Copy**/**Copy Selected Image** buttons specifically use the
browser's async Clipboard API, which most browsers restrict to secure contexts. Over
plain HTTP, clicking them will show a short inline message asking you to use the
keyboard shortcut instead — this is expected, not a bug. Internal HTTPS (section 20)
resolves this.

## 24. Configuring UFW for LAN and VPN access

CrossPaste's own Docker networking does not depend on your host firewall, but you
should still restrict who can reach it. The examples below use **placeholder
subnets** — replace them with your actual LAN and VPN subnets before running these
commands.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Replace with your ACTUAL LAN subnet:
sudo ufw allow from 192.168.1.0/24 to any port 80,443 proto tcp

# Replace with your ACTUAL VPN subnet:
sudo ufw allow from 10.0.0.0/24 to any port 80,443 proto tcp

sudo ufw enable
sudo ufw status verbose
```

**Do not** run `sudo ufw allow 80,443` on its own — that opens the ports to *any*
source, including the public internet if the server is ever exposed. Always scope the
rule to a `from <subnet>` clause.

If you're using the development compose overlay (`compose.dev.yaml`, section 33) with
`APP_PORT` published directly, add an equivalent rule for that port instead of/as well
as 80/443.

## 25. Persistent storage

Everything CrossPaste needs to keep is under one folder on the host:

```text
./data/               SQLite database, uploaded images, generated thumbnails
./caddy/data/         Caddy's internal CA and issued certificates
./caddy/config/       Caddy's autosaved runtime configuration
```

These are bind-mounted into the containers (see `compose.yaml`), so recreating,
rebuilding, or updating the containers never touches this data — it lives outside the
container filesystem entirely, directly on the Ubuntu Server's disk.

## 26. Backing up data

```bash
./scripts/backup.sh
```

This uses SQLite's own online backup API (via `scripts/backup.js`, run inside the
container) to take a consistent snapshot of the database — it does **not** just copy
the `.db` file, which could capture it mid-write. The snapshot, `uploads/`, and
`thumbnails/` are then archived to `./backups/crosspaste-backup-<timestamp>.tar.gz`.

Verify a backup archive is readable without extracting it:

```bash
tar tzf ./backups/crosspaste-backup-<timestamp>.tar.gz
```

Back up regularly, and definitely before updating CrossPaste or changing configuration
you might want to undo.

## 27. Restoring data

```bash
./scripts/restore.sh ./backups/crosspaste-backup-<timestamp>.tar.gz
```

This stops CrossPaste, moves your current `./data` aside (as
`./data.before-restore-<timestamp>`, not deleted), extracts the archive into a fresh
`./data`, and starts CrossPaste again.

**Test your restore process** on a spare machine or a throwaway `./data` copy at least
once — a backup you've never restored from is unverified. After restoring, run:

```bash
./scripts/database-check.sh
```

to confirm the restored database passes an integrity check.

## 28. Moving the application to another server

1. On the old server: `docker compose down` and `./scripts/backup.sh`.
2. Copy the project folder (or re-clone the repository) and the resulting
   `./backups/*.tar.gz` file to the new server.
3. On the new server: `cp .env.example .env` and edit it for the new server's
   settings.
4. Extract the backup into `./data` (or use `./scripts/restore.sh`).
5. `docker compose up -d --build`.
6. Update any hosts-file entries or router DNS records (section 21) to point the
   internal hostname at the new server's LAN IP.

## 29. Clearing all stored content

To wipe the shared text and delete every stored image (destructive, asks for
confirmation):

```bash
docker compose exec app node scripts/clear-data.js
```

Add `--yes` to skip the interactive confirmation (useful for scripted resets).

## 30. Configuring automatic expiry

Disabled by default. To automatically clear text and delete images older than a fixed
age, set in `.env`:

```text
CONTENT_EXPIRY_HOURS=24
```

then `docker compose up -d` to apply it. `0` (the default) disables this feature
entirely. When enabled, cleanup runs once at startup and then periodically; it never
runs two cleanup passes concurrently, and every device is notified in real time when
content is cleared this way.

## 31. Changing limits

All in `.env` (see that file for full descriptions), then `docker compose up -d`:

| Variable | Default | Meaning |
|---|---|---|
| `TEXT_CHARACTER_LIMIT` | `500000` | Maximum characters in the shared text |
| `IMAGE_COUNT_LIMIT` | `10` | Maximum images stored at once, globally |
| `IMAGE_SIZE_LIMIT_MB` | `10` | Maximum accepted upload size per image |
| `IMAGE_MAX_DIMENSION` | `2000` | Longest-side resize target in pixels (GIFs exempt) |
| `AUTOSAVE_DELAY_MS` | `800` | Debounce delay before autosaving text |
| `WRITE_RATE_LIMIT_MAX` / `_WINDOW_MS` | `120` / `60000` | Text-save rate limit |
| `UPLOAD_RATE_LIMIT_MAX` / `_WINDOW_MS` | `20` / `60000` | Image-upload rate limit |

## 32. Troubleshooting

- **Another device can't load the page at all.** Confirm it's on the same LAN/VPN,
  confirm the server's IP with `ip -4 addr show`, and test with `curl
  http://SERVER_IP/api/health` from the *other* device. If that fails, it's a
  network/firewall issue, not the app — check UFW rules (section 24) and VPN routing
  (section 15).
- **Clipboard buttons show a fallback message instead of copying/pasting.** Expected
  over plain HTTP — see section 23. Use Ctrl+V/Ctrl+C, or set up internal HTTPS.
- **Certificate warnings on the hostname over HTTPS.** The internal CA root
  certificate isn't trusted on that device yet — see section 22.
- **"Text exceeds the configured character limit."** Reduce the text below
  `TEXT_CHARACTER_LIMIT` and save again; nothing is lost or truncated automatically.
- **Image upload rejected.** Check the file is PNG/JPEG/WebP/GIF (SVG is intentionally
  rejected), under `IMAGE_SIZE_LIMIT_MB`, and that you're under the `IMAGE_COUNT_LIMIT`
  (delete an existing image to free a slot).
- **Containers won't start.** `docker compose logs app` and `docker compose logs
  caddy` for details; run `docker compose config` to validate the compose file itself.
- **Health check failing.** `curl http://localhost/api/health` and check the JSON
  response's `databaseReachable` and `dataDirectoryWritable` fields.

## 33. Database recovery

Run an integrity check without modifying anything:

```bash
./scripts/database-check.sh
```

If it reports a failure, stop the app (`docker compose down`) and restore the most
recent known-good backup (section 27) rather than editing the database file directly.
`better-sqlite3` runs in WAL mode with foreign keys enforced, which makes silent
corruption from ordinary use unlikely; failures are far more often disk-level (see
section 34) than application-level.

## 34. Disk-space management

- Images are capped by count (`IMAGE_COUNT_LIMIT`) and per-file size
  (`IMAGE_SIZE_LIMIT_MB`), so image storage has a known upper bound.
- Old backups accumulate in `./backups/` — CrossPaste does not delete old backups
  automatically; periodically prune ones you no longer need.
- Check usage on the Ubuntu Server with:
  ```bash
  df -h
  du -sh ./data ./backups
  ```
- If disk space runs out mid-write, uploads fail cleanly (the partial file and
  database row are rolled back — see `server/services/image-service.js`) rather than
  leaving corrupt data; you'll see an "upload failed" message in the UI.

## 35. Public repository security

If you publish this repository publicly (e.g. on GitHub):

- `.env`, `*.db`/`*.db-wal`/`*.db-shm`, `./data/`, `./backups/`, and
  `./caddy/data|config/` are all excluded via `.gitignore` — never commit them. They
  contain runtime data (clipboard content, images) and, if you set one, your access
  token — none of that belongs in source control.
- `.dockerignore` mirrors this so none of it is ever baked into a built image either.
- Double-check `git status` before your first commit and any time you add files, in
  case a `.env` or `./data` file was created before `.gitignore` took effect.
- Rotate `OPTIONAL_ACCESS_TOKEN` if you ever suspect it was committed or leaked.
- See [SECURITY.md](SECURITY.md) for the full security model and hardening checklist.

## 36. Removing the application completely

```bash
docker compose down -v
docker image rm crosspaste-app:latest
cd ..
rm -rf crosspaste
```

`docker compose down -v` removes the containers and the dedicated Docker network. If
you also bind-mounted `./data`, `./caddy/data`, and `./caddy/config` (the default in
`compose.yaml`), those are plain host directories — the final `rm -rf` (or manually
deleting the folder) removes them along with everything else. Back up first (section
26) if you might want the data again later.

---

## Development mode

You do not need Docker for day-to-day development.

```bash
npm install
cp .env.example .env
npm run dev
```

`npm run dev` runs `node --watch server/server.js`, restarting automatically when
backend files change. Open `http://localhost:3000` (or your configured `APP_PORT`).

To test the same code inside Docker Compose without going through Caddy, use the
development overlay, which publishes the app's port directly:

```bash
docker compose -f compose.yaml -f compose.dev.yaml up -d --build
```

Run the automated test suite:

```bash
npm test
```

Tests run against a temporary SQLite database and temporary upload directories created
fresh for each test file — they never touch `./data` or any real deployment.
