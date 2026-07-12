/**
 * hijri.js
 * ---------------------------------------------------------------------------
 * Responsibility: Hijri (Islamic) date + Islamic month name via the
 * AlAdhan "Gregorian to Hijri" endpoint, plus a locally-computed moon
 * phase (no network call — a synodic-month approximation is more than
 * accurate enough for a decorative icon, and it means the moon phase
 * still updates correctly even if the device is offline for days).
 *
 * Refresh cadence: once per day (see app.js scheduling), matching the
 * requirement list. The Hijri date does not need second- or minute-level
 * precision.
 */

import { fetchWithFallback } from "./api.js";

const ALADHAN_BASE = "https://api.aladhan.com/v1";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Formats a JS Date as DD-MM-YYYY, the format AlAdhan's gToH expects. */
function toAladhanDateString(date) {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

/**
 * Fetches today's Hijri date. Falls back to cached data (up to 2 days
 * old — Hijri dates don't shift often enough for this to matter) when
 * offline.
 */
export async function fetchHijriDate(date = new Date(), { attempts, delayMs } = {}) {
  const dateStr = toAladhanDateString(date);
  const url = `${ALADHAN_BASE}/gToH/${dateStr}`;
  const { value, fromCache, stale } = await fetchWithFallback(
    `hijri:${dateStr.slice(3)}`, // cache keyed by month-year so it survives a day-of-month rollover lookup
    url,
    { attempts, delayMs, maxAgeMs: 2 * ONE_DAY_MS }
  );

  const h = value?.data?.hijri;
  if (!h) throw new Error("Unexpected AlAdhan gToH response shape");

  return {
    day: h.day,
    monthNumber: Number(h.month?.number ?? 0),
    monthNameArabic: h.month?.ar ?? "",
    monthNameEnglish: h.month?.en ?? "",
    year: h.year,
    formatted: `${h.day} ${h.month?.en ?? ""} ${h.year} AH`,
    fromCache,
    stale,
  };
}

/**
 * Approximates the current moon phase as a fraction in [0, 1) where
 * 0 = new moon, 0.5 = full moon, using the standard synodic-month
 * epoch method. Accurate to roughly half a day, which is plenty for a
 * glanceable icon.
 */
export function computeMoonPhase(date = new Date()) {
  const synodicMonth = 29.530588853; // days
  // A known new moon reference: 6 Jan 2000, 18:14 UTC.
  const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14, 0);
  const daysSince = (date.getTime() - knownNewMoon) / ONE_DAY_MS;
  const phase = (daysSince % synodicMonth) / synodicMonth;
  return phase < 0 ? phase + 1 : phase;
}

/** Human-readable label for a moon phase fraction. */
export function moonPhaseLabel(phase) {
  const stops = [
    [0.0625, "New Moon"],
    [0.1875, "Waxing Crescent"],
    [0.3125, "First Quarter"],
    [0.4375, "Waxing Gibbous"],
    [0.5625, "Full Moon"],
    [0.6875, "Waning Gibbous"],
    [0.8125, "Last Quarter"],
    [0.9375, "Waning Crescent"],
  ];
  for (const [threshold, label] of stops) {
    if (phase < threshold) return label;
  }
  return "New Moon";
}
