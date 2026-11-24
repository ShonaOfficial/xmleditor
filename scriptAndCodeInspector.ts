import type {
  CssJsRedundancyReport,
  DetectedAssetUrl,
  DetectedEncodedCode,
  DuplicateAssetEntry,
  DuplicateCssRuleEntry,
  ExtractedCodeBlock,
  ExtractedTemplateViews,
  UnusedCssRuleEntry,
  UnusedCssVarEntry,
  XmlTextRange,
} from '../types/blogger';

function createLineCounter(source: string): (index: number) => number {
  const lineStarts: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) {
      lineStarts.push(i + 1);
    }
  }
  return (index: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lineStarts[mid] <= index) lo = mid + 1;
      else hi = mid - 1;
    }
    return Math.max(1, lo);
  };
}

function getAttrValue(attrString: string, attrName: string): string {
  const regex = new RegExp(`\\b${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const match = regex.exec(attrString);
  return match ? (match[1] ?? match[2] ?? '') : '';
}

function extractHostLabel(url: string): string {
  if (url.startsWith('data:')) return 'data-uri';
  try {
    const normalized = url.startsWith('//') ? `https:${url}` : url;
    if (!/^https?:\/\//i.test(normalized)) return 'relatif / blogger';
    return new URL(normalized).hostname;
  } catch {
    return 'url-kustom';
  }
}

function inferAssetExtensionAndKind(
  url: string,
  hintKind?: 'js' | 'css'
): { kind: 'js' | 'css'; extension: DetectedAssetUrl['extension'] } {
  if (url.startsWith('data:')) {
    const isCss = /^data:text\/css/i.test(url);
    return { kind: isCss ? 'css' : 'js', extension: 'data-uri' };
  }
  const basePath = url.split('?')[0].split('#')[0].toLowerCase();
  if (basePath.endsWith('.css') || /fonts\.googleapis\.com\/css/i.test(url)) {
    return { kind: 'css', extension: 'css' };
  }
  if (basePath.endsWith('.jss')) return { kind: 'js', extension: 'jss' };
  if (basePath.endsWith('.mjs')) return { kind: 'js', extension: 'mjs' };
  if (basePath.endsWith('.cjs')) return { kind: 'js', extension: 'cjs' };
  if (basePath.endsWith('.js')) return { kind: 'js', extension: 'js' };
  if (hintKind) {
    return { kind: hintKind, extension: hintKind === 'css' ? 'css' : 'js' };
  }
  return { kind: 'js', extension: 'unknown' };
}

function decodeBase64Utf8(rawB64: string): string | null {
  try {
    const clean = rawB64.replace(/\s+/g, '');
    if (!clean || clean.length < 8) return null;
    const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4);
    let bytes: Uint8Array;
    if (typeof atob === 'function') {
      const bin = atob(padded);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else if (typeof Buffer !== 'undefined') {
      bytes = new Uint8Array(Buffer.from(padded, 'base64'));
    } else {
      return null;
    }

    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    if (!decoded.trim()) return null;

    let readable = 0;
    for (let i = 0; i < decoded.length; i++) {
      const c = decoded.charCodeAt(i);
      if ((c >= 32 && c <= 126) || c === 9 || c === 10 || c === 13 || (c >= 160 && c !== 65533)) {
        readable++;
      }
    }
    if (readable / decoded.length < 0.72) return null;
    return decoded;
  } catch {
    return null;
  }
}

function parseQuotedJsArg(source: string, startIdx: number): { value: string; endIdx: number } | null {
  const quote = source[startIdx];
  if (quote !== "'" && quote !== '"' && quote !== '`') return null;
  let out = '';
  let i = startIdx + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\' && i + 1 < source.length) {
      const next = source[i + 1];
      if (next === 'n') out += '\n';
      else if (next === 'r') out += '\r';
      else if (next === 't') out += '\t';
      else out += next;
      i += 2;
      continue;
    }
    if (ch === quote) {
      return { value: out, endIdx: i + 1 };
    }
    out += ch;
    i++;
  }
  return null;
}

function encodeBaseN(num: number, radix: number): string {
  const first = num < radix ? '' : encodeBaseN(Math.floor(num / radix), radix);
  const rem = num % radix;
  const digit = rem > 35 ? String.fromCharCode(rem + 29) : rem.toString(36);
  return first + digit;
}

export function unpackDeanEdwardsPacker(source: string): string | null {
  const headerRegex =
    /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)\s*\{[\s\S]{10,450}?\}\s*\(\s*/i;
  const headerMatch = headerRegex.exec(source);
  if (!headerMatch) return null;

  let cursor = headerMatch.index + headerMatch[0].length;
  const pArg = parseQuotedJsArg(source, cursor);
  if (!pArg) return null;
  cursor = pArg.endIdx;

  const restSlice = source.slice(cursor, cursor + 80);
  const acMatch = /^\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*/.exec(restSlice);
  if (!acMatch) return null;

  const radix = Number.parseInt(acMatch[1], 10);
  const count = Number.parseInt(acMatch[2], 10);
  if (!Number.isFinite(radix) || radix < 2 || radix > 62 || count <= 0 || count > 20000) {
    return null;
  }

  cursor += acMatch[0].length;
  const kArg = parseQuotedJsArg(source, cursor);
  if (!kArg) return null;

  const dict = kArg.value.split('|');
  const symbolMap = new Map<string, string>();
  for (let i = Math.min(count, dict.length) - 1; i >= 0; i--) {
    const word = dict[i];
    if (word) {
      symbolMap.set(encodeBaseN(i, radix), word);
    }
  }

  return pArg.value.replace(/\b[0-9a-zA-Z_]+\b/g, (tok) => symbolMap.get(tok) ?? tok);
}

export function decodeHexAndUnicodeEscapes(input: string): string {
  return input
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
    .replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (_, hex: string) => {
      try {
        return String.fromCodePoint(Number.parseInt(hex, 16));
      } catch {
        return _;
      }
    })
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    );
}

export function decodePercentEscapes(input: string): string {
  let out = input.replace(/%u([0-9a-fA-F]{4})/gi, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16))
  );
  for (let pass = 0; pass < 2; pass++) {
    let next: string;
    try {
      next = decodeURIComponent(out);
    } catch {
      next = out.replace(/%([0-9a-fA-F]{2})/g, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16))
      );
    }
    if (next === out) break;
    out = next;
  }
  return out;
}

export function decodeCharCodeCalls(input: string): string {
  return input.replace(
    /String\s*\.\s*(?:fromCharCode|fromCodePoint)\s*\(\s*((?:0x[0-9a-fA-F]+|\d+)(?:\s*,\s*(?:0x[0-9a-fA-F]+|\d+))+)\s*\)/gi,
    (_, numList: string) => {
      const chars = numList
        .split(',')
        .map((s) => s.trim())
        .map((tok) =>
          tok.toLowerCase().startsWith('0x')
            ? Number.parseInt(tok.slice(2), 16)
            : Number.parseInt(tok, 10)
        )
        .filter((n) => Number.isFinite(n) && n >= 0 && n <= 0x10ffff);
      if (chars.length === 0) return _;
      try {
        return `"${chars.map((n) => String.fromCodePoint(n)).join('')}"`;
      } catch {
        return _;
      }
    }
  );
}

function decodeHtmlEntityText(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number.parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/gi, (_, h: string) => String.fromCharCode(Number.parseInt(h, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Statically resolves common JS string obfuscation patterns used to conceal URLs:
 * - String array joins: ['https:', '', 'cdn.ex', 'app.jss'].join('/')
 * - Reversed strings: 'ssj.ppa/moc.ex//:sptth'.split('').reverse().join('')
 * - String literal concatenation: 'https://' + 'cdn.ex/' + 'app.jss'
 * - Simple lookup array (_0x12ab[0]) & local string variable substitution
 */
export function resolveJsUrlObfuscation(source: string): {
  resolved: string;
  techniques: string[];
} {
  let out = source;
  const techniques: string[] = [];

  // A. Resolve simple string lookup arrays: var _0xabc = ['...', '...']; -> substitute _0xabc[0]
  const lookupMap = new Map<string, string[]>();
  const arrayDeclRegex =
    /(?:var|let|const)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*\[([\s\S]{4,6000}?)\]\s*;/g;
  let arrMatch: RegExpExecArray | null;
  while ((arrMatch = arrayDeclRegex.exec(out)) !== null) {
    const varName = arrMatch[1];
    const items: string[] = [];
    const itemRe = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
    let im: RegExpExecArray | null;
    while ((im = itemRe.exec(arrMatch[2])) !== null) {
      items.push(decodeHexAndUnicodeEscapes(im[2]));
    }
    if (items.length > 0) {
      lookupMap.set(varName, items);
    }
  }
  if (lookupMap.size > 0) {
    const indexedRefRegex = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\[\s*(0x[0-9a-fA-F]+|\d+)\s*\]/g;
    const replacedLookup = out.replace(indexedRefRegex, (full, name: string, rawIdx: string) => {
      const list = lookupMap.get(name);
      if (!list) return full;
      const idx = rawIdx.toLowerCase().startsWith('0x')
        ? Number.parseInt(rawIdx.slice(2), 16)
        : Number.parseInt(rawIdx, 10);
      if (idx < 0 || idx >= list.length) return full;
      return JSON.stringify(list[idx]);
    });
    if (replacedLookup !== out) {
      out = replacedLookup;
      techniques.push('Tabel Lookup Array (_0x/Index)');
    }
  }

  // B. Resolve simple string variable bindings: const a = "https://"; const b = "cdn.ex";
  const stringVars = new Map<string, string>();
  const strVarRegex =
    /(?:var|let|const)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(['"])((?:\\.|(?!\2)[^\\]){1,320})\2\s*;/g;
  let sv: RegExpExecArray | null;
  while ((sv = strVarRegex.exec(out)) !== null) {
    const vName = sv[1];
    const vVal = decodeHexAndUnicodeEscapes(sv[3]);
    if (!stringVars.has(vName)) {
      stringVars.set(vName, vVal);
    }
  }

  // Fold template literals `https://${host}/app.jss` when variables are known
  if (stringVars.size > 0) {
    const tplReplaced = out.replace(/`([^`\n]{4,500})`/g, (full, inner: string) => {
      let changedTpl = false;
      const filled = inner.replace(/\$\{\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\}/g, (f2, vn: string) => {
        const val = stringVars.get(vn);
        if (val === undefined) return f2;
        changedTpl = true;
        return val;
      });
      return changedTpl ? JSON.stringify(filled) : full;
    });
    if (tplReplaced !== out) {
      out = tplReplaced;
      techniques.push('Template Literal Variabel');
    }
  }

  // C. Reversed strings: '...'.split('').reverse().join('')
  const revRegex =
    /(['"])((?:\\.|(?!\1)[^\\]){6,600})\1\s*\.\s*split\s*\(\s*(['"])\3\s*\)\s*\.\s*reverse\s*\(\s*\)\s*\.\s*join\s*\(\s*(['"])\4\s*\)/g;
  const revReplaced = out.replace(revRegex, (_, __, strVal: string) => {
    const reversed = Array.from(decodeHexAndUnicodeEscapes(strVal)).reverse().join('');
    return JSON.stringify(reversed);
  });
  if (revReplaced !== out) {
    out = revReplaced;
    techniques.push('Reverse String (.reverse().join)');
  }

  // D. Inline Array join: ['https:', '', 'cdn.site', 'app.jss'].join('/') or .join('')
  const arrayJoinRegex =
    /\[\s*((?:['"][^'"\n]{0,200}['"]\s*,\s*){1,80}['"][^'"\n]{0,200}['"])\s*\]\s*\.\s*join\s*\(\s*(['"])([^'"]{0,6})\2\s*\)/g;
  const arrJoinReplaced = out.replace(
    arrayJoinRegex,
    (_, listBody: string, __, sep: string) => {
      const parts: string[] = [];
      const pRe = /(['"])((?:\\.|(?!\1)[^\\])*)\1/g;
      let pm: RegExpExecArray | null;
      while ((pm = pRe.exec(listBody)) !== null) {
        parts.push(decodeHexAndUnicodeEscapes(pm[2]));
      }
      return JSON.stringify(parts.join(sep));
    }
  );
  if (arrJoinReplaced !== out) {
    out = arrJoinReplaced;
    techniques.push('Array .join()');
  }

  // E. Concatenated strings & known string variables: 'https://' + 'cdn.ex/' + 'app.jss'
  const concatRegex =
    /(?:(['"])(?:\\.|(?!\1)[^\\\n]){1,240}\1|[a-zA-Z_$][a-zA-Z0-9_$]*)(?:\s*\+\s*(?:(['"])(?:\\.|(?!\2)[^\\\n]){1,240}\2|[a-zA-Z_$][a-zA-Z0-9_$]*)){1,25}/g;
  const concatReplaced = out.replace(concatRegex, (expr) => {
    const tokens = expr.split(/\s*\+\s*/);
    if (tokens.length < 2) return expr;
    let built = '';
    let hasLiteral = false;
    for (const tok of tokens) {
      const trimmed = tok.trim();
      const qm = /^(['"])([\s\S]*)\1$/.exec(trimmed);
      if (qm) {
        hasLiteral = true;
        built += decodeHexAndUnicodeEscapes(qm[2]);
      } else if (stringVars.has(trimmed)) {
        built += stringVars.get(trimmed)!;
      } else {
        return expr;
      }
    }
    if (!hasLiteral || built.length < 6) return expr;
    return JSON.stringify(built);
  });
  if (concatReplaced !== out) {
    out = concatReplaced;
    techniques.push('Concatenated String (+ Penggabungan)');
  }

  return { resolved: out, techniques };
}

function collectSignalsAndUrls(decoded: string): { revealedUrls: string[]; signals: string[] } {
  const revealedUrls = Array.from(
    new Set(
      (
        decoded.match(
          /(?:https?:)?\/\/[^\s"'`<>()\\]{5,}/gi
        ) || []
      ).filter((u) => !/w3\.org|schema\.org/i.test(u))
    )
  ).slice(0, 25);

  const signals: string[] = [];
  if (/(?:window|top|self)\.location(?:\.href)?\s*=|location\.replace\s*\(/i.test(decoded)) {
    signals.push('Mengandung pengalihan halaman (Redirect location)');
  }
  if (/document\.write(?:ln)?\s*\(|insertAdjacentHTML|innerHTML\s*=/i.test(decoded)) {
    signals.push('Menyisipkan elemen DOM/HTML lewat script (document.write / innerHTML)');
  }
  if (/<iframe\b|createElement\s*\(\s*['"]iframe['"]\s*\)/i.test(decoded)) {
    signals.push('Membuat elemen <iframe> dari dalam script');
  }
  if (/createElement\s*\(\s*['"](?:script|link)['"]\s*\)/i.test(decoded)) {
    signals.push('Memuat skrip atau stylesheet eksternal secara dinamis (createElement)');
  }
  if (/\beval\s*\(|new\s+Function\s*\(/i.test(decoded)) {
    signals.push('Eksekusi string kode dinamis (eval / Function)');
  }
  if (/atob\s*\(/i.test(decoded)) {
    signals.push('Pemanggilan decoder Base64 tambahan');
  }
  if (/credit|footer|designed\s+by|copyright|href\s*=\s*['"]https?:/i.test(decoded)) {
    signals.push('Berisi tautan atau proteksi kredit/copyright footer');
  }

  return { revealedUrls, signals };
}

export interface SmartDecodeResult {
  decodedText: string;
  appliedLayers: string[];
  revealedUrls: string[];
  signals: string[];
  changed: boolean;
}

export function smartDecodeCodeOffline(rawInput: string): SmartDecodeResult {
  let current = rawInput.trim();
  const appliedLayers: string[] = [];
  const pushLayer = (name: string) => {
    if (!appliedLayers.includes(name)) appliedLayers.push(name);
  };

  if (!current) {
    return { decodedText: '', appliedLayers, revealedUrls: [], signals: [], changed: false };
  }

  // If rawInput is a pure single base64 string (e.g. user pasted base64 directly)
  if (/^[A-Za-z0-9+/=\r\n]{12,}$/.test(current) && current.replace(/\s+/g, '').length >= 12) {
    const pureB64 = decodeBase64Utf8(current);
    if (pureB64) {
      current = pureB64;
      pushLayer('Base64 Raw');
    }
  }

  for (let pass = 0; pass < 4; pass++) {
    let passChanged = false;

    // 1. Dean Edwards Packer
    if (/eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k/i.test(current)) {
      const unpacked = unpackDeanEdwardsPacker(current);
      if (unpacked && unpacked !== current) {
        current = unpacked;
        pushLayer('Packer (p,a,c,k,e,d)');
        passChanged = true;
      }
    }

    // 2. String.fromCharCode / fromCodePoint
    if (/String\s*\.\s*(?:fromCharCode|fromCodePoint)\s*\(/i.test(current)) {
      const fromChar = decodeCharCodeCalls(current);
      if (fromChar !== current) {
        current = fromChar;
        pushLayer('String.fromCharCode');
        passChanged = true;
      }
    }

    // 3. Inline atob("..."), raw Base64 URLs (aHR0c...), and data:...;base64,...
    if (
      /atob\s*\(\s*["'][A-Za-z0-9+/=]{8,}["']\s*\)|data:[^;]+;base64,[A-Za-z0-9+/=]{8,}|(['"`])(?:aHR0cHM6Ly|aHR0cDovLw|Ly8)[A-Za-z0-9+/=]{8,}\1/i.test(
        current
      )
    ) {
      const nextB64 = current
        .replace(
          /atob\s*\(\s*(['"])([A-Za-z0-9+/=\s]{8,})\1\s*\)/gi,
          (full, _, b64: string) => {
            const dec = decodeBase64Utf8(b64);
            return dec ? JSON.stringify(dec) : full;
          }
        )
        .replace(
          /data:[^;]+;base64,([A-Za-z0-9+/=]{12,})/gi,
          (full, b64: string) => {
            const dec = decodeBase64Utf8(b64);
            return dec ? `/* data:base64 */\n${dec}` : full;
          }
        )
        .replace(
          /(['"`])((?:aHR0cHM6Ly|aHR0cDovLw|Ly8)[A-Za-z0-9+/=]{8,})\1/g,
          (full, q: string, b64: string) => {
            const dec = decodeBase64Utf8(b64);
            return dec && /^(?:https?:)?\/\//i.test(dec.trim()) ? `${q}${dec.trim()}${q}` : full;
          }
        );
      if (nextB64 !== current) {
        current = nextB64;
        pushLayer('Base64 (atob / Raw / Data URI)');
        passChanged = true;
      }
    }

    // 4. \xHH and \uHHHH escapes
    if (/\\x[0-9a-fA-F]{2}|\\u[0-9a-fA-F]{4}|\\u\{[0-9a-fA-F]+\}/.test(current)) {
      const nextEsc = decodeHexAndUnicodeEscapes(current);
      if (nextEsc !== current) {
        current = nextEsc;
        pushLayer('Hex / Unicode (\\x / \\u)');
        passChanged = true;
      }
    }

    // 5. URL / unescape / decodeURIComponent (%XX / %uXXXX)
    const pctMatches = current.match(/%(?:u[0-9a-fA-F]{4}|[0-9a-fA-F]{2})/g);
    if (pctMatches && pctMatches.length >= 2) {
      const nextPct = decodePercentEscapes(current);
      if (nextPct !== current) {
        current = nextPct;
        pushLayer('URL / Percent Escape (%XX)');
        passChanged = true;
      }
    }

    // 6. Encoded HTML entities (&lt;script... or &#104;&#116;...)
    if (/&lt;[a-z!/]|&#\d{2,4};|&#x[0-9a-fA-F]{2,4};/i.test(current)) {
      const nextEnt = decodeHtmlEntityText(current);
      if (nextEnt !== current) {
        current = nextEnt;
        pushLayer('HTML Entity (&# / &lt;)');
        passChanged = true;
      }
    }

    // 7. JS String concatenation, array .join(), .reverse().join(), and _0x lookup tables
    const resolvedJs = resolveJsUrlObfuscation(current);
    if (resolvedJs.resolved !== current) {
      current = resolvedJs.resolved;
      for (const t of resolvedJs.techniques) pushLayer(t);
      passChanged = true;
    }

    if (!passChanged) break;
  }

  const { revealedUrls, signals } = collectSignalsAndUrls(current);
  return {
    decodedText: current,
    appliedLayers,
    revealedUrls,
    signals,
    changed: appliedLayers.length > 0 && current !== rawInput.trim(),
  };
}

const ASSET_EXTENSION_REGEX = /\.(?:css|jss|mjs|cjs|js)(?:[?#]|$)/i;
const EXTERNAL_URL_EXTRACT_REGEX = /((?:https?:)?\/\/[^\s"'`<>()\\]{5,})/gi;

export function detectObfuscatedAndExternalUrlsInXml(xml: string): DetectedAssetUrl[] {
  const map = new Map<string, DetectedAssetUrl>();
  const lineAt = createLineCounter(xml);

  const registerAsset = (
    resolvedUrl: string,
    hintKind: 'js' | 'css' | undefined,
    sourceContext: string,
    index: number,
    options?: {
      rawUrl?: string;
      isObfuscated?: boolean;
      obfuscationTechnique?: string;
      rawExpression?: string;
    }
  ) => {
    const cleanUrl = resolvedUrl.trim().replace(/&amp;/g, '&').replace(/[),;]+$/, '');
    if (!cleanUrl || cleanUrl.startsWith('#') || /^javascript:/i.test(cleanUrl)) return;
    if (/w3\.org|schema\.org|google\.com\/2005\/gml|purl\.org/i.test(cleanUrl)) return;

    const { kind, extension } = inferAssetExtensionAndKind(cleanUrl, hintKind);
    const isDataUri = cleanUrl.startsWith('data:');
    const dedupKey = `${kind}::${cleanUrl}::${options?.isObfuscated ? 'obf' : 'dir'}`;

    const existing = map.get(dedupKey);
    if (existing) {
      existing.count++;
      return;
    }

    map.set(dedupKey, {
      id: `asset-${map.size + 1}`,
      kind,
      extension,
      url: cleanUrl,
      rawUrl: options?.rawUrl ?? resolvedUrl.trim(),
      host: extractHostLabel(cleanUrl),
      sourceContext,
      isDataUri,
      isObfuscated: options?.isObfuscated ?? false,
      obfuscationTechnique: options?.obfuscationTechnique,
      decodedUrl: options?.isObfuscated ? cleanUrl : undefined,
      rawExpression: options?.rawExpression,
      line: lineAt(index),
      count: 1,
    });
  };

  // 1. <script src="..."> and <script expr:src="..."> (supports .js, .jss, .mjs, .cjs, percent-encoded)
  const scriptSrcRegex = /<script\b([^>]*?)>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptSrcRegex.exec(xml)) !== null) {
    const src = getAttrValue(m[1], 'src') || getAttrValue(m[1], 'expr:src');
    if (!src) continue;
    const hasPercentObf = /%[0-9a-fA-F]{2}/.test(src) && /https?%3a|%2f%2f/i.test(src);
    if (hasPercentObf) {
      const dec = decodePercentEscapes(src);
      registerAsset(dec, 'js', '<script src> (Percent-Encoded)', m.index, {
        rawUrl: src,
        isObfuscated: true,
        obfuscationTechnique: 'URL Percent Encoding (%XX)',
        rawExpression: m[0],
      });
    } else {
      registerAsset(src, 'js', '<script src>', m.index);
    }
  }

  // 2. <link ...> stylesheets, Google Fonts, modulepreload scripts, .jss/.js/.css links
  const linkRegex = /<link\b([^>]*?)\/?>/gi;
  while ((m = linkRegex.exec(xml)) !== null) {
    const attrs = m[1];
    const rel = getAttrValue(attrs, 'rel').toLowerCase();
    const asAttr = getAttrValue(attrs, 'as').toLowerCase();
    const href = getAttrValue(attrs, 'href') || getAttrValue(attrs, 'expr:href');
    if (!href) continue;

    const decodedHref = /%[0-9a-fA-F]{2}|&#\d+;/.test(href)
      ? decodeHtmlEntityText(decodePercentEscapes(href))
      : href;
    const wasEncoded = decodedHref !== href && /^(?:https?:)?\/\//i.test(decodedHref);

    if (
      rel.includes('stylesheet') ||
      asAttr === 'style' ||
      decodedHref.includes('fonts.googleapis.com') ||
      /\.css(?:[?#]|$)/i.test(decodedHref)
    ) {
      const ctx = decodedHref.includes('fonts.googleapis.com')
        ? 'Google Fonts CSS'
        : '<link stylesheet>';
      registerAsset(decodedHref, 'css', ctx, m.index, {
        rawUrl: href,
        isObfuscated: wasEncoded,
        obfuscationTechnique: wasEncoded ? 'Encoded Attribute URL' : undefined,
        rawExpression: wasEncoded ? m[0] : undefined,
      });
    } else if (
      rel.includes('modulepreload') ||
      rel.includes('preload') ||
      asAttr === 'script' ||
      /\.(?:m?js|cjs|jss)(?:[?#]|$)/i.test(decodedHref)
    ) {
      registerAsset(decodedHref, 'js', '<link preload script>', m.index, {
        rawUrl: href,
        isObfuscated: wasEncoded,
        obfuscationTechnique: wasEncoded ? 'Encoded Attribute URL' : undefined,
        rawExpression: wasEncoded ? m[0] : undefined,
      });
    }
  }

  // 3. CSS @import url(...) or @import "..."
  const cssImportRegex =
    /@import\s+(?:url\(\s*(?:"([^"]+)"|'([^']+)'|([^)\s]+))\s*\)|"([^"]+)"|'([^']+)')/gi;
  while ((m = cssImportRegex.exec(xml)) !== null) {
    const importUrl = m[1] || m[2] || m[3] || m[4] || m[5];
    if (importUrl) {
      registerAsset(importUrl, 'css', 'CSS @import', m.index);
    }
  }

  // 4. Direct URLs containing .css / .jss / .js / .mjs / .cjs anywhere in XML, JS, or CSS
  const directAssetRegex =
    /((?:https?:)?\/\/[^\s"'`<>()\\]+\.(?:css|jss|mjs|cjs|js)(?:[?#][^\s"'`<>()\\]*)?)(?=[\s"'`<>()\\,;]|$)/gi;
  while ((m = directAssetRegex.exec(xml)) !== null) {
    const foundUrl = m[1];
    if (/w3\.org|schema\.org/i.test(foundUrl)) continue;
    const { kind, extension } = inferAssetExtensionAndKind(foundUrl);
    const label =
      extension === 'css'
        ? 'URL .CSS dalam kode'
        : extension === 'jss'
          ? 'URL .JSS dalam script/kode'
          : 'URL .JS dalam script/kode';
    registerAsset(foundUrl, kind, label, m.index);
  }

  // 5. Data URI scripts / styles
  const dataUriAssetRegex = /(data:text\/(javascript|ecmascript|css);base64,[A-Za-z0-9+/=]{12,})/gi;
  while ((m = dataUriAssetRegex.exec(xml)) !== null) {
    const kind = m[2].toLowerCase() === 'css' ? 'css' : 'js';
    registerAsset(m[1], kind, `Data URI (${kind.toUpperCase()} Base64)`, m.index);
  }

  // 6. Obfuscated & hidden external URLs inside <script> blocks
  const scriptBlockRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  while ((m = scriptBlockRegex.exec(xml)) !== null) {
    const body = m[2];
    if (!body || body.trim().length < 8) continue;

    // Quick pre-check: only run deep static decoder if any obfuscation signal is present
    const hasObfSignal =
      /eval\s*\(|atob\s*\(|String\s*\.\s*fromCharCode|unescape\s*\(|decodeURIComponent\s*\(|\\x[0-9a-fA-F]{2}|\\u[0-9a-fA-F]{4}|%[0-9a-fA-F]{2}|&#\d+|_0x[0-9a-fA-F]{3,}|\.reverse\s*\(\s*\)|\.join\s*\(|['"`]\s*\+\s*['"`a-zA-Z_$]|(?:aHR0cHM6Ly|aHR0cDovLw|Ly8)[A-Za-z0-9+/=]{8,}/.test(
        body
      );
    if (!hasObfSignal) continue;

    const smart = smartDecodeCodeOffline(body);
    if (!smart.changed && smart.appliedLayers.length === 0) continue;

    const techLabel = smart.appliedLayers.join(' → ') || 'URL Obfuscation';
    const rawPreview = body.trim().slice(0, 260);
    const decodedUrls = Array.from(
      new Set([
        ...smart.revealedUrls,
        ...(smart.decodedText.match(EXTERNAL_URL_EXTRACT_REGEX) || []),
      ])
    );

    for (const candidateRaw of decodedUrls) {
      const candidate = candidateRaw.replace(/[),;'"]+$/, '');
      if (!candidate || /w3\.org|schema\.org/i.test(candidate)) continue;
      // Only include if not literally present verbatim as a plain URL in the raw script body
      const isHidden = !body.includes(candidate);
      if (!isHidden) continue;
      const isAssetOrLoader =
        ASSET_EXTENSION_REGEX.test(candidate) ||
        isHidden ||
        /createElement|document\.write|fetch\s*\(|import\s*\(|\.(?:src|href)\s*=/.test(
          smart.decodedText
        );
      if (!isAssetOrLoader) continue;

      const hint: 'css' | 'js' =
        /\.css(?:[?#]|$)/i.test(candidate) || /stylesheet|\.rel\s*=\s*['"]stylesheet/i.test(smart.decodedText)
          ? 'css'
          : 'js';

      registerAsset(
        candidate,
        hint,
        `Tersembunyi di <script> (${techLabel})`,
        m.index,
        {
          rawUrl: rawPreview,
          isObfuscated: true,
          obfuscationTechnique: techLabel,
          rawExpression: rawPreview,
        }
      );
    }
  }

  // 7. Standalone percent-encoded, HTML-entity-encoded, or Base64-encoded URLs in attributes or inline text
  const encodedUrlAttrRegex =
    /((?:https?%3A%2F%2F|&#104;&#116;&#116;&#112;|&#x68;&#x74;&#x74;&#x70;|\\x68\\x74\\x74\\x70|\\u0068\\u0074\\u0074\\u0070)[^\s"'`<>]{6,320}|(?:aHR0cHM6Ly|aHR0cDovLw)[A-Za-z0-9+/=]{8,})/gi;
  while ((m = encodedUrlAttrRegex.exec(xml)) !== null) {
    const token = m[1];
    const smart = smartDecodeCodeOffline(token);
    const candidateStr = smart.decodedText.trim();
    const urlMatch = candidateStr.match(/(?:https?:)?\/\/[^\s"'`<>()\\]{5,}/i);
    if (!urlMatch) continue;
    const clean = urlMatch[0];
    if (/w3\.org|schema\.org|google\.com\/2005\/gml|purl\.org/i.test(clean)) continue;
    if (!smart.changed && clean === token) continue;
    const tech = smart.appliedLayers.join(' → ') || 'URL Encoding';
    registerAsset(clean, undefined, `URL Terkode (${tech})`, m.index, {
      rawUrl: token,
      isObfuscated: true,
      obfuscationTechnique: tech,
      rawExpression: token,
    });
  }

  return Array.from(map.values()).slice(0, 180);
}

export function detectJsCssUrlsInXml(xml: string): DetectedAssetUrl[] {
  return detectObfuscatedAndExternalUrlsInXml(xml);
}

/**
 * Extracts separate HTML View, .CSS blocks, .JS blocks, and external/obfuscated URLs
 * from a Blogger XML template without mutating the source XML.
 */
export function extractHtmlJsCssViewsFromXml(xml: string): ExtractedTemplateViews {
  const lineAt = createLineCounter(xml);
  const cssBlocks: ExtractedCodeBlock[] = [];
  const jsBlocks: ExtractedCodeBlock[] = [];

  const unwrapBlockCdata = (raw: string): string =>
    raw
      .replace(/^\s*(?:\/\*|\/\/)?\s*<!\[CDATA\[[\t ]*\r?\n?/i, '')
      .replace(/\r?\n?[\t ]*(?:\/\*|\/\/)?\s*\]\]>\s*(?:\*\/)?\s*$/i, '')
      .trim();

  // Extract <b:skin> and <b:template-skin>
  const skinRe = /<(b:skin|b:template-skin)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = skinRe.exec(xml)) !== null) {
    const tagName = m[1];
    const startLine = lineAt(m.index);
    const endLine = lineAt(m.index + m[0].length);
    const code = unwrapBlockCdata(m[2]);
    if (code) {
      cssBlocks.push({
        id: `css-block-${cssBlocks.length + 1}`,
        kind: 'css',
        sourceLabel: `<${tagName}>`,
        startLine,
        endLine,
        code,
        byteSize: code.length,
      });
    }
  }

  // Extract <style> blocks
  const styleRe = /<style\b([^>]*)>([\s\S]*?)<\/style>/gi;
  while ((m = styleRe.exec(xml)) !== null) {
    const startLine = lineAt(m.index);
    const endLine = lineAt(m.index + m[0].length);
    const code = unwrapBlockCdata(m[2]);
    if (code) {
      cssBlocks.push({
        id: `css-block-${cssBlocks.length + 1}`,
        kind: 'css',
        sourceLabel: `<style> (Baris ${startLine})`,
        startLine,
        endLine,
        code,
        byteSize: code.length,
      });
    }
  }

  // Extract inline <script> blocks
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  while ((m = scriptRe.exec(xml)) !== null) {
    const attrs = m[1];
    const scriptType = getAttrValue(attrs, 'type').toLowerCase();
    const src = getAttrValue(attrs, 'src') || getAttrValue(attrs, 'expr:src');
    const code = unwrapBlockCdata(m[2]);
    if (!code && !src) continue;
    if (scriptType === 'application/ld+json') continue;
    const startLine = lineAt(m.index);
    const endLine = lineAt(m.index + m[0].length);
    if (code) {
      jsBlocks.push({
        id: `js-block-${jsBlocks.length + 1}`,
        kind: 'js',
        sourceLabel: `<script> (Baris ${startLine})`,
        startLine,
        endLine,
        code,
        byteSize: code.length,
      });
    }
  }

  const combinedCss = cssBlocks
    .map((b) => `/* === ${b.sourceLabel} (Baris ${b.startLine}–${b.endLine}) === */\n${b.code}`)
    .join('\n\n');

  const combinedJs = jsBlocks
    .map((b) => `// === ${b.sourceLabel} (Baris ${b.startLine}–${b.endLine}) ===\n${b.code}`)
    .join('\n\n');

  // Build HTML Markup view (stripping bulky <b:skin>, <b:template-skin>, <style>, <script> bodies into clean placeholders)
  const htmlMarkup = xml
    .replace(
      /<(b:skin|b:template-skin)\b[^>]*>[\s\S]*?<\/\1>/gi,
      (_, tag: string) => `<!-- [${tag} diekstrak ke tab .CSS] -->`
    )
    .replace(
      /<style\b([^>]*)>[\s\S]*?<\/style>/gi,
      (_, attrs: string) => `<style${attrs}>/* [CSS diekstrak ke tab .CSS] */</style>`
    )
    .replace(
      /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
      (_, attrs: string, body: string) =>
        body.trim()
          ? `<script${attrs}>/* [Script diekstrak ke tab .JS / .JSS] */</script>`
          : `<script${attrs}></script>`
    )
    .trim();

  // Build clean safe HTML render preview (strips Blogger control tags visually, keeps CSS & HTML structure)
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(xml);
  const rawBody = bodyMatch ? bodyMatch[1] : xml;
  const cleanedBody = rawBody
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<b:skin\b[\s\S]*?<\/b:skin>/gi, '')
    .replace(/<b:template-skin\b[\s\S]*?<\/b:template-skin>/gi, '')
    .replace(/<b:(?:if|else|elseif|loop|with|switch|case|default|eval|attr|class|include|includable|defaultmarkup|defaultmarkups|widget-setting|widget-settings)\b[^>]*\/?>/gi, '')
    .replace(/<\/b:(?:if|loop|with|switch|case|default|includable|defaultmarkup|defaultmarkups|widget-settings)>/gi, '')
    .replace(/<b:section\b([^>]*)>/gi, '<section class="b-section" $1>')
    .replace(/<\/b:section>/gi, '</section>')
    .replace(/<b:widget\b([^>]*)>/gi, '<div class="b-widget" $1>')
    .replace(/<\/b:widget>/gi, '</div>')
    .replace(/<data:([a-zA-Z0-9_.]+)\s*\/>/gi, '<span class="b-data-token">[$1]</span>')
    .replace(/\bexpr:[a-zA-Z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');

  const safeCssForPreview = cssBlocks
    .filter((b) => b.sourceLabel.includes('skin') || b.sourceLabel.includes('<style>'))
    .map((b) =>
      b.code
        .replace(/<Group[\s\S]*?<\/Group>/gi, '')
        .replace(/<(?:Variable|b:variable)\b[^>]*\/?>/gi, '')
        .replace(/\$\([a-zA-Z0-9_.-]+\)/g, '#334155')
    )
    .join('\n');

  const htmlRenderPreview = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  body { font-family: system-ui, -apple-system, sans-serif; margin: 16px; color: #0f172a; background: #ffffff; }
  .b-section { border: 1px dashed #cbd5e1; padding: 10px; margin-bottom: 12px; border-radius: 8px; }
  .b-widget { border: 1px solid #e2e8f0; padding: 8px 10px; margin: 6px 0; border-radius: 6px; background: #f8fafc; }
  .b-data-token { font-family: monospace; font-size: 11px; color: #2563eb; background: #eff6ff; padding: 1px 5px; border-radius: 4px; }
  ${safeCssForPreview}
</style>
</head>
<body>
${cleanedBody}
</body>
</html>`;

  return {
    htmlMarkup,
    htmlRenderPreview,
    htmlLineCount: htmlMarkup ? htmlMarkup.split('\n').length : 0,
    cssBlocks,
    combinedCss,
    jsBlocks,
    combinedJs,
    externalUrls: detectObfuscatedAndExternalUrlsInXml(xml),
  };
}

export function detectEncodedCodesInXml(xml: string): DetectedEncodedCode[] {
  const results: DetectedEncodedCode[] = [];
  const seenSnippets = new Set<string>();
  const lineAt = createLineCounter(xml);

  const inferZone = (idx: number): string => {
    const before = xml.slice(Math.max(0, idx - 3000), idx).toLowerCase();
    if (before.lastIndexOf('<head') > before.lastIndexOf('</head>')) return 'HEAD';
    if (before.lastIndexOf('<footer') > before.lastIndexOf('</footer>')) return 'FOOTER';
    if (before.lastIndexOf('<b:widget') > before.lastIndexOf('</b:widget>')) return 'WIDGET';
    return 'BODY';
  };

  const pushFinding = (
    rawSnippet: string,
    index: number,
    technique: DetectedEncodedCode['technique'],
    techniqueLabel: string,
    decodedText: string
  ) => {
    const trimmed = rawSnippet.trim();
    if (!trimmed || seenSnippets.has(trimmed)) return;
    seenSnippets.add(trimmed);
    const { revealedUrls, signals } = collectSignalsAndUrls(decodedText);
    results.push({
      id: `enc-${results.length + 1}`,
      technique,
      techniqueLabel,
      zone: inferZone(index),
      line: lineAt(index),
      rawSnippet: trimmed,
      decodedText,
      revealedUrls,
      signals,
    });
  };

  // Scan <script> blocks for Packer, Hex arrays, CharCode, unescape, Base64
  const scriptBlockRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptBlockRegex.exec(xml)) !== null) {
    if (results.length >= 40) break;
    const body = m[2].trim();
    if (!body) continue;

    // 1. Dean Edwards Packer
    if (/eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k/i.test(body)) {
      const smart = smartDecodeCodeOffline(body);
      pushFinding(
        m[0],
        m.index,
        'packer',
        smart.appliedLayers.join(' -> ') || 'Dean Edwards Packer (eval p,a,c,k,e,d)',
        smart.decodedText
      );
      continue;
    }

    // 2. Heavy Hex / Unicode obfuscation (>= 6 escapes)
    const hexEscCount = (body.match(/\\x[0-9a-fA-F]{2}|\\u[0-9a-fA-F]{4}/g) || []).length;
    if (hexEscCount >= 6) {
      const smart = smartDecodeCodeOffline(body);
      pushFinding(
        m[0],
        m.index,
        'hex-unicode',
        `String Hex / Unicode Terenkripsi (${hexEscCount} token)`,
        smart.decodedText
      );
      continue;
    }

    // 3. String.fromCharCode obfuscation
    if (/String\s*\.\s*fromCharCode\s*\(\s*(?:0x[0-9a-fA-F]+|\d+)(?:\s*,\s*(?:0x[0-9a-fA-F]+|\d+)){3,}/i.test(body)) {
      const smart = smartDecodeCodeOffline(body);
      pushFinding(
        m[0],
        m.index,
        'charcode',
        'String.fromCharCode Obfuscation',
        smart.decodedText
      );
      continue;
    }

    // 4. Base64 atob() or base64 data URI inside script
    if (/atob\s*\(\s*["'][A-Za-z0-9+/=]{12,}["']\s*\)/i.test(body)) {
      const smart = smartDecodeCodeOffline(body);
      pushFinding(
        m[0],
        m.index,
        'base64',
        'Skrip Base64 (atob)',
        smart.decodedText
      );
      continue;
    }

    // 5. unescape / decodeURIComponent with densely percent-encoded string
    const pctEscCount = (body.match(/%(?:u[0-9a-fA-F]{4}|[0-9a-fA-F]{2})/g) || []).length;
    if (/(?:unescape|decodeURIComponent)\s*\(/i.test(body) && pctEscCount >= 3) {
      const smart = smartDecodeCodeOffline(body);
      pushFinding(
        m[0],
        m.index,
        'url-escape',
        'URL / unescape(%XX) Payload',
        smart.decodedText
      );
      continue;
    }

    // 6. General suspicious eval(...) or _0x lookup obfuscation
    if (/\beval\s*\((?![\s]*['"]use strict)/i.test(body) || /_0x[a-f0-9]{3,}/i.test(body)) {
      const smart = smartDecodeCodeOffline(body);
      pushFinding(
        m[0],
        m.index,
        'eval-obfuscation',
        smart.appliedLayers.join(' -> ') || 'Obfuskasi _0x / eval() dalam <script>',
        smart.decodedText
      );
      continue;
    }

    // 7. Concealed URL assembly (.reverse().join, [...].join, concatenated 'http' + ... or raw Base64 URL)
    if (
      /\.reverse\s*\(\s*\)\s*\.\s*join\s*\(|\[[^\]]{4,}\]\s*\.\s*join\s*\(|['"]https?:?\/?\/?['"]\s*\+|(?:aHR0cHM6Ly|aHR0cDovLw)[A-Za-z0-9+/=]{8,}/i.test(
        body
      )
    ) {
      const smart = smartDecodeCodeOffline(body);
      if (smart.changed && (smart.revealedUrls.length > 0 || /\.css|\.jss?|\.mjs/i.test(smart.decodedText))) {
        pushFinding(
          m[0],
          m.index,
          'url-escape',
          smart.appliedLayers.join(' -> ') || 'Penyembunyian URL dalam Script',
          smart.decodedText
        );
      }
    }
  }

  // Also check data:text/javascript|html;base64,... anywhere in attributes (href/src)
  const dataPayloadRegex = /data:text\/(?:javascript|ecmascript|html);base64,([A-Za-z0-9+/=]{16,})/gi;
  while ((m = dataPayloadRegex.exec(xml)) !== null) {
    if (results.length >= 45) break;
    const decoded = decodeBase64Utf8(m[1]);
    if (decoded) {
      pushFinding(m[0], m.index, 'base64', 'Data URI Script/HTML Base64', decoded);
    }
  }

  return results;
}

const BLOGGER_RUNTIME_CLASSES = new Set([
  'post',
  'posts',
  'post-outer',
  'post-title',
  'post-body',
  'post-header',
  'post-footer',
  'post-meta',
  'post-thumb',
  'post-summary',
  'entry-title',
  'entry-content',
  'blog-posts',
  'hfeed',
  'hentry',
  'jump-link',
  'widget',
  'widget-content',
  'widget-item-control',
  'quickedit',
  'titlewrapper',
  'descriptionwrapper',
  'status-msg-wrap',
  'status-msg-body',
  'blog-pager',
  'blog-pager-older-link',
  'blog-pager-newer-link',
  'home-link',
  'feed-links',
  'popular-posts',
  'item-thumbnail',
  'item-title',
  'item-snippet',
  'list-label-widget-content',
  'label-size',
  'comments',
  'comment-block',
  'comment-thread',
  'navbar',
  'no-items',
  'clear',
  'clearfix',
  'header',
  'pagelist',
  'blog',
  'label',
  'popularposts',
  'profile',
  'blogsearch',
  'featuredpost',
  'attribution',
  'adsense',
  'html',
  'selected',
  'active',
]);

const STATE_THEME_CLASS_KEYS = [
  'active',
  'show',
  'open',
  'close',
  'hide',
  'hidden',
  'lock',
  'selected',
  'disabled',
  'dark',
  'drkm',
];

function matchesSafelistPrefixToken(clsLower: string, rawPrefix: string): boolean {
  const p = rawPrefix.trim().replace(/^\.+/, '').toLowerCase();
  if (!p) return false;
  if (p.endsWith('-') || p.endsWith('_')) {
    return clsLower.includes(p);
  }
  return (
    clsLower === p ||
    clsLower.startsWith(`${p}-`) ||
    clsLower.startsWith(`${p}_`) ||
    clsLower.includes(`-${p}`) ||
    clsLower.includes(`_${p}`) ||
    clsLower.startsWith(p) ||
    (p.length >= 4 && clsLower.includes(p))
  );
}

function isSafelistedClassToken(clsLower: string, activePrefixes: string[]): boolean {
  for (const prefix of activePrefixes) {
    if (matchesSafelistPrefixToken(clsLower, prefix)) return true;
  }
  return BLOGGER_RUNTIME_CLASSES.has(clsLower);
}

function isSafelistedCssSelector(selectorGroup: string): boolean {
  return /\[(?:data-|aria-)/i.test(selectorGroup);
}

function normalizeAssetUrlForDedup(raw: string): string {
  return raw
    .trim()
    .replace(/&amp;/g, '&')
    .replace(/^https?:\/\//i, '//')
    .replace(/\/$/, '');
}

function extractLibrarySignature(url: string): string | null {
  const clean = url.split('?')[0].split('#')[0].toLowerCase();
  if (/jquery(?:[-.]\d[\d.]*)?(?:\.slim)?(?:\.min)?\.js$/i.test(clean)) return 'jquery.js';
  if (/adsbygoogle\.js$/i.test(clean)) return 'google-adsense.js';
  if (/googletagmanager\.com\/gtag\/js/i.test(url)) return 'google-gtag.js';
  if (/googletagmanager\.com\/gtm\.js/i.test(url)) return 'google-gtm.js';
  if (/font-?awesome|fontawesome/i.test(clean) && /\.css$/i.test(clean)) return 'font-awesome.css';
  if (/bootstrap(?:\.min)?\.css$/i.test(clean)) return 'bootstrap.css';
  if (/bootstrap(?:\.bundle)?(?:\.min)?\.js$/i.test(clean)) return 'bootstrap.js';
  if (/animate(?:\.min)?\.css$/i.test(clean)) return 'animate.css';
  if (/lazysizes(?:\.min)?\.js$/i.test(clean)) return 'lazysizes.js';
  if (/swiper(?:-bundle)?(?:\.min)?\.(?:js|css)$/i.test(clean)) {
    return clean.endsWith('.css') ? 'swiper.css' : 'swiper.js';
  }
  const fileMatch = /\/([a-z0-9._-]+?\.(?:min\.)?(?:js|css))$/i.exec(clean);
  if (!fileMatch) return null;
  const fname = fileMatch[1].replace(/[-.@]v?\d[\d.]*/gi, '');
  if (fname.length < 6 || fname === 'style.css' || fname === 'main.js' || fname === 'bundle.js') {
    return null;
  }
  return fname;
}

interface ParsedCssLeafRule {
  selector: string;
  body: string;
  fullRule: string;
  absStart: number;
  absEnd: number;
  bodyAbsStart: number;
  mediaScope: string;
  line: number;
  source: 'b:skin' | 'b:template-skin' | 'style';
}

function parseCssRulesBraceAware(
  rawCss: string,
  baseOffsetInXml: number,
  lineAt: (idx: number) => number,
  source: 'b:skin' | 'b:template-skin' | 'style'
): ParsedCssLeafRule[] {
  const results: ParsedCssLeafRule[] = [];
  const len = rawCss.length;

  // Replace Blogger XML tags (<Group>...</Group>, <Variable .../>, CDATA markers) and CSS comments with spaces
  // so indices still align 1:1 with rawCss!
  const masked = rawCss
    .replace(/<!\[CDATA\[/g, (m) => ' '.repeat(m.length))
    .replace(/\]\]>/g, (m) => ' '.repeat(m.length))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/<Group\b[\s\S]*?<\/Group>/gi, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/<(?:Variable|b:variable)\b(?:"[^"]*"|'[^']*'|[^>"'])*(?:\/>|>[\s\S]*?<\/(?:Variable|b:variable)>)/gi, (m) =>
      m.replace(/[^\n]/g, ' ')
    );

  const skipWhitespace = (from: number, limit: number): number => {
    let pos = from;
    while (pos < limit) {
      const code = masked.charCodeAt(pos);
      if (code === 32 || code === 9 || code === 10 || code === 13) pos++;
      else break;
    }
    return pos;
  };

  const walkBlock = (start: number, end: number, mediaScope: string) => {
    let cursor = start;
    let stmtStart = skipWhitespace(start, end);
    let quote: string | null = null;

    while (cursor < end) {
      const ch = masked[cursor];
      if (quote) {
        if (ch === '\\') {
          cursor += 2;
          continue;
        }
        if (ch === quote) quote = null;
        cursor++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        cursor++;
        continue;
      }
      if (ch === ';') {
        stmtStart = skipWhitespace(cursor + 1, end);
        cursor++;
        continue;
      }
      if (ch === '{') {
        const headerStart = skipWhitespace(stmtStart, cursor);
        const header = masked.slice(headerStart, cursor).trim();
        let depth = 1;
        let p = cursor + 1;
        let innerQuote: string | null = null;
        while (p < end && depth > 0) {
          const ic = masked[p];
          if (innerQuote) {
            if (ic === '\\') {
              p += 2;
              continue;
            }
            if (ic === innerQuote) innerQuote = null;
            p++;
            continue;
          }
          if (ic === '"' || ic === "'") {
            innerQuote = ic;
            p++;
            continue;
          }
          if (ic === '{') depth++;
          else if (ic === '}') depth--;
          p++;
        }

        const blockCloseIdx = p - 1;
        const innerStart = cursor + 1;
        const innerEnd = Math.max(innerStart, blockCloseIdx);

        if (header.startsWith('@')) {
          const lowerH = header.toLowerCase();
          if (
            lowerH.startsWith('@media') ||
            lowerH.startsWith('@supports') ||
            lowerH.startsWith('@layer')
          ) {
            const nextScope = mediaScope ? `${mediaScope} && ${header}` : header;
            walkBlock(innerStart, innerEnd, nextScope);
          }
        } else if (header && !/<\/?[a-zA-Z!:]+/.test(header) && headerStart < cursor) {
          const cleanHeader = header.replace(/\s+/g, ' ').trim();
          const bodyRaw = masked.slice(innerStart, innerEnd).trim();
          const absStart = baseOffsetInXml + headerStart;
          const absEnd = baseOffsetInXml + blockCloseIdx + 1;
          const fullRule = rawCss.slice(headerStart, blockCloseIdx + 1).trim();
          if (cleanHeader && bodyRaw && fullRule.length > 3) {
            results.push({
              selector: cleanHeader,
              body: bodyRaw,
              fullRule,
              absStart,
              absEnd,
              bodyAbsStart: baseOffsetInXml + innerStart,
              mediaScope,
              line: lineAt(absStart),
              source,
            });
          }
        }

        stmtStart = skipWhitespace(blockCloseIdx + 1, end);
        cursor = stmtStart;
        continue;
      }
      cursor++;
    }
  };

  walkBlock(0, len, '');
  return results;
}

function extractStemPrefixes(val: string, stemSet: Set<string>) {
  const re = /(?:^|[\s'"`+&|(:])([a-zA-Z][a-zA-Z0-9]{0,14}[-_])(?:\$\{|['"`]\s*\+|\s*\+)/g;
  let sm: RegExpExecArray | null;
  while ((sm = re.exec(val)) !== null) {
    stemSet.add(sm[1].toLowerCase());
  }
}

function collectReferencedTokensOutsideStyles(xml: string): {
  classes: Set<string>;
  ids: Set<string>;
  dynamicClasses: Set<string>;
  dynamicPrefixStems: Set<string>;
  hasJsClassManipulation: boolean;
  rawMarkupLower: string;
} {
  // Strip style blocks and XML comments so we inspect only active HTML, Blogger tags, widget settings & JS
  const stripped = xml
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<b:skin\b(?:"[^"]*"|'[^']*'|[^>"'])*>[\s\S]*?<\/b:skin>/gi, '')
    .replace(/<b:template-skin\b(?:"[^"]*"|'[^']*'|[^>"'])*>[\s\S]*?<\/b:template-skin>/gi, '')
    .replace(/<style\b(?:"[^"]*"|'[^']*'|[^>"'])*>[\s\S]*?<\/style>/gi, '');

  const decodeEntities = (val: string) =>
    val
      .replace(/&quot;/g, '"')
      .replace(/&#0*39;|&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');

  const classes = new Set<string>();
  const ids = new Set<string>();
  const dynamicClasses = new Set<string>();
  const dynamicPrefixStems = new Set<string>();
  let hasJsClassManipulation = false;

  // 1. HTML / XML static class vs dynamic expr:class (capture raw markup BEFORE decoding &quot;)
  const staticClassAttrRegex = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let m: RegExpExecArray | null;
  while ((m = staticClassAttrRegex.exec(stripped)) !== null) {
    if (m.index > 0 && stripped[m.index - 1] === ':') continue;
    const val = decodeEntities(m[1] ?? m[2] ?? '');
    for (const part of val.split(/[\s'"?:+&|(),;{}\[\]]+/)) {
      const clean = part.trim().toLowerCase();
      if (clean && /^[a-z_-][a-z0-9_-]*$/i.test(clean)) classes.add(clean);
    }
  }
  const exprClassAttrRegex = /\bexpr:class\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  while ((m = exprClassAttrRegex.exec(stripped)) !== null) {
    hasJsClassManipulation = true;
    const val = decodeEntities(m[1] ?? m[2] ?? '');
    extractStemPrefixes(val, dynamicPrefixStems);
    for (const part of val.split(/[\s'"?:+&|(),;{}\[\]]+/)) {
      const clean = part.trim().toLowerCase();
      if (clean && /^[a-z_-][a-z0-9_-]*$/i.test(clean)) {
        classes.add(clean);
        dynamicClasses.add(clean);
      }
    }
  }

  const idAttrRegex = /\b(?:expr:id|id|for|aria-labelledby|aria-describedby)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  while ((m = idAttrRegex.exec(stripped)) !== null) {
    const val = decodeEntities(m[1] ?? m[2] ?? '');
    for (const part of val.split(/[\s'"?:+&|(),;{}\[\]]+/)) {
      const clean = part.trim().toLowerCase();
      if (clean && /^[a-z_-][a-z0-9_-]*$/i.test(clean)) ids.add(clean);
    }
  }

  const hashHrefRegex = /\bhref\s*=\s*(?:"([^"]*#[^"]*)"|'([^']*#[^']*)')/gi;
  while ((m = hashHrefRegex.exec(stripped)) !== null) {
    const hrefVal = decodeEntities(m[1] ?? m[2] ?? '');
    const hIdx = hrefVal.indexOf('#');
    if (hIdx !== -1) {
      for (const part of hrefVal.slice(hIdx + 1).split(/[\s'"?:+&|(),;{}\[\]]+/)) {
        const clean = part.trim().toLowerCase();
        if (clean && /^[a-z_-][a-z0-9_-]*$/i.test(clean)) ids.add(clean);
      }
    }
  }

  // 2. Blogger <b:class>, <b:attr>, <b:if cond>, <b:with>, <b:loop>, expr:* expressions (quote-aware)
  const bClassRegex = /<b:(?:class|attr)\b((?:"[^"]*"|'[^']*'|[^>"'])*)\/?>/gi;
  while ((m = bClassRegex.exec(stripped)) !== null) {
    const attrs = m[1];
    const nameVal = decodeEntities(
      getAttrValue(attrs, 'name') || getAttrValue(attrs, 'expr:name')
    );
    const exprVal = decodeEntities(
      getAttrValue(attrs, 'value') ||
        getAttrValue(attrs, 'expr:value') ||
        getAttrValue(attrs, 'cond')
    );
    const isId = nameVal.toLowerCase() === 'id';
    const targetSet = isId ? ids : classes;
    if (!isId) {
      hasJsClassManipulation = true;
      extractStemPrefixes(`${nameVal} ${exprVal}`, dynamicPrefixStems);
    }
    for (const part of `${nameVal} ${exprVal}`.split(/[\s'"?:+&|(),;{}\[\]]+/)) {
      const clean = part.trim().toLowerCase();
      if (clean && /^[a-z_-][a-z0-9_-]*$/i.test(clean) && clean !== 'class' && clean !== 'id') {
        targetSet.add(clean);
        if (!isId) dynamicClasses.add(clean);
      }
    }
  }

  const condExprRegex = /\b(?:cond|expr:[a-zA-Z0-9_-]+|value)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  while ((m = condExprRegex.exec(stripped)) !== null) {
    const expr = decodeEntities(m[1] ?? m[2] ?? '');
    const quotedRe = /(['"])([a-zA-Z_-][a-zA-Z0-9_\s-]{1,80})\1/g;
    let qm: RegExpExecArray | null;
    while ((qm = quotedRe.exec(expr)) !== null) {
      for (const part of qm[2].split(/\s+/)) {
        const clean = part.trim().toLowerCase();
        if (clean && /^[a-z_-][a-z0-9_-]*$/i.test(clean)) {
          classes.add(clean);
          dynamicClasses.add(clean);
        }
      }
    }
  }

  // 3. Inline <script> selectors, querySelector*, getElementById, classList*, setProperty, and literals
  const scriptRegex = /<script\b((?:"[^"]*"|'[^']*'|[^>"'/]|\/(?!>))*)>([\s\S]*?)<\/script>/gi;
  while ((m = scriptRegex.exec(stripped)) !== null) {
    const js = m[2];
    const selCallMatches = js.matchAll(
      /(?:querySelector(?:All)?|closest|matches|\$|jQuery)\s*\(\s*(['"`])([^'"`]{1,240})\1/g
    );
    for (const sc of selCallMatches) {
      extractStemPrefixes(sc[2], dynamicPrefixStems);
      for (const cm of sc[2].match(/\.[a-zA-Z_-][a-zA-Z0-9_-]*/g) || []) {
        const low = cm.slice(1).toLowerCase();
        classes.add(low);
        dynamicClasses.add(low);
      }
      for (const im of sc[2].match(/#[a-zA-Z_-][a-zA-Z0-9_-]*/g) || []) {
        ids.add(im.slice(1).toLowerCase());
      }
    }
    const dotHashMatches = js.matchAll(/(?:['"`\s(,[])([.#])([a-zA-Z_-][a-zA-Z0-9_-]{1,})/g);
    for (const sm of dotHashMatches) {
      if (sm[1] === '.') {
        const low = sm[2].toLowerCase();
        classes.add(low);
        dynamicClasses.add(low);
      } else {
        ids.add(sm[2].toLowerCase());
      }
    }
    for (const cm of js.matchAll(/(['"`])([a-zA-Z][a-zA-Z0-9]{0,14}[-_])\1\s*\+/g)) {
      dynamicPrefixStems.add(cm[2].toLowerCase());
    }
    const classListMatches = js.matchAll(
      /(?:classList\.(?:add|remove|toggle|contains|replace)|addClass|removeClass|toggleClass|hasClass|getElementById|getElementsByClassName|className\s*(?:=|\+=)|\.id\s*=|setAttribute\s*\(\s*['"](?:class|id)['"]\s*,)([^;\n]{1,360})/g
    );
    for (const cm of classListMatches) {
      const isIdTarget = /\.id\s*=|getElementById|['"]id['"]\s*,/i.test(cm[0]);
      if (!isIdTarget) {
        hasJsClassManipulation = true;
        extractStemPrefixes(cm[1], dynamicPrefixStems);
      }
      for (const strLit of cm[1].match(/(['"`])([^'"`]+)\1/g) || []) {
        for (const tok of strLit.slice(1, -1).split(/[\s'"?:+&|(),;{}\[\]]+/)) {
          const clean = tok.trim().toLowerCase();
          if (clean && /^[a-z_-][a-z0-9_-]*$/i.test(clean)) {
            if (isIdTarget) ids.add(clean);
            else {
              classes.add(clean);
              dynamicClasses.add(clean);
            }
          }
        }
      }
    }
    const htmlInJsClassMatches = js.matchAll(/\bclass\s*=\s*(?:"([^"\n]{1,320})"|'([^'\n]{1,320})')/gi);
    for (const hc of htmlInJsClassMatches) {
      hasJsClassManipulation = true;
      const clsTpl = hc[1] ?? hc[2] ?? '';
      extractStemPrefixes(clsTpl, dynamicPrefixStems);
      for (const part of clsTpl.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
        const clean = part.trim().toLowerCase();
        if (clean && /^[a-z_-][a-z0-9_-]*$/i.test(clean)) {
          classes.add(clean);
          dynamicClasses.add(clean);
        }
      }
    }
    const tplWithHtmlMatches = js.matchAll(/`([^`]{1,8000})`/g);
    for (const tm of tplWithHtmlMatches) {
      const tplBody = tm[1];
      if (!/(?:class|id)\s*=|classList|querySelector/i.test(tplBody)) continue;
      hasJsClassManipulation = true;
      extractStemPrefixes(tplBody, dynamicPrefixStems);
      // Scan multiline class="..." and id="..." directly inside template literal body
      for (const tc of tplBody.matchAll(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
        const rawTCls = tc[1] ?? tc[2] ?? '';
        for (const part of rawTCls.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
          const clean = part.trim().toLowerCase();
          if (clean && /^[a-z_-][a-z0-9_-]*$/i.test(clean)) {
            classes.add(clean);
            dynamicClasses.add(clean);
          }
        }
      }
      for (const ti of tplBody.matchAll(/\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
        const rawTId = ti[1] ?? ti[2] ?? '';
        for (const part of rawTId.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
          const clean = part.trim().toLowerCase();
          if (clean && /^[a-z_-][a-z0-9_-]*$/i.test(clean)) ids.add(clean);
        }
      }
      for (const interp of tplBody.matchAll(/\$\{([^}]{1,240})\}/g)) {
        for (const ql of interp[1].match(/['"]([a-zA-Z_-][a-zA-Z0-9_\s-]{0,120})['"]/g) || []) {
          for (const tok of ql.slice(1, -1).split(/\s+/)) {
            const clean = tok.trim().toLowerCase();
            if (clean && /^[a-z_-][a-z0-9_-]*$/i.test(clean)) {
              classes.add(clean);
              dynamicClasses.add(clean);
            }
          }
        }
      }
    }
    const htmlInJsIdMatches = js.matchAll(/\bid\s*=\s*(?:"([^"\n]{1,180})"|'([^'\n]{1,180})')/gi);
    for (const hi of htmlInJsIdMatches) {
      const idTpl = hi[1] ?? hi[2] ?? '';
      for (const part of idTpl.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
        const clean = part.trim().toLowerCase();
        if (clean && /^[a-z_-][a-z0-9_-]*$/i.test(clean)) ids.add(clean);
      }
    }
  }

  return {
    classes,
    ids,
    dynamicClasses,
    dynamicPrefixStems,
    hasJsClassManipulation,
    rawMarkupLower: decodeEntities(stripped).toLowerCase(),
  };
}

function extractSelectorClassAndIdTokens(selectorGroup: string): {
  classes: string[];
  rawClasses: string[];
  ids: string[];
  isLayoutRule: boolean;
  isRootOrElementOnly: boolean;
} {
  const lower = selectorGroup.toLowerCase();
  const isLayoutRule =
    lower.includes('body#layout') ||
    lower.includes('.layout-') ||
    lower.includes('#layout');

  // Remove attribute brackets [href*="..."] and pseudo functions
  const cleaned = selectorGroup
    .replace(/\[[^\]]*\]/g, '')
    .replace(/:{1,2}[a-zA-Z-]+(?:\([^)]*\))?/g, '');

  const classes: string[] = [];
  const rawClasses: string[] = [];
  const ids: string[] = [];
  const classRe = /\.([a-zA-Z_-][a-zA-Z0-9_-]*)/g;
  const idRe = /#([a-zA-Z_-][a-zA-Z0-9_-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = classRe.exec(cleaned)) !== null) {
    rawClasses.push(m[1]);
    classes.push(m[1].toLowerCase());
  }
  while ((m = idRe.exec(cleaned)) !== null) ids.push(m[1].toLowerCase());

  return {
    classes,
    rawClasses,
    ids,
    isLayoutRule,
    isRootOrElementOnly: classes.length === 0 && ids.length === 0,
  };
}

function buildAutoDetectedSafelistPrefixes(
  allLeafRules: ParsedCssLeafRule[],
  dynamicClasses: Set<string>,
  dynamicPrefixStems: Set<string>,
  hasJsClassManipulation: boolean
): string[] {
  const dynamicList = Array.from(dynamicClasses);
  const candidates = new Set<string>();

  for (const rule of allLeafRules) {
    if (rule.source === 'b:template-skin') continue;
    const tok = extractSelectorClassAndIdTokens(rule.selector);
    if (tok.isLayoutRule) continue;
    for (const rawCls of tok.rawClasses) {
      const dm = /^([a-zA-Z][a-zA-Z0-9]{0,14}[-_])/.exec(rawCls);
      if (dm) {
        const stem = dm[1].toLowerCase();
        if (dynamicPrefixStems.has(stem) || dynamicList.some((d) => d.startsWith(stem))) {
          candidates.add(`.${stem}`);
        }
      }
      const rootPart = rawCls.split(/[-_]/)[0].toLowerCase();
      if (
        rootPart.length >= 2 &&
        (dynamicClasses.has(rootPart) ||
          dynamicList.some((d) => d.startsWith(`${rootPart}-`) || d.startsWith(`${rootPart}_`)))
      ) {
        candidates.add(`.${rootPart}`);
      }
      if (hasJsClassManipulation) {
        const clsLower = rawCls.toLowerCase();
        for (const st of STATE_THEME_CLASS_KEYS) {
          if (clsLower === st || clsLower.startsWith(`${st}-`) || clsLower.includes(`-${st}`)) {
            candidates.add(`.${st}`);
          }
        }
      }
    }
  }

  return Array.from(candidates);
}

export function analyzeCssJsRedundancyInXml(xml: string): CssJsRedundancyReport {
  const duplicateCssAssets: DuplicateAssetEntry[] = [];
  const duplicateJsAssets: DuplicateAssetEntry[] = [];
  const duplicateCssRules: DuplicateCssRuleEntry[] = [];
  const unusedCssRules: UnusedCssRuleEntry[] = [];
  const unusedCssVars: UnusedCssVarEntry[] = [];
  const lineAt = createLineCounter(xml);

  // 1. Scan external <link> CSS & CSS @import for exact URL & library duplicates
  type AssetOcc = { rawTag: string; url: string; line: number; range: XmlTextRange };
  const cssUrlGroups = new Map<string, AssetOcc[]>();
  const cssLibGroups = new Map<string, AssetOcc[]>();

  const linkRegex = /<link\b([^>]*?)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRegex.exec(xml)) !== null) {
    const attrs = m[1];
    const rel = getAttrValue(attrs, 'rel').toLowerCase();
    const href = getAttrValue(attrs, 'href') || getAttrValue(attrs, 'expr:href');
    if (!href) continue;
    const isCss =
      rel.includes('stylesheet') ||
      href.includes('fonts.googleapis.com') ||
      /\.css(?:[?#]|$)/i.test(href);
    if (!isCss) continue;

    const norm = normalizeAssetUrlForDedup(href);
    const occ: AssetOcc = {
      rawTag: m[0],
      url: href.replace(/&amp;/g, '&'),
      line: lineAt(m.index),
      range: { start: m.index, end: m.index + m[0].length },
    };
    const arr = cssUrlGroups.get(norm) || [];
    arr.push(occ);
    cssUrlGroups.set(norm, arr);

    const lib = extractLibrarySignature(href);
    if (lib) {
      const lArr = cssLibGroups.get(lib) || [];
      lArr.push(occ);
      cssLibGroups.set(lib, lArr);
    }
  }

  // Also scan CSS @import url(...)
  const cssImportRegex =
    /@import\s+(?:url\(\s*(?:"([^"]+)"|'([^']+)'|([^)\s]+))\s*\)|"([^"]+)"|'([^']+)')\s*;?/gi;
  while ((m = cssImportRegex.exec(xml)) !== null) {
    const importUrl = m[1] || m[2] || m[3] || m[4] || m[5];
    if (!importUrl) continue;
    const norm = normalizeAssetUrlForDedup(importUrl);
    const occ: AssetOcc = {
      rawTag: m[0],
      url: importUrl,
      line: lineAt(m.index),
      range: { start: m.index, end: m.index + m[0].length },
    };
    const arr = cssUrlGroups.get(norm) || [];
    arr.push(occ);
    cssUrlGroups.set(norm, arr);
  }

  for (const [normUrl, entries] of cssUrlGroups.entries()) {
    if (entries.length > 1) {
      const extras = entries.slice(1);
      const extraTags = extras.map((e) => e.rawTag);
      duplicateCssAssets.push({
        id: `dup-css-url-${duplicateCssAssets.length + 1}`,
        kind: 'css',
        duplicateType: 'exact-url',
        label: normUrl.split('/').pop() || normUrl,
        occurrences: entries.length,
        lines: entries.map((e) => e.line),
        urlsOrSnippets: entries.map((e) => e.url),
        removableRawTags: extraTags,
        removableRanges: extras.map((e) => e.range),
        reason: `Stylesheet URL yang sama dipanggil ${entries.length}× di dalam template.`,
        estimatedSavedBytes: extraTags.reduce((sum, t) => sum + t.length, 0),
      });
    }
  }

  for (const [lib, entries] of cssLibGroups.entries()) {
    const uniqueNorms = new Set(entries.map((e) => normalizeAssetUrlForDedup(e.url)));
    if (uniqueNorms.size > 1) {
      const extras = entries.slice(1);
      const extraTags = extras.map((e) => e.rawTag);
      duplicateCssAssets.push({
        id: `dup-css-lib-${duplicateCssAssets.length + 1}`,
        kind: 'css',
        duplicateType: 'same-library',
        label: `Pustaka ${lib} ganda (${uniqueNorms.size} versi/CDN berbeda)`,
        occurrences: entries.length,
        lines: entries.map((e) => e.line),
        urlsOrSnippets: entries.map((e) => e.url),
        removableRawTags: extraTags,
        removableRanges: extras.map((e) => e.range),
        reason: `Pustaka CSS "${lib}" dimuat lebih dari satu kali dari CDN/versi berbeda.`,
        estimatedSavedBytes: extraTags.reduce((sum, t) => sum + t.length, 0),
      });
    }
  }

  // 2. Scan <script> external & inline blocks for JS duplicates
  const jsUrlGroups = new Map<string, AssetOcc[]>();
  const jsLibGroups = new Map<string, AssetOcc[]>();
  const jsInlineGroups = new Map<
    string,
    Array<{ rawTag: string; preview: string; line: number; range: XmlTextRange }>
  >();

  const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  while ((m = scriptRegex.exec(xml)) !== null) {
    const attrs = m[1];
    const body = m[2].trim();
    const src = getAttrValue(attrs, 'src') || getAttrValue(attrs, 'expr:src');
    const line = lineAt(m.index);
    const range: XmlTextRange = { start: m.index, end: m.index + m[0].length };

    if (src) {
      const norm = normalizeAssetUrlForDedup(src);
      const occ: AssetOcc = {
        rawTag: m[0],
        url: src.replace(/&amp;/g, '&'),
        line,
        range,
      };
      const arr = jsUrlGroups.get(norm) || [];
      arr.push(occ);
      jsUrlGroups.set(norm, arr);

      const lib = extractLibrarySignature(src);
      if (lib) {
        const lArr = jsLibGroups.get(lib) || [];
        lArr.push(occ);
        jsLibGroups.set(lib, lArr);
      }
    } else if (body.length >= 24) {
      const typeAttr = getAttrValue(attrs, 'type').toLowerCase();
      if (typeAttr.includes('ld+json')) continue;
      const normInline = body.replace(/\s+/g, ' ').trim();
      const arr = jsInlineGroups.get(normInline) || [];
      arr.push({ rawTag: m[0], preview: normInline.slice(0, 120), line, range });
      jsInlineGroups.set(normInline, arr);
    }
  }

  for (const [normUrl, entries] of jsUrlGroups.entries()) {
    if (entries.length > 1) {
      const extras = entries.slice(1);
      const extraTags = extras.map((e) => e.rawTag);
      duplicateJsAssets.push({
        id: `dup-js-url-${duplicateJsAssets.length + 1}`,
        kind: 'js',
        duplicateType: 'exact-url',
        label: normUrl.split('/').pop() || normUrl,
        occurrences: entries.length,
        lines: entries.map((e) => e.line),
        urlsOrSnippets: entries.map((e) => e.url),
        removableRawTags: extraTags,
        removableRanges: extras.map((e) => e.range),
        reason: `Skrip eksternal (.js) identik dimuat ${entries.length}× — membebani kecepatan halaman.`,
        estimatedSavedBytes: extraTags.reduce((sum, t) => sum + t.length, 0),
      });
    }
  }

  for (const [lib, entries] of jsLibGroups.entries()) {
    const uniqueNorms = new Set(entries.map((e) => normalizeAssetUrlForDedup(e.url)));
    if (uniqueNorms.size > 1) {
      const extras = entries.slice(1);
      const extraTags = extras.map((e) => e.rawTag);
      duplicateJsAssets.push({
        id: `dup-js-lib-${duplicateJsAssets.length + 1}`,
        kind: 'js',
        duplicateType: 'same-library',
        label: `Pustaka ${lib} ganda (${uniqueNorms.size} sumber/versi)`,
        occurrences: entries.length,
        lines: entries.map((e) => e.line),
        urlsOrSnippets: entries.map((e) => e.url),
        removableRawTags: extraTags,
        removableRanges: extras.map((e) => e.range),
        reason: `Pustaka JS "${lib}" dimuat ganda dari versi/CDN berbeda, berisiko konflik fungsi.`,
        estimatedSavedBytes: extraTags.reduce((sum, t) => sum + t.length, 0),
      });
    }
  }

  for (const [, entries] of jsInlineGroups.entries()) {
    if (entries.length > 1) {
      const extras = entries.slice(1);
      const extraTags = extras.map((e) => e.rawTag);
      duplicateJsAssets.push({
        id: `dup-js-inline-${duplicateJsAssets.length + 1}`,
        kind: 'js',
        duplicateType: 'inline-block',
        label: `Blok <script> inline ganda (${entries[0].preview.slice(0, 42)}...)`,
        occurrences: entries.length,
        lines: entries.map((e) => e.line),
        urlsOrSnippets: entries.map((e) => e.preview),
        removableRawTags: extraTags,
        removableRanges: extras.map((e) => e.range),
        reason: `Blok JavaScript inline yang sama persis muncul ${entries.length}×.`,
        estimatedSavedBytes: extraTags.reduce((sum, t) => sum + t.length, 0),
      });
    }
  }

  // 3. Parse all CSS leaf rules across <b:skin>, <b:template-skin>, and <style>
  const allLeafRules: ParsedCssLeafRule[] = [];
  const skinMatch = /<b:skin\b(?:"[^"]*"|'[^']*'|[^>"'])*>([\s\S]*?)<\/b:skin>/i.exec(xml);
  if (skinMatch) {
    const innerOffset = skinMatch.index + skinMatch[0].indexOf(skinMatch[1]);
    allLeafRules.push(
      ...parseCssRulesBraceAware(skinMatch[1], innerOffset, lineAt, 'b:skin')
    );
  }
  const tplSkinMatch = /<b:template-skin\b(?:"[^"]*"|'[^']*'|[^>"'])*>([\s\S]*?)<\/b:template-skin>/i.exec(xml);
  if (tplSkinMatch) {
    const innerOffset = tplSkinMatch.index + tplSkinMatch[0].indexOf(tplSkinMatch[1]);
    allLeafRules.push(
      ...parseCssRulesBraceAware(tplSkinMatch[1], innerOffset, lineAt, 'b:template-skin')
    );
  }
  const styleBlockRegex = /<style\b((?:"[^"]*"|'[^']*'|[^>"'/]|\/(?!>))*)>([\s\S]*?)<\/style>/gi;
  while ((m = styleBlockRegex.exec(xml)) !== null) {
    const innerOffset = m.index + m[0].indexOf(m[2]);
    allLeafRules.push(...parseCssRulesBraceAware(m[2], innerOffset, lineAt, 'style'));
  }

  // 4. Detect Duplicate CSS Rules & Repeated Selectors in the same @media scope
  const identicalRuleGroups = new Map<string, ParsedCssLeafRule[]>();
  const selectorScopeGroups = new Map<string, ParsedCssLeafRule[]>();

  for (const rule of allLeafRules) {
    const normSel = rule.selector.replace(/\s+/g, ' ').trim();
    const normBody = rule.body.replace(/\s+/g, ' ').replace(/;\s+/g, ';').trim();
    const idKey = `${rule.mediaScope}::${normSel}::${normBody}`;
    const selKey = `${rule.mediaScope}::${normSel}`;

    const iArr = identicalRuleGroups.get(idKey) || [];
    iArr.push(rule);
    identicalRuleGroups.set(idKey, iArr);

    const sArr = selectorScopeGroups.get(selKey) || [];
    sArr.push(rule);
    selectorScopeGroups.set(selKey, sArr);
  }

  const flaggedIdenticalSelectors = new Set<string>();
  for (const rules of identicalRuleGroups.values()) {
    if (rules.length > 1) {
      flaggedIdenticalSelectors.add(`${rules[0].mediaScope}::${rules[0].selector}`);
      const extras = rules.slice(1);
      duplicateCssRules.push({
        id: `dup-css-rule-${duplicateCssRules.length + 1}`,
        selector: rules[0].selector,
        duplicateType: 'identical-rule',
        occurrences: rules.length,
        lines: rules.map((r) => r.line),
        source: rules[0].source,
        sampleBody: rules[0].body.slice(0, 120),
        removableRawRules: extras.map((r) => r.fullRule),
        removableRanges: extras.map((r) => ({ start: r.absStart, end: r.absEnd })),
        reason: `Aturan CSS identik (${rules[0].selector}) ditulis ${rules.length}× di template.`,
        estimatedSavedBytes: extras.reduce((sum, r) => sum + r.fullRule.length, 0),
      });
    }
  }

  for (const [selKey, rules] of selectorScopeGroups.entries()) {
    if (rules.length > 1 && !flaggedIdenticalSelectors.has(selKey)) {
      // Keep the latest rule in cascade order and allow clearing earlier repeated blocks
      const earlierDuplicates = rules.slice(0, -1);
      duplicateCssRules.push({
        id: `dup-css-sel-${duplicateCssRules.length + 1}`,
        selector: rules[0].selector,
        duplicateType: 'repeated-selector',
        occurrences: rules.length,
        lines: rules.map((r) => r.line),
        source: rules[0].source,
        sampleBody: rules.map((r) => r.body.slice(0, 60)).join(' | '),
        removableRawRules: earlierDuplicates.map((r) => r.fullRule),
        removableRanges: earlierDuplicates.map((r) => ({ start: r.absStart, end: r.absEnd })),
        reason: `Selector "${rules[0].selector}" dideklarasikan terpisah ${rules.length}× pada cakupan yang sama (blok akhir menimpa yang awal).`,
        estimatedSavedBytes: earlierDuplicates.reduce((sum, r) => sum + r.fullRule.length, 0),
      });
    }
  }

  // Also detect duplicate CSS Custom Properties (--var) in the same selector + @media scope
  const cssVarDefs = new Map<
    string,
    Array<{
      name: string;
      selector: string;
      line: number;
      source: ParsedCssLeafRule['source'];
      value: string;
      rawDecl: string;
      range: XmlTextRange;
    }>
  >();
  for (const rule of allLeafRules) {
    const ruleSlice = xml.slice(rule.absStart, rule.absEnd);
    const varRegex = /(--[a-zA-Z0-9_-]+)\s*:\s*([^;{}]+);?/g;
    let vm: RegExpExecArray | null;
    while ((vm = varRegex.exec(ruleSlice)) !== null) {
      const varName = vm[1].trim();
      const k = `${rule.mediaScope}::${rule.selector}::${varName}`;
      const arr = cssVarDefs.get(k) || [];
      arr.push({
        name: varName,
        selector: rule.selector,
        line: lineAt(rule.absStart + vm.index),
        source: rule.source,
        value: vm[2].trim(),
        rawDecl: vm[0],
        range: {
          start: rule.absStart + vm.index,
          end: rule.absStart + vm.index + vm[0].length,
        },
      });
      cssVarDefs.set(k, arr);
    }
  }
  for (const defs of cssVarDefs.values()) {
    if (defs.length > 1) {
      // Earlier declarations are overridden by the last one in CSS cascade
      const overridden = defs.slice(0, -1);
      duplicateCssRules.push({
        id: `dup-css-var-${duplicateCssRules.length + 1}`,
        selector: `${defs[0].selector} { ${defs[0].name} }`,
        duplicateType: 'duplicate-css-var',
        occurrences: defs.length,
        lines: defs.map((d) => d.line),
        source: defs[0].source,
        sampleBody: defs.map((d) => `${d.name}: ${d.value}`).join(' / '),
        removableRawRules: overridden.map((d) => d.rawDecl),
        removableRanges: overridden.map((d) => d.range),
        reason: `Variabel CSS "${defs[0].name}" didefinisikan ${defs.length}× pada ${defs[0].selector} (definisi akhir yang berlaku).`,
        estimatedSavedBytes: overridden.reduce((sum, d) => sum + d.rawDecl.length, 0),
      });
    }
  }

  // 5. Unused CSS Rules & Unused CSS Custom Properties
  const {
    classes: usedClasses,
    ids: usedIds,
    dynamicClasses,
    dynamicPrefixStems,
    hasJsClassManipulation,
  } = collectReferencedTokensOutsideStyles(xml);
  const autoPrefixes = buildAutoDetectedSafelistPrefixes(
    allLeafRules,
    dynamicClasses,
    dynamicPrefixStems,
    hasJsClassManipulation
  );

  for (const rule of allLeafRules) {
    if (rule.source === 'b:template-skin') continue; // Blogger layout editor rules
    if (isSafelistedCssSelector(rule.selector)) continue;
    const { classes, ids, isLayoutRule, isRootOrElementOnly } = extractSelectorClassAndIdTokens(
      rule.selector
    );
    if (isLayoutRule || isRootOrElementOnly) continue;
    if (classes.some((c) => isSafelistedClassToken(c, autoPrefixes))) continue;

    // Check comma-separated parts; rule is unused only if EVERY part's class/id tokens are missing
    const parts = rule.selector.split(',').map((p) => p.trim()).filter(Boolean);
    let anyPartUsed = false;
    let usesRuntimeBloggerClass = false;
    const uncheckedMissingTokens: string[] = [];

    for (const part of parts) {
      if (isSafelistedCssSelector(part)) {
        anyPartUsed = true;
        break;
      }
      const partInfo = extractSelectorClassAndIdTokens(part);
      if (partInfo.isRootOrElementOnly) {
        anyPartUsed = true;
        break;
      }

      const partAllTokensPresent =
        partInfo.classes.every((c) => {
          if (usedClasses.has(c)) return true;
          if (BLOGGER_RUNTIME_CLASSES.has(c)) {
            usesRuntimeBloggerClass = true;
            return false;
          }
          return false;
        }) && partInfo.ids.every((id) => usedIds.has(id));

      if (partAllTokensPresent) {
        anyPartUsed = true;
        break;
      }

      for (const c of partInfo.classes) {
        if (!usedClasses.has(c) && uncheckedMissingTokens.length < 4) {
          uncheckedMissingTokens.push(`.${c}`);
        }
      }
      for (const id of partInfo.ids) {
        if (!usedIds.has(id) && uncheckedMissingTokens.length < 4) {
          uncheckedMissingTokens.push(`#${id}`);
        }
      }
    }

    if (!anyPartUsed && uncheckedMissingTokens.length > 0) {
      const confidence: UnusedCssRuleEntry['confidence'] = usesRuntimeBloggerClass
        ? 'kemungkinan'
        : 'pasti';
      unusedCssRules.push({
        id: `unused-css-${unusedCssRules.length + 1}`,
        selector: rule.selector,
        fullRule: rule.fullRule,
        tokensChecked: uncheckedMissingTokens,
        line: rule.line,
        source: rule.source,
        confidence,
        estimatedBytes: rule.fullRule.length,
        range: { start: rule.absStart, end: rule.absEnd },
        reason:
          confidence === 'pasti'
            ? `Selector ${uncheckedMissingTokens.join(', ')} tidak dipanggil di HTML, tag Blogger (<b:class>/<b:attr>), maupun JavaScript.`
            : `Selector memuat kelas runtime Blogger (${uncheckedMissingTokens.join(', ')}) yang tidak tertulis eksplisit di HTML XML.`,
      });
    }
  }

  // O(N) Single-pass CSS Variable usage scan + Transitive Var Graph Protection
  const calledVarNames = new Set<string>();
  const varCallRegex = /var\(\s*(--[a-zA-Z0-9_-]+)/g;
  while ((m = varCallRegex.exec(xml)) !== null) {
    calledVarNames.add(m[1]);
  }
  const jsVarStringRegex = /['"`](--[a-zA-Z0-9_-]+)['"`]/g;
  while ((m = jsVarStringRegex.exec(xml)) !== null) {
    calledVarNames.add(m[1]);
  }

  const varGraph = new Map<string, string[]>();
  const allDeclVars: Array<{
    name: string;
    value: string;
    selector: string;
    line: number;
    declarationRaw: string;
    range: XmlTextRange;
  }> = [];

  for (const rule of allLeafRules) {
    const ruleSlice = xml.slice(rule.absStart, rule.absEnd);
    const varRegex = /(--[a-zA-Z0-9_-]+)\s*:\s*([^;{}]+);?/g;
    let vm: RegExpExecArray | null;
    while ((vm = varRegex.exec(ruleSlice)) !== null) {
      const name = vm[1].trim();
      const val = vm[2].trim();
      const deps: string[] = [];
      const depRe = /var\(\s*(--[a-zA-Z0-9_-]+)/g;
      let dm: RegExpExecArray | null;
      while ((dm = depRe.exec(val)) !== null) deps.push(dm[1]);
      if (deps.length > 0) {
        const list = varGraph.get(name) || [];
        list.push(...deps);
        varGraph.set(name, list);
      }
      allDeclVars.push({
        name,
        value: val,
        selector: rule.selector,
        line: lineAt(rule.absStart + vm.index),
        declarationRaw: vm[0],
        range: {
          start: rule.absStart + vm.index,
          end: rule.absStart + vm.index + vm[0].length,
        },
      });
    }
  }

  const varQueue = Array.from(calledVarNames);
  let qHead = 0;
  while (qHead < varQueue.length) {
    const curVar = varQueue[qHead++];
    for (const dep of varGraph.get(curVar) || []) {
      if (!calledVarNames.has(dep)) {
        calledVarNames.add(dep);
        varQueue.push(dep);
      }
    }
  }

  const seenUnusedVars = new Set<string>();
  for (const dVar of allDeclVars) {
    if (seenUnusedVars.has(dVar.name) || calledVarNames.has(dVar.name)) continue;
    seenUnusedVars.add(dVar.name);
    unusedCssVars.push({
      id: `unused-var-${unusedCssVars.length + 1}`,
      name: dVar.name,
      value: dVar.value,
      selector: dVar.selector,
      line: dVar.line,
      declarationRaw: dVar.declarationRaw,
      range: dVar.range,
    });
  }

  const totalDuplicateCssCount = duplicateCssAssets.length + duplicateCssRules.length;
  const totalDuplicateJsCount = duplicateJsAssets.length;
  const totalUnusedCssCount = unusedCssRules.length + unusedCssVars.length;

  const totalEstimatedSavingsBytes =
    duplicateCssAssets.reduce((s, a) => s + a.estimatedSavedBytes, 0) +
    duplicateJsAssets.reduce((s, a) => s + a.estimatedSavedBytes, 0) +
    duplicateCssRules.reduce((s, r) => s + r.estimatedSavedBytes, 0) +
    unusedCssRules
      .filter((u) => u.confidence === 'pasti')
      .reduce((s, u) => s + u.estimatedBytes, 0);

  return {
    duplicateCssAssets,
    duplicateJsAssets,
    duplicateCssRules,
    unusedCssRules: unusedCssRules.slice(0, 120),
    unusedCssVars: unusedCssVars.slice(0, 60),
    totalDuplicateCssCount,
    totalDuplicateJsCount,
    totalUnusedCssCount,
    totalEstimatedSavingsBytes,
  };
}

function removeXmlRangesCleanly(xml: string, rawRanges: XmlTextRange[]): string {
  if (rawRanges.length === 0) return xml;
  const validRanges = rawRanges
    .filter((r) => r.start >= 0 && r.end > r.start && r.end <= xml.length)
    .sort((a, b) => b.start - a.start);

  // Merge overlapping/duplicate ranges descending
  const deduped: XmlTextRange[] = [];
  for (const r of validRanges) {
    const prev = deduped[deduped.length - 1];
    if (prev && r.end > prev.start) {
      prev.start = Math.min(prev.start, r.start);
      prev.end = Math.max(prev.end, r.end);
    } else {
      deduped.push({ start: r.start, end: r.end });
    }
  }

  let next = xml;
  for (const range of deduped) {
    let removeStart = range.start;
    let removeEnd = range.end;
    if (next[removeEnd] === '\r' && next[removeEnd + 1] === '\n') removeEnd += 2;
    else if (next[removeEnd] === '\n') removeEnd += 1;

    const lineStart = next.lastIndexOf('\n', removeStart - 1) + 1;
    if (/^[ \t]*$/.test(next.slice(lineStart, removeStart))) {
      removeStart = lineStart;
    }
    next = next.slice(0, removeStart) + next.slice(removeEnd);
  }

  // Clean up any empty @media / @supports wrappers created by removing all inner rules
  next = next.replace(/@(?:media|supports|layer)\b[^{}]*\{\s*\}\s*(?:\r?\n)?/gi, '');
  return next;
}

export function removeDuplicateAssetsFromXml(
  xml: string,
  rawTagsToRemove: string[],
  removableRanges?: XmlTextRange[]
): string {
  if (
    removableRanges &&
    removableRanges.length > 0 &&
    removableRanges.length === rawTagsToRemove.length
  ) {
    const allExactMatch = removableRanges.every((r, idx) => {
      const expected = rawTagsToRemove[idx];
      return Boolean(expected) && xml.slice(r.start, r.end) === expected;
    });
    if (allExactMatch) {
      return removeXmlRangesCleanly(xml, removableRanges);
    }
  }

  // Fallback by raw tag string (supports both exact-url 2nd+ occurrence and same-library distinct tags)
  const ranges: XmlTextRange[] = [];
  for (const rawTag of rawTagsToRemove) {
    if (!rawTag) continue;
    const firstIdx = xml.indexOf(rawTag);
    if (firstIdx === -1) continue;
    const secondIdx = xml.indexOf(rawTag, firstIdx + rawTag.length);
    if (secondIdx !== -1) {
      ranges.push({ start: secondIdx, end: secondIdx + rawTag.length });
    } else {
      // Tag appears once (e.g., a different library/CDN version of the same library) -> remove it
      ranges.push({ start: firstIdx, end: firstIdx + rawTag.length });
    }
  }
  return removeXmlRangesCleanly(xml, ranges);
}

export function removeDuplicateCssRulesFromXml(
  xml: string,
  entries: DuplicateCssRuleEntry[]
): string {
  const exactRanges: XmlTextRange[] = [];
  const fallbackEntries: DuplicateCssRuleEntry[] = [];

  for (const entry of entries) {
    if (
      entry.removableRanges &&
      entry.removableRanges.length > 0 &&
      entry.removableRanges.length === entry.removableRawRules.length
    ) {
      const allExactMatch = entry.removableRanges.every((r, idx) => {
        const expected = entry.removableRawRules[idx];
        return Boolean(expected) && xml.slice(r.start, r.end) === expected;
      });
      if (allExactMatch) {
        exactRanges.push(...entry.removableRanges);
        continue;
      }
    }
    fallbackEntries.push(entry);
  }

  let next = exactRanges.length > 0 ? removeXmlRangesCleanly(xml, exactRanges) : xml;

  if (fallbackEntries.length > 0) {
    const fallbackRanges: XmlTextRange[] = [];
    for (const entry of fallbackEntries) {
      for (const fullRule of entry.removableRawRules) {
        if (!fullRule) continue;
        const firstIdx = next.indexOf(fullRule);
        if (firstIdx === -1) continue;
        const secondIdx = next.indexOf(fullRule, firstIdx + fullRule.length);
        const targetIdx = secondIdx !== -1 ? secondIdx : firstIdx;
        fallbackRanges.push({ start: targetIdx, end: targetIdx + fullRule.length });
      }
    }
    next = removeXmlRangesCleanly(next, fallbackRanges);
  }

  return next;
}

export function removeUnusedCssRulesFromXml(
  xml: string,
  rulesToRemove: UnusedCssRuleEntry[]
): string {
  const ranges: XmlTextRange[] = [];
  for (const rule of rulesToRemove) {
    if (
      rule.range &&
      rule.range.start >= 0 &&
      rule.range.end > rule.range.start &&
      xml.slice(rule.range.start, rule.range.end) === rule.fullRule
    ) {
      ranges.push(rule.range);
      continue;
    }
    if (!rule.fullRule) continue;
    const idx = xml.indexOf(rule.fullRule);
    if (idx !== -1) {
      ranges.push({ start: idx, end: idx + rule.fullRule.length });
    }
  }
  return removeXmlRangesCleanly(xml, ranges);
}

export function removeUnusedCssVarsFromXml(
  xml: string,
  varsToRemove: UnusedCssVarEntry[]
): string {
  const ranges: XmlTextRange[] = [];
  for (const v of varsToRemove) {
    if (
      v.range &&
      v.range.start >= 0 &&
      v.range.end > v.range.start &&
      (!v.declarationRaw || xml.slice(v.range.start, v.range.end) === v.declarationRaw)
    ) {
      ranges.push(v.range);
      continue;
    }
    if (!v.declarationRaw) continue;
    const idx = xml.indexOf(v.declarationRaw);
    if (idx !== -1) {
      ranges.push({ start: idx, end: idx + v.declarationRaw.length });
    }
  }
  return removeXmlRangesCleanly(xml, ranges);
}

export interface CapturedUrlStringItem {
  id: string;
  url: string;
  rawText: string;
  host: string;
  kind: 'css' | 'js' | 'api-feed' | 'media' | 'link' | 'other';
  extension?: string;
  sourceContext: string;
  line: number;
  isObfuscated: boolean;
  obfuscationTechnique?: string;
  isHttpInsecure: boolean;
  consoleCommand: string;
}

export interface CapturedJsConsoleItem {
  id: string;
  title: string;
  sourceContext: string;
  line: number;
  endLine: number;
  code: string;
  byteSize: number;
  isObfuscated: boolean;
  obfuscationLayers: string[];
  decodedPreview?: string;
  embeddedUrls: string[];
  detectedApis: string[];
  detectedFunctions: string[];
  needsCdataInXml: boolean;
  hasBloggerDynamicSyntax: boolean;
  consoleCommand: string;
}

export interface CapturedSelectorItem {
  id: string;
  selector: string;
  label: string;
  line: number;
  consoleCommand: string;
}

export interface ConsoleTestableReport {
  urlStrings: CapturedUrlStringItem[];
  jsSnippets: CapturedJsConsoleItem[];
  selectors: CapturedSelectorItem[];
}

export interface JsSnippetConsoleInspection {
  detectedApis: string[];
  detectedFunctions: string[];
  extractedUrls: string[];
  decodedLayers: string[];
  decodedCode: string;
  braceBalanceOk: boolean;
  parenBalanceOk: boolean;
  needsCdataForXml: boolean;
  warnings: string[];
}

const IGNORED_NS_URL_RE = /w3\.org\/|schema\.org\/|google\.com\/2005\/gml|purl\.org\//i;

function classifyCapturedUrlKind(url: string): CapturedUrlStringItem['kind'] {
  const clean = url.split('?')[0].split('#')[0].toLowerCase();
  if (clean.endsWith('.css') || /fonts\.googleapis\.com\/css/i.test(url)) return 'css';
  if (/\.(?:js|jss|mjs|cjs)$/.test(clean)) return 'js';
  if (/\/feeds\/|\/api\/|sitemap\.xml|robots\.txt|\.json$/i.test(url)) return 'api-feed';
  if (/\.(?:png|jpe?g|webp|gif|svg|ico|woff2?|ttf|mp4)$/i.test(clean)) return 'media';
  if (/^https?:\/\//i.test(url) || url.startsWith('//')) return 'link';
  return 'other';
}

function detectJsApis(code: string): string[] {
  const apis: string[] = [];
  const checks: Array<[RegExp, string]> = [
    [/\bfetch\s*\(/, 'fetch()'],
    [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
    [/document\.querySelector(?:All)?\s*\(/, 'querySelector()'],
    [/document\.getElementById\s*\(/, 'getElementById()'],
    [/document\.createElement\s*\(/, 'createElement()'],
    [/document\.write\s*\(/, 'document.write()'],
    [/\b(?:localStorage|sessionStorage)\b/, 'WebStorage'],
    [/addEventListener\s*\(/, 'addEventListener()'],
    [/\bwindow\.open\s*\(/, 'window.open()'],
    [/\beval\s*\(/, 'eval()'],
    [/\batob\s*\(/, 'atob()'],
    [/new\s+URL\s*\(/, 'URL()'],
  ];
  for (const [re, label] of checks) {
    if (re.test(code)) apis.push(label);
  }
  return apis;
}

function detectJsFunctionNames(code: string): string[] {
  const names = new Set<string>();
  const re1 = /\bfunction\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
  const re2 = /\b(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z_$][a-zA-Z0-9_$]*)\s*=>/g;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(code)) !== null) {
    names.add(`${m[1]}()`);
    if (names.size >= 8) break;
  }
  while ((m = re2.exec(code)) !== null) {
    names.add(`${m[1]}()`);
    if (names.size >= 8) break;
  }
  return Array.from(names);
}

function checkCodeDelimiters(code: string): { braceOk: boolean; parenOk: boolean } {
  let braces = 0;
  let parens = 0;
  let quote: string | null = null;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') braces++;
    else if (ch === '}') braces--;
    else if (ch === '(') parens++;
    else if (ch === ')') parens--;
    if (braces < 0 || parens < 0) return { braceOk: braces >= 0, parenOk: parens >= 0 };
  }
  return { braceOk: braces === 0, parenOk: parens === 0 };
}

export function inspectJsSnippetForConsole(rawCode: string): JsSnippetConsoleInspection {
  const smart = smartDecodeCodeOffline(rawCode);
  const combinedText = `${rawCode}\n${smart.decodedText}`;
  const urlMatches = combinedText.match(/((?:https?:)?\/\/[^\s"'`<>()\\]{5,})/gi) || [];
  const extractedUrls = Array.from(
    new Set([
      ...smart.revealedUrls,
      ...urlMatches.map((u) => u.replace(/&amp;/g, '&').replace(/[),;'"]+$/, '')),
    ])
  ).filter((u) => u && !IGNORED_NS_URL_RE.test(u));

  const detectedApis = detectJsApis(combinedText);
  const detectedFunctions = detectJsFunctionNames(rawCode);
  const { braceOk, parenOk } = checkCodeDelimiters(rawCode);
  const needsCdataForXml = /[&<>]/.test(rawCode) && !/<!\[CDATA\[/i.test(rawCode);

  const warnings: string[] = [];
  if (!braceOk) warnings.push('Kurung kurawal { } tidak seimbang.');
  if (!parenOk) warnings.push('Tanda kurung ( ) tidak seimbang.');
  if (needsCdataForXml) {
    warnings.push('Mengandung karakter &, <, atau > — wajib dibungkus //<![CDATA[ ... //]]> jika dimasukkan ke XML Blogger.');
  }
  if (extractedUrls.some((u) => /^http:\/\//i.test(u))) {
    warnings.push('Mengandung URL HTTP non-HTTPS yang berisiko Mixed Content.');
  }
  if (/eval\s*\(/i.test(rawCode)) {
    warnings.push('Menggunakan eval() yang berisiko performa/keamanan.');
  }

  return {
    detectedApis,
    detectedFunctions,
    extractedUrls,
    decodedLayers: smart.appliedLayers,
    decodedCode: smart.decodedText,
    braceBalanceOk: braceOk,
    parenBalanceOk: parenOk,
    needsCdataForXml,
    warnings,
  };
}

export function detectConsoleTestableTargetsInXml(
  xml: string,
  maxPerCategory = 80
): ConsoleTestableReport {
  const lineAt = createLineCounter(xml);
  const urlMap = new Map<string, CapturedUrlStringItem>();

  const registerUrl = (
    url: string,
    rawText: string,
    sourceContext: string,
    line: number,
    isObfuscated = false,
    obfuscationTechnique?: string,
    forcedKind?: CapturedUrlStringItem['kind'],
    extension?: string
  ) => {
    const clean = url.trim().replace(/&amp;/g, '&').replace(/[),;'"]+$/, '');
    if (!clean || clean.length < 6 || IGNORED_NS_URL_RE.test(clean)) return;
    if (urlMap.size >= maxPerCategory * 2) return;
    const key = clean.toLowerCase();
    if (urlMap.has(key)) return;
    urlMap.set(key, {
      id: `urlstr-${urlMap.size + 1}`,
      url: clean,
      rawText: rawText || clean,
      host: extractHostLabel(clean),
      kind: forcedKind ?? classifyCapturedUrlKind(clean),
      extension,
      sourceContext,
      line,
      isObfuscated,
      obfuscationTechnique,
      isHttpInsecure: /^http:\/\//i.test(clean),
      consoleCommand: `check ${clean}`,
    });
  };

  // 1. Capture all external & obfuscated URLs (.css, .js, .jss, etc.)
  const assetUrls = detectObfuscatedAndExternalUrlsInXml(xml);
  for (const a of assetUrls) {
    registerUrl(
      a.url,
      a.rawExpression || a.rawUrl,
      a.sourceContext,
      a.line,
      Boolean(a.isObfuscated),
      a.obfuscationTechnique,
      a.kind,
      a.extension
    );
  }

  // 2. Capture quoted URL strings anywhere in XML, HTML attributes, Blogger expr:, or inline scripts
  const quotedUrlStringRegex = /(['"`])((?:https?:)?\/\/[^\s"'`<>\\]{5,}|\/feeds\/[^\s"'`<>\\]{3,})\1/gi;
  let m: RegExpExecArray | null;
  while ((m = quotedUrlStringRegex.exec(xml)) !== null) {
    const found = m[2];
    const line = lineAt(m.index);
    const beforeCtx = xml.slice(Math.max(0, m.index - 180), m.index).toLowerCase();
    const inScript = beforeCtx.lastIndexOf('<script') > beforeCtx.lastIndexOf('</script>');
    const ctx = inScript ? 'String URL di dalam <script>' : 'String URL di XML/Atribut';
    registerUrl(found, m[0], ctx, line);
  }

  // 3. Capture JavaScript <script> blocks & inline event handlers
  const jsSnippets: CapturedJsConsoleItem[] = [];
  const unwrapScriptCdata = (raw: string): string =>
    raw
      .replace(/^\s*(?:\/\*|\/\/)?\s*<!\[CDATA\[[\t ]*\r?\n?/i, '')
      .replace(/\r?\n?[\t ]*(?:\/\*|\/\/)?\s*\]\]>\s*(?:\*\/)?\s*$/i, '')
      .trim();

  const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  while ((m = scriptRegex.exec(xml)) !== null) {
    if (jsSnippets.length >= maxPerCategory) break;
    const attrs = m[1];
    const scriptType = getAttrValue(attrs, 'type').toLowerCase();
    if (scriptType === 'application/ld+json') continue;
    const src = getAttrValue(attrs, 'src') || getAttrValue(attrs, 'expr:src');
    const cleanBody = unwrapScriptCdata(m[2]);
    const startLine = lineAt(m.index);
    const endLine = lineAt(m.index + m[0].length);

    if (!cleanBody && src) {
      jsSnippets.push({
        id: `js-ext-${jsSnippets.length + 1}`,
        title: `Eksternal <script src="${src.slice(0, 60)}${src.length > 60 ? '...' : ''}">`,
        sourceContext: 'Tag <script src>',
        line: startLine,
        endLine,
        code: m[0].trim(),
        byteSize: m[0].length,
        isObfuscated: false,
        obfuscationLayers: [],
        embeddedUrls: [src.replace(/&amp;/g, '&')],
        detectedApis: [],
        detectedFunctions: [],
        needsCdataInXml: false,
        hasBloggerDynamicSyntax: /expr:src/i.test(attrs),
        consoleCommand: `check ${src.replace(/&amp;/g, '&')}`,
      });
      continue;
    }

    if (!cleanBody) continue;
    const inspection = inspectJsSnippetForConsole(cleanBody);
    const hasObf = inspection.decodedLayers.length > 0;
    const hasBloggerDyn = /<b:(?:if|else|loop|eval|with)\b|data:[a-zA-Z0-9_.]+/i.test(cleanBody);
    const firstLineTitle =
      inspection.detectedFunctions[0] ||
      (hasObf ? `Skrip Terenkripsi (${inspection.decodedLayers[0]})` : null) ||
      cleanBody.split(/\r?\n/)[0].trim().slice(0, 56) ||
      `Blok <script> Inline`;

    // Register any decoded URLs uncovered inside this JS block
    for (const u of inspection.extractedUrls) {
      registerUrl(
        u,
        cleanBody.slice(0, 140),
        hasObf ? `Tersembunyi di JS (${inspection.decodedLayers.join(' → ')})` : 'String URL di JavaScript',
        startLine,
        hasObf,
        hasObf ? inspection.decodedLayers.join(' → ') : undefined
      );
    }

    jsSnippets.push({
      id: `js-blk-${jsSnippets.length + 1}`,
      title: firstLineTitle,
      sourceContext: `<script> Inline (Baris ${startLine}–${endLine})`,
      line: startLine,
      endLine,
      code: cleanBody,
      byteSize: cleanBody.length,
      isObfuscated: hasObf,
      obfuscationLayers: inspection.decodedLayers,
      decodedPreview: hasObf ? inspection.decodedCode.slice(0, 600) : undefined,
      embeddedUrls: inspection.extractedUrls,
      detectedApis: inspection.detectedApis,
      detectedFunctions: inspection.detectedFunctions,
      needsCdataInXml: !hasBloggerDyn && /[&<>]/.test(m[2]) && !/<!\[CDATA\[/i.test(m[2]),
      hasBloggerDynamicSyntax: hasBloggerDyn,
      consoleCommand: cleanBody.slice(0, 1800),
    });
  }

  // Also detect inline JS event handlers (onclick=..., onload=...)
  const inlineEvtRegex = /\b(on(?:click|load|submit|change|keyup|input))\s*=\s*(?:"([^"]{4,200})"|'([^']{4,200})')/gi;
  while ((m = inlineEvtRegex.exec(xml)) !== null) {
    if (jsSnippets.length >= maxPerCategory) break;
    const handlerCode = (m[2] || m[3] || '').trim();
    if (!handlerCode || handlerCode.startsWith('data:')) continue;
    const line = lineAt(m.index);
    const insp = inspectJsSnippetForConsole(handlerCode);
    jsSnippets.push({
      id: `js-ev-${jsSnippets.length + 1}`,
      title: `Event ${m[1]}: ${handlerCode.slice(0, 48)}`,
      sourceContext: `Atribut ${m[1]}`,
      line,
      endLine: line,
      code: handlerCode,
      byteSize: handlerCode.length,
      isObfuscated: insp.decodedLayers.length > 0,
      obfuscationLayers: insp.decodedLayers,
      embeddedUrls: insp.extractedUrls,
      detectedApis: insp.detectedApis,
      detectedFunctions: insp.detectedFunctions,
      needsCdataInXml: false,
      hasBloggerDynamicSyntax: false,
      consoleCommand: handlerCode,
    });
  }

  // 4. Capture real testable DOM selectors from XML (Widget IDs, Section IDs, prominent HTML classes)
  const selectors: CapturedSelectorItem[] = [];
  const seenSel = new Set<string>();
  const addSelector = (sel: string, label: string, line: number) => {
    if (!sel || seenSel.has(sel) || selectors.length >= 24) return;
    seenSel.add(sel);
    selectors.push({
      id: `sel-${selectors.length + 1}`,
      selector: sel,
      label,
      line,
      consoleCommand: `selector ${sel}`,
    });
  };

  const widgetIdRe = /<b:widget\b[^>]*\bid\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;
  while ((m = widgetIdRe.exec(xml)) !== null) {
    const id = m[1] || m[2];
    if (id) addSelector(`#${id}`, `Widget Blogger #${id}`, lineAt(m.index));
  }
  const secIdRe = /<b:section\b[^>]*\bid\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;
  while ((m = secIdRe.exec(xml)) !== null) {
    const id = m[1] || m[2];
    if (id) addSelector(`#${id}`, `Section Blogger #${id}`, lineAt(m.index));
  }
  const classAttrRe = /\bclass\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;
  while ((m = classAttrRe.exec(xml)) !== null) {
    const rawCls = (m[1] || m[2] || '').trim();
    const firstCls = rawCls
      .split(/\s+/)
      .find((c) => c.length >= 3 && /^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(c));
    if (firstCls) {
      addSelector(`.${firstCls}`, `Class .${firstCls}`, lineAt(m.index));
    }
    if (selectors.length >= 20) break;
  }

  return {
    urlStrings: Array.from(urlMap.values()).slice(0, maxPerCategory),
    jsSnippets,
    selectors,
  };
}

export interface CapturedQueryParamPair {
  key: string;
  value: string;
  isDynamicPlaceholder: boolean;
  category:
    | 'blogger'
    | 'api-feed'
    | 'search'
    | 'pagination'
    | 'tracking'
    | 'asset-version'
    | 'custom';
  meaningHint?: string;
}

export interface CapturedQueryStringItem {
  id: string;
  fullUrlOrTemplate: string;
  baseUrl: string;
  queryString: string;
  normalizedQueryString: string;
  xmlSafeQueryString: string;
  params: CapturedQueryParamPair[];
  sourceContext: string;
  line: number;
  hasRawAmpersandInXmlAttr: boolean;
  isObfuscated: boolean;
  consoleCommand: string;
}

export interface QueryAnalysisResult {
  normalizedUrl: string;
  baseUrl: string;
  queryString: string;
  xmlSafeQueryString: string;
  params: CapturedQueryParamPair[];
  bloggerBehaviorNotes: string[];
  warnings: string[];
}

function classifyQueryParamMeaning(
  key: string,
  value: string
): { category: CapturedQueryParamPair['category']; meaningHint?: string } {
  const k = key.toLowerCase();
  if (k === 'm') {
    return {
      category: 'blogger',
      meaningHint: value === '1' ? 'Mode tampilan seluler Blogger (?m=1)' : 'Mode tampilan desktop/mobile Blogger',
    };
  }
  if (k === 'q') {
    return { category: 'search', meaningHint: 'Kata kunci pencarian artikel Blogger (/search?q=...)' };
  }
  if (k === 'max-results' || k === 'start-index' || k === 'updated-max' || k === 'updated-min' || k === 'published-min') {
    return { category: 'pagination', meaningHint: 'Paginasi & batas jumlah postingan Blogger' };
  }
  if (k === 'alt' || k === 'callback' || k === 'orderby' || k === 'redirect') {
    return { category: 'api-feed', meaningHint: 'Format output / API Feeds Blogger (mis. json / json-in-script)' };
  }
  if (k === 'by-date' || k === 'showcomment' || k === 'spref' || k === 'hl') {
    return { category: 'blogger', meaningHint: 'Parameter bawaan navigasi / bahasa Blogger' };
  }
  if (k.startsWith('utm_') || k === 'fbclid' || k === 'gclid' || k === 'ref') {
    return { category: 'tracking', meaningHint: 'Parameter pelacakan kampanye / analitik' };
  }
  if (k === 'v' || k === 'ver' || k === 'family' || k === 'display' || k === 'wght') {
    return { category: 'asset-version', meaningHint: 'Versi aset CSS/JS atau parameter Google Fonts' };
  }
  return { category: 'custom' };
}

export function parseQueryParamsFromRawQuery(rawQuery: string): CapturedQueryParamPair[] {
  const cleaned = rawQuery
    .replace(/^\?/, '')
    .replace(/&amp;/gi, '&')
    .trim();
  if (!cleaned) return [];

  const pairs: CapturedQueryParamPair[] = [];
  const rawParts = cleaned.split('&').filter(Boolean);

  for (const part of rawParts) {
    const eqIdx = part.indexOf('=');
    const rawKey = eqIdx >= 0 ? part.slice(0, eqIdx) : part;
    const rawVal = eqIdx >= 0 ? part.slice(eqIdx + 1) : '';
    let key = rawKey;
    let value = rawVal;
    try {
      key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
    } catch {
      key = rawKey;
    }
    try {
      value = decodeURIComponent(rawVal.replace(/\+/g, ' '));
    } catch {
      value = rawVal;
    }
    if (!key) continue;
    const isDyn = /\$\{[^}]+\}|data:[a-zA-Z0-9_.]+|\[\s*dynamic\s*\]|<b:/i.test(value);
    const info = classifyQueryParamMeaning(key, value);
    pairs.push({
      key,
      value,
      isDynamicPlaceholder: isDyn,
      category: info.category,
      meaningHint: info.meaningHint,
    });
  }

  return pairs;
}

export function buildQueryStringFromPairs(
  params: Array<{ key: string; value: string; enabled?: boolean }>
): { rawQuery: string; xmlSafeQuery: string } {
  const active = params.filter((p) => p.enabled !== false && p.key.trim().length > 0);
  if (active.length === 0) return { rawQuery: '', xmlSafeQuery: '' };
  const encodedParts = active.map(
    (p) => `${encodeURIComponent(p.key.trim())}=${encodeURIComponent(p.value)}`
  );
  const joined = `?${encodedParts.join('&')}`;
  return {
    rawQuery: joined,
    xmlSafeQuery: joined.replace(/&/g, '&amp;'),
  };
}

export function parseAndAnalyzeQueryString(
  rawInput: string,
  fallbackBaseUrl = ''
): QueryAnalysisResult {
  const trimmed = rawInput
    .trim()
    .replace(/^['"`]|['"`]$/g, '')
    .replace(/&amp;/gi, '&');

  let baseUrl = fallbackBaseUrl.trim();
  let queryPart = '';

  const qMarkIdx = trimmed.indexOf('?');
  if (qMarkIdx >= 0) {
    const candidateBase = trimmed.slice(0, qMarkIdx).trim();
    if (candidateBase) baseUrl = candidateBase;
    queryPart = trimmed.slice(qMarkIdx + 1).split('#')[0];
  } else if (/^https?:\/\/|^\/\//i.test(trimmed)) {
    baseUrl = trimmed.split('#')[0];
    queryPart = '';
  } else if (trimmed.includes('=')) {
    queryPart = trimmed.split('#')[0];
  }

  const params = parseQueryParamsFromRawQuery(queryPart);
  const { rawQuery, xmlSafeQuery } = buildQueryStringFromPairs(params);
  const normalizedBase = baseUrl ? baseUrl.replace(/\?.*$/, '') : '';
  const normalizedUrl = normalizedBase
    ? `${normalizedBase}${rawQuery}`
    : rawQuery || trimmed;

  const bloggerBehaviorNotes: string[] = [];
  const warnings: string[] = [];

  for (const p of params) {
    if (p.meaningHint) {
      bloggerBehaviorNotes.push(`${p.key}=${p.value || '(kosong)'} → ${p.meaningHint}`);
    }
    if (p.key.toLowerCase() === 'alt' && /json/i.test(p.value)) {
      bloggerBehaviorNotes.push(
        'Feed JSON Blogger mengembalikan objek feed.entry[] — pastikan URL berada di jalur /feeds/posts/default atau /feeds/comments/default.'
      );
    }
    if (p.key.toLowerCase() === 'callback' && !/^[a-zA-Z_$][a-zA-Z0-9_$.]*$/.test(p.value)) {
      warnings.push(`Nama callback JSONP "${p.value}" mengandung karakter tidak standar.`);
    }
  }

  if (/&amp;/i.test(rawInput) && !trimmed.startsWith('<')) {
    warnings.push(
      'Input mengandung entity HTML (&amp;). Untuk permintaan browser/JS/fetch, gunakan "&" biasa; untuk atribut XML Blogger, gunakan "&amp;".'
    );
  }
  if (/^http:\/\//i.test(normalizedUrl)) {
    warnings.push('Base URL menggunakan HTTP non-HTTPS (berisiko Mixed Content).');
  }

  return {
    normalizedUrl,
    baseUrl: normalizedBase,
    queryString: rawQuery,
    xmlSafeQueryString: xmlSafeQuery,
    params,
    bloggerBehaviorNotes: Array.from(new Set(bloggerBehaviorNotes)),
    warnings,
  };
}

export function detectQueryStringsAndParamsInXml(
  xml: string,
  maxItems = 90
): CapturedQueryStringItem[] {
  const lineAt = createLineCounter(xml);
  const items: CapturedQueryStringItem[] = [];
  const seen = new Set<string>();

  const registerQueryItem = (
    fullUrlOrTemplate: string,
    baseUrl: string,
    rawQuery: string,
    sourceContext: string,
    line: number,
    options?: { hasRawAmpersand?: boolean; isObfuscated?: boolean }
  ) => {
    const cleanQuery = rawQuery.startsWith('?') ? rawQuery : `?${rawQuery}`;
    const normalizedQuery = cleanQuery.replace(/&amp;/gi, '&');
    const params = parseQueryParamsFromRawQuery(normalizedQuery);
    if (params.length === 0) return;

    const dedupKey = `${baseUrl.toLowerCase()}::${normalizedQuery.toLowerCase()}`;
    if (seen.has(dedupKey)) {
      if (options?.hasRawAmpersand) {
        const existing = items.find(
          (it) =>
            `${(it.baseUrl.startsWith('(') ? '' : it.baseUrl).toLowerCase()}::${it.normalizedQueryString.toLowerCase()}` ===
              dedupKey ||
            `${it.baseUrl.toLowerCase()}::${it.normalizedQueryString.toLowerCase()}` === dedupKey
        );
        if (existing) {
          existing.hasRawAmpersandInXmlAttr = true;
        }
      }
      return;
    }
    if (items.length >= maxItems) return;
    seen.add(dedupKey);

    items.push({
      id: `qs-${items.length + 1}`,
      fullUrlOrTemplate: fullUrlOrTemplate.trim(),
      baseUrl: baseUrl.trim() || '(relatif / halaman aktif)',
      queryString: cleanQuery,
      normalizedQueryString: normalizedQuery,
      xmlSafeQueryString: normalizedQuery.replace(/&/g, '&amp;'),
      params,
      sourceContext,
      line,
      hasRawAmpersandInXmlAttr: Boolean(options?.hasRawAmpersand),
      isObfuscated: Boolean(options?.isObfuscated),
      consoleCommand:
        baseUrl && /^https?:\/\//i.test(baseUrl)
          ? `query ${baseUrl}${normalizedQuery}`
          : `query ${normalizedQuery}`,
    });
  };

  // 1. Scan all URLs & decoded URLs from detectConsoleTestableTargetsInXml that contain "?"
  const targetReport = detectConsoleTestableTargetsInXml(xml, 120);
  for (const u of targetReport.urlStrings) {
    const qIdx = u.url.indexOf('?');
    if (qIdx < 0) continue;
    const baseUrl = u.url.slice(0, qIdx);
    const queryStr = u.url.slice(qIdx).split('#')[0];
    registerQueryItem(u.url, baseUrl, queryStr, u.sourceContext, u.line, {
      isObfuscated: u.isObfuscated,
    });
  }

  // 2. Scan XML attributes with query strings (href, expr:href, src, expr:src, action, data-url)
  const attrQueryRe =
    /\b((?:expr:)?(?:href|src|action|data-src|data-url|content))\s*=\s*(?:"([^"]*\?[^"]*)"|'([^']*\?[^']*)')/gi;
  let m: RegExpExecArray | null;
  while ((m = attrQueryRe.exec(xml)) !== null) {
    const attrName = m[1];
    const attrVal = (m[2] ?? m[3] ?? '').trim();
    const qIdx = attrVal.indexOf('?');
    if (qIdx < 0) continue;
    const basePart = attrVal
      .slice(0, qIdx)
      .replace(/(?:&quot;|&apos;|['"\s+])+$/gi, '');
    const queryPart = attrVal.slice(qIdx).split(/['"#]|&quot;|&apos;/i)[0].trim();
    if (!queryPart.includes('=')) continue;
    const hasRawAmp = /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/.test(queryPart);
    registerQueryItem(
      attrVal,
      basePart || '(relatif / Blogger expr)',
      queryPart,
      `Atribut <... ${attrName}=...>`,
      lineAt(m.index),
      { hasRawAmpersand: hasRawAmp }
    );
  }

  // 3. Scan JavaScript relative/template query strings (?key=val...) and URLSearchParams
  const jsQueryLiteralRe = /(['"`])([^'"`\n]*\?[a-zA-Z0-9_.-]+=[^'"`\n]+)\1/g;
  while ((m = jsQueryLiteralRe.exec(xml)) !== null) {
    const lit = m[2];
    const qIdx = lit.indexOf('?');
    if (qIdx < 0) continue;
    const base = lit.slice(0, qIdx).replace(/(?:&quot;|&apos;|['"\s+])+$/gi, '');
    const query = lit.slice(qIdx).split(/#|&quot;|&apos;/i)[0].trim();
    if (!query.includes('=')) continue;
    registerQueryItem(lit, base || '(path relatif)', query, 'Query String di JavaScript/XML', lineAt(m.index));
  }

  // Detect URLSearchParams / location.search parameter keys in <script>
  const searchParamsVars = new Set<string>(['searchParams']);
  const assignSpVarRe = /\b(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:new\s+)?URLSearchParams\b/gi;
  while ((m = assignSpVarRe.exec(xml)) !== null) {
    if (m[1]) searchParamsVars.add(m[1]);
  }
  const spVarPattern = Array.from(searchParamsVars)
    .map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const urlSearchParamsKeyRe = new RegExp(
    `(?:\\b(?:${spVarPattern})\\b|URLSearchParams[^;]{0,60})\\.(?:get|getAll|has|set|append)\\s*\\(\\s*(['"\`])([a-zA-Z0-9_.-]+)\\1(?:\\s*,\\s*(['"\`])([^'"\`]*)\\3)?`,
    'gi'
  );
  const collectedJsKeys: Array<{ key: string; value: string; line: number }> = [];
  while ((m = urlSearchParamsKeyRe.exec(xml)) !== null) {
    collectedJsKeys.push({
      key: m[2],
      value: m[4] || 'sample',
      line: lineAt(m.index),
    });
  }
  if (collectedJsKeys.length > 0) {
    const built = collectedJsKeys.map((k) => `${k.key}=${k.value}`).join('&');
    registerQueryItem(
      `?${built}`,
      '(JS URLSearchParams)',
      `?${built}`,
      'JavaScript URLSearchParams',
      collectedJsKeys[0].line
    );
  }

  // 4. Scan HTML <form> inputs (e.g. search bar <form action="/search"><input name="q"/></form>)
  const formRegex = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  while ((m = formRegex.exec(xml)) !== null) {
    const formAttrs = m[1];
    const formBody = m[2];
    const action = getAttrValue(formAttrs, 'action') || getAttrValue(formAttrs, 'expr:action') || '/search';
    const inputNames: string[] = [];
    const inputRe = /<input\b([^>]*?)>/gi;
    let im: RegExpExecArray | null;
    while ((im = inputRe.exec(formBody)) !== null) {
      const nameAttr = getAttrValue(im[1], 'name');
      const valAttr = getAttrValue(im[1], 'value') || (nameAttr === 'q' ? 'kata-kunci' : '1');
      if (nameAttr) {
        inputNames.push(`${encodeURIComponent(nameAttr)}=${encodeURIComponent(valAttr)}`);
      }
    }
    if (inputNames.length > 0) {
      const qStr = `?${inputNames.join('&')}`;
      registerQueryItem(
        `${action}${qStr}`,
        action,
        qStr,
        'Form HTML (<form> + <input name>)',
        lineAt(m.index)
      );
    }
  }

  return items;
}

export type QueryParamSourceKind =
  | 'urlsearchparams'
  | 'location-search'
  | 'new-url'
  | 'regex-parser'
  | 'custom-helper'
  | 'form-get'
  | 'link-query'
  | 'template-expr';

export interface DetectedQueryParamSource {
  kind: QueryParamSourceKind;
  label: string;
  line: number;
  context: string;
  snippet: string;
}

export interface DetectedQueryParameter {
  id: string;
  name: string;
  candidateValues: string[];
  defaultValue: string;
  suggestedValue: string;
  isBooleanFlag: boolean;
  sources: DetectedQueryParamSource[];
  primarySourceLabel: string;
  primaryLine: number;
  testQueryExample: string;
  consoleSnippet: string;
}

export interface DynamicQueryManualNotice {
  id: string;
  line: number;
  reason: string;
  snippet: string;
}

export interface DynamicQueryScanResult {
  xmlEmpty: boolean;
  parameters: DetectedQueryParameter[];
  manualCheckNotices: DynamicQueryManualNotice[];
  detectedBasePaths: string[];
  fullExampleQueryString: string;
}

const SOURCE_KIND_LABELS: Record<QueryParamSourceKind, string> = {
  urlsearchparams: 'URLSearchParams',
  'location-search': 'location.search',
  'new-url': 'new URL().searchParams',
  'regex-parser': 'Regex Query Parser',
  'custom-helper': 'Helper Query Kustom',
  'form-get': 'Form GET (<form>)',
  'link-query': 'Link / Atribut Query (?...)',
  'template-expr': 'Tag Template XML',
};

function stripCdataMarkersForScan(code: string): string {
  return code
    .replace(/\/\/\s*<!\[CDATA\[/gi, '          ')
    .replace(/\/\*\s*<!\[CDATA\[\s*\*\//gi, '            ')
    .replace(/\/\/\s*\]\]>/gi, '     ')
    .replace(/\/\*\s*\]\]>\s*\*\//gi, '       ')
    .replace(/<!\[CDATA\[/gi, '         ')
    .replace(/\]\]>/gi, '   ');
}

function extractMatchingBraceBlock(source: string, openBraceIdx: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openBraceIdx; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(openBraceIdx, i + 1);
    }
  }
  return source.slice(openBraceIdx, Math.min(source.length, openBraceIdx + 2000));
}

function extractValuesForJsVariable(scriptCode: string, varName: string): {
  values: string[];
  defaultValue: string;
} {
  const values: string[] = [];
  let defaultValue = '';
  const seen = new Set<string>();
  const addVal = (v: string, isDefault = false) => {
    const clean = v.trim();
    if (!clean && clean !== '') return;
    if (isDefault && !defaultValue) defaultValue = clean;
    if (!seen.has(clean)) {
      seen.add(clean);
      values.push(clean);
    }
  };

  const escVar = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let m: RegExpExecArray | null;

  // 1. Default fallback on variable usage/assignment: varName = ... || 'def' or ?? 'def'
  const fallbackRe = new RegExp(
    `\\b${escVar}\\b\\s*=[^;\\n]{1,140}(?:\\|\\||\\?\\?)\\s*(['"\`])([^'"\`\\n]{1,80})\\1`,
    'g'
  );
  while ((m = fallbackRe.exec(scriptCode)) !== null) {
    addVal(m[2], true);
  }

  // 2. if / else if / ternary equality: varName === 'val' or 'val' === varName
  const eqRightRe = new RegExp(
    `\\b${escVar}\\b\\s*(?:===|==|!==|!=)\\s*(['"\`])([^'"\`\\n]{1,80})\\1`,
    'g'
  );
  while ((m = eqRightRe.exec(scriptCode)) !== null) {
    addVal(m[2]);
  }
  const eqLeftRe = new RegExp(
    `(['"\`])([^'"\`\\n]{1,80})\\1\\s*(?:===|==|!==|!=)\\s*\\b${escVar}\\b`,
    'g'
  );
  while ((m = eqLeftRe.exec(scriptCode)) !== null) {
    addVal(m[2]);
  }

  // 3. switch (varName) { case 'a': ... case 'b': ... }
  const switchRe = new RegExp(`\\bswitch\\s*\\(\\s*${escVar}\\s*\\)\\s*\\{`, 'g');
  while ((m = switchRe.exec(scriptCode)) !== null) {
    const block = extractMatchingBraceBlock(scriptCode, m.index + m[0].length - 1);
    const caseRe = /\bcase\s+(['"`])([^'"`\n]{1,80})\1\s*:/g;
    let cm: RegExpExecArray | null;
    while ((cm = caseRe.exec(block)) !== null) {
      addVal(cm[2]);
    }
  }

  // 4. Array literal membership: ['a', 'b', 'c'].includes(varName) / .indexOf(varName)
  const arrCheckRe = new RegExp(
    `\\[([^\\]]{1,400})\\]\\s*\\.\\s*(?:includes|indexOf)\\s*\\(\\s*${escVar}\\b`,
    'g'
  );
  while ((m = arrCheckRe.exec(scriptCode)) !== null) {
    const strLitRe = /(['"`])([^'"`\n]{1,60})\1/g;
    let sm: RegExpExecArray | null;
    while ((sm = strLitRe.exec(m[1])) !== null) {
      addVal(sm[2]);
    }
  }

  // 5. Object mapping lookup: mapObj[varName]
  const mapLookupRe = new RegExp(`\\b([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*\\[\\s*${escVar}\\s*\\]`, 'g');
  while ((m = mapLookupRe.exec(scriptCode)) !== null) {
    const objName = m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const objDefRe = new RegExp(`\\b(?:const|let|var)\\s+${objName}\\s*=\\s*\\{`, 'g');
    let om: RegExpExecArray | null;
    while ((om = objDefRe.exec(scriptCode)) !== null) {
      const objBlock = extractMatchingBraceBlock(scriptCode, om.index + om[0].length - 1);
      const keyRe = /(?:^|[{,\n])\s*(?:(['"`])([a-zA-Z0-9_.-]+)\1|([a-zA-Z_$][a-zA-Z0-9_$-]*))\s*:/g;
      let km: RegExpExecArray | null;
      while ((km = keyRe.exec(objBlock)) !== null) {
        const keyName = km[2] ?? km[3];
        if (keyName && !['default', '__proto__'].includes(keyName)) {
          addVal(keyName);
        }
      }
    }
  }

  return { values, defaultValue };
}

function extractInlineExprValues(scriptCode: string, paramName: string): {
  values: string[];
  defaultValue: string;
} {
  const values: string[] = [];
  let defaultValue = '';
  const seen = new Set<string>();
  const addVal = (v: string, isDef = false) => {
    const clean = v.trim();
    if (!clean) return;
    if (isDef && !defaultValue) defaultValue = clean;
    if (!seen.has(clean)) {
      seen.add(clean);
      values.push(clean);
    }
  };

  const escParam = paramName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exprCore = `(?:[a-zA-Z_$][\\w$.]*\\.(?:get|getAll)|[a-zA-Z_$][\\w$]*Param\\w*)\\(\\s*(['"\`])${escParam}\\1\\s*\\)`;
  let m: RegExpExecArray | null;

  const eqRe = new RegExp(
    `${exprCore}\\s*(?:===|==|!==|!=)\\s*(['"\`])([^'"\`\\n]{1,80})\\2`,
    'g'
  );
  while ((m = eqRe.exec(scriptCode)) !== null) addVal(m[3]);

  const fallbackRe = new RegExp(
    `${exprCore}\\s*(?:\\|\\||\\?\\?)\\s*(['"\`])([^'"\`\\n]{1,80})\\2`,
    'g'
  );
  while ((m = fallbackRe.exec(scriptCode)) !== null) addVal(m[3], true);

  const switchInlineRe = new RegExp(`\\bswitch\\s*\\(\\s*${exprCore}\\s*\\)\\s*\\{`, 'g');
  while ((m = switchInlineRe.exec(scriptCode)) !== null) {
    const block = extractMatchingBraceBlock(scriptCode, m.index + m[0].length - 1);
    const caseRe = /\bcase\s+(['"`])([^'"`\n]{1,80})\1\s*:/g;
    let cm: RegExpExecArray | null;
    while ((cm = caseRe.exec(block)) !== null) addVal(cm[2]);
  }

  return { values, defaultValue };
}

export function scanDynamicQueryParametersInXml(xml: string): DynamicQueryScanResult {
  if (!xml || !xml.trim()) {
    return {
      xmlEmpty: true,
      parameters: [],
      manualCheckNotices: [],
      detectedBasePaths: [],
      fullExampleQueryString: '',
    };
  }

  const lineAt = createLineCounter(xml);
  const paramMap = new Map<
    string,
    {
      name: string;
      candidateValues: string[];
      valueSeen: Set<string>;
      defaultValue: string;
      isBooleanFlag: boolean;
      sources: DetectedQueryParamSource[];
      sourceSeen: Set<string>;
    }
  >();
  const manualNotices: DynamicQueryManualNotice[] = [];
  const manualNoticeSeen = new Set<string>();
  const basePathSet = new Set<string>();

  const registerParam = (
    rawName: string,
    source: DetectedQueryParamSource,
    options?: {
      values?: string[];
      defaultValue?: string;
      isBooleanFlag?: boolean;
    }
  ) => {
    const name = rawName.trim();
    if (!name || name.length > 80 || /[\s<>"'{}()$]/.test(name)) return;

    let entry = paramMap.get(name);
    if (!entry) {
      entry = {
        name,
        candidateValues: [],
        valueSeen: new Set<string>(),
        defaultValue: '',
        isBooleanFlag: false,
        sources: [],
        sourceSeen: new Set<string>(),
      };
      paramMap.set(name, entry);
    }

    const srcKey = `${source.kind}:${source.line}:${source.label}`;
    if (!entry.sourceSeen.has(srcKey)) {
      entry.sourceSeen.add(srcKey);
      entry.sources.push(source);
    }

    if (options?.isBooleanFlag) {
      entry.isBooleanFlag = true;
    }
    if (options?.defaultValue && !entry.defaultValue) {
      entry.defaultValue = options.defaultValue;
    }
    for (const v of options?.values || []) {
      const clean = v.trim();
      if (!clean || clean === 'undefined' || clean === 'null') continue;
      if (!entry.valueSeen.has(clean)) {
        entry.valueSeen.add(clean);
        entry.candidateValues.push(clean);
      }
    }
  };

  const addManualNotice = (line: number, reason: string, snippet: string) => {
    const key = `${line}:${reason}`;
    if (manualNoticeSeen.has(key) || manualNotices.length >= 25) return;
    manualNoticeSeen.add(key);
    manualNotices.push({
      id: `manual-${manualNotices.length + 1}`,
      line,
      reason,
      snippet: snippet.trim().slice(0, 180),
    });
  };

  // Helper to scan a JS body snippet (from <script> or inline on*= handler)
  const scanJsSnippetBody = (
    rawCode: string,
    baseOffsetInXml: number,
    contextTitle: string
  ) => {
    const code = stripCdataMarkersForScan(rawCode);
    const localLineAt = (localIdx: number) => lineAt(baseOffsetInXml + Math.max(0, localIdx));

    // Track URLSearchParams variables & URL instances
    const spVars = new Set<string>(['searchParams']);
    const urlVars = new Set<string>();
    const customHelpers = new Map<string, string>(); // fnName -> paramArgName

    let m: RegExpExecArray | null;

    const urlInstRe =
      /\b(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*new\s+URL\s*\(/gi;
    while ((m = urlInstRe.exec(code)) !== null) {
      urlVars.add(m[1]);
    }

    const spAssignRe =
      /\b(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:new\s+URLSearchParams\s*\(|(?:new\s+URL\([^)]*\)|[a-zA-Z_$][a-zA-Z0-9_$]*)\.searchParams)/gi;
    while ((m = spAssignRe.exec(code)) !== null) {
      spVars.add(m[1]);
    }

    // Identify custom query parser helper functions: function getParam(key) { ... location.search / URLSearchParams / [?&] ... }
    const fnDeclRe =
      /\bfunction\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?:,[^)]*)?\)\s*\{/g;
    while ((m = fnDeclRe.exec(code)) !== null) {
      const block = extractMatchingBraceBlock(code, m.index + m[0].length - 1);
      if (/URLSearchParams|location\.search|searchParams|\[[?&]+\]|RegExp/i.test(block)) {
        customHelpers.set(m[1], m[2]);
      }
    }
    const arrowFnRe =
      /\b(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*\(?\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?:,[^)]*)?\)?\s*=>\s*\{?/g;
    while ((m = arrowFnRe.exec(code)) !== null) {
      const tail = code.slice(m.index, Math.min(code.length, m.index + 500));
      if (/URLSearchParams|location\.search|searchParams|\[[?&]+\]|RegExp/i.test(tail)) {
        customHelpers.set(m[1], m[2]);
      }
    }

    // Pattern A & C: URLSearchParams & new URL().searchParams (.get / .getAll / .has)
    const spSources = [
      ...Array.from(spVars).map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      ...Array.from(urlVars).map((v) => `${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.searchParams`),
      'new\\s+URLSearchParams\\s*\\([^)]*\\)',
      'new\\s+URL\\s*\\([^)]*\\)\\.searchParams',
      '(?:window\\.|document\\.)?location\\.searchParams',
    ];
    const spTargetGroup = `(?:${spSources.join('|')})`;

    // Static string literal param names
    const spStaticCallRe = new RegExp(
      `(?:\\b(?:const|let|var)\\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*=\\s*)?(${spTargetGroup})\\s*\\.\\s*(get|getAll|has)\\s*\\(\\s*(['"\`])([^'"\`\\n]+)\\4\\s*\\)`,
      'gi'
    );
    while ((m = spStaticCallRe.exec(code)) !== null) {
      const assignedVar = m[1];
      const receiver = m[2];
      const method = m[3].toLowerCase();
      const paramName = m[5].trim();
      const kind: QueryParamSourceKind = /new\s+URL|\.searchParams/i.test(receiver)
        ? 'new-url'
        : 'urlsearchparams';
      const extracted = assignedVar
        ? extractValuesForJsVariable(code, assignedVar)
        : extractInlineExprValues(code, paramName);

      registerParam(
        paramName,
        {
          kind,
          label: `${kind === 'new-url' ? 'new URL().searchParams' : 'URLSearchParams'}.${method}('${paramName}')`,
          line: localLineAt(m.index),
          context: contextTitle,
          snippet: m[0].trim(),
        },
        {
          values: method === 'has' && extracted.values.length === 0 ? ['1', 'true'] : extracted.values,
          defaultValue: extracted.defaultValue,
          isBooleanFlag: method === 'has' && extracted.values.length === 0,
        }
      );
    }

    // Dynamic variable param name check: params.get(dynamicVar)
    const spDynCallRe = new RegExp(
      `(${spTargetGroup})\\s*\\.\\s*(get|getAll|has)\\s*\\(\\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*\\)`,
      'gi'
    );
    while ((m = spDynCallRe.exec(code)) !== null) {
      const argVar = m[3];
      if (!Array.from(customHelpers.values()).includes(argVar)) {
        addManualNotice(
          localLineAt(m.index),
          `Nama parameter dibentuk dinamis dari variabel "${argVar}" pada .${m[2]}(${argVar}) — perlu dicek manual nilai variabel tersebut.`,
          m[0]
        );
      }
    }

    // Pattern B: Direct location.search / window.location.search string checks
    const locSearchStrRe =
      /(?:window\.|document\.)?location\.search\s*\.\s*(?:includes|indexOf)\s*\(\s*(['"`])([^'"`\n]+)\1\s*\)/gi;
    while ((m = locSearchStrRe.exec(code)) !== null) {
      const token = m[2].replace(/^[?&]/, '').trim();
      const eqIdx = token.indexOf('=');
      const paramName = (eqIdx >= 0 ? token.slice(0, eqIdx) : token).trim();
      const literalVal = eqIdx >= 0 ? token.slice(eqIdx + 1).trim() : '';
      registerParam(
        paramName,
        {
          kind: 'location-search',
          label: `location.search.includes('${m[2]}')`,
          line: localLineAt(m.index),
          context: contextTitle,
          snippet: m[0],
        },
        {
          values: literalVal ? [literalVal] : ['1', 'true'],
          defaultValue: literalVal || '',
          isBooleanFlag: !literalVal,
        }
      );
    }

    // Pattern B2: Object.fromEntries(new URLSearchParams(location.search)) destructuring or property access
    const fromEntriesDestrRe =
      /\b(?:const|let|var)\s*\{([^}]+)\}\s*=\s*Object\.fromEntries\s*\(\s*new\s+URLSearchParams\s*\([^)]*\)\s*\)/gi;
    while ((m = fromEntriesDestrRe.exec(code)) !== null) {
      const fields = m[1].split(',');
      for (const f of fields) {
        const cleanField = f.trim();
        if (!cleanField) continue;
        const eqMatch = /^([a-zA-Z_$][\w$]*)(?:\s*:\s*([a-zA-Z_$][\w$]*))?(?:\s*=\s*(['"`])([^'"`]+)\3)?/.exec(
          cleanField
        );
        if (eqMatch) {
          const pName = eqMatch[1];
          const localVar = eqMatch[2] || pName;
          const inlineDef = eqMatch[4] || '';
          const ext = extractValuesForJsVariable(code, localVar);
          registerParam(
            pName,
            {
              kind: 'urlsearchparams',
              label: `Object.fromEntries(URLSearchParams) -> { ${pName} }`,
              line: localLineAt(m.index),
              context: contextTitle,
              snippet: m[0],
            },
            {
              values: inlineDef ? [inlineDef, ...ext.values] : ext.values,
              defaultValue: inlineDef || ext.defaultValue,
            }
          );
        }
      }
    }

    // Generic custom loop split('&') query parser notice if no explicit helper names matched inside it
    const genericSplitRe = /(?:window\.|document\.)?location\.search\s*(?:\.slice\([^)]*\)|\.substring\([^)]*\)|\.replace\([^)]*\))*\s*\.split\(\s*(['"`])&\1\s*\)/gi;
    while ((m = genericSplitRe.exec(code)) !== null) {
      addManualNotice(
        localLineAt(m.index),
        'Terdeteksi parser query kustom berbasis location.search.split("&") — periksa properti objek hasil parsing jika parameter ditambahkan di skrip terpisah.',
        m[0]
      );
    }

    // Pattern C2: Regex query extractor (/[\?&]param=([^&#]*)/ or new RegExp('[?&]param=...'))
    const regexLiteralParamRe =
      /\/[^/\n]*\[[^\]]*[?&][^\]]*\]([a-zA-Z0-9_.-]+)\s*=[^/\n]*\/[gimuy]*/g;
    while ((m = regexLiteralParamRe.exec(code)) !== null) {
      const pName = m[1];
      registerParam(pName, {
        kind: 'regex-parser',
        label: `Regex /...${pName}=/`,
        line: localLineAt(m.index),
        context: contextTitle,
        snippet: m[0],
      });
    }
    const newRegExpParamRe =
      /new\s+RegExp\s*\(\s*(['"`])[^'"`\n]*\[[^\]]*[?&][^\]]*\]([a-zA-Z0-9_.-]+)=[^'"`\n]*\1/gi;
    while ((m = newRegExpParamRe.exec(code)) !== null) {
      const pName = m[2];
      registerParam(pName, {
        kind: 'regex-parser',
        label: `new RegExp('[?&]${pName}=...')`,
        line: localLineAt(m.index),
        context: contextTitle,
        snippet: m[0],
      });
    }

    // Pattern C3: Custom query helper function calls (detected helpers OR common names like getQueryParam/getUrlParameter/getParam)
    const knownHelperNames = new Set<string>([
      ...Array.from(customHelpers.keys()),
      'getUrlParameter',
      'getQueryParam',
      'getQueryVariable',
      'getParameterByName',
      'getParam',
    ]);
    if (knownHelperNames.size > 0) {
      const hPattern = Array.from(knownHelperNames)
        .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
      const helperCallRe = new RegExp(
        `(?:\\b(?:const|let|var)\\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*=\\s*)?\\b(${hPattern})\\s*\\(\\s*(['"\`])([^'"\`\\n]+)\\3`,
        'g'
      );
      while ((m = helperCallRe.exec(code)) !== null) {
        const assignedVar = m[1];
        const fnName = m[2];
        const paramName = m[4].trim();
        const ext = assignedVar
          ? extractValuesForJsVariable(code, assignedVar)
          : extractInlineExprValues(code, paramName);
        registerParam(
          paramName,
          {
            kind: 'custom-helper',
            label: `${fnName}('${paramName}')`,
            line: localLineAt(m.index),
            context: contextTitle,
            snippet: m[0],
          },
          {
            values: ext.values,
            defaultValue: ext.defaultValue,
          }
        );
      }
    }

    // Pattern E (JS side): Query string literals inside JS like '/search?sort=newest&cat=tech'
    const jsQueryLitRe = /(['"`])([^'"`\n]*\?[a-zA-Z0-9_.-]+=[^'"`\n]+)\1/g;
    while ((m = jsQueryLitRe.exec(code)) !== null) {
      const lit = m[2];
      const qIdx = lit.indexOf('?');
      if (qIdx < 0) continue;
      const baseP = lit.slice(0, qIdx).replace(/(?:&quot;|&apos;|['"\s+])+$/gi, '');
      if (baseP && !baseP.startsWith('(')) basePathSet.add(baseP);
      const qPart = lit.slice(qIdx).split(/#|&quot;|&apos;/i)[0].trim();
      const parsed = parseQueryParamsFromRawQuery(qPart);
      for (const pair of parsed) {
        registerParam(
          pair.key,
          {
            kind: 'link-query',
            label: `String JS (${lit.slice(0, 60)})`,
            line: localLineAt(m.index),
            context: contextTitle,
            snippet: lit.slice(0, 120),
          },
          {
            values: pair.value && !pair.isDynamicPlaceholder ? [pair.value] : [],
          }
        );
      }
    }
  };

  // 1. Scan all <script> blocks (excluding external src-only and JSON-LD)
  const scriptBlockRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = scriptBlockRe.exec(xml)) !== null) {
    const attrs = sm[1];
    const body = sm[2];
    if (!body || !body.trim()) continue;
    const typeAttr = getAttrValue(attrs, 'type').toLowerCase();
    if (typeAttr.includes('ld+json') || typeAttr === 'application/json') continue;
    const bodyStart = sm.index + sm[0].indexOf('>') + 1;
    scanJsSnippetBody(body, bodyStart, `<script> (baris ${lineAt(sm.index)})`);
  }

  // 2. Scan inline JS event handlers (onclick, onchange, onload, etc.)
  const inlineEvRe = /\b(on[a-z]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  while ((sm = inlineEvRe.exec(xml)) !== null) {
    const handlerBody = sm[2] ?? sm[3] ?? '';
    if (!/URLSearchParams|location\.search|new\s+URL|getParam|getQuery|\?/i.test(handlerBody)) continue;
    scanJsSnippetBody(handlerBody, sm.index, `Event handler ${sm[1]} (baris ${lineAt(sm.index)})`);
  }

  // 3. Scan <form> GET elements (<form method="get"> or default form without POST)
  const formRe = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  while ((sm = formRe.exec(xml)) !== null) {
    const attrs = sm[1];
    const body = sm[2];
    const method = (getAttrValue(attrs, 'method') || 'get').toLowerCase();
    if (method === 'post') continue;
    const action = getAttrValue(attrs, 'action') || getAttrValue(attrs, 'expr:action') || '/';
    if (action) basePathSet.add(action);

    // Collect <input name="..."> and <textarea name="...">
    const fieldRe = /<(?:input|textarea)\b([^>]*?)>/gi;
    let fm: RegExpExecArray | null;
    while ((fm = fieldRe.exec(body)) !== null) {
      const fAttrs = fm[1];
      const nameAttr = getAttrValue(fAttrs, 'name');
      if (!nameAttr) continue;
      const valAttr = getAttrValue(fAttrs, 'value');
      const placeholderAttr = getAttrValue(fAttrs, 'placeholder');
      const candidateVals = valAttr
        ? [valAttr]
        : placeholderAttr && placeholderAttr.length < 30
          ? []
          : [];
      registerParam(
        nameAttr,
        {
          kind: 'form-get',
          label: `Form GET <input name="${nameAttr}"> (action: ${action})`,
          line: lineAt(sm.index + fm.index),
          context: `<form method="${method.toUpperCase()}">`,
          snippet: fm[0].slice(0, 120),
        },
        {
          values: candidateVals,
          defaultValue: valAttr || '',
        }
      );
    }

    // Collect <select name="..."><option value="...">
    const selectRe = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi;
    while ((fm = selectRe.exec(body)) !== null) {
      const selectName = getAttrValue(fm[1], 'name');
      if (!selectName) continue;
      const optVals: string[] = [];
      const optRe = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
      let om: RegExpExecArray | null;
      while ((om = optRe.exec(fm[2])) !== null) {
        const optVal = getAttrValue(om[1], 'value') || om[2].replace(/<[^>]+>/g, '').trim();
        if (optVal) optVals.push(optVal);
      }
      registerParam(
        selectName,
        {
          kind: 'form-get',
          label: `Form GET <select name="${selectName}">`,
          line: lineAt(sm.index + fm.index),
          context: `<form method="${method.toUpperCase()}">`,
          snippet: `<select name="${selectName}"> (${optVals.length} opsi)`,
        },
        {
          values: optVals,
          defaultValue: optVals[0] || '',
        }
      );
    }
  }

  // 4. Scan XML link / src / expr attributes containing ?param=value
  const attrQueryScanRe =
    /\b((?:expr:)?(?:href|src|action|data-src|data-url|content))\s*=\s*(?:"([^"]*\?[^"]*)"|'([^']*\?[^']*)')/gi;
  while ((sm = attrQueryScanRe.exec(xml)) !== null) {
    const attrName = sm[1];
    const attrVal = (sm[2] ?? sm[3] ?? '').trim();
    const qIdx = attrVal.indexOf('?');
    if (qIdx < 0) continue;
    const basePart = attrVal.slice(0, qIdx).replace(/(?:&quot;|&apos;|['"\s+])+$/gi, '');
    if (basePart && !basePart.startsWith('data:') && !basePart.includes('<')) {
      basePathSet.add(basePart);
    }
    const queryPart = attrVal.slice(qIdx).split(/['"#]|&quot;|&apos;/i)[0].trim();
    if (!queryPart.includes('=')) continue;
    const parsedPairs = parseQueryParamsFromRawQuery(queryPart);
    for (const pair of parsedPairs) {
      registerParam(
        pair.key,
        {
          kind: 'link-query',
          label: `Atribut ${attrName} (${queryPart.slice(0, 60)})`,
          line: lineAt(sm.index),
          context: `Atribut <... ${attrName}=...>`,
          snippet: `${attrName}="${attrVal.slice(0, 100)}"`,
        },
        {
          values: pair.value && !pair.isDynamicPlaceholder ? [pair.value] : [],
        }
      );
    }
  }

  // 5. Scan Blogger template expressions referencing search query or url params
  const tplSearchRe = /\bdata:(?:blog\.searchQuery|view\.search\.query)\b/gi;
  while ((sm = tplSearchRe.exec(xml)) !== null) {
    registerParam('q', {
      kind: 'template-expr',
      label: `Tag Template (${sm[0]})`,
      line: lineAt(sm.index),
      context: `Logika Template XML (baris ${lineAt(sm.index)})`,
      snippet: sm[0],
    });
  }

  const tplParamsRe = /\bdata:view\.url\.params\.([a-zA-Z0-9_.-]+)\b/gi;
  while ((sm = tplParamsRe.exec(xml)) !== null) {
    registerParam(sm[1], {
      kind: 'template-expr',
      label: `Tag Template (${sm[0]})`,
      line: lineAt(sm.index),
      context: `Logika Template XML (baris ${lineAt(sm.index)})`,
      snippet: sm[0],
    });
  }

  // Build final sorted array of detected parameters
  const parameters: DetectedQueryParameter[] = Array.from(paramMap.values())
    .sort((a, b) => a.sources[0].line - b.sources[0].line)
    .map((entry, idx) => {
      const suggestedValue =
        entry.defaultValue ||
        entry.candidateValues[0] ||
        (entry.isBooleanFlag ? '1' : 'contoh');
      const testQueryExample = `?${encodeURIComponent(entry.name)}=${encodeURIComponent(suggestedValue)}`;
      const consoleSnippet = [
        `// Uji parameter "${entry.name}" (${entry.sources[0]?.label || 'Query XML'})`,
        `const testParams = new URLSearchParams('${testQueryExample}');`,
        `console.log('${entry.name} =', testParams.get('${entry.name}'));`,
      ].join('\n');

      return {
        id: `dyn-qp-${idx + 1}-${entry.name}`,
        name: entry.name,
        candidateValues: entry.candidateValues,
        defaultValue: entry.defaultValue,
        suggestedValue,
        isBooleanFlag: entry.isBooleanFlag,
        sources: entry.sources,
        primarySourceLabel: SOURCE_KIND_LABELS[entry.sources[0].kind],
        primaryLine: entry.sources[0].line,
        testQueryExample,
        consoleSnippet,
      };
    });

  const fullPairs = parameters.map((p) => ({
    key: p.name,
    value: p.suggestedValue,
    enabled: true,
  }));
  const { rawQuery: fullExampleQueryString } = buildQueryStringFromPairs(fullPairs);

  return {
    xmlEmpty: false,
    parameters,
    manualCheckNotices: manualNotices,
    detectedBasePaths: Array.from(basePathSet).slice(0, 12),
    fullExampleQueryString,
  };
}



