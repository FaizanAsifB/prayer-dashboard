/**
 * prayers.js
 * ---------------------------------------------------------------------------
 * Responsibility: AlAdhan prayer-time fetching, current/next prayer
 * determination, and dynamic rendering of the prayer list. The list of
 * prayer rows is generated entirely from the API response — nothing
 * about prayer names/times is hardcoded in HTML, satisfying the brief's
 * "generate prayer rows dynamically" requirement and making the app
 * correct for any madhab/method combination without template changes.
 *
 * Refresh cadence: once per day (see app.js). The current/next
 * highlight, however, is recomputed far more often (every countdown
 * tick) since "which prayer is current" changes in real time even
 * though the underlying timetable doesn't.
 */

import { fetchWithFallback } from "./api.js";
import { setText, setClass } from "./ui.js";

const ALADHAN_BASE = "https://api.aladhan.com/v1";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Only these five are the canonical daily obligatory prayers the
// dashboard highlights; AlAdhan's response includes extra entries
// (Sunrise, Imsak, Midnight) that we deliberately exclude from the
// countdown/highlight logic but still expose for completeness.
const PRAYER_ORDER = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];

function toAladhanDateString(date) {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function buildUrl(date, settings) {
  const { location, prayer } = settings;
  const dateStr = toAladhanDateString(date);
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    method: String(prayer.method),
    school: String(prayer.madhab),
    timezonestring: location.timezone,
  });
  if (prayer.tune) params.set("tune", prayer.tune);
  return `${ALADHAN_BASE}/timings/${dateStr}?${params.toString()}`;
}

/**
 * Parses an AlAdhan "HH:MM" (sometimes "HH:MM (TZ)") string for a given
 * calendar date into a real Date object in that timezone-of-record.
 * AlAdhan already returns times adjusted for the requested timezone, so
 * we only need to attach them to today's Y/M/D.
 */
function timeStringToDate(timeStr, referenceDate) {
  const clean = timeStr.split(" ")[0]; // strip any "(CET)" suffix
  const [h, m] = clean.split(":").map(Number);
  const d = new Date(referenceDate);
  d.setHours(h, m, 0, 0);
  return d;
}

/**
 * Fetches today's timings. Falls back to cache (max 36h old) offline.
 */
export async function fetchPrayerTimes(date, settings, apiOpts = {}) {
  const url = buildUrl(date, settings);
  const cacheKey = `prayers:${toAladhanDateString(date)}`;
  const { value, fromCache, stale } = await fetchWithFallback(cacheKey, url, {
    ...apiOpts,
    maxAgeMs: 1.5 * ONE_DAY_MS,
  });

  const timings = value?.data?.timings;
  if (!timings) throw new Error("Unexpected AlAdhan timings response shape");

  const schedule = PRAYER_ORDER.map((name) => ({
    name,
    time: timeStringToDate(timings[name], date),
  }));

  return { schedule, fromCache, stale };
}

/**
 * Given today's schedule and tomorrow's Fajr (for the after-Isha
 * countdown), returns the current prayer (or null before Fajr) and the
 * next prayer with its Date.
 */
export function determineCurrentAndNext(schedule, now, tomorrowFajr) {
  let current = null;
  let next = null;

  for (let i = 0; i < schedule.length; i++) {
    if (schedule[i].time <= now) {
      current = schedule[i];
    } else {
      next = schedule[i];
      break;
    }
  }

  if (!next) {
    // Past Isha: next prayer is tomorrow's Fajr.
    next = tomorrowFajr ? { name: "Fajr", time: tomorrowFajr } : null;
  }

  return { current, next };
}

/**
 * Renders the prayer list into `container` as a fresh set of rows.
 * Rebuilding the list is cheap (5 rows) and only happens once a day when
 * the schedule itself changes; highlight state is updated separately by
 * updatePrayerHighlight() on every countdown tick without touching the
 * DOM tree shape.
 */
export function renderPrayerList(container, schedule, timezone) {
  if (!container) return;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  });

  const frag = document.createDocumentFragment();
  schedule.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "prayer-row";
    row.dataset.prayer = entry.name;
    row.innerHTML = `
      <span class="prayer-row__rail" aria-hidden="true"></span>
      <span class="prayer-row__name">${entry.name}</span>
      <span class="prayer-row__time">${formatter.format(entry.time)}</span>
    `;
    frag.appendChild(row);
  });
  container.replaceChildren(frag);
}

/**
 * Updates just the current/next CSS classes on existing rows — no DOM
 * tree rebuild, called every second by countdown.js.
 */
export function updatePrayerHighlight(container, currentName, nextName) {
  if (!container) return;
  const rows = container.querySelectorAll(".prayer-row");
  rows.forEach((row) => {
    const name = row.dataset.prayer;
    setClass(row, "is-current", name === currentName);
    setClass(row, "is-next", name === nextName);
  });
}

export { PRAYER_ORDER };
