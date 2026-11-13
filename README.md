# Travel Manager

A personal, zero-cost travel app: plan a trip before you go, then follow it day by day while you travel.
It is a web app you can install on Android and iPhone (a PWA). All data stays on your device and it works offline.

## What it does

**Before the trip**
- **New trip questionnaire**: where, when, who (kids' ages), pace, budget level and interests.
- **Ideas (AI, free)**: the app writes a prompt. Paste it into any free chatbot (Claude, Gemini, ChatGPT) and paste the answer back.
  You get 3 itinerary options side by side, each with a budget and tips, and pick one. The answer is validated before anything is saved.
- **Import booking emails**: paste confirmation emails and get booked flights, trains and stays in the plan (same copy-paste trick).
- **Quick template**: a skeleton plan with no AI, fully offline.
- **Plan**: day-by-day itinerary with a map. Add or edit flights, trains, buses, stays, activities, meals, walks and notes. You can also print it.
- **Checklist**: generated from your destinations, nationality, travellers and itinerary. It covers passports, visas/ETAs/ESTA, insurance, EHIC,
  vaccines, unbooked transport, nights with no accommodation, online check-in, cash, eSIM, plug adapters, kids' items and packing.
  "Suggest items" updates it as the plan changes and never touches what you ticked.
- **Budget**: per-category budget (with a rough automatic estimate), costs in the plan, money spent (bookings paid ahead + logged expenses)
  and what's left per day.

**During the trip**
- **Today**: what's happening now or next, with a countdown, today's travel with booking refs, tonight's accommodation and the weather.
  Tick, skip, reorder or push an item to the next day, get directions, and log spending in any currency.
- **Replan**: "it's raining" / "kids are tired" → a prompt for a free chatbot → paste back a new plan for the rest of the day
  (keeps what's booked or done).
- **Favourites per city**: browse sights (OpenStreetMap + Wikipedia), AI ideas (restaurants, experiences, day trips, kid-friendly places)
  or add your own, and ⭐ the ones you like. **Plan my days** groups them by area, fits them to your pace and what's already planned
  (booked tickets, travel days), and builds a walking tour per day. Move any favourite to another day yourself and it stays there.
  What doesn't fit becomes a backup idea.
- **Backup ideas on Today**: unscheduled favourites near today's city, switching to indoor ones when rain is forecast. "+ Today" adds one to the plan.
- **Walking tours**: pick sights in any city (OpenStreetMap + Wikipedia, with photos and descriptions). The app finds the best order,
  gets the real walking route and builds a timeline with visit times. Save it to a day.
- **Local essentials**: emergency number, plugs/voltage, currency and exchange rate, driving side, tipping.
- **Docs**: passport scans, tickets and insurance stored on the device, available offline.

**Sync** (optional): your devices (and family) stay in sync automatically through a small add-on for your own
PythonAnywhere site (`server/travel_sync.py`, Python standard library only). Data is encrypted on the device with
your sync code, so the server can't read it. Documents and settings stay on each device. See `DEPLOY-pythonanywhere.md`.

**Sharing**: export a trip as a `.trip.json` file and send it to family. They tap *Import* to get their own copy. Back up and restore all trips from Settings.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm run preview    # serve the production build on http://localhost:4173
```

Try **Demo trip** on the home screen. It is always "in progress" (it started yesterday), so the Today view has something to show.

## Published version

Every push to `main` is built and published by GitHub Actions (`.github/workflows/deploy.yml`) to
**https://mpsailamarc.github.io/travel-manager/**. Sync goes to the PythonAnywhere server set in `.env.production`.
Alternatives without GitHub: `DEPLOY-cloudflare.md`, `DEPLOY-pythonanywhere.md`.

## Put it on your phone (free)

The app is a static site. Host `dist/` on any free static host, e.g. GitHub Pages or Cloudflare Pages
(HTTPS is required for install and offline use). Then:
- **Android (Chrome)**: menu ⋮ → *Install app*.
- **iPhone (Safari)**: Share → *Add to Home Screen*.

Open each day (and each walk map) once while online so maps and weather are cached for offline use.

## Free services used (no accounts, no keys)

| What | Service | Notes |
|---|---|---|
| Map tiles | OpenFreeMap (OpenStreetMap data) | attribution shown on the map |
| Sights | Overpass API (OSM) + Wikipedia geosearch | queried in parallel, cached 14 days |
| Walking routes | FOSSGIS OSRM (`routing.openstreetmap.de`) | falls back to a straight-line estimate |
| Place search | Nominatim | explicit "Find" button only (no autocomplete, per its policy) |
| Descriptions & photos | Wikipedia / Wikidata | CC BY-SA |
| Weather | Open-Meteo | free for non-commercial use |
| Exchange rates | Frankfurter (ECB) | ~30 major currencies; others can be entered by hand |

Every request has a timeout, and results are cached on the device, so a slow or blocked service never freezes the app.

## Code map

- `src/types.ts`: data model (trip, day, item, checklist, expense, document)
- `src/db.ts`: IndexedDB via Dexie
- `src/lib/ai.ts`: prompts, response validation (zod), applying plans
- `src/lib/checklist.ts`: checklist rule engine
- `src/lib/countries.ts`: offline country facts (plugs, emergency numbers, entry schemes)
- `src/lib/apis.ts`: free web services with caching
- `src/lib/geo.ts`: distances and the walking-order optimiser (nearest neighbour + 2-opt)
- `src/lib/favorites.ts`: "Plan my days" (area grouping with k-means, time balancing per day) and rebuilding the day walks
- `src/pages/*`: screens; `src/components/*`: shared UI, map, item editor

Country facts and entry notes are hand-curated hints. Always confirm visa and entry rules on official sites (the checklist links to them).
