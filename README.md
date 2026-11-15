# Travel Manager

A personal, zero-cost travel app: plan a trip before you go, then follow it day by day while you travel.
It is a web app you can install on Android and iPhone (a PWA). All data stays on your device and it works offline.

## What it does

**Before the trip**
- **New trip questionnaire**: where, when, who (kids' ages), pace, budget level and interests.
- **Ideas (AI, free)**: the app writes a prompt. Paste it into any free chatbot (Claude, Gemini, ChatGPT) and paste the answer back.
  Options come one per reply (free chatbots cut off long replies), then the full day-by-day detail of the one you pick, with
  follow-up prompts for anything that was cut off. Answers are validated before anything is saved.
- **Optional: ask ChatGPT from inside the app**: in Settings → AI assistant, switch from copy and paste to your own OpenAI API key. Every AI step
  (ideas, day detail, replan, booking import, city ideas) then gets an "✨ Ask ChatGPT" button that sends the prompt and fills in the answer, with
  copy and paste still one tap away. The key stays on that device only (not synced, not in backups or shared files); calls go straight to
  api.openai.com. The API is billed by OpenAI separately from a ChatGPT subscription, so set a spending limit; the app shows rough token use.
- **Import booking emails**: paste confirmation emails and get booked flights, trains and stays in the plan (same copy-paste trick).
- **Quick template**: a skeleton plan with no AI, fully offline.
- **Push-back on time changes**: when you make an item end later (a landing at 06:28), the editor offers to push the overlapping items after it
  back just enough, keeping their durations. Booked items are never moved.
- **Self-drive vs car rental**: driving yourselves is its own type (🚙, nothing to book); only renting, picking up or returning a car (🚗) gets a
  "Book:" entry. Existing "car" items are sorted by their title.
- **Road routes on the Plan map**: legs you drive (arriving on a day within your car period) follow the real roads, with distance and driving time
  under the map; flights and other legs stay dashed straight lines. Routes: FOSSGIS OSRM (free), saved for offline.
- **No double entries**: an imported booking fills in the matching planned item (flight, camper van pickup…) instead of being added next to it,
  importing twice changes nothing, and the Plan warns if the same thing appears twice, with a one-tap merge.
- **Pinned day selector**: the row of day buttons stays under the header while you scroll a day; picking another day starts it from its top.
- **Day timeline**: the day laid out on an hour scale, each block as tall as the activity is long (overlaps side by side, a "now" line), with a bar
  showing how the day divides between travel, activities and meals. Switch to the plain list any time.
- **Move and resize on the calendar**: on a phone, press and hold a block (about half a second) to move it, or hold its top or bottom handle to
  change the start or the end, so a swipe across the calendar only scrolls; with a mouse just drag; it snaps to 15 minutes. Booked items stay put. If a change makes things overlap you get "Push them back".
- **Time zones**: a day is shown in the local time of its city (worked out offline from coordinates). A flight is entered in the departure place's time
  and the arrival in the arrival place's time, so "Sydney 22:30 → Tokyo 07:00" is 10 h 30 and appears at 20:30 on Tokyo's calendar, continuing onto the
  next morning. The zones come from the From/To places (coordinates, or a well-known city or airport code typed in the name, like "Sydney" or "SYD"); the two zone drop-downs in the item form override a wrong guess.
- **Switching itinerary idea is a clean swap**: the previous idea's items, to-dos (ticked ones stay), budget figures, tips and favourite-to-day links go;
  your own notes, figures and the end date you chose stay.
- **Budget vs In the plan**: each category shows what's priced in the plan and what isn't yet ("not planned yet" / "over budget"), with an explanation.
- **Tripadvisor links** (no account, no key): 🦉 "Find on Tripadvisor" on activities, meals and stays, on favourites, sights and AI ideas (restaurants too),
  and on the checklist's hotel and ticket entries; a Tripadvisor link you paste into an item shows as "Open on Tripadvisor".
- **Plan**: day-by-day itinerary with a map. Add or edit flights, trains, buses, stays, activities, meals, walks and notes. You can also print it.
- **Checklist**: generated from your destinations, nationality, travellers and itinerary. It covers passports, visas/ETAs/ESTA, insurance, EHIC,
  vaccines, unbooked transport, nights with no accommodation, online check-in, cash, eSIM, plug adapters, kids' items and packing.
  "Suggest items" updates it as the plan changes and never touches what you ticked.
- **Start and return place** (e.g. San Francisco → Yosemite → San Francisco): shown on the Plan map and as a route line, and sent to the AI. A start typed without "Find" is located automatically; the map can be small, large or hidden.
- **Budget estimate with assumptions**: lines sit under each category (fold or unfold each one), and every line can carry an assumption —
  quantity × price, e.g. 4 days of car rental × A$121 per day, 600 km × A$0.23 per km (flights are one line for the whole group). Change the quantity or price and the totals follow. A car in the plan adds
  rental and fuel lines. No flights when the trip starts in the destination's country.
- **Budget**: log spends in any currency (the date defaults to today on your device), tap one to edit it; per-category budget (with a rough automatic estimate), costs in the plan, money spent (bookings paid ahead + logged expenses)
  and what's left per day.

**During the trip**
- **Day by day** (the old Today): what's happening now or next, with a countdown, today's travel with booking refs, tonight's accommodation and the weather.
  Tick, skip, reorder or push an item to the next day, and get directions.
- **Replan**: "it's raining" / "kids are tired" → a prompt for a free chatbot → paste back a new plan for the rest of the day
  (keeps what's booked or done).
- **City planner** (one tab; it replaces the separate Favourites and Walks tabs): per city, a wishlist and your days. Browse sights (OpenStreetMap + Wikipedia), AI ideas (restaurants, experiences, day trips,
  kid-friendly places) or add your own, and tap ＋ on the ones you want. Tap any place to open it in a window with its photo, description,
  practical facts and a **star rating**. **Plan my days** groups the wishlist by area, fits it to your pace and what's already planned
  (booked tickets, travel days), and builds a walking tour per day. Move any place to another day yourself and it stays there.
  What doesn't fit becomes a backup idea.
- **Sights follow the map**: the sights list covers the part of the map you chose. Pan or zoom the map, tap **Search this area**, and the list
  (and its distances) refreshes for what's on screen; "Back to the city centre" resets it. Wide views list well-known places only (a free-service limit).
- **A day on the map**: in the City planner, the map has a chip per day (or "🗺️ Show this day on the map" inside a day). It shows that day's places
  numbered in walking order, joined by the walking route, with the stop list, distance and time underneath.
- **The City planner knows what's planned**: it counts the places already in your days, and in Find things to do a sight or AI idea that's
  already on a day shows "📅 Day 3" instead of ＋.
- **Level of interest (stars)**: no free source has visitor reviews, so the stars show how widely a place is written about: the number of
  Wikipedia language editions with an article on it (Wikidata), from 1★ (a village chapel) to 5★ (Eiffel Tower, 170+ languages). Sights can be
  sorted most interesting first; the place window also shows Wikipedia page views per month. Tripadvisor stays a link out.
- **Backup ideas on Today**: unscheduled wishlist places near today's city, switching to indoor ones when rain is forecast. "+ Today" adds one to the plan.
- **Day plans from the wishlist**: "Plan my days" turns each day's wishlist places into **one timed item per place** in Day by day, in the best
  order, fitted around anything already fixed (booked tickets, lunch). Places your plan already holds (the itinerary's own "Visit the castle") are
  **linked, not duplicated**, in both directions. Change one by hand (time, day, tick it off) and it becomes yours: re-planning leaves it alone;
  delete it and the place goes back to the wishlist's backup ideas.
- **The day's path, everywhere**: every item with a place (planned by the City planner or added or edited by hand) is numbered in time order, with
  the way to get between them. Day by day has a "🗺️ Day on the map" card (the numbers in the list match the map; tap one to jump to it), and the
  City planner's day chips draw the same path, with links between the two.
- **🔀 Optimise this day** (Day by day, and each day in the City planner): reorders everything that can move to cut travel. Fixed things with
  a place split the day into stretches; each place goes where it adds the least travel and still fits, in the shortest order between the
  stretch's two ends; lunch and dinner go in at their time of day. You see the new order and the travel saved first, then Apply or Keep as is.
  **📌 Locks** say what never moves: booked items, journeys and stays always; anything you place by hand (dragged on the calendar, time changed
  in the form, moved up/down) is locked automatically, and any item can be locked or unlocked from its ⋯ menu or form. "Plan my days" uses the
  same engine, so both screens agree.
- **Plan map is clickable**: tap a numbered day marker or a grey activity dot to open that day in Day by day.
- **Maps show real paths**: everything follows the streets and roads (walks, taxis, public transport, trains, buses, drives), except flights
  and boats, which stay straight dashed lines. Colours say how you travel: walking green, public transport blue (dashed: its exact line isn't
  known), taxi orange; on the trip map car orange, train/bus blue, flights grey, boats cyan.
- **One budget**: each category adds up exactly the lines under it: the prices of plan items (📌, editable right there: the plan item
  changes too) and your own lines for the rest (meals, local transport…). A figure typed for a category is its total: what the plan's
  prices don't use of it shows as "Rest of the budget you set". "Estimate for me" doesn't estimate what the plan already prices.
- **Budget by type**: a bar per category (longest first): the pale track is the budget, the solid part what's spent, red past the budget.
- **The budget follows the trip**: change the number of travellers or the dates in Trip details and the estimate's lines (per person per
  day, flights, nights and rooms, moves) are recalculated, so the totals at the top change too.
- **Home as the default start**: Settings → Home city or usual airport. New trips, and trips with no start set, start and end there.
- **Packed pace** fills about 90% of a 9:00–21:00 day.
- **With ChatGPT set up** (Settings → AI assistant) the copy-and-paste way is hidden: each AI step is one "Ask ChatGPT" button, and the
  answer box only appears, folded, once there is an answer.
- **Opening hours**: sights are kept within their likely opening hours where possible: the published ones when OpenStreetMap has them
  ("Tu-Su 10:00-18:00", closed days included), otherwise 9:00–17:00 (shops 10:00–19:00; parks, viewpoints, markets, walks, meals and evening
  shows have no limit). It's a guess, so it only steers the order and warns ("🕘 may be closed then") on the item and in the Optimise preview.
- **Quarter hours everywhere**: Optimise, Plan my days and re-timing start things on the quarter hour (9:15, never 9:02).
- **Calendar**: dragging snaps to the clock's quarter hours (15:00, 15:15, 15:30…); a 📌 on a block shows it's locked, tap it to let it move.
- **Plan my days schedules the whole day**: besides the wishlist, it gives times to what the day already holds without one (an itinerary's
  "Tower of London", "Lunch at Borough Market"), and ties wishlist places to those items instead of adding them again on another day. Lunch
  goes in around noon. Anything 📌 locked, booked, or a journey stays put and the rest fits around it. Planning again gives the same result.
- **Always in step**: whatever changes (a day moved to another city in the Plan, the trip made shorter, a day replanned by the chatbot, an item moved,
  merged or deleted, an edit synced from another device), the wishlist and Day by day are brought back in line a moment later: places on a day
  that's no longer in their city go back to the backup ideas (with a note saying so), the calendar loses what the planner had put there, places linked
  to your own items follow them, and days still waiting for their places are filled in. Planned places also leave from wherever you are after
  something already fixed (the museum you booked), not from the hotel.
- **The rest of the day follows you**: tick something off (early or late) or skip it, and what's still to come that day moves up or back,
  your own items as well as the planner's, in the same order and length, leaving from where you actually are. Only the gap that opened is
  closed (other breaks you left stay), journeys and booked things don't move, and there's Undo. Places that no longer fit before you leave
  (the flight home, the train on) stay on the day as ideas without a time, instead of being squeezed in after it.
- **Getting between places**: per day (default in Settings) walk everywhere, walk short hops (up to N minutes) and go **public transport** or
  **taxi** for longer ones, or pick **whatever is quickest**. Walking and taxi use real routes (OSRM); public transport has no free routing service, so
  it's an estimate (wait + average speed), clearly labelled, with links to real timetables (Google Maps) and Uber on each place.
  Per day you can also set where the day starts, when, and whether it ends back at the start. (A hand-made walk item still opens in the older walk builder.)
- **About & links on every item**: tap an item on Today for its Wikipedia article (looked up automatically, also for
  AI-created activities), a map link, the city's Wikivoyage guide, and "Find on AllTrails" for hikes. Paste a trail,
  booking or ticket link into an item and it shows as a button (e.g. "Open in AllTrails").
- **Essentials tab**: per country, emergency numbers (tap to call), plugs/voltage and whether you need an adapter, driving side,
  tipping, entry schemes, and a currency converter (ECB rates, plus ExchangeRate-API for currencies like CLP), saved for offline use.
- **Docs**: passport scans, tickets and insurance stored on the device, available offline.

**Sync** (optional): your devices (and family) stay in sync automatically through a small add-on for your own
PythonAnywhere site (`server/travel_sync.py`, Python standard library only). Data is encrypted on the device with
your sync code, so the server can't read it. Documents stay on each device. See `DEPLOY-pythonanywhere.md`.

**Sharing**: export a trip as a `.trip.json` file and send it to family. They tap *Import* to get their own copy. Back up and restore all trips from Settings.

**Navigation**: on a phone the bottom bar holds every section and scrolls sideways (the next tab peeks in, with a fading edge and an arrow).

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
| Walking and driving routes | FOSSGIS OSRM (`routing.openstreetmap.de`) | falls back to a straight line |
| Reviews, hotels, restaurants | Tripadvisor search links (opened in the browser or its app; no API) | |
| Place search | Nominatim | explicit "Find" button only (no autocomplete, per its policy) |
| Descriptions & photos | Wikipedia / Wikidata | CC BY-SA |
| Weather | Open-Meteo | free for non-commercial use |
| Exchange rates | Frankfurter (ECB) + ExchangeRate-API open endpoint | ECB for ~30 major currencies, ExchangeRate-API for the rest (166) |

Every request has a timeout, and results are cached on the device, so a slow or blocked service never freezes the app.

## Tests

`npm test` runs the automated tests (Vitest, in Node, with an in-memory database and no network, so the offline
fallbacks are what's checked and results never change). They cover time zones and flights across them, opening hours,
"is it the same place?" matching, pushing a day back, getting between places, the day scheduler (Optimise, Plan my days,
locks, meals, opening hours, departure days, re-timing after ticking off or skipping), keeping the wishlist, days and
calendar in step, reading chatbot answers and importing bookings, encrypted sync between two devices (against a fake
server), sharing a trip as a file, and budget lines. GitHub runs them before every publish: a failing test stops it.

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
