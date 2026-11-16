// ChatGPT's ideas of things to do in each city of the trip, kept on this device (like the pasted answers). With an API key
// they're asked for by themselves: for every city on the route just after an itinerary is chosen, and otherwise the first
// time a city is opened in the City planner. Each request lists what the plan already has there, so the ideas add to it.

import { useSyncExternalStore } from "react";
import { db } from "../db";
import type { Settings } from "../types";
import { cityIdeasPrompt, parseCityIdeas } from "./ai";
import { aiReady, askAI, getAiConfig } from "./openai";
import { sameCity } from "./favorites";
import { saveLocal } from "./storage";

const key = (tripId: string, city: string) =>
  `tm-cityideas:${tripId}:${city.trim().toLowerCase()}`;
const EVENT = "tm-cityideas";

/** Where each city's request stands, for the screens that show it. */
const asking = new Map<string, "asking" | { error: string }>();
let version = 0;
const changed = () => {
  version++;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
};

export const cityIdeasText = (tripId: string, city: string) =>
  localStorage.getItem(key(tripId, city)) ?? "";

export function setCityIdeasText(tripId: string, city: string, text: string) {
  saveLocal(key(tripId, city), text);
  changed();
}

export const cityIdeasStatus = (tripId: string, city: string) =>
  asking.get(key(tripId, city));

/** Re-renders when any city's ideas or request change. */
export function useCityIdeasVersion() {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener(EVENT, cb);
      window.addEventListener("storage", cb);
      return () => {
        window.removeEventListener(EVENT, cb);
        window.removeEventListener("storage", cb);
      };
    },
    () => version,
  );
}

/** Asks ChatGPT for one city's ideas (once at a time) and keeps the answer. Throws nothing: a failure is kept as the status. */
export async function askCityIdeas(
  tripId: string,
  city: string,
  settings: Settings,
): Promise<boolean> {
  const k = key(tripId, city);
  if (asking.get(k) === "asking" || !aiReady(getAiConfig())) return false;
  asking.set(k, "asking");
  changed();
  try {
    const trip = await db.trips.get(tripId);
    if (!trip) throw new Error("The trip is gone.");
    const [days, items] = await Promise.all([
      db.days.where("tripId").equals(tripId).toArray(),
      db.items.where("tripId").equals(tripId).toArray(),
    ]);
    const dates = new Set(
      days.filter((d) => sameCity(d.city, city)).map((d) => d.date),
    );
    const planned = items
      .filter(
        (i) =>
          dates.has(i.date) &&
          ["activity", "meal", "walk"].includes(i.kind) &&
          i.status !== "skipped",
      )
      .map((i) => i.title);
    const text = await askAI([
      { role: "user", content: cityIdeasPrompt(trip, settings, city, planned) },
    ]);
    parseCityIdeas(text); // throws when the answer can't be read: kept as the error, the old ideas stay
    saveLocal(k, text);
    asking.delete(k);
    changed();
    return true;
  } catch (e) {
    asking.set(k, { error: (e as Error).message });
    changed();
    return false;
  }
}

/**
 * Right after an itinerary is chosen: ideas for every city on its route, one city after another, in the background.
 * Cities that already have ideas are left as they are.
 */
export async function askAllCityIdeas(
  tripId: string,
  settings: Settings,
): Promise<{ done: number; failed: number }> {
  if (!aiReady(getAiConfig())) return { done: 0, failed: 0 };
  const days = (await db.days.where("tripId").equals(tripId).toArray()).sort(
    (a, b) => a.date.localeCompare(b.date),
  );
  const cities: string[] = [];
  for (const d of days)
    if (d.city && !cities.some((c) => sameCity(c, d.city))) cities.push(d.city);
  let done = 0;
  let failed = 0;
  for (const city of cities) {
    if (cityIdeasText(tripId, city).trim()) continue;
    if (await askCityIdeas(tripId, city, settings)) done++;
    else failed++;
  }
  return { done, failed };
}
