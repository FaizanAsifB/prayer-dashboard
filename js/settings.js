/**
 * settings.js
 * ---------------------------------------------------------------------------
 * Responsibility: load the static configuration file (data/settings.json)
 * once, optionally overlay any user overrides stored in localStorage
 * (so the dashboard can be re-tuned from a debug console without editing
 * files on the Pi's SD card), and hand back a single frozen settings object.
 *
 * Why a dedicated module: every other module (weather, prayers, hijri,
 * app) needs the same settings object. Centralising the load means the
 * JSON file is fetched exactly once per session and every consumer sees
 * an identical, immutable snapshot — avoiding subtle bugs where one
 * module reads stale config after a runtime override and another doesn't.
 */

const SETTINGS_URL = "data/settings.json";
const OVERRIDE_KEY = "dashboard:settings:overrides";

let cachedSettings = null;

/**
 * Deep-merge helper limited to plain objects (arrays/primitives are
 * replaced, not merged). Sufficient for our flat-ish settings shape and
 * avoids pulling in a dependency for one small utility.
 */
function mergeDeep(base, overrides) {
  if (!overrides || typeof overrides !== "object") return base;
  const out = { ...base };
  for (const key of Object.keys(overrides)) {
    const baseVal = base[key];
    const overrideVal = overrides[key];
    if (
      baseVal &&
      overrideVal &&
      typeof baseVal === "object" &&
      typeof overrideVal === "object" &&
      !Array.isArray(baseVal) &&
      !Array.isArray(overrideVal)
    ) {
      out[key] = mergeDeep(baseVal, overrideVal);
    } else {
      out[key] = overrideVal;
    }
  }
  return out;
}

function readOverrides() {
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    // Corrupt override data must never break the dashboard.
    return null;
  }
}

/**
 * Loads settings.json (network/disk) and merges local overrides.
 * Falls back to a minimal built-in default if the JSON file itself is
 * unreachable, so the app can still render something rather than fail
 * outright on a corrupted deployment.
 */
export async function loadSettings() {
  if (cachedSettings) return cachedSettings;

  let base;
  try {
    const res = await fetch(SETTINGS_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error(`settings.json responded ${res.status}`);
    base = await res.json();
  } catch (err) {
    console.warn("[settings] Falling back to built-in defaults:", err);
    base = {
      location: { name: "Unknown", latitude: 21.4225, longitude: 39.8262, timezone: "Asia/Riyadh" },
      prayer: { method: 4, madhab: 0, tune: "" },
      weather: { units: "metric" },
      app: {
        clockIntervalMs: 1000,
        weatherRefreshMinutes: 30,
        prayerRefreshHours: 24,
        quoteRotationSeconds: 45,
        cacheVersion: "v1",
        apiRetryAttempts: 3,
        apiRetryDelayMs: 2000,
      },
      quotes: [{ text: "And He found you lost and guided you.", source: "Qur'an 93:7" }],
    };
  }

  const merged = mergeDeep(base, readOverrides());
  cachedSettings = Object.freeze(merged);
  return cachedSettings;
}

/**
 * Synchronous accessor for modules that run after bootstrap and can
 * assume settings are already loaded (enforced by app.js ordering).
 */
export function getSettings() {
  if (!cachedSettings) {
    throw new Error("[settings] getSettings() called before loadSettings() resolved");
  }
  return cachedSettings;
}

/**
 * Persists a partial override so it survives reloads. Intended for a
 * future settings UI; kept here so the storage format stays in one file.
 */
export function saveOverrides(partial) {
  try {
    const existing = readOverrides() || {};
    const next = mergeDeep(existing, partial);
    localStorage.setItem(OVERRIDE_KEY, JSON.stringify(next));
  } catch (err) {
    console.warn("[settings] Could not persist overrides:", err);
  }
}
