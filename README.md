# Prayer & Weather Dashboard

A dependency-free Progressive Web App built to run as a permanently
mounted, portrait-orientation kiosk display on a Raspberry Pi Zero 2 W.
Shows a live clock, Hijri date with moon phase, weather (Open-Meteo),
and prayer times (AlAdhan) with a live countdown to the next prayer.

No frameworks, no build step, no npm install. Clone it and open
`index.html` — or deploy it as a kiosk with the instructions below.

---

## 1. Project structure

```
prayer-dashboard/
├── index.html            Semantic markup + all DOM anchor points for JS
├── manifest.json         PWA manifest (installable, portrait-primary)
├── sw.js                 Service worker: versioned cache-first app shell
├── css/
│   ├── variables.css      Design tokens (color, type, spacing, motion)
│   ├── typography.css     Font-face + text styles
│   ├── layout.css         CSS Grid page structure (portrait-first)
│   ├── components.css     Card chrome, prayer rail, highlight states
│   └── animations.css     GPU-friendly keyframes only
├── js/
│   ├── app.js             Bootstrap + refresh scheduling ONLY
│   ├── settings.js        Loads/merges data/settings.json
│   ├── api.js              fetch + retry + localStorage cache/fallback
│   ├── ui.js                DOM helpers + inline SVG icon generators
│   ├── clock.js            Live clock + midnight detection
│   ├── weather.js          Open-Meteo fetch + render
│   ├── prayers.js          AlAdhan fetch + current/next + render
│   ├── countdown.js        Next-prayer countdown, shares clock's 1s tick
│   └── hijri.js             Hijri date fetch + local moon-phase calc
├── data/
│   └── settings.json       Location, calculation method, madhab, quotes
└── assets/
    ├── icons/               SVG app icons (manifest + apple-touch-icon)
    ├── images/               (empty — reserved, no raster assets shipped)
    └── fonts/                Self-hosted variable fonts (see §2)
```

Every JS file has exactly one job (see the doc-comment at the top of
each file). `app.js` never fetches data itself — it only calls into
`weather.js` / `prayers.js` / `hijri.js` and decides *when*.

---

## 2. Fonts (optional but recommended)

The dashboard is designed around **Manrope** (display/numerals) and
**Inter** (body/labels), self-hosted so the kiosk never depends on a
remote font request at boot. Both are open-source (SIL OFL) variable
fonts. Without them, `typography.css` falls back to `system-ui`, which
still looks clean — but for the intended look, download the variable
`.woff2` files and place them at:

```
assets/fonts/Manrope-Variable.woff2
assets/fonts/Inter-Variable.woff2
```

Sources: [Manrope on Google Fonts](https://fonts.google.com/specimen/Manrope) ·
[Inter on rsms.me](https://rsms.me/inter/)

---

## 3. Configuration

Edit `data/settings.json` — no code changes required:

| Key | Meaning |
|---|---|
| `location.latitude` / `longitude` | Used by both Open-Meteo and AlAdhan |
| `location.timezone` | IANA timezone, e.g. `Europe/Stockholm` |
| `prayer.method` | AlAdhan calculation method id (see [aladhan.com/calculation-methods](https://aladhan.com/calculation-methods)) |
| `prayer.madhab` | `0` = Shafi/Maliki/Hanbali (standard Asr), `1` = Hanafi |
| `weather.units` | `metric` or `imperial` |
| `app.weatherRefreshMinutes` | Default `30` |
| `app.quoteRotationSeconds` | Default `45` |
| `quotes` | Array of `{ text, source }` shown in rotation in the footer |

Settings can also be overridden at runtime from the browser console
(useful for on-device debugging without editing the SD card) via
`js/settings.js`'s `saveOverrides()` — persisted to `localStorage`
and merged on next load.

---

## 4. Data sources

- **Weather:** [Open-Meteo](https://open-meteo.com/) — free, no API key,
  used for current conditions, hourly forecast, and sunrise/sunset.
  Refreshed every 30 minutes.
- **Prayer times:** [AlAdhan](https://aladhan.com/prayer-times-api) —
  free, no API key, configurable calculation method and madhab.
  Refreshed once a day (plus a targeted refresh exactly at midnight and
  immediately after the last prayer of the day rolls over).
- **Hijri date:** AlAdhan's Gregorian-to-Hijri endpoint, once a day.
  Moon phase is computed **locally** (no network call) via a synodic-
  month approximation.

All three are wrapped by `js/api.js`, which retries failed requests a
few times, then falls back to the last successful response cached in
`localStorage` (with a per-endpoint staleness window) so the dashboard
keeps showing meaningful data through a Wi-Fi outage.

---

## 5. Offline support / PWA behaviour

- `sw.js` precaches the entire app shell (HTML/CSS/JS/manifest/icons)
  under a **versioned** cache name (`prayer-dashboard-v1.0.0`). Bump
  `CACHE_VERSION` in `sw.js` whenever you change a shipped file — the
  `activate` handler automatically deletes the previous version's
  cache, so updates roll out cleanly with no manual cache-clearing step.
- Strategy is **cache-first with background refresh** for the app
  shell: the kiosk boots instantly from cache, then quietly checks the
  network for a newer copy of each file.
- API responses (weather/prayer/hijri) are **not** cached by the
  service worker — that's deliberately handled in `js/api.js` instead,
  where staleness rules differ per endpoint (e.g. weather is usable up
  to 3h old, prayer times up to 36h old).
- The app is installable: on a desktop/mobile browser, the manifest
  will surface an "Install" prompt. In kiosk mode this isn't needed —
  Cog loads `index.html` directly — but it means the same code works as
  a normal installable PWA during development on a laptop or phone.

---

## 6. Local development

No build step. Any static file server works:

```bash
cd prayer-dashboard
python3 -m http.server 8080
# visit http://localhost:8080
```

Service workers require a secure context, so `localhost` is fine but a
plain `file://` open will skip PWA/offline features (the dashboard
still renders and fetches data normally).

---

## 7. Raspberry Pi kiosk deployment (Cage + Cog + systemd)

Target: Raspberry Pi Zero 2 W, Raspberry Pi OS Lite (64-bit), a
permanently mounted monitor rotated to portrait.

### 7.1 Install Cage (Wayland kiosk compositor) and Cog (WebKit browser)

```bash
sudo apt update
sudo apt install -y cage cog seatd
```

If `cog` isn't in your distro's repo, build it from source per the
[Cog project instructions](https://github.com/Igalia/cog) — it depends
on WPEWebKit, which is packaged for Raspberry Pi OS's WPE backend.

### 7.2 Copy the project onto the Pi

```bash
sudo mkdir -p /opt/prayer-dashboard
sudo cp -r prayer-dashboard/* /opt/prayer-dashboard/
sudo chown -R www-data:www-data /opt/prayer-dashboard
```

### 7.3 Serve it locally

Kiosk browsers should load from `http://localhost`, not `file://`, so
the service worker and `fetch()` calls to `data/settings.json` behave
identically to development. A tiny static server is enough — no
Node.js required. `busybox httpd` (already on Raspberry Pi OS Lite) or
Python's built-in server both work; the example below uses Python for
clarity, but consider `busybox httpd -f -p 8080 -h /opt/prayer-dashboard`
for a smaller memory footprint on the Zero 2 W.

**`/etc/systemd/system/prayer-dashboard-server.service`:**

```ini
[Unit]
Description=Prayer Dashboard static file server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/prayer-dashboard
ExecStart=/usr/bin/python3 -m http.server 8080
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

### 7.4 Rotate the display to portrait

Add to `/boot/firmware/config.txt` (adjust rotation as needed for your
mounting orientation):

```ini
display_rotate=1
```

(`1` = 90°. Use `3` for 270° if the panel is mounted the other way.)
On newer Raspberry Pi OS with KMS, prefer the DRM rotation property
instead — see the Raspberry Pi documentation for your specific OS
version, as `display_rotate` behaviour has changed across releases.

### 7.5 Launch Cage + Cog as a kiosk on boot

**`/etc/systemd/system/prayer-dashboard-kiosk.service`:**

```ini
[Unit]
Description=Prayer Dashboard kiosk (Cage + Cog)
After=prayer-dashboard-server.service systemd-user-sessions.service
Requires=prayer-dashboard-server.service
Conflicts=getty@tty1.service

[Service]
Type=simple
User=pi
Group=pi
PAMName=login
TTYPath=/dev/tty1
StandardInput=tty
StandardOutput=journal
StandardError=journal
# --url points Cog at the locally served dashboard rather than a file:// path
ExecStart=/usr/bin/cage -- /usr/bin/cog --platform=wayland -- http://localhost:8080/index.html
Restart=always
RestartSec=2

[Install]
WantedBy=graphical.target
```

Adjust the `cog` invocation flags to match the version packaged for
your OS — some builds take the URL as a bare positional argument
without a `--` separator; run `cog --help` to confirm.

### 7.6 Enable everything and reboot

```bash
sudo systemctl daemon-reload
sudo systemctl enable prayer-dashboard-server.service
sudo systemctl enable prayer-dashboard-kiosk.service
sudo systemctl set-default graphical.target
sudo reboot
```

On boot, `prayer-dashboard-server` starts the static file server, and
`prayer-dashboard-kiosk` launches Cage (compositor) running Cog
(browser) full-screen against it — no desktop environment, no window
manager overhead, minimal RAM footprint for the Zero 2 W's 512MB.

### 7.7 Updating the deployed app

```bash
sudo cp -r prayer-dashboard/* /opt/prayer-dashboard/
sudo systemctl restart prayer-dashboard-kiosk.service
```

Remember to bump `CACHE_VERSION` in `sw.js` before copying if you
changed any shipped file, so the service worker picks up the change
rather than serving the previous cached version.

---

## 8. Performance notes

- Total JS across all modules is well under the ~100KB budget with zero
  external dependencies.
- Exactly three long-lived timers run at any time: the 1-second clock
  (which also drives the countdown and highlight state), the 30-minute
  weather refresh, and the quote rotation interval. Prayer/Hijri data
  refreshes are event-driven (midnight rollover, post-Isha rollover),
  not polled.
- All DOM writes go through `ui.js`'s `setText`/`setClass`/`setAttr`
  helpers, which skip the write entirely when the value hasn't changed
  — the dominant cost of a naive "re-render every tick" clock.
- Animations are restricted to `opacity`/`transform` only (see
  `animations.css`), so they run on the compositor thread without
  triggering layout.
- Icons are inline SVG strings generated in `ui.js` rather than image
  files, avoiding dozens of small HTTP/filesystem requests.

---

## 9. Graceful degradation

- **No internet at boot:** the service worker serves the cached app
  shell; `api.js` serves last-known weather/prayer/hijri data from
  `localStorage` if any exists, otherwise the UI shows a plain
  "unavailable" state rather than breaking.
- **API failure mid-session:** each fetch retries a configurable number
  of times (`app.apiRetryAttempts` / `apiRetryDelayMs` in
  `settings.json`) before falling back to cache.
- **Stale cached data:** the weather card gets a visible `.is-stale`
  treatment (amber border + "Showing last known data" caption) once
  cached data exceeds its freshness window, so the kiosk never silently
  shows misleadingly "live" numbers.
- **Offline indicator:** a small dot in the top-right corner turns
  amber/red and pulses when `navigator.onLine` reports the device is
  offline.
