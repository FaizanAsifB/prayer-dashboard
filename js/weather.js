/**
 * weather.js
 * ---------------------------------------------------------------------------
 * Responsibility: talk to Open-Meteo (free, no API key) and render the
 * weather card — current temperature, description, icon, sunrise/sunset,
 * and a short next-few-hours forecast strip.
 *
 * Refresh cadence: every 30 minutes (see app.js), which comfortably
 * covers Open-Meteo's own model update frequency without hammering the
 * API from a device that's on 24/7.
 *
 * Rendering is intentionally imperative DOM surgery rather than
 * re-building the card's innerHTML on every refresh: the card's
 * structure never changes shape, only text/attribute values, so
 * targeted updates via ui.js's write-if-changed helpers keep reflow
 * cost near zero.
 */

import { fetchWithFallback } from "./api.js";
import { setText, weatherCodeToIcon, weatherCodeToDescription } from "./ui.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

function buildUrl({ latitude, longitude, units }) {
  const tempUnit = units === "imperial" ? "fahrenheit" : "celsius";
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "temperature_2m,weather_code,is_day",
    hourly: "temperature_2m,weather_code",
    daily: "sunrise,sunset",
    temperature_unit: tempUnit,
    timezone: "auto",
    forecast_days: "1",
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

function formatHour(isoString, timezone) {
  return new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: timezone }).format(
    new Date(isoString)
  );
}

function formatClock(isoString, timezone) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).format(new Date(isoString));
}

/**
 * Fetches weather data with retry + offline fallback to last-cached
 * reading (marked stale after 3 hours so the UI can visually flag it).
 */
export async function fetchWeather(settings, apiOpts = {}) {
  const { location, weather } = settings;
  const url = buildUrl({ latitude: location.latitude, longitude: location.longitude, units: weather.units });
  const { value, fromCache, stale } = await fetchWithFallback("weather", url, {
    ...apiOpts,
    maxAgeMs: 3 * ONE_HOUR_MS,
  });
  return { data: value, fromCache, stale };
}

/**
 * Renders the weather payload into the DOM. Accepts pre-fetched refs so
 * app.js controls when/how often the query selectors run.
 */
export function renderWeather(refs, payload, timezone) {
  const { data, stale } = payload;
  if (!data?.current) {
    setText(refs.description, "Weather unavailable");
    return;
  }

  const { temperature_2m, weather_code, is_day } = data.current;
  const unitSuffix = data.current_units?.temperature_2m ?? "°C";

  setText(refs.temperature, `${Math.round(temperature_2m)}${unitSuffix}`);
  setText(refs.description, weatherCodeToDescription(weather_code));
  refs.icon.innerHTML = weatherCodeToIcon(weather_code, is_day);

  if (data.daily?.sunrise?.[0]) setText(refs.sunrise, formatClock(data.daily.sunrise[0], timezone));
  if (data.daily?.sunset?.[0]) setText(refs.sunset, formatClock(data.daily.sunset[0], timezone));

  renderForecastStrip(refs.forecastStrip, data, timezone);

  refs.card?.classList.toggle("is-stale", Boolean(stale));
}

/**
 * Builds the "next few hours" strip. Rebuilt fully on each 30-minute
 * refresh (cheap: ~6 small nodes) rather than diffed, since it changes
 * shape (which hours are shown) every refresh anyway.
 */
function renderForecastStrip(container, data, timezone) {
  if (!container || !data.hourly?.time) return;

  const nowIso = new Date().toISOString();
  const startIndex = data.hourly.time.findIndex((t) => t >= nowIso);
  const from = startIndex === -1 ? 0 : startIndex;
  const slice = data.hourly.time.slice(from, from + 5);

  const frag = document.createDocumentFragment();
  slice.forEach((iso, i) => {
    const idx = from + i;
    const temp = Math.round(data.hourly.temperature_2m[idx]);
    const code = data.hourly.weather_code[idx];

    const item = document.createElement("div");
    item.className = "forecast-item";
    item.innerHTML = `
      <span class="forecast-item__hour">${formatHour(iso, timezone)}</span>
      <span class="forecast-item__icon">${weatherCodeToIcon(code, 1)}</span>
      <span class="forecast-item__temp">${temp}°</span>
    `;
    frag.appendChild(item);
  });

  container.replaceChildren(frag);
}
