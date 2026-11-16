// Real forecast from Open-Meteo (free, no key). Used to steer outdoor vs indoor
// and to flag rain during outdoor stops. If it fails we continue without it and
// say so: weather is an enhancer, never a hard dependency.

import type { HourWeather, WeatherSummary } from "../types";

const CODES: Record<number, string> = {
  0: "clear",
  1: "mostly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "fog",
  51: "light drizzle",
  53: "drizzle",
  55: "heavy drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  80: "rain showers",
  81: "rain showers",
  82: "violent showers",
  95: "thunderstorm",
  96: "thunderstorm",
  99: "thunderstorm",
};

export async function getWeather(lat: number, lon: number, date: string): Promise<WeatherSummary> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: "temperature_2m,precipitation_probability,weather_code",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
    timezone: "auto",
    start_date: date,
    end_date: date,
  });
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    const hours: HourWeather[] = (d.hourly?.time ?? []).map((t: string, i: number) => ({
      hour: t.slice(11, 16),
      temp_c: Math.round(d.hourly.temperature_2m[i]),
      rain_prob: d.hourly.precipitation_probability[i] ?? 0,
      code: d.hourly.weather_code[i] ?? 0,
    }));
    const max = Math.round(d.daily.temperature_2m_max[0]);
    const min = Math.round(d.daily.temperature_2m_min[0]);
    const rain = d.daily.precipitation_probability_max[0] ?? 0;
    const desc = CODES[d.daily.weather_code[0]] ?? "mixed";
    const wetHours = hours.filter((h) => h.rain_prob >= 50 && h.hour >= "08:00" && h.hour <= "22:00").map((h) => h.hour);
    const wetText = wetHours.length
      ? ` Rain likely around ${wetHours[0]}${wetHours.length > 1 ? `-${wetHours[wetHours.length - 1]}` : ""}.`
      : " No rain expected during the day.";
    return {
      date,
      source: "open-meteo",
      summary: `${desc}, ${min}-${max}°C, max rain chance ${rain}%.${wetText}`,
      max_c: max,
      min_c: min,
      max_rain_prob: rain,
      hours,
    };
  } catch (e) {
    return {
      date,
      source: "unavailable",
      summary: `Forecast unavailable (${(e as Error).message}); plan assumes typical weather and includes an indoor Plan B.`,
      hours: [],
    };
  }
}

export function rainAt(weather: WeatherSummary | null, startMin: number, endMin: number): number {
  if (!weather || weather.hours.length === 0) return 0;
  let max = 0;
  for (const h of weather.hours) {
    const m = Number(h.hour.slice(0, 2)) * 60;
    if (m + 60 > startMin && m < endMin) max = Math.max(max, h.rain_prob);
  }
  return max;
}
