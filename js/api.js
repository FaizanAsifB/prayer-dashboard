/**
 * api.js
 * ---------------------------------------------------------------------------
 * Responsibility: everything that touches the network or the persistent
 * cache lives here. Feature modules (weather.js, prayers.js, hijri.js)
 * never call fetch() directly — they call fetchJson()/cacheRead()/
 * cacheWrite() so retry logic, timeouts and offline fallbacks are
 * consistent across the whole app instead of being re-implemented three
 * times with three different bugs.
 *
 * Design notes for the Pi Zero 2 W target:
 *  - AbortController enforces a hard timeout so a stalled request never
 *    leaves a spinner running forever on a flaky Wi-Fi connection.
 *  - Retries use a short linear backoff (not exponential) because we'd
 *    rather fail fast and fall back to cached data than block the UI
 *    thread's event loop with long waits on a single-core-constrained
 *    device.
 *  - The cache lives in localStorage (not IndexedDB) deliberately: the
 *    payloads are tiny (a few KB of JSON), and localStorage's synchronous
 *    API avoids the overhead of IndexedDB's async machinery on a very
 *    memory constrained board.
 */

const DEFAULT_TIMEOUT_MS = 10000;
const CACHE_PREFIX = "dashboard:cache:";

/**
 * Fetches JSON with a timeout and a small number of retries.
 * @param {string} url
 * @param {{attempts?: number, delayMs?: number, timeoutMs?: number}} opts
 */
export async function fetchJson(url, opts = {}) {
  const attempts = opts.attempts ?? 3;
  const delayMs = opts.delayMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt < attempts) {
        await sleep(delayMs);
      }
    }
  }
  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reads a cached payload. Returns { value, timestamp, stale } or null if
 * nothing was ever cached under this key. "stale" is true once the entry
 * is older than maxAgeMs, but the value is still returned — callers
 * decide whether stale-but-present data is good enough (it always is
 * when the alternative is an empty UI).
 */
export function cacheRead(key, maxAgeMs) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const stale = Date.now() - parsed.timestamp > maxAgeMs;
    return { value: parsed.value, timestamp: parsed.timestamp, stale };
  } catch (err) {
    console.warn(`[api] Cache read failed for "${key}":`, err);
    return null;
  }
}

/** Writes a value to the cache with the current timestamp. */
export function cacheWrite(key, value) {
  try {
    localStorage.setItem(
      CACHE_PREFIX + key,
      JSON.stringify({ value, timestamp: Date.now() })
    );
  } catch (err) {
    // Quota exceeded or storage disabled — non-fatal, dashboard just
    // loses offline resilience for this key.
    console.warn(`[api] Cache write failed for "${key}":`, err);
  }
}

/**
 * High-level helper used by feature modules: try the network first
 * (cache-first would risk showing minutes-old weather when we're
 * actually online), fall back to cache on any failure, and always
 * persist a fresh success to cache for the next offline stretch.
 */
export async function fetchWithFallback(key, url, { attempts, delayMs, maxAgeMs = Infinity } = {}) {
  try {
    const value = await fetchJson(url, { attempts, delayMs });
    cacheWrite(key, value);
    return { value, fromCache: false };
  } catch (err) {
    const cached = cacheRead(key, maxAgeMs);
    if (cached) {
      console.warn(`[api] Network failed for "${key}", serving cached data:`, err.message);
      return { value: cached.value, fromCache: true, stale: cached.stale };
    }
    throw err;
  }
}
