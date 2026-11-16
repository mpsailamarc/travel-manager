import { useState } from 'react'
import { active, getAiConfig, listModels, PROVIDERS, setAiConfig, useAiConfig, type Provider } from '../lib/openai'
import { toast } from './ui'
import { locale, t } from '../i18n'

/** Settings: ask ChatGPT from inside the app (your own OpenAI key) or keep copy-and-paste with free chatbots. */
export function AiCard() {
  const cfg = useAiConfig()
  const ai = active(cfg)
  const gemini = cfg.provider === 'gemini'
  const [show, setShow] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function test() {
    setBusy(true)
    setError(undefined)
    try {
      const now = getAiConfig()
      const list = await listModels(active(now).key, now.provider)
      setModels(list)
      if (list.length && !list.includes(active(now).model)) setAiConfig(now.provider === 'gemini' ? { geminiModel: list[0] } : { model: list[0] })
      toast(t('The key works · {n} chat models available', { n: list.length }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const modelOptions = [...new Set([ai.model, ...models])]
  const setKey = (v: string) => setAiConfig(gemini ? { geminiKey: v } : { key: v })
  const pick = (p: Provider) => {
    setAiConfig({ provider: p })
    setModels([])
    setError(undefined)
  }

  return (
    <div className="card stack">
      <h3>{t('✨ AI assistant')}</h3>
      <div className="chips">
        <button className={`chip ${cfg.mode === 'paste' ? 'on' : ''}`} onClick={() => setAiConfig({ mode: 'paste' })}>
          {t('📋 Copy & paste (free chatbots)')}
        </button>
        <button className={`chip ${cfg.mode === 'api' ? 'on' : ''}`} onClick={() => setAiConfig({ mode: 'api' })}>
          {t('🔑 AI with my API key')}
        </button>
      </div>
      {cfg.mode === 'paste' ? (
        <p className="small muted">{t('The app gives you a prompt to copy into any chatbot, and you paste the answer back. Free, nothing is sent from the app.')}</p>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          <div className="chips">
            {(['gemini', 'openai'] as const).map((p) => (
              <button key={p} className={`chip ${cfg.provider === p ? 'on' : ''}`} onClick={() => pick(p)}>
                {p === 'gemini' ? t('Gemini (free tier)') : t('Chat​GPT (Open​AI, paid)')}
              </button>
            ))}
          </div>
          <p className="small muted">
            {gemini
              ? t('Every “Ask ChatGPT” button sends its prompt straight from this device to Google’s Gemini and fills in the answer for you: the same steps as copy and paste, minus the copying. Create a free key at aistudio.google.com → Get API key. The free tier has daily limits, and Google may use what you send on it to improve its products (not in the EU, the UK and Switzerland).')
              : t('Every “Ask ChatGPT” button sends its prompt straight from this device to OpenAI and fills in the answer for you. The same steps as copy and paste, minus the copying. The OpenAI API is billed separately from a ChatGPT subscription (create a key at platform.openai.com → API keys, and set a monthly spending limit there).')}
          </p>
          <label>
            {gemini ? t('Gemini API key') : t('OpenAI API key')}
            <div className="row">
              <input
                type={show ? 'text' : 'password'}
                value={ai.key}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder={gemini ? 'AIza…' : 'sk-…'}
                onChange={(e) => setKey(e.target.value.trim())}
              />
              <button type="button" className="btn-sm" onClick={() => setShow((s) => !s)}>
                {show ? t('Hide') : t('Show')}
              </button>
            </div>
          </label>
          <div className="row wrap">
            <button className="btn-primary" disabled={!ai.key || busy} onClick={test}>
              {busy ? t('Checking…') : t('Test the key & load models')}
            </button>
            {ai.key && (
              <button
                onClick={() => {
                  setKey('')
                  setModels([])
                  toast(t('Key removed from this device'))
                }}
              >
                {t('Remove the key')}
              </button>
            )}
          </div>
          {error && <div className="notice error">{error}</div>}
          <label>
            {t('Model')}
            <select value={ai.model} onChange={(e) => setAiConfig(gemini ? { geminiModel: e.target.value } : { model: e.target.value })}>
              {modelOptions.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <p className="tiny muted">
            {gemini
              ? t('A “flash” model is quick and plenty for planning (“{model}” always points to the latest one). “Test the key” lists the models your key can use.', { model: PROVIDERS.gemini.defaultModel })
              : t('A “mini” model is cheaper and plenty for planning. “Test the key” lists the models your key can use.')}
          </p>
          <div className="notice info">
            <b>{t('The key stays on this device.')}</b>{' '}
            {gemini
              ? t('It is not synced, not in backups and not in shared trips, so enter it on each device you want to use. Anyone who can use this browser can use the key. If it leaks, delete it at aistudio.google.com and make a new one.')
              : t('It is not synced, not in backups and not in shared trips, so enter it on each device you want to use. Anyone who can use this browser can use the key, so keep the spending limit low. If it leaks, delete it at platform.openai.com and make a new one.')}
          </div>
          {!gemini && (
            <div className="row between wrap small muted">
              <span>{t('Used from this device: ~{n} tokens', { n: cfg.tokens.toLocaleString(locale()) })}</span>
              {cfg.tokens > 0 && (
                <button className="btn-sm btn-ghost" onClick={() => setAiConfig({ tokens: 0 })}>
                  {t('Reset')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
