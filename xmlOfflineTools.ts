export interface XmlSyntaxIssue {
  line: number;
  column?: number;
  severity: 'error' | 'warning';
  code: string;
  message: string;
  snippet?: string;
  autoFixable: boolean;
}

export interface XmlValidationResult {
  isValid: boolean;
  issues: XmlSyntaxIssue[];
}

export interface XmlAutoFixResult {
  fixedXml: string;
  fixesApplied: string[];
  validationAfter: XmlValidationResult;
}

export type CdataStyle = 'xml' | 'css-js' | 'slash';

/**
 * 100% Offline HTML / XML Escape
 */
export function escapeHtmlEntities(input: string, preserveExistingEntities = false): string {
  if (!input) return '';
  let out = input;
  if (preserveExistingEntities) {
    out = out.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;');
  } else {
    out = out.replace(/&/g, '&amp;');
  }
  return out
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 100% Offline HTML / XML Unescape
 */
export function unescapeHtmlEntities(input: string): string {
  if (!input) return '';
  const namedMap: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&#039;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
  };

  return input
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#0?39);/gi, (m) => namedMap[m.toLowerCase()] ?? m)
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : _;
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : _;
    });
}

/**
 * Wrap text with <![CDATA[ ... ]]> in selected Blogger-safe style
 */
export function wrapWithCdata(input: string, style: CdataStyle = 'xml'): string {
  const cleanInner = unwrapCdata(input).replace(/\]\]>/g, ']]&gt;');
  if (style === 'css-js') {
    return `/*<![CDATA[*/\n${cleanInner}\n/*]]>*/`;
  }
  if (style === 'slash') {
    return `//<![CDATA[\n${cleanInner}\n//]]>`;
  }
  return `<![CDATA[\n${cleanInner}\n]]>`;
}

/**
 * Strip <![CDATA[ ... ]]> markers cleanly
 */
export function unwrapCdata(input: string): string {
  if (!input) return '';
  let out = input.trim();
  out = out
    .replace(/^(?:\/\*|\/\/)?\s*<!\[CDATA\[(?:\*\/)?\r?\n?/i, '')
    .replace(/\r?\n?(?:\/\*|\/\/)?\s*\]\]>(?:\*\/)?$/i, '');
  // Also unwrap any inline occurrences if whole string wasn't bounded
  out = out
    .replace(/\/\*<!\[CDATA\[\*\//g, '')
    .replace(/\/\*\]\]>\*\//g, '')
    .replace(/\/\/<!\[CDATA\[/g, '')
    .replace(/\/\/\]\]>/g, '')
    .replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '');
  return out;
}

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const BOOLEAN_XHTML_ATTRS = [
  'async',
  'defer',
  'crossorigin',
  'nomodule',
  'disabled',
  'checked',
  'readonly',
  'required',
  'selected',
  'multiple',
  'novalidate',
  'hidden',
  'controls',
  'autoplay',
  'loop',
  'muted',
];

const BOOLEAN_XHTML_ATTR_RE = new RegExp(
  `(?:^|\\s)(${BOOLEAN_XHTML_ATTRS.join('|')})(?=\\s|$)(?!\\s*=)`,
  'gi'
);

function fixBareBooleanAttrsOutsideQuotes(attrs: string): { updatedAttrs: string; fixedCount: number } {
  let fixedCount = 0;
  let out = '';
  let i = 0;
  const len = attrs.length;
  const boolWordRe = new RegExp(`^(${BOOLEAN_XHTML_ATTRS.join('|')})(?=\\s|$)(?!\\s*=)`, 'i');

  while (i < len) {
    const ch = attrs[i];
    if (ch === '"' || ch === "'") {
      const closeQ = attrs.indexOf(ch, i + 1);
      if (closeQ === -1) {
        out += attrs.slice(i);
        break;
      }
      out += attrs.slice(i, closeQ + 1);
      i = closeQ + 1;
      continue;
    }

    if (/\s/.test(ch)) {
      let wsEnd = i;
      while (wsEnd < len && /\s/.test(attrs[wsEnd])) wsEnd++;
      out += attrs.slice(i, wsEnd);
      i = wsEnd;
      if (i < len && attrs[i] !== '"' && attrs[i] !== "'") {
        const m = boolWordRe.exec(attrs.slice(i));
        if (m) {
          const prevChar = out.length > 0 ? out[out.length - 1] : '';
          if (!prevChar || /\s/.test(prevChar)) {
            const name = m[1];
            const lower = name.toLowerCase();
            out += lower === 'crossorigin' ? `${name}='anonymous'` : `${name}='${lower}'`;
            fixedCount++;
            i += name.length;
            continue;
          }
        }
      }
      continue;
    }

    out += ch;
    i++;
  }

  return { updatedAttrs: out, fixedCount };
}

function buildLineStarts(text: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function lineAtStarts(starts: number[], index: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= index) lo = mid + 1;
    else hi = mid - 1;
  }
  return Math.max(1, lo);
}

function getLineNumberAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

const HTML_ENTITY_CODEPOINTS: Record<string, number> = {
  nbsp: 160, copy: 169, reg: 174, trade: 8482, laquo: 171, raquo: 187,
  lsaquo: 8249, rsaquo: 8250, mdash: 8212, ndash: 8211, hellip: 8230,
  lsquo: 8216, rsquo: 8217, ldquo: 8220, rdquo: 8221, sbquo: 8218, bdquo: 8222,
  bull: 8226, middot: 183, deg: 176, times: 215, divide: 247, plusmn: 177,
  frac12: 189, frac14: 188, frac34: 190, euro: 8364, pound: 163, yen: 165,
  cent: 162, sect: 167, para: 182, larr: 8592, uarr: 8593, rarr: 8594,
  darr: 8595, harr: 8596, hearts: 9829, spades: 9824, clubs: 9827, diams: 9830,
  iexcl: 161, iquest: 191, permil: 8240, dagger: 8224, Dagger: 8225,
  prime: 8242, Prime: 8243, oline: 8254, asymp: 8776, ne: 8800, le: 8804, ge: 8805,
  infin: 8734, minus: 8722, lowast: 8727, radic: 8730, prop: 8733,
  agrave: 224, aacute: 225, acirc: 226, atilde: 227, auml: 228, aring: 229, aelig: 230,
  ccedil: 231, egrave: 232, eacute: 233, ecirc: 234, euml: 235,
  igrave: 236, iacute: 237, icirc: 238, iuml: 239, ntilde: 241,
  ograve: 242, oacute: 243, ocirc: 244, otilde: 245, ouml: 246, oslash: 248,
  ugrave: 249, uacute: 250, ucirc: 251, uuml: 252, yacute: 253, yuml: 255, szlig: 223,
  Agrave: 192, Aacute: 193, Acirc: 194, Atilde: 195, Auml: 196, Aring: 197, AElig: 198,
  Ccedil: 199, Egrave: 200, Eacute: 201, Ecirc: 202, Euml: 203,
  Igrave: 204, Iacute: 205, Icirc: 206, Iuml: 207, Ntilde: 209,
  Ograve: 210, Oacute: 211, Ocirc: 212, Otilde: 213, Ouml: 214, Oslash: 216,
  Ugrave: 217, Uacute: 218, Ucirc: 219, Uuml: 220, Yacute: 221,
  ensp: 8194, emsp: 8195, thinsp: 8201, zwnj: 8204, zwj: 8205, lrm: 8206, rlm: 8207,
};

const CORE_XML_ENTITIES = new Set(['amp', 'lt', 'gt', 'quot', 'apos']);

export function isValidXmlOrHtmlEntityName(name: string): boolean {
  if (!name) return false;
  if (CORE_XML_ENTITIES.has(name)) return true;
  if (Object.prototype.hasOwnProperty.call(HTML_ENTITY_CODEPOINTS, name)) return true;
  return Object.prototype.hasOwnProperty.call(HTML_ENTITY_CODEPOINTS, name.toLowerCase());
}

/**
 * Convert common HTML named entities (outside CDATA/comments) into numeric XML character refs
 * ONLY on a temporary copy so DOMParser("text/xml") never flags &nbsp;, &copy;, &raquo;, etc.
 */
export function normalizeHtmlEntitiesForXmlParser(xml: string): string {
  const segs = segmentXml(xml);
  return segs
    .map((seg) => {
      if (seg.type !== 'code') return seg.text;
      return seg.text.replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (full, name: string) => {
        if (CORE_XML_ENTITIES.has(name)) return full;
        const cp =
          HTML_ENTITY_CODEPOINTS[name] ?? HTML_ENTITY_CODEPOINTS[name.toLowerCase()];
        return cp !== undefined ? `&#${cp};` : full;
      });
    })
    .join('');
}

interface XmlSegment {
  type: 'code' | 'cdata' | 'comment' | 'pi';
  text: string;
  start: number;
  unclosedCdata?: boolean;
}

/**
 * Deterministic single-pass XML segmenter that hides CDATA, XML comments, PIs, and DOCTYPE.
 * Even if <![CDATA[ is unclosed, the remainder is treated as CDATA (and flagged) so it never triggers cascading false-positive errors.
 */
function segmentXml(xml: string): XmlSegment[] {
  const segments: XmlSegment[] = [];
  const len = xml.length;
  let pos = 0;
  let codeStart = 0;

  while (pos < len) {
    const ltIdx = xml.indexOf('<', pos);
    if (ltIdx === -1) break;

    if (xml.startsWith('<![CDATA[', ltIdx)) {
      if (ltIdx > codeStart) {
        segments.push({ type: 'code', text: xml.slice(codeStart, ltIdx), start: codeStart });
      }
      const closeIdx = xml.indexOf(']]>', ltIdx + 9);
      if (closeIdx === -1) {
        segments.push({
          type: 'cdata',
          text: xml.slice(ltIdx),
          start: ltIdx,
          unclosedCdata: true,
        });
        codeStart = len;
        pos = len;
        break;
      }
      const end = closeIdx + 3;
      segments.push({ type: 'cdata', text: xml.slice(ltIdx, end), start: ltIdx });
      codeStart = end;
      pos = end;
      continue;
    }

    if (xml.startsWith('<!--', ltIdx)) {
      if (ltIdx > codeStart) {
        segments.push({ type: 'code', text: xml.slice(codeStart, ltIdx), start: codeStart });
      }
      const closeIdx = xml.indexOf('-->', ltIdx + 4);
      const end = closeIdx === -1 ? len : closeIdx + 3;
      segments.push({ type: 'comment', text: xml.slice(ltIdx, end), start: ltIdx });
      codeStart = end;
      pos = end;
      continue;
    }

    if (xml.startsWith('<?', ltIdx)) {
      if (ltIdx > codeStart) {
        segments.push({ type: 'code', text: xml.slice(codeStart, ltIdx), start: codeStart });
      }
      const closeIdx = xml.indexOf('?>', ltIdx + 2);
      const end = closeIdx === -1 ? len : closeIdx + 2;
      segments.push({ type: 'pi', text: xml.slice(ltIdx, end), start: ltIdx });
      codeStart = end;
      pos = end;
      continue;
    }

    if (xml.slice(ltIdx, ltIdx + 9).toUpperCase() === '<!DOCTYPE') {
      if (ltIdx > codeStart) {
        segments.push({ type: 'code', text: xml.slice(codeStart, ltIdx), start: codeStart });
      }
      let p = ltIdx + 9;
      let quote: '"' | "'" | null = null;
      let bracketDepth = 0;
      while (p < len) {
        const c = xml[p];
        if (quote) {
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'") {
          quote = c;
        } else if (c === '[') {
          bracketDepth++;
        } else if (c === ']') {
          if (bracketDepth > 0) bracketDepth--;
        } else if (c === '>' && bracketDepth === 0) {
          p++;
          break;
        }
        p++;
      }
      segments.push({ type: 'pi', text: xml.slice(ltIdx, p), start: ltIdx });
      codeStart = p;
      pos = p;
      continue;
    }

    pos = ltIdx + 1;
  }

  if (codeStart < len) {
    segments.push({ type: 'code', text: xml.slice(codeStart), start: codeStart });
  }

  return segments;
}

interface ScannedXmlTag {
  fullTag: string;
  tagName: string;
  attrs: string;
  isClosing: boolean;
  isSelfClosing: boolean;
  localStart: number;
  localEnd: number;
}

/**
 * Quote-aware tag scanner inside a non-CDATA/non-comment code segment.
 * Properly handles '>' or '<' inside '...' or "..." attribute values (e.g., cond='data:posts.size > 0' or cond='data:blog.pageType == "index"').
 */
function scanTagsQuoteAware(code: string): ScannedXmlTag[] {
  const tags: ScannedXmlTag[] = [];
  const len = code.length;
  let i = 0;

  while (i < len) {
    const lt = code.indexOf('<', i);
    if (lt === -1) break;

    let p = lt + 1;
    if (p >= len) break;

    const isClosing = code[p] === '/';
    if (isClosing) p++;

    // Must start with valid tag name character
    if (p >= len || !/[a-zA-Z_]/.test(code[p])) {
      i = lt + 1;
      continue;
    }

    const nameStart = p;
    while (p < len && /[a-zA-Z0-9:_-]/.test(code[p])) p++;
    const tagName = code.slice(nameStart, p);

    // Scan attributes respecting single & double quotes
    const attrsStart = p;
    let quote: '"' | "'" | null = null;
    let closedAt = -1;

    while (p < len) {
      const ch = code[p];
      if (quote) {
        if (ch === quote) quote = null;
        p++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        p++;
        continue;
      }
      if (ch === '>') {
        closedAt = p;
        break;
      }
      // Stray '<' outside quotes -> abort this malformed tag candidate so later valid tags still scan
      if (ch === '<') {
        break;
      }
      p++;
    }

    if (closedAt === -1) {
      i = lt + 1;
      continue;
    }

    const fullTag = code.slice(lt, closedAt + 1);
    let rawAttrs = code.slice(attrsStart, closedAt);
    let isSelfClosing = false;
    if (!isClosing && rawAttrs.trimEnd().endsWith('/')) {
      isSelfClosing = true;
      rawAttrs = rawAttrs.replace(/\/\s*$/, '');
    }

    tags.push({
      fullTag,
      tagName,
      attrs: rawAttrs,
      isClosing,
      isSelfClosing,
      localStart: lt,
      localEnd: closedAt + 1,
    });

    i = closedAt + 1;
  }

  return tags;
}

export interface BloggerSpecificCheckSummary {
  unescapedAmpCount: number;
  cdataIssueCount: number;
  quoteCollisionCount: number;
  duplicateIdCount: number;
  issues: XmlSyntaxIssue[];
}

interface SegmentedXmlCacheEntry {
  xml: string;
  lineStarts: number[];
  segments: XmlSegment[];
  codeTagsBySegIndex: Map<number, ScannedXmlTag[]>;
  nonCommentXml: string;
}

const segmentedXmlLruCache: SegmentedXmlCacheEntry[] = [];
const bloggerRulesLruCache: Array<{ xml: string; result: BloggerSpecificCheckSummary }> = [];
const xmlValidationDefaultLruCache: Array<{ xml: string; result: XmlValidationResult }> = [];

function getSegmentedAndTaggedCached(xml: string): SegmentedXmlCacheEntry {
  for (let i = 0; i < segmentedXmlLruCache.length; i++) {
    if (segmentedXmlLruCache[i].xml === xml) {
      const hit = segmentedXmlLruCache[i];
      if (i > 0) {
        segmentedXmlLruCache.splice(i, 1);
        segmentedXmlLruCache.unshift(hit);
      }
      return hit;
    }
  }

  const lineStarts = buildLineStarts(xml);
  const segments = segmentXml(xml);
  const codeTagsBySegIndex = new Map<number, ScannedXmlTag[]>();
  const nonCommentParts: string[] = [];

  for (let idx = 0; idx < segments.length; idx++) {
    const seg = segments[idx];
    if (seg.type === 'code') {
      codeTagsBySegIndex.set(idx, scanTagsQuoteAware(seg.text));
      nonCommentParts.push(seg.text);
    } else if (seg.type === 'comment') {
      nonCommentParts.push(' '.repeat(seg.text.length));
    } else {
      nonCommentParts.push(seg.text);
    }
  }

  const entry: SegmentedXmlCacheEntry = {
    xml,
    lineStarts,
    segments,
    codeTagsBySegIndex,
    nonCommentXml: nonCommentParts.join(''),
  };

  segmentedXmlLruCache.unshift(entry);
  if (segmentedXmlLruCache.length > 2) segmentedXmlLruCache.pop();
  return entry;
}

function findCondAndExprAttrSpan(
  tagText: string,
  eqEndIdx: number,
  outerQuote: '"' | "'"
): { valueEndIdx: number; hasCollision: boolean } {
  const len = tagText.length;
  // Fast & exact XML path: if the very first matching outerQuote is immediately
  // followed by a valid attribute boundary or tag close, there is zero quote collision.
  // Entities such as &quot; and &apos; remain raw text and are never decoded here.
  const firstQ = tagText.indexOf(outerQuote, eqEndIdx);
  if (firstQ !== -1) {
    const afterFirst = tagText.slice(firstQ + 1);
    if (/^\s*(?:\/?>|[a-zA-Z_:][a-zA-Z0-9_.:-]*\s*=(?!=))/.test(afterFirst)) {
      return { valueEndIdx: firstQ, hasCollision: false };
    }
  }

  let i = eqEndIdx;
  const candidateEnds: number[] = [];

  while (i < len) {
    if (tagText[i] === outerQuote) {
      const after = tagText.slice(i + 1);
      if (/^\s*(?:\/?>|[a-zA-Z_:][a-zA-Z0-9_.:-]*\s*=(?!=))/.test(after)) {
        candidateEnds.push(i);
      }
    }
    i++;
  }

  if (candidateEnds.length === 0) {
    const lastQ = tagText.lastIndexOf(outerQuote);
    if (lastQ >= eqEndIdx) {
      const rawInner = tagText.slice(eqEndIdx, lastQ);
      return { valueEndIdx: lastQ, hasCollision: rawInner.includes(outerQuote) };
    }
    return { valueEndIdx: eqEndIdx, hasCollision: false };
  }

  let chosenEnd = candidateEnds[0];
  for (let c = 0; c < candidateEnds.length; c++) {
    const endIdx = candidateEnds[c];
    const inner = tagText.slice(eqEndIdx, endIdx);
    const innerSameQuotes = (inner.match(new RegExp(outerQuote, 'g')) || []).length;
    if (innerSameQuotes % 2 === 0 && !/^\s*(?:==|!=|&&|\|\||[?:,+])/.test(inner.trim())) {
      chosenEnd = endIdx;
      const trailing = tagText.slice(endIdx + 1).trimStart();
      if (!/^(?:==|!=|and\b|or\b|contains\b|not\b|in\b|[)\],?:+])/.test(trailing)) {
        if (c + 1 < candidateEnds.length) {
          const nextAfter = tagText.slice(endIdx + 1, candidateEnds[c + 1]);
          if (/^[a-zA-Z0-9_.-]+['"]?\s*$/.test(nextAfter) || /^\s*(?:==|!=|&&|\|\||[),])/.test(nextAfter)) {
            continue;
          }
        }
        break;
      }
    } else {
      chosenEnd = endIdx;
    }
  }

  const finalInner = tagText.slice(eqEndIdx, chosenEnd);
  return {
    valueEndIdx: chosenEnd,
    hasCollision: finalInner.includes(outerQuote),
  };
}

function fixQuoteCollisionsInTag(tagText: string): { fixedTag: string; fixedCount: number } {
  const openMatch = /^<\s*[a-zA-Z_][a-zA-Z0-9:_-]*/.exec(tagText);
  if (!openMatch) return { fixedTag: tagText, fixedCount: 0 };

  const len = tagText.length;
  let i = openMatch[0].length;
  let out = tagText.slice(0, i);
  let fixedCount = 0;

  while (i < len) {
    const wsMatch = /^\s+/.exec(tagText.slice(i));
    if (wsMatch) {
      out += wsMatch[0];
      i += wsMatch[0].length;
    }
    if (i >= len) break;

    if (tagText[i] === '>' || tagText.startsWith('/>', i)) {
      out += tagText.slice(i);
      break;
    }

    const attrNameMatch = /^[a-zA-Z_:][a-zA-Z0-9_.:-]*/.exec(tagText.slice(i));
    if (!attrNameMatch) {
      out += tagText[i];
      i++;
      continue;
    }

    const attrStart = i;
    const attrName = attrNameMatch[0];
    i += attrName.length;

    const eqMatch = /^\s*=\s*(['"])/.exec(tagText.slice(i));
    if (!eqMatch) {
      out += attrName;
      continue;
    }

    const outerQuote = eqMatch[1] as '"' | "'";
    const valStart = i + eqMatch[0].length;
    const isTargetAttr = /^(?:cond|expr:[a-zA-Z0-9_-]+)$/i.test(attrName);

    if (!isTargetAttr) {
      const closeQ = tagText.indexOf(outerQuote, valStart);
      if (closeQ === -1) {
        out += tagText.slice(attrStart);
        break;
      }
      out += tagText.slice(attrStart, closeQ + 1);
      i = closeQ + 1;
      continue;
    }

    const { valueEndIdx, hasCollision } = findCondAndExprAttrSpan(tagText, valStart, outerQuote);
    if (!hasCollision || valueEndIdx <= valStart) {
      out += tagText.slice(attrStart, valueEndIdx + 1);
      i = valueEndIdx + 1;
      continue;
    }

    fixedCount++;
    const rawInner = tagText.slice(valStart, valueEndIdx);
    const altQuote: '"' | "'" = outerQuote === '"' ? "'" : '"';
    if (!rawInner.includes(altQuote)) {
      out += `${attrName}=${altQuote}${rawInner}${altQuote}`;
    } else {
      const escaped = rawInner.replace(
        new RegExp(outerQuote, 'g'),
        outerQuote === '"' ? '&quot;' : '&#39;'
      );
      out += `${attrName}=${outerQuote}${escaped}${outerQuote}`;
    }
    i = valueEndIdx + 1;
  }

  return { fixedTag: out, fixedCount };
}

function isBareAmpersandMatchValidEntity(afterAmp: string): boolean {
  const numDec = /^#\d+;/.test(afterAmp);
  if (numDec) return true;
  const numHex = /^#x[0-9a-fA-F]+;/.test(afterAmp);
  if (numHex) return true;
  const named = /^([a-zA-Z][a-zA-Z0-9]*);/.exec(afterAmp);
  if (named && isValidXmlOrHtmlEntityName(named[1])) return true;
  return false;
}

/**
 * Fast O(N) Blogger-Specific 4-Point Validator (safe on 1MB-5MB XML files)
 * - Strictly ignores contents inside <![CDATA[ ... ]]> and <!-- ... -->
 * - Allows common HTML entities (&nbsp;, &copy;, &raquo;, &laquo;, &mdash;, etc.)
 * - Uses quote-aware tag parsing so cond='data:blog.pageType == "index"' and cond='data:posts.size > 0' never trigger false positives
 */
export function scanBloggerSpecificRules(xml: string): BloggerSpecificCheckSummary {
  if (!xml.trim()) {
    return { unescapedAmpCount: 0, cdataIssueCount: 0, quoteCollisionCount: 0, duplicateIdCount: 0, issues: [] };
  }

  for (let i = 0; i < bloggerRulesLruCache.length; i++) {
    if (bloggerRulesLruCache[i].xml === xml) {
      const hit = bloggerRulesLruCache[i];
      if (i > 0) {
        bloggerRulesLruCache.splice(i, 1);
        bloggerRulesLruCache.unshift(hit);
      }
      return hit.result;
    }
  }

  const issues: XmlSyntaxIssue[] = [];
  let unescapedAmpCount = 0;
  let cdataIssueCount = 0;
  let quoteCollisionCount = 0;
  let duplicateIdCount = 0;

  let ampIssuesAdded = 0;
  let orphanEndIssuesAdded = 0;
  let quoteCollisionIssuesAdded = 0;

  const { lineStarts, segments, codeTagsBySegIndex, nonCommentXml } =
    getSegmentedAndTaggedCached(xml);

  // 1. Check unclosed <![CDATA[ detected during segmentation
  for (const seg of segments) {
    if (seg.type === 'cdata' && seg.unclosedCdata) {
      cdataIssueCount++;
      issues.push({
        line: lineAtStarts(lineStarts, seg.start),
        severity: 'error',
        code: 'UNCLOSED_CDATA',
        message: 'Blok <![CDATA[ belum ditutup dengan ]]>.',
        snippet: '<![CDATA[',
        autoFixable: true,
      });
    }
  }

  // 1b. Check unprotected <b:skin>, <b:template-skin>, <style>, <script> ONLY on non-comment/non-CDATA segments
  const blockTagRegex = /<(b:skin|b:template-skin|script|style)\b((?:"[^"]*"|'[^']*'|[^>"'/]|\/(?!>))*)>([\s\S]*?)<\/\1>/gi;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = blockTagRegex.exec(nonCommentXml)) !== null) {
    const tagName = blockMatch[1];
    const attrs = blockMatch[2] || '';
    const inner = blockMatch[3];
    if (!inner.trim()) continue;
    const lowerTag = tagName.toLowerCase();
    const hasCdata = /<!\[CDATA\[/i.test(inner);
    if (hasCdata) continue;

    if (lowerTag === 'script') {
      const hasSrcAttr = /(?:^|\s)(?:expr:)?src\s*=/i.test(attrs);
      const isJsonLd = /(?:^|\s)type\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json')/i.test(attrs);
      const hasDynamicBlogger =
        /<b:(?:eval|if|elseif|else|loop|with|switch|case|attr|class|variable)\b/i.test(inner) ||
        /<data:[a-zA-Z_][a-zA-Z0-9_.-]*/i.test(inner) ||
        /\bdata:[a-zA-Z_][a-zA-Z0-9_.-]*/i.test(inner);
      if (hasSrcAttr || isJsonLd || hasDynamicBlogger) {
        continue;
      }
    }

    // Mask valid Blogger tags (quote-aware) and valid XML/HTML entities before checking raw < or &
    const strippedBlogger = inner.replace(
      /<\/?(?:b:|data:|expr:|Group\b|Variable\b)(?:"[^"]*"|'[^']*'|[^>"'])*>/gi,
      ''
    );
    const hasRawLt = /</.test(strippedBlogger);
    let hasBareAmp = false;
    for (let ai = 0; ai < strippedBlogger.length; ai++) {
      if (strippedBlogger[ai] === '&' && !isBareAmpersandMatchValidEntity(strippedBlogger.slice(ai + 1, ai + 20))) {
        hasBareAmp = true;
        break;
      }
    }
    if (hasRawLt || hasBareAmp) {
      cdataIssueCount++;
      issues.push({
        line: lineAtStarts(lineStarts, blockMatch.index),
        severity: 'error',
        code: 'UNPROTECTED_CDATA_BLOCK',
        message: `Isi tag <${tagName}> mengandung karakter &, <, atau > tanpa pembungkus <![CDATA[...]]>.`,
        snippet: `<${tagName}`,
        autoFixable: true,
      });
    }
  }

  // 2. Scan code segments (strictly outside CDATA/comments)
  const seenSectionIds = new Map<string, number>();
  const seenWidgetIds = new Map<string, number>();

  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const seg = segments[segIdx];
    if (seg.type !== 'code') continue;

    // Bare '&' outside CDATA/comments (ignoring valid XML entities AND common HTML entities)
    const ampRegex = /&[a-zA-Z0-9#_-]*;?/g;
    let ampMatch: RegExpExecArray | null;
    while ((ampMatch = ampRegex.exec(seg.text)) !== null) {
      if (isBareAmpersandMatchValidEntity(seg.text.slice(ampMatch.index + 1, ampMatch.index + 24))) {
        continue;
      }
      unescapedAmpCount++;
      if (ampIssuesAdded < 8) {
        ampIssuesAdded++;
        issues.push({
          line: lineAtStarts(lineStarts, seg.start + ampMatch.index),
          severity: 'error',
          code: 'UNESCAPED_AMP',
          message: `Karakter "&" pada "${ampMatch[0]}" bukan entitas XML/HTML valid dan harus di-escape menjadi "&amp;".`,
          snippet: ampMatch[0],
          autoFixable: true,
        });
      }
    }

    // Orphan ]]> outside CDATA
    const orphanEndRe = /\]\]>/g;
    let oeMatch: RegExpExecArray | null;
    while ((oeMatch = orphanEndRe.exec(seg.text)) !== null) {
      cdataIssueCount++;
      if (orphanEndIssuesAdded < 4) {
        orphanEndIssuesAdded++;
        issues.push({
          line: lineAtStarts(lineStarts, seg.start + oeMatch.index),
          severity: 'error',
          code: 'CDATA_ORPHAN_END',
          message: 'Token penutup "]]>" yatim ditemukan di luar blok <![CDATA[...]]>.',
          snippet: ']]>',
          autoFixable: true,
        });
      }
    }

    // Quote-aware tag checks: quote collisions & duplicate <b:section>/<b:widget> IDs
    const scannedTags = codeTagsBySegIndex.get(segIdx) || [];
    for (const tag of scannedTags) {
      if (tag.isClosing) continue;
      const lowerTag = tag.tagName.toLowerCase();

      if (/\b(?:cond|expr:[a-zA-Z0-9_-]+)\s*=\s*['"]/.test(tag.attrs)) {
        const { fixedCount } = fixQuoteCollisionsInTag(tag.fullTag);
        if (fixedCount > 0) {
          quoteCollisionCount += fixedCount;
          if (quoteCollisionIssuesAdded < 8) {
            quoteCollisionIssuesAdded++;
            issues.push({
              line: lineAtStarts(lineStarts, seg.start + tag.localStart),
              severity: 'error',
              code: 'ATTR_QUOTE_COLLISION',
              message: 'Benturan tanda kutip di dalam atribut b:if cond / expr:* (kutip dalam sama dengan kutip pembungkus atribut).',
              snippet: tag.fullTag.split('\n')[0].slice(0, 72),
              autoFixable: true,
            });
          }
        }
      }

      if (lowerTag === 'b:section' || lowerTag === 'b:widget') {
        const idMatch = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag.attrs);
        const idVal = (idMatch?.[1] ?? idMatch?.[2] ?? '').trim();
        if (!idVal) continue;
        const line = lineAtStarts(lineStarts, seg.start + tag.localStart);

        if (lowerTag === 'b:section') {
          const prevLine = seenSectionIds.get(idVal);
          if (prevLine !== undefined) {
            duplicateIdCount++;
            issues.push({
              line,
              severity: 'error',
              code: 'DUPLICATE_SECTION_ID',
              message: `ID <b:section id="${idVal}"> duplikat (sudah dipakai di baris ${prevLine}).`,
              snippet: `id="${idVal}"`,
              autoFixable: true,
            });
          } else {
            seenSectionIds.set(idVal, line);
          }
        } else {
          const prevLine = seenWidgetIds.get(idVal);
          if (prevLine !== undefined) {
            duplicateIdCount++;
            issues.push({
              line,
              severity: 'error',
              code: 'DUPLICATE_WIDGET_ID',
              message: `ID <b:widget id="${idVal}"> duplikat (sudah dipakai di baris ${prevLine}).`,
              snippet: `id="${idVal}"`,
              autoFixable: true,
            });
          } else {
            seenWidgetIds.set(idVal, line);
          }
        }
      }
    }
  }

  const result: BloggerSpecificCheckSummary = {
    unescapedAmpCount,
    cdataIssueCount,
    quoteCollisionCount,
    duplicateIdCount,
    issues,
  };
  bloggerRulesLruCache.unshift({ xml, result });
  if (bloggerRulesLruCache.length > 2) bloggerRulesLruCache.pop();
  return result;
}

/**
 * 100% Offline Blogger XML Syntax Validator
 * - Masks CDATA & comments completely before checking tags, '&', or quotes
 * - Allows common HTML entities (&nbsp;, &copy;, &raquo;, &laquo;, &mdash;, etc.)
 * - Supports double quotes inside single-quoted cond='...' and expr:*='...' attributes
 * - Normalizes entities before optional DOMParser check so real Blogger themes produce zero false positives
 */
export function validateBloggerXmlOffline(
  xml: string,
  options?: { skipDomParser?: boolean; forceDomParser?: boolean }
): XmlValidationResult {
  const useDefaultCache = !options?.skipDomParser && !options?.forceDomParser;
  if (useDefaultCache) {
    for (let i = 0; i < xmlValidationDefaultLruCache.length; i++) {
      if (xmlValidationDefaultLruCache[i].xml === xml) {
        const hit = xmlValidationDefaultLruCache[i];
        if (i > 0) {
          xmlValidationDefaultLruCache.splice(i, 1);
          xmlValidationDefaultLruCache.unshift(hit);
        }
        return hit.result;
      }
    }
  }

  const issues: XmlSyntaxIssue[] = [];
  const trimmed = xml.trim();

  if (!trimmed) {
    return {
      isValid: false,
      issues: [
        {
          line: 1,
          severity: 'error',
          code: 'EMPTY_XML',
          message: 'Kode XML masih kosong.',
          autoFixable: false,
        },
      ],
    };
  }

  // 1. Run O(N) Blogger-Specific Validator (reuses cached segmentation & tags)
  const bloggerChecks = scanBloggerSpecificRules(xml);
  issues.push(...bloggerChecks.issues);

  // 2. Fast O(N) quote-aware tag balance & XHTML structure check across the whole document (CDATA masked)
  const { lineStarts, segments, codeTagsBySegIndex } = getSegmentedAndTaggedCached(xml);
  const tagStack: Array<{ name: string; line: number; snippet: string; isVoid: boolean }> = [];

  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const seg = segments[segIdx];
    if (seg.type !== 'code') continue;

    const tags = codeTagsBySegIndex.get(segIdx) || [];
    for (const t of tags) {
      const lowerName = t.tagName.toLowerCase();
      const absIdx = seg.start + t.localStart;
      const line = lineAtStarts(lineStarts, absIdx);
      const shortSnippet = t.fullTag.split('\n')[0].slice(0, 72);

      // Bare boolean attributes without values across ALL HTML tags (W3C XML strict rule: async='async', disabled='disabled', etc.)
      if (
        !t.isClosing &&
        t.attrs &&
        !lowerName.startsWith('b:') &&
        !lowerName.startsWith('data:') &&
        lowerName !== 'variable' &&
        lowerName !== 'group'
      ) {
        const attrsOnly = t.attrs
          .replace(/=\s*(?:"[^"]*"|'[^']*')/g, '=""')
          .replace(/(?:"[^"]*"|'[^']*')/g, '""');
        BOOLEAN_XHTML_ATTR_RE.lastIndex = 0;
        let bareBool: RegExpExecArray | null;
        while ((bareBool = BOOLEAN_XHTML_ATTR_RE.exec(attrsOnly)) !== null) {
          const attrToken = bareBool[1];
          const lowerAttr = attrToken.toLowerCase();
          const suggested =
            lowerAttr === 'crossorigin' ? `crossorigin='anonymous'` : `${lowerAttr}='${lowerAttr}'`;
          issues.push({
            line,
            severity: 'error',
            code: 'BARE_BOOLEAN_ATTR',
            message: `Atribut boolean "${attrToken}" pada <${t.tagName}> wajib diberi nilai (mis. ${suggested}) sesuai aturan XML 1.0 & Blogger.`,
            snippet: attrToken,
            autoFixable: true,
          });
        }
      }

      if (t.isSelfClosing) continue;

      if (!t.isClosing) {
        tagStack.push({
          name: t.tagName,
          line,
          snippet: shortSnippet,
          isVoid: VOID_TAGS.has(lowerName),
        });
      } else {
        let stackPos = -1;
        for (let s = tagStack.length - 1; s >= 0; s--) {
          if (tagStack[s].name === t.tagName) {
            stackPos = s;
            break;
          }
        }
        if (stackPos === -1) {
          issues.push({
            line,
            severity: 'error',
            code: 'ORPHAN_CLOSING_TAG',
            message: `Tag penutup </${t.tagName}> tidak memiliki pasangan tag pembuka.`,
            snippet: t.fullTag,
            autoFixable: true,
          });
        } else {
          const unclosed = tagStack.splice(stackPos + 1);
          for (const orphan of unclosed) {
            issues.push({
              line: orphan.line,
              severity: 'error',
              code: orphan.isVoid ? 'UNCLOSED_VOID_TAG' : 'UNCLOSED_TAG',
              message: orphan.isVoid
                ? `Tag HTML <${orphan.name}> pada baris ${orphan.line} belum ditutup (<${orphan.name} .../> atau </${orphan.name}>) sebelum </${t.tagName}>.`
                : `Tag <${orphan.name}> pada baris ${orphan.line} belum ditutup sebelum </${t.tagName}>.`,
              snippet: orphan.snippet,
              autoFixable: true,
            });
          }
          tagStack.pop();
        }
      }
    }
  }

  for (const leftover of tagStack) {
    issues.push({
      line: leftover.line,
      severity: 'error',
      code: leftover.isVoid ? 'UNCLOSED_VOID_TAG' : 'UNCLOSED_TAG',
      message: leftover.isVoid
        ? `Tag HTML <${leftover.name}> pada baris ${leftover.line} belum ditutup (<${leftover.name} .../> atau </${leftover.name}>).`
        : `Tag <${leftover.name}> belum ditutup hingga akhir dokumen.`,
      snippet: leftover.snippet,
      autoFixable: true,
    });
  }

  // 3. Check Blogger namespaces on <html> (warning only)
  const htmlHeadSlice = xml.slice(0, 8192);
  const htmlOpenMatch = /<html\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/i.exec(htmlHeadSlice);
  if (htmlOpenMatch) {
    const attrs = htmlOpenMatch[1];
    if (!/xmlns:b\s*=/.test(attrs) || !/xmlns:data\s*=/.test(attrs) || !/xmlns:expr\s*=/.test(attrs)) {
      issues.push({
        line: getLineNumberAt(htmlHeadSlice, htmlOpenMatch.index),
        severity: 'warning',
        code: 'MISSING_BLOGGER_NS',
        message: 'Tag <html> belum memiliki namespace lengkap Blogger (xmlns:b, xmlns:data, xmlns:expr).',
        snippet: htmlOpenMatch[0].split('\n')[0].slice(0, 72),
        autoFixable: true,
      });
    }
  }

  // 4. Normalized DOMParser("text/xml") check (skipped automatically during live typing on >150KB files unless forceDomParser is true)
  const shouldRunDomParser =
    typeof DOMParser !== 'undefined' &&
    !options?.skipDomParser &&
    (options?.forceDomParser || xml.length <= 150 * 1024);

  if (shouldRunDomParser && !issues.some((i) => i.severity === 'error')) {
    try {
      const normalizedForDom = normalizeHtmlEntitiesForXmlParser(xml);
      const parser = new DOMParser();
      const doc = parser.parseFromString(normalizedForDom, 'text/xml');
      const parserError =
        doc.querySelector('parsererror') || doc.getElementsByTagName('parsererror')[0];
      if (parserError) {
        const errText = parserError.textContent || 'Kesalahan sintaks XML terdeteksi.';
        // Suppress false-positive HTML entity reference complaints if any custom HTML5 entity remained
        const entityErrMatch = /Entity\s+['"]?([a-zA-Z0-9]+)['"]?\s+not defined/i.exec(errText);
        if (!entityErrMatch || !isValidXmlOrHtmlEntityName(entityErrMatch[1])) {
          const lineMatch = /line\s+(?:number\s+)?(\d+)/i.exec(errText);
          const colMatch = /column\s+(\d+)/i.exec(errText);
          const parsedLine = lineMatch ? Number.parseInt(lineMatch[1], 10) : 1;
          const parsedCol = colMatch ? Number.parseInt(colMatch[1], 10) : undefined;
          const cleanMsg = errText
            .replace(/This page contains the following errors:/i, '')
            .replace(/Below is a rendering of the page up to the first error\.?/i, '')
            .replace(/XML Parsing Error:\s*/i, '')
            .trim()
            .split('\n')[0]
            .trim();
          issues.push({
            line: parsedLine,
            column: parsedCol,
            severity: 'error',
            code: 'XML_PARSER_ERROR',
            message: cleanMsg || 'Sintaks XML tidak valid.',
            autoFixable: true,
          });
        }
      }
    } catch {
      // Ignore DOMParser environment edge case
    }
  }

  const deduped = issues
    .sort((a, b) => a.line - b.line)
    .slice(0, 40);

  const result: XmlValidationResult = {
    isValid: !deduped.some((i) => i.severity === 'error'),
    issues: deduped,
  };

  if (useDefaultCache) {
    xmlValidationDefaultLruCache.unshift({ xml, result });
    if (xmlValidationDefaultLruCache.length > 2) xmlValidationDefaultLruCache.pop();
  }

  return result;
}

/**
 * 100% Offline Deterministic Blogger XML Syntax Auto-Fixer
 */
export function autoFixBloggerXmlOffline(xml: string): XmlAutoFixResult {
  let out = xml;
  const fixesApplied: string[] = [];

  // Step 1: Close dangling <![CDATA[ inside skin/script/style before closing tag
  const step1 = out.replace(
    /(<!\[CDATA\[(?:(?!\]\]>)[\s\S])*?)(<\/(?:b:skin|b:template-skin|script|style)>)/gi,
    '$1\n]]>\n$2'
  );
  if (step1 !== out) {
    out = step1;
    fixesApplied.push('Menutup blok <![CDATA[ yang belum diberi penutup ]]>');
  }

  // Step 1b: Escape stray raw ']]>' inside <![CDATA[ ... ]]> of skin/script/style blocks
  let strayCdataEndCount = 0;
  out = out.replace(
    /(<(?:b:skin|b:template-skin|script|style)\b[^>]*>[\s\S]*?<!\[CDATA\[)([\s\S]*?)(\]\]>\s*<\/(?:b:skin|b:template-skin|script|style)>)/gi,
    (full, prefix: string, inner: string, suffix: string) => {
      if (!inner.includes(']]>')) return full;
      strayCdataEndCount++;
      return `${prefix}${inner.replace(/\]\]>/g, ']]&gt;')}${suffix}`;
    }
  );
  if (strayCdataEndCount > 0) {
    fixesApplied.push(`Menetralkan token "]]>" ekstra di dalam ${strayCdataEndCount} blok CDATA`);
  }

  // Step 2: Wrap unprotected <b:skin>, <b:template-skin>, <script>, <style> containing &, <, >
  let cdataWrappedCount = 0;
  out = out.replace(
    /<(b:skin|b:template-skin|script|style)\b((?:"[^"]*"|'[^']*'|[^>"'/]|\/(?!>))*)>([\s\S]*?)<\/\1>/gi,
    (full, tagName: string, attrs: string, inner: string) => {
      if (!inner.trim() || /<!\[CDATA\[/i.test(inner)) return full;
      const lower = tagName.toLowerCase();
      if (lower === 'script') {
        const hasSrcAttr = /(?:^|\s)(?:expr:)?src\s*=/i.test(attrs);
        const isJsonLd = /(?:^|\s)type\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json')/i.test(attrs);
        const hasDynamicBlogger =
          /<b:(?:eval|if|elseif|else|loop|with|switch|case|attr|class|variable)\b/i.test(inner) ||
          /<data:[a-zA-Z_][a-zA-Z0-9_.-]*/i.test(inner) ||
          /\bdata:[a-zA-Z_][a-zA-Z0-9_.-]*/i.test(inner);
        if (hasSrcAttr || isJsonLd || hasDynamicBlogger) return full;
      }
      if (
        !/[&<>]/.test(
          inner.replace(/<\/?(?:b:|data:|expr:|Group\b|Variable\b)(?:"[^"]*"|'[^']*'|[^>"'])*>/gi, '')
        )
      ) {
        return full;
      }
      cdataWrappedCount++;
      const safeInner = inner.replace(/\]\]>/g, ']]&gt;').trim();
      if (lower === 'script' || lower === 'style') {
        return `<${tagName}${attrs}>\n/*<![CDATA[*/\n${safeInner}\n/*]]>*/\n</${tagName}>`;
      }
      return `<${tagName}${attrs}><![CDATA[\n${safeInner}\n]]></${tagName}>`;
    }
  );
  if (cdataWrappedCount > 0) {
    fixesApplied.push(`Membungkus ${cdataWrappedCount} blok <b:skin>/<script>/<style> dengan <![CDATA[...]]>`);
  }

  // Step 3: Process code segments outside CDATA & comments
  let ampFixedCount = 0;
  let voidTagsFixedCount = 0;
  let boolAttrsFixedCount = 0;
  let quoteCollisionsFixedCount = 0;
  let dupSectionIdsFixedCount = 0;
  let dupWidgetIdsFixedCount = 0;

  // Pre-collect existing section & widget IDs for collision-free renumbering
  const usedSectionIds = new Set<string>();
  const usedWidgetIds = new Set<string>();
  const firstSeenSections = new Set<string>();
  const firstSeenWidgets = new Set<string>();
  const preIdRe = /<(b:section|b:widget)\b([^>]*)>/gi;
  let preM: RegExpExecArray | null;
  while ((preM = preIdRe.exec(out)) !== null) {
    const idM = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(preM[2]);
    const idV = (idM?.[1] ?? idM?.[2] ?? '').trim();
    if (!idV) continue;
    if (preM[1].toLowerCase() === 'b:section') usedSectionIds.add(idV);
    else usedWidgetIds.add(idV);
  }

  const nextUniqueId = (baseId: string, usedSet: Set<string>): string => {
    const m = /^(.*?)(\d+)$/.exec(baseId);
    const prefix = m ? m[1] : `${baseId}-`;
    let n = m ? Number.parseInt(m[2], 10) + 1 : 2;
    while (usedSet.has(`${prefix}${n}`)) n++;
    const candidate = `${prefix}${n}`;
    usedSet.add(candidate);
    return candidate;
  };

  const segments = segmentXml(out);
  const rebuilt = segments
    .map((seg) => {
      if (seg.type !== 'code') return seg.text;

      let code = seg.text;

      // 3.0 Fix quote collisions in b:if cond / b:elseif cond / expr:* attributes (quote-aware)
      code = code.replace(
        /<[a-zA-Z][a-zA-Z0-9:_-]*\b(?:"[^"]*"|'[^']*'|[^>"'])*>/g,
        (fullTag) => {
          if (!/\b(?:cond|expr:[a-zA-Z0-9_-]+)\s*=\s*['"]/.test(fullTag)) return fullTag;
          const res = fixQuoteCollisionsInTag(fullTag);
          quoteCollisionsFixedCount += res.fixedCount;
          return res.fixedTag;
        }
      );

      // 3.0b Auto-renumber duplicate <b:section> and <b:widget> IDs
      code = code.replace(/<(b:section|b:widget)\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi, (fullTag, tagName: string, attrs: string) => {
        const lower = tagName.toLowerCase();
        const idM = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
        const idV = (idM?.[1] ?? idM?.[2] ?? '').trim();
        if (!idV) return fullTag;

        if (lower === 'b:section') {
          if (!firstSeenSections.has(idV)) {
            firstSeenSections.add(idV);
            return fullTag;
          }
          const newId = nextUniqueId(idV, usedSectionIds);
          dupSectionIdsFixedCount++;
          return fullTag.replace(/\bid\s*=\s*(["'])([^"']*)(\1)/i, `id=$1${newId}$3`);
        }

        if (!firstSeenWidgets.has(idV)) {
          firstSeenWidgets.add(idV);
          return fullTag;
        }
        const newId = nextUniqueId(idV, usedWidgetIds);
        dupWidgetIdsFixedCount++;
        return fullTag.replace(/\bid\s*=\s*(["'])([^"']*)(\1)/i, `id=$1${newId}$3`);
      });

      // 3a. Escape genuinely unescaped '&' (preserve XML entities & valid HTML named entities)
      code = code.replace(/&([a-zA-Z0-9#_-]*;?)/g, (full, after: string) => {
        if (isBareAmpersandMatchValidEntity(after)) return full;
        ampFixedCount++;
        return `&amp;${after}`;
      });

      // 3c. Fix valueless boolean HTML attributes inside tags to XHTML style (attr='attr') outside quotes
      code = code.replace(/<([a-zA-Z][a-zA-Z0-9:_-]*)((?:\s+(?:"[^"]*"|'[^']*'|[^>"'\/]|\/(?!>))+))\s*(\/?)>/g, (full, tagName: string, attrs: string, slash: string) => {
        const lowerT = tagName.toLowerCase();
        if (
          lowerT.startsWith('b:') ||
          lowerT.startsWith('data:') ||
          lowerT === 'variable' ||
          lowerT === 'group'
        ) {
          return full;
        }
        const { updatedAttrs, fixedCount } = fixBareBooleanAttrsOutsideQuotes(attrs);
        if (fixedCount === 0) return full;
        boolAttrsFixedCount += fixedCount;
        return `<${tagName}${updatedAttrs}${slash}>`;
      });

      return code;
    })
    .join('');

  // Step 3b: Only self-close UNPAIRED void tags and remove ORPHAN closing void tags
  // (preserve valid paired <img>...</img> and <input>...</input> containing <b:attr>/<b:class>)
  {
    const voidSegs = segmentXml(rebuilt);
    const voidStack: Array<{ name: string; segIdx: number; localStart: number; localEnd: number; isVoid: boolean }> = [];
    const voidEditsBySeg = new Map<number, Array<{ start: number; end: number; action: 'selfClose' | 'remove' }>>();
    const pushVoidEdit = (segIdx: number, start: number, end: number, action: 'selfClose' | 'remove') => {
      const arr = voidEditsBySeg.get(segIdx) || [];
      arr.push({ start, end, action });
      voidEditsBySeg.set(segIdx, arr);
    };

    for (let sIdx = 0; sIdx < voidSegs.length; sIdx++) {
      const seg = voidSegs[sIdx];
      if (seg.type !== 'code') continue;
      const tags = scanTagsQuoteAware(seg.text);
      for (const t of tags) {
        if (t.isSelfClosing) continue;
        const lower = t.tagName.toLowerCase();
        if (!t.isClosing) {
          voidStack.push({
            name: t.tagName,
            segIdx: sIdx,
            localStart: t.localStart,
            localEnd: t.localEnd,
            isVoid: VOID_TAGS.has(lower),
          });
        } else {
          let stackPos = -1;
          for (let s = voidStack.length - 1; s >= 0; s--) {
            if (voidStack[s].name === t.tagName) {
              stackPos = s;
              break;
            }
          }
          if (stackPos === -1) {
            if (VOID_TAGS.has(lower)) {
              pushVoidEdit(sIdx, t.localStart, t.localEnd, 'remove');
            }
          } else {
            const unclosed = voidStack.splice(stackPos + 1);
            for (const item of unclosed) {
              if (item.isVoid) {
                pushVoidEdit(item.segIdx, item.localStart, item.localEnd, 'selfClose');
              }
            }
            voidStack.pop();
          }
        }
      }
    }

    for (const leftover of voidStack) {
      if (leftover.isVoid) {
        pushVoidEdit(leftover.segIdx, leftover.localStart, leftover.localEnd, 'selfClose');
      }
    }

    out = voidSegs
      .map((seg, sIdx) => {
        if (seg.type !== 'code') return seg.text;
        const edits = voidEditsBySeg.get(sIdx);
        if (!edits || edits.length === 0) return seg.text;
        edits.sort((a, b) => b.start - a.start);
        let text = seg.text;
        for (const ed of edits) {
          voidTagsFixedCount++;
          if (ed.action === 'remove') {
            text = text.slice(0, ed.start) + text.slice(ed.end);
          } else {
            const origTag = text.slice(ed.start, ed.end);
            const selfClosed = origTag.replace(/\s*>$/, '/>');
            text = text.slice(0, ed.start) + selfClosed + text.slice(ed.end);
          }
        }
        return text;
      })
      .join('');
  }

  if (quoteCollisionsFixedCount > 0) {
    fixesApplied.push(`Memperbaiki ${quoteCollisionsFixedCount} benturan tanda kutip pada atribut cond / expr:*`);
  }
  if (dupSectionIdsFixedCount > 0 || dupWidgetIdsFixedCount > 0) {
    fixesApplied.push(
      `Menomori ulang ${dupSectionIdsFixedCount + dupWidgetIdsFixedCount} ID duplikat (<b:section>/<b:widget>)`
    );
  }
  if (ampFixedCount > 0) {
    fixesApplied.push(`Meng-escape ${ampFixedCount} karakter "&" menjadi "&amp;"`);
  }
  if (voidTagsFixedCount > 0) {
    fixesApplied.push(`Menutup ${voidTagsFixedCount} tag HTML tunggal (<meta>, <link>, <br>, <img>, dll.) menjadi self-closing "/>"`);
  }
  if (boolAttrsFixedCount > 0) {
    fixesApplied.push(`Memperbaiki ${boolAttrsFixedCount} atribut boolean HTML ke format XHTML`);
  }

  // Step 4: Ensure XML declaration & Blogger namespaces on <html>
  if (!/^\s*<\?xml\b/i.test(out)) {
    out = `<?xml version="1.0" encoding="UTF-8" ?>\n${out}`;
    fixesApplied.push('Menambahkan deklarasi <?xml version="1.0" encoding="UTF-8" ?> di awal dokumen');
  }

  out = out.replace(/<html\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/i, (full, attrs: string) => {
    let nextAttrs = attrs;
    let changed = false;
    if (!/xmlns\s*=/.test(nextAttrs)) {
      nextAttrs += ` xmlns='http://www.w3.org/1999/xhtml'`;
      changed = true;
    }
    if (!/xmlns:b\s*=/.test(nextAttrs)) {
      nextAttrs += ` xmlns:b='http://www.google.com/2005/gml/b'`;
      changed = true;
    }
    if (!/xmlns:data\s*=/.test(nextAttrs)) {
      nextAttrs += ` xmlns:data='http://www.google.com/2005/gml/data'`;
      changed = true;
    }
    if (!/xmlns:expr\s*=/.test(nextAttrs)) {
      nextAttrs += ` xmlns:expr='http://www.google.com/2005/gml/expr'`;
      changed = true;
    }
    if (changed) {
      fixesApplied.push('Melengkapi namespace XML Blogger (xmlns:b, xmlns:data, xmlns:expr) pada tag <html>');
      return `<html${nextAttrs}>`;
    }
    return full;
  });

  // Step 5: Balance mismatched / unclosed XML tags outside CDATA & comments (quote-aware)
  let balancedCount = 0;
  const finalSegments = segmentXml(out);
  const stack: string[] = [];
  const balancedOut = finalSegments
    .map((seg) => {
      if (seg.type !== 'code') return seg.text;

      return seg.text.replace(/<\/?([a-zA-Z][a-zA-Z0-9:_-]*)((?:\s+(?:"[^"]*"|'[^']*'|[^>"'/]|\/(?!>))*)?)\s*(\/?)>/g, (full, tagName: string, _attrs, slash: string) => {
        const isClosing = full.startsWith('</');
        const isSelfClosing = slash === '/' || (!isClosing && full.slice(0, -1).trimEnd().endsWith('/'));

        if (isSelfClosing) return full;

        if (!isClosing) {
          stack.push(tagName);
          return full;
        }

        let targetPos = -1;
        for (let s = stack.length - 1; s >= 0; s--) {
          if (stack[s] === tagName) {
            targetPos = s;
            break;
          }
        }
        if (targetPos === -1) {
          balancedCount++;
          return '';
        }

        const intermediate = stack.splice(targetPos + 1).reverse();
        stack.pop();
        if (intermediate.length > 0) {
          balancedCount += intermediate.length;
          return `${intermediate.map((t) => `</${t}>`).join('')}${full}`;
        }
        return full;
      });
    })
    .join('');

  out = balancedOut;
  if (stack.length > 0) {
    balancedCount += stack.length;
    out += '\n' + [...stack].reverse().map((t) => `</${t}>`).join('\n');
  }

  if (balancedCount > 0) {
    fixesApplied.push(`Menyeimbangkan ${balancedCount} tag XML yang tidak tertutup atau tidak berpasangan`);
  }

  const validationAfter = validateBloggerXmlOffline(out);

  return {
    fixedXml: out,
    fixesApplied,
    validationAfter,
  };
}

export interface XmlFormatResult {
  formattedXml: string;
  changed: boolean;
  lineCountBefore: number;
  lineCountAfter: number;
  error?: string;
  errorLine?: number;
}

type FormatToken =
  | {
      type: 'pi' | 'comment' | 'cdataRef' | 'openTag' | 'closeTag' | 'selfCloseTag';
      text: string;
      tagName?: string;
      line: number;
    }
  | { type: 'text'; text: string; line: number };

class XmlFormatSyntaxError extends Error {
  line: number;
  constructor(message: string, line: number) {
    super(message);
    this.name = 'XmlFormatSyntaxError';
    this.line = line;
  }
}

const CDATA_PLACEHOLDER_PREFIX = '\uE000TEMALOKA_CDATA_';
const CDATA_PLACEHOLDER_SUFFIX = '\uE001';
const CDATA_PLACEHOLDER_RE = /\uE000TEMALOKA_CDATA_(\d+)\uE001/g;

/**
 * Step 1: Extract every <![CDATA[ ... ]]> (along with optional /* or // wrapper markers)
 * into a placeholder array BEFORE tokenization so internal CSS/JS indentation is never touched.
 */
function extractCdataPlaceholders(xml: string): {
  maskedXml: string;
  placeholders: string[];
} {
  const placeholders: string[] = [];
  let out = '';
  let pos = 0;
  const len = xml.length;

  while (pos < len) {
    const commentStart = xml.indexOf('<!--', pos);
    const cdataStart = xml.indexOf('<![CDATA[', pos);

    if (cdataStart === -1) {
      out += xml.slice(pos);
      break;
    }

    // If an XML comment starts before <![CDATA[, copy the comment verbatim so CDATA text inside comments stays untouched
    if (commentStart !== -1 && commentStart < cdataStart) {
      const commentEnd = xml.indexOf('-->', commentStart + 4);
      if (commentEnd === -1) {
        throw new XmlFormatSyntaxError(
          `Komentar XML "<!--" pada baris ${getLineNumberAt(xml, commentStart)} belum ditutup dengan "-->".`,
          getLineNumberAt(xml, commentStart)
        );
      }
      out += xml.slice(pos, commentEnd + 3);
      pos = commentEnd + 3;
      continue;
    }

    // Check optional /* or // (with optional spaces) right before <![CDATA[
    let rawStart = cdataStart;
    let hasBlockCommentOpen = false;
    const beforeSlice = xml.slice(Math.max(pos, cdataStart - 6), cdataStart);
    const blockOpenMatch = /\/\*\s*$/.exec(beforeSlice);
    const lineOpenMatch = /\/\/\s*$/.exec(beforeSlice);
    if (blockOpenMatch) {
      rawStart = cdataStart - blockOpenMatch[0].length;
      hasBlockCommentOpen = true;
    } else if (lineOpenMatch) {
      rawStart = cdataStart - lineOpenMatch[0].length;
    }

    const cdataClose = xml.indexOf(']]>', cdataStart + 9);
    if (cdataClose === -1) {
      throw new XmlFormatSyntaxError(
        `Blok <![CDATA[ pada baris ${getLineNumberAt(xml, cdataStart)} belum ditutup dengan "]]>".`,
        getLineNumberAt(xml, cdataStart)
      );
    }

    let rawEnd = cdataClose + 3;
    // Include trailing */ if wrapped like /*<![CDATA[*/ ... /*]]>*/ (or /* ]]> */)
    if (hasBlockCommentOpen) {
      const trailBlockClose = /^[ \t]*\*\//.exec(xml.slice(rawEnd, rawEnd + 8));
      if (trailBlockClose) {
        rawEnd += trailBlockClose[0].length;
      }
    }

    out += xml.slice(pos, rawStart);
    const idx = placeholders.length;
    placeholders.push(xml.slice(rawStart, rawEnd));
    out += `${CDATA_PLACEHOLDER_PREFIX}${idx}${CDATA_PLACEHOLDER_SUFFIX}`;
    pos = rawEnd;
  }

  return { maskedXml: out, placeholders };
}

function normalizeTagWhitespace(rawTag: string): string {
  let out = '';
  let quote: '"' | "'" | null = null;
  let pendingSpace = false;

  for (let i = 0; i < rawTag.length; i++) {
    const ch = rawTag[i];
    if (quote) {
      out += ch;
      if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      if (pendingSpace && out.length > 0 && !out.endsWith('<') && !out.endsWith('=')) {
        out += ' ';
      }
      pendingSpace = false;
      quote = ch;
      out += ch;
      continue;
    }

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      pendingSpace = true;
      continue;
    }

    if (ch === '/' && rawTag[i + 1] === '>') {
      pendingSpace = false;
      out += '/>';
      i++;
      continue;
    }

    if (ch === '>') {
      pendingSpace = false;
      out += '>';
      continue;
    }

    if (pendingSpace && out.length > 0 && !out.endsWith('<') && !out.endsWith('=')) {
      out += ' ';
    }
    pendingSpace = false;
    out += ch;
  }

  return out;
}

/**
 * Pure character-by-character quote-aware tokenizer (no DOMParser, no XSLTProcessor, no fragile [^>]* regex).
 */
function tokenizeMaskedXmlForFormat(maskedXml: string): FormatToken[] {
  const tokens: FormatToken[] = [];
  const len = maskedXml.length;
  let i = 0;
  let currentLine = 1;

  const countNewlines = (str: string) => {
    let n = 0;
    for (let k = 0; k < str.length; k++) {
      if (str.charCodeAt(k) === 10) n++;
    }
    return n;
  };

  while (i < len) {
    // Check CDATA placeholder sentinel
    if (maskedXml.startsWith(CDATA_PLACEHOLDER_PREFIX, i)) {
      const endSentinel = maskedXml.indexOf(CDATA_PLACEHOLDER_SUFFIX, i + CDATA_PLACEHOLDER_PREFIX.length);
      if (endSentinel !== -1) {
        const tokText = maskedXml.slice(i, endSentinel + 1);
        tokens.push({ type: 'cdataRef', text: tokText, line: currentLine });
        i = endSentinel + 1;
        continue;
      }
    }

    if (maskedXml[i] === '<') {
      const startLine = currentLine;

      // Processing Instruction <?...?>
      if (maskedXml.startsWith('<?', i)) {
        const closePi = maskedXml.indexOf('?>', i + 2);
        if (closePi === -1) {
          throw new XmlFormatSyntaxError(
            `Deklarasi "<?" pada baris ${startLine} belum ditutup dengan "?>".`,
            startLine
          );
        }
        const rawPi = maskedXml.slice(i, closePi + 2);
        tokens.push({ type: 'pi', text: rawPi.trim(), line: startLine });
        currentLine += countNewlines(rawPi);
        i = closePi + 2;
        continue;
      }

      // XML Comment <!-- ... -->
      if (maskedXml.startsWith('<!--', i)) {
        const closeComment = maskedXml.indexOf('-->', i + 4);
        if (closeComment === -1) {
          throw new XmlFormatSyntaxError(
            `Komentar XML "<!--" pada baris ${startLine} belum ditutup dengan "-->".`,
            startLine
          );
        }
        const rawComment = maskedXml.slice(i, closeComment + 3);
        tokens.push({ type: 'comment', text: rawComment.trim(), line: startLine });
        currentLine += countNewlines(rawComment);
        i = closeComment + 3;
        continue;
      }

      // DOCTYPE <!DOCTYPE ...>
      if (maskedXml.slice(i, i + 9).toUpperCase() === '<!DOCTYPE') {
        let p = i + 9;
        let quote: '"' | "'" | null = null;
        let bracketDepth = 0;
        while (p < len) {
          const c = maskedXml[p];
          if (quote) {
            if (c === quote) quote = null;
          } else if (c === '"' || c === "'") {
            quote = c;
          } else if (c === '[') {
            bracketDepth++;
          } else if (c === ']' && bracketDepth > 0) {
            bracketDepth--;
          } else if (c === '>' && bracketDepth === 0) {
            p++;
            break;
          }
          p++;
        }
        const rawDoc = maskedXml.slice(i, p);
        tokens.push({ type: 'pi', text: rawDoc.trim(), line: startLine });
        currentLine += countNewlines(rawDoc);
        i = p;
        continue;
      }

      // Normal Tag <...> or </...> with full quote-aware scanning ('...' & "...")
      let p = i + 1;
      let quote: '"' | "'" | null = null;
      let closedAt = -1;

      while (p < len) {
        const ch = maskedXml[p];
        if (quote) {
          if (ch === quote) quote = null;
          p++;
          continue;
        }
        if (ch === '"' || ch === "'") {
          quote = ch;
          p++;
          continue;
        }
        if (ch === '>') {
          closedAt = p;
          break;
        }
        if (ch === '<') {
          const snippet = maskedXml.slice(i, Math.min(len, i + 40)).replace(/\s+/g, ' ');
          throw new XmlFormatSyntaxError(
            `Tag "${snippet}" pada baris ${startLine} tidak ditutup dengan ">" sebelum "<" berikutnya.`,
            startLine
          );
        }
        p++;
      }

      if (quote !== null) {
        const snippet = maskedXml.slice(i, Math.min(len, i + 40)).replace(/\s+/g, ' ');
        throw new XmlFormatSyntaxError(
          `Tanda kutip atribut (${quote}) pada tag "${snippet}" di baris ${startLine} belum ditutup.`,
          startLine
        );
      }

      if (closedAt === -1) {
        const snippet = maskedXml.slice(i, Math.min(len, i + 40)).replace(/\s+/g, ' ');
        throw new XmlFormatSyntaxError(
          `Tag "${snippet}" pada baris ${startLine} belum ditutup dengan ">".`,
          startLine
        );
      }

      const rawTag = maskedXml.slice(i, closedAt + 1);
      currentLine += countNewlines(rawTag);
      i = closedAt + 1;

      if (rawTag.startsWith('</')) {
        const nameMatch = /^<\/\s*([a-zA-Z_][a-zA-Z0-9:_-]*)/.exec(rawTag);
        if (!nameMatch) {
          throw new XmlFormatSyntaxError(
            `Tag penutup "${rawTag.trim()}" pada baris ${startLine} tidak valid.`,
            startLine
          );
        }
        tokens.push({
          type: 'closeTag',
          text: `</${nameMatch[1]}>`,
          tagName: nameMatch[1],
          line: startLine,
        });
      } else {
        const nameMatch = /^<\s*([a-zA-Z_][a-zA-Z0-9:_-]*)/.exec(rawTag);
        if (!nameMatch) {
          throw new XmlFormatSyntaxError(
            `Karakter "<" telanjang pada baris ${startLine} bukan tag XML yang valid (gunakan &lt; jika untuk teks).`,
            startLine
          );
        }
        const tagName = nameMatch[1];
        const normalized = normalizeTagWhitespace(rawTag);
        const isSelfClosing = normalized.endsWith('/>');
        tokens.push({
          type: isSelfClosing ? 'selfCloseTag' : 'openTag',
          text: normalized,
          tagName,
          line: startLine,
        });
      }
      continue;
    }

    // Plain text until next '<' or CDATA placeholder sentinel
    const nextLt = maskedXml.indexOf('<', i);
    const nextSent = maskedXml.indexOf(CDATA_PLACEHOLDER_PREFIX, i);
    let stopAt = len;
    if (nextLt !== -1 && nextLt < stopAt) stopAt = nextLt;
    if (nextSent !== -1 && nextSent < stopAt) stopAt = nextSent;

    const textChunk = maskedXml.slice(i, stopAt);
    tokens.push({ type: 'text', text: textChunk, line: currentLine });
    currentLine += countNewlines(textChunk);
    i = stopAt;
  }

  // Convert ONLY unpaired void openTags (e.g. bare <meta ...> or <br>) into selfCloseTag,
  // while keeping explicitly paired void tags (e.g. <img><b:attr .../></img>) intact.
  const openStack: Array<{ tokIdx: number; name: string; isVoid: boolean }> = [];
  for (let tIdx = 0; tIdx < tokens.length; tIdx++) {
    const tok = tokens[tIdx];
    if (tok.type === 'openTag' && tok.tagName) {
      openStack.push({
        tokIdx: tIdx,
        name: tok.tagName,
        isVoid: VOID_TAGS.has(tok.tagName.toLowerCase()),
      });
    } else if (tok.type === 'closeTag' && tok.tagName) {
      let matchPos = -1;
      for (let s = openStack.length - 1; s >= 0; s--) {
        if (openStack[s].name === tok.tagName) {
          matchPos = s;
          break;
        }
      }
      if (matchPos !== -1) {
        const unclosed = openStack.splice(matchPos + 1);
        for (const item of unclosed) {
          if (item.isVoid) {
            const targetTok = tokens[item.tokIdx];
            if (targetTok && targetTok.type === 'openTag') {
              tokens[item.tokIdx] = {
                type: 'selfCloseTag',
                text: targetTok.text.endsWith('/>')
                  ? targetTok.text
                  : `${targetTok.text.slice(0, -1).trimEnd()}/>`,
                tagName: targetTok.tagName,
                line: targetTok.line,
              };
            }
          }
        }
        openStack.pop();
      }
    }
  }
  for (const leftover of openStack) {
    if (leftover.isVoid) {
      const targetTok = tokens[leftover.tokIdx];
      if (targetTok && targetTok.type === 'openTag') {
        tokens[leftover.tokIdx] = {
          type: 'selfCloseTag',
          text: targetTok.text.endsWith('/>')
            ? targetTok.text
            : `${targetTok.text.slice(0, -1).trimEnd()}/>`,
          tagName: targetTok.tagName,
          line: targetTok.line,
        };
      }
    }
  }

  return tokens;
}

const MAJOR_SPACING_TAGS = new Set([
  'head',
  'body',
  'b:skin',
  'b:template-skin',
  'b:defaultmarkups',
  'b:section',
  'footer',
]);

/**
 * 100% Offline Pure Token-Based Blogger XML Prettifier / Formatter.
 * - Zero DOMParser or XSLTProcessor usage
 * - Extracts <![CDATA[ ... ]]> into placeholders first and restores verbatim (untouched internal indentation)
 * - Quote-aware tag parsing ('...' and "...")
 * - Wrapped in try...catch returning informative error + line number without altering editor content
 */
export function formatBloggerXmlOffline(xml: string, indentSize = 2): XmlFormatResult {
  const usesCrlf = xml.includes('\r\n');
  const lineCountBefore = xml.split('\n').length;
  const trimmed = xml.trim();

  if (!trimmed) {
    return {
      formattedXml: xml,
      changed: false,
      lineCountBefore,
      lineCountAfter: lineCountBefore,
    };
  }

  try {
    const indentUnit = ' '.repeat(Math.max(1, indentSize));
    const { maskedXml, placeholders } = extractCdataPlaceholders(trimmed);
    const tokens = tokenizeMaskedXmlForFormat(maskedXml);
    const lines: string[] = [];
    const tagStack: Array<{ name: string; line: number }> = [];

    const pushBlankLineIfNeeded = (tagLower?: string) => {
      if (!tagLower || !MAJOR_SPACING_TAGS.has(tagLower)) return;
      if (lines.length === 0) return;
      const prev = lines[lines.length - 1];
      if (prev !== '') {
        lines.push('');
      }
    };

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      const depth = tagStack.length;

      if (tok.type === 'text') {
        const cleaned = tok.text.replace(/\s+/g, ' ').trim();
        if (!cleaned) continue;
        lines.push(`${indentUnit.repeat(depth)}${cleaned}`);
        continue;
      }

      if (tok.type === 'cdataRef') {
        lines.push(`${indentUnit.repeat(depth)}${tok.text}`);
        continue;
      }

      if (tok.type === 'pi') {
        lines.push(`${indentUnit.repeat(depth)}${tok.text}`);
        continue;
      }

      if (tok.type === 'comment') {
        const commentLines = tok.text.split(/\r?\n/);
        const pad = indentUnit.repeat(depth);
        if (commentLines.length === 1) {
          lines.push(`${pad}${commentLines[0].trim()}`);
        } else {
          commentLines.forEach((cl) => {
            const t = cl.trim();
            lines.push(t ? `${pad}${t}` : '');
          });
        }
        continue;
      }

      if (tok.type === 'selfCloseTag') {
        const lower = tok.tagName?.toLowerCase() || '';
        const effectiveDepth = lower === 'b:else' ? Math.max(0, depth - 1) : depth;
        pushBlankLineIfNeeded(lower);
        lines.push(`${indentUnit.repeat(effectiveDepth)}${tok.text}`);
        continue;
      }

      if (tok.type === 'openTag') {
        const tagName = tok.tagName || '';
        const lower = tagName.toLowerCase();
        pushBlankLineIfNeeded(lower);

        // Pattern 1: <tag>short inline text</tag>
        const t1 = tokens[i + 1];
        const t2 = tokens[i + 2];
        if (
          t1?.type === 'text' &&
          t2?.type === 'closeTag' &&
          t2.tagName === tagName
        ) {
          const inlineText = t1.text.replace(/\s+/g, ' ').trim();
          if (!t1.text.includes('\n') && inlineText.length <= 90) {
            lines.push(`${indentUnit.repeat(depth)}${tok.text}${inlineText}${t2.text}`);
            i += 2;
            continue;
          }
        }

        // Pattern 2: <tag><selfClose/></tag>
        if (
          t1?.type === 'selfCloseTag' &&
          t2?.type === 'closeTag' &&
          t2.tagName === tagName &&
          tok.text.length + t1.text.length + t2.text.length <= 100
        ) {
          lines.push(`${indentUnit.repeat(depth)}${tok.text}${t1.text}${t2.text}`);
          i += 2;
          continue;
        }

        // Pattern 3: Empty <tag></tag>
        if (t1?.type === 'closeTag' && t1.tagName === tagName) {
          lines.push(`${indentUnit.repeat(depth)}${tok.text}${t1.text}`);
          i += 1;
          continue;
        }
        if (
          t1?.type === 'text' &&
          !t1.text.trim() &&
          t2?.type === 'closeTag' &&
          t2.tagName === tagName
        ) {
          lines.push(`${indentUnit.repeat(depth)}${tok.text}${t2.text}`);
          i += 2;
          continue;
        }

        lines.push(`${indentUnit.repeat(depth)}${tok.text}`);
        tagStack.push({ name: tagName, line: tok.line });
        continue;
      }

      if (tok.type === 'closeTag') {
        const closeName = tok.tagName || '';
        const top = tagStack[tagStack.length - 1];
        if (!top) {
          throw new XmlFormatSyntaxError(
            `Tag penutup </${closeName}> pada baris ${tok.line} tidak memiliki pasangan tag pembuka.`,
            tok.line
          );
        }
        if (top.name !== closeName) {
          let matchFound = false;
          for (let s = tagStack.length - 1; s >= 0; s--) {
            if (tagStack[s].name === closeName) {
              matchFound = true;
              break;
            }
          }
          if (matchFound) {
            throw new XmlFormatSyntaxError(
              `Tag <${top.name}> pada baris ${top.line} belum ditutup sebelum </${closeName}> pada baris ${tok.line}.`,
              top.line
            );
          }
          throw new XmlFormatSyntaxError(
            `Tag penutup </${closeName}> pada baris ${tok.line} tidak cocok dengan tag pembuka <${top.name}> (baris ${top.line}).`,
            tok.line
          );
        }
        tagStack.pop();
        lines.push(`${indentUnit.repeat(tagStack.length)}${tok.text}`);
      }
    }

    if (tagStack.length > 0) {
      const unclosed = tagStack[tagStack.length - 1];
      throw new XmlFormatSyntaxError(
        `Tag <${unclosed.name}> pada baris ${unclosed.line} belum ditutup hingga akhir dokumen.`,
        unclosed.line
      );
    }

    const newline = usesCrlf ? '\r\n' : '\n';
    let formattedMasked = lines.join(newline) + newline;

    // Step 4: Restore CDATA blocks verbatim without touching internal indentation
    const formattedXml = formattedMasked.replace(CDATA_PLACEHOLDER_RE, (_, idxStr: string) => {
      const idx = Number.parseInt(idxStr, 10);
      return placeholders[idx] ?? '';
    });

    const lineCountAfter = formattedXml.split('\n').length;

    return {
      formattedXml,
      changed: formattedXml.replace(/\r\n/g, '\n') !== xml.replace(/\r\n/g, '\n'),
      lineCountBefore,
      lineCountAfter,
    };
  } catch (err) {
    const errorLine = err instanceof XmlFormatSyntaxError ? err.line : 1;
    const message =
      err instanceof Error
        ? err.message
        : 'Terjadi kesalahan sintaks saat merapikan XML.';
    return {
      formattedXml: xml,
      changed: false,
      lineCountBefore,
      lineCountAfter: lineCountBefore,
      error: message,
      errorLine,
    };
  }
}

