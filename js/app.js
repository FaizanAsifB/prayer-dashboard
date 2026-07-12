/**
 * app.js
 * ---------------------------------------------------------------------------
 * Responsibility: bootstrap and scheduling ONLY. Every feature module is
 * self-contained (fetch + render for its own domain); app.js's job is to
 * decide *when* each of those runs and to wire their outputs together
 * (e.g. countdown.js needs to know the "next prayer" that prayers.js
 * computed).
 *
 * Timer strategy (matters a lot on a Pi Zero 2 W, which has no CPU to
 * spare): we run exactly three intervals for the whole app —
 *   1. the clock (1s) — also drives the countdown and midnight detection
 *   2. weather refresh (30 min)
 *   3. quote rotation (configurable, default 45s, CSS-animated fade)
 * Prayer/Hijri data refreshes are NOT on their own interval; they are
 * triggered once at boot and then again only when the clock module
 * reports a real calendar-day rollover (onDateChange) or when the
 * countdown reports we've just passed the last prayer of the day. This
 * avoids a 4th long-lived timer and keeps the "once per day" requirement
 * exact rather than approximate.
 */

import { loadSettings } from "./settings.js";
import { qs, setText, moonPhaseIcon } from "./ui.js";
import { startClock } from "./clock.js";
import { fetchWeather, renderWeather } from "./weather.js";
import {
  fetchPrayerTimes,
  renderPrayerList,
  updatePrayerHighlight,
  determineCurrentAndNext,
} from "./prayers.js";
import { startCountdown } from "./countdown.js";
import { fetchHijriDate, computeMoonPhase, moonPhaseLabel } from "./hijri.js";

/** Central place for every DOM reference the app touches, queried once. */
function collectRefs() {
  return {
    clock: {
      time: qs("#clock-time"),
      weekday: qs("#clock-weekday"),
      date: qs("#clock-date"),
    },
    hijri: {
      date: qs("#hijri-date"),
      moonIcon: qs("#moon-icon"),
      moonLabel: qs("#moon-label"),
    },
    weather: {
      card: qs("#weather-card"),
      temperature: qs("#weather-temperature"),
      description: qs("#weather-description"),
      icon: qs("#weather-icon"),
      sunrise: qs("#weather-sunrise"),
      sunset: qs("#weather-sunset"),
      forecastStrip: qs("#weather-forecast-strip"),
    },
    prayers: {
      list: qs("#prayer-list"),
    },
    countdown: {
      label: qs("#countdown-label"),
      value: qs("#countdown-value"),
    },
    quote: {
      text: qs("#quote-text"),
      source: qs("#quote-source"),
    },
    status: qs("#connection-status"),
  };
}

/** Mutable app state that ties the modules together. */
const state = {
  todaySchedule: [],
  tomorrowFajr: null,
  currentPrayer: null,
  nextPrayer: null,
};

async function refreshWeather(refs, settings) {
  try {
    const payload = await fetchWeather(settings, {
      attempts: settings.app.apiRetryAttempts,
      delayMs: settings.app.apiRetryDelayMs,
    });
    renderWeather(refs.weather, payload, settings.location.timezone);
  } catch (err) {
    console.error("[app] Weather unavailable (no network and no cache):", err);
    setText(refs.weather.description, "Weather unavailable");
  }
}

async function refreshPrayers(refs, settings, baseDate = new Date()) {
  try {
    // Local file read (part of the precached app shell) — no retry
    // options needed since there's no flaky network call involved.
    const [today, tomorrow] = await Promise.all([
      fetchPrayerTimes(baseDate),
      fetchPrayerTimes(addDays(baseDate, 1)),
    ]);

    state.todaySchedule = today.schedule;
    state.tomorrowFajr =
      tomorrow.schedule.find((p) => p.name === "Fajr")?.time ?? null;

    renderPrayerList(
      refs.prayers.list,
      state.todaySchedule,
      settings.location.timezone,
    );
    recomputeCurrentNext(refs);

    // Flag the card if we had to fall back to an earlier date's entry
    // (prayer-timings.json hasn't been extended to cover today yet).
    refs.prayers.list
      ?.closest(".card")
      ?.classList.toggle("is-stale", Boolean(today.stale));
  } catch (err) {
    console.error(
      "[app] Prayer times unavailable — check data/prayer-timings.json:",
      err,
    );
  }
}

async function refreshHijri(refs, settings, baseDate = new Date()) {
  try {
    const hijri = await fetchHijriDate(baseDate, {
      attempts: settings.app.apiRetryAttempts,
      delayMs: settings.app.apiRetryDelayMs,
    });
    setText(refs.hijri.date, hijri.formatted);
  } catch (err) {
    console.error("[app] Hijri date unavailable:", err);
    setText(refs.hijri.date, "");
  }

  // Moon phase is computed locally, so it never fails offline.
  const phase = computeMoonPhase(baseDate);
  if (refs.hijri.moonIcon) refs.hijri.moonIcon.innerHTML = moonPhaseIcon(phase);
  setText(refs.hijri.moonLabel, moonPhaseLabel(phase));
}

function recomputeCurrentNext(refs) {
  const { current, next } = determineCurrentAndNext(
    state.todaySchedule,
    new Date(),
    state.tomorrowFajr,
  );
  state.currentPrayer = current;
  state.nextPrayer = next;
  updatePrayerHighlight(
    refs.prayers.list,
    current?.name ?? null,
    next?.name ?? null,
  );
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

/** Rotates through settings.quotes with a CSS-driven fade (see animations.css). */
function startQuoteRotation(refs, quotes, seconds) {
  if (!quotes?.length) return;
  let index = 0;

  const render = () => {
    const q = quotes[index % quotes.length];
    refs.quote.text?.classList.add("is-fading");
    // Swap content after the fade-out transition, then fade back in.
    // The timeout duration is matched to --duration-medium in variables.css.
    setTimeout(() => {
      setText(refs.quote.text, q.text);
      setText(refs.quote.source, q.source);
      refs.quote.text?.classList.remove("is-fading");
    }, 400);
    index++;
  };

  render();
  setInterval(render, Math.max(10, seconds) * 1000);
}

function watchConnectivity(refs) {
  const update = () => {
    refs.status?.classList.toggle("is-offline", !navigator.onLine);
  };
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.warn("[app] Service worker registration failed:", err);
    });
  });
}

async function bootstrap() {
  const settings = await loadSettings();
  const refs = collectRefs();

  watchConnectivity(refs);
  registerServiceWorker();

  // Initial data load — order doesn't matter, run concurrently.
  await Promise.all([
    refreshWeather(refs, settings),
    refreshPrayers(refs, settings),
    refreshHijri(refs, settings),
  ]);

  // Clock: 1s tick, also detects midnight rollover.
  startClock(refs.clock, {
    timezone: settings.location.timezone,
    intervalMs: settings.app.clockIntervalMs,
    onDateChange: () => {
      // A new calendar day has begun — refresh everything that's dated.
      refreshPrayers(refs, settings);
      refreshHijri(refs, settings);
    },
  });

  // Countdown: shares the 1s cadence, reads/writes shared `state`.
  startCountdown(
    refs.countdown,
    () => state.nextPrayer,
    () => {
      // We just crossed a prayer time boundary — recompute highlight
      // immediately rather than waiting up to a day for fresh data.
      recomputeCurrentNext(refs);
    },
  );
  // Keep the highlight correct on every tick too (cheap: class toggles only).
  setInterval(() => recomputeCurrentNext(refs), 1000);

  // Weather: every N minutes per settings.
  setInterval(
    () => refreshWeather(refs, settings),
    settings.app.weatherRefreshMinutes * 60 * 1000,
  );

  // Rotating reminders/quotes.
  startQuoteRotation(refs, settings.quotes, settings.app.quoteRotationSeconds);
}

bootstrap().catch((err) => {
  // If bootstrap itself fails (e.g. settings.json missing), fail loudly
  // in the console but leave whatever static markup exists visible
  // rather than throwing a blank screen at whoever walks past the kiosk.
  console.error("[app] Fatal bootstrap error:", err);
});
