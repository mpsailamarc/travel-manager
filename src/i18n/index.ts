// The app's language: English (the texts as written in the code) or French (a dictionary from the English text to the French).
// The language comes from the address (…/?lang=fr, so a link can open the app in French), else the choice saved on this device.
// Anything not translated yet shows in English, so nothing breaks while the dictionary grows.

export type Lang = 'en' | 'fr'
export const LANGS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
]
const KEY = 'tm-lang'

const files = import.meta.glob<{ default: Record<string, string> }>('./fr/*.ts', { eager: true })
/** English text → French, from every file of src/i18n/fr. */
export const FR: Record<string, string> = Object.assign({}, ...Object.values(files).map((m) => m.default))

const isLang = (v: unknown): v is Lang => v === 'en' || v === 'fr'

/** "?lang=fr" in the address, before the # or inside it (#/trip/…?lang=fr). */
export function langFromUrl(href: string): Lang | undefined {
  const m = href.match(/[?&]lang=([a-zA-Z-]+)/)
  const v = m?.[1].toLowerCase().slice(0, 2)
  return isLang(v) ? v : undefined
}

function startLang(): Lang {
  try {
    const fromUrl = typeof location !== 'undefined' ? langFromUrl(location.href) : undefined
    if (fromUrl) {
      localStorage.setItem(KEY, fromUrl) // kept: the app opened later from the home screen stays in this language
      return fromUrl
    }
    const saved = localStorage.getItem(KEY)
    if (isLang(saved)) return saved
  } catch {
    /* no storage: English */
  }
  return 'en'
}

let current: Lang = startLang()
if (typeof document !== 'undefined') document.documentElement.lang = current

export const lang = () => current

/** Changes the language and reloads, so every screen is drawn again in it. */
export function setLang(next: Lang) {
  try {
    localStorage.setItem(KEY, next)
  } catch {
    /* ignored */
  }
  // An address that carries ?lang= would put it back.
  if (typeof location !== 'undefined') {
    const clean = location.href.replace(/([?&])lang=[a-zA-Z-]+&?/, '$1').replace(/[?&]$/, '')
    if (clean !== location.href) location.replace(clean)
    location.reload()
  }
}

/** For testing: sets the language without reloading. */
export function useLangForTests(l: Lang) {
  current = l
}

/** The locale for dates and numbers: French when the app is, else the browser's own. */
export const locale = () => (current === 'fr' ? 'fr-FR' : undefined)

/**
 * The text in the current language. The English text is the key, "{name}" marks a value filled in from `vars`:
 * t('{n} nights in {city}', { n: 3, city }). Not translated yet → the English text.
 */
export function t(text: string, vars?: Record<string, string | number>): string {
  const s = (current === 'fr' && FR[text]) || text
  const filled = vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s
  return aiName === 'ChatGPT' ? filled : filled.replace(/ChatGPT|OpenAI/g, aiName)
}

// The assistant the app asks ("ChatGPT", or "Gemini" when that is chosen in Settings): the texts that name it follow.
let aiName = 'ChatGPT'
export const setAiName = (name: string) => {
  aiName = name
}

/** One text for one, another for more ("1 night" / "{n} nights"): French counts 0 and 1 as singular. */
export function tn(n: number, one: string, other: string, vars?: Record<string, string | number>): string {
  const cat = new Intl.PluralRules(current === 'fr' ? 'fr' : 'en').select(n)
  return t(cat === 'one' ? one : other, { n, ...vars })
}
