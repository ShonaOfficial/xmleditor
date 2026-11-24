import type { ParsedTemplateInfo } from '../types/blogger';
import type { BloggerErrorDiagnosis, SeoMonetizationReport } from './seoAndErrorAnalyzer';

export type OfflineAiRuntimeId =
  | 'builtin'
  | 'ollama'
  | 'lmstudio'
  | 'llamacpp'
  | 'webllm'
  | 'transformersjs'
  | 'mediapipe';

export type WorkspaceAiPage =
  | 'preview'
  | 'layout'
  | 'seo'
  | 'errors'
  | 'editor'
  | 'inspector'
  | 'console'
  | 'splitter';

export interface OfflineAiRuntimeMeta {
  id: OfflineAiRuntimeId;
  name: string;
  shortName: string;
  description: string;
  setupHint: string;
}

export const OFFLINE_AI_RUNTIMES: OfflineAiRuntimeMeta[] = [
  {
    id: 'builtin',
    name: 'Mesin Heuristik Lokal TemaLoka (Bawaan)',
    shortName: 'Lokal Bawaan',
    description:
      'Berjalan instan 100% di browser tanpa server eksternal maupun unduhan model.',
    setupHint:
      'Siap digunakan kapan saja bahkan saat perangkat sepenuhnya offline.',
  },
  {
    id: 'ollama',
    name: 'Ollama (Lokal HTTP)',
    shortName: 'Ollama',
    description:
      'Hubungkan ke Ollama lokal (port 11434) untuk analisis JSON dengan model Qwen / Llama / Gemma.',
    setupHint:
      'Pastikan Ollama aktif dan OLLAMA_ORIGINS=* diizinkan agar browser dapat terhubung.',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio / Jan AI (OpenAI Lokal)',
    shortName: 'LM Studio',
    description:
      'Terhubung ke Local Server LM Studio (:1234/v1) atau Jan AI (:1337/v1) berformat OpenAI API.',
    setupHint:
      'Aktifkan Local Server dan centang CORS pada pengaturan server LM Studio atau Jan AI.',
  },
  {
    id: 'llamacpp',
    name: 'llama.cpp Server',
    shortName: 'llama.cpp',
    description:
      'Gunakan binary llama-server lokal yang ringan untuk model GGUF di komputer atau Termux.',
    setupHint:
      'Jalankan llama-server dengan flag --port 8080 agar dapat diakses oleh TemaLoka.',
  },
  {
    id: 'webllm',
    name: 'WebLLM (WebGPU Browser)',
    shortName: 'WebLLM',
    description:
      'Inferensi LLM langsung via WebGPU di dalam browser desktop/mobile modern.',
    setupHint:
      'Memerlukan browser dengan dukungan WebGPU aktif; otomatis fallback ke Mesin Lokal jika belum tersedia.',
  },
  {
    id: 'transformersjs',
    name: 'Transformers.js (ONNX WASM/WebGPU)',
    shortName: 'Transformers.js',
    description:
      'Menjalankan model ONNX terkuantisasi secara offline di browser setelah cache tersimpan.',
    setupHint:
      'Jika runtime belum dimuat, TemaLoka otomatis menjalankan analisis lewat Mesin Lokal.',
  },
  {
    id: 'mediapipe',
    name: 'MediaPipe LLM (.task / .bin Lokal)',
    shortName: 'MediaPipe',
    description:
      'Pilih berkas model .task atau .bin langsung dari penyimpanan perangkat Anda.',
    setupHint:
      'Ikat berkas model lokal perangkat; analisis tetap aman dengan fallback Mesin Lokal instan.',
  },
];

export interface OfflineAiConfig {
  runtime: OfflineAiRuntimeId;
  endpoints: {
    ollama: string;
    lmstudio: string;
    llamacpp: string;
  };
  models: {
    ollama: string;
    lmstudio: string;
    llamacpp: string;
    webllm: string;
    transformersjs: string;
  };
  localMediaPipeFileName?: string;
}

export const DEFAULT_OFFLINE_AI_CONFIG: OfflineAiConfig = {
  runtime: 'builtin',
  endpoints: {
    ollama: 'http://127.0.0.1:11434',
    lmstudio: 'http://127.0.0.1:1234/v1',
    llamacpp: 'http://127.0.0.1:8080/v1',
  },
  models: {
    ollama: 'qwen2.5-coder:7b',
    lmstudio: 'local-model',
    llamacpp: 'local-gguf',
    webllm: 'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC',
    transformersjs: 'Xenova/Qwen2.5-0.5B-Instruct',
  },
};

export interface OfflineAiProbeResult {
  runtime: OfflineAiRuntimeId;
  available: boolean;
  statusLabel: string;
  detail: string;
  detectedModels: string[];
}

export interface PageOfflineAiAuditResult {
  page: WorkspaceAiPage;
  engineLabel: string;
  summary: string;
  highlights: string[];
  suggestedCss?: string;
  fallbackNotice?: string;
}

export async function probeOfflineAiRuntime(
  config: OfflineAiConfig,
  overrideRuntime?: OfflineAiRuntimeId
): Promise<OfflineAiProbeResult> {
  const rt = overrideRuntime ?? config.runtime;

  if (rt === 'builtin') {
    return {
      runtime: 'builtin',
      available: true,
      statusLabel: 'Aktif (100% Lokal)',
      detail: 'Mesin heuristik TemaLoka siap menganalisis template secara instan tanpa server.',
      detectedModels: [],
    };
  }

  if (rt === 'ollama') {
    const base = config.endpoints.ollama.replace(/\/+$/, '');
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3500);
      const res = await fetch(`${base}/api/tags`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) {
        return {
          runtime: rt,
          available: false,
          statusLabel: `HTTP ${res.status}`,
          detail: `Server Ollama merespons status ${res.status}.`,
          detectedModels: [],
        };
      }
      const data = (await res.json()) as { models?: Array<{ name?: string }> };
      const models = (data.models || []).map((m) => m.name || '').filter(Boolean);
      return {
        runtime: rt,
        available: true,
        statusLabel: `${models.length} model siap`,
        detail: models.length
          ? `Terhubung ke Ollama lokal (${models.slice(0, 3).join(', ')}).`
          : 'Terhubung ke Ollama lokal, namun belum ada model terpasang.',
        detectedModels: models,
      };
    } catch {
      return {
        runtime: rt,
        available: false,
        statusLabel: 'Tidak Terjangkau',
        detail: `Tidak dapat menghubungi ${base}. Pastikan Ollama berjalan dan mengizinkan CORS.`,
        detectedModels: [],
      };
    }
  }

  if (rt === 'lmstudio' || rt === 'llamacpp') {
    const base = config.endpoints[rt].replace(/\/+$/, '');
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3500);
      const res = await fetch(`${base}/models`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) {
        return {
          runtime: rt,
          available: false,
          statusLabel: `HTTP ${res.status}`,
          detail: `Endpoint ${base}/models merespons HTTP ${res.status}.`,
          detectedModels: [],
        };
      }
      const data = (await res.json()) as { data?: Array<{ id?: string }> };
      const models = (data.data || []).map((m) => m.id || '').filter(Boolean);
      return {
        runtime: rt,
        available: true,
        statusLabel: `${models.length || 1} model aktif`,
        detail: `Server OpenAI lokal di ${base} merespons normal.`,
        detectedModels: models,
      };
    } catch {
      return {
        runtime: rt,
        available: false,
        statusLabel: 'Tidak Terjangkau',
        detail: `Server lokal di ${base} belum aktif atau CORS diblokir.`,
        detectedModels: [],
      };
    }
  }

  if (rt === 'webllm') {
    const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
    return {
      runtime: rt,
      available: hasWebGpu,
      statusLabel: hasWebGpu ? 'WebGPU Siap' : 'WebGPU Tidak Tersedia',
      detail: hasWebGpu
        ? 'Perangkat mendukung WebGPU. Analisis kompleks dapat memakai fallback Mesin Lokal bila model belum dimuat.'
        : 'Browser ini belum mengaktifkan WebGPU; TemaLoka memakai Mesin Lokal otomatis.',
      detectedModels: [config.models.webllm],
    };
  }

  if (rt === 'mediapipe') {
    return {
      runtime: rt,
      available: Boolean(config.localMediaPipeFileName),
      statusLabel: config.localMediaPipeFileName
        ? `File: ${config.localMediaPipeFileName}`
        : 'Belum Ada File Model',
      detail: config.localMediaPipeFileName
        ? `Berkas ${config.localMediaPipeFileName} siap dengan fallback Mesin Lokal instan.`
        : 'Pilih file model .task/.bin dari perangkat Anda terlebih dahulu.',
      detectedModels: config.localMediaPipeFileName ? [config.localMediaPipeFileName] : [],
    };
  }

  return {
    runtime: rt,
    available: true,
    statusLabel: 'Mode Browser WASM',
    detail: 'Transformers.js siap dengan fallback Mesin Lokal instan.',
    detectedModels: [config.models.transformersjs],
  };
}

function extractFirstJsonObject(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return candidate.slice(firstBrace, lastBrace + 1);
  }
  return candidate;
}

export async function runJsonPromptOnLocalServer(
  config: OfflineAiConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<{ jsonText: string; engineLabel: string }> {
  if (config.runtime === 'ollama') {
    const base = config.endpoints.ollama.replace(/\/+$/, '');
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.models.ollama,
        stream: false,
        format: 'json',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = (await res.json()) as { message?: { content?: string } };
    const text = data.message?.content || '';
    return {
      jsonText: extractFirstJsonObject(text),
      engineLabel: `Ollama (${config.models.ollama})`,
    };
  }

  if (config.runtime === 'lmstudio' || config.runtime === 'llamacpp') {
    const base = config.endpoints[config.runtime].replace(/\/+$/, '');
    const model = config.models[config.runtime];
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Local AI HTTP ${res.status}`);
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content || '';
    return {
      jsonText: extractFirstJsonObject(text),
      engineLabel: `${config.runtime === 'lmstudio' ? 'LM Studio' : 'llama.cpp'} (${model})`,
    };
  }

  throw new Error('Runtime HTTP lokal belum aktif.');
}

function buildLocalPageAudit(
  page: WorkspaceAiPage,
  context: {
    xml: string;
    parsedInfo: ParsedTemplateInfo;
    seoReport?: SeoMonetizationReport;
    errorDiagnosis?: BloggerErrorDiagnosis;
    errorInput?: string;
    activeLine?: number;
  }
): PageOfflineAiAuditResult {
  const { parsedInfo, seoReport, errorDiagnosis, activeLine } = context;
  const dupTotal =
    parsedInfo.redundancyReport.totalDuplicateCssCount +
    parsedInfo.redundancyReport.totalDuplicateJsCount;

  if (page === 'preview') {
    const highlights: string[] = [
      parsedInfo.hasViewportMeta
        ? 'Meta viewport responsif sudah terpasang untuk layar ponsel dan tablet.'
        : 'Meta viewport belum terdeteksi — disarankan menambahkan <meta name="viewport"> agar tata letak mobile rapi.',
      `Terdeteksi ${parsedInfo.sections.length} b:section dan ${parsedInfo.widgets.length} widget aktif pada template "${parsedInfo.templateTitle}".`,
      `Ukuran file XML saat ini ${(parsedInfo.xmlByteSize / 1024).toFixed(1)} KB dengan ${parsedInfo.byteBreakdown.lineCount.toLocaleString('id-ID')} baris.`,
    ];
    return {
      page,
      engineLabel: 'Mesin Heuristik Lokal TemaLoka',
      summary: parsedInfo.hasViewportMeta
        ? `Struktur pratinjau "${parsedInfo.templateTitle}" siap diuji di mode Desktop, Tablet, dan Ponsel.`
        : `Template "${parsedInfo.templateTitle}" belum memiliki meta viewport responsif.`,
      highlights,
      suggestedCss: !parsedInfo.hasViewportMeta
        ? 'img, iframe, video { max-width: 100%; height: auto; }\n@media (max-width: 768px) { .main-wrapper, .sidebar-wrapper { width: 100% !important; float: none !important; } }'
        : undefined,
    };
  }

  if (page === 'layout') {
    const emptySections = parsedInfo.sections.filter((s) => s.widgetCount === 0).length;
    return {
      page,
      engineLabel: 'Mesin Heuristik Lokal TemaLoka',
      summary: `Peta tata letak memuat ${parsedInfo.sections.length} section dan ${parsedInfo.widgets.length} widget (${parsedInfo.hasTemplateSkin ? 'memiliki' : 'belum memiliki'} <b:template-skin>).`,
      highlights: [
        emptySections > 0
          ? `${emptySections} section masih kosong; gunakan "Isi Slot Widget Kosong" bila diperlukan untuk Tata Letak Blogger.`
          : 'Semua section sudah memiliki minimal satu widget.',
        parsedInfo.hasTemplateSkin
          ? '<b:template-skin> terdeteksi — tata letak visual dashboard Blogger terdefinisi.'
          : '<b:template-skin> belum ada; Anda dapat membuatnya otomatis di panel Tata Letak.',
      ],
    };
  }

  if (page === 'seo') {
    const counts = seoReport?.counts;
    const totalChecks = counts ? counts.found + counts.warning + counts.missing : 0;
    const totalScore = totalChecks > 0 && counts
      ? Math.round(((counts.found + counts.warning * 0.5) / totalChecks) * 100)
      : 0;
    return {
      page,
      engineLabel: 'Mesin Heuristik Lokal TemaLoka',
      summary: `Skor kesiapan SEO, Analytics, Shopping & AdSense saat ini ${totalScore}/100.`,
      highlights: [
        seoReport?.hasAdsenseXmlSyntaxRisk
          ? 'Ditemukan skrip AdSense dengan atribut HTML mentah (async tanpa nilai atau & tidak di-escape) — klik "Amankan Skrip AdSense ke XML".'
          : 'Tidak ditemukan risiko sintaks XML pada kode AdSense.',
        `Meta viewport: ${parsedInfo.hasViewportMeta ? 'Terpasang' : 'Belum ada'} · Skin CSS: ${parsedInfo.hasSkin ? 'Ada' : 'Tidak ada'}.`,
      ],
    };
  }

  if (page === 'errors') {
    const errCount = errorDiagnosis
      ? errorDiagnosis.xmlValidation.issues.filter((i) => i.severity === 'error').length
      : 0;
    return {
      page,
      engineLabel: 'Mesin Heuristik Lokal TemaLoka',
      summary:
        errCount === 0
          ? 'Scan offline tidak menemukan error sintaks kritis XML pada template aktif.'
          : `Ditemukan ${errCount} error sintaks XML yang berpotensi ditolak saat Simpan Tema di Blogger.`,
      highlights: [
        errorDiagnosis?.title || 'Siap menganalisis pesan org.xml.sax.SAXParseException.',
        'Gunakan tombol Auto-Fix (Web Worker) untuk memperbaiki karakter &, atribut boolean, dan blok CDATA secara bertahap.',
      ],
    };
  }

  if (page === 'editor') {
    return {
      page,
      engineLabel: 'Mesin Heuristik Lokal TemaLoka',
      summary: `Editor aktif pada baris ${activeLine || 1} dari ${parsedInfo.byteBreakdown.lineCount.toLocaleString('id-ID')} baris XML (${(parsedInfo.xmlByteSize / 1024).toFixed(1)} KB).`,
      highlights: [
        `Blok <b:skin> memakan ${(parsedInfo.byteBreakdown.skinBytes / 1024).toFixed(1)} KB dan skrip inline ${(parsedInfo.byteBreakdown.inlineScriptBytes / 1024).toFixed(1)} KB.`,
        'Gunakan "Validasi XML", "Rapikan XML", "Minify CSS", atau "Minify JS" langsung dari bilah alat editor.',
      ],
    };
  }

  if (page === 'console') {
    return {
      page,
      engineLabel: 'Mesin Heuristik Lokal TemaLoka',
      summary: `Konsol URL siap menguji query parameter dan log JavaScript pada template "${parsedInfo.templateTitle}".`,
      highlights: [
        'Gunakan pemindai Parameter & Query String untuk melihat seluruh pola URLSearchParams, new URL(), dan form GET di XML.',
        'Klik "Terapkan ke Pratinjau" untuk langsung menguji perubahan parameter URL tanpa mengetik manual.',
      ],
    };
  }

  if (page === 'splitter') {
    return {
      page,
      engineLabel: 'Mesin Heuristik Lokal TemaLoka',
      summary: `Template "${parsedInfo.templateTitle}" (${(parsedInfo.xmlByteSize / 1024).toFixed(1)} KB, ${parsedInfo.sections.length} section) siap dipecah & digabung ulang tanpa merusak CDATA.`,
      highlights: [
        'Mode Struktur Blogger memecah tepat per <head>/<b:skin>, masing-masing <b:section>, serta blok script & footer.',
        'Mode Gabung Berurutan menjamin 100% round-trip identik, sedangkan Gabung Blogger Cerdas otomatis menggabungkan CSS <b:skin> dan section dari beberapa file XML.',
      ],
    };
  }

  return {
    page,
    engineLabel: 'Mesin Heuristik Lokal TemaLoka',
    summary: `Inspektor mendeteksi ${parsedInfo.redundancyReport.unusedCssRules.length} aturan CSS mati dan ${dupTotal} duplikasi aset/aturan CSS-JS.`,
    highlights: [
      `Estimasi penghematan kode mati & duplikat: ${(parsedInfo.redundancyReport.totalEstimatedSavingsBytes / 1024).toFixed(1)} KB.`,
      `Terdeteksi ${parsedInfo.encodedCodes.length} blok skrip terenkripsi/obfuscated dan ${parsedInfo.images.length} aset gambar.`,
    ],
  };
}

export async function runPageAuditWithOfflineAi(
  config: OfflineAiConfig,
  page: WorkspaceAiPage,
  context: {
    xml: string;
    parsedInfo: ParsedTemplateInfo;
    seoReport?: SeoMonetizationReport;
    errorDiagnosis?: BloggerErrorDiagnosis;
    errorInput?: string;
    activeLine?: number;
  }
): Promise<PageOfflineAiAuditResult> {
  const localBaseline = buildLocalPageAudit(page, context);
  if (config.runtime === 'builtin') {
    return localBaseline;
  }

  if (
    config.runtime === 'ollama' ||
    config.runtime === 'lmstudio' ||
    config.runtime === 'llamacpp'
  ) {
    try {
      const diagErrCount = context.errorDiagnosis
        ? context.errorDiagnosis.xmlValidation.issues.filter((i) => i.severity === 'error').length
        : 0;
      const { jsonText, engineLabel } = await runJsonPromptOnLocalServer(
        config,
        'Anda adalah auditor template XML Blogger. Balas HANYA JSON valid: { "summary": string, "highlights": string[], "suggestedCss"?: string } dalam Bahasa Indonesia singkat.',
        `Halaman: ${page}. Template: ${context.parsedInfo.templateTitle}. Sections: ${context.parsedInfo.sections.length}. Widgets: ${context.parsedInfo.widgets.length}. CSS mati: ${context.parsedInfo.redundancyReport.unusedCssRules.length}. Error XML: ${diagErrCount}.`
      );
      const parsed = JSON.parse(jsonText) as {
        summary?: string;
        highlights?: string[];
        suggestedCss?: string;
      };
      if (parsed.summary) {
        return {
          page,
          engineLabel,
          summary: parsed.summary,
          highlights:
            Array.isArray(parsed.highlights) && parsed.highlights.length > 0
              ? parsed.highlights.slice(0, 4)
              : localBaseline.highlights,
          suggestedCss: parsed.suggestedCss || localBaseline.suggestedCss,
        };
      }
    } catch {
      return {
        ...localBaseline,
        fallbackNotice: `Runtime ${config.runtime} belum terjangkau; hasil ditampilkan dari Mesin Lokal TemaLoka.`,
      };
    }
  }

  return localBaseline;
}

export async function runChatPromptOnLocalAi(
  config: OfflineAiConfig,
  params: {
    activePage: WorkspaceAiPage;
    templateContext: string;
    parsedInfo: ParsedTemplateInfo;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    message: string;
  }
): Promise<{ reply: string; suggestedCss?: string; engineLabel: string }> {
  const { activePage, templateContext, parsedInfo, history, message } = params;

  if (
    config.runtime === 'ollama' ||
    config.runtime === 'lmstudio' ||
    config.runtime === 'llamacpp'
  ) {
    try {
      const systemMsg =
        'Anda adalah Asisten AI studio TemaLoka untuk template XML Blogspot/Blogger. Jawab dalam Bahasa Indonesia yang ringkas, akurat, dan sertakan kode CSS di dalam blok ```css ... ``` jika pengguna meminta perubahan gaya.';
      const contextMsg = `Tab aktif: ${activePage}\nKonteks XML:\n${templateContext.slice(0, 120000)}`;

      if (config.runtime === 'ollama') {
        const base = config.endpoints.ollama.replace(/\/+$/, '');
        const res = await fetch(`${base}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: config.models.ollama,
            stream: false,
            messages: [
              { role: 'system', content: `${systemMsg}\n\n${contextMsg}` },
              ...history.slice(-6).map((h) => ({ role: h.role, content: h.content })),
              { role: 'user', content: message },
            ],
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as { message?: { content?: string } };
          const text = (data.message?.content || '').trim();
          if (text) {
            const cssMatch = /```css\s*([\s\S]*?)```/i.exec(text);
            return {
              reply: text,
              suggestedCss: cssMatch?.[1]?.trim(),
              engineLabel: `Ollama Lokal (${config.models.ollama})`,
            };
          }
        }
      } else {
        const base = config.endpoints[config.runtime].replace(/\/+$/, '');
        const model = config.models[config.runtime];
        const res = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            temperature: 0.3,
            messages: [
              { role: 'system', content: `${systemMsg}\n\n${contextMsg}` },
              ...history.slice(-6).map((h) => ({ role: h.role, content: h.content })),
              { role: 'user', content: message },
            ],
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          const text = (data.choices?.[0]?.message?.content || '').trim();
          if (text) {
            const cssMatch = /```css\s*([\s\S]*?)```/i.exec(text);
            return {
              reply: text,
              suggestedCss: cssMatch?.[1]?.trim(),
              engineLabel: `${config.runtime === 'lmstudio' ? 'LM Studio' : 'llama.cpp'} Lokal (${model})`,
            };
          }
        }
      }
    } catch {
      // Fallback to built-in TemaLoka heuristic assistant below
    }
  }

  const lower = message.toLowerCase();
  const dupTotal =
    parsedInfo.redundancyReport.totalDuplicateCssCount +
    parsedInfo.redundancyReport.totalDuplicateJsCount;

  if (/css|gaya|warna|kartu|tombol|responsif|mobile|font|tampilan/.test(lower)) {
    const suggestedCss = [
      '.post-outer, .post { border-radius: 12px; transition: transform 0.2s ease, box-shadow 0.2s ease; }',
      '.post-outer:hover { box-shadow: 0 10px 24px -10px rgba(15, 23, 42, 0.14); }',
      'img, iframe, video { max-width: 100%; height: auto; }',
      '@media (max-width: 768px) { .main-wrapper, .sidebar-wrapper { width: 100% !important; float: none !important; } }',
    ].join('\n');
    return {
      reply: `Ringkasan Lokal untuk **"${parsedInfo.templateTitle}"** (0 kuota server):\n\nTemplate ini memiliki **${parsedInfo.variables.length} Variable** dan **${parsedInfo.sections.length} section**. Berikut blok CSS responsif yang aman langsung Anda terapkan:\n\n\`\`\`css\n${suggestedCss}\n\`\`\`\n\nKlik tombol **"Terapkan CSS ke Pratinjau"** di bawah jika ingin mencobanya langsung.`,
      suggestedCss,
      engineLabel: 'AI Lokal Bawaan (0 Kuota Server)',
    };
  }

  if (/error|rusak|sax|valid|cdata|perbaik/.test(lower)) {
    return {
      reply: `Hasil pemeriksaan cepat lokal untuk **"${parsedInfo.templateTitle}"**:\n- Ukuran XML: **${(parsedInfo.xmlByteSize / 1024).toFixed(1)} KB** (${parsedInfo.byteBreakdown.lineCount.toLocaleString('id-ID')} baris)\n- Tag \`<b:skin>\`: **${parsedInfo.hasSkin ? 'Terpasang' : 'Tidak ditemukan'}**\n- Meta Viewport: **${parsedInfo.hasViewportMeta ? 'Ada' : 'Belum ada'}**\n\nBuka tab **Diagnosa Error** lalu klik **Auto-Fix XML** untuk menormalkan karakter \`&\`, atribut boolean tanpa nilai, dan blok \`<![CDATA[ ... ]]>\` secara otomatis di perangkat Anda.`,
      engineLabel: 'AI Lokal Bawaan (0 Kuota Server)',
    };
  }

  if (/seo|iklan|adsense|meta|kecepatan|duplikat|berat/.test(lower)) {
    return {
      reply: `Audit lokal SEO & efisiensi **"${parsedInfo.templateTitle}"**:\n- CSS mati terdeteksi: **${parsedInfo.redundancyReport.unusedCssRules.length}** aturan\n- Duplikasi CSS/JS: **${dupTotal}** item\n- Estimasi penghematan: **${(parsedInfo.redundancyReport.totalEstimatedSavingsBytes / 1024).toFixed(1)} KB**\n\nAnda dapat membersihkan CSS mati di tab **Inspektor** serta mengecek skrip AdSense & meta OpenGraph di tab **SEO & Iklan**.`,
      engineLabel: 'AI Lokal Bawaan (0 Kuota Server)',
    };
  }

  return {
    reply: `**[Mode AI Lokal · 0 Kuota Server]**\n\nTemplate aktif saat ini: **${parsedInfo.templateTitle}**\n- Tab aktif: **${activePage}**\n- Section: **${parsedInfo.sections.length}** · Widget: **${parsedInfo.widgets.length}** · Variable: **${parsedInfo.variables.length}**\n- Ukuran: **${(parsedInfo.xmlByteSize / 1024).toFixed(1)} KB** (${parsedInfo.byteBreakdown.lineCount.toLocaleString('id-ID')} baris)\n\nUntuk penalaran mendalam bebas tanya apa saja tentang XML ini, aktifkan **Gemini Cloud** dengan Login Google atau hubungkan **Ollama / LM Studio** di perangkat Anda.`,
    engineLabel: 'AI Lokal Bawaan (0 Kuota Server)',
  };
}
