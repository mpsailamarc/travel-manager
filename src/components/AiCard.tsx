import { useState } from 'react'
import { getAiConfig, listModels, setAiConfig, useAiConfig } from '../lib/openai'
import { toast } from './ui'

/** Settings: ask ChatGPT from inside the app (your own OpenAI key) or keep copy-and-paste with free chatbots. */
export function AiCard() {
  const cfg = useAiConfig()
  const [show, setShow] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function test() {
    setBusy(true)
    setError(undefined)
    try {
      const list = await listModels(getAiConfig().key)
      setModels(list)
      if (list.length && !list.includes(getAiConfig().model)) setAiConfig({ model: list[0] })
      toast(`The key works · ${list.length} chat models available`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const modelOptions = [...new Set([cfg.model, ...models])]

  return (
    <div className="card stack">
      <h3>✨ AI assistant</h3>
      <div className="chips">
        <button className={`chip ${cfg.mode === 'paste' ? 'on' : ''}`} onClick={() => setAiConfig({ mode: 'paste' })}>
          📋 Copy & paste (free chatbots)
        </button>
        <button className={`chip ${cfg.mode === 'api' ? 'on' : ''}`} onClick={() => setAiConfig({ mode: 'api' })}>
          🔑 ChatGPT with my API key
        </button>
      </div>
      {cfg.mode === 'paste' ? (
        <p className="small muted">The app gives you a prompt to copy into any chatbot, and you paste the answer back. Free, nothing is sent from the app.</p>
      ) : (
        <div className="stack" style={{ gap: 10 }}>
          <p className="small muted">
            Every “Ask ChatGPT” button sends its prompt straight from this device to OpenAI and fills in the answer for you. The same steps as copy and paste, minus the copying.
            The OpenAI API is billed separately from a ChatGPT subscription (create a key at platform.openai.com → API keys, and set a monthly spending limit there).
          </p>
          <label>
            OpenAI API key
            <div className="row">
              <input
                type={show ? 'text' : 'password'}
                value={cfg.key}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="sk-…"
                onChange={(e) => setAiConfig({ key: e.target.value.trim() })}
              />
              <button type="button" className="btn-sm" onClick={() => setShow((s) => !s)}>
                {show ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>
          <div className="row wrap">
            <button className="btn-primary" disabled={!cfg.key || busy} onClick={test}>
              {busy ? 'Checking…' : 'Test the key & load models'}
            </button>
            {cfg.key && (
              <button
                onClick={() => {
                  setAiConfig({ key: '' })
                  setModels([])
                  toast('Key removed from this device')
                }}
              >
                Remove the key
              </button>
            )}
          </div>
          {error && <div className="notice error">{error}</div>}
          <label>
            Model
            <select value={cfg.model} onChange={(e) => setAiConfig({ model: e.target.value })}>
              {modelOptions.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <p className="tiny muted">A “mini” model is cheaper and plenty for planning. “Test the key” lists the models your key can use.</p>
          <div className="notice info">
            <b>The key stays on this device.</b> It is not synced, not in backups and not in shared trips, so enter it on each device you want to use. Anyone who can use this
            browser can use the key, so keep the spending limit low. If it leaks, delete it at platform.openai.com and make a new one.
          </div>
          <div className="row between wrap small muted">
            <span>Used from this device: ~{cfg.tokens.toLocaleString()} tokens</span>
            {cfg.tokens > 0 && (
              <button className="btn-sm btn-ghost" onClick={() => setAiConfig({ tokens: 0 })}>
                Reset
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
