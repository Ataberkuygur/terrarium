// ── Built-in Knowledge Bank & Daily Shuffler ──────────────────────────────
// Teaches the Terrarium codebase architecture, subsystems, and Wiki docs.
// Can be used offline without any API key, and guarantees 20 daily questions.

import type { QuizCategory, QuizQuestion } from '@shared/quiz'
import type { WikiPageMeta } from '@shared/types'

export const CATEGORY_LABELS: Record<QuizCategory, string> = {
  architecture: 'Mimari & Süreç Modeli',
  process_model: 'Electron Süreçleri',
  engine_sqlite: 'SQLite & Engine',
  pty_terminal: 'PTY & Terminal',
  workspace_panes: 'Workspace & Paneller',
  office_3d: '3D Ofis & Sahne',
  voice_cuda: 'Ses & Whisper CUDA',
  git_worktrees: 'Git & Worktree',
  wiki_docs: 'Wiki & Dokümantasyon'
}

/** Rich, curated architectural questions covering the entire Terrarium codebase */
export const ARCHITECTURAL_QUESTIONS: QuizQuestion[] = [
  {
    id: 'arch-1',
    category: 'process_model',
    categoryLabel: CATEGORY_LABELS.process_model,
    sourceTitle: 'ARCHITECTURE.md › 1. Process model',
    question: "Terrarium'de node-pty oturumları neden doğrudan Main sürecinde değil de ayrı bir `pty-host` (utilityProcess) sürecinde çalıştırılır?",
    options: [
      'Performansı artırmak ve xterm arayüzünü Three.js sahnesiyle senkronize etmek için.',
      'Herhangi bir terminal çökmesinin veya ağır I/O çıktısının Main sürecini kilitlemesini önlemek (crash & I/O isolation).',
      'Windows PowerShell izinlerini atlatmak ve yönetici hakları kazanmak için.',
      'Renderer sürecinin doğrudan node.js modüllerine erişebilmesini sağlamak için.'
    ],
    correctIndex: 1,
    explanation: 'pty-host, Electron utilityProcess olarak çalışır. 16KB/8ms arabellek ile çıktıları gruplar ve terminalde ağır bir işlem çökse bile Main ve Renderer süreçlerinin kesintisiz çalışmasını garanti eder.',
    wikiPageId: 'wp-arch',
    difficulty: 'intermediate'
  },
  {
    id: 'arch-2',
    category: 'workspace_panes',
    categoryLabel: CATEGORY_LABELS.workspace_panes,
    sourceTitle: 'ARCHITECTURE.md › Workspace subsystem',
    question: "Workspace panellerinde binary-split (ikili bölme) ağacı nerede ve nasıl yönetilir?",
    options: [
      'React state içinde doğrudan DOM düğümleri olarak saklanır.',
      'Electron Main sürecindeki SQLite veritabanında her karede güncellenir.',
      'lib/panes.ts içerisinde saf TypeScript (React ve DOM bağımsız) fonksiyonel bir ağaç yapısı olarak yönetilir.',
      'Harici bir grid kütüphanesi (CSS Grid Layout) tarafından otomatik hesaplanır.'
    ],
    correctIndex: 2,
    explanation: 'lib/panes.ts tamamen saf TypeScript mantığıdır. DOM veya React bağımlılığı yoktur; her bölme/kapatma/oran işlemi yeni ve yapısal olarak paylaşılan (immutable) bir ağaç döndürür.',
    difficulty: 'intermediate'
  },
  {
    id: 'arch-3',
    category: 'engine_sqlite',
    categoryLabel: CATEGORY_LABELS.engine_sqlite,
    sourceTitle: 'ARCHITECTURE.md › SQLite office record',
    question: "Terrarium'de veri tabanı motoru olarak ne kullanılır ve şema güncellemeleri nasıl yapılır?",
    options: [
      'Prisma ORM ile PostgreSQL sunucusuna bağlanılır.',
      'Node 24 yerel `node:sqlite` modülü kullanılır ve PRAGMA user_version ile sıralı numaralandırılmış migration dosyaları çalıştırılır.',
      'Tarayıcı içi IndexedDB kullanılır ve LocalStorage ile yedeklenir.',
      'MongoDB ve Mongoose kütüphanesi ile JSON belgeleri saklanır.'
    ],
    correctIndex: 1,
    explanation: 'Terrarium, harici bir native C++ bağımlılığına ihtiyaç duymadan Node 24 ile gelen yerleşik `node:sqlite` ve FTS5 desteğini kullanır. Şema değişiklikleri append-only migrationlar halinde uygulanır.',
    wikiPageId: 'wp-arch',
    difficulty: 'intermediate'
  },
  {
    id: 'arch-4',
    category: 'workspace_panes',
    categoryLabel: CATEGORY_LABELS.workspace_panes,
    sourceTitle: 'ARCHITECTURE.md › Browser panes',
    question: "BrowserPane webview misafirlerinin güvenliği Electron Main sürecinde nasıl kilitlenir?",
    options: [
      'Tüm internet trafiği engellenir ve yalnızca localhost izin verilir.',
      'will-attach-webview olayında http(s) dışı şemalar reddedilir, nodeIntegration kapatılır, contextIsolation ve sandbox açılır ve `persist:terrarium-browse` partisyonuna izole edilir.',
      'Chrome uzantıları yüklenerek güvenlik duvarı oluşturulur.',
      'Webview yerine sadece standart iframe kullanılır.'
    ],
    correctIndex: 1,
    explanation: 'src/main/index.ts içinde `will-attach-webview` dinleyicisi misafirleri `persist:terrarium-browse` partisyonunda sandbox=true, nodeIntegration=false ve contextIsolation=true olarak kilitler.',
    difficulty: 'advanced'
  },
  {
    id: 'arch-5',
    category: 'voice_cuda',
    categoryLabel: CATEGORY_LABELS.voice_cuda,
    sourceTitle: 'ARCHITECTURE.md › Voice subsystem',
    question: "Terrarium'deki ses motoru hangi modeli kullanır ve küresel olarak hangi kısayolla tetiklenir?",
    options: [
      'OpenAI Whisper API kullanır ve Ctrl+Space ile çalışır.',
      'Web Speech API kullanır ve mikrofon ikonuna tıklanarak başlatılır.',
      'Yerel Python tabanlı `whisper-large-v3-turbo` (NVIDIA CUDA float16) motorunu kullanır ve global `F8` tuşuyla mikrofonu dinler.',
      'Google Gemini Live audio stream kullanır ve F12 ile tetiklenir.'
    ],
    correctIndex: 2,
    explanation: 'Voice altyapısı, NVIDIA CUDA donanım hızlandırmasıyla (~180ms gecikme) yerel `whisper-large-v3-turbo` modelini çalıştırır ve global F8 tuşuna basılı tutulduğunda aktif terminale yazar.',
    difficulty: 'intermediate'
  },
  {
    id: 'arch-6',
    category: 'pty_terminal',
    categoryLabel: CATEGORY_LABELS.pty_terminal,
    sourceTitle: 'ARCHITECTURE.md › pty subsystem',
    question: "Terminal pty oturumu yeniden bağlandığında (attach) terminal ekranındaki bozulmaları önlemek için ne kullanılır?",
    options: [
      'Terminal tamamen kapatılıp yeniden başlatılır.',
      '256KB ring-buffer kaydırması, soft-reset ve imleç kurtarma dizisi (PTY_ATTACH_RESET_SEQ) ile baştan oynatılır (replay).',
      'Ekran görüntüsü alınarak arka plana resim olarak yerleştirilir.',
      'Xterm yerine sadece HTML `<textarea>` bileşeni kullanılır.'
    ],
    correctIndex: 1,
    explanation: 'Her oturum pty-host üzerinde 256KB ring buffer tutar. Pane yeniden odaklandığında veya monte edildiğinde `PTY_ATTACH_RESET_SEQ` ile xterm ekranı temiz bir şekilde baştan oynatılır.',
    difficulty: 'advanced'
  },
  {
    id: 'arch-7',
    category: 'office_3d',
    categoryLabel: CATEGORY_LABELS.office_3d,
    sourceTitle: 'ARCHITECTURE.md › 3D Office',
    question: "Ofis görünümündeki 3D diorama sahnesi hangi kütüphanelerle render edilir?",
    options: [
      'Unity WebGL ve WebAssembly.',
      'Three.js, React Three Fiber (@react-three/fiber) ve Drei (@react-three/drei).',
      'HTML5 2D Canvas ve CSS 3D Transforms.',
      'Babylon.js ve WebGPU.'
    ],
    correctIndex: 1,
    explanation: '3D Ofis görünümü React Three Fiber (R3F) ve Drei bileşenleriyle Three.js sahnesi oluşturur; ajan masaları, bölmeler, karakter animasyonları ve ışıklandırmaları prosedürel olarak üretir.',
    difficulty: 'beginner'
  },
  {
    id: 'arch-8',
    category: 'git_worktrees',
    categoryLabel: CATEGORY_LABELS.git_worktrees,
    sourceTitle: 'ARCHITECTURE.md › git worktrees',
    question: "Ajanların kod üzerinde çalışırken ana repoyu bozmamasını sağlayan mekanizma nedir?",
    options: [
      'Her ajan için uzak sunucuda ayrı bir VPS açılır.',
      'Git worktree altyapısı ile her göreve (`run`) özel izole bir çalışma dizini ve dal açılır.',
      'Dosyalar geçici bir zip arşivinde kopyalanır.',
      'Ajanların kod değiştirmesine izin verilmez, sadece okuyabilirler.'
    ],
    correctIndex: 1,
    explanation: 'Terrarium `git worktree` özelliğini kullanır. Her run için bağımsız bir çalışma ağacı ve branch tahsis edilir, böylece ajanlar birbirlerinin veya kullanıcının çalışma alanını etkilemez.',
    difficulty: 'intermediate'
  },
  {
    id: 'arch-9',
    category: 'architecture',
    categoryLabel: CATEGORY_LABELS.architecture,
    sourceTitle: 'ARCHITECTURE.md › Trust boundaries',
    question: "Renderer süreci ile Main süreci arasındaki iletişim kuralı nedir?",
    options: [
      'Renderer doğrudan Node.js `fs` ve `child_process` modüllerini `require` edebilir.',
      'Renderer hiçbir Node modülüne doğrudan erişemez; sadece preload script tarafından `contextBridge` ile enjekte edilen `window.terrarium` API üzerinden IPC çağrıları yapar.',
      'İki süreç WebSocket üzerinden bir bulut sunucusunda haberleşir.',
      'Renderer LocalStorage üzerinden Main sürecine komut bırakır.'
    ],
    correctIndex: 1,
    explanation: 'Terrarium sıkı Electron güvenlik modelini uygular: Renderer sandboxed çalışır, `nodeIntegration: false` ve `contextIsolation: true` aktiftir. Tek köprü `window.terrarium` nesnesidir.',
    difficulty: 'beginner'
  },
  {
    id: 'arch-10',
    category: 'workspace_panes',
    categoryLabel: CATEGORY_LABELS.workspace_panes,
    sourceTitle: 'src/renderer/src/lib/panes.ts › Tidy rebalancing',
    question: "Workspace'teki 'Tidy' (Ctrl+Shift+T) butonu ne işe yarar?",
    options: [
      'Tüm terminalleri kapatıp boş bir masaüstü açar.',
      'Tüm panel içeriklerini, oturumları ve terminalleri koruyarak panel bölücü oranlarını (splits) matematiksel olarak eşit şekilde yeniden dengeler.',
      'Tarayıcı geçmişini ve çerezleri temizler.',
      'Kodları Prettier ile formatlar.'
    ],
    correctIndex: 1,
    explanation: 'Tidy işlemi hiçbir paneli silmez veya kapatmaz; `nodeWeight` hesaplaması yaparak sütunları ve satırları orantılı olarak kusursuz eşitliğe kavuşturur.',
    difficulty: 'beginner'
  },
  {
    id: 'arch-11',
    category: 'engine_sqlite',
    categoryLabel: CATEGORY_LABELS.engine_sqlite,
    sourceTitle: 'src/main/engine/schema.ts › Events table',
    question: "`events` tablosunun Terrarium içerisindeki temel işlevi nedir?",
    options: [
      'Kullanıcının klavye ve fare hareketlerini gizlice kaydetmek.',
      'Ajan durum değişiklikleri, kart hareketleri ve sistem loglarını biriktiren append-only bir etkinlik akışı sağlayarak aktivite bildirimlerini beslemek.',
      'Sadece çöken işlemlerin hata kayıtlarını tutmak.',
      'Takvim randevularını senkronize etmek.'
    ],
    correctIndex: 1,
    explanation: '`events` tablosu `agent.status`, `card.move`, `run.log`, `run.done`, `run.waiting` ve `system` türlerinde append-only olay kaydı tutar ve ön yüze anlık bildirim olarak yayınlanır.',
    difficulty: 'intermediate'
  },
  {
    id: 'arch-12',
    category: 'wiki_docs',
    categoryLabel: CATEGORY_LABELS.wiki_docs,
    sourceTitle: 'src/main/engine/schema.ts › docs & docs_fts',
    question: "Wiki dokümanlarında arama yaparken neden `docs_fts` sanal tablosu kullanılır?",
    options: [
      'SQLite standart LIKE sorgusu yerine SQLite FTS5 (Full-Text Search) ile hızlı, morfolojik ve rank puanlamalı tam metin araması yapabilmek için.',
      'Dokümanları PDF formatına dönüştürmek için.',
      'Arama sorgularını Google arama motoruna iletmek için.',
      'Dokümanların yedeğini harici bir sürücüye kaydetmek için.'
    ],
    correctIndex: 0,
    explanation: '`docs_fts`, FTS5 eklentisiyle oluşturulmuş sanal bir tablodur. Triggers (docs_ai, docs_au, docs_ad) sayesinde docs tablosuyla sürekli senkronize kalır ve anında tam metin araması sağlar.',
    difficulty: 'intermediate'
  },
  {
    id: 'arch-13',
    category: 'architecture',
    categoryLabel: CATEGORY_LABELS.architecture,
    sourceTitle: 'ARCHITECTURE.md › Agent roles',
    question: "Terrarium'de ajanların alabileceği roller (role) nelerdir?",
    options: [
      'admin, user, guest, manager',
      'lead, builder, reviewer, researcher, designer, scribe',
      'frontend, backend, devops, qa',
      'ceo, cto, cpo, intern'
    ],
    correctIndex: 1,
    explanation: '`schema.ts` içerisindeki agents tablosu check kısıtlamasında tanımlandığı üzere: lead (yönetici), builder (geliştirici), reviewer (incelemeci), researcher (araştırmacı), designer (tasarımcı) ve scribe (yazıcı) rolleridir.',
    difficulty: 'beginner'
  },
  {
    id: 'arch-14',
    category: 'pty_terminal',
    categoryLabel: CATEGORY_LABELS.pty_terminal,
    sourceTitle: 'ARCHITECTURE.md › Terminal WebGL',
    question: "Xterm terminalinde WebGL eklentisi çökerse veya GPU context loss yaşanırsa Terrarium nasıl tepki verir?",
    options: [
      'Tüm Electron penceresi hata vererek kapanır.',
      'Kullanıcıya bilgisayarı yeniden başlatması söylenir.',
      '`webgl.onContextLoss` yakalanır, WebGL eklentisi güvenle dispose edilir ve terminal DOM tabanlı canvas/renderer moduna kesintisiz düşer.',
      'Terminal hemen kapatılıp pty öldürülür.'
    ],
    correctIndex: 2,
    explanation: 'Terminal.tsx içinde eklenen WebGL context loss koruması sayesinde GPU bağlamı kaybolduğunda eklenti dispose edilir ve terminal çökmeden DOM modunda çalışmayı sürdürür.',
    difficulty: 'advanced'
  },
  {
    id: 'arch-15',
    category: 'workspace_panes',
    categoryLabel: CATEGORY_LABELS.workspace_panes,
    sourceTitle: 'src/renderer/src/workspace/BrowserPane.tsx › Scope binding',
    question: "BrowserPane içerisindeki 'Scope chip' (bağlantı rozeti) ne anlama gelir?",
    options: [
      'Webview sayfasının proxy ayarını gösterir.',
      'Bu tarayıcı panelinin odaklanılmış bir terminal paneline bağlı olduğunu, komut çubuğunun terminal pty\'sine yazdığını ve TERRARIUM_BROWSER_CMD ile ajan tarafından sürüldüğünü belirtir.',
      'Sayfanın SSL sertifikasının geçerli olduğunu gösterir.',
      'Tarayıcının gizli sekmede (incognito) olduğunu belirtir.'
    ],
    correctIndex: 1,
    explanation: 'BrowserPane bir terminale bağlı (bindLeafId) olduğunda ajan kendi pty kabuğundan `TERRARIUM_BROWSER_CMD` ile curl/HTTP istekleri yaparak tarayıcıyı yönlendirebilir ve prompt barı terminale yazar.',
    difficulty: 'advanced'
  },
  {
    id: 'arch-16',
    category: 'git_worktrees',
    categoryLabel: CATEGORY_LABELS.git_worktrees,
    sourceTitle: 'src/main/git/worktrees.ts › CLI detection',
    question: "Terrarium sisteme kurulu hangi yapay zeka ajan CLI araçlarını otomatik olarak tespit edebilir?",
    options: [
      'Yalnızca ChatGPT masaüstü uygulamasını.',
      'Sistem PATH ortamında `claude`, `codex`, `gemini` ve `aider` gibi CLI araçlarını tespit eder ve versiyonlarını listeler.',
      'Sadece Python paket yöneticisi pip ile kurulanları.',
      'Herhangi bir tespit yapmaz, kullanıcının elle yol yazması gerekir.'
    ],
    correctIndex: 1,
    explanation: '`detectAgentClis()` fonksiyonu PATH üzerindeki Claude Code, OpenAI Codex CLI, Aider gibi komut satırı araçlarını kontrol ederek hazır ajanları otomatik tespit eder.',
    difficulty: 'intermediate'
  },
  {
    id: 'arch-17',
    category: 'engine_sqlite',
    categoryLabel: CATEGORY_LABELS.engine_sqlite,
    sourceTitle: 'src/main/engine/schema.ts › Task card statuses',
    question: "Kanban tahtasındaki (BoardView) kartların `status` yaşam döngüsü hangi sırayla ilerler?",
    options: [
      'open → in_progress → closed',
      'backlog → ready → doing → review → done',
      'todo → doing → done',
      'draft → published → archived'
    ],
    correctIndex: 1,
    explanation: 'Terrarium `cards` tablosunda `CHECK (status IN (\'backlog\',\'ready\',\'doing\',\'review\',\'done\'))` kuralı geçerlidir. Kartlar backlog\'dan done aşamasına kadar 5 sütunda akar.',
    difficulty: 'beginner'
  },
  {
    id: 'arch-18',
    category: 'architecture',
    categoryLabel: CATEGORY_LABELS.architecture,
    sourceTitle: 'src/renderer/src/lib/sfx.ts › Synthesized audio',
    question: "Terrarium'de çalan ses efektleri (tıklama, zil, bitirme sesi) nasıl üretilir?",
    options: [
      'MP3 ve WAV dosyaları `public/audio` klasöründen diskten okunur.',
      'Web Audio API kullanılarak tamamen prosedürel (kodla oscillator ve noise buffer) sentezlenir, harici ses dosyası kullanılmaz.',
      'İşletim sisteminin varsayılan Windows bildirim sesleri çalınır.',
      'MIDI dosyaları yüklenir.'
    ],
    correctIndex: 1,
    explanation: 'sfx.ts içerisindeki tüm sesler (keyTick, cardMove, doneChime, alertSoft) procedural Web Audio API ile oscillators, gain ramps ve bandpass noise filtreleri kullanılarak kodla üretilir.',
    difficulty: 'intermediate'
  },
  {
    id: 'arch-19',
    category: 'office_3d',
    categoryLabel: CATEGORY_LABELS.office_3d,
    sourceTitle: 'src/renderer/src/office/RpgControls.tsx',
    question: "3D Ofis görünümünde kamera nasıl kontrol edilir?",
    options: [
      'Sadece 2D harita üzerinde fareyle tıklama yapılır.',
      'RpgControls ile tepeden simülasyon kamerası kullanılır; sürükleyerek pan, sağ tıkla orbit, tekerlekle zoom ve WASD ile hareket edilir.',
      'Sadece uzaktan sabit kamera açısı vardır, hareket edilemez.',
      'Sanal gerçeklik (VR) başlığı takmak zorunludur.'
    ],
    correctIndex: 1,
    explanation: 'Ofis görünümünde RpgControls bulunur. MapControls tabanlı tepeden kamera; sol sürükleme pan, sağ sürükleme orbit, tekerlek zoom ve WASD hareket sağlar. Ajana çift tıklamak terminalini açar.',
    difficulty: 'beginner'
  },
  {
    id: 'arch-20',
    category: 'wiki_docs',
    categoryLabel: CATEGORY_LABELS.wiki_docs,
    sourceTitle: 'ARCHITECTURE.md › Wiki backlinks',
    question: "Wiki sayfaları arasındaki ilişkiler ve `backlinks` (geri bağlantılar) nasıl hesaplanır?",
    options: [
      'Kullanıcı elle her sayfaya diğer sayfaların linkini yazmak zorundadır.',
      'Google arama motoru API\'si taranarak bulunur.',
      'Sayfa gövdesindeki iç linkler kaydedilir; getWikiPage çağrıldığında o sayfanın ID\'sine link veren diğer tüm sayfalar dinamik olarak taranıp backlinks listesi oluşturulur.',
      'Backlink özelliği Terrarium\'de bulunmaz.'
    ],
    correctIndex: 2,
    explanation: '`getWikiPage` fonksiyonu tüm dokümanların `links` alanını kontrol ederek hedef sayfa ID\'sini içerenleri bulur ve `backlinks` dizisi olarak otomatik döndürür.',
    difficulty: 'intermediate'
  },
  {
    id: 'arch-21',
    category: 'workspace_panes',
    categoryLabel: CATEGORY_LABELS.workspace_panes,
    sourceTitle: 'src/renderer/src/lib/panes.ts › Maximum panes',
    question: "Terrarium Workspace'inde aynı anda açılabilecek maksimum panel sayısı (`MAX_LEAVES`) kaçtır ve neden sınırlandırılmıştır?",
    options: [
      'Sonsuzdur, istendiği kadar açılabilir.',
      'Maksimum 8 paneldir; ofis ekranının okunabilirliğini ve pty süreç kaynaklarını makul tutmak için sınırlandırılmıştır.',
      'Sadece 2 panel açılabilir (sağ ve sol).',
      'Maksimum 100 panel açılabilir.'
    ],
    correctIndex: 1,
    explanation: '`MAX_LEAVES = 8` olarak tanımlanmıştır. 8\'den fazla panel ekranı çok daralttığı ve okunabilirliği düşürdüğü için bölme işlemleri 8 panelde engellenir.',
    difficulty: 'beginner'
  },
  {
    id: 'arch-22',
    category: 'engine_sqlite',
    categoryLabel: CATEGORY_LABELS.engine_sqlite,
    sourceTitle: 'src/main/engine/engine.ts › Heartbeat',
    question: "`touchAgent(agentId)` fonksiyonu ne işe yarar?",
    options: [
      'Ajanı sistemden siler.',
      'Ajanın `last_active_at` zaman damgasını günceller ve uyuyan bir ajanı \'working\' durumuna geçirerek terminal I/O üzerinden canlı olduğunu kanıtlar.',
      'Ajanın ekran parlaklığını artırır.',
      'Ajanın masa yerini değiştirir.'
    ],
    correctIndex: 1,
    explanation: 'Terminalden veri akışı olduğunda veya kullanıcı ajanla etkileşime geçtiğinde `touchAgent` çağrılarak son aktiflik süresi güncellenir ve ajan uyanık tutulur.',
    difficulty: 'intermediate'
  },
  {
    id: 'arch-23',
    category: 'architecture',
    categoryLabel: CATEGORY_LABELS.architecture,
    sourceTitle: 'src/renderer/src/components/ErrorBoundary.tsx',
    question: "React 19 mimarisinde panellerin her biri neden kendi `ErrorBoundary` bileşeniyle sarmalanmıştır?",
    options: [
      'CSS animasyonlarını hızlandırmak için.',
      'Tek bir panelde (örneğin terminal veya webview) beklenmeyen bir istisna meydana geldiğinde tüm uygulamanın beyaz ekrana çökmesini engellemek ve hatayı o panele izole etmek için.',
      'Panel boyutlarını otomatik olarak yüzde 50 yapmak için.',
      'Terminallere şifre koymak için.'
    ],
    correctIndex: 1,
    explanation: 'React 19 yakalanmayan bileşen hatalarında tüm ağacı unmount eder. Panel başına ErrorBoundary sayesinde bir hata sadece o panelin gövdesinde gösterilir, başlık ve diğer paneller çalışmaya devam eder.',
    difficulty: 'intermediate'
  },
  {
    id: 'arch-24',
    category: 'voice_cuda',
    categoryLabel: CATEGORY_LABELS.voice_cuda,
    sourceTitle: 'src/main/voice/index.ts',
    question: "Ses transkripsiyonu tamamlandığında metin nereye aktarılır?",
    options: [
      'Panoya kopyalanır ve ekranda bildirim çıkar.',
      'Aktif terminal oturumunun pty girdi kanalına (Enter gönderilmeden) yapıştırılır, böylece kullanıcı onaylamadan komut otomatik çalışmaz.',
      'Doğrudan konsola `sudo` yetkisiyle gönderilir ve anında çalıştırılır.',
      'Wiki sayfasına yeni bir başlık olarak eklenir.'
    ],
    correctIndex: 1,
    explanation: 'Güvenlik amacıyla transkripsiyon aktif terminalin pty stdin kanalına otomatik Enter eklenmeden gönderilir, böylece kullanıcı komutu inceleyip kendisi çalıştırabilir.',
    difficulty: 'intermediate'
  }
]

/** Simple deterministic string hash (djb2) to seed random generator */
function hashString(str: string): number {
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = (h * 33) ^ str.charCodeAt(i)
  }
  return h >>> 0
}

/** Linear Congruential Generator for deterministic daily randomization */
function createRng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

/** Generates dynamic questions from user's live Wiki documentation */
export function extractWikiQuestions(wikiPages: WikiPageMeta[]): QuizQuestion[] {
  const dynamic: QuizQuestion[] = []

  for (const page of wikiPages) {
    if (!page.title || page.title.length < 3) continue

    const typeName =
      page.type === 'architecture'
        ? 'Mimari'
        : page.type === 'module'
          ? 'Modül'
          : page.type === 'overview'
            ? 'Genel Bakış'
            : page.type === 'howto'
              ? 'Rehber'
              : 'Doküman'

    dynamic.push({
      id: `wiki-dyn-${page.id}`,
      category: 'wiki_docs',
      categoryLabel: CATEGORY_LABELS.wiki_docs,
      sourceTitle: `Wiki › ${page.title}`,
      question: `"${page.title}" başlıklı Wiki sayfası Terrarium dokümantasyonunda hangi kapsamda yer alır?`,
      options: [
        `${typeName} kapsamında yer alır ve sistemin bu parçasına ait teknik detayları açıklar.`,
        `Yalnızca test amacıyla oluşturulmuş geçici bir sayfadır.`,
        `Kullanıcı parolalarını ve API anahtarlarını saklamak için kullanılır.`,
        `Harici kütüphanelerin lisans metinlerini tutar.`
      ],
      correctIndex: 0,
      explanation: `"${page.title}" sayfası ${typeName} kategorisinde kayıtlıdır ve ${page.path} yolunda bulunur.`,
      wikiPageId: page.id,
      difficulty: 'beginner'
    })
  }

  return dynamic
}

/**
 * Returns exactly `count` questions for the given date (e.g. '2026-09-19').
 * Deterministic: the same date always produces the exact same ordered set of questions.
 */
export function getDailyQuestions(
  dateStr: string,
  wikiPages: WikiPageMeta[] = [],
  count = 20,
  salt = ''
): QuizQuestion[] {
  const combinedPool = [...ARCHITECTURAL_QUESTIONS, ...extractWikiQuestions(wikiPages)]

  const seed = hashString(`${dateStr}:${salt}:terrarium-daily-quiz`)
  const rng = createRng(seed)

  // Fisher-Yates shuffle with deterministic RNG
  const shuffled = [...combinedPool]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const temp = shuffled[i]
    shuffled[i] = shuffled[j]
    shuffled[j] = temp
  }

  // If pool is smaller than count, cycle it deterministically
  const result: QuizQuestion[] = []
  for (let i = 0; i < count; i++) {
    const base = shuffled[i % shuffled.length]
    // Clone so option order or mutations don't leak
    result.push({
      ...base,
      id: `${base.id}-${dateStr}-${i}`
    })
  }

  return result
}
