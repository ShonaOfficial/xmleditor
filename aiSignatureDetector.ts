export type AiSignatureCategory =
  | 'comment-watermark'
  | 'meta-generator'
  | 'custom-attribute'
  | 'attribution-credit'
  | 'script-comment'
  | 'steganographic-unicode'
  | 'stylistic-pattern';

export type AiSignatureConfidence = 'tinggi' | 'sedang' | 'sinyal';

export type AiSignatureZone =
  | 'header-xml'
  | 'b-skin'
  | 'style-css'
  | 'script-js'
  | 'meta-head'
  | 'attribute'
  | 'footer-credit'
  | 'markup-html'
  | 'unicode';

export interface AiSignatureFinding {
  id: string;
  sourceTool: string;
  category: AiSignatureCategory;
  confidence: AiSignatureConfidence;
  zone: AiSignatureZone;
  line: number;
  start: number;
  end: number;
  rawSnippet: string;
  label: string;
  reason: string;
  matchedSignals: string[];
  editable: boolean;
}

export interface AiSignatureReport {
  verdict: 'ai-signed' | 'ai-assisted' | 'likely-manual';
  verdictLabel: string;
  confidenceScore: number;
  detectedGenerators: string[];
  findings: AiSignatureFinding[];
  invisibleWatermarkCount: number;
  highConfidenceCount: number;
  mediumConfidenceCount: number;
  signalCount: number;
  summary: string;
}

export interface DeepAiSignatureAnalysisResult {
  isAiSigned: boolean;
  confidenceScore: number;
  verdictLabel: string;
  detectedTools: string[];
  reasoning: string;
  extraSignatures: Array<{
    snippet: string;
    reason: string;
    suspectedTool: string;
    zone: string;
  }>;
}

interface ProviderMatcher {
  toolName: string;
  patterns: RegExp[];
  confidenceBoost: number;
}

const AI_PROVIDER_MATCHERS: ProviderMatcher[] = [
  {
    toolName: 'ChatGPT / OpenAI',
    patterns: [
      /\bchat[\s_-]?gpt\b/i,
      /\bopenai\b/i,
      /\bgpt[\s_-]?(?:3\.5|4o|4\.1|4\.5|4|5|o1|o3|o4)\b/i,
      /\bchatgpt[\s_-]?(?:plus|pro|canvas|codex)\b/i,
    ],
    confidenceBoost: 45,
  },
  {
    toolName: 'Claude / Anthropic',
    patterns: [
      /\bclaude(?:[\s_-]?(?:3(?:\.5|\.7)?|4|sonnet|opus|haiku|code|artifact))?\b/i,
      /\banthropic\b/i,
    ],
    confidenceBoost: 45,
  },
  {
    toolName: 'Google Gemini / AI Studio',
    patterns: [
      /\bgemini(?:[\s_-]?(?:pro|flash|ultra|nano|1\.5|2\.0|2\.5|3|4))?\b/i,
      /\bgoogle[\s_-]?ai[\s_-]?studio\b/i,
      /\baistudio\b/i,
      /\bgoogle[\s_-]?bard\b/i,
    ],
    confidenceBoost: 45,
  },
  {
    toolName: 'DeepSeek AI',
    patterns: [/\bdeepseek(?:[\s_-]?(?:r1|v2|v3|coder|chat))?\b/i],
    confidenceBoost: 45,
  },
  {
    toolName: 'GitHub / Microsoft Copilot',
    patterns: [/\b(?:github|microsoft|bing)[\s_-]?copilot\b/i, /\bcopilot\b/i],
    confidenceBoost: 42,
  },
  {
    toolName: 'Qwen / Alibaba AI',
    patterns: [/\bqwen(?:[\s_-]?(?:2\.5|3|coder|max|plus))?\b/i, /\btongyi\b/i],
    confidenceBoost: 45,
  },
  {
    toolName: 'Grok / xAI',
    patterns: [/\bgrok(?:[\s_-]?[234])?\b/i, /\bxai\b/i],
    confidenceBoost: 42,
  },
  {
    toolName: 'Cursor / Windsurf / Codeium',
    patterns: [/\bcursor[\s_-]?ai\b/i, /\bwindsurf\b/i, /\bcodeium\b/i, /\bcline\b/i],
    confidenceBoost: 42,
  },
  {
    toolName: 'v0 / Bolt.new / Lovable / Replit AI',
    patterns: [
      /\bv0\.dev\b/i,
      /\bvercel[\s_-]?v0\b/i,
      /\bbolt\.new\b/i,
      /\blovable\.dev\b/i,
      /\bgpt[\s_-]?engineer\b/i,
      /\breplit[\s_-]?agent\b/i,
    ],
    confidenceBoost: 44,
  },
  {
    toolName: 'Perplexity / Mistral / Llama / Blackbox',
    patterns: [
      /\bperplexity\b/i,
      /\bmistral\b/i,
      /\bmixtral\b/i,
      /\bcodestral\b/i,
      /\b(?:meta[\s_-]?)?llama(?:[\s_-]?[234])?\b/i,
      /\bblackbox[\s_-]?ai\b/i,
      /\bphind\b/i,
      /\btabnine\b/i,
    ],
    confidenceBoost: 42,
  },
];

const EXPLICIT_AI_PHRASES: Array<{ regex: RegExp; label: string; weight: number }> = [
  {
    regex: /\b(?:generated|created|built|crafted|designed|written|authored|coded|powered)\s+(?:by|with|using)\s+(?:an?\s+)?(?:ai|artificial\s+intelligence|llm|machine\s+learning|ai\s+assistant)\b/i,
    label: 'Atribusi eksplisit "Generated/Created by AI"',
    weight: 42,
  },
  {
    regex: /\b(?:dibuat|dirancang|dihasilkan|ditulis|disusun|dikembangkan|ditandatangani)\s+(?:oleh|dengan|menggunakan|pakai|bersama)\s+(?:ai|kecerdasan\s+buatan|asisten\s+ai|bot\s+ai|llm)\b/i,
    label: 'Atribusi bahasa Indonesia "Dibuat oleh/dengan AI"',
    weight: 42,
  },
  {
    regex: /\b(?:ai[\s_-]?generated|ai[\s_-]?assisted|ai[\s_-]?authored|ai[\s_-]?watermark|ai[\s_-]?signature|made[\s_-]?with[\s_-]?ai|temaloka[\s_-]?ai)\b/i,
    label: 'Penanda metadata/tag AI-generated',
    weight: 40,
  },
  {
    regex: /\b(?:prompt\s*:|system\s*prompt|user\s*prompt|llm[\s_-]?output|assistant\s*response)\b/i,
    label: 'Jejak metadata prompt LLM',
    weight: 34,
  },
  {
    regex: /\bas\s+an\s+ai\s+(?:language\s+model|assistant)\b/i,
    label: 'Frasa respons khas model bahasa AI',
    weight: 45,
  },
];

const CONVERSATIONAL_AI_COMMENT_PATTERNS: Array<{ regex: RegExp; reason: string }> = [
  {
    regex: /(?:replace|change|update|insert|paste|add)\s+(?:this|here|below)?\s*(?:with\s+)?your\s+(?:own\s+)?(?:logo|adsense|analytics|tracking|pixel|url|link|id|name|bio|domain|image|avatar|title|description)/i,
    reason: 'Komentar instruksi interaktif ke pengguna ("Replace with your ...") yang khas dihasilkan AI.',
  },
  {
    regex: /(?:ganti|ubah|masukkan|tempel|sesuaikan|isi)\s+(?:bagian\s+ini\s+|kode\s+ini\s+|di\s+sini\s+)?(?:dengan\s+)?(?:url|link|logo|id|kode|nama|gambar|adsense|analytics|domain)\s+(?:anda|blog\s+anda|milik\s+anda)/i,
    reason: 'Komentar panduan berbahasa Indonesia ("Ganti dengan ... Anda") yang umum pada template buatan AI.',
  },
  {
    regex: /(?:note|catatan|penting|tip)\s*:\s*(?:pastikan|jangan\s+lupa|make\s+sure|remember\s+to|you\s+can\s+(?:adjust|customize|modify)|anda\s+dapat\s+mengubah)/i,
    reason: 'Komentar penjelasan/catatan asisten AI di dalam kode.',
  },
  {
    regex: /(?:placeholder|contoh|sample)\s+(?:for|untuk)\s+(?:blogger|blogspot|adsense|menu|widget|sidebar|footer)/i,
    reason: 'Komentar placeholder contoh untuk template Blogger yang sering disisipkan AI.',
  },
];

const INVISIBLE_WATERMARK_CHARS: Array<{ char: string; code: string; name: string }> = [
  { char: '\u200B', code: 'U+200B', name: 'Zero-Width Space' },
  { char: '\u200C', code: 'U+200C', name: 'Zero-Width Non-Joiner' },
  { char: '\u200D', code: 'U+200D', name: 'Zero-Width Joiner' },
  { char: '\u2060', code: 'U+2060', name: 'Word Joiner' },
  { char: '\u180E', code: 'U+180E', name: 'Mongolian Vowel Separator' },
  { char: '\u00AD', code: 'U+00AD', name: 'Soft Hyphen' },
  { char: '\u200E', code: 'U+200E', name: 'Left-to-Right Mark' },
  { char: '\u200F', code: 'U+200F', name: 'Right-to-Left Mark' },
];

const INVISIBLE_REGEX = /[\u200B\u200C\u200D\u2060\u180E\u00AD\u200E\u200F\u202A-\u202E]/g;

function buildLineStarts(text: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
}

function offsetToLine(lineStarts: number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid] <= offset) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return Math.max(1, hi + 1);
}

function detectProvidersInText(text: string): string[] {
  const detected: string[] = [];
  for (const matcher of AI_PROVIDER_MATCHERS) {
    if (matcher.patterns.some((p) => p.test(text))) {
      detected.push(matcher.toolName);
    }
  }
  return detected;
}

function detectExplicitAiInText(text: string): string[] {
  const matches: string[] = [];
  for (const phrase of EXPLICIT_AI_PHRASES) {
    if (phrase.regex.test(text)) {
      matches.push(phrase.label);
    }
  }
  return matches;
}

function detectZoneAtOffset(xml: string, offset: number): AiSignatureZone {
  if (offset < Math.min(800, xml.length * 0.12)) {
    // Check if inside <b:skin> already
    const skinIdx = xml.search(/<b:skin\b/i);
    if (skinIdx === -1 || offset < skinIdx) {
      return 'header-xml';
    }
  }
  const before = xml.slice(0, offset);
  const lastSkinOpen = before.lastIndexOf('<b:skin');
  const lastSkinClose = before.lastIndexOf('</b:skin>');
  if (lastSkinOpen > lastSkinClose) return 'b-skin';

  const lastStyleOpen = before.search(/<style\b(?![^>]*<\/style>)[^>]*$/i);
  const openStyleIdx = Math.max(before.lastIndexOf('<style'), before.lastIndexOf('<b:template-skin'));
  const closeStyleIdx = Math.max(before.lastIndexOf('</style>'), before.lastIndexOf('</b:template-skin>'));
  if (openStyleIdx > closeStyleIdx || lastStyleOpen !== -1) return 'style-css';

  const openScriptIdx = before.lastIndexOf('<script');
  const closeScriptIdx = before.lastIndexOf('</script>');
  if (openScriptIdx > closeScriptIdx) return 'script-js';

  const openHeadIdx = before.lastIndexOf('<head');
  const closeHeadIdx = before.lastIndexOf('</head>');
  if (openHeadIdx > closeHeadIdx) return 'meta-head';

  if (before.lastIndexOf('<footer') > before.lastIndexOf('</footer>')) return 'footer-credit';
  return 'markup-html';
}

function isUrlOrFalsePositiveContext(text: string): boolean {
  // Ignore URLs like https://generativelanguage.googleapis.com or standard font names / Blogger namespaces
  const trimmed = text.trim();
  if (/^https?:\/\/\S+$/i.test(trimmed)) return true;
  if (/schemas\.google\.com|www\.google\.com\/2005\/gml/i.test(trimmed)) return true;
  return false;
}

export function detectAiSignaturesInXml(xml: string): AiSignatureReport {
  if (!xml || !xml.trim()) {
    return {
      verdict: 'likely-manual',
      verdictLabel: 'Belum Ada Template XML Dimuat',
      confidenceScore: 0,
      detectedGenerators: [],
      findings: [],
      invisibleWatermarkCount: 0,
      highConfidenceCount: 0,
      mediumConfidenceCount: 0,
      signalCount: 0,
      summary: 'Unggah file template .xml atau muat template di pratinjau untuk memindai tanda tangan AI.',
    };
  }

  const lineStarts = buildLineStarts(xml);
  const findings: AiSignatureFinding[] = [];
  const seenRanges = new Set<string>();
  const generatorSet = new Set<string>();

  const pushFinding = (f: Omit<AiSignatureFinding, 'id'>) => {
    const key = `${f.start}:${f.end}:${f.category}`;
    if (seenRanges.has(key)) return;
    seenRanges.add(key);
    findings.push({
      ...f,
      id: `aisig-${findings.length + 1}-${f.line}-${f.start}`,
    });
  };

  // 1. XML / HTML Comments <!-- ... -->
  const htmlCommentRegex = /<!--[\s\S]*?-->/g;
  let m: RegExpExecArray | null;
  while ((m = htmlCommentRegex.exec(xml)) !== null) {
    const raw = m[0];
    if (raw.length > 8000) continue;
    const start = m.index;
    const end = start + raw.length;
    const line = offsetToLine(lineStarts, start);
    const zone = detectZoneAtOffset(xml, start);

    const providers = detectProvidersInText(raw);
    const explicitSignals = detectExplicitAiInText(raw);

    if (providers.length > 0 || explicitSignals.length > 0) {
      providers.forEach((p) => generatorSet.add(p));
      const toolLabel = providers.length > 0 ? providers.join(', ') : 'AI Generator Umum';
      pushFinding({
        sourceTool: toolLabel,
        category: 'comment-watermark',
        confidence: providers.length > 0 && explicitSignals.length > 0 ? 'tinggi' : providers.length > 0 || explicitSignals.length > 0 ? 'tinggi' : 'sedang',
        zone,
        line,
        start,
        end,
        rawSnippet: raw,
        label: `Komentar Tanda Tangan AI (${toolLabel})`,
        reason: [
          providers.length > 0 ? `Menyebut platform/model AI: ${providers.join(', ')}.` : '',
          ...explicitSignals,
        ]
          .filter(Boolean)
          .join(' '),
        matchedSignals: [...providers, ...explicitSignals],
        editable: true,
      });
      continue;
    }

    // Check conversational AI instruction comments inside HTML comments
    for (const pattern of CONVERSATIONAL_AI_COMMENT_PATTERNS) {
      if (pattern.regex.test(raw)) {
        pushFinding({
          sourceTool: 'Indikasi Asisten AI',
          category: 'stylistic-pattern',
          confidence: 'sinyal',
          zone,
          line,
          start,
          end,
          rawSnippet: raw,
          label: 'Komentar Instruksi Khas Output AI',
          reason: pattern.reason,
          matchedSignals: ['Komentar instruksi interaktif'],
          editable: true,
        });
        break;
      }
    }
  }

  // 2. CSS Block Comments /* ... */ inside <b:skin>, <b:template-skin>, <style>
  const cssBlockRegex = /<(b:skin|b:template-skin|style)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  while ((m = cssBlockRegex.exec(xml)) !== null) {
    const tagName = m[1].toLowerCase();
    const fullMatch = m[0];
    const openTagEnd = fullMatch.indexOf('>') + 1;
    const innerStartOffset = m.index + openTagEnd;
    const inner = m[2];
    const zone: AiSignatureZone = tagName === 'b:skin' ? 'b-skin' : 'style-css';

    const cssCommentRegex = /\/\*[\s\S]*?\*\//g;
    let cm: RegExpExecArray | null;
    while ((cm = cssCommentRegex.exec(inner)) !== null) {
      const rawComment = cm[0];
      // Skip CDATA markers
      if (/^\/\*\s*<!\[CDATA\[|^\/\*\s*\]\]>\s*\*\/$/i.test(rawComment.trim())) continue;
      if (rawComment.length > 6000) continue;

      const start = innerStartOffset + cm.index;
      const end = start + rawComment.length;
      const line = offsetToLine(lineStarts, start);
      const providers = detectProvidersInText(rawComment);
      const explicitSignals = detectExplicitAiInText(rawComment);

      if (providers.length > 0 || explicitSignals.length > 0) {
        providers.forEach((p) => generatorSet.add(p));
        const toolLabel = providers.length > 0 ? providers.join(', ') : 'AI Generator Umum';
        pushFinding({
          sourceTool: toolLabel,
          category: 'comment-watermark',
          confidence: 'tinggi',
          zone,
          line,
          start,
          end,
          rawSnippet: rawComment,
          label: `Komentar CSS Tanda Tangan AI (${toolLabel})`,
          reason: [
            providers.length > 0 ? `Menyebut model/alat AI: ${providers.join(', ')} di dalam <${tagName}>.` : '',
            ...explicitSignals,
          ]
            .filter(Boolean)
            .join(' '),
          matchedSignals: [...providers, ...explicitSignals],
          editable: true,
        });
        continue;
      }

      // Check Blogger skin Author/Theme attribution comment lines like:
      // Author: Gemini / Generator: ChatGPT / Version: AI Studio
      if (/\b(?:author|designer|creator|generator|dibuat|theme\s*by|template\s*by)\b/i.test(rawComment)) {
        if (/\b(?:ai|bot|gpt|claude|gemini|deepseek|copilot|llm|studio)\b/i.test(rawComment)) {
          pushFinding({
            sourceTool: 'AI Attribution (<b:skin>)',
            category: 'attribution-credit',
            confidence: 'sedang',
            zone,
            line,
            start,
            end,
            rawSnippet: rawComment,
            label: 'Header Author/Theme Menyebut AI',
            reason: 'Header komentar template pada <b:skin> mengandung kata kunci AI pada baris Author/Generator.',
            matchedSignals: ['Header Author/Generator'],
            editable: true,
          });
          continue;
        }
      }

      // Check numbered section banners or conversational CSS guidance
      for (const pattern of CONVERSATIONAL_AI_COMMENT_PATTERNS) {
        if (pattern.regex.test(rawComment)) {
          pushFinding({
            sourceTool: 'Indikasi Asisten AI',
            category: 'stylistic-pattern',
            confidence: 'sinyal',
            zone,
            line,
            start,
            end,
            rawSnippet: rawComment,
            label: 'Komentar Panduan CSS Khas AI',
            reason: pattern.reason,
            matchedSignals: ['Panduan CSS interaktif'],
            editable: true,
          });
          break;
        }
      }
    }

    // Also scan <Variable ... description="..."/> inside <b:skin>
    const varRegex = /<Variable\b[^>]*>/gi;
    let vm: RegExpExecArray | null;
    while ((vm = varRegex.exec(inner)) !== null) {
      const varTag = vm[0];
      const providers = detectProvidersInText(varTag);
      const explicitSignals = detectExplicitAiInText(varTag);
      if (providers.length > 0 || explicitSignals.length > 0) {
        providers.forEach((p) => generatorSet.add(p));
        const start = innerStartOffset + vm.index;
        const end = start + varTag.length;
        const toolLabel = providers.length > 0 ? providers.join(', ') : 'AI Generator';
        pushFinding({
          sourceTool: toolLabel,
          category: 'attribution-credit',
          confidence: 'tinggi',
          zone: 'b-skin',
          line: offsetToLine(lineStarts, start),
          start,
          end,
          rawSnippet: varTag,
          label: `Tag <Variable> Menyebut AI (${toolLabel})`,
          reason: 'Atribut variabel tema di <b:skin> mencantumkan referensi/tanda tangan AI.',
          matchedSignals: [...providers, ...explicitSignals],
          editable: true,
        });
      }
    }
  }

  // 3. JavaScript Comments inside <script>...</script> & JSON-LD <script type="application/ld+json">
  const scriptBlockRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  while ((m = scriptBlockRegex.exec(xml)) !== null) {
    const attrs = m[1] || '';
    const inner = m[2] || '';
    if (!inner.trim()) continue;
    const openEnd = m[0].indexOf('>') + 1;
    const innerStartOffset = m.index + openEnd;

    // Check JSON-LD author/creator/generator
    if (/application\/ld\+json/i.test(attrs)) {
      const providers = detectProvidersInText(inner);
      const explicitSignals = detectExplicitAiInText(inner);
      if (providers.length > 0 || explicitSignals.length > 0) {
        providers.forEach((p) => generatorSet.add(p));
        const toolLabel = providers.length > 0 ? providers.join(', ') : 'AI Generator';
        pushFinding({
          sourceTool: toolLabel,
          category: 'meta-generator',
          confidence: 'tinggi',
          zone: 'meta-head',
          line: offsetToLine(lineStarts, m.index),
          start: m.index,
          end: m.index + m[0].length,
          rawSnippet: m[0],
          label: `JSON-LD Schema Menyebut AI (${toolLabel})`,
          reason: 'Blok skema terstruktur application/ld+json mengandung tanda tangan pembuat/generator AI.',
          matchedSignals: [...providers, ...explicitSignals],
          editable: true,
        });
      }
      continue;
    }

    // JS block comments /* ... */
    const jsBlockCommentRegex = /\/\*[\s\S]*?\*\//g;
    let jc: RegExpExecArray | null;
    while ((jc = jsBlockCommentRegex.exec(inner)) !== null) {
      const rawJsComment = jc[0];
      if (/<!\[CDATA\[|\]\]>/.test(rawJsComment)) continue;
      const providers = detectProvidersInText(rawJsComment);
      const explicitSignals = detectExplicitAiInText(rawJsComment);
      if (providers.length > 0 || explicitSignals.length > 0) {
        providers.forEach((p) => generatorSet.add(p));
        const start = innerStartOffset + jc.index;
        const end = start + rawJsComment.length;
        const toolLabel = providers.length > 0 ? providers.join(', ') : 'AI Generator';
        pushFinding({
          sourceTool: toolLabel,
          category: 'script-comment',
          confidence: 'tinggi',
          zone: 'script-js',
          line: offsetToLine(lineStarts, start),
          start,
          end,
          rawSnippet: rawJsComment,
          label: `Komentar Blok JS Tanda Tangan AI (${toolLabel})`,
          reason: 'Komentar blok JavaScript menyebut generator atau alat pembuat AI.',
          matchedSignals: [...providers, ...explicitSignals],
          editable: true,
        });
      }
    }

    // JS line comments // ... (carefully avoid https:// or //<![CDATA[)
    const jsLineCommentRegex = /(^|[^\S\r\n])\/\/(?!<!\[CDATA\[|\]\]>)[^\r\n]*/gm;
    let jl: RegExpExecArray | null;
    while ((jl = jsLineCommentRegex.exec(inner)) !== null) {
      const leading = jl[1] || '';
      const rawLineComment = jl[0].slice(leading.length);
      if (isUrlOrFalsePositiveContext(rawLineComment)) continue;

      const start = innerStartOffset + jl.index + leading.length;
      const end = start + rawLineComment.length;
      const line = offsetToLine(lineStarts, start);
      const providers = detectProvidersInText(rawLineComment);
      const explicitSignals = detectExplicitAiInText(rawLineComment);

      if (providers.length > 0 || explicitSignals.length > 0) {
        providers.forEach((p) => generatorSet.add(p));
        const toolLabel = providers.length > 0 ? providers.join(', ') : 'AI Generator';
        pushFinding({
          sourceTool: toolLabel,
          category: 'script-comment',
          confidence: 'tinggi',
          zone: 'script-js',
          line,
          start,
          end,
          rawSnippet: rawLineComment,
          label: `Komentar JS Tanda Tangan AI (${toolLabel})`,
          reason: 'Komentar baris JavaScript mengandung penanda pembuat/model AI.',
          matchedSignals: [...providers, ...explicitSignals],
          editable: true,
        });
        continue;
      }

      for (const pattern of CONVERSATIONAL_AI_COMMENT_PATTERNS) {
        if (pattern.regex.test(rawLineComment)) {
          pushFinding({
            sourceTool: 'Indikasi Asisten AI',
            category: 'stylistic-pattern',
            confidence: 'sinyal',
            zone: 'script-js',
            line,
            start,
            end,
            rawSnippet: rawLineComment,
            label: 'Komentar JS Instruksi Khas AI',
            reason: pattern.reason,
            matchedSignals: ['Komentar instruksi JS'],
            editable: true,
          });
          break;
        }
      }
    }
  }

  // 4. <meta> tags (generator, author, creator, ai-*, etc.)
  const metaTagRegex = /<meta\b[^>]*>/gi;
  while ((m = metaTagRegex.exec(xml)) !== null) {
    const tag = m[0];
    const nameMatch = /\b(?:name|property|http-equiv)\s*=\s*(['"])([^'"]+)\1/i.exec(tag);
    const contentMatch = /\bcontent\s*=\s*(['"])([^'"]*)\1/i.exec(tag);
    const metaName = (nameMatch?.[2] || '').toLowerCase();
    const metaContent = contentMatch?.[2] || '';

    const isAiMetaName =
      /^(?:ai-generated|ai-generator|generated-by|ai-model|ai-signature|llm|assistant)$/i.test(
        metaName
      );
    const isAttributionMetaName =
      /^(?:generator|author|creator|designer|publisher|copyright|dcterms\.creator)$/i.test(
        metaName
      );

    const providers = detectProvidersInText(`${metaName} ${metaContent}`);
    const explicitSignals = detectExplicitAiInText(metaContent);

    if (isAiMetaName || providers.length > 0 || explicitSignals.length > 0) {
      providers.forEach((p) => generatorSet.add(p));
      const toolLabel = providers.length > 0 ? providers.join(', ') : isAiMetaName ? `Meta ${metaName}` : 'AI Generator';
      pushFinding({
        sourceTool: toolLabel,
        category: 'meta-generator',
        confidence: 'tinggi',
        zone: 'meta-head',
        line: offsetToLine(lineStarts, m.index),
        start: m.index,
        end: m.index + tag.length,
        rawSnippet: tag,
        label: `Tag <meta> Tanda Tangan AI (${metaName || 'metadata'})`,
        reason: isAiMetaName
          ? `Meta khusus "${metaName}" secara eksplisit menandai template dibuat/ditandatangani oleh AI.`
          : `Atribut content pada <meta name="${metaName}"> menyebut pembuat/model AI (${toolLabel}).`,
        matchedSignals: [
          metaName ? `meta:${metaName}` : 'meta',
          ...providers,
          ...explicitSignals,
        ],
        editable: true,
      });
    } else if (
      isAttributionMetaName &&
      /\b(?:ai|llm|gpt|bot|assistant|neural)\b/i.test(metaContent)
    ) {
      pushFinding({
        sourceTool: 'AI Metadata',
        category: 'meta-generator',
        confidence: 'sedang',
        zone: 'meta-head',
        line: offsetToLine(lineStarts, m.index),
        start: m.index,
        end: m.index + tag.length,
        rawSnippet: tag,
        label: `Meta "${metaName}" Terindikasi AI`,
        reason: `Isi meta "${metaName}" (${metaContent}) mengindikasikan keterlibatan AI.`,
        matchedSignals: [`meta:${metaName}`],
        editable: true,
      });
    }
  }

  // 5. Custom AI Attributes on elements (data-ai-*, data-generated-by, data-model, data-generator, etc.)
  const customAiAttrRegex = /\sdata-(?:ai(?:-[a-z0-9_-]+)?|generated-by|generator|model|llm|created-with|authored-by)\s*=\s*(['"])([\s\S]*?)\1/gi;
  while ((m = customAiAttrRegex.exec(xml)) !== null) {
    const rawAttr = m[0];
    const attrVal = m[2] || '';
    const trimmedAttr = rawAttr.trimStart();
    const start = m.index + (rawAttr.length - trimmedAttr.length);
    const end = m.index + rawAttr.length;
    const providers = detectProvidersInText(attrVal);
    providers.forEach((p) => generatorSet.add(p));
    const toolLabel = providers.length > 0 ? providers.join(', ') : 'Custom Attribute AI';
    pushFinding({
      sourceTool: toolLabel,
      category: 'custom-attribute',
      confidence: 'tinggi',
      zone: 'attribute',
      line: offsetToLine(lineStarts, start),
      start,
      end,
      rawSnippet: trimmedAttr,
      label: `Atribut HTML Tanda Tangan AI (${trimmedAttr.split('=')[0]})`,
      reason: `Elemen XML/HTML memiliki atribut khusus "${trimmedAttr}" yang menandai sumber AI.`,
      matchedSignals: [trimmedAttr.split('=')[0], ...providers],
      editable: true,
    });
  }

  // 6. Visible Footer / Attribution / Blogger Widget Credits containing AI signatures
  const footerCreditRegex = /<(?:div|p|span|footer|small|a)\b[^>]*(?:copyright|credit|attribution|footer-credit|crafted|designed|powered)[^>]*>[\s\S]{0,400}?<\/(?:div|p|span|footer|small|a)>/gi;
  while ((m = footerCreditRegex.exec(xml)) !== null) {
    const snippet = m[0];
    const providers = detectProvidersInText(snippet);
    const explicitSignals = detectExplicitAiInText(snippet);
    if (providers.length > 0 || explicitSignals.length > 0) {
      providers.forEach((p) => generatorSet.add(p));
      const toolLabel = providers.length > 0 ? providers.join(', ') : 'AI Credit';
      pushFinding({
        sourceTool: toolLabel,
        category: 'attribution-credit',
        confidence: 'tinggi',
        zone: 'footer-credit',
        line: offsetToLine(lineStarts, m.index),
        start: m.index,
        end: m.index + snippet.length,
        rawSnippet: snippet,
        label: `Kredit Footer / Attribution AI (${toolLabel})`,
        reason: 'Elemen kredit/attribution di halaman template mencantumkan dibuat oleh/dengan AI.',
        matchedSignals: [...providers, ...explicitSignals],
        editable: true,
      });
    }
  }

  // Also catch any remaining standalone visible text mentioning explicit AI phrases or providers outside comments/scripts/styles
  const textNodeAiRegex = />([^<]{6,320})</g;
  while ((m = textNodeAiRegex.exec(xml)) !== null) {
    const textContent = m[1];
    if (!textContent.trim() || textContent.includes('CDATA')) continue;
    const providers = detectProvidersInText(textContent);
    const explicitSignals = detectExplicitAiInText(textContent);
    if (providers.length > 0 || explicitSignals.length > 0) {
      const zone = detectZoneAtOffset(xml, m.index);
      if (zone === 'b-skin' || zone === 'style-css' || zone === 'script-js') continue;
      // Avoid duplicating already captured footerCreditRegex range
      const textStart = m.index + 1;
      const textEnd = textStart + textContent.length;
      const alreadyInside = findings.some((f) => textStart >= f.start && textEnd <= f.end);
      if (alreadyInside) continue;

      providers.forEach((p) => generatorSet.add(p));
      const toolLabel = providers.length > 0 ? providers.join(', ') : 'AI Attribution';
      pushFinding({
        sourceTool: toolLabel,
        category: 'attribution-credit',
        confidence: providers.length > 0 && explicitSignals.length > 0 ? 'tinggi' : 'sedang',
        zone,
        line: offsetToLine(lineStarts, textStart),
        start: textStart,
        end: textEnd,
        rawSnippet: textContent.trim(),
        label: `Teks Template Menyebut AI (${toolLabel})`,
        reason: 'Teks di dalam markup HTML/Blogger menyebut nama AI atau frasa dibuat oleh AI.',
        matchedSignals: [...providers, ...explicitSignals],
        editable: true,
      });
    }
  }

  // 7. Invisible / Steganographic Zero-Width Unicode Watermarks
  // Group per line so editing/cleaning is fast and readable
  let invisibleWatermarkCount = 0;
  const lineInvisibleMap = new Map<
    number,
    { lineStart: number; lineEnd: number; rawLine: string; codes: Set<string>; count: number }
  >();

  let im: RegExpExecArray | null;
  while ((im = INVISIBLE_REGEX.exec(xml)) !== null) {
    invisibleWatermarkCount++;
    const line = offsetToLine(lineStarts, im.index);
    const lineStart = lineStarts[line - 1] ?? 0;
    const nextLineIdx = xml.indexOf('\n', lineStart);
    const lineEnd = nextLineIdx === -1 ? xml.length : nextLineIdx;
    const charFound = INVISIBLE_WATERMARK_CHARS.find((c) => c.char === im![0]);
    const codeLabel = charFound ? `${charFound.code} (${charFound.name})` : `U+${im[0].charCodeAt(0).toString(16).toUpperCase()}`;

    const entry = lineInvisibleMap.get(line) ?? {
      lineStart,
      lineEnd,
      rawLine: xml.slice(lineStart, lineEnd),
      codes: new Set<string>(),
      count: 0,
    };
    entry.codes.add(codeLabel);
    entry.count += 1;
    lineInvisibleMap.set(line, entry);
  }

  // Also detect mid-file UTF-8 BOM (\uFEFF after index 0)
  for (let i = 1; i < xml.length; i++) {
    if (xml.charCodeAt(i) === 0xfeff) {
      invisibleWatermarkCount++;
      const line = offsetToLine(lineStarts, i);
      const lineStart = lineStarts[line - 1] ?? 0;
      const nextLineIdx = xml.indexOf('\n', lineStart);
      const lineEnd = nextLineIdx === -1 ? xml.length : nextLineIdx;
      const entry = lineInvisibleMap.get(line) ?? {
        lineStart,
        lineEnd,
        rawLine: xml.slice(lineStart, lineEnd),
        codes: new Set<string>(),
        count: 0,
      };
      entry.codes.add('U+FEFF (Mid-file BOM)');
      entry.count += 1;
      lineInvisibleMap.set(line, entry);
    }
  }

  for (const [line, info] of lineInvisibleMap.entries()) {
    const codesArr = Array.from(info.codes);
    pushFinding({
      sourceTool: 'Watermark Unicode Tak Terlihat',
      category: 'steganographic-unicode',
      confidence: info.count >= 2 ? 'tinggi' : 'sedang',
      zone: 'unicode',
      line,
      start: info.lineStart,
      end: info.lineEnd,
      rawSnippet: info.rawLine,
      label: `${info.count} Karakter Watermark Tak Terlihat (Baris ${line})`,
      reason: `Terdeteksi karakter Unicode tak terlihat (${codesArr.join(', ')}) yang sering disisipkan sebagai watermark steganografi output AI dan berpotensi memicu error XML.`,
      matchedSignals: codesArr,
      editable: true,
    });
  }

  // 8. Additional Stylistic / Structural LLM Signatures
  // e.g. Repeated numbered banner headers /* === 1. ... === */ or <!-- === 1. ... === -->
  const numberedSectionBanners = xml.match(/(?:\/\*|<!--)\s*[=\-*#]{2,}\s*\d+[\.\)]\s+[^\r\n*]+/g) || [];
  if (numberedSectionBanners.length >= 4 && generatorSet.size === 0) {
    const firstBanner = numberedSectionBanners[0];
    if (firstBanner) {
      const idx = xml.indexOf(firstBanner);
      if (idx !== -1) {
        const line = offsetToLine(lineStarts, idx);
        pushFinding({
          sourceTool: 'Pola Struktur LLM',
          category: 'stylistic-pattern',
          confidence: 'sinyal',
          zone: detectZoneAtOffset(xml, idx),
          line,
          start: idx,
          end: idx + firstBanner.length,
          rawSnippet: firstBanner,
          label: `Pola Banner Bernomor Khas AI (${numberedSectionBanners.length} blok)`,
          reason: `Ditemukan ${numberedSectionBanners.length} pemisah bagian bernomor berulang (gaya struktur umum saat LLM menghasilkan template dari nol).`,
          matchedSignals: [`${numberedSectionBanners.length} banner bernomor`],
          editable: true,
        });
      }
    }
  }

  // Sort findings by line number ascending, high confidence first when same line
  const confOrder: Record<AiSignatureConfidence, number> = {
    tinggi: 0,
    sedang: 1,
    sinyal: 2,
  };
  findings.sort((a, b) => a.line - b.line || confOrder[a.confidence] - confOrder[b.confidence]);

  const highConfidenceCount = findings.filter((f) => f.confidence === 'tinggi').length;
  const mediumConfidenceCount = findings.filter((f) => f.confidence === 'sedang').length;
  const signalCount = findings.filter((f) => f.confidence === 'sinyal').length;
  const detectedGenerators = Array.from(generatorSet);

  // Compute confidence score (0 - 99)
  let rawScore = 0;
  for (const f of findings) {
    if (f.confidence === 'tinggi') rawScore += 42;
    else if (f.confidence === 'sedang') rawScore += 24;
    else rawScore += 9;
  }
  if (detectedGenerators.length > 0) rawScore += 18;
  if (invisibleWatermarkCount >= 3) rawScore += 15;
  const confidenceScore = Math.min(99, rawScore);

  let verdict: AiSignatureReport['verdict'] = 'likely-manual';
  let verdictLabel = 'Tidak Terdeteksi Tanda Tangan AI';
  if (highConfidenceCount > 0 || (mediumConfidenceCount >= 1 && confidenceScore >= 45)) {
    verdict = 'ai-signed';
    verdictLabel =
      detectedGenerators.length > 0
        ? `Ditandatangani AI (${detectedGenerators.join(', ')})`
        : 'Terdeteksi Dibuat / Ditandatangani AI';
  } else if (mediumConfidenceCount > 0 || signalCount >= 2 || invisibleWatermarkCount > 0) {
    verdict = 'ai-assisted';
    verdictLabel = 'Terindikasi Dibantu / Mengandung Jejak AI';
  }

  let summary = '';
  if (verdict === 'ai-signed') {
    summary = `Ditemukan ${highConfidenceCount} tanda tangan AI kuat${
      detectedGenerators.length > 0 ? ` (${detectedGenerators.join(', ')})` : ''
    }${invisibleWatermarkCount > 0 ? ` dan ${invisibleWatermarkCount} karakter watermark tak terlihat` : ''}. Anda dapat mengedit atau menghapus setiap tanda tangan langsung di bawah ini.`;
  } else if (verdict === 'ai-assisted') {
    summary = `Tidak ada klaim generator eksplisit, namun ditemukan ${findings.length} sinyal/indikasi struktur atau watermark AI (${confidenceScore}%). Periksa daftar temuan sebelum ekspor.`;
  } else {
    summary =
      'Tidak ditemukan tanda tangan generator AI, komentar atribusi AI, maupun watermark Unicode tersembunyi pada template XML aktif.';
  }

  return {
    verdict,
    verdictLabel,
    confidenceScore,
    detectedGenerators,
    findings,
    invisibleWatermarkCount,
    highConfidenceCount,
    mediumConfidenceCount,
    signalCount,
    summary,
  };
}

export function stripInvisibleWatermarks(input: string): string {
  return input
    .replace(INVISIBLE_REGEX, '')
    .replace(/\uFEFF/g, '');
}

export function replaceAiSignatureInXml(
  xml: string,
  finding: AiSignatureFinding,
  nextRawSnippet: string
): string {
  if (finding.category === 'steganographic-unicode') {
    const cleanedLine = stripInvisibleWatermarks(nextRawSnippet);
    if (xml.slice(finding.start, finding.end) === finding.rawSnippet) {
      return xml.slice(0, finding.start) + cleanedLine + xml.slice(finding.end);
    }
    return xml.replace(finding.rawSnippet, cleanedLine);
  }

  if (
    finding.start >= 0 &&
    finding.end <= xml.length &&
    xml.slice(finding.start, finding.end) === finding.rawSnippet
  ) {
    return xml.slice(0, finding.start) + nextRawSnippet + xml.slice(finding.end);
  }

  const idx = xml.indexOf(finding.rawSnippet);
  if (idx !== -1) {
    return xml.slice(0, idx) + nextRawSnippet + xml.slice(idx + finding.rawSnippet.length);
  }

  return xml;
}

export function removeAiSignatureInXml(
  xml: string,
  finding: AiSignatureFinding
): string {
  if (finding.category === 'steganographic-unicode') {
    const cleanedLine = stripInvisibleWatermarks(finding.rawSnippet);
    if (xml.slice(finding.start, finding.end) === finding.rawSnippet) {
      return xml.slice(0, finding.start) + cleanedLine + xml.slice(finding.end);
    }
    return stripInvisibleWatermarks(xml);
  }

  let start = finding.start;
  let end = finding.end;

  if (
    start < 0 ||
    end > xml.length ||
    xml.slice(start, end) !== finding.rawSnippet
  ) {
    const fallbackIdx = xml.indexOf(finding.rawSnippet);
    if (fallbackIdx === -1) return xml;
    start = fallbackIdx;
    end = fallbackIdx + finding.rawSnippet.length;
  }

  // If this snippet occupies a standalone line, also remove trailing newline cleanly
  const beforeChar = start > 0 ? xml[start - 1] : '';
  const afterChar = end < xml.length ? xml[end] : '';
  let cutStart = start;
  let cutEnd = end;

  if (finding.category === 'custom-attribute') {
    // Include one preceding space if present
    if (cutStart > 0 && (xml[cutStart - 1] === ' ' || xml[cutStart - 1] === '\t')) {
      cutStart -= 1;
    }
  } else {
    // Check if only indentation precedes on this line and only whitespace/newline follows
    const lineStart = xml.lastIndexOf('\n', start - 1) + 1;
    const prefixOnLine = xml.slice(lineStart, start);
    if (/^[ \t]*$/.test(prefixOnLine)) {
      const nextNewline = xml.indexOf('\n', end);
      const suffixOnLine = nextNewline === -1 ? xml.slice(end) : xml.slice(end, nextNewline);
      if (/^[ \t\r]*$/.test(suffixOnLine)) {
        cutStart = lineStart;
        cutEnd = nextNewline === -1 ? xml.length : nextNewline + 1;
      }
    } else if (beforeChar === '\n' && afterChar === '\n') {
      cutEnd += 1;
    }
  }

  return xml.slice(0, cutStart) + xml.slice(cutEnd);
}

export function cleanAllAiSignaturesInXml(
  xml: string,
  options: { includeStylistic?: boolean } = {}
): { nextXml: string; removedCount: number; removedInvisibleCount: number } {
  const report = detectAiSignaturesInXml(xml);
  const targets = report.findings.filter((f) =>
    options.includeStylistic ? true : f.confidence !== 'sinyal'
  );

  if (targets.length === 0) {
    return { nextXml: xml, removedCount: 0, removedInvisibleCount: 0 };
  }

  // Apply edits from bottom (highest offset) to top so earlier offsets never shift
  const sortedDesc = [...targets].sort((a, b) => b.start - a.start);
  let nextXml = xml;
  let removedCount = 0;

  for (const item of sortedDesc) {
    // Keep <Variable> and JSON-LD structural tags intact; sanitize their AI attribution text instead
    if (/^<Variable\b/i.test(item.rawSnippet)) {
      const sanitizedVar = item.rawSnippet.replace(
        /description=(['"])([^'"]*)\1/i,
        (_m, q) => `description=${q}Warna Tema Kustom${q}`
      );
      const updated = replaceAiSignatureInXml(nextXml, item, sanitizedVar);
      if (updated !== nextXml) {
        nextXml = updated;
        removedCount += 1;
      }
      continue;
    }

    if (/^<script\b[^>]*application\/ld\+json/i.test(item.rawSnippet)) {
      const sanitizedSchema = item.rawSnippet.replace(
        /"(?:name|alternateName|description)"\s*:\s*"[^"]*(?:chatgpt|openai|gpt-[0-9o]+|claude|anthropic|gemini|deepseek|copilot|ai[\s_-]?generated|dibuat\s+oleh\s+ai)[^"]*"/gi,
        (match) => {
          const key = match.split(':')[0];
          return `${key}: "Penulis Blog"`;
        }
      );
      const updated = replaceAiSignatureInXml(nextXml, item, sanitizedSchema);
      if (updated !== nextXml) {
        nextXml = updated;
        removedCount += 1;
      }
      continue;
    }

    const updated = removeAiSignatureInXml(nextXml, item);
    if (updated !== nextXml) {
      nextXml = updated;
      removedCount += 1;
    }
  }

  // Final pass to guarantee zero invisible watermark chars remain if any unicode findings were cleaned
  if (report.invisibleWatermarkCount > 0) {
    const hadStartBom = xml.startsWith('\uFEFF');
    nextXml = stripInvisibleWatermarks(nextXml);
    if (hadStartBom && !nextXml.startsWith('\uFEFF')) {
      nextXml = `\uFEFF${nextXml}`;
    }
  }

  return {
    nextXml,
    removedCount,
    removedInvisibleCount: report.invisibleWatermarkCount,
  };
}

export function buildXmlExcerptForAiSignatureCheck(xml: string): string {
  const parts: string[] = [];
  parts.push('=== BAGIAN AWAL XML (HEAD & SKIN HEADER) ===');
  parts.push(xml.slice(0, 6500));

  const comments = xml.match(/(?:<!--[\s\S]{1,400}?-->|\/\*[\s\S]{1,400}?\*\/)/g) || [];
  if (comments.length > 0) {
    parts.push('\n=== SAMPEL KOMENTAR XML/CSS ===');
    parts.push(comments.slice(0, 35).join('\n'));
  }

  const metas = xml.match(/<meta\b[^>]*>/gi) || [];
  if (metas.length > 0) {
    parts.push('\n=== TAG META ===');
    parts.push(metas.slice(0, 25).join('\n'));
  }

  parts.push('\n=== BAGIAN AKHIR XML (FOOTER & SCRIPT AKHIR) ===');
  parts.push(xml.slice(Math.max(0, xml.length - 5000)));

  return parts.join('\n').slice(0, 20000);
}

export function suggestNeutralizedSnippet(
  finding: AiSignatureFinding,
  customAuthor = 'Tim Tema Blog'
): string {
  const safeAuthor = customAuthor.replace(/[<>"'&]/g, '').trim() || 'Tim Tema Blog';
  const raw = finding.rawSnippet;

  if (finding.category === 'steganographic-unicode') {
    return stripInvisibleWatermarks(raw);
  }

  if (finding.category === 'meta-generator') {
    if (/<meta\b[^>]*name\s*=\s*(['"])(?:ai-generated|ai-generator|generated-by|ai-model|ai-signature|llm|assistant)\1/i.test(raw)) {
      return `<!-- Atribusi template diperbarui untuk ${safeAuthor} -->`;
    }
    return raw.replace(
      /\bcontent\s*=\s*(['"])([^'"]*)\1/i,
      (_m, q) => `content=${q}${safeAuthor}${q}`
    );
  }

  if (/^<Variable\b/i.test(raw)) {
    return raw.replace(
      /\bdescription\s*=\s*(['"])([^'"]*)\1/i,
      (_m, q) => `description=${q}Warna Kustom (${safeAuthor})${q}`
    );
  }

  if (/^<script\b[^>]*application\/ld\+json/i.test(raw)) {
    return raw.replace(
      /"(?:name|alternateName|description)"\s*:\s*"[^"]*(?:chatgpt|openai|gpt-[0-9o]+|claude|anthropic|gemini|deepseek|copilot|qwen|grok|cursor|windsurf|bolt\.new|v0\.dev|ai[\s_-]?generated|dibuat\s+oleh\s+ai)[^"]*"/gi,
      (match) => `${match.split(':')[0]}: "${safeAuthor}"`
    );
  }

  if (finding.category === 'custom-attribute') {
    return '';
  }

  if (finding.category === 'attribution-credit') {
    if (/^<[^>]+>/.test(raw)) {
      return raw.replace(
        /(>)([^<]*)(<\/)/,
        (_m, openEnd, _text, closeStart) => `${openEnd}Tema oleh ${safeAuthor}${closeStart}`
      );
    }
    return `Tema oleh ${safeAuthor}`;
  }

  if (raw.startsWith('<!--') && raw.endsWith('-->')) {
    return `<!-- Template disesuaikan oleh ${safeAuthor} -->`;
  }
  if (raw.startsWith('/*') && raw.endsWith('*/')) {
    return `/* Template disesuaikan oleh ${safeAuthor} */`;
  }
  if (raw.startsWith('//')) {
    return `// Disesuaikan oleh ${safeAuthor}`;
  }

  return raw;
}

export function customizeAiAttributionInXml(
  xml: string,
  customAuthor: string
): { nextXml: string; updatedCount: number } {
  const safeAuthor = customAuthor.replace(/[<>"'&]/g, '').trim() || 'Tim Tema Blog';
  const report = detectAiSignaturesInXml(xml);
  const targets = report.findings.filter((f) => f.confidence !== 'sinyal');
  if (targets.length === 0) {
    return { nextXml: xml, updatedCount: 0 };
  }

  const sortedDesc = [...targets].sort((a, b) => b.start - a.start);
  let nextXml = xml;
  let updatedCount = 0;

  for (const item of sortedDesc) {
    const replacement = suggestNeutralizedSnippet(item, safeAuthor);
    const updated =
      replacement === ''
        ? removeAiSignatureInXml(nextXml, item)
        : replaceAiSignatureInXml(nextXml, item, replacement);
    if (updated !== nextXml) {
      nextXml = updated;
      updatedCount += 1;
    }
  }

  if (report.invisibleWatermarkCount > 0) {
    const hadStartBom = xml.startsWith('\uFEFF');
    nextXml = stripInvisibleWatermarks(nextXml);
    if (hadStartBom && !nextXml.startsWith('\uFEFF')) {
      nextXml = `\uFEFF${nextXml}`;
    }
  }

  return { nextXml, updatedCount };
}

