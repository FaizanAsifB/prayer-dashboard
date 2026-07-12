/**
 * countdown.js
 * ---------------------------------------------------------------------------
 * Responsibility: the live "time until next prayer" countdown, and
 * keeping the current/next prayer highlight in sync as time passes.
 *
 * This intentionally shares the clock's 1-second cadence rather than
 * running its own faster timer — sub-second countdown precision has no
 * user value here and would only cost battery/CPU on the Pi.
 *
 * When the countdown reaches zero, `onPrayerReached` fires once (guarded
 * so it can't fire twice for the same prayer) so app.js can recompute
 * current/next without waiting for the next scheduled data refresh —
 * this is what makes the "highlight current prayer" requirement feel
 * instantaneous rather than laggy.
 */

import { setText } from "./ui.js";

let intervalId = null;
let firedForTarget = null;

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * Starts (or restarts) the countdown toward `getTarget()` — a function
 * rather than a fixed Date so app.js can swap in a new next-prayer
 * target after a prayer transition without tearing the timer down.
 *
 * @param {{label: HTMLElement, value: HTMLElement}} refs
 * @param {() => {name: string, time: Date} | null} getNextPrayer
 * @param {(name: string) => void} onPrayerReached
 */
export function startCountdown(refs, getNextPrayer, onPrayerReached) {
  if (intervalId) clearInterval(intervalId);

  const tick = () => {
    const next = getNextPrayer();
    if (!next) {
      setText(refs.label, "");
      setText(refs.value, "--:--");
      return;
    }

    const remaining = next.time.getTime() - Date.now();
    setText(refs.label, `Until ${next.name}`);
    setText(refs.value, formatDuration(remaining));

    if (remaining <= 0 && firedForTarget !== next.time.getTime()) {
      firedForTarget = next.time.getTime();
      onPrayerReached?.(next.name);
    }
  };

  tick();
  intervalId = setInterval(tick, 1000);
  return () => clearInterval(intervalId);
}

export function stopCountdown() {
  if (intervalId) clearInterval(intervalId);
  intervalId = null;
}
