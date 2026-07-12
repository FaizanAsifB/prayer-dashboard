/**
 * clock.js
 * ---------------------------------------------------------------------------
 * Responsibility: the once-a-second wall clock, weekday label and
 * Gregorian date. This is the highest-frequency timer in the app, so it
 * is written to do as little work as possible per tick:
 *  - a single setInterval (not requestAnimationFrame — the display
 *    doesn't need sub-second precision, and rAF would tie the timer to
 *    the compositor and burn cycles for no visual benefit)
 *  - Intl.DateTimeFormat instances are created once and reused (they are
 *    relatively expensive to construct, cheap to call)
 *  - setText() from ui.js skips the DOM write entirely when the
 *    formatted string hasn't changed (e.g. the date string only changes
 *    once every 86400 ticks)
 *
 * Midnight detection lives here because the clock already knows the
 * current date every second — cheaper than a separate timer computing
 * ms-until-midnight and re-arming itself.
 */

import { setText } from "./ui.js";

let timeFormatter;
let weekdayFormatter;
let dateFormatter;
let lastDateKey = null;
let onMidnight = null;
let intervalId = null;

function dateKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function tick(refs) {
  const now = new Date();

  setText(refs.time, timeFormatter.format(now));
  setText(refs.weekday, weekdayFormatter.format(now));
  setText(refs.date, dateFormatter.format(now));

  const key = dateKey(now);
  if (lastDateKey !== null && key !== lastDateKey && typeof onMidnight === "function") {
    onMidnight(now);
  }
  lastDateKey = key;
}

/**
 * Starts the clock.
 * @param {{time: HTMLElement, weekday: HTMLElement, date: HTMLElement}} refs
 * @param {{timezone: string, intervalMs?: number, onDateChange?: (d: Date) => void}} options
 */
export function startClock(refs, { timezone, intervalMs = 1000, onDateChange } = {}) {
  timeFormatter = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: timezone,
  });
  weekdayFormatter = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: timezone });
  dateFormatter = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: timezone,
  });

  onMidnight = onDateChange;
  lastDateKey = dateKey(new Date());

  tick(refs);
  if (intervalId) clearInterval(intervalId);
  intervalId = setInterval(() => tick(refs), intervalMs);
  return () => clearInterval(intervalId);
}
