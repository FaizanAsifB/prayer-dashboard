/**
 * prayers.js
 * ---------------------------------------------------------------------------
 * Responsibility: read prayer times from the LOCAL manually-maintained
 * timetable at data/prayer-timings.json, determine current/next prayer,
 * and dynamically render the prayer list.
 *
 * Why local instead of AlAdhan: standard calculation methods (angle-
 * based Fajr/Isha) break down at high latitudes in summer (e.g. Sweden),
 * where the sun never dips far enough below the horizon for the angle
 * to resolve — this is precisely the "custom implementation" case this
 * file now exists to support. Rather than fight calculation methods,
 * the source of truth is now a plain JSON file of exact clock times per
 * date, edited by hand (e.g. copied from a local mosque's published
 * timetable) and committed to the repo like any other config.
 *
 * Refresh cadence: still once per day (see app.js) — the file itself
 * doesn't change during a session, but "today's entry" does at
 * midnight. The whole file is fetched once per session and cached in
 * memory since it's small (a year of entries is well under 100KB of
 * JSON) and part of the precached app shell, so there's no repeated
 * network cost to re-reading it.
 */

import { setClass } from "./ui.js";

const TIMINGS_URL = "data/prayer-timings.json";

// Keys as they appear in prayer-timings.json (lowercase) mapped to the
// display name used everywhere else in the UI. Order here also defines
// row order and current/next progression through the day.
const PRAYER_KEYS = [
  { key: "fajr", name: "Fajr" },
  { key: "dhuhr", name: "Dhuhr" },
  { key: "asr", name: "Asr" },
  { key: "maghrib", name: "Maghrib" },
  { key: "isha", name: "Isha" },
];

const PRAYER_ORDER = PRAYER_KEYS.map((p) => p.name);

let timingsFilePromise = null;

/** Loads and memoizes the whole timings file for the session. */
function loadTimingsFile() {
  if (!timingsFilePromise) {
    timingsFilePromise = fetch(TIMINGS_URL, { cache: "no-cache" })
      .then((res) => {
        if (!res.ok)
          throw new Error(`prayer-timings.json responded ${res.status}`);
        return res.json();
      })
      .catch((err) => {
        // Don't leave a rejected promise memoized — allow a later retry
        // (e.g. once connectivity/service-worker cache recovers).
        timingsFilePromise = null;
        throw err;
      });
  }
  return timingsFilePromise;
}

/** Formats a Date as the "YYYY-MM-DD" key used in prayer-timings.json. */
function dateKey(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Parses an "HH:MM" string onto the Y/M/D of `referenceDate`. */
function timeStringToDate(timeStr, referenceDate) {
  const [h, m] = timeStr.split(":").map(Number);
  const d = new Date(referenceDate);
  d.setHours(h, m, 0, 0);
  return d;
}

/**
 * Looks up the entry for `date`. If the exact date is missing from the
 * file (e.g. the timetable hasn't been extended into next year yet),
 * falls back to the closest earlier date within 7 days so the dashboard
 * degrades gracefully instead of breaking outright — the times will be
 * approximate but the app keeps functioning until the file is updated.
 */
function findEntry(allTimings, date) {
  for (let offset = 0; offset <= 7; offset++) {
    const probe = new Date(date);
    probe.setDate(probe.getDate() - offset);
    const key = dateKey(probe);
    if (allTimings[key]) {
      return { entry: allTimings[key], usedDate: probe, exact: offset === 0 };
    }
  }
  return null;
}

/**
 * Returns today's (or the nearest available) schedule as
 * { schedule, fromCache: false, stale: !exact }.
 * `stale` here is repurposed to mean "approximated from an earlier
 * date's entry" so the UI's existing stale-data styling communicates
 * "this timetable needs updating" for free.
 */
export async function fetchPrayerTimes(date /*, settings, apiOpts */) {
  const allTimings = await loadTimingsFile();
  const found = findEntry(allTimings, date);

  if (!found) {
    throw new Error(
      `No prayer timings found for ${dateKey(date)} (or the 7 days before it) in prayer-timings.json`,
    );
  }

  const schedule = PRAYER_KEYS.map(({ key, name }) => ({
    name,
    time: timeStringToDate(found.entry[key], date),
  }));

  return { schedule, fromCache: false, stale: !found.exact };
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
