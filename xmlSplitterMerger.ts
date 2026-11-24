import {
  validateBloggerXmlOffline,
  type XmlValidationResult,
} from './xmlOfflineTools';

export type XmlSplitMode = 'blogger-structure' | 'lines' | 'size-kb' | 'parts-count';

export type XmlSplitPartCategory =
  | 'head-skin'
  | 'section'
  | 'script-footer'
  | 'shell'
  | 'chunk';

export interface XmlSplitPart {
  id: string;
  index: number;
  total: number;
  filename: string;
  title: string;
  category: XmlSplitPartCategory;
  byteSize: number;
  lineCount: number;
  content: string;
  note: string;
}

export interface XmlSplitResult {
  mode: XmlSplitMode;
  sourceName: string;
  totalBytes: number;
  totalLines: number;
  losslessRoundTrip: boolean;
  parts: XmlSplitPart[];
  manifestJson: string;
  warnings: string[];
}

export type XmlMergeMode = 'sequential' | 'smart-blogger';

export interface XmlMergeInputPart {
  id: string;
  name: string;
  content: string;
  enabled: boolean;
}

export interface XmlMergeResult {
  mode: XmlMergeMode;
  mergedXml: string;
  byteSize: number;
  lineCount: number;
  sourcePartsCount: number;
  validation: XmlValidationResult;
  warnings: string[];
  summary: string[];
}

const textEncoder = new TextEncoder();

export function getUtf8Bytes(text: string): number {
  return textEncoder.encode(text).byteLength;
}

export function countLines(text: string): number {
  if (!text) return 0;
  let count = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) count++;
  }
  return count;
}

function sanitizeFilenameSlug(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/\.xml$/i, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'template-blogger';
}

function padIndex(idx: number, total: number): string {
  const digits = Math.max(2, String(total).length);
  return String(idx).padStart(digits, '0');
}

interface RangeSlice {
  start: number;
  end: number;
  title: string;
  slug: string;
  category: XmlSplitPartCategory;
  note: string;
}

/**
 * Find ranges occupied by <!-- comments --> and <![CDATA[...]]> so tag matching never gets fooled.
 */
function findIgnoredRanges(xml: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let i = 0;
  const len = xml.length;
  while (i < len) {
    if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i + 4);
      const closeIdx = end === -1 ? len : end + 3;
      ranges.push([i, closeIdx]);
      i = closeIdx;
      continue;
    }
    if (xml.startsWith('<![CDATA[', i)) {
      const end = xml.indexOf(']]>', i + 9);
      const closeIdx = end === -1 ? len : end + 3;
      ranges.push([i, closeIdx]);
      i = closeIdx;
      continue;
    }
    i++;
  }
  return ranges;
}

function isInsideIgnored(pos: number, ignored: Array<[number, number]>): boolean {
  for (let i = 0; i < ignored.length; i++) {
    const [s, e] = ignored[i];
    if (pos >= s && pos < e) return true;
    if (s > pos) break;
  }
  return false;
}

function findNextIgnoredAwareRegex(
  xml: string,
  regex: RegExp,
  fromIndex: number,
  ignored: Array<[number, number]>
): RegExpExecArray | null {
  const clone = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
  clone.lastIndex = fromIndex;
  let m: RegExpExecArray | null;
  while ((m = clone.exec(xml)) !== null) {
    if (!isInsideIgnored(m.index, ignored)) {
      return m;
    }
  }
  return null;
}

/**
 * Find balanced <tag ...>...</tag> (supporting self-closing <tag .../>) ignoring comments & CDATA.
 */
function findTopLevelTagBlocks(
  xml: string,
  tagName: string,
  searchStart: number,
  searchEnd: number,
  ignored: Array<[number, number]>
): Array<{ start: number; end: number; attrs: string; id: string }> {
  const results: Array<{ start: number; end: number; attrs: string; id: string }> = [];
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tagRe = new RegExp(`<(\\/?)${escaped}(\\b[^>]*)?>`, 'gi');
  tagRe.lastIndex = searchStart;

  let depth = 0;
  let blockStart = -1;
  let blockAttrs = '';

  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(xml)) !== null) {
    if (m.index >= searchEnd) break;
    if (isInsideIgnored(m.index, ignored)) continue;

    const isClosing = m[1] === '/';
    const rawMatch = m[0];
    const attrs = (m[2] || '').trim();
    const isSelfClosing = !isClosing && /\/\s*>$/.test(rawMatch);

    if (!isClosing) {
      if (depth === 0) {
        blockStart = m.index;
        blockAttrs = attrs;
      }
      if (isSelfClosing) {
        if (depth === 0) {
          const idMatch = /\bid\s*=\s*["']([^"']+)["']/i.exec(blockAttrs);
          results.push({
            start: blockStart,
            end: m.index + rawMatch.length,
            attrs: blockAttrs,
            id: idMatch?.[1] || `block-${results.length + 1}`,
          });
          blockStart = -1;
          blockAttrs = '';
        }
      } else {
        depth++;
      }
    } else if (depth > 0) {
      depth--;
      if (depth === 0 && blockStart >= 0) {
        const idMatch = /\bid\s*=\s*["']([^"']+)["']/i.exec(blockAttrs);
        results.push({
          start: blockStart,
          end: m.index + rawMatch.length,
          attrs: blockAttrs,
          id: idMatch?.[1] || `block-${results.length + 1}`,
        });
        blockStart = -1;
        blockAttrs = '';
      }
    }
  }

  return results;
}

function buildPartsFromSlices(
  xml: string,
  slices: RangeSlice[],
  mode: XmlSplitMode,
  sourceName: string,
  warnings: string[]
): XmlSplitResult {
  const nonEmpty = slices.filter((s) => s.end > s.start);
  const total = nonEmpty.length;
  const baseSlug = sanitizeFilenameSlug(sourceName);

  const parts: XmlSplitPart[] = nonEmpty.map((s, idx) => {
    const content = xml.slice(s.start, s.end);
    const num = padIndex(idx + 1, total);
    return {
      id: `split-part-${idx + 1}-${s.slug}`,
      index: idx + 1,
      total,
      filename: `${baseSlug}-${num}-${s.slug}.xml`,
      title: s.title,
      category: s.category,
      byteSize: getUtf8Bytes(content),
      lineCount: countLines(content),
      content,
      note: s.note,
    };
  });

  const reconstructed = parts.map((p) => p.content).join('');
  const losslessRoundTrip = reconstructed === xml;

  const manifest = {
    generator: 'TemaLoka XML Splitter & Merger',
    mode,
    sourceName,
    totalBytes: getUtf8Bytes(xml),
    totalLines: countLines(xml),
    losslessRoundTrip,
    createdAt: new Date().toISOString(),
    parts: parts.map((p) => ({
      index: p.index,
      filename: p.filename,
      title: p.title,
      category: p.category,
      byteSize: p.byteSize,
      lineCount: p.lineCount,
    })),
  };

  return {
    mode,
    sourceName,
    totalBytes: getUtf8Bytes(xml),
    totalLines: countLines(xml),
    losslessRoundTrip,
    parts,
    manifestJson: JSON.stringify(manifest, null, 2),
    warnings,
  };
}

/**
 * Losslessly split a Blogger/Blogspot XML (or general XML) by semantic structure:
 * - Head & <b:skin>
 * - Top-level <b:section> blocks (each section its own part)
 * - Body wrappers, scripts, and closing tags
 */
export function splitXmlByBloggerStructure(
  xml: string,
  sourceName = 'template-blogger.xml'
): XmlSplitResult {
  const warnings: string[] = [];
  if (!xml.trim()) {
    return buildPartsFromSlices(xml, [], 'blogger-structure', sourceName, [
      'Kode XML kosong — muat template atau unggah file .xml terlebih dahulu.',
    ]);
  }

  const ignored = findIgnoredRanges(xml);
  const headCloseMatch = findNextIgnoredAwareRegex(xml, /<\/head\s*>/i, 0, ignored);
  const bodyOpenMatch = findNextIgnoredAwareRegex(xml, /<body\b[^>]*>/i, 0, ignored);
  const bodyCloseMatch = findNextIgnoredAwareRegex(
    xml,
    /<\/body\s*>/i,
    bodyOpenMatch ? bodyOpenMatch.index : 0,
    ignored
  );

  const slices: RangeSlice[] = [];
  let cursor = 0;

  // 1. Head + Skin + Variables block
  const headBoundary = headCloseMatch
    ? headCloseMatch.index + headCloseMatch[0].length
    : bodyOpenMatch
      ? bodyOpenMatch.index
      : 0;

  if (headBoundary > 0) {
    slices.push({
      start: 0,
      end: headBoundary,
      title: 'Head, Meta & <b:skin> CSS',
      slug: 'head-dan-skin',
      category: 'head-skin',
      note: 'Deklarasi XML, <head>, meta SEO, variabel tema, dan blok <b:skin>.',
    });
    cursor = headBoundary;
  }

  // 2. Scan <b:section> blocks inside body (or full doc after head)
  const scanStart = cursor;
  const scanEnd = bodyCloseMatch ? bodyCloseMatch.index : xml.length;
  const sections = findTopLevelTagBlocks(xml, 'b:section', scanStart, scanEnd, ignored);

  if (sections.length === 0) {
    // Fallback for generic XML without <b:section>: split root children or 2-3 semantic halves
    warnings.push(
      'Tidak ditemukan tag <b:section> Blogger. XML dipecah berdasarkan blok struktur utama (<head>/<body>/skrip).'
    );
    const scriptBlocks = findTopLevelTagBlocks(xml, 'script', cursor, xml.length, ignored);
    if (scriptBlocks.length > 0 && scriptBlocks[0].start > cursor) {
      slices.push({
        start: cursor,
        end: scriptBlocks[0].start,
        title: 'Isi Utama & Markup XML',
        slug: 'isi-utama-markup',
        category: 'shell',
        note: 'Konten utama di luar <head> dan blok <script> akhir.',
      });
      cursor = scriptBlocks[0].start;
    }
    if (cursor < xml.length) {
      slices.push({
        start: cursor,
        end: xml.length,
        title: scriptBlocks.length > 0 ? 'Blok Script & Penutup Dokumen' : 'Isi Dokumen XML',
        slug: scriptBlocks.length > 0 ? 'script-dan-penutup' : 'isi-dokumen',
        category: scriptBlocks.length > 0 ? 'script-footer' : 'shell',
        note: 'Bagian lanjutan dan tag penutup dokumen XML.',
      });
    }
    return buildPartsFromSlices(xml, slices, 'blogger-structure', sourceName, warnings);
  }

  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    if (sec.start > cursor) {
      const gapText = xml.slice(cursor, sec.start);
      const isWhitespaceOnly = gapText.trim().length === 0;
      if (isWhitespaceOnly && slices.length > 0) {
        // Attach trailing whitespace cleanly to previous slice to avoid noisy empty chunks
        slices[slices.length - 1].end = sec.start;
      } else {
        const hasScript = /<script\b/i.test(gapText);
        slices.push({
          start: cursor,
          end: sec.start,
          title:
            i === 0
              ? 'Pembuka <body> & Wrapper Layout'
              : hasScript
                ? `Markup & Script Sebelum Section #${sec.id}`
                : `Pembungkus HTML Antar Section`,
          slug: i === 0 ? 'pembuka-body' : `wrapper-${i}`,
          category: hasScript ? 'script-footer' : 'shell',
          note:
            i === 0
              ? 'Tag pembuka <body>, kontainer layout, dan elemen sebelum section pertama.'
              : 'Elemen pembuka/penutup HTML atau skrip di antara blok <b:section>.',
        });
      }
    }

    const widgetCount = (xml.slice(sec.start, sec.end).match(/<b:widget\b/gi) || []).length;
    slices.push({
      start: sec.start,
      end: sec.end,
      title: `Section "${sec.id}" (${widgetCount} widget)`,
      slug: `section-${sanitizeFilenameSlug(sec.id)}`,
      category: 'section',
      note: `Blok lengkap <b:section id='${sec.id}'> beserta ${widgetCount} widget dan includable di dalamnya.`,
    });
    cursor = sec.end;
  }

  // 3. Remaining footer, scripts & closing </body></html>
  if (cursor < xml.length) {
    const tailText = xml.slice(cursor);
    const hasScripts = /<script\b/i.test(tailText);
    slices.push({
      start: cursor,
      end: xml.length,
      title: hasScripts ? 'Script Bawah & Penutup </body></html>' : 'Footer & Penutup </body></html>',
      slug: 'script-dan-penutup',
      category: 'script-footer',
      note: 'Penutup wrapper, skrip JavaScript akhir halaman, serta </body></html>.',
    });
  }

  return buildPartsFromSlices(xml, slices, 'blogger-structure', sourceName, warnings);
}

/**
 * Losslessly split any XML file into chunks by max lines, max KB size, or fixed parts count.
 * Preserves exact line breaks so concatenating all parts yields the exact original string.
 */
export function splitXmlByChunks(
  xml: string,
  options: {
    mode: 'lines' | 'size-kb' | 'parts-count';
    maxLines?: number;
    maxKb?: number;
    partsCount?: number;
  },
  sourceName = 'template-blogger.xml'
): XmlSplitResult {
  const warnings: string[] = [];
  if (!xml.trim()) {
    return buildPartsFromSlices(xml, [], options.mode, sourceName, [
      'Kode XML kosong — muat template atau unggah file .xml terlebih dahulu.',
    ]);
  }

  // Build line index table preserving exact CRLF/LF delimiters
  const linesWithBreak: Array<{ start: number; end: number; bytes: number }> = [];
  let lineStart = 0;
  for (let i = 0; i < xml.length; i++) {
    if (xml.charCodeAt(i) === 10) {
      const slice = xml.slice(lineStart, i + 1);
      linesWithBreak.push({
        start: lineStart,
        end: i + 1,
        bytes: getUtf8Bytes(slice),
      });
      lineStart = i + 1;
    }
  }
  if (lineStart < xml.length) {
    linesWithBreak.push({
      start: lineStart,
      end: xml.length,
      bytes: getUtf8Bytes(xml.slice(lineStart)),
    });
  }

  const slices: RangeSlice[] = [];

  if (options.mode === 'lines') {
    const step = Math.max(20, Math.min(50000, Math.round(options.maxLines || 400)));
    for (let i = 0; i < linesWithBreak.length; i += step) {
      const chunkEndIdx = Math.min(linesWithBreak.length - 1, i + step - 1);
      const start = linesWithBreak[i].start;
      const end = linesWithBreak[chunkEndIdx].end;
      const partNo = slices.length + 1;
      slices.push({
        start,
        end,
        title: `Bagian #${partNo} (Baris ${i + 1}–${chunkEndIdx + 1})`,
        slug: `part-${padIndex(partNo, Math.ceil(linesWithBreak.length / step))}`,
        category: 'chunk',
        note: `Potongan baris ${i + 1} s.d. ${chunkEndIdx + 1} (${chunkEndIdx - i + 1} baris).`,
      });
    }
  } else if (options.mode === 'size-kb') {
    const maxBytes = Math.max(4, Math.min(10240, Number(options.maxKb || 50))) * 1024;
    let curStart = 0;
    let curBytes = 0;
    let firstLineIdx = 0;

    for (let i = 0; i < linesWithBreak.length; i++) {
      const line = linesWithBreak[i];
      if (curBytes > 0 && curBytes + line.bytes > maxBytes) {
        const partNo = slices.length + 1;
        slices.push({
          start: curStart,
          end: line.start,
          title: `Bagian #${partNo} (Baris ${firstLineIdx + 1}–${i})`,
          slug: `part-${String(partNo).padStart(2, '0')}`,
          category: 'chunk',
          note: `Ukuran ~${(curBytes / 1024).toFixed(1)} KB (maks ${(maxBytes / 1024).toFixed(0)} KB).`,
        });
        curStart = line.start;
        curBytes = line.bytes;
        firstLineIdx = i;
      } else {
        curBytes += line.bytes;
      }
    }
    if (curStart < xml.length) {
      const partNo = slices.length + 1;
      slices.push({
        start: curStart,
        end: xml.length,
        title: `Bagian #${partNo} (Baris ${firstLineIdx + 1}–${linesWithBreak.length})`,
        slug: `part-${String(partNo).padStart(2, '0')}`,
        category: 'chunk',
        note: `Ukuran ~${(curBytes / 1024).toFixed(1)} KB (bagian penutup).`,
      });
    }
  } else {
    // parts-count
    const desired = Math.max(2, Math.min(40, Math.round(options.partsCount || 4)));
    const actualParts = Math.min(desired, Math.max(1, linesWithBreak.length));
    if (actualParts < desired) {
      warnings.push(
        `Jumlah baris XML (${linesWithBreak.length}) lebih sedikit dari target ${desired} bagian; dibuat ${actualParts} bagian.`
      );
    }
    const perPart = Math.ceil(linesWithBreak.length / actualParts);
    for (let p = 0; p < actualParts; p++) {
      const startLine = p * perPart;
      if (startLine >= linesWithBreak.length) break;
      const endLine = Math.min(linesWithBreak.length - 1, (p + 1) * perPart - 1);
      slices.push({
        start: linesWithBreak[startLine].start,
        end: linesWithBreak[endLine].end,
        title: `Bagian #${p + 1} dari ${actualParts}`,
        slug: `part-${padIndex(p + 1, actualParts)}-dari-${actualParts}`,
        category: 'chunk',
        note: `Baris ${startLine + 1}–${endLine + 1}.`,
      });
    }
  }

  return buildPartsFromSlices(xml, slices, options.mode, sourceName, warnings);
}

function extractCssInsideSkinOrStyle(fragment: string): string {
  const skinMatch = /<b:skin[^>]*>([\s\S]*?)<\/b:skin>/i.exec(fragment);
  if (skinMatch) {
    return skinMatch[1]
      .replace(/<!\[CDATA\[/g, '')
      .replace(/\]\]>/g, '')
      .replace(/<Variable\b[^>]*\/?>[\s\S]*?(?:<\/Variable>)?/gi, '')
      .trim();
  }
  const styles: string[] = [];
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let m: RegExpExecArray | null;
  while ((m = styleRe.exec(fragment)) !== null) {
    const inner = m[1].replace(/\/\*<!\[CDATA\[\*\/|\/\*\]\]>\*\//g, '').trim();
    if (inner) styles.push(inner);
  }
  return styles.join('\n\n');
}

function extractExtraHeadTags(headInner: string): string[] {
  const lines: string[] = [];
  const metaLinkRe = /<(?:meta|link)\b[^>]*?(?:\/>|>)/gi;
  let m: RegExpExecArray | null;
  while ((m = metaLinkRe.exec(headInner)) !== null) {
    const tag = m[0].trim();
    if (!/charset|viewport/i.test(tag)) {
      lines.push(tag);
    }
  }
  return lines;
}

function stripOuterXmlShell(fragment: string): string {
  return fragment
    .replace(/^\uFEFF/, '')
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE\b[^>]*>/gi, '')
    .replace(/<\/?html\b[^>]*>/gi, '')
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<\/?body\b[^>]*>/gi, '')
    .trim();
}

const DEFAULT_BLOGGER_SHELL = `<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE html>
<html b:css='false' b:defaultwidgetversion='2' b:layoutsVersion='3' xmlns='http://www.w3.org/1999/xhtml' xmlns:b='http://www.google.com/2005/gml/b' xmlns:data='http://www.google.com/2005/gml/data' xmlns:expr='http://www.google.com/2005/gml/expr'>
<head>
  <meta content='width=device-width, initial-scale=1' name='viewport'/>
  <title><data:blog.pageTitle/></title>
  <b:skin><![CDATA[
    <Variable name="body.background" description="Background" type="color" default="#ffffff" value="#ffffff"/>
    <Variable name="body.text.color" description="Text Color" type="color" default="#1e293b" value="#1e293b"/>
    <Variable name="keycolor" description="Accent Color" type="color" default="#2563eb" value="#2563eb"/>
  ]]></b:skin>
</head>
<body>
</body>
</html>`;

/**
 * Merge multiple XML files/fragments back into one XML document.
 * - `sequential`: Lossless ordered concatenation (ideal for reassembling split parts).
 * - `smart-blogger`: Intelligently combines separate Blogger XML parts (head/skin, sections, widgets, CSS, scripts)
 *   into a single valid Blogger XML document without duplicate <html>/<head> wrappers.
 */
export function mergeXmlParts(
  parts: XmlMergeInputPart[],
  options: {
    mode: XmlMergeMode;
    autoSortByName?: boolean;
    insertNewlineBetweenStandaloneParts?: boolean;
  }
): XmlMergeResult {
  const warnings: string[] = [];
  const summary: string[] = [];

  const active = parts.filter((p) => p.enabled && p.content.length > 0);
  if (active.length === 0) {
    return {
      mode: options.mode,
      mergedXml: '',
      byteSize: 0,
      lineCount: 0,
      sourcePartsCount: 0,
      validation: { isValid: false, issues: [] },
      warnings: ['Belum ada bagian XML aktif untuk digabungkan.'],
      summary: [],
    };
  }

  const ordered = options.autoSortByName
    ? [...active].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      )
    : [...active];

  if (options.mode === 'sequential') {
    const chunks: string[] = [];
    for (let i = 0; i < ordered.length; i++) {
      let piece = ordered[i].content;
      if (i > 0 && piece.startsWith('\uFEFF')) {
        piece = piece.slice(1);
      }
      if (i > 0 && options.insertNewlineBetweenStandaloneParts) {
        const prev = chunks[chunks.length - 1] || '';
        const prevEndsNewline = prev.endsWith('\n') || prev.endsWith('\r');
        const curStartsNewline = piece.startsWith('\n') || piece.startsWith('\r');
        const prevEndsCloseTag = />\s*$/.test(prev);
        const curStartsOpenTag = /^\s*</.test(piece);
        if (!prevEndsNewline && !curStartsNewline && prevEndsCloseTag && curStartsOpenTag) {
          chunks.push('\n');
        }
      }
      chunks.push(piece);
    }

    const mergedXml = chunks.join('');
    const validation = validateBloggerXmlOffline(mergedXml);
    summary.push(
      `Digabung berurutan dari ${ordered.length} bagian (${(getUtf8Bytes(mergedXml) / 1024).toFixed(1)} KB).`
    );
    if (validation.isValid) {
      summary.push('Validasi XML: Lolos tanpa error sintaks kritis.');
    } else {
      warnings.push(
        `Hasil gabungan memiliki ${validation.issues.length} catatan/error sintaks XML — periksa urutan bagian atau jalankan Auto-Fix.`
      );
    }

    return {
      mode: 'sequential',
      mergedXml,
      byteSize: getUtf8Bytes(mergedXml),
      lineCount: countLines(mergedXml),
      sourcePartsCount: ordered.length,
      validation,
      warnings,
      summary,
    };
  }

  // Smart Blogger Merge Mode
  // Pick first part with <html or <?xml as base shell (or synthesize clean Blogger shell)
  let baseIdx = ordered.findIndex((p) => /<html\b|<!DOCTYPE|<\?xml/i.test(p.content));
  let mergedXml =
    baseIdx >= 0 ? ordered[baseIdx].content.replace(/^\uFEFF/, '') : DEFAULT_BLOGGER_SHELL;

  if (baseIdx < 0) {
    summary.push('Tidak ditemukan kerangka <html> pada potongan; membuat kerangka XML Blogger 2.0 otomatis.');
  } else {
    summary.push(`Kerangka utama diambil dari "${ordered[baseIdx].name}".`);
  }

  // Ensure base has <body>...</body> and </head> if partial
  if (!/<\/body\s*>/i.test(mergedXml)) {
    if (/<\/head\s*>/i.test(mergedXml) && !/<body\b/i.test(mergedXml)) {
      mergedXml = mergedXml.replace(/<\/head\s*>/i, '</head>\n<body>\n</body>');
    } else if (/<\/html\s*>/i.test(mergedXml)) {
      mergedXml = mergedXml.replace(/<\/html\s*>/i, '</body>\n</html>');
    } else {
      mergedXml = `${mergedXml}\n<body>\n</body>\n</html>`;
    }
  }
  if (!/<\/html\s*>/i.test(mergedXml)) {
    mergedXml = `${mergedXml}\n</html>`;
  }

  const seenSectionIds = new Set<string>();
  const existingSecRe = /<b:section\b[^>]*\bid\s*=\s*["']([^"']+)["']/gi;
  let exM: RegExpExecArray | null;
  while ((exM = existingSecRe.exec(mergedXml)) !== null) {
    seenSectionIds.add(exM[1]);
  }

  const extraHeadTags: string[] = [];
  const extraSkinCss: string[] = [];
  const extraVariables: string[] = [];
  const extraBodyFragments: string[] = [];

  for (let i = 0; i < ordered.length; i++) {
    if (i === baseIdx) continue;
    const part = ordered[i];
    const content = part.content.replace(/^\uFEFF/, '').trim();
    if (!content) continue;

    // 1) Pure CSS snippet (no XML tags)
    if (!/<[a-zA-Z!?]/.test(content)) {
      extraSkinCss.push(`/* Digabung dari: ${part.name} */\n${content}`);
      continue;
    }

    // 2) Extract head extras, <Variable>, & <b:skin>/<style> CSS
    const headMatch = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(content);
    if (headMatch) {
      extraHeadTags.push(...extractExtraHeadTags(headMatch[1]));
    }
    const varRe = /<Variable\b[^>]*?(?:\/>|>[\s\S]*?<\/Variable>)/gi;
    let vm: RegExpExecArray | null;
    while ((vm = varRe.exec(content)) !== null) {
      extraVariables.push(vm[0]);
    }
    const cssFromPart = extractCssInsideSkinOrStyle(content);
    if (cssFromPart) {
      extraSkinCss.push(`/* CSS dari: ${part.name} */\n${cssFromPart}`);
    }

    // 3) Extract body / section / script / markup content
    let bodyContent = '';
    const bodyInner = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(content);
    if (bodyInner) {
      bodyContent = bodyInner[1].trim();
    } else {
      bodyContent = stripOuterXmlShell(content)
        .replace(/<b:skin\b[^>]*>[\s\S]*?<\/b:skin>/gi, '')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
        .trim();
    }

    if (bodyContent) {
      // Check section ID collisions
      const secIdRe = /<b:section\b[^>]*\bid\s*=\s*["']([^"']+)["']/gi;
      let sm: RegExpExecArray | null;
      while ((sm = secIdRe.exec(bodyContent)) !== null) {
        if (seenSectionIds.has(sm[1])) {
          warnings.push(
            `ID section "${sm[1]}" pada "${part.name}" sudah ada di kerangka utama (Blogger mewajibkan ID section unik).`
          );
        } else {
          seenSectionIds.add(sm[1]);
        }
      }
      extraBodyFragments.push(`<!-- Bagian: ${part.name} -->\n${bodyContent}`);
    }
  }

  // Inject extra head meta/links before </head>
  if (extraHeadTags.length > 0 && /<\/head\s*>/i.test(mergedXml)) {
    const dedupedHeadTags = Array.from(new Set(extraHeadTags));
    mergedXml = mergedXml.replace(
      /<\/head\s*>/i,
      `  ${dedupedHeadTags.join('\n  ')}\n</head>`
    );
    summary.push(`${dedupedHeadTags.length} tag <meta>/<link> tambahan digabung ke <head>.`);
  }

  // Inject extra <Variable> + CSS into <b:skin> safely inside CDATA
  if (extraVariables.length > 0 || extraSkinCss.length > 0) {
    const skinRegex = /(<b:skin\b[^>]*>)([\s\S]*?)(<\/b:skin>)/i;
    const safeCssChunk = extraSkinCss.join('\n\n').replace(/\]\]>/g, ']]&gt;');
    const existingVarNames = new Set<string>();
    const existingVarRe = /<Variable\b[^>]*\bname\s*=\s*["']([^"']+)["']/gi;
    let evm: RegExpExecArray | null;
    while ((evm = existingVarRe.exec(mergedXml)) !== null) {
      existingVarNames.add(evm[1]);
    }
    const newVars = extraVariables.filter((vTag) => {
      const nm = /\bname\s*=\s*["']([^"']+)["']/i.exec(vTag)?.[1];
      if (!nm || existingVarNames.has(nm)) return false;
      existingVarNames.add(nm);
      return true;
    });

    if (skinRegex.test(mergedXml)) {
      mergedXml = mergedXml.replace(skinRegex, (_all, openTag: string, inner: string, closeTag: string) => {
        const hasCdata = /<!\[CDATA\[/.test(inner);
        let updatedInner = inner;
        if (newVars.length > 0) {
          const varBlock = `\n    ${newVars.join('\n    ')}\n`;
          updatedInner = hasCdata
            ? updatedInner.replace(/<!\[CDATA\[/, `<![CDATA[${varBlock}`)
            : `${varBlock}${updatedInner}`;
        }
        if (safeCssChunk) {
          if (hasCdata) {
            updatedInner = updatedInner.replace(/\]\]>/, `\n${safeCssChunk}\n]]>`);
          } else {
            updatedInner = `<![CDATA[\n${updatedInner.trim()}\n\n${safeCssChunk}\n]]>`;
          }
        }
        return `${openTag}${updatedInner}${closeTag}`;
      });
    } else if (/<\/head\s*>/i.test(mergedXml)) {
      const skinBlock = `<b:skin><![CDATA[\n${newVars.join('\n')}\n${safeCssChunk}\n]]></b:skin>`;
      mergedXml = mergedXml.replace(/<\/head\s*>/i, `  ${skinBlock}\n</head>`);
    }
    summary.push(
      `Digabung ke <b:skin>: ${newVars.length} variabel baru & ${extraSkinCss.length} blok CSS.`
    );
  }

  // Inject extra body/section/script fragments before </body>
  if (extraBodyFragments.length > 0) {
    const bodyPayload = `\n${extraBodyFragments.join('\n\n')}\n`;
    if (/<\/body\s*>/i.test(mergedXml)) {
      mergedXml = mergedXml.replace(/<\/body\s*>/i, `${bodyPayload}</body>`);
    } else {
      mergedXml = `${mergedXml}${bodyPayload}`;
    }
    summary.push(`${extraBodyFragments.length} fragmen body / section / script digabung ke <body>.`);
  }

  const validation = validateBloggerXmlOffline(mergedXml);
  if (!validation.isValid) {
    warnings.push(
      `Validasi pasca-gabung mendeteksi ${validation.issues.length} isu XML. Gunakan Auto-Fix jika diperlukan.`
    );
  } else {
    summary.push('Validasi XML Blogger pasca-gabung: Valid tanpa error sintaks.');
  }

  return {
    mode: 'smart-blogger',
    mergedXml,
    byteSize: getUtf8Bytes(mergedXml),
    lineCount: countLines(mergedXml),
    sourcePartsCount: ordered.length,
    validation,
    warnings,
    summary,
  };
}
