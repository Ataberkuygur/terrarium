// ── QuizSettingsModal: AI Model & API Key Configuration ─────────────────────

import { useState } from 'react'
import { X, Key, Cpu, Check, AlertCircle, Eye, EyeOff, Loader2, Sparkles } from 'lucide-react'
import type { LLMProviderType } from '@shared/quiz'
import { useQuiz } from '../lib/quiz/quiz-store'
import { createQuizProvider } from '../lib/quiz/llm-provider'
import { uiTap } from '../lib/sfx'
import clsx from 'clsx'

export const PROVIDER_OPTIONS: {
  id: LLMProviderType
  name: string
  desc: string
  defaultModel: string
}[] = [
  {
    id: 'builtin',
    name: 'Dahili Soru Bankası (Çevrimdışı)',
    desc: 'API anahtarı gerektirmez. Terrarium mimari dokümanlarına göre 20 soru üretir.',
    defaultModel: ''
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    desc: 'Google AI Studio API anahtarınızı kullanarak wiki sayfalarından dinamik sorular üretir.',
    defaultModel: 'gemini-1.5-flash'
  },
  {
    id: 'openai',
    name: 'OpenAI (GPT-4o)',
    desc: 'OpenAI API anahtarınızı kullanarak quiz hazırlar.',
    defaultModel: 'gpt-4o-mini'
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    desc: 'Claude Sonnet 5 modeliyle derinlemesine mimari sorular üretir.',
    defaultModel: 'claude-sonnet-5'
  },
  {
    id: 'ollama',
    name: 'Ollama (Yerel)',
    desc: 'Bilgisayarınızda çalışan yerel açık kaynaklı model (127.0.0.1:11434).',
    defaultModel: 'llama3.2'
  },
  {
    id: 'custom',
    name: 'Custom Endpoint (OpenAI-uyumlu)',
    desc: 'OpenRouter, Groq, LM Studio, LiteLLM vb. — kendi chat/completions adresiniz.',
    defaultModel: ''
  }
]

export function QuizSettingsModal() {
  const settings = useQuiz((s) => s.settings)
  const updateSettings = useQuiz((s) => s.updateSettings)
  const settingsOpen = useQuiz((s) => s.settingsOpen)
  const setSettingsOpen = useQuiz((s) => s.setSettingsOpen)
  const regenerateTodaySession = useQuiz((s) => s.regenerateTodaySession)

  const [provider, setProvider] = useState<LLMProviderType>(settings.provider)
  const [apiKey, setApiKey] = useState(settings.apiKey ?? '')
  const [model, setModel] = useState(settings.model ?? '')
  const [apiEndpoint, setApiEndpoint] = useState(settings.apiEndpoint ?? '')
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null)

  if (!settingsOpen) return null

  const handleProviderChange = (newP: LLMProviderType) => {
    setProvider(newP)
    const opt = PROVIDER_OPTIONS.find((p) => p.id === newP)
    if (opt && opt.defaultModel && !model) {
      setModel(opt.defaultModel)
    }
    setTestResult(null)
  }

  const handleTestConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const p = createQuizProvider({
        provider,
        apiKey,
        model,
        apiEndpoint,
        dailyQuestionCount: 20
      })
      const res = await p.testConnection()
      setTestResult(res)
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : 'Bağlantı hatası' })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = () => {
    uiTap()
    updateSettings({
      provider,
      apiKey: apiKey.trim() || undefined,
      model: model.trim() || undefined,
      apiEndpoint: apiEndpoint.trim() || undefined
    })
    setSettingsOpen(false)
  }

  const handleSaveAndRegenerate = async () => {
    handleSave()
    await regenerateTodaySession()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[6px] select-none">
      <div className="pop-in flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--border-default)] bg-popover shadow-[var(--shadow-pop)]">
        {/* ── Modal Header ── */}
        <div className="pane-head flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-[rgba(245,165,36,0.22)] bg-accent-subtle text-accent">
              <Cpu size={14} strokeWidth={1.8} />
            </span>
            <h2 className="text-[13.5px] font-semibold tracking-[-0.01em] text-t1">Quiz Model & API Ayarları</h2>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(false)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-t3 transition-colors hover:bg-n4 hover:text-t1"
          >
            <X size={14} />
          </button>
        </div>

        {/* ── Modal Body ── */}
        <div className="scroll-thin flex max-h-[75vh] flex-col gap-5 overflow-y-auto p-5">
          {/* Provider Selection */}
          <div className="flex flex-col gap-2">
            <label className="micro-label">Model Sağlayıcı (Provider)</label>
            <div className="grid grid-cols-1 gap-1.5">
              {PROVIDER_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleProviderChange(opt.id)}
                  className={clsx(
                    'flex flex-col rounded-[10px] border px-3 py-2.5 text-left transition-all',
                    provider === opt.id
                      ? 'ring-focus border-transparent bg-n3'
                      : 'border-[var(--border-subtle)] bg-n2/60 hover:border-[var(--border-default)] hover:bg-n3'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12.5px] font-medium text-t1">{opt.name}</span>
                    <span
                      className={clsx(
                        'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border transition-colors',
                        provider === opt.id ? 'border-accent bg-accent' : 'border-n8'
                      )}
                    >
                      {provider === opt.id && <span className="h-1.5 w-1.5 rounded-full bg-on-accent" />}
                    </span>
                  </div>
                  <span className="mt-0.5 text-[11.5px] leading-[16px] text-t3">{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* API Key Input (if not builtin/ollama — optional on custom) */}
          {provider !== 'builtin' && provider !== 'ollama' && (
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center justify-between text-[12px] font-medium text-t2">
                <span>API Anahtarı (API Key)</span>
                <span className="text-[11px] font-normal text-t4">Yerel olarak saklanır</span>
              </label>
              <div className="relative flex items-center">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    provider === 'gemini'
                      ? 'AIzaSy...'
                      : provider === 'openai'
                        ? 'sk-proj-...'
                        : provider === 'custom'
                          ? 'sk-or-... (opsiyonel)'
                          : 'sk-ant-...'
                  }
                  className="flex h-8 w-full rounded-lg border border-[var(--border-default)] bg-n1/70 px-3 pr-9 font-mono text-[12px] text-t1 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] transition-colors placeholder:text-t4 focus:border-[rgba(245,165,36,0.5)] focus:outline-hidden"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-1 flex h-6 w-6 items-center justify-center rounded-md text-t4 transition-colors hover:bg-n4 hover:text-t1"
                >
                  {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
            </div>
          )}

          {/* Model Name Input */}
          {provider !== 'builtin' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-medium text-t2">Model İsmi</label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={
                  PROVIDER_OPTIONS.find((p) => p.id === provider)?.defaultModel || 'Model adı'
                }
                className="flex h-8 w-full rounded-lg border border-[var(--border-default)] bg-n1/70 px-3 font-mono text-[12px] text-t1 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] transition-colors placeholder:text-t4 focus:border-[rgba(245,165,36,0.5)] focus:outline-hidden"
              />
            </div>
          )}

          {/* Custom Endpoint Input (Ollama / OpenAI-compatible / custom) */}
          {(provider === 'ollama' || provider === 'openai' || provider === 'custom') && (
            <div className="flex flex-col gap-1.5">
              <label className="flex items-center justify-between text-[12px] font-medium text-t2">
                <span>
                  Özel Sunucu / Endpoint{provider === 'custom' ? ' (zorunlu)' : ' (Opsiyonel)'}
                </span>
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
                className="flex h-8 w-full rounded-lg border border-[var(--border-default)] bg-n1/70 px-3 font-mono text-[12px] text-t1 shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] transition-colors placeholder:text-t4 focus:border-[rgba(245,165,36,0.5)] focus:outline-hidden"
              />
            </div>
          )}

          {/* Test Connection Button & Result */}
          {provider !== 'builtin' && (
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testing}
                className="flex h-7 items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-n2 px-2.5 text-[12px] text-t2 transition-colors hover:bg-n4 hover:text-t1 disabled:opacity-50"
              >
                {testing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                <span>Bağlantıyı Test Et</span>
              </button>

              {testResult && (
                <div
                  className={clsx(
                    'flex items-center gap-1.5 text-[11.5px] font-medium',
                    testResult.ok ? 'text-[var(--color-done)]' : 'text-[var(--color-needs)]'
                  )}
                >
                  {testResult.ok ? <Check size={13} /> : <AlertCircle size={13} />}
                  <span className="truncate max-w-[240px]">{testResult.message}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Modal Footer ── */}
        <div className="flex items-center justify-between border-t border-[var(--border-subtle)] bg-n2/70 px-5 py-3">
          <button
            type="button"
            onClick={() => setSettingsOpen(false)}
            className="flex h-8 items-center rounded-lg px-3 text-[12px] font-medium text-t3 transition-colors hover:bg-n4 hover:text-t1"
          >
            İptal
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSaveAndRegenerate}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-n3 px-3 text-[12px] font-medium text-t2 transition-colors hover:bg-n4 hover:text-t1"
              title="Ayarları kaydeder ve bugünkü quiz için yeni sorular üretir"
            >
              <span>Kaydet & Yeniden Üret</span>
            </button>

            <button
              type="button"
              onClick={handleSave}
              className="flex h-8 items-center rounded-lg bg-accent px-4 text-[12px] font-semibold text-on-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_1px_2px_rgba(0,0,0,0.35)] transition-[background-color,transform] hover:bg-accent-hover active:scale-[0.97]"
            >
              Kaydet
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
