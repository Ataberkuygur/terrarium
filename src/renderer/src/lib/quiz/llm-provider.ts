// ── LLM Providers for Daily Quiz Generation ─────────────────────────────────
// Connects to Gemini, OpenAI, Claude, Ollama, or uses the Built-in offline bank.

import type { LLMProviderType, QuizQuestion, QuizSettings } from '@shared/quiz'
import type { WikiPageMeta } from '@shared/types'
import { CATEGORY_LABELS, getDailyQuestions } from './builtin-bank'

export interface ProviderContext {
  dateStr: string
  wikiPages: WikiPageMeta[]
  wikiBodies?: string[]
  count: number
}

export interface LLMProvider {
  type: LLMProviderType
  name: string
  generateQuestions(ctx: ProviderContext): Promise<QuizQuestion[]>
  testConnection(): Promise<{ ok: boolean; message?: string }>
}

const SYSTEM_PROMPT = `Sen Terrarium masaüstü uygulaması için günlük quiz üreten uzman bir yazılım eğitmenisin.
Kullanıcıya Terrarium'nin Electron, React 19, TypeScript, node:sqlite, pty-host, 3D Office ve Wiki dokümanları hakkında 4 şıklı çoktan seçmeli Türkçe quiz soruları hazırlayacaksın.
Çıktın tek bir JSON nesnesidir; sorular \`questions\` dizisindedir.

JSON formatı:
{
  "questions": [
    {
      "category": "architecture",
      "sourceTitle": "ARCHITECTURE.md › Konu Adı",
      "question": "Soru metni...",
      "codeSnippet": "// opsiyonel kod örneği",
      "options": ["A şıkkı", "B şıkkı", "C şıkkı", "D şıkkı"],
      "correctIndex": 0,
      "explanation": "Detaylı açıklama: Neden bu şık doğru ve diğerleri ne işe yarar?",
      "difficulty": "intermediate"
    }
  ]
}
`

/** Parses LLM text response into valid QuizQuestion array with fallback */
function parseQuestionsResponse(text: string, fallbackDate: string, count: number): QuizQuestion[] {
  try {
    let clean = text.trim()
    if (clean.startsWith('```json')) {
      clean = clean.replace(/^```json\s*/i, '').replace(/\s*```$/, '')
    } else if (clean.startsWith('```')) {
      clean = clean.replace(/^```\s*/, '').replace(/\s*```$/, '')
    }

    const parsed: unknown = JSON.parse(clean)
    const list = Array.isArray(parsed)
      ? parsed
      : (parsed as { questions?: unknown } | null)?.questions
    if (!Array.isArray(list)) throw new Error('Response has no questions array')

    const questions: QuizQuestion[] = []
    for (let i = 0; i < list.length && questions.length < count; i++) {
      const q = list[i] as Record<string, unknown>
      if (typeof q.question !== 'string' || !Array.isArray(q.options) || q.options.length < 4) {
        continue
      }
      const cat = (typeof q.category === 'string' && q.category in CATEGORY_LABELS ? q.category : 'architecture') as keyof typeof CATEGORY_LABELS
      const options = q.options.slice(0, 4).map(String) as [string, string, string, string]
      const correctIndex = typeof q.correctIndex === 'number' && q.correctIndex >= 0 && q.correctIndex <= 3 ? (q.correctIndex as 0 | 1 | 2 | 3) : 0

      questions.push({
        id: `llm-${Date.now()}-${i}`,
        category: cat,
        categoryLabel: CATEGORY_LABELS[cat] ?? 'Genel Mimari',
        sourceTitle: typeof q.sourceTitle === 'string' ? q.sourceTitle : 'Wiki & Kod Tabanı',
        question: q.question,
        codeSnippet: typeof q.codeSnippet === 'string' ? q.codeSnippet : undefined,
        options,
        correctIndex,
        explanation: typeof q.explanation === 'string' ? q.explanation : 'Doğru cevap bu seçenektir.',
        difficulty: 'intermediate'
      })
    }

    if (questions.length >= count) return questions
  } catch (err) {
    console.warn('[Quiz] LLM response parse failed, falling back to built-in bank:', err)
  }

  // If LLM returned fewer than requested or errored, fill with built-in bank
  return getDailyQuestions(fallbackDate, [], count, 'llm-fallback')
}

// ── 1. Built-in Provider (Zero config, offline) ────────────────────────────

export class BuiltinProvider implements LLMProvider {
  type: LLMProviderType = 'builtin'
  name = 'Dahili Soru Bankası (Çevrimdışı)'

  async generateQuestions(ctx: ProviderContext): Promise<QuizQuestion[]> {
    return Promise.resolve(getDailyQuestions(ctx.dateStr, ctx.wikiPages, ctx.count))
  }

  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    return Promise.resolve({ ok: true, message: 'Dahili soru motoru her zaman hazırdır.' })
  }
}

// ── 2. Google Gemini Provider ──────────────────────────────────────────────

export class GeminiProvider implements LLMProvider {
  type: LLMProviderType = 'gemini'
  name = 'Google Gemini'

  constructor(private settings: QuizSettings) {}

  async generateQuestions(ctx: ProviderContext): Promise<QuizQuestion[]> {
    const key = this.settings.apiKey?.trim()
    if (!key) throw new Error('Gemini API Key bulunamadı. Lütfen ayarlardan giriniz.')

    const model = this.settings.model?.trim() || 'gemini-1.5-flash'
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`

    const docContext = ctx.wikiPages.map((p) => `- ${p.title} (${p.type}): ${p.path}`).join('\n')
    const prompt = `Lütfen Terrarium kod tabanını ve şu wiki dokümanlarını temel alarak ${ctx.count} adet quiz sorusu üret:\n${docContext}`

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: `${SYSTEM_PROMPT}\n\n${prompt}` }] }
        ],
        generationConfig: {
          responseMimeType: 'application/json'
        }
      })
    })

    if (!res.ok) {
      const errBody = await res.text()
      throw new Error(`Gemini API hatası (${res.status}): ${errBody}`)
    }

    const data = await res.json()
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    return parseQuestionsResponse(content, ctx.dateStr, ctx.count)
  }

  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    const key = this.settings.apiKey?.trim()
    if (!key) return { ok: false, message: 'Lütfen bir Gemini API anahtarı giriniz.' }
    try {
      const model = this.settings.model?.trim() || 'gemini-1.5-flash'
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}?key=${key}`
      const res = await fetch(url)
      if (res.ok) return { ok: true, message: 'Gemini bağlantısı başarılı!' }
      const err = await res.text()
      return { ok: false, message: `Bağlantı hatası: ${err}` }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'Bağlantı kurulamadı' }
    }
  }
}

// ── 3. OpenAI Provider ────────────────────────────────────────────────────

export class OpenAIProvider implements LLMProvider {
  type: LLMProviderType = 'openai'
  name = 'OpenAI'

  constructor(private settings: QuizSettings) {}

  async generateQuestions(ctx: ProviderContext): Promise<QuizQuestion[]> {
    const key = this.settings.apiKey?.trim()
    if (!key) throw new Error('OpenAI API Key bulunamadı. Lütfen ayarlardan giriniz.')

    const endpoint = this.settings.apiEndpoint?.trim() || 'https://api.openai.com/v1/chat/completions'
    const model = this.settings.model?.trim() || 'gpt-4o-mini'

    const docContext = ctx.wikiPages.map((p) => `- ${p.title} (${p.type})`).join('\n')
    const prompt = `Lütfen Terrarium kod tabanını ve şu wiki dokümanlarını temel alarak ${ctx.count} adet quiz sorusu üret:\n${docContext}`

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' }
      })
    })

    if (!res.ok) {
      const errBody = await res.text()
      throw new Error(`OpenAI API hatası (${res.status}): ${errBody}`)
    }

    const data = await res.json()
    const content = data.choices?.[0]?.message?.content ?? ''
    return parseQuestionsResponse(content, ctx.dateStr, ctx.count)
  }

  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    const key = this.settings.apiKey?.trim()
    if (!key) return { ok: false, message: 'Lütfen bir OpenAI API anahtarı giriniz.' }
    try {
      const endpoint = this.settings.apiEndpoint?.trim() || 'https://api.openai.com/v1/models'
      const res = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${key}` }
      })
      if (res.ok) return { ok: true, message: 'OpenAI bağlantısı başarılı!' }
      return { ok: false, message: `Bağlantı hatası: ${res.statusText}` }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'Bağlantı kurulamadı' }
    }
  }
}

// ── 4. Anthropic Provider ─────────────────────────────────────────────────

const QUIZ_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          sourceTitle: { type: 'string' },
          question: { type: 'string' },
          codeSnippet: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          correctIndex: { type: 'integer' },
          explanation: { type: 'string' },
          difficulty: { type: 'string' }
        },
        required: ['category', 'sourceTitle', 'question', 'options', 'correctIndex', 'explanation', 'difficulty'],
        additionalProperties: false
      }
    }
  },
  required: ['questions'],
  additionalProperties: false
}

export class AnthropicProvider implements LLMProvider {
  type: LLMProviderType = 'anthropic'
  name = 'Anthropic Claude'

  constructor(private settings: QuizSettings) {}

  async generateQuestions(ctx: ProviderContext): Promise<QuizQuestion[]> {
    const key = this.settings.apiKey?.trim()
    if (!key) throw new Error('Anthropic API Key bulunamadı. Lütfen ayarlardan giriniz.')

    const model = this.settings.model?.trim() || 'claude-sonnet-5'
    const endpoint = this.settings.apiEndpoint?.trim() || 'https://api.anthropic.com/v1/messages'

    const docContext = ctx.wikiPages.map((p) => `- ${p.title} (${p.type})`).join('\n')
    const prompt = `Lütfen Terrarium kod tabanını ve şu wiki dokümanlarını temel alarak ${ctx.count} adet quiz sorusu üret:\n${docContext}`

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 32000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
        output_config: { format: { type: 'json_schema', schema: QUIZ_SCHEMA } }
      })
    })

    if (!res.ok) {
      const errBody = await res.text()
      throw new Error(`Anthropic API hatası (${res.status}): ${errBody}`)
    }

    const data = await res.json()
    // Thinking is on by default, so content[0] may be a thinking block.
    const content =
      (data.content as { type: string; text?: string }[] | undefined)?.find((b) => b.type === 'text')?.text ?? ''
    return parseQuestionsResponse(content, ctx.dateStr, ctx.count)
  }

  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    const key = this.settings.apiKey?.trim()
    if (!key) return { ok: false, message: 'Lütfen bir Anthropic API anahtarı giriniz.' }
    return { ok: true, message: 'Anahtar kaydedildi (istek anında doğrulanır).' }
  }
}

// ── 5. Custom Provider (OpenAI-compatible endpoint) ───────────────────────
// Any chat/completions-style API: OpenRouter, Groq, Together, LM Studio,
// LiteLLM proxies, vLLM servers… API key is optional (local servers often
// need none) and the endpoint URL is required.

export class CustomProvider implements LLMProvider {
  type: LLMProviderType = 'custom'
  name = 'Custom Endpoint (OpenAI-uyumlu)'

  constructor(private settings: QuizSettings) {}

  async generateQuestions(ctx: ProviderContext): Promise<QuizQuestion[]> {
    const endpoint = this.settings.apiEndpoint?.trim()
    if (!endpoint) throw new Error('Özel endpoint girilmemiş. Ayarlardan endpoint ekleyin.')
    const model = this.settings.model?.trim()
    if (!model) throw new Error('Model ismi girilmemiş. Ayarlardan model ekleyin.')

    const key = this.settings.apiKey?.trim()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (key) headers.Authorization = `Bearer ${key}`

    const docContext = ctx.wikiPages.map((p) => `- ${p.title} (${p.type})`).join('\n')
    const prompt = `Lütfen Terrarium kod tabanını ve şu wiki dokümanlarını temel alarak ${ctx.count} adet quiz sorusu üret:\n${docContext}`

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ]
      })
    })

    if (!res.ok) {
      const errBody = await res.text()
      throw new Error(`Custom endpoint hatası (${res.status}): ${errBody}`)
    }

    const data = await res.json()
    const content = data.choices?.[0]?.message?.content ?? data.response ?? ''
    return parseQuestionsResponse(content, ctx.dateStr, ctx.count)
  }

  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    const endpoint = this.settings.apiEndpoint?.trim()
    if (!endpoint) return { ok: false, message: 'Lütfen bir endpoint URL giriniz.' }
    const model = this.settings.model?.trim()
    const key = this.settings.apiKey?.trim()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (key) headers.Authorization = `Bearer ${key}`
    try {
      // minimal chat probe — some servers 4xx on tiny bodies, so any HTTP
      // response at all still proves reachability; only 200 means "works".
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: model || 'test',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1
        })
      })
      if (res.ok) return { ok: true, message: 'Endpoint yanıt verdi — bağlantı başarılı!' }
      const err = await res.text()
      return { ok: false, message: `HTTP ${res.status}: ${err.slice(0, 140)}` }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'Bağlantı kurulamadı' }
    }
  }
}

// ── 6. Ollama Provider (Local) ────────────────────────────────────────────

export class OllamaProvider implements LLMProvider {
  type: LLMProviderType = 'ollama'
  name = 'Ollama (Yerel)'

  constructor(private settings: QuizSettings) {}

  async generateQuestions(ctx: ProviderContext): Promise<QuizQuestion[]> {
    const endpoint = this.settings.apiEndpoint?.trim() || 'http://127.0.0.1:11434/api/generate'
    const model = this.settings.model?.trim() || 'llama3.2'

    const docContext = ctx.wikiPages.map((p) => `- ${p.title}`).join('\n')
    const prompt = `${SYSTEM_PROMPT}\n\nTerrarium wiki dokümanları:\n${docContext}\n\nLütfen ${ctx.count} soru üret.`

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        format: 'json'
      })
    })

    if (!res.ok) {
      const errBody = await res.text()
      throw new Error(`Ollama hatası (${res.status}): ${errBody}`)
    }

    const data = await res.json()
    return parseQuestionsResponse(data.response ?? '', ctx.dateStr, ctx.count)
  }

  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    try {
      const base = (this.settings.apiEndpoint || 'http://127.0.0.1:11434').replace(/\/api\/.*$/, '')
      const res = await fetch(`${base}/api/tags`)
      if (res.ok) return { ok: true, message: 'Yerel Ollama sunucusu aktif ve erişilebilir!' }
      return { ok: false, message: `Ollama yanıt vermedi: ${res.statusText}` }
    } catch (e) {
      return { ok: false, message: 'Ollama sunucusuna bağlanılamadı (127.0.0.1:11434)' }
    }
  }
}

/** Factory function to create appropriate provider based on settings */
export function createQuizProvider(settings: QuizSettings): LLMProvider {
  switch (settings.provider) {
    case 'gemini':
      return new GeminiProvider(settings)
    case 'openai':
      return new OpenAIProvider(settings)
    case 'anthropic':
      return new AnthropicProvider(settings)
    case 'ollama':
      return new OllamaProvider(settings)
    case 'custom':
      return new CustomProvider(settings)
    case 'builtin':
    default:
      return new BuiltinProvider()
  }
}
