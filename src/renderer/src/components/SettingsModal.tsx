// ── SettingsModal — app-level settings (titlebar gear) ────────────────────
// First section: Quiz AI — named provider configurations ("sets"). A set is
// a saved {provider, endpoint, apiKey, model}; pressing one makes it the
// live quiz config, and "Yeni Set" saves the editor as a new set AND makes
// it active right away.

import { useEffect, useState } from 'react'
import {
  AlertCircle,
  Check,
  Cpu,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Settings as SettingsIcon,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import type { LLMProviderType, QuizPreset } from '@shared/quiz'
import { useApp } from '../lib/store'
import { useQuiz } from '../lib/quiz/quiz-store'
import { createQuizProvider } from '../lib/quiz/llm-provider'
import { PROVIDER_OPTIONS } from '../quiz/QuizSettingsModal'
import { uiTap } from '../lib/sfx'
import clsx from 'clsx'
import { KeyRound, ZoomIn } from 'lucide-react'
import type { JevKeyStatus } from '@shared/jev'
import {
  APP_ZOOM_MAX,
  APP_ZOOM_MIN,
  APP_ZOOM_PRESETS,
  useAppZoom
} from '../lib/app-zoom'
import {
  setTerminalRenderMode,
  terminalRenderMode,
  type TerminalRenderMode
} from '../lib/terminal-render'

const providerName = (id: LLMProviderType) =>
  PROVIDER_OPTIONS.find((p) => p.id === id)?.name ?? id

const needsEndpoint = (p: LLMProviderType) => p === 'openai' || p === 'ollama' || p === 'custom'
const needsKey = (p: LLMProviderType) => p !== 'builtin' && p !== 'ollama'

export function SettingsModal() {
  const open = useApp((s) => s.settingsOpen)
  const setOpen = useApp((s) => s.setSettingsOpen)

  const settings = useQuiz((s) => s.settings)
  const presets = useQuiz((s) => s.presets)
  const activePresetId = useQuiz((s) => s.activePresetId)
  const savePreset = useQuiz((s) => s.savePreset)
  const activatePreset = useQuiz((s) => s.activatePreset)
  const deletePreset = useQuiz((s) => s.deletePreset)
  const updateSettings = useQuiz((s) => s.updateSettings)

  // editor draft — initialized from the live settings each time the modal opens
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [provider, setProvider] = useState<LLMProviderType>(settings.provider)
  const [apiKey, setApiKey] = useState(settings.apiKey ?? '')
  const [apiEndpoint, setApiEndpoint] = useState(settings.apiEndpoint ?? '')
  const [model, setModel] = useState(settings.model ?? '')
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null)
  const [lastOpen, setLastOpen] = useState(false)

  // on open transition: re-seed the editor from the live config
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      const active = presets.find((p) => p.id === activePresetId)
      setEditingId(active?.id ?? null)
      setName(active?.name ?? '')
      setProvider(settings.provider)
      setApiKey(settings.apiKey ?? '')
      setApiEndpoint(settings.apiEndpoint ?? '')
      setModel(settings.model ?? '')
      setTestResult(null)
    }
  }

  if (!open) return null

  const loadIntoEditor = (p: QuizPreset) => {
    setEditingId(p.id)
    setName(p.name)
    setProvider(p.provider)
    setApiKey(p.apiKey ?? '')
    setApiEndpoint(p.apiEndpoint ?? '')
    setModel(p.model ?? '')
    setTestResult(null)
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const p = createQuizProvider({
        provider,
        apiKey: apiKey.trim() || undefined,
        model: model.trim() || undefined,
        apiEndpoint: apiEndpoint.trim() || undefined,
        dailyQuestionCount: settings.dailyQuestionCount
      })
      setTestResult(await p.testConnection())
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : 'Bağlantı hatası' })
    } finally {
      setTesting(false)
    }
  }

  const draftConfig = () => ({
    provider,
    apiKey: apiKey.trim() || undefined,
    apiEndpoint: apiEndpoint.trim() || undefined,
    model: model.trim() || undefined
  })

  // "Yeni Set": save the editor as a named set — it becomes active at once,
  // so the quiz's Yeni Set button generates with this provider from now on.
  const handleSaveAsNewSet = () => {
    uiTap()
    const presetName =
      name.trim() || `${providerName(provider)} — ${new Date().toLocaleDateString('tr-TR')}`
    const preset = savePreset({ name: presetName, ...draftConfig() })
    setEditingId(preset.id)
    setName(preset.name)
  }

  // update an existing set in place (stays active if it already was)
  const handleUpdateSet = () => {
    if (!editingId) return
    uiTap()
    savePreset({ id: editingId, name: name.trim() || providerName(provider), ...draftConfig() })
  }

  const handleActivate = (p: QuizPreset) => {
    uiTap()
    activatePreset(p.id)
    loadIntoEditor(p)
  }

  // "Uygula": copy the editor straight into the live quiz config without
  // saving a named set — updateSettings detaches the active preset for us.
  const handleApply = () => {
    uiTap()
    updateSettings(draftConfig())
    setEditingId(null)
  }

  const inputCls =
    'flex h-8 w-full rounded-lg border border-[var(--border-default)] bg-n2 px-3 text-[12.5px] text-t1 placeholder:text-t4 focus:border-[var(--color-accent)] focus:outline-hidden'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 select-none animate-in fade-in duration-150"
      onClick={() => setOpen(false)}
    >
      <div
        className="flex w-full max-w-2xl flex-col rounded-2xl border border-[var(--border-default)] bg-base shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-3.5 bg-n2">
          <div className="flex items-center gap-2">
            <SettingsIcon size={15} className="text-[var(--color-accent)]" />
            <h2 className="text-[14px] font-semibold text-t1">Ayarlar</h2>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex h-6 w-6 items-center justify-center rounded text-t4 hover:bg-n4 hover:text-t1 transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <AppearanceSection />
        <JevSection />

        <div className="flex min-h-0 max-h-[70vh]">
          {/* ── saved sets ── */}
          <aside className="flex w-56 shrink-0 flex-col border-r border-[var(--border-subtle)] bg-n1">
            <div className="px-3.5 pt-3.5 pb-2">
              <div className="micro-label">Quiz AI Setleri</div>
              <p className="mt-1 text-[10.5px] leading-snug text-t4">
                Bir sete bas → aktif olur. Quiz'deki <b>Yeni Set</b> hep aktif seti kullanır.
              </p>
            </div>
            <div className="flex-1 overflow-y-auto scroll-thin px-2 pb-3">
              {presets.length === 0 && (
                <div className="rounded-lg border border-dashed border-[var(--border-subtle)] px-3 py-4 text-center text-[11px] text-t4">
                  Henüz set yok — sağdaki formu doldurup "Yeni Set"e bas.
                </div>
              )}
              {presets.map((p) => {
                const active = p.id === activePresetId
                return (
                  <div
                    key={p.id}
                    className={clsx(
                      'group mb-1 flex items-center gap-1 rounded-lg border px-2 py-1.5 transition-colors',
                      active
                        ? 'border-[var(--color-accent)] bg-n3'
                        : 'border-transparent hover:bg-n3'
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => handleActivate(p)}
                      title={active ? 'Aktif set' : 'Aktifleştir'}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <span
                        className={clsx(
                          'h-1.5 w-1.5 shrink-0 rounded-full',
                          active ? 'bg-[var(--color-accent)]' : 'bg-n5'
                        )}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-[12px] font-medium text-t1">
                          {p.name}
                        </span>
                        <span className="block truncate text-[10px] text-t4">
                          {providerName(p.provider)}
                          {p.model ? ` · ${p.model}` : ''}
                        </span>
                      </span>
                    </button>
                    {active && (
                      <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-[var(--color-accent)]">
                        aktif
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => deletePreset(p.id)}
                      title="Seti sil"
                      className="shrink-0 rounded p-1 text-t4 opacity-0 transition-opacity hover:text-[var(--color-needs)] group-hover:opacity-100"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                )
              })}
            </div>
          </aside>

          {/* ── editor ── */}
          <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto scroll-thin p-5">
            <div className="flex items-center gap-2">
              <Cpu size={14} className="text-[var(--color-accent)]" />
              <h3 className="text-[13px] font-semibold text-t1">
                {editingId ? 'Seti düzenle' : 'Yeni AI seti'}
              </h3>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-medium text-t2">Set adı</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ör. OpenRouter — Llama"
                className={inputCls}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-medium text-t2">Model Sağlayıcı</label>
              <div className="grid grid-cols-2 gap-1.5">
                {PROVIDER_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setProvider(opt.id)
                      if (opt.defaultModel && !model) setModel(opt.defaultModel)
                      setTestResult(null)
                    }}
                    className={clsx(
                      'rounded-lg border px-2.5 py-2 text-left transition-colors',
                      provider === opt.id
                        ? 'border-[var(--color-accent)] bg-n3'
                        : 'border-[var(--border-subtle)] bg-n1 hover:border-[var(--border-default)] hover:bg-n2'
                    )}
                  >
                    <div className="text-[12px] font-medium text-t1">{opt.name}</div>
                  </button>
                ))}
              </div>
            </div>

            {needsEndpoint(provider) && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-medium text-t2">
                  Endpoint URL{provider === 'custom' ? ' (zorunlu)' : ' (opsiyonel)'}
                </label>
                <input
                  type="text"
                  value={apiEndpoint}
                  onChange={(e) => setApiEndpoint(e.target.value)}
                  placeholder={
                    provider === 'ollama'
                      ? 'http://127.0.0.1:11434/api/generate'
                      : provider === 'custom'
                        ? 'https://openrouter.ai/api/v1/chat/completions'
                        : 'https://api.openai.com/v1/chat/completions'
                  }
                  className={clsx(inputCls, 'font-mono text-[12px]')}
                />
              </div>
            )}

            {needsKey(provider) && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-medium text-t2 flex items-center justify-between">
                  <span>API Key{provider === 'custom' ? ' (opsiyonel)' : ''}</span>
                  <span className="text-[11px] font-normal text-t4">yerel saklanır</span>
                </label>
                <div className="relative flex items-center">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-..."
                    className={clsx(inputCls, 'pr-8 font-mono')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2 text-t4 hover:text-t2 transition-colors"
                  >
                    {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
              </div>
            )}

            {provider !== 'builtin' && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-medium text-t2">
                  Model{provider === 'custom' ? ' (zorunlu)' : ''}
                </label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={
                    PROVIDER_OPTIONS.find((p) => p.id === provider)?.defaultModel ||
                    'ör. llama-3.3-70b-instruct'
                  }
                  className={clsx(inputCls, 'font-mono text-[12px]')}
                />
              </div>
            )}

            {/* test + actions */}
            <div className="mt-auto flex flex-col gap-3 pt-2">
              {provider !== 'builtin' && (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleTest()}
                    disabled={testing}
                    className="flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-n2 px-2.5 text-[11.5px] text-t2 hover:bg-n3 hover:text-t1 disabled:opacity-50 transition-colors"
                  >
                    {testing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                    Bağlantıyı Test Et
                  </button>
                  {testResult && (
                    <span
                      className={clsx(
                        'flex min-w-0 items-center gap-1.5 text-[11.5px]',
                        testResult.ok ? 'text-[var(--color-done)]' : 'text-[var(--color-needs)]'
                      )}
                    >
                      {testResult.ok ? <Check size={12} /> : <AlertCircle size={12} />}
                      <span className="truncate">{testResult.message}</span>
                    </span>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] pt-3">
                {editingId && (
                  <button
                    type="button"
                    onClick={handleUpdateSet}
                    className="flex h-8 items-center rounded-lg border border-[var(--border-default)] bg-n3 px-3 text-[12px] font-medium text-t2 hover:bg-n4 hover:text-t1 transition-colors"
                  >
                    Seti Güncelle
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleApply}
                  className="flex h-8 items-center rounded-lg border border-[var(--border-default)] bg-n2 px-3 text-[12px] font-medium text-t2 hover:bg-n3 hover:text-t1 transition-colors"
                >
                  Uygula
                </button>
                <button
                  type="button"
                  onClick={handleSaveAsNewSet}
                  className="flex h-8 items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-4 text-[12px] font-medium text-black hover:opacity-90 transition-transform active:scale-95"
                >
                  <Plus size={13} />
                  Yeni Set
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Görünüm — whole-app zoom (same factor as the titlebar pill / Ctrl+= -). */
function AppearanceSection() {
  const zoom = useAppZoom()
  const pct = Math.round(zoom.factor * 100)
  const [render, setRender] = useState<TerminalRenderMode>(terminalRenderMode)
  const modes: { id: TerminalRenderMode; label: string; hint: string }[] = [
    { id: 'auto', label: 'Otomatik', hint: 'Düşük yoğunluklu ekranda keskin metin, yüksekte GPU' },
    { id: 'crisp', label: 'Keskin', hint: 'Tarayıcı metni (ClearType) — her zoomda net' },
    { id: 'gpu', label: 'GPU', hint: 'WebGL — en hızlı, düşük DPI’da biraz yumuşak' }
  ]
  return (
    <div className="flex flex-col border-b border-[var(--border-subtle)] bg-n1">
    <div className="flex items-center gap-3 px-5 pt-3 pb-2">
      <ZoomIn size={14} className="shrink-0 text-[var(--color-accent)]" />
      <div className="w-36 shrink-0">
        <div className="text-[12.5px] font-medium text-t1">Uygulama zoom'u</div>
        <div className="text-[10.5px] leading-snug text-t4">
          {zoom.available ? 'Ctrl+= / Ctrl+- / Ctrl+0' : 'Uygulamayı bir kez yeniden başlatınca aktif olur'}
        </div>
      </div>
      <input
        type="range"
        min={APP_ZOOM_MIN * 100}
        max={APP_ZOOM_MAX * 100}
        step={5}
        value={pct}
        disabled={!zoom.available}
        onChange={(e) => zoom.set(Number(e.target.value) / 100)}
        className="min-w-0 flex-1 accent-[var(--color-accent)] disabled:opacity-40"
        aria-label="Uygulama zoom'u"
      />
      <span className="tnum w-11 shrink-0 text-right text-[12px] text-t2">{pct}%</span>
      <div className="flex shrink-0 gap-1">
        {APP_ZOOM_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            disabled={!zoom.available}
            onClick={() => zoom.set(p)}
            className={clsx(
              'h-6 rounded-md border px-1.5 text-[11px] transition-colors disabled:opacity-40',
              Math.abs(zoom.factor - p) < 0.001
                ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)] text-[var(--color-accent)]'
                : 'border-[var(--border-default)] text-t3 hover:text-t1'
            )}
          >
            {Math.round(p * 100)}
          </button>
        ))}
      </div>
    </div>
    <div className="flex items-center gap-3 px-5 pb-3">
      <span className="w-[14px] shrink-0" />
      <div className="w-36 shrink-0">
        <div className="text-[12.5px] font-medium text-t1">Terminal yazısı</div>
        <div className="text-[10.5px] leading-snug text-t4">Anında uygulanır</div>
      </div>
      <div className="flex gap-1">
        {modes.map((m) => (
          <button
            key={m.id}
            type="button"
            title={m.hint}
            onClick={() => {
              setRender(m.id)
              setTerminalRenderMode(m.id)
            }}
            className={clsx(
              'h-7 rounded-md border px-2.5 text-[11.5px] transition-colors',
              render === m.id
                ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)] text-[var(--color-accent)]'
                : 'border-[var(--border-default)] text-t3 hover:text-t1'
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
      <span className="min-w-0 flex-1 truncate text-[10.5px] text-t4">
        {modes.find((m) => m.id === render)?.hint}
      </span>
    </div>
    </div>
  )
}

/** Jev (TypeSafe AI) API key — stored by main in ~/.terrarium/.env; the
 * page only ever sees a masked tail, never the saved key. */
function JevSection() {
  const bridge = window.terrarium?.jevKey
  const [status, setStatus] = useState<JevKeyStatus | null>(null)
  const [draft, setDraft] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState<'save' | 'test' | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    void bridge?.status().then(setStatus).catch(() => {})
  }, [bridge])

  if (!bridge) return null

  const save = async (key: string) => {
    setBusy('save')
    setMsg(null)
    try {
      const st = await bridge.set(key)
      setStatus(st)
      setDraft('')
      setMsg({ ok: true, text: key ? 'Kaydedildi' : 'Anahtar kaldırıldı' })
    } catch (e) {
      setMsg({ ok: false, text: `Kaydedilemedi: ${String(e)}` })
    } finally {
      setBusy(null)
    }
  }

  const test = async () => {
    setBusy('test')
    setMsg(null)
    try {
      const r = await bridge.test()
      if (r.ok) setMsg({ ok: true, text: 'Bağlantı çalışıyor' })
      else if (r.restart) setMsg({ ok: false, text: 'Test için uygulamayı bir kez yeniden başlat' })
      else if (r.status === 401 || r.status === 403) setMsg({ ok: false, text: 'Anahtar geçersiz' })
      else setMsg({ ok: false, text: r.status ? `Hata ${r.status}` : (r.error ?? 'Bağlanamadı') })
    } finally {
      setBusy(null)
    }
  }

  const fromEnv = status?.source === 'env'
  return (
    <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] bg-n1 px-5 py-3">
      <KeyRound size={14} className="shrink-0 text-[var(--color-accent)]" />
      <div className="w-36 shrink-0">
        <div className="text-[12.5px] font-medium text-t1">Jev API anahtarı</div>
        <div className="text-[10.5px] leading-snug text-t4">
          {status?.configured
            ? `${status.masked}${fromEnv ? ' · ortam değişkeni' : ''}${status.enabled ? '' : ' · kapalı'}`
            : 'TypeSafe AI — bağlı değil'}
        </div>
      </div>
      <div className="relative min-w-0 flex-1">
        <input
          type={show ? 'text' : 'password'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) void save(draft)
          }}
          placeholder={status?.configured ? 'Yeni anahtar yapıştır…' : 'TYPESAFE_API_KEY yapıştır…'}
          spellCheck={false}
          autoComplete="off"
          disabled={fromEnv}
          className="h-7 w-full rounded-md border border-[var(--border-default)] bg-n2 pl-2.5 pr-8 text-[12px] text-t1 outline-none placeholder:text-t4 focus:border-[var(--color-accent)] disabled:opacity-40"
          aria-label="Jev API anahtarı"
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-t4 hover:text-t1"
          aria-label={show ? 'Gizle' : 'Göster'}
        >
          {show ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
      </div>
      <button
        type="button"
        disabled={!draft.trim() || busy !== null}
        onClick={() => void save(draft)}
        className="h-7 shrink-0 rounded-md border border-[var(--color-accent)] bg-[var(--color-accent-subtle)] px-2.5 text-[11.5px] text-[var(--color-accent)] transition-opacity disabled:opacity-40"
      >
        {busy === 'save' ? <Loader2 size={12} className="animate-spin" /> : 'Kaydet'}
      </button>
      <button
        type="button"
        disabled={!status?.configured || busy !== null}
        onClick={() => void test()}
        className="h-7 shrink-0 rounded-md border border-[var(--border-default)] px-2.5 text-[11.5px] text-t3 transition-colors hover:text-t1 disabled:opacity-40"
      >
        {busy === 'test' ? <Loader2 size={12} className="animate-spin" /> : 'Test et'}
      </button>
      {status?.configured && !fromEnv && (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void save('')}
          title="Kayıtlı anahtarı kaldır"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-t4 hover:bg-n4 hover:text-t1 disabled:opacity-40"
        >
          <Trash2 size={13} />
        </button>
      )}
      <span
        className={clsx(
          'flex w-40 shrink-0 items-center gap-1 truncate text-[10.5px]',
          msg ? (msg.ok ? 'text-[var(--color-done)]' : 'text-[var(--color-error)]') : 'text-t4'
        )}
      >
        {msg && (msg.ok ? <Check size={12} /> : <AlertCircle size={12} />)}
        {msg?.text ?? (fromEnv ? 'Ortam değişkeni öncelikli' : '')}
      </span>
    </div>
  )
}
