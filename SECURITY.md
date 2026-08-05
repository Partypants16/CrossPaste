# Security

## Intended threat model

CrossPaste is designed to be reachable only from:

- devices on your local network, and
- devices connected to a VPN you configure and manage yourself.

It is **not** designed to be exposed directly to the public internet. There is no
account system: anyone who can reach the server on the network can read and change the
shared clipboard. Treat network-level access control (your router/firewall and your
VPN) as the actual access control for this application.

If you need per-user accounts, audit logs of who changed what, or public internet
exposure, CrossPaste is not the right tool as-is.

## What CrossPaste already protects against

- **Stored XSS / script injection** — All pasted and submitted HTML is sanitised twice:
  once in the browser (defense in depth) and once on the server using
  [`sanitize-html`](https://www.npmjs.com/package/sanitize-html) against a documented
  allow-list (see `server/utilities/sanitise.js`). The server-side pass is authoritative.
  Scripts, event handler attributes, iframes, forms, embedded objects, and
  `javascript:`/`data:` URLs are removed, not merely escaped.
- **Malicious image uploads** — Uploaded files are validated by inspecting their actual
  file signature (magic bytes) via the `file-type` package, not by trusting the
  filename or the browser-supplied `Content-Type`. SVG is rejected outright because it
  can carry executable/script content. Files are re-encoded (PNG/JPEG/WebP) or
  size/signature-checked (GIF) before being written to disk, and are always stored
  under a random server-generated filename — the original filename is kept only as
  display metadata, never used as a path.
- **Path traversal** — Stored filenames are server-generated UUIDs; user-supplied
  filenames are sanitised to a display-only string and never used to build a filesystem
  path.
- **SQL injection** — All database access uses parameterised queries via
  `better-sqlite3`'s prepared statements. No SQL string is ever built by concatenating
  user input.
- **Cross-origin abuse** — CORS is not enabled. The API only serves same-origin
  requests from the page it ships.
- **Clickjacking** — `X-Frame-Options: DENY` and a `frame-ancestors 'none'` CSP
  directive block the app from being framed.
- **MIME sniffing** — `X-Content-Type-Options: nosniff` is set on all responses.
- **Abusive request volume** — Write operations (clipboard saves) and image uploads
  are separately rate-limited per client.
- **Oversized requests** — JSON body size and upload size are capped; oversized
  requests are rejected before they reach application logic.
- **Information leakage in errors** — API error responses never include stack traces,
  filesystem paths, SQL text, environment values, or raw request bodies. Server logs
  may contain technical error detail (error codes, HTTP paths) but never clipboard
  text, image bytes, access tokens, or cookies.
- **Directory listing / source exposure** — Only the `public/` directory is served as
  static files. Dotfiles are ignored by the static file server. Source, configuration,
  and the database live outside the served directory entirely.

## What CrossPaste does **not** protect against

- **A malicious or compromised device on the same network/VPN.** Anyone who can reach
  the server can read and overwrite the shared clipboard and upload/delete images.
  There is no per-device isolation and no audit trail of who changed what.
- **Traffic interception on plain HTTP.** Without the optional internal HTTPS setup
  (see `README.md` → "Configuring internal HTTPS"), clipboard content travels
  unencrypted on your LAN/VPN. This is the same exposure as most self-hosted LAN tools;
  use internal HTTPS or a VPN with its own encryption if this matters for your content.
- **A weak or leaked optional access token.** The optional shared token
  (`OPTIONAL_ACCESS_TOKEN`) is a single shared secret, not a per-user credential. Anyone
  who obtains it has the same access as anyone else. Rotate it by changing the
  environment variable and restarting the app.
- **Malicious content already trusted by the pasting device.** CrossPaste sanitises
  HTML structure and blocks script execution, but it cannot protect against, for
  example, a user intentionally pasting a phishing link — links are preserved as
  ordinary `<a>` tags with `rel="noopener noreferrer nofollow"`.
- **Denial of service from a determined actor already on your network.** Rate limiting
  reduces accidental or mildly abusive load; it is not a defense against a
  network-local attacker deliberately trying to exhaust resources.

## Reporting a vulnerability

This is a self-hosted personal project template, not a maintained service with an SLA.
If you find a security issue in the code, please open a GitHub issue on the repository
describing the problem. Do not include real clipboard content, tokens, or personal
network details in the report.

## Hardening checklist for operators

- Keep CrossPaste off any interface that is reachable from the public internet. No
  port forwarding, no public DNS record pointed at it.
- Restrict inbound access with `ufw` (or your firewall of choice) to your actual LAN
  and VPN subnets — see `README.md` → "Configuring UFW for LAN and VPN access".
- Set `OPTIONAL_ACCESS_TOKEN` if your LAN or VPN is shared with people/devices you do
  not fully trust.
- Enable internal HTTPS (`README.md` → "Configuring internal HTTPS") if you want
  transport encryption and full Clipboard API support.
- Keep the Docker images and npm dependencies up to date (`docker compose build
  --pull` and periodic `npm audit` against `package-lock.json`).
- Back up `./data` regularly using `scripts/backup.sh` before making any changes you
  might need to undo.
