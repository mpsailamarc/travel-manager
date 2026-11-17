import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { t } from '../i18n'

/** A screenshot of the app (taken with an example trip, so nothing here is anybody's real plan). */
function Shot({ name, alt }: { name: string; alt: string }) {
  return (
    <figure className="help-shot">
      <img src={`./tutorial/${name}.webp`} alt={alt} loading="lazy" />
    </figure>
  )
}

function Step({ n, title, children, shots }: { n: number; title: string; children: ReactNode; shots?: ReactNode }) {
  return (
    <section className="card help-step">
      <div className="help-text stack" style={{ gap: 8 }}>
        <h2>
          <span className="help-n">{n}</span> {title}
        </h2>
        {children}
      </div>
      {shots && <div className="help-shots">{shots}</div>}
    </section>
  )
}

/** The tour: from the AI key to the day by day, with the example trip's screenshots. */
export default function HelpPage() {
  return (
    <div className="page stack-lg" style={{ maxWidth: 860 }}>
      <div className="stack" style={{ gap: 6 }}>
        <h1>{t('How Travel Manager works')}</h1>
        <p className="muted">
          {t('A tour with an example trip, Portugal in April for a family of four: set yourself up once, answer a few questions, let the AI propose itineraries, then follow the trip day by day. Everything stays on your device.')}
        </p>
      </div>

      <Step
        n={1}
        title={t('Set yourself up once')}
        shots={
          <>
            <Shot name="settings-ai" alt={t('Settings: the AI assistant, with Gemini picked and a place for a free key')} />
            <Shot name="settings-family" alt={t('Settings: your family and what you enjoy')} />
          </>
        }
      >
        <p>
          {t('Open Settings (⚙️ at the top). Under “AI assistant”, pick “AI with my API key”, then Gemini (free tier) and paste a free key from aistudio.google.com — or ChatGPT with an OpenAI key. The key stays on this device only. Without a key it still works: the app writes the prompt, you paste it into any chatbot and paste the answer back.')}
        </p>
        <p>
          {t('Fill in Family (your partner, your children and their ages) and What you enjoy once: every new trip starts with them, and you can change them for each trip. Add your nationality, home currency and home city too, so visas, plugs, budgets and flights fit you.')}
        </p>
      </Step>

      <Step
        n={2}
        title={t('Plan a new trip: five short questions')}
        shots={
          <>
            <Shot name="new-where" alt={t('New trip, step 1: where to')} />
            <Shot name="new-when" alt={t('New trip, step 2: dates and how you get there')} />
            <Shot name="new-who" alt={t('New trip, step 3: who is coming, from your family in Settings')} />
            <Shot name="new-what" alt={t('New trip, step 4: driving, where you sleep and what you enjoy')} />
          </>
        }
      >
        <p>
          <b>{t('Where')}</b> — {t('a country, or the cities in the order you would visit them; where you start from comes from Settings.')} <b>{t('When')}</b> — {t('the first and last day at the destination (14 days in Chile is 14 days there, however long the flights are), and how you get there: plane, rental car, your own car, or train, bus or ferry.')}
        </p>
        <p>
          <b>{t('Who')}</b> — {t('you and your family from Settings; change the list for this trip only if you need to.')} <b>{t('What')}</b> — {t('pace, budget, cities or the outdoors, flights between places, whether you are happy to drive, where you sleep (hotels, a camper van, friends or family, or one single place when you chose a single destination) and what you enjoy.')}
        </p>
        <p className="small muted">
          {t('Not finished? “Finish later” keeps your answers: the home screen shows the trip as 🚧 WIP, and Continue picks it up where you stopped.')}
        </p>
      </Step>

      <Step
        n={3}
        title={t('Ask for three itineraries')}
        shots={
          <>
            <Shot name="ideas-ask" alt={t('Itinerary ideas: your brief and the Ask Gemini button')} />
            <Shot name="options-compare" alt={t('How the three options differ, in a table')} />
            <Shot name="options-plan" alt={t('One option with its map and day-by-day outline')} />
          </>
        }
      >
        <p>
          {t('The brief on top is what the AI is told (it is made from your answers; change it with the pencil at the top). Press “Ask Gemini”: the answer fills itself in, usually within a minute. If Google is busy, the real message is shown and it tries the next quick model.')}
        </p>
        <p>
          {t('You get a short comparison and three genuinely different options: a table (places, moves, budget), and for each option a map, the route and the outline day by day. Fold or unfold each plan, and make its map small, large or hidden.')}
        </p>
      </Step>

      <Step n={4} title={t('Pick one, and ask for changes if you like')} shots={<Shot name="options-choose" alt={t('Choose your plan: pick a plan and type what to change')} />}>
        <p>
          {t('At the bottom, “Choose your plan” is a list: Use plan 1, 2 or 3. Anything to change? Type it (“add a night in Évora and drop Sintra”) and press “Revise”: you get another outline, with its map, added above as a new plan. Repeat as many times as you like.')}
        </p>
      </Step>

      <Step
        n={5}
        title={t('Turn it into a detailed itinerary')}
        shots={
          <>
            <Shot name="detail-ask" alt={t('Detailed plan: Ask Gemini for all days')} />
            <Shot name="detail-done" alt={t('Every day has its detail, ready to use')} />
          </>
        }
      >
        <p>
          {t('Once you are happy with an outline, “Use plan” asks for the full detail: three days at a time, so each answer is quick and nothing is cut off. You see every day with its times, transport, meals and sights, plus checklist ideas for this trip. Press “Use this plan” and it becomes your itinerary, with the budget and checklist.')}
        </p>
      </Step>

      <Step
        n={6}
        title={t('The Plan: your whole trip at a glance')}
        shots={<Shot name="plan" alt={t('The Plan tab: days, stays, transport and costs')} />}
      >
        <p>
          {t('Every day with its items in order: flights and trains with their local times, the stays, meals and visits. Tap a day or an item to edit it, “+ Add” to add something, and fold days you are done with. “Where you sleep” is folded at the top: open it to enter your hotels. Time zones are handled for you: everything is shown in local time.')}
        </p>
      </Step>

      <Step
        n={7}
        title={t('Day by day: the timeline')}
        shots={<Shot name="day" alt={t('Day by day: the timeline of one day with its map')} />}
      >
        <p>
          {t('One day as a timeline with its route on a map. Drag things to move them, let “Optimise” fit what you want to do into the hours left, and see what is open and when it gets dark. When the trip starts, the app opens on today.')}
        </p>
      </Step>

      <Step
        n={8}
        title={t('City planner: what to do in each city')}
        shots={
          <>
            <Shot name="city-days" alt={t('City planner: the days in Lisbon with what is planned')} />
            <Shot name="city-ideas" alt={t('City planner: things to do in Lisbon, with a map')} />
          </>
        }
      >
        <p>
          {t('For each city on the route: ideas from the AI (asked in the background once you chose your plan) next to free sights from OpenStreetMap and Wikipedia. Add the ones you like to your wishlist and drop them into a day: walking times between places are worked out for you.')}
        </p>
      </Step>

      <section className="card stack">
        <h2>{t('And also…')}</h2>
        <ul className="help-list">
          <li>
            <b>{t('Budget')}</b> — {t('an estimate with its assumptions, your expenses in any currency, and what is left.')}
          </li>
          <li>
            <b>{t('Checklist')}</b> — {t('visas, vaccines, plugs, bookings and packing, made for your trip and your passport.')}
          </li>
          <li>
            <b>{t('Essentials & Docs')}</b> — {t('emergency numbers, tipping, the weather; and your tickets and booking references, offline.')}
          </li>
          <li>
            <b>{t('Offline and on every device')}</b> — {t('install it from your browser menu (Add to home screen); the maps and plans you have seen work without a connection. Encrypted sync and shared links carry a trip to your other devices and to the people travelling with you.')}
          </li>
          <li>
            <b>{t('English or French')}</b> — {t('Settings → Language, or add ?lang=fr to the address of the app.')}
          </li>
        </ul>
        <div className="row wrap">
          <Link to="/new" className="btn btn-primary">
            {t('+ Plan a new trip')}
          </Link>
          <Link to="/settings" className="btn">
            {t('Settings')}
          </Link>
        </div>
      </section>
    </div>
  )
}
