/**
 * ui.js
 * ---------------------------------------------------------------------------
 * Responsibility: low-level DOM helpers shared by every feature module.
 * Nothing here knows about weather, prayers, or clocks — it only knows
 * how to touch the DOM cheaply.
 *
 * Performance rationale (important on a Pi Zero 2 W's single usable
 * core): the biggest cost of a "dumb" dashboard that re-renders on every
 * tick is layout thrashing — writing to textContent/innerHTML even when
 * the value hasn't changed still triggers style recalculation. setText()
 * below short-circuits when the value is identical, which matters a lot
 * for the once-a-second clock tick.
 *
 * Icons are generated as inline SVG strings rather than shipped as
 * separate .svg files: at kiosk scale (a couple dozen possible icons)
 * inlining costs a few KB of JS but saves dozens of extra HTTP requests
 * and file-system reads on a board where I/O, not CPU, is often the
 * bottleneck.
 */

/** Shorthand querySelector scoped to document (or a given root). */
export function qs(selector, root = document) {
  return root.querySelector(selector);
}

/**
 * Writes text content only if it differs from the current value.
 * Avoids unnecessary style/layout recalculation on high-frequency
 * updates like the clock.
 */
export function setText(el, value) {
  if (!el) return;
  if (el.textContent !== value) el.textContent = value;
}

/** Toggles a class only if its current state differs from `on`. */
export function setClass(el, className, on) {
  if (!el) return;
  const has = el.classList.contains(className);
  if (has !== on) el.classList.toggle(className, on);
}

/** Sets an attribute only if the value differs, same rationale as setText. */
export function setAttr(el, name, value) {
  if (!el) return;
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

/**
 * Builds a DOM element tree from a plain description without using
 * innerHTML (avoids re-parsing HTML strings on every render and keeps
 * us safe from injecting unexpected markup from API text fields).
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("data-")) node.setAttribute(key, value);
    else node[key] = value;
  }
  for (const child of children) {
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

/* --------------------------------------------------------------------- */
/* Weather icons (Open-Meteo WMO weather codes -> inline SVG)            */
/* --------------------------------------------------------------------- */

const STROKE = "currentColor";

function svg(inner, viewBox = "0 0 48 48") {
  return `<svg viewBox="${viewBox}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">${inner}</svg>`;
}

const ICON_SUN = svg(
  `<circle cx="24" cy="24" r="9" stroke="${STROKE}" stroke-width="2.5"/>
   <g stroke="${STROKE}" stroke-width="2.5" stroke-linecap="round">
     <path d="M24 4v6M24 38v6M44 24h-6M10 24H4M37.5 10.5l-4.2 4.2M14.7 33.3l-4.2 4.2M37.5 37.5l-4.2-4.2M14.7 14.7l-4.2-4.2"/>
   </g>`
);

const ICON_CLOUD = svg(
  `<path d="M14 34a8 8 0 1 1 1.6-15.85A10 10 0 0 1 35 20.2 7 7 0 0 1 34 34H14Z"
     stroke="${STROKE}" stroke-width="2.5" stroke-linejoin="round"/>`
);

const ICON_PARTLY_CLOUDY = svg(
  `<path d="M16 21a7 7 0 0 1 6.7 9.1" stroke="${STROKE}" stroke-width="2.5" stroke-linecap="round"/>
   <circle cx="16" cy="16" r="6" stroke="${STROKE}" stroke-width="2.5"/>
   <path d="M18 36a8 8 0 1 1 1.6-15.85A10 10 0 0 1 39 22.2 7 7 0 0 1 38 36H18Z"
     stroke="${STROKE}" stroke-width="2.5" stroke-linejoin="round"/>`
);

const ICON_RAIN = svg(
  `<path d="M14 26a8 8 0 1 1 1.6-15.85A10 10 0 0 1 35 12.2 7 7 0 0 1 34 26H14Z"
     stroke="${STROKE}" stroke-width="2.5" stroke-linejoin="round"/>
   <g stroke="${STROKE}" stroke-width="2.5" stroke-linecap="round">
     <path d="M17 32l-2 6M25 32l-2 6M33 32l-2 6"/>
   </g>`
);

const ICON_SNOW = svg(
  `<path d="M14 24a8 8 0 1 1 1.6-15.85A10 10 0 0 1 35 10.2 7 7 0 0 1 34 24H14Z"
     stroke="${STROKE}" stroke-width="2.5" stroke-linejoin="round"/>
   <g stroke="${STROKE}" stroke-width="2.5" stroke-linecap="round">
     <path d="M18 32v8M18 32l-3.5 2M18 32l3.5 2M18 36l-3.5 2M18 36l3.5 2"/>
     <path d="M30 32v8M30 32l-3.5 2M30 32l3.5 2M30 36l-3.5 2M30 36l3.5 2"/>
   </g>`
);

const ICON_STORM = svg(
  `<path d="M14 22a8 8 0 1 1 1.6-15.85A10 10 0 0 1 35 8.2 7 7 0 0 1 34 22H14Z"
     stroke="${STROKE}" stroke-width="2.5" stroke-linejoin="round"/>
   <path d="M25 26l-6 10h5l-3 8 9-11h-5l3-7Z" stroke="${STROKE}" stroke-width="2.5" stroke-linejoin="round"/>`
);

const ICON_FOG = svg(
  `<g stroke="${STROKE}" stroke-width="2.5" stroke-linecap="round">
     <path d="M8 18h32M6 24h36M8 30h32M10 36h28"/>
   </g>`
);

const ICON_NIGHT_CLEAR = svg(
  `<path d="M30 6a16 16 0 1 0 12 26.4A13 13 0 0 1 30 6Z" stroke="${STROKE}" stroke-width="2.5" stroke-linejoin="round"/>`
);

/**
 * Maps an Open-Meteo WMO weather code (+ optional is-day flag) to an
 * inline SVG icon and a short human-readable description.
 * Reference: https://open-meteo.com/en/docs (WMO Weather interpretation codes)
 */
export function weatherCodeToIcon(code, isDay = 1) {
  if (code === 0) return isDay ? ICON_SUN : ICON_NIGHT_CLEAR;
  if ([1, 2].includes(code)) return ICON_PARTLY_CLOUDY;
  if (code === 3) return ICON_CLOUD;
  if ([45, 48].includes(code)) return ICON_FOG;
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return ICON_RAIN;
  if ([71, 73, 75, 77, 85, 86].includes(code)) return ICON_SNOW;
  if ([95, 96, 99].includes(code)) return ICON_STORM;
  return ICON_CLOUD;
}

const WEATHER_DESCRIPTIONS = {
  0: "Clear sky",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Dense drizzle",
  56: "Freezing drizzle",
  57: "Freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Light showers",
  81: "Showers",
  82: "Violent showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Severe thunderstorm",
};

export function weatherCodeToDescription(code) {
  return WEATHER_DESCRIPTIONS[code] ?? "Unknown";
}

/* --------------------------------------------------------------------- */
/* Moon phase icon (used by hijri.js)                                    */
/* --------------------------------------------------------------------- */

/**
 * Renders a simple moon phase disc using a clipped overlay approach:
 * a light "illuminated" circle and a dark "shadow" ellipse whose width
 * is driven by the phase fraction (0 = new moon, 0.5 = full, 1 = new).
 * This avoids shipping 8 separate bitmap phase icons.
 */
export function moonPhaseIcon(phaseFraction) {
  // phaseFraction: 0..1 where 0/1 = new moon, 0.5 = full moon
  const illumination = 1 - Math.abs(phaseFraction - 0.5) * 2; // 0..1
  const waxing = phaseFraction < 0.5;
  const rx = 12 * (1 - illumination);
  const shadowSide = waxing ? -1 : 1;
  return svg(
    `<circle cx="24" cy="24" r="12" fill="${STROKE}" opacity="0.18"/>
     <path d="M24 12a12 12 0 0 1 0 24 12 12 0 0 0 0-24Z" fill="${STROKE}"/>
     <ellipse cx="${24 + shadowSide * (12 - rx)}" cy="24" rx="${rx}" ry="12" fill="var(--color-bg)"/>`,
    "0 0 48 48"
  );
}
