import type {
  CssJsRedundancyReport,
  DuplicateAssetEntry,
  DuplicateCssRuleEntry,
  UnusedCssRuleEntry,
  UnusedCssVarEntry,
} from '../types/blogger';
import {
  isValidXmlOrHtmlEntityName,
  normalizeHtmlEntitiesForXmlParser,
  type XmlSyntaxIssue,
  type XmlValidationResult,
} from './xmlOfflineTools';

export interface WorkerProgressInfo {
  phase: 'indexing' | 'extracting' | 'analyzing' | 'cleaning' | 'autofix' | 'validating' | 'done';
  percent: number;
  message: string;
  round?: number;
  maxRounds?: number;
}

export interface UnusedJsFunctionEntry {
  id: string;
  name: string;
  line: number;
  params: string;
  preview: string;
  estimatedBytes: number;
  blockIndex: number;
  startInCode: number;
  endInCode: number;
}

export interface AutoDetectedSafelistPrefix {
  prefix: string;
  kind: 'prefix' | 'root' | 'state';
  cssRuleCount: number;
  matchedTokensSample: string[];
  source: 'auto' | 'manual';
}

export interface DeadCleanOptions {
  removeUnusedCssRules: boolean;
  removeUnusedCssVars: boolean;
  removeDeadJsFunctions: boolean;
  removeCssJsComments: boolean;
  removeDuplicateCssRules: boolean;
  removeDuplicateAssets: boolean;
  safelistPrefixes?: string[];
}

export interface DeadCodeAnalysisResult {
  report: CssJsRedundancyReport;
  unusedJsFunctions: UnusedJsFunctionEntry[];
  autoDetectedSafelist: AutoDetectedSafelistPrefix[];
  cssPrefixRuleCounts: Record<string, number>;
  stats: {
    indexedClasses: number;
    indexedIds: number;
    indexedCssVars: number;
    indexedJsRefs: number;
    styleBlocksCount: number;
    scriptBlocksCount: number;
    scanMs: number;
  };
}

export interface RemovedAuditItem {
  kind: 'css-rule' | 'css-var' | 'js-function' | 'dup-css' | 'dup-js';
  name: string;
  line: number;
  reason: string;
  savedBytes: number;
}

export interface DeadCodeCleanResult {
  cleanedXml: string;
  rolledBackToValid: boolean;
  autoFixedAfterClean: boolean;
  validationPassed: boolean;
  parserErrorSummary: string | null;
  stats: {
    originalBytes: number;
    cleanedBytes: number;
    savedBytes: number;
    removedCssRulesCount: number;
    removedCssVarsCount: number;
    removedJsFunctionsCount: number;
    removedDuplicateCssCount: number;
    removedDuplicateJsCount: number;
    removedCommentsCount: number;
    durationMs: number;
  };
  removedItemsSummary: string[];
  removedItemsDetail: RemovedAuditItem[];
  beforeSnippetSample?: string;
  afterSnippetSample?: string;
}

export interface DomParserValidationResult {
  isValid: boolean;
  line: number | null;
  column: number | null;
  message: string | null;
  rawMessage: string | null;
}

export interface IterativeAutoFixResult {
  fixedXml: string;
  fixesApplied: string[];
  roundsExecuted: number;
  validationAfter: XmlValidationResult;
  domParserValid: boolean;
  parserErrorDetail: string | null;
  durationMs: number;
}

export interface WorkerJobHandle<T> {
  promise: Promise<T>;
  cancel: () => void;
}

export const LARGE_FILE_VALIDATION_THRESHOLD_BYTES = 150 * 1024; // 150 KB
export const LARGE_FILE_EDITOR_DOM_THRESHOLD_BYTES = 300 * 1024; // 300 KB

/**
 * Strict Main-Thread XML Validator using DOMParser("text/xml").
 * NEVER uses "text/html" so Blogger tags (<b:section>, viewBox, self-closing) stay intact.
 */
export function validateXmlWithDomParser(xmlString: string): DomParserValidationResult {
  const trimmed = xmlString.trim();
  if (!trimmed) {
    return {
      isValid: false,
      line: 1,
      column: 1,
      message: 'Dokumen XML kosong.',
      rawMessage: 'Empty XML document',
    };
  }

  if (typeof DOMParser === 'undefined') {
    return {
      isValid: true,
      line: null,
      column: null,
      message: null,
      rawMessage: null,
    };
  }

  try {
    const parser = new DOMParser();
    const normalizedForParser = normalizeHtmlEntitiesForXmlParser(xmlString);
    const doc = parser.parseFromString(normalizedForParser, 'text/xml');
    const parserError =
      doc.querySelector('parsererror') || doc.getElementsByTagName('parsererror')[0];

    if (!parserError) {
      return {
        isValid: true,
        line: null,
        column: null,
        message: null,
        rawMessage: null,
      };
    }

    const rawText = (parserError.textContent || 'Kesalahan sintaks XML terdeteksi.').trim();
    const entityErrMatch = /Entity\s+['"]?([a-zA-Z][a-zA-Z0-9]*)['"]?\s+not\s+defined/i.exec(rawText);
    if (entityErrMatch && isValidXmlOrHtmlEntityName(entityErrMatch[1])) {
      return {
        isValid: true,
        line: null,
        column: null,
        message: null,
        rawMessage: null,
      };
    }

    // Extract line and column across Chromium, WebKit, and Firefox formats
    const lineMatch =
      /line\s+number\s+(\d+)/i.exec(rawText) ||
      /line\s+(\d+)/i.exec(rawText) ||
      /lineNumber\s*[:=]\s*(\d+)/i.exec(rawText);
    const colMatch =
      /column\s+(\d+)/i.exec(rawText) ||
      /columnNumber\s*[:=]\s*(\d+)/i.exec(rawText);

    const line = lineMatch ? Number.parseInt(lineMatch[1], 10) : 1;
    const column = colMatch ? Number.parseInt(colMatch[1], 10) : null;

    const cleanMsg = rawText
      .replace(/This page contains the following errors:/gi, '')
      .replace(/Below is a rendering of the page up to the first error\.?/gi, '')
      .replace(/XML Parsing Error:\s*/gi, '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && !/^Location:/i.test(s) && !/^[-^]+$/.test(s))
      .slice(0, 2)
      .join(' — ');

    return {
      isValid: false,
      line: Number.isFinite(line) ? line : 1,
      column: column && Number.isFinite(column) ? column : null,
      message: cleanMsg || 'Sintaks XML tidak valid menurut DOMParser("text/xml").',
      rawMessage: rawText,
    };
  } catch (err) {
    return {
      isValid: false,
      line: 1,
      column: null,
      message: err instanceof Error ? err.message : 'Gagal mem-parsing XML.',
      rawMessage: err instanceof Error ? err.message : null,
    };
  }
}

/**
 * Pure Vanilla JS Worker Source executed inside an Inline Blob Web Worker.
 * Zero external CDN dependencies, single-pass O(1) Set() indexing, CDATA isolation,
 * brace-aware CSS & top-level JS parsing, and iterative Auto-Fix round execution.
 */
const INLINE_WORKER_SOURCE = `
'use strict';

var VOID_TAGS = new Set([
  'area','base','br','col','embed','hr','img','input',
  'link','meta','param','source','track','wbr'
]);

var BOOLEAN_XHTML_ATTRS = [
  'async','defer','crossorigin','nomodule','disabled','checked','readonly','required',
  'selected','multiple','novalidate','hidden','controls','autoplay','loop','muted'
];

function fixBareBooleanAttrsWorker(attrs) {
  var fixedCount = 0;
  var out = '';
  var i = 0;
  var len = attrs.length;
  var boolWordRe = new RegExp('^(' + BOOLEAN_XHTML_ATTRS.join('|') + ')(?=\\\\s|$)(?!\\\\s*=)', 'i');

  while (i < len) {
    var ch = attrs[i];
    if (ch === '"' || ch === "'") {
      var closeQ = attrs.indexOf(ch, i + 1);
      if (closeQ === -1) { out += attrs.slice(i); break; }
      out += attrs.slice(i, closeQ + 1);
      i = closeQ + 1;
      continue;
    }
    if (/\\s/.test(ch)) {
      var wsEnd = i;
      while (wsEnd < len && /\\s/.test(attrs[wsEnd])) wsEnd++;
      out += attrs.slice(i, wsEnd);
      i = wsEnd;
      if (i < len && attrs[i] !== '"' && attrs[i] !== "'") {
        var m = boolWordRe.exec(attrs.slice(i));
        if (m) {
          var prevChar = out.length > 0 ? out[out.length - 1] : '';
          if (!prevChar || /\\s/.test(prevChar)) {
            var name = m[1];
            var lower = name.toLowerCase();
            out += lower === 'crossorigin' ? name + "='anonymous'" : name + "='" + lower + "'";
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
  return { updatedAttrs: out, fixedCount: fixedCount };
}

var BLOGGER_RUNTIME_CLASSES = new Set([
  'post','posts','post-outer','post-title','post-body','post-header','post-footer',
  'post-meta','post-thumb','post-summary','entry-title','entry-content','blog-posts',
  'hfeed','hentry','jump-link','widget','widget-content','widget-item-control',
  'quickedit','titlewrapper','descriptionwrapper','status-msg-wrap','status-msg-body',
  'blog-pager','blog-pager-older-link','blog-pager-newer-link','home-link','feed-links',
  'popular-posts','item-thumbnail','item-title','item-snippet','list-label-widget-content',
  'label-size','comments','comment-block','comment-thread','navbar','no-items',
  'clear','clearfix','header','pagelist','blog','label','popularposts','profile',
  'blogsearch','featuredpost','attribution','adsense','html','selected','active'
]);

var JS_KEYWORDS = new Set([
  'break','case','catch','class','const','continue','debugger','default','delete',
  'do','else','export','extends','finally','for','function','if','import','in',
  'instanceof','let','new','return','super','switch','this','throw','try','typeof',
  'var','void','while','with','yield','async','await','true','false','null','undefined',
  'of','static','get','set'
]);

var STATE_THEME_CLASS_KEYS = [
  'active', 'show', 'open', 'close', 'hide', 'hidden', 'lock', 'selected', 'disabled', 'dark', 'drkm'
];

var STATE_THEME_DISPLAY_MAP = {
  drkm: 'drkM'
};

function matchesPrefixToken(clsLower, rawPrefix) {
  var p = String(rawPrefix || '').trim().replace(/^\\.+/, '').toLowerCase();
  if (!p) return false;
  if (p.endsWith('-') || p.endsWith('_')) {
    return clsLower.indexOf(p) === 0 || clsLower.indexOf(p) !== -1;
  }
  return (
    clsLower === p ||
    clsLower.indexOf(p + '-') === 0 ||
    clsLower.indexOf(p + '_') === 0 ||
    clsLower.indexOf('-' + p) !== -1 ||
    clsLower.indexOf('_' + p) !== -1 ||
    clsLower.indexOf(p) === 0 ||
    (p.length >= 4 && clsLower.indexOf(p) !== -1)
  );
}

function isSafelistedClassToken(clsLower, activeSafelistPrefixes) {
  if (activeSafelistPrefixes && activeSafelistPrefixes.length > 0) {
    for (var p = 0; p < activeSafelistPrefixes.length; p++) {
      if (matchesPrefixToken(clsLower, activeSafelistPrefixes[p])) {
        return true;
      }
    }
  }
  return BLOGGER_RUNTIME_CLASSES.has(clsLower);
}

function isSafelistedCssSelector(selectorGroup) {
  if (/\\[(?:data-|aria-)/i.test(selectorGroup)) return true;
  return false;
}

function postProgress(phase, percent, message, extra) {
  var payload = { type: 'progress', phase: phase, percent: percent, message: message };
  if (extra) {
    for (var k in extra) {
      if (Object.prototype.hasOwnProperty.call(extra, k)) payload[k] = extra[k];
    }
  }
  self.postMessage(payload);
}

function buildLineStarts(source) {
  var starts = [0];
  for (var i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function lineAtOffset(lineStarts, index) {
  var lo = 0;
  var hi = lineStarts.length - 1;
  while (lo <= hi) {
    var mid = (lo + hi) >> 1;
    if (lineStarts[mid] <= index) lo = mid + 1;
    else hi = mid - 1;
  }
  return lo < 1 ? 1 : lo;
}

function getAttrValue(attrString, attrName) {
  var re = new RegExp('\\\\b' + attrName + '\\\\s*=\\\\s*(?:"([^"]*)"|\\'([^\\']*)\\')', 'i');
  var m = re.exec(attrString);
  return m ? (m[1] !== undefined ? m[1] : (m[2] || '')) : '';
}

function normalizeAssetUrl(raw) {
  return String(raw || '').trim().replace(/&amp;/g, '&').replace(/^https?:\\/\\//i, '//').replace(/\\/$/, '');
}

function extractLibrarySignature(url) {
  var clean = url.split('?')[0].split('#')[0].toLowerCase();
  if (/jquery(?:[-.]\\d[\\d.]*)?(?:\\.slim)?(?:\\.min)?\\.js$/i.test(clean)) return 'jquery.js';
  if (/adsbygoogle\\.js$/i.test(clean)) return 'google-adsense.js';
  if (/googletagmanager\\.com\\/gtag\\/js/i.test(url)) return 'google-gtag.js';
  if (/googletagmanager\\.com\\/gtm\\.js/i.test(url)) return 'google-gtm.js';
  if (/font-?awesome|fontawesome/i.test(clean) && /\\.css$/i.test(clean)) return 'font-awesome.css';
  if (/bootstrap(?:\\.min)?\\.css$/i.test(clean)) return 'bootstrap.css';
  if (/bootstrap(?:\\.bundle)?(?:\\.min)?\\.js$/i.test(clean)) return 'bootstrap.js';
  if (/animate(?:\\.min)?\\.css$/i.test(clean)) return 'animate.css';
  if (/lazysizes(?:\\.min)?\\.js$/i.test(clean)) return 'lazysizes.js';
  if (/swiper(?:-bundle)?(?:\\.min)?\\.(?:js|css)$/i.test(clean)) {
    return clean.endsWith('.css') ? 'swiper.css' : 'swiper.js';
  }
  var fm = /\\/([a-z0-9._-]+?\\.(?:min\\.)?(?:js|css))$/i.exec(clean);
  if (!fm) return null;
  var fname = fm[1].replace(/[-.@]v?\\d[\\d.]*/gi, '');
  if (fname.length < 6 || fname === 'style.css' || fname === 'main.js' || fname === 'bundle.js') return null;
  return fname;
}

// ============================================================
// 1. BLOCK ISOLATION & CDATA TOKENIZATION (NO RAW XML REGEX)
// ============================================================

function extractCodeBlocks(xml) {
  var blocks = [];
  // Skip XML comments so commented-out blocks are never modified
  var blockRegex = /<!--([\\s\\S]*?)-->|<(b:skin|b:template-skin|style|script)\\b((?:"[^"]*"|'[^']*'|[^>"'\\/]|\\/(?!>))*)>([\\s\\S]*?)<\\/\\2>/gi;
  var m;
  while ((m = blockRegex.exec(xml)) !== null) {
    if (m[1] !== undefined) continue; // XML comment
    var tagName = m[2];
    var attrs = m[3] || '';
    var inner = m[4] || '';
    var fullStart = m.index;
    var fullEnd = m.index + m[0].length;
    var openTagEnd = fullStart + m[0].indexOf('>') + 1;
    var closeTagStart = fullEnd - ('</' + tagName + '>').length;
    blocks.push({
      tagName: tagName,
      lowerTag: tagName.toLowerCase(),
      attrs: attrs,
      inner: inner,
      fullStart: fullStart,
      fullEnd: fullEnd,
      innerStart: openTagEnd,
      innerEnd: closeTagStart,
      rawFull: m[0]
    });
  }
  return blocks;
}

function splitCdataWrapper(inner) {
  // Separates leading & trailing CDATA tokens cleanly so comment/code cleaning never touches them
  var leadRe = /^(\\s*(?:\\/\\*|\\/\\/)?\\s*<!\\[CDATA\\[(?:\\*\\/)?[ \\t]*\\r?\\n?)/i;
  var trailRe = /(\\r?\\n?[ \\t]*(?:\\/\\*|\\/\\/)?\\s*\\]\\]>(?:\\*\\/)?\\s*)$/i;
  var lm = leadRe.exec(inner);
  var prefix = lm ? lm[1] : '';
  var rest = prefix ? inner.slice(prefix.length) : inner;
  var tm = trailRe.exec(rest);
  var suffix = tm ? tm[1] : '';
  var pureCode = suffix ? rest.slice(0, rest.length - suffix.length) : rest;

  // Verify balance if prefix or suffix is partial
  if ((prefix && !suffix) || (!prefix && suffix)) {
    // Only split balanced outer wrapper if both open & close exist, otherwise handle inside pureCode carefully
    var openIdx = inner.indexOf('<![CDATA[');
    var closeIdx = inner.lastIndexOf(']]>');
    if (openIdx !== -1 && closeIdx > openIdx) {
      var startAdj = openIdx;
      if (inner.slice(Math.max(0, openIdx - 2), openIdx) === '/*') startAdj = openIdx - 2;
      else if (inner.slice(Math.max(0, openIdx - 2), openIdx) === '//') startAdj = openIdx - 2;
      var wsStart = startAdj;
      while (wsStart > 0 && (inner[wsStart - 1] === ' ' || inner[wsStart - 1] === '\\t' || inner[wsStart - 1] === '\\n' || inner[wsStart - 1] === '\\r')) {
        wsStart--;
      }
      var openEnd = openIdx + 9;
      if (inner.slice(openEnd, openEnd + 2) === '*/') openEnd += 2;
      if (inner[openEnd] === '\\r') openEnd++;
      if (inner[openEnd] === '\\n') openEnd++;

      var closeStart = closeIdx;
      if (inner.slice(Math.max(0, closeStart - 2), closeStart) === '/*') closeStart -= 2;
      else if (inner.slice(Math.max(0, closeStart - 2), closeStart) === '//') closeStart -= 2;
      if (closeStart > openEnd && inner[closeStart - 1] === '\\n') closeStart--;
      if (closeStart > openEnd && inner[closeStart - 1] === '\\r') closeStart--;

      var closeEnd = closeIdx + 3;
      if (inner.slice(closeEnd, closeEnd + 2) === '*/') closeEnd += 2;
      while (closeEnd < inner.length && (inner[closeEnd] === ' ' || inner[closeEnd] === '\\t' || inner[closeEnd] === '\\n' || inner[closeEnd] === '\\r')) {
        closeEnd++;
      }

      if (wsStart === 0 && closeEnd === inner.length) {
        return {
          hasCdata: true,
          prefix: inner.slice(0, openEnd),
          pureCode: inner.slice(openEnd, closeStart),
          suffix: inner.slice(closeStart)
        };
      }
    }
    return { hasCdata: false, prefix: '', pureCode: inner, suffix: '' };
  }

  return {
    hasCdata: Boolean(prefix && suffix),
    prefix: prefix,
    pureCode: pureCode,
    suffix: suffix
  };
}

// ============================================================
// 2. SINGLE-PASS O(1) SET() INDEXING OF REFERENCES
// ============================================================

function addTokensFromString(targetSet, str, secondarySet) {
  if (!str) return;
  var parts = str.split(/[\\s'"?:+&|(),;{}\\[\\]]+/);
  for (var i = 0; i < parts.length; i++) {
    var clean = parts[i].trim().toLowerCase();
    if (clean && /^[a-z_-][a-z0-9_-]*$/i.test(clean)) {
      targetSet.add(clean);
      if (secondarySet) secondarySet.add(clean);
    }
  }
}

function extractStemPrefixesFromDynamicStr(str, stemSet) {
  if (!str || !stemSet) return;
  var stemRe = /(?:^|[\\s'"\`+&|(:])([a-zA-Z][a-zA-Z0-9]{0,14}[-_])(?:[$][{]|['"\`]\\s*\\+|\\s*\\+)/g;
  var sm;
  while ((sm = stemRe.exec(str)) !== null) {
    stemSet.add(sm[1].toLowerCase());
  }
}

function collectJsSelectorsAndRefs(
  jsCode,
  usedClasses,
  usedIds,
  usedCssVars,
  usedJsRefs,
  dynamicClasses,
  dynamicPrefixStems,
  dynamicState
) {
  if (!jsCode) return;

  // 1. querySelector / querySelectorAll / closest / matches / $ / jQuery
  var selCallRe = /(?:querySelector(?:All)?|closest|matches|\\$|jQuery)\\s*\\(\\s*(['"\`])([^'"\`]{1,240})\\1/g;
  var m;
  while ((m = selCallRe.exec(jsCode)) !== null) {
    var selStr = m[2];
    var cm = selStr.match(/\\.[a-zA-Z_-][a-zA-Z0-9_-]*/g);
    if (cm) {
      for (var i = 0; i < cm.length; i++) {
        var cLow = cm[i].slice(1).toLowerCase();
        usedClasses.add(cLow);
        dynamicClasses.add(cLow);
      }
    }
    extractStemPrefixesFromDynamicStr(selStr, dynamicPrefixStems);
    var im = selStr.match(/#[a-zA-Z_-][a-zA-Z0-9_-]*/g);
    if (im) {
      for (var j = 0; j < im.length; j++) usedIds.add(im[j].slice(1).toLowerCase());
    }
  }

  // 2. getElementById / getElementsByClassName / classList.* / setAttribute('class'|'id') / jQuery *Class
  var byIdRe = /getElementById\\s*\\(\\s*(['"\`])([a-zA-Z0-9_-]+)\\1/g;
  while ((m = byIdRe.exec(jsCode)) !== null) {
    usedIds.add(m[2].toLowerCase());
  }

  var byClsRe = /getElementsByClassName\\s*\\(\\s*(['"\`])([^'"\`]+)\\1/g;
  while ((m = byClsRe.exec(jsCode)) !== null) {
    addTokensFromString(usedClasses, m[2], dynamicClasses);
  }

  var classListRe = /classList\\.(?:add|remove|toggle|contains|replace)\\s*\\(([^)]{1,240})\\)/g;
  while ((m = classListRe.exec(jsCode)) !== null) {
    dynamicState.hasJsClassManipulation = true;
    extractStemPrefixesFromDynamicStr(m[1], dynamicPrefixStems);
    var argStrs = m[1].match(/(['"\`])([a-zA-Z0-9_\\s-]+)\\1/g);
    if (argStrs) {
      for (var k = 0; k < argStrs.length; k++) {
        addTokensFromString(usedClasses, argStrs[k].slice(1, -1), dynamicClasses);
      }
    }
  }

  var jqClassRe = /\\.(?:addClass|removeClass|toggleClass|hasClass)\\s*\\(([^)]{1,200})\\)/g;
  while ((m = jqClassRe.exec(jsCode)) !== null) {
    dynamicState.hasJsClassManipulation = true;
    extractStemPrefixesFromDynamicStr(m[1], dynamicPrefixStems);
    var jqArgs = m[1].match(/(['"\`])([a-zA-Z0-9_\\s-]+)\\1/g);
    if (jqArgs) {
      for (var jk = 0; jk < jqArgs.length; jk++) {
        addTokensFromString(usedClasses, jqArgs[jk].slice(1, -1), dynamicClasses);
      }
    }
  }

  var classNameAssignRe = /(?:className\\s*(?:=|\\+=)|\\.id\\s*=|setAttribute\\s*\\(\\s*['"](?:class|id)['"]\\s*,)([^;\\n]{1,360})/g;
  while ((m = classNameAssignRe.exec(jsCode)) !== null) {
    var assignRhs = m[1];
    var isIdTarget = /\\.id\\s*=|['"]id['"]\\s*,/i.test(m[0]);
    if (!isIdTarget) {
      dynamicState.hasJsClassManipulation = true;
      extractStemPrefixesFromDynamicStr(assignRhs, dynamicPrefixStems);
    }
    var litRe = /(['"\`])([^'"\`]{1,240})\\1/g;
    var lm;
    while ((lm = litRe.exec(assignRhs)) !== null) {
      if (isIdTarget) addTokensFromString(usedIds, lm[2]);
      else addTokensFromString(usedClasses, lm[2], dynamicClasses);
    }
  }

  // 3. String / template literals referencing .class, #id, HTML class="...", innerHTML/insertAdjacentHTML, & interpolations
  var dotHashLitRe = /(?:['"\`\\s(,[])([.#])([a-zA-Z_-][a-zA-Z0-9_-]{1,})/g;
  while ((m = dotHashLitRe.exec(jsCode)) !== null) {
    if (m[1] === '.') {
      var dc = m[2].toLowerCase();
      usedClasses.add(dc);
      dynamicClasses.add(dc);
    } else {
      usedIds.add(m[2].toLowerCase());
    }
  }

  // Stem prefixes before template interpolation or '+' concat inside JS (e.g. 'mk-' + id)
  var concatStemRe = /(['"\`])([a-zA-Z][a-zA-Z0-9]{0,14}[-_])\\1\\s*\\+/g;
  while ((m = concatStemRe.exec(jsCode)) !== null) {
    dynamicPrefixStems.add(m[2].toLowerCase());
  }

  // Capture class="..." or class='...' AND dynamic template expressions inside template literals
  var htmlInJsClassRe = /\\bclass\\s*=\\s*(?:"([^"\\n]{1,320})"|'([^'\\n]{1,320})')/gi;
  while ((m = htmlInJsClassRe.exec(jsCode)) !== null) {
    dynamicState.hasJsClassManipulation = true;
    var clsTpl = m[1] !== undefined ? m[1] : m[2];
    extractStemPrefixesFromDynamicStr(clsTpl, dynamicPrefixStems);
    addTokensFromString(usedClasses, clsTpl.replace(/[$][{][^}]*[}]/g, ' '), dynamicClasses);
  }
  var tplWithHtmlRe = /\`([^\`]{1,8000})\`/g;
  while ((m = tplWithHtmlRe.exec(jsCode)) !== null) {
    var tplBody = m[1];
    if (!/(?:class|id)\\s*=|classList|querySelector/i.test(tplBody)) continue;
    dynamicState.hasJsClassManipulation = true;
    extractStemPrefixesFromDynamicStr(tplBody, dynamicPrefixStems);
    var tplClsRe = /\\bclass\\s*=\\s*(?:"([^"]*)"|'([^']*)')/gi;
    var tcm;
    while ((tcm = tplClsRe.exec(tplBody)) !== null) {
      var rawTCls = tcm[1] !== undefined ? tcm[1] : tcm[2];
      addTokensFromString(usedClasses, rawTCls.replace(/[$][{][^}]*[}]/g, ' '), dynamicClasses);
    }
    var tplIdRe = /\\bid\\s*=\\s*(?:"([^"]*)"|'([^']*)')/gi;
    var tim;
    while ((tim = tplIdRe.exec(tplBody)) !== null) {
      var rawTId = tim[1] !== undefined ? tim[1] : tim[2];
      addTokensFromString(usedIds, rawTId.replace(/[$][{][^}]*[}]/g, ' '));
    }
    var interpAllRe = /[$][{]([^}]{1,240})[}]/g;
    var imAll;
    while ((imAll = interpAllRe.exec(tplBody)) !== null) {
      var qToks = imAll[1].match(/['"]([a-zA-Z_-][a-zA-Z0-9_\\s-]{0,120})['"]/g);
      if (qToks) {
        for (var qt = 0; qt < qToks.length; qt++) {
          addTokensFromString(usedClasses, qToks[qt].slice(1, -1), dynamicClasses);
        }
      }
    }
  }

  var htmlInJsIdRe = /\\bid\\s*=\\s*(?:"([^"\\n]{1,180})"|'([^'\\n]{1,180})')/gi;
  while ((m = htmlInJsIdRe.exec(jsCode)) !== null) {
    var idTpl = m[1] !== undefined ? m[1] : m[2];
    addTokensFromString(usedIds, idTpl.replace(/[$][{][^}]*[}]/g, ' '));
  }

  // Capture inline event handlers generated inside JS strings / backticks (e.g. onclick="namaFungsi()")
  var inlineJsHandlerInStrRe = /\\bon(?:click|change|input|submit|focus|blur|keydown|keyup|keypress|mouseover|mouseenter|mouseleave|load|error)\\s*=\\s*(?:\\\\?["'])([^"'\\n]{1,220})/gi;
  while ((m = inlineJsHandlerInStrRe.exec(jsCode)) !== null) {
    var hCallRe = /\\b([a-zA-Z_$][a-zA-Z0-9_$]*)\\b/g;
    var hm;
    while ((hm = hCallRe.exec(m[1])) !== null) {
      if (!JS_KEYWORDS.has(hm[1])) {
        usedJsRefs.set(hm[1], (usedJsRefs.get(hm[1]) || 0) + 2);
      }
    }
  }

  // 4. CSS Variable manipulation in JS: setProperty('--x'), getPropertyValue('--x'), '--x'
  var jsCssVarRe = /['"\`](--[a-zA-Z0-9_-]+)['"\`]/g;
  while ((m = jsCssVarRe.exec(jsCode)) !== null) {
    usedCssVars.add(m[1]);
  }

  // 5. All identifier occurrences in comment-stripped JS for accurate dead function detection
  var codeNoComments = stripJsCommentsSafely(jsCode).code;
  var identRe = /\\b([a-zA-Z_$][a-zA-Z0-9_$]*)\\b/g;
  while ((m = identRe.exec(codeNoComments)) !== null) {
    var tok = m[1];
    if (!JS_KEYWORDS.has(tok)) {
      usedJsRefs.set(tok, (usedJsRefs.get(tok) || 0) + 1);
    }
  }
}

function buildDocumentReferenceIndex(xml, blocks) {
  var usedClasses = new Set(BLOGGER_RUNTIME_CLASSES);
  var usedIds = new Set();
  var usedCssVars = new Set();
  var usedJsRefs = new Map(); // name -> total occurrence count across HTML attrs + JS
  var dynamicClasses = new Set();
  var dynamicPrefixStems = new Set();
  var dynamicState = { hasJsClassManipulation: false };

  // Build markup string excluding <b:skin>, <b:template-skin>, <style> in a single O(N) pass
  var markupParts = [];
  var cursor = 0;
  var scriptBlocks = [];
  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i];
    if (b.lowerTag === 'script') {
      scriptBlocks.push(b);
      continue;
    }
    if (b.fullStart > cursor) markupParts.push(xml.slice(cursor, b.fullStart));
    cursor = b.fullEnd;
  }
  if (cursor < xml.length) markupParts.push(xml.slice(cursor));
  var markup = markupParts.join(' ').replace(/<!--([\\s\\S]*?)-->/g, '');

  function decodeEntities(val) {
    if (!val) return '';
    return val
      .replace(/&quot;/g, '"')
      .replace(/&#0*39;|&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  // 1. HTML & XML class vs dynamic expr:class (match raw markup BEFORE entity unescaping so &quot; never truncates "...")
  var staticClassAttrRe = /\\bclass\\s*=\\s*(?:"([^"]*)"|'([^']*)')/gi;
  var m;
  while ((m = staticClassAttrRe.exec(markup)) !== null) {
    var prevChar = m.index > 0 ? markup[m.index - 1] : ' ';
    if (prevChar === ':') continue; // handled below as expr:class
    addTokensFromString(usedClasses, decodeEntities(m[1] !== undefined ? m[1] : m[2]));
  }
  var exprClassAttrRe = /\\bexpr:class\\s*=\\s*(?:"([^"]*)"|'([^']*)')/gi;
  while ((m = exprClassAttrRe.exec(markup)) !== null) {
    var exprClsVal = decodeEntities(m[1] !== undefined ? m[1] : m[2]);
    dynamicState.hasJsClassManipulation = true;
    extractStemPrefixesFromDynamicStr(exprClsVal, dynamicPrefixStems);
    addTokensFromString(usedClasses, exprClsVal, dynamicClasses);
  }

  // 2. HTML & XML id / expr:id / for / aria-labelledby / aria-describedby / href="#..."
  var idAttrRe = /\\b(?:expr:id|id|for|aria-labelledby|aria-describedby)\\s*=\\s*(?:"([^"]*)"|'([^']*)')/gi;
  while ((m = idAttrRe.exec(markup)) !== null) {
    addTokensFromString(usedIds, decodeEntities(m[1] !== undefined ? m[1] : m[2]));
  }
  var hashHrefRe = /\\bhref\\s*=\\s*(?:"([^"]*#[^"]*)"|'([^']*#[^']*)')/gi;
  while ((m = hashHrefRe.exec(markup)) !== null) {
    var hrefVal = decodeEntities(m[1] !== undefined ? m[1] : m[2]);
    var hIdx = hrefVal.indexOf('#');
    if (hIdx !== -1) addTokensFromString(usedIds, hrefVal.slice(hIdx + 1));
  }

  // 3. Blogger <b:class>, <b:attr>, <b:if cond>, <b:with>, <b:elseif cond>, <b:loop> (quote-aware)
  var bClassRe = /<b:(?:class|attr)\\b((?:"[^"]*"|'[^']*'|[^>"'])*)\\/?>/gi;
  while ((m = bClassRe.exec(markup)) !== null) {
    var attrs = m[1];
    var nameVal = decodeEntities(getAttrValue(attrs, 'name') || getAttrValue(attrs, 'expr:name'));
    var exprVal = decodeEntities(getAttrValue(attrs, 'value') || getAttrValue(attrs, 'expr:value') || getAttrValue(attrs, 'cond'));
    if (nameVal && nameVal.toLowerCase() === 'id') {
      addTokensFromString(usedIds, exprVal);
    } else {
      dynamicState.hasJsClassManipulation = true;
      extractStemPrefixesFromDynamicStr((nameVal || '') + ' ' + (exprVal || ''), dynamicPrefixStems);
      addTokensFromString(usedClasses, (nameVal || '') + ' ' + (exprVal || ''), dynamicClasses);
    }
  }

  // Extract string literals inside Blogger <b:if cond='...'> / <b:with value='...'> / <b:loop> / expr:*
  var condExprRe = /\\b(?:cond|expr:[a-zA-Z0-9_-]+|value)\\s*=\\s*(?:"([^"]*)"|'([^']*)')/gi;
  while ((m = condExprRe.exec(markup)) !== null) {
    var expr = decodeEntities(m[1] !== undefined ? m[1] : m[2]);
    var quotedRe = /(['"])([a-zA-Z_-][a-zA-Z0-9_\\s-]{1,80})\\1/g;
    var qm;
    while ((qm = quotedRe.exec(expr)) !== null) {
      addTokensFromString(usedClasses, qm[2], dynamicClasses);
    }
  }

  // 4. Inline HTML event handlers & javascript: links for JS function whitelist
  var onEventRe = /\\b(?:expr:)?(?:on[a-z]+)\\s*=\\s*(?:"([^"]*)"|'([^']*)')/gi;
  while ((m = onEventRe.exec(markup)) !== null) {
    var handlerCode = decodeEntities(m[1] !== undefined ? m[1] : m[2]);
    var idRe = /\\b([a-zA-Z_$][a-zA-Z0-9_$]*)\\b/g;
    var im;
    while ((im = idRe.exec(handlerCode)) !== null) {
      if (!JS_KEYWORDS.has(im[1])) {
        usedJsRefs.set(im[1], (usedJsRefs.get(im[1]) || 0) + 2);
      }
    }
  }
  var jsHrefRe = /\\bhref\\s*=\\s*(?:"javascript:([^"]*)"|'javascript:([^']*)')/gi;
  while ((m = jsHrefRe.exec(markup)) !== null) {
    var jCode = decodeEntities(m[1] !== undefined ? m[1] : m[2]);
    var idRe2 = /\\b([a-zA-Z_$][a-zA-Z0-9_$]*)\\b/g;
    var im2;
    while ((im2 = idRe2.exec(jCode)) !== null) {
      if (!JS_KEYWORDS.has(im2[1])) {
        usedJsRefs.set(im2[1], (usedJsRefs.get(im2[1]) || 0) + 2);
      }
    }
  }

  // 5. Single-pass scan for var(--...) anywhere in XML (CSS, inline style, etc.)
  var varCallRe = /var\\(\\s*(--[a-zA-Z0-9_-]+)/g;
  while ((m = varCallRe.exec(xml)) !== null) {
    usedCssVars.add(m[1]);
  }

  // 6. Scan <script> blocks for DOM selectors, CSS vars, dynamic prefixes, & JS identifier refs
  for (var s = 0; s < scriptBlocks.length; s++) {
    var sb = scriptBlocks[s];
    if (/\\btype\\s*=\\s*['"]application\\/ld\\+json['"]/i.test(sb.attrs)) continue;
    var cdataSplit = splitCdataWrapper(sb.inner);
    collectJsSelectorsAndRefs(
      cdataSplit.pureCode,
      usedClasses,
      usedIds,
      usedCssVars,
      usedJsRefs,
      dynamicClasses,
      dynamicPrefixStems,
      dynamicState
    );
  }

  return {
    usedClasses: usedClasses,
    usedIds: usedIds,
    usedCssVars: usedCssVars,
    usedJsRefs: usedJsRefs,
    dynamicClasses: dynamicClasses,
    dynamicPrefixStems: dynamicPrefixStems,
    hasJsClassManipulation: dynamicState.hasJsClassManipulation
  };
}

// ============================================================
// 3. STRUCTURED BRACE-AWARE CSS PARSER & VAR GRAPH
// ============================================================

function stripCssCommentsSafely(cssCode) {
  var out = [];
  var i = 0;
  var len = cssCode.length;
  var quote = null;
  var strippedCount = 0;

  while (i < len) {
    var ch = cssCode[i];
    if (quote) {
      out.push(ch);
      if (ch === '\\\\' && i + 1 < len) {
        out.push(cssCode[i + 1]);
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out.push(ch);
      i++;
      continue;
    }
    if (ch === '/' && cssCode[i + 1] === '*') {
      var closeIdx = cssCode.indexOf('*/', i + 2);
      if (closeIdx === -1) {
        out.push(cssCode.slice(i));
        break;
      }
      var commentText = cssCode.slice(i, closeIdx + 2);
      // Preserve Blogger template identity / metadata / CDATA comments / important /*! license comments
      if (
        commentText.indexOf('/*!') === 0 ||
        /Template\\s*Name\\s*:|Author\\s*:|<Variable\\b|<b:variable\\b|<Group\\b|<!\\[CDATA\\[|\\]\\]>/i.test(commentText)
      ) {
        out.push(commentText);
      } else {
        // Keep newlines to preserve line count stability when needed
        strippedCount++;
        out.push(' ');
      }
      i = closeIdx + 2;
      continue;
    }
    out.push(ch);
    i++;
  }
  return { code: out.join(''), strippedCount: strippedCount };
}

function maskCssForBraceParse(cssCode) {
  // Replaces CSS comments and Blogger <Group>/<Variable> XML tags with spaces of equal length so offsets align 1:1
  var chars = cssCode.split('');
  var len = chars.length;
  var i = 0;
  var quote = null;

  while (i < len) {
    var ch = chars[i];
    if (quote) {
      if (ch === '\\\\') { i += 2; continue; }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      i++;
      continue;
    }
    if (ch === '/' && chars[i + 1] === '*') {
      var closeIdx = cssCode.indexOf('*/', i + 2);
      var end = closeIdx === -1 ? len : closeIdx + 2;
      for (var k = i; k < end; k++) {
        if (chars[k] !== '\\n') chars[k] = ' ';
      }
      i = end;
      continue;
    }
    i++;
  }

  var masked = chars.join('');
  masked = masked
    .replace(/<Group\\b[\\s\\S]*?<\\/Group>/gi, function(m) { return m.replace(/[^\\n]/g, ' '); })
    .replace(/<(?:Variable|b:variable)\\b(?:"[^"]*"|'[^']*'|[^>"'])*(?:\\/>|>[\\s\\S]*?<\\/(?:Variable|b:variable)>)/gi, function(m) { return m.replace(/[^\\n]/g, ' '); });

  return masked;
}

function parseCssRulesStructured(pureCss, baseOffsetInXml, lineStarts, sourceTag) {
  var rules = [];
  var masked = maskCssForBraceParse(pureCss);
  var len = masked.length;

  function skipWs(from, limit) {
    var p = from;
    while (p < limit) {
      var c = masked.charCodeAt(p);
      if (c === 32 || c === 9 || c === 10 || c === 13) p++;
      else break;
    }
    return p;
  }

  function walk(start, end, mediaScope) {
    var cursor = start;
    var stmtStart = skipWs(start, end);
    var quote = null;

    while (cursor < end) {
      var ch = masked[cursor];
      if (quote) {
        if (ch === '\\\\') { cursor += 2; continue; }
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
        stmtStart = skipWs(cursor + 1, end);
        cursor++;
        continue;
      }
      if (ch === '{') {
        var headerStart = skipWs(stmtStart, cursor);
        var header = masked.slice(headerStart, cursor).trim();
        var depth = 1;
        var p = cursor + 1;
        var innerQuote = null;
        while (p < end && depth > 0) {
          var ic = masked[p];
          if (innerQuote) {
            if (ic === '\\\\') { p += 2; continue; }
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

        var blockCloseIdx = p - 1;
        var innerStart = cursor + 1;
        var innerEnd = Math.max(innerStart, blockCloseIdx);

        if (header.startsWith('@')) {
          var lowerH = header.toLowerCase();
          if (lowerH.startsWith('@media') || lowerH.startsWith('@supports') || lowerH.startsWith('@layer')) {
            var nextScope = mediaScope ? mediaScope + ' && ' + header : header;
            walk(innerStart, innerEnd, nextScope);
          }
          // @keyframes, @font-face, @page are intentionally kept intact
        } else if (header && !/<\\/?[a-zA-Z!:]+/.test(header) && headerStart < cursor) {
          var cleanHeader = header.replace(/\\s+/g, ' ').trim();
          var bodyRaw = masked.slice(innerStart, innerEnd).trim();
          var fullRule = pureCss.slice(headerStart, blockCloseIdx + 1).trim();
          if (cleanHeader && bodyRaw && fullRule.length > 3) {
            rules.push({
              selector: cleanHeader,
              body: bodyRaw,
              fullRule: fullRule,
              localStart: headerStart,
              localEnd: blockCloseIdx + 1,
              absStart: baseOffsetInXml + headerStart,
              absEnd: baseOffsetInXml + blockCloseIdx + 1,
              mediaScope: mediaScope,
              line: lineAtOffset(lineStarts, baseOffsetInXml + headerStart),
              source: sourceTag
            });
          }
        }

        stmtStart = skipWs(blockCloseIdx + 1, end);
        cursor = stmtStart;
        continue;
      }
      cursor++;
    }
  }

  walk(0, len, '');
  return rules;
}

function extractSelectorTokens(selectorGroup) {
  var lower = selectorGroup.toLowerCase();
  var isLayoutRule = lower.indexOf('body#layout') !== -1 || lower.indexOf('.layout-') !== -1 || lower.indexOf('#layout') !== -1;
  var cleaned = selectorGroup
    .replace(/\\[[^\\]]*\\]/g, '')
    .replace(/:{1,2}[a-zA-Z-]+(?:\\([^)]*\\))?/g, '');

  var classes = [];
  var rawClasses = [];
  var ids = [];
  var classRe = /\\.([a-zA-Z_-][a-zA-Z0-9_-]*)/g;
  var idRe = /#([a-zA-Z_-][a-zA-Z0-9_-]*)/g;
  var m;
  while ((m = classRe.exec(cleaned)) !== null) {
    rawClasses.push(m[1]);
    classes.push(m[1].toLowerCase());
  }
  while ((m = idRe.exec(cleaned)) !== null) ids.push(m[1].toLowerCase());

  return {
    classes: classes,
    rawClasses: rawClasses,
    ids: ids,
    isLayoutRule: isLayoutRule,
    isRootOrElementOnly: classes.length === 0 && ids.length === 0
  };
}

function detectAutoSafelistPrefixes(allCssRules, index) {
  var groups = new Map(); // lowerPrefixNoDot -> { displayPrefix, kind, ruleIndices: Set, samples: Set }
  var exactCssClasses = new Set();
  var exactCssCasing = new Map();
  var dynamicList = Array.from(index.dynamicClasses);

  function addGroupCandidate(keyLower, displayNoDot, kind, ruleIndex, rawCls) {
    if (!keyLower || keyLower.length < 2) return;
    var g = groups.get(keyLower);
    if (!g) {
      g = {
        keyLower: keyLower,
        displayPrefix: '.' + displayNoDot,
        kind: kind,
        ruleIndices: new Set(),
        samples: []
      };
      groups.set(keyLower, g);
    }
    g.ruleIndices.add(ruleIndex);
    if (g.samples.length < 5 && g.samples.indexOf('.' + rawCls) === -1) {
      g.samples.push('.' + rawCls);
    }
  }

  for (var ri = 0; ri < allCssRules.length; ri++) {
    var rule = allCssRules[ri];
    if (rule.source === 'b:template-skin') continue;
    var tok = extractSelectorTokens(rule.selector);
    if (tok.isLayoutRule) continue;

    for (var ci = 0; ci < tok.rawClasses.length; ci++) {
      var rawCls = tok.rawClasses[ci];
      var clsLower = rawCls.toLowerCase();
      exactCssClasses.add(clsLower);
      if (!exactCssCasing.has(clsLower)) exactCssCasing.set(clsLower, rawCls);

      // Skip delimiter/root grouping on pure Blogger core classes unless paired later
      var delimMatch = /^([a-zA-Z][a-zA-Z0-9]{0,14}[-_])/.exec(rawCls);
      if (delimMatch) {
        addGroupCandidate(delimMatch[1].toLowerCase(), delimMatch[1], 'prefix', ri, rawCls);
      }

      var rootPart = rawCls.split(/[-_]/)[0];
      if (rootPart && rootPart.length >= 2) {
        addGroupCandidate(rootPart.toLowerCase(), rootPart, 'root', ri, rawCls);

        // CamelCase / compact component root detection (e.g. mkcItem -> mkc, plCenterBox -> plCenter)
        var camelRoot = /^([a-z]{1,8}[A-Z][a-zA-Z0-9]{0,12}?)(?=[A-Z]|$)/.exec(rootPart);
        if (camelRoot && camelRoot[1] && camelRoot[1].length >= 3 && camelRoot[1] !== rootPart) {
          addGroupCandidate(camelRoot[1].toLowerCase(), camelRoot[1], 'root', ri, rawCls);
        }
        var shortLowerBeforeUpper = /^([a-z]{3,6})(?=[A-Z])/.exec(rootPart);
        if (shortLowerBeforeUpper && shortLowerBeforeUpper[1]) {
          addGroupCandidate(shortLowerBeforeUpper[1].toLowerCase(), shortLowerBeforeUpper[1], 'root', ri, rawCls);
        }
      }
    }
  }

  // Expose exact counts for UI badges (with leading '.')
  var cssPrefixRuleCounts = {};
  groups.forEach(function(g) {
    cssPrefixRuleCounts['.' + g.keyLower] = g.ruleIndices.size;
    cssPrefixRuleCounts[g.displayPrefix.toLowerCase()] = g.ruleIndices.size;
  });

  // Step C: Cross-match CSS groups against JS dynamic classes/stems & Blogger dynamic attributes
  var stateKeySet = new Set(STATE_THEME_CLASS_KEYS);
  var candidateAuto = [];

  groups.forEach(function(g) {
    var k = g.keyLower;
    if (stateKeySet.has(k)) return; // Handled in Step D

    var matchedDynamic = false;
    if (g.kind === 'prefix') {
      if (index.dynamicPrefixStems && index.dynamicPrefixStems.has(k)) {
        matchedDynamic = true;
      } else {
        for (var di = 0; di < dynamicList.length; di++) {
          if (dynamicList[di] === k || dynamicList[di].indexOf(k) === 0) {
            matchedDynamic = true;
            break;
          }
        }
      }
    } else {
      if (index.dynamicClasses.has(k)) {
        matchedDynamic = true;
      } else {
        for (var di2 = 0; di2 < dynamicList.length; di2++) {
          var dyn = dynamicList[di2];
          if (
            dyn.indexOf(k + '-') === 0 ||
            dyn.indexOf(k + '_') === 0 ||
            (dyn.indexOf(k) === 0 && k.length >= 3 && (dyn.length === k.length || !/[a-z]/.test(dyn[k.length])))
          ) {
            matchedDynamic = true;
            break;
          }
        }
      }
    }

    if (matchedDynamic && g.ruleIndices.size >= 1) {
      candidateAuto.push(g);
    }
  });

  // Deduplicate overlapping root vs delimited prefixes (e.g. keep '.mk-' if '.mk' isn't standalone, keep '.modal' if standalone '.modal' exists)
  var candidateMap = new Map();
  for (var ai = 0; ai < candidateAuto.length; ai++) {
    candidateMap.set(candidateAuto[ai].keyLower, candidateAuto[ai]);
  }

  var detected = [];
  var addedKeys = new Set();

  for (var ci2 = 0; ci2 < candidateAuto.length; ci2++) {
    var cg = candidateAuto[ci2];
    if (cg.kind === 'root') {
      var hasHyphenSib = candidateMap.has(cg.keyLower + '-') || candidateMap.has(cg.keyLower + '_');
      var standaloneExists = exactCssClasses.has(cg.keyLower) || index.dynamicClasses.has(cg.keyLower);
      if (hasHyphenSib && !standaloneExists) {
        continue; // Prefer '.mk-' over '.mk'
      }
    } else if (cg.kind === 'prefix') {
      var stemNoDelim = cg.keyLower.slice(0, -1);
      var parentRoot = candidateMap.get(stemNoDelim);
      var parentStandalone = exactCssClasses.has(stemNoDelim) || index.dynamicClasses.has(stemNoDelim);
      if (parentRoot && parentStandalone) {
        continue; // Prefer '.modal' over '.modal-' when '.modal' standalone exists
      }
    }

    if (!addedKeys.has(cg.keyLower)) {
      addedKeys.add(cg.keyLower);
      detected.push({
        prefix: cg.displayPrefix,
        kind: cg.kind,
        cssRuleCount: cg.ruleIndices.size,
        matchedTokensSample: cg.samples,
        source: 'auto'
      });
    }
  }

  // Step D: Auto-detect UI state/theme classes if <script> or Blogger dynamic attrs manipulate classes
  if (index.hasJsClassManipulation) {
    for (var si = 0; si < STATE_THEME_CLASS_KEYS.length; si++) {
      var stKey = STATE_THEME_CLASS_KEYS[si];
      var matchedRuleSet = new Set();
      var stSamples = [];
      for (var rj = 0; rj < allCssRules.length; rj++) {
        var rItem = allCssRules[rj];
        if (rItem.source === 'b:template-skin') continue;
        var stTok = extractSelectorTokens(rItem.selector);
        if (stTok.isLayoutRule) continue;
        for (var sc = 0; sc < stTok.classes.length; sc++) {
          var clsTok = stTok.classes[sc];
          if (
            clsTok === stKey ||
            clsTok.indexOf(stKey + '-') === 0 ||
            clsTok.indexOf('-' + stKey) !== -1 ||
            clsTok.indexOf('_' + stKey) !== -1
          ) {
            matchedRuleSet.add(rj);
            if (stSamples.length < 4) {
              var origTok = '.' + stTok.rawClasses[sc];
              if (stSamples.indexOf(origTok) === -1) stSamples.push(origTok);
            }
            break;
          }
        }
      }

      if (matchedRuleSet.size > 0 && !addedKeys.has(stKey)) {
        var disp = exactCssCasing.get(stKey) || STATE_THEME_DISPLAY_MAP[stKey] || stKey;
        addedKeys.add(stKey);
        cssPrefixRuleCounts['.' + stKey] = matchedRuleSet.size;
        cssPrefixRuleCounts['.' + disp.toLowerCase()] = matchedRuleSet.size;
        detected.push({
          prefix: '.' + disp,
          kind: 'state',
          cssRuleCount: matchedRuleSet.size,
          matchedTokensSample: stSamples,
          source: 'auto'
        });
      }
    }
  }

  detected.sort(function(a, b) {
    if (a.kind === 'state' && b.kind !== 'state') return 1;
    if (a.kind !== 'state' && b.kind === 'state') return -1;
    return b.cssRuleCount - a.cssRuleCount;
  });

  return {
    autoDetectedSafelist: detected.slice(0, 32),
    cssPrefixRuleCounts: cssPrefixRuleCounts
  };
}

function expandUsedCssVarsTransitively(rules, initialUsedVars) {
  var usedVars = new Set(initialUsedVars);
  var varGraph = new Map(); // varName -> Array of referenced var(--dep)
  var allDeclEntries = [];

  for (var i = 0; i < rules.length; i++) {
    var rule = rules[i];
    var declRe = /(--[a-zA-Z0-9_-]+)\\s*:\\s*([^;{}]+);?/g;
    var vm;
    while ((vm = declRe.exec(rule.body)) !== null) {
      var name = vm[1].trim();
      var val = vm[2].trim();
      var deps = [];
      var depRe = /var\\(\\s*(--[a-zA-Z0-9_-]+)/g;
      var dm;
      while ((dm = depRe.exec(val)) !== null) {
        deps.push(dm[1]);
      }
      if (deps.length > 0) {
        var existing = varGraph.get(name) || [];
        for (var d = 0; d < deps.length; d++) existing.push(deps[d]);
        varGraph.set(name, existing);
      }
      allDeclEntries.push({
        name: name,
        value: val,
        rawDecl: vm[0],
        rule: rule,
        offsetInRule: rule.fullRule.indexOf(vm[0])
      });
    }
  }

  // BFS transitive closure so --var used by another live --var is NEVER deleted
  var queue = Array.from(usedVars);
  var head = 0;
  while (head < queue.length) {
    var curr = queue[head++];
    var depsList = varGraph.get(curr);
    if (!depsList) continue;
    for (var k = 0; k < depsList.length; k++) {
      var dep = depsList[k];
      if (!usedVars.has(dep)) {
        usedVars.add(dep);
        queue.push(dep);
      }
    }
  }

  // Also ensure any --var referenced inside a rule that is NOT unused protects its dependencies
  // Already covered because initialUsedVars scanned ALL var(--...) across the document,
  // and if a variable is referenced by another variable declaration, BFS protects it if root var is used.
  // Additionally: if var A's declaration references var B, mark var B as used if ANY var(--B) exists (already in initialUsedVars).
  return { usedVars: usedVars, allDeclEntries: allDeclEntries };
}

// ============================================================
// 4. SAFE TOP-LEVEL JS SCANNER & COMMENT STRIPPER
// ============================================================

function stripJsCommentsSafely(jsCode) {
  var out = [];
  var i = 0;
  var len = jsCode.length;
  var state = 'code'; // code | sq | dq | tpl | regex
  var tplBraceDepth = 0;
  var tplExprQuote = null;
  var regexInCharClass = false;
  var lastNonWsChar = '';
  var lastWord = '';
  var strippedCount = 0;

  function canStartRegex() {
    if (!lastNonWsChar) return true;
    if ('(=,[!:;&|?{}~+-*%^<>'.indexOf(lastNonWsChar) !== -1) return true;
    if (/^(return|typeof|void|delete|throw|case|in|of|new|else|do|yield|await)$/.test(lastWord)) return true;
    return false;
  }

  while (i < len) {
    var ch = jsCode[i];
    if (state === 'sq' || state === 'dq') {
      out.push(ch);
      if (ch === '\\\\' && i + 1 < len) {
        out.push(jsCode[i + 1]);
        i += 2;
        continue;
      }
      if ((state === 'sq' && ch === "'") || (state === 'dq' && ch === '"')) {
        state = 'code';
        lastNonWsChar = ch;
        lastWord = '';
      }
      i++;
      continue;
    }

    if (state === 'regex') {
      out.push(ch);
      if (ch === '\\\\' && i + 1 < len) {
        out.push(jsCode[i + 1]);
        i += 2;
        continue;
      }
      if (ch === '[' && !regexInCharClass) {
        regexInCharClass = true;
      } else if (ch === ']' && regexInCharClass) {
        regexInCharClass = false;
      } else if (ch === '/' && !regexInCharClass) {
        state = 'code';
        lastNonWsChar = '/';
        lastWord = '';
      } else if (ch === '\\n') {
        regexInCharClass = false;
        state = 'code';
      }
      i++;
      continue;
    }

    if (state === 'tpl') {
      if (tplBraceDepth > 0) {
        if (tplExprQuote) {
          out.push(ch);
          if (ch === '\\\\' && i + 1 < len) {
            out.push(jsCode[i + 1]);
            i += 2;
            continue;
          }
          if (ch === tplExprQuote) tplExprQuote = null;
          i++;
          continue;
        }
        if (ch === "'" || ch === '"') {
          tplExprQuote = ch;
          out.push(ch);
          i++;
          continue;
        }
        if (ch === '/' && jsCode[i + 1] === '/') {
          var tnl = jsCode.indexOf('\\n', i + 2);
          var tLine = tnl === -1 ? jsCode.slice(i) : jsCode.slice(i, tnl);
          if (/^\\/\\/\\s*(?:<!\\[CDATA\\[|\\]\\]>)/i.test(tLine)) {
            out.push(tLine);
          } else {
            strippedCount++;
          }
          if (tnl === -1) break;
          out.push('\\n');
          i = tnl + 1;
          continue;
        }
        if (ch === '/' && jsCode[i + 1] === '*') {
          var tEndC = jsCode.indexOf('*/', i + 2);
          if (tEndC === -1) { out.push(jsCode.slice(i)); break; }
          var tBodyC = jsCode.slice(i, tEndC + 2);
          if (tBodyC.indexOf('/*!') === 0 || /<!\\[CDATA\\[|\\]\\]>/i.test(tBodyC)) {
            out.push(tBodyC);
          } else {
            strippedCount++;
            out.push(tBodyC.indexOf('\\n') !== -1 ? '\\n' : ' ');
          }
          i = tEndC + 2;
          continue;
        }
        out.push(ch);
        if (ch === '{') { tplBraceDepth++; i++; continue; }
        if (ch === '}') { tplBraceDepth--; i++; continue; }
        i++;
        continue;
      }

      out.push(ch);
      if (ch === '\\\\' && i + 1 < len) {
        out.push(jsCode[i + 1]);
        i += 2;
        continue;
      }
      if (ch === '$' && jsCode[i + 1] === '{') {
        out.push('{');
        tplBraceDepth = 1;
        tplExprQuote = null;
        i += 2;
        continue;
      }
      if (ch === '\`') {
        state = 'code';
        lastNonWsChar = '\`';
        lastWord = '';
      }
      i++;
      continue;
    }

    // state === 'code'
    if (ch === "'") { state = 'sq'; out.push(ch); i++; continue; }
    if (ch === '"') { state = 'dq'; out.push(ch); i++; continue; }
    if (ch === '\`') { state = 'tpl'; tplBraceDepth = 0; tplExprQuote = null; out.push(ch); i++; continue; }

    if (ch === '/' && jsCode[i + 1] === '/') {
      var nl = jsCode.indexOf('\\n', i + 2);
      var lineText = nl === -1 ? jsCode.slice(i) : jsCode.slice(i, nl);
      if (/^\\/\\/\\s*(?:<!\\[CDATA\\[|\\]\\]>)/i.test(lineText)) {
        out.push(lineText);
      } else {
        strippedCount++;
      }
      if (nl === -1) break;
      out.push('\\n');
      i = nl + 1;
      continue;
    }

    if (ch === '/' && jsCode[i + 1] === '*') {
      var endC = jsCode.indexOf('*/', i + 2);
      if (endC === -1) {
        out.push(jsCode.slice(i));
        break;
      }
      var bodyC = jsCode.slice(i, endC + 2);
      if (bodyC.indexOf('/*!') === 0 || /<!\\[CDATA\\[|\\]\\]>/i.test(bodyC)) {
        out.push(bodyC);
      } else {
        strippedCount++;
        out.push(bodyC.indexOf('\\n') !== -1 ? '\\n' : ' ');
      }
      i = endC + 2;
      continue;
    }

    if (ch === '/' && canStartRegex()) {
      state = 'regex';
      regexInCharClass = false;
      out.push(ch);
      i++;
      continue;
    }

    out.push(ch);
    if (ch !== ' ' && ch !== '\\t' && ch !== '\\n' && ch !== '\\r') {
      lastNonWsChar = ch;
      if (/[a-zA-Z0-9_$]/.test(ch)) {
        lastWord += ch;
      } else {
        lastWord = '';
      }
    }
    i++;
  }

  return { code: out.join(''), strippedCount: strippedCount };
}

function findTopLevelDeadJsFunctions(pureJs, blockIndex, baseOffset, lineStarts, usedJsRefs) {
  var deadFns = [];
  var len = pureJs.length;
  var i = 0;
  var depth = 0;
  var state = 'code';

  while (i < len) {
    var ch = pureJs[i];
    if (state === 'sq' || state === 'dq') {
      if (ch === '\\\\') { i += 2; continue; }
      if ((state === 'sq' && ch === "'") || (state === 'dq' && ch === '"')) state = 'code';
      i++;
      continue;
    }
    if (state === 'tpl') {
      if (ch === '\\\\') { i += 2; continue; }
      if (ch === '\`') state = 'code';
      i++;
      continue;
    }
    if (ch === '/' && pureJs[i + 1] === '/') {
      var nl = pureJs.indexOf('\\n', i + 2);
      i = nl === -1 ? len : nl + 1;
      continue;
    }
    if (ch === '/' && pureJs[i + 1] === '*') {
      var ec = pureJs.indexOf('*/', i + 2);
      i = ec === -1 ? len : ec + 2;
      continue;
    }
    if (ch === "'") { state = 'sq'; i++; continue; }
    if (ch === '"') { state = 'dq'; i++; continue; }
    if (ch === '\`') { state = 'tpl'; i++; continue; }

    if (ch === '/' && pureJs[i + 1] !== '/' && pureJs[i + 1] !== '*') {
      // Heuristic regex literal skip when '/' follows operator/delimiter
      var prevIdx = i - 1;
      while (prevIdx >= 0 && (pureJs[prevIdx] === ' ' || pureJs[prevIdx] === '\\t')) prevIdx--;
      var prevChar = prevIdx >= 0 ? pureJs[prevIdx] : '';
      if (!prevChar || '(=,[!:;&|?{}~+-*%^<>\\n'.indexOf(prevChar) !== -1) {
        var rPos = i + 1;
        while (rPos < len && pureJs[rPos] !== '\\n') {
          if (pureJs[rPos] === '\\\\') { rPos += 2; continue; }
          if (pureJs[rPos] === '/') { rPos++; break; }
          rPos++;
        }
        i = rPos;
        continue;
      }
    }

    if (ch === '{') { depth++; i++; continue; }
    if (ch === '}') { depth = Math.max(0, depth - 1); i++; continue; }

    // Detect top-level function declaration: depth === 0
    if (depth === 0 && ch === 'f' && pureJs.slice(i, i + 8) === 'function') {
      var prevCh = i > 0 ? pureJs[i - 1] : ' ';
      var nextCh = pureJs[i + 8] || '';
      if (!/[a-zA-Z0-9_$]/.test(prevCh) && (nextCh === ' ' || nextCh === '\\t' || nextCh === '\\n' || nextCh === '\\r')) {
        var rest = pureJs.slice(i);
        var fnHeaderRe = /^function\\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*\\(([^)]*)\\)\\s*\\{/;
        var fm = fnHeaderRe.exec(rest);
        if (fm) {
          var fnName = fm[1];
          var fnParams = fm[2].trim();
          var braceStart = i + fm[0].length - 1;
          // Walk balanced braces for function body
          var bDepth = 1;
          var p = braceStart + 1;
          var bState = 'code';
          while (p < len && bDepth > 0) {
            var bc = pureJs[p];
            if (bState === 'sq' || bState === 'dq') {
              if (bc === '\\\\') { p += 2; continue; }
              if ((bState === 'sq' && bc === "'") || (bState === 'dq' && bc === '"')) bState = 'code';
              p++; continue;
            }
            if (bState === 'tpl') {
              if (bc === '\\\\') { p += 2; continue; }
              if (bc === '\`') bState = 'code';
              p++; continue;
            }
            if (bc === '/' && pureJs[p + 1] === '/') {
              var bnl = pureJs.indexOf('\\n', p + 2);
              p = bnl === -1 ? len : bnl + 1;
              continue;
            }
            if (bc === '/' && pureJs[p + 1] === '*') {
              var bec = pureJs.indexOf('*/', p + 2);
              p = bec === -1 ? len : bec + 2;
              continue;
            }
            if (bc === "'") { bState = 'sq'; p++; continue; }
            if (bc === '"') { bState = 'dq'; p++; continue; }
            if (bc === '\`') { bState = 'tpl'; p++; continue; }
            if (bc === '/' && pureJs[p + 1] !== '/' && pureJs[p + 1] !== '*') {
              var bpIdx = p - 1;
              while (bpIdx >= 0 && (pureJs[bpIdx] === ' ' || pureJs[bpIdx] === '\\t')) bpIdx--;
              var bpChar = bpIdx >= 0 ? pureJs[bpIdx] : '';
              if (!bpChar || '(=,[!:;&|?{}~+-*%^<>\\n'.indexOf(bpChar) !== -1) {
                var brPos = p + 1;
                while (brPos < len && pureJs[brPos] !== '\\n') {
                  if (pureJs[brPos] === '\\\\') { brPos += 2; continue; }
                  if (pureJs[brPos] === '/') { brPos++; break; }
                  brPos++;
                }
                p = brPos;
                continue;
              }
            }
            if (bc === '{') bDepth++;
            else if (bc === '}') bDepth--;
            p++;
          }

          var fnEnd = p;
          // Count how many times fnName appears in the whole document vs inside its own declaration header (1)
          var totalRefs = usedJsRefs.get(fnName) || 0;
          if (totalRefs <= 1) {
            deadFns.push({
              id: 'unused-js-' + (deadFns.length + 1) + '-' + blockIndex,
              name: fnName,
              line: lineAtOffset(lineStarts, baseOffset + i),
              params: fnParams,
              preview: pureJs.slice(i, Math.min(fnEnd, i + 120)).replace(/\\s+/g, ' ').trim(),
              estimatedBytes: fnEnd - i,
              blockIndex: blockIndex,
              startInCode: i,
              endInCode: fnEnd
            });
          }
          i = fnEnd;
          continue;
        }
      }
    }
    i++;
  }

  return deadFns;
}

// ============================================================
// 5. FULL ANALYSIS & CLEANUP PIPELINE
// ============================================================

function runFullAnalysis(xml, customSafelistPrefixes) {
  var t0 = Date.now();
  postProgress('extracting', 15, 'Mengisolasi blok <style>, <b:skin>, <script> & CDATA...');
  var blocks = extractCodeBlocks(xml);
  var lineStarts = buildLineStarts(xml);

  postProgress('indexing', 38, 'Mengindeks referensi class, ID, var(--*), dan JS ke Set()...');
  var index = buildDocumentReferenceIndex(xml, blocks);

  postProgress('analyzing', 65, 'Menganalisis aturan CSS, variabel, duplikat, dan fungsi JS mati...');

  // External CSS/JS duplicates
  var duplicateCssAssets = [];
  var duplicateJsAssets = [];
  var duplicateCssRules = [];
  var unusedCssRules = [];
  var unusedCssVars = [];
  var unusedJsFunctions = [];

  var cssUrlGroups = new Map();
  var cssLibGroups = new Map();
  var linkRe = /<link\\b([^>]*?)\\/?>/gi;
  var m;
  while ((m = linkRe.exec(xml)) !== null) {
    var attrs = m[1];
    var rel = getAttrValue(attrs, 'rel').toLowerCase();
    var href = getAttrValue(attrs, 'href') || getAttrValue(attrs, 'expr:href');
    if (!href) continue;
    var isCss = rel.indexOf('stylesheet') !== -1 || href.indexOf('fonts.googleapis.com') !== -1 || /\\.css(?:[?#]|$)/i.test(href);
    if (!isCss) continue;
    var norm = normalizeAssetUrl(href);
    var occ = { rawTag: m[0], url: href.replace(/&amp;/g, '&'), line: lineAtOffset(lineStarts, m.index), range: { start: m.index, end: m.index + m[0].length } };
    var arr = cssUrlGroups.get(norm) || [];
    arr.push(occ);
    cssUrlGroups.set(norm, arr);
    var lib = extractLibrarySignature(href);
    if (lib) {
      var larr = cssLibGroups.get(lib) || [];
      larr.push(occ);
      cssLibGroups.set(lib, larr);
    }
  }

  cssUrlGroups.forEach(function(entries, normUrl) {
    if (entries.length > 1) {
      var extras = entries.slice(1);
      var extraTags = extras.map(function(e) { return e.rawTag; });
      duplicateCssAssets.push({
        id: 'dup-css-url-' + (duplicateCssAssets.length + 1),
        kind: 'css',
        duplicateType: 'exact-url',
        label: normUrl.split('/').pop() || normUrl,
        occurrences: entries.length,
        lines: entries.map(function(e) { return e.line; }),
        urlsOrSnippets: entries.map(function(e) { return e.url; }),
        removableRawTags: extraTags,
        removableRanges: extras.map(function(e) { return e.range; }),
        reason: 'Stylesheet URL yang sama dipanggil ' + entries.length + 'x di dalam template.',
        estimatedSavedBytes: extraTags.reduce(function(s, t) { return s + t.length; }, 0)
      });
    }
  });

  cssLibGroups.forEach(function(entries, lib) {
    var uniqueNorms = new Set(entries.map(function(e) { return normalizeAssetUrl(e.url); }));
    if (uniqueNorms.size > 1) {
      var extras = entries.slice(1);
      var extraTags = extras.map(function(e) { return e.rawTag; });
      duplicateCssAssets.push({
        id: 'dup-css-lib-' + (duplicateCssAssets.length + 1),
        kind: 'css',
        duplicateType: 'same-library',
        label: 'Pustaka ' + lib + ' ganda (' + uniqueNorms.size + ' CDN/versi)',
        occurrences: entries.length,
        lines: entries.map(function(e) { return e.line; }),
        urlsOrSnippets: entries.map(function(e) { return e.url; }),
        removableRawTags: extraTags,
        removableRanges: extras.map(function(e) { return e.range; }),
        reason: 'Pustaka CSS "' + lib + '" dimuat lebih dari satu kali dari versi/CDN berbeda.',
        estimatedSavedBytes: extraTags.reduce(function(s, t) { return s + t.length; }, 0)
      });
    }
  });

  // JS duplicates + Dead JS functions (only inside isolated pureCode!)
  var jsUrlGroups = new Map();
  var jsLibGroups = new Map();
  var jsInlineGroups = new Map();
  var styleBlockCount = 0;
  var scriptBlockCount = 0;
  var allCssRules = [];

  for (var bi = 0; bi < blocks.length; bi++) {
    var blk = blocks[bi];
    var cdata = splitCdataWrapper(blk.inner);
    var pureOffset = blk.innerStart + cdata.prefix.length;

    if (blk.lowerTag === 'script') {
      scriptBlockCount++;
      var src = getAttrValue(blk.attrs, 'src') || getAttrValue(blk.attrs, 'expr:src');
      var bLine = lineAtOffset(lineStarts, blk.fullStart);
      var bRange = { start: blk.fullStart, end: blk.fullEnd };
      if (src) {
        var normJ = normalizeAssetUrl(src);
        var jOcc = { rawTag: blk.rawFull, url: src.replace(/&amp;/g, '&'), line: bLine, range: bRange };
        var jArr = jsUrlGroups.get(normJ) || [];
        jArr.push(jOcc);
        jsUrlGroups.set(normJ, jArr);
        var jLib = extractLibrarySignature(src);
        if (jLib) {
          var jlArr = jsLibGroups.get(jLib) || [];
          jlArr.push(jOcc);
          jsLibGroups.set(jLib, jlArr);
        }
      } else {
        var typeAttr = getAttrValue(blk.attrs, 'type').toLowerCase();
        if (typeAttr.indexOf('ld+json') === -1 && cdata.pureCode.trim().length > 0) {
          var normInline = cdata.pureCode.replace(/\\s+/g, ' ').trim();
          if (normInline.length >= 24) {
            var inArr = jsInlineGroups.get(normInline) || [];
            inArr.push({ rawTag: blk.rawFull, preview: normInline.slice(0, 120), line: bLine, range: bRange });
            jsInlineGroups.set(normInline, inArr);
          }
          var deadFns = findTopLevelDeadJsFunctions(cdata.pureCode, bi, pureOffset, lineStarts, index.usedJsRefs);
          for (var df = 0; df < deadFns.length; df++) unusedJsFunctions.push(deadFns[df]);
        }
      }
    } else {
      styleBlockCount++;
      var srcTag = blk.lowerTag === 'b:skin' ? 'b:skin' : (blk.lowerTag === 'b:template-skin' ? 'b:template-skin' : 'style');
      var parsedRules = parseCssRulesStructured(cdata.pureCode, pureOffset, lineStarts, srcTag);
      for (var pr = 0; pr < parsedRules.length; pr++) {
        parsedRules[pr].blockIndex = bi;
        allCssRules.push(parsedRules[pr]);
      }
    }
  }

  jsUrlGroups.forEach(function(entries, normUrl) {
    if (entries.length > 1) {
      var extras = entries.slice(1);
      var extraTags = extras.map(function(e) { return e.rawTag; });
      duplicateJsAssets.push({
        id: 'dup-js-url-' + (duplicateJsAssets.length + 1),
        kind: 'js',
        duplicateType: 'exact-url',
        label: normUrl.split('/').pop() || normUrl,
        occurrences: entries.length,
        lines: entries.map(function(e) { return e.line; }),
        urlsOrSnippets: entries.map(function(e) { return e.url; }),
        removableRawTags: extraTags,
        removableRanges: extras.map(function(e) { return e.range; }),
        reason: 'Skrip eksternal (.js) identik dimuat ' + entries.length + 'x.',
        estimatedSavedBytes: extraTags.reduce(function(s, t) { return s + t.length; }, 0)
      });
    }
  });

  jsLibGroups.forEach(function(entries, lib) {
    var uniqueNorms = new Set(entries.map(function(e) { return normalizeAssetUrl(e.url); }));
    if (uniqueNorms.size > 1) {
      var extras = entries.slice(1);
      var extraTags = extras.map(function(e) { return e.rawTag; });
      duplicateJsAssets.push({
        id: 'dup-js-lib-' + (duplicateJsAssets.length + 1),
        kind: 'js',
        duplicateType: 'same-library',
        label: 'Pustaka ' + lib + ' ganda (' + uniqueNorms.size + ' sumber/versi)',
        occurrences: entries.length,
        lines: entries.map(function(e) { return e.line; }),
        urlsOrSnippets: entries.map(function(e) { return e.url; }),
        removableRawTags: extraTags,
        removableRanges: extras.map(function(e) { return e.range; }),
        reason: 'Pustaka JS "' + lib + '" dimuat ganda dari versi/CDN berbeda.',
        estimatedSavedBytes: extraTags.reduce(function(s, t) { return s + t.length; }, 0)
      });
    }
  });

  jsInlineGroups.forEach(function(entries) {
    if (entries.length > 1) {
      var extras = entries.slice(1);
      var extraTags = extras.map(function(e) { return e.rawTag; });
      duplicateJsAssets.push({
        id: 'dup-js-inline-' + (duplicateJsAssets.length + 1),
        kind: 'js',
        duplicateType: 'inline-block',
        label: 'Blok <script> inline ganda (' + entries[0].preview.slice(0, 42) + '...)',
        occurrences: entries.length,
        lines: entries.map(function(e) { return e.line; }),
        urlsOrSnippets: entries.map(function(e) { return e.preview; }),
        removableRawTags: extraTags,
        removableRanges: extras.map(function(e) { return e.range; }),
        reason: 'Blok JavaScript inline yang sama persis muncul ' + entries.length + 'x.',
        estimatedSavedBytes: extraTags.reduce(function(s, t) { return s + t.length; }, 0)
      });
    }
  });

  // Duplicate CSS Rules
  var identicalRuleGroups = new Map();
  var selectorScopeGroups = new Map();
  for (var ri = 0; ri < allCssRules.length; ri++) {
    var rule = allCssRules[ri];
    var normSel = rule.selector.replace(/\\s+/g, ' ').trim();
    var normBody = rule.body.replace(/\\s+/g, ' ').replace(/;\\s+/g, ';').trim();
    var idKey = rule.mediaScope + '::' + normSel + '::' + normBody;
    var selKey = rule.mediaScope + '::' + normSel;

    var ia = identicalRuleGroups.get(idKey) || [];
    ia.push(rule);
    identicalRuleGroups.set(idKey, ia);

    var sa = selectorScopeGroups.get(selKey) || [];
    sa.push(rule);
    selectorScopeGroups.set(selKey, sa);
  }

  var flaggedSel = new Set();
  identicalRuleGroups.forEach(function(rules) {
    if (rules.length > 1) {
      flaggedSel.add(rules[0].mediaScope + '::' + rules[0].selector);
      var extras = rules.slice(1);
      duplicateCssRules.push({
        id: 'dup-css-rule-' + (duplicateCssRules.length + 1),
        selector: rules[0].selector,
        duplicateType: 'identical-rule',
        occurrences: rules.length,
        lines: rules.map(function(r) { return r.line; }),
        source: rules[0].source,
        sampleBody: rules[0].body.slice(0, 120),
        removableRawRules: extras.map(function(r) { return r.fullRule; }),
        removableRanges: extras.map(function(r) { return { start: r.absStart, end: r.absEnd }; }),
        reason: 'Aturan CSS identik (' + rules[0].selector + ') ditulis ' + rules.length + 'x.',
        estimatedSavedBytes: extras.reduce(function(s, r) { return s + r.fullRule.length; }, 0)
      });
    }
  });

  selectorScopeGroups.forEach(function(rules, selKey) {
    if (rules.length > 1 && !flaggedSel.has(selKey)) {
      var earlier = rules.slice(0, -1);
      duplicateCssRules.push({
        id: 'dup-css-sel-' + (duplicateCssRules.length + 1),
        selector: rules[0].selector,
        duplicateType: 'repeated-selector',
        occurrences: rules.length,
        lines: rules.map(function(r) { return r.line; }),
        source: rules[0].source,
        sampleBody: rules.map(function(r) { return r.body.slice(0, 60); }).join(' | '),
        removableRawRules: earlier.map(function(r) { return r.fullRule; }),
        removableRanges: earlier.map(function(r) { return { start: r.absStart, end: r.absEnd }; }),
        reason: 'Selector "' + rules[0].selector + '" dideklarasikan terpisah ' + rules.length + 'x pada cakupan yang sama.',
        estimatedSavedBytes: earlier.reduce(function(s, r) { return s + r.fullRule.length; }, 0)
      });
    }
  });

  // Auto-detect dynamic CSS Safelist Prefixes (Steps A-D)
  var safelistDetection = detectAutoSafelistPrefixes(allCssRules, index);
  var activeSafelistPrefixes = Array.isArray(customSafelistPrefixes)
    ? customSafelistPrefixes
    : safelistDetection.autoDetectedSafelist.map(function(item) { return item.prefix; });

  // Unused CSS Rules (O(1) Set lookups + Dynamic/Active Safelist Protection)
  for (var ui = 0; ui < allCssRules.length; ui++) {
    var uRule = allCssRules[ui];
    if (uRule.source === 'b:template-skin') continue;
    if (isSafelistedCssSelector(uRule.selector)) continue;
    var selInfo = extractSelectorTokens(uRule.selector);
    if (selInfo.isLayoutRule || selInfo.isRootOrElementOnly) continue;

    // Preserve 100% of CSS rules matching any prefix in Active Safelist (including :hover, ::before, ::after, @media)
    var hitsSafelist = false;
    for (var sci = 0; sci < selInfo.classes.length; sci++) {
      if (isSafelistedClassToken(selInfo.classes[sci], activeSafelistPrefixes)) {
        hitsSafelist = true;
        break;
      }
    }
    if (hitsSafelist) continue;

    var parts = uRule.selector.split(',');
    var anyPartUsed = false;
    var usesRuntime = false;
    var missingTokens = [];

    for (var pi = 0; pi < parts.length; pi++) {
      var part = parts[pi].trim();
      if (!part) continue;
      if (isSafelistedCssSelector(part)) {
        anyPartUsed = true;
        break;
      }
      var partInfo = extractSelectorTokens(part);
      if (partInfo.isRootOrElementOnly) {
        anyPartUsed = true;
        break;
      }

      var partOk = true;
      for (var ci = 0; ci < partInfo.classes.length; ci++) {
        var cls = partInfo.classes[ci];
        if (!index.usedClasses.has(cls)) {
          partOk = false;
          if (BLOGGER_RUNTIME_CLASSES.has(cls)) usesRuntime = true;
          if (missingTokens.length < 4) missingTokens.push('.' + cls);
        }
      }
      if (partOk) {
        for (var ii = 0; ii < partInfo.ids.length; ii++) {
          var idTok = partInfo.ids[ii];
          if (!index.usedIds.has(idTok)) {
            partOk = false;
            if (missingTokens.length < 4) missingTokens.push('#' + idTok);
          }
        }
      } else {
        for (var ii2 = 0; ii2 < partInfo.ids.length; ii2++) {
          if (!index.usedIds.has(partInfo.ids[ii2]) && missingTokens.length < 4) {
            missingTokens.push('#' + partInfo.ids[ii2]);
          }
        }
      }

      if (partOk) {
        anyPartUsed = true;
        break;
      }
    }

    if (!anyPartUsed && missingTokens.length > 0) {
      var conf = usesRuntime ? 'kemungkinan' : 'pasti';
      unusedCssRules.push({
        id: 'unused-css-' + (unusedCssRules.length + 1),
        selector: uRule.selector,
        fullRule: uRule.fullRule,
        tokensChecked: missingTokens,
        line: uRule.line,
        source: uRule.source,
        confidence: conf,
        estimatedBytes: uRule.fullRule.length,
        range: { start: uRule.absStart, end: uRule.absEnd },
        reason: conf === 'pasti'
          ? 'Selector ' + missingTokens.join(', ') + ' tidak ditemukan di HTML statis, tag Blogger (<b:if>/<b:loop>/expr:class), maupun DOM JS (<script>).'
          : 'Selector memuat kelas runtime Blogger (' + missingTokens.join(', ') + ').'
      });
    }
  }

  // Unused CSS Variables with transitive dependency protection
  var varGraphResult = expandUsedCssVarsTransitively(allCssRules, index.usedCssVars);
  var seenUnusedVar = new Set();
  for (var vi = 0; vi < varGraphResult.allDeclEntries.length; vi++) {
    var dEntry = varGraphResult.allDeclEntries[vi];
    if (seenUnusedVar.has(dEntry.name) || varGraphResult.usedVars.has(dEntry.name)) continue;
    seenUnusedVar.add(dEntry.name);
    var declAbsStart = dEntry.offsetInRule >= 0 ? dEntry.rule.absStart + dEntry.offsetInRule : -1;
    var declLine = declAbsStart >= 0 ? lineAtOffset(lineStarts, declAbsStart) : dEntry.rule.line;
    unusedCssVars.push({
      id: 'unused-var-' + (unusedCssVars.length + 1),
      name: dEntry.name,
      value: dEntry.value,
      selector: dEntry.rule.selector,
      line: declLine,
      declarationRaw: dEntry.rawDecl,
      range: declAbsStart >= 0 ? { start: declAbsStart, end: declAbsStart + dEntry.rawDecl.length } : undefined
    });
  }

  var totalDuplicateCssCount = duplicateCssAssets.length + duplicateCssRules.length;
  var totalDuplicateJsCount = duplicateJsAssets.length;
  var totalUnusedCssCount = unusedCssRules.length + unusedCssVars.length;

  var totalEstimatedSavingsBytes =
    duplicateCssAssets.reduce(function(s, a) { return s + a.estimatedSavedBytes; }, 0) +
    duplicateJsAssets.reduce(function(s, a) { return s + a.estimatedSavedBytes; }, 0) +
    duplicateCssRules.reduce(function(s, r) { return s + r.estimatedSavedBytes; }, 0) +
    unusedCssRules.filter(function(u) { return u.confidence === 'pasti'; }).reduce(function(s, u) { return s + u.estimatedBytes; }, 0) +
    unusedCssVars.reduce(function(s, v) { return s + (v.declarationRaw ? v.declarationRaw.length : 24); }, 0) +
    unusedJsFunctions.reduce(function(s, f) { return s + f.estimatedBytes; }, 0);

  postProgress('done', 100, 'Analisis O(1) selesai.');

  return {
    analysis: {
      report: {
        duplicateCssAssets: duplicateCssAssets,
        duplicateJsAssets: duplicateJsAssets,
        duplicateCssRules: duplicateCssRules,
        unusedCssRules: unusedCssRules,
        unusedCssVars: unusedCssVars,
        totalDuplicateCssCount: totalDuplicateCssCount,
        totalDuplicateJsCount: totalDuplicateJsCount,
        totalUnusedCssCount: totalUnusedCssCount,
        totalEstimatedSavingsBytes: totalEstimatedSavingsBytes
      },
      unusedJsFunctions: unusedJsFunctions,
      autoDetectedSafelist: safelistDetection.autoDetectedSafelist,
      cssPrefixRuleCounts: safelistDetection.cssPrefixRuleCounts,
      stats: {
        indexedClasses: index.usedClasses.size,
        indexedIds: index.usedIds.size,
        indexedCssVars: varGraphResult.usedVars.size,
        indexedJsRefs: index.usedJsRefs.size,
        styleBlocksCount: styleBlockCount,
        scriptBlocksCount: scriptBlockCount,
        scanMs: Date.now() - t0
      }
    },
    blocks: blocks,
    allCssRules: allCssRules
  };
}

function removeRangesDescending(text, ranges) {
  if (!ranges || ranges.length === 0) return text;
  var sorted = ranges
    .filter(function(r) { return r && r.start >= 0 && r.end > r.start && r.end <= text.length; })
    .sort(function(a, b) { return b.start - a.start; });

  var merged = [];
  for (var i = 0; i < sorted.length; i++) {
    var r = sorted[i];
    var prev = merged[merged.length - 1];
    if (prev && r.end > prev.start) {
      prev.start = Math.min(prev.start, r.start);
      prev.end = Math.max(prev.end, r.end);
    } else {
      merged.push({ start: r.start, end: r.end });
    }
  }

  var chunks = [];
  var cursor = text.length;
  for (var k = 0; k < merged.length; k++) {
    var rng = merged[k];
    var rmStart = rng.start;
    var rmEnd = rng.end;
    if (text[rmEnd] === '\\r' && text[rmEnd + 1] === '\\n') rmEnd += 2;
    else if (text[rmEnd] === '\\n') rmEnd += 1;

    var lineStart = text.lastIndexOf('\\n', rmStart - 1) + 1;
    if (/^[ \\t]*$/.test(text.slice(lineStart, rmStart))) {
      rmStart = lineStart;
    }
    if (rmEnd < cursor) chunks.push(text.slice(rmEnd, cursor));
    cursor = rmStart;
  }
  if (cursor > 0) chunks.push(text.slice(0, cursor));
  chunks.reverse();
  return chunks.join('');
}

function runDeadCodeClean(xml, options) {
  var t0 = Date.now();
  var customPrefixes = Array.isArray(options && options.safelistPrefixes) ? options.safelistPrefixes : undefined;
  var analysisBundle = runFullAnalysis(xml, customPrefixes);
  var report = analysisBundle.analysis.report;
  var unusedJsFunctions = analysisBundle.unusedJsFunctions || analysisBundle.analysis.unusedJsFunctions;
  var blocks = analysisBundle.blocks;

  postProgress('cleaning', 78, 'Membersihkan CSS/JS/Variabel mati secara terisolasi (CDATA aman)...');

  var removedCssRulesCount = 0;
  var removedCssVarsCount = 0;
  var removedJsFunctionsCount = 0;
  var removedDuplicateCssCount = 0;
  var removedDuplicateJsCount = 0;
  var removedCommentsCount = 0;
  var removedItemsSummary = [];
  var removedItemsDetail = [];

  function pushAudit(kind, name, line, reason, savedBytes) {
    if (removedItemsDetail.length < 500) {
      removedItemsDetail.push({
        kind: kind,
        name: name,
        line: line || 1,
        reason: reason,
        savedBytes: savedBytes || 0
      });
    }
  }

  // Map block index -> local edits or outer tag removal
  var outerTagRemoveRanges = [];
  var blockLocalRemovals = new Map(); // blockIndex -> Array<{start, end}>

  function addBlockLocalRange(blockIndex, pureStart, pureEnd) {
    var arr = blockLocalRemovals.get(blockIndex) || [];
    arr.push({ start: pureStart, end: pureEnd });
    blockLocalRemovals.set(blockIndex, arr);
  }

  // Build quick offset -> block lookup
  function locateRangeInBlocks(absStart, absEnd) {
    for (var bi = 0; bi < blocks.length; bi++) {
      var b = blocks[bi];
      if (absStart >= b.innerStart && absEnd <= b.innerEnd) {
        var cdata = splitCdataWrapper(b.inner);
        var pureStartAbs = b.innerStart + cdata.prefix.length;
        var pureEndAbs = b.innerEnd - cdata.suffix.length;
        if (absStart >= pureStartAbs && absEnd <= pureEndAbs) {
          return {
            blockIndex: bi,
            localStart: absStart - pureStartAbs,
            localEnd: absEnd - pureStartAbs
          };
        }
      }
    }
    return null;
  }

  if (options.removeDuplicateAssets) {
    for (var da = 0; da < report.duplicateCssAssets.length; da++) {
      var itemA = report.duplicateCssAssets[da];
      if (itemA.removableRanges && itemA.removableRanges.length > 0) {
        for (var r1 = 0; r1 < itemA.removableRanges.length; r1++) {
          outerTagRemoveRanges.push(itemA.removableRanges[r1]);
        }
        removedDuplicateCssCount += itemA.removableRanges.length;
        pushAudit('dup-css', itemA.label, itemA.lines[1] || itemA.lines[0], itemA.reason, itemA.estimatedSavedBytes);
      }
    }
    for (var dj = 0; dj < report.duplicateJsAssets.length; dj++) {
      var itemJ = report.duplicateJsAssets[dj];
      if (itemJ.removableRanges && itemJ.removableRanges.length > 0) {
        for (var r2 = 0; r2 < itemJ.removableRanges.length; r2++) {
          outerTagRemoveRanges.push(itemJ.removableRanges[r2]);
        }
        removedDuplicateJsCount += itemJ.removableRanges.length;
        pushAudit('dup-js', itemJ.label, itemJ.lines[1] || itemJ.lines[0], itemJ.reason, itemJ.estimatedSavedBytes);
      }
    }
  }

  if (options.removeDuplicateCssRules) {
    for (var dc = 0; dc < report.duplicateCssRules.length; dc++) {
      var dupRule = report.duplicateCssRules[dc];
      var rngs = dupRule.removableRanges || [];
      var addedForDup = 0;
      for (var dr = 0; dr < rngs.length; dr++) {
        var locD = locateRangeInBlocks(rngs[dr].start, rngs[dr].end);
        if (locD) {
          addBlockLocalRange(locD.blockIndex, locD.localStart, locD.localEnd);
          removedDuplicateCssCount++;
          addedForDup++;
        }
      }
      if (addedForDup > 0) {
        pushAudit('dup-css', dupRule.selector, dupRule.lines[0], dupRule.reason, dupRule.estimatedSavedBytes);
      }
    }
  }

  if (options.removeUnusedCssRules) {
    for (var uc = 0; uc < report.unusedCssRules.length; uc++) {
      var uCss = report.unusedCssRules[uc];
      if (uCss.confidence !== 'pasti' || !uCss.range) continue;
      var locU = locateRangeInBlocks(uCss.range.start, uCss.range.end);
      if (locU) {
        addBlockLocalRange(locU.blockIndex, locU.localStart, locU.localEnd);
        removedCssRulesCount++;
        pushAudit('css-rule', uCss.selector, uCss.line, uCss.reason, uCss.estimatedBytes);
      }
    }
  }

  if (options.removeUnusedCssVars) {
    for (var uv = 0; uv < report.unusedCssVars.length; uv++) {
      var uVar = report.unusedCssVars[uv];
      if (!uVar.range) continue;
      var locV = locateRangeInBlocks(uVar.range.start, uVar.range.end);
      if (locV) {
        addBlockLocalRange(locV.blockIndex, locV.localStart, locV.localEnd);
        removedCssVarsCount++;
        pushAudit(
          'css-var',
          uVar.name + ' (' + uVar.selector + ')',
          uVar.line,
          'Tidak dipanggil oleh var(--*), variabel berantai, maupun JS setProperty.',
          uVar.declarationRaw ? uVar.declarationRaw.length : 24
        );
      }
    }
  }

  if (options.removeDeadJsFunctions) {
    for (var jf = 0; jf < unusedJsFunctions.length; jf++) {
      var fn = unusedJsFunctions[jf];
      addBlockLocalRange(fn.blockIndex, fn.startInCode, fn.endInCode);
      removedJsFunctionsCount++;
      pushAudit(
        'js-function',
        'function ' + fn.name + '(' + fn.params + ')',
        fn.line,
        'Tidak ditemukan pemanggilan di HTML statis, atribut inline (onclick/onchange), template literal, maupun blok script lainnya.',
        fn.estimatedBytes
      );
    }
  }

  // Reconstruct XML safely: process each isolated block's pureCode ONLY, then re-wrap with original CDATA!
  var removedTagSet = new Set(outerTagRemoveRanges.map(function(r) { return r.start + ':' + r.end; }));
  var outParts = [];
  var xmlCursor = 0;

  for (var bi2 = 0; bi2 < blocks.length; bi2++) {
    var blk2 = blocks[bi2];
    if (blk2.fullStart > xmlCursor) {
      outParts.push(xml.slice(xmlCursor, blk2.fullStart));
    }

    if (removedTagSet.has(blk2.fullStart + ':' + blk2.fullEnd)) {
      xmlCursor = blk2.fullEnd;
      continue;
    }

    var cdata2 = splitCdataWrapper(blk2.inner);
    var pure = cdata2.pureCode;
    var localRemovals = blockLocalRemovals.get(bi2);
    if (localRemovals && localRemovals.length > 0) {
      pure = removeRangesDescending(pure, localRemovals);
    }

    if (blk2.lowerTag !== 'script') {
      // Remove empty @media / @supports / @layer blocks created inside pure CSS
      pure = pure.replace(/@(?:media|supports|layer)\\b[^{}]*\\{\\s*\\}\\s*(?:\\r?\\n)?/gi, '');
      if (options.removeCssJsComments) {
        var cssStripped = stripCssCommentsSafely(pure);
        pure = cssStripped.code;
        removedCommentsCount += cssStripped.strippedCount;
      }
    } else {
      var typeAttr2 = getAttrValue(blk2.attrs, 'type').toLowerCase();
      if (options.removeCssJsComments && typeAttr2.indexOf('ld+json') === -1) {
        var jsStripped = stripJsCommentsSafely(pure);
        pure = jsStripped.code;
        removedCommentsCount += jsStripped.strippedCount;
      }
    }

    // Re-wrap with intact CDATA tokens (escape accidental ]]> inside pureCode only if CDATA wrapped)
    if (cdata2.hasCdata) {
      pure = pure.replace(/\\]\\]>/g, ']]&gt;');
    }

    var openTag = '<' + blk2.tagName + blk2.attrs + '>';
    var closeTag = '</' + blk2.tagName + '>';
    outParts.push(openTag + cdata2.prefix + pure + cdata2.suffix + closeTag);
    xmlCursor = blk2.fullEnd;
  }

  if (xmlCursor < xml.length) {
    outParts.push(xml.slice(xmlCursor));
  }

  var cleanedXml = outParts.join('');

  // Handle any outer <link> duplicate CSS assets outside <style>/<script> blocks
  var linkRemoveRanges = outerTagRemoveRanges.filter(function(r) {
    for (var bi3 = 0; bi3 < blocks.length; bi3++) {
      if (blocks[bi3].fullStart === r.start && blocks[bi3].fullEnd === r.end) return false;
    }
    return true;
  });
  if (linkRemoveRanges.length > 0) {
    cleanedXml = removeRangesDescending(cleanedXml, linkRemoveRanges);
  }

  if (removedCssRulesCount > 0) removedItemsSummary.push(removedCssRulesCount + ' aturan CSS mati dihapus');
  if (removedCssVarsCount > 0) removedItemsSummary.push(removedCssVarsCount + ' variabel CSS (--*) tak terpakai dihapus');
  if (removedJsFunctionsCount > 0) removedItemsSummary.push(removedJsFunctionsCount + ' fungsi JavaScript mati dihapus');
  if (removedDuplicateCssCount > 0) removedItemsSummary.push(removedDuplicateCssCount + ' duplikat aturan/aset CSS dihapus');
  if (removedDuplicateJsCount > 0) removedItemsSummary.push(removedDuplicateJsCount + ' duplikat skrip JS dihapus');
  if (removedCommentsCount > 0) removedItemsSummary.push(removedCommentsCount + ' komentar CSS/JS di dalam CDATA dibersihkan');

  var originalBytes = xml.length;
  var cleanedBytes = cleanedXml.length;

  return {
    cleanedXml: cleanedXml,
    stats: {
      originalBytes: originalBytes,
      cleanedBytes: cleanedBytes,
      savedBytes: Math.max(0, originalBytes - cleanedBytes),
      removedCssRulesCount: removedCssRulesCount,
      removedCssVarsCount: removedCssVarsCount,
      removedJsFunctionsCount: removedJsFunctionsCount,
      removedDuplicateCssCount: removedDuplicateCssCount,
      removedDuplicateJsCount: removedDuplicateJsCount,
      removedCommentsCount: removedCommentsCount,
      durationMs: Date.now() - t0
    },
    removedItemsSummary: removedItemsSummary,
    removedItemsDetail: removedItemsDetail
  };
}

// ============================================================
// 6. ITERATIVE AUTO-FIX ENGINE (COORDINATION WITH DOMParser)
// ============================================================

function segmentXmlForAutoFix(xml) {
  var segments = [];
  var tokenRegex = /(<!\\[CDATA\\[[\\s\\S]*?\\]\\]>|<!--[\\s\\S]*?-->|<\\?[\\s\\S]*?\\?>|<!DOCTYPE[\\s\\S]*?>)/gi;
  var lastIndex = 0;
  var match;
  while ((match = tokenRegex.exec(xml)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'code', text: xml.slice(lastIndex, match.index), start: lastIndex });
    }
    var tok = match[0];
    var segType = tok.startsWith('<![CDATA[') ? 'cdata' : (tok.startsWith('<!--') ? 'comment' : 'pi');
    segments.push({ type: segType, text: tok, start: match.index });
    lastIndex = match.index + tok.length;
  }
  if (lastIndex < xml.length) {
    segments.push({ type: 'code', text: xml.slice(lastIndex), start: lastIndex });
  }
  return segments;
}

function fixCdataIntegrity(xml, fixesApplied) {
  var out = xml;

  // A. Fix unclosed <![CDATA[ inside <b:skin>, <b:template-skin>, <script>, <style>
  var unclosedCount = 0;
  out = out.replace(/(<!\\[CDATA\\[(?:(?!\\]\\]>)[\\s\\S])*?)(<\\/(?:b:skin|b:template-skin|script|style)>)/gi, function(_, openPart, closeTag) {
    unclosedCount++;
    var isCssJs = /<\\/(?:script|style)>/i.test(closeTag);
    return openPart + (isCssJs ? '\\n/*]]>*/\\n' : '\\n]]>\\n') + closeTag;
  });
  if (unclosedCount > 0) {
    fixesApplied.push('Menutup ' + unclosedCount + ' blok <![CDATA[ yang belum memiliki penutup ]]>');
  }

  // B. Fix orphan ]]> inside <style>/<b:skin>/<script> without preceding <![CDATA[
  var orphanInsideCount = 0;
  out = out.replace(/<(b:skin|b:template-skin|script|style)\\b([^>]*)>([\\s\\S]*?)<\\/\\1>/gi, function(full, tagName, attrs, inner) {
    var openCount = (inner.match(/<!\\[CDATA\\[/g) || []).length;
    var closeCount = (inner.match(/\\]\\]>/g) || []).length;
    if (closeCount > openCount && openCount === 0) {
      orphanInsideCount++;
      var lower = tagName.toLowerCase();
      var opener = lower === 'script' ? '\\n//<![CDATA[\\n' : (lower === 'style' ? '\\n/*<![CDATA[*/\\n' : '\\n<![CDATA[\\n');
      return '<' + tagName + attrs + '>' + opener + inner.trimStart() + '</' + tagName + '>';
    }
    return full;
  });
  if (orphanInsideCount > 0) {
    fixesApplied.push('Menyisipkan pembuka <![CDATA[ untuk ' + orphanInsideCount + ' penutup ]]> yang kehilangan pembuka');
  }

  // B2. Escape stray ]]> inside existing CDATA wrappers of <b:skin>, <b:template-skin>, <script>, <style>
  var strayInsideCdata = 0;
  out = out.replace(/<(b:skin|b:template-skin|script|style)\\b([^>]*)>([\\s\\S]*?)<\\/\\1>/gi, function(full, tagName, attrs, inner) {
    var hasOpen = /<!\\[CDATA\\[/i.test(inner);
    if (!hasOpen) return full;
    var openCount = (inner.match(/<!\\[CDATA\\[/g) || []).length;
    var closeCount = (inner.match(/\\]\\]>/g) || []).length;
    if (closeCount <= openCount) return full;
    var lastCloseIdx = inner.lastIndexOf(']]>');
    if (lastCloseIdx === -1) return full;
    var headPart = inner.slice(0, lastCloseIdx);
    var tailPart = inner.slice(lastCloseIdx);
    var firstOpenIdx = headPart.indexOf('<![CDATA[');
    if (firstOpenIdx === -1) return full;
    var beforeCdata = headPart.slice(0, firstOpenIdx + 9);
    var cdataBody = headPart.slice(firstOpenIdx + 9);
    var fixedBody = cdataBody.replace(/\\]\\]>/g, function() {
      strayInsideCdata++;
      return ']]&gt;';
    });
    if (fixedBody === cdataBody) return full;
    return '<' + tagName + attrs + '>' + beforeCdata + fixedBody + tailPart + '</' + tagName + '>';
  });
  if (strayInsideCdata > 0) {
    fixesApplied.push('Meng-escape ' + strayInsideCdata + ' token ]]> liar di dalam blok CDATA');
  }

  // C. Remove orphan ]]> outside code blocks (outside any <![CDATA[...]]>)
  var segs = segmentXmlForAutoFix(out);
  var orphanOuterCount = 0;
  out = segs.map(function(seg) {
    if (seg.type !== 'code') return seg.text;
    return seg.text.replace(/\\]\\]>/g, function() {
      orphanOuterCount++;
      return ']]&gt;';
    });
  }).join('');
  if (orphanOuterCount > 0) {
    fixesApplied.push('Menetralkan ' + orphanOuterCount + ' token ]]> yatim di luar blok CDATA');
  }

  // D. Wrap unprotected <b:skin>, <b:template-skin>, <script>, <style> containing raw &, <, or >
  //    (ignore Blogger XML tags <b:...>, <data:...>, <Group, <Variable inside skin/script,
  //     and skip <script> with src/expr:src, application/ld+json, or dynamic Blogger tags/data:)
  var wrappedCount = 0;
  out = out.replace(/<(b:skin|b:template-skin|script|style)\\b((?:"[^"]*"|'[^']*'|[^>"'\\/]|\\/(?!>))*)>([\\s\\S]*?)<\\/\\1>/gi, function(full, tagName, attrs, inner) {
    if (!inner.trim() || /<!\\[CDATA\\[/i.test(inner)) return full;
    var lower = tagName.toLowerCase();
    if (lower === 'script') {
      var hasSrcAttr = /(?:^|\\s)(?:expr:)?src\\s*=/i.test(attrs);
      var isJsonLd = /(?:^|\\s)type\\s*=\\s*(?:"application\\/ld\\+json"|'application\\/ld\\+json')/i.test(attrs);
      var hasDynamicBlogger =
        /<b:(?:eval|if|elseif|else|loop|with|switch|case|attr|class|variable)\\b/i.test(inner) ||
        /<data:[a-zA-Z_][a-zA-Z0-9_.-]*/i.test(inner) ||
        /\\bdata:[a-zA-Z_][a-zA-Z0-9_.-]*/i.test(inner);
      if (hasSrcAttr || isJsonLd || hasDynamicBlogger) return full;
    }
    var testText = inner.replace(/<\\/?(?:b:|data:|expr:|Group\\b|Variable\\b)(?:"[^"]*"|'[^']*'|[^>"'])*>/gi, '');
    if (!/[&<>]/.test(testText)) return full;
    wrappedCount++;
    var safeInner = inner.replace(/\\]\\]>/g, ']]&gt;').trim();
    if (lower === 'script') {
      return '<' + tagName + attrs + '>\\n//<![CDATA[\\n' + safeInner + '\\n//]]>\\n</' + tagName + '>';
    }
    if (lower === 'style') {
      return '<' + tagName + attrs + '>\\n/*<![CDATA[*/\\n' + safeInner + '\\n/*]]>*/\\n</' + tagName + '>';
    }
    return '<' + tagName + attrs + '><![CDATA[\\n' + safeInner + '\\n]]></' + tagName + '>';
  });
  if (wrappedCount > 0) {
    fixesApplied.push('Membungkus ' + wrappedCount + ' blok <style>/<b:skin>/<script> dengan CDATA yang aman');
  }

  return out;
}

function findCondAndExprAttrSpanWorker(tagText, eqEndIdx, outerQuote) {
  var len = tagText.length;
  var firstQ = tagText.indexOf(outerQuote, eqEndIdx);
  if (firstQ !== -1) {
    var afterFirst = tagText.slice(firstQ + 1);
    if (/^\\s*(?:\\/?>|[a-zA-Z_:][a-zA-Z0-9_.:-]*\\s*=(?!=))/.test(afterFirst)) {
      return { valueEndIdx: firstQ, hasCollision: false };
    }
  }
  var i = eqEndIdx;
  var candidateEnds = [];
  while (i < len) {
    if (tagText[i] === outerQuote) {
      var after = tagText.slice(i + 1);
      if (/^\\s*(?:\\/?>|[a-zA-Z_:][a-zA-Z0-9_.:-]*\\s*=(?!=))/.test(after)) {
        candidateEnds.push(i);
      }
    }
    i++;
  }
  if (candidateEnds.length === 0) {
    var lastQ = tagText.lastIndexOf(outerQuote);
    if (lastQ >= eqEndIdx) {
      var rawInnerFallback = tagText.slice(eqEndIdx, lastQ);
      return { valueEndIdx: lastQ, hasCollision: rawInnerFallback.indexOf(outerQuote) !== -1 };
    }
    return { valueEndIdx: eqEndIdx, hasCollision: false };
  }
  var chosenEnd = candidateEnds[0];
  var qRe = new RegExp(outerQuote, 'g');
  for (var c = 0; c < candidateEnds.length; c++) {
    var endIdx = candidateEnds[c];
    var inner = tagText.slice(eqEndIdx, endIdx);
    var innerSameQuotes = (inner.match(qRe) || []).length;
    if (innerSameQuotes % 2 === 0 && !/^\\s*(?:==|!=|&&|\\|\\||[?:,+])/.test(inner.trim())) {
      chosenEnd = endIdx;
      var trailing = tagText.slice(endIdx + 1).trimStart();
      if (!/^(?:==|!=|and\\b|or\\b|contains\\b|not\\b|in\\b|[)\\],?:+])/.test(trailing)) {
        if (c + 1 < candidateEnds.length) {
          var nextAfter = tagText.slice(endIdx + 1, candidateEnds[c + 1]);
          if (/^[a-zA-Z0-9_.-]+['"]?\\s*$/.test(nextAfter) || /^\\s*(?:==|!=|&&|\\|\\||[),])/.test(nextAfter)) {
            continue;
          }
        }
        break;
      }
    } else {
      chosenEnd = endIdx;
    }
  }
  var finalInner = tagText.slice(eqEndIdx, chosenEnd);
  return {
    valueEndIdx: chosenEnd,
    hasCollision: finalInner.indexOf(outerQuote) !== -1
  };
}

function fixQuoteCollisionsInTagWorker(tagText) {
  var openMatch = /^<\\s*[a-zA-Z_][a-zA-Z0-9:_-]*/.exec(tagText);
  if (!openMatch) return { fixedTag: tagText, fixedCount: 0 };

  var len = tagText.length;
  var i = openMatch[0].length;
  var out = tagText.slice(0, i);
  var fixedCount = 0;

  while (i < len) {
    var wsMatch = /^\\s+/.exec(tagText.slice(i));
    if (wsMatch) {
      out += wsMatch[0];
      i += wsMatch[0].length;
    }
    if (i >= len) break;

    if (tagText[i] === '>' || tagText.indexOf('/>', i) === i) {
      out += tagText.slice(i);
      break;
    }

    var attrNameMatch = /^[a-zA-Z_:][a-zA-Z0-9_.:-]*/.exec(tagText.slice(i));
    if (!attrNameMatch) {
      out += tagText[i];
      i++;
      continue;
    }

    var attrStart = i;
    var attrName = attrNameMatch[0];
    i += attrName.length;

    var eqMatch = /^\\s*=\\s*(['"])/.exec(tagText.slice(i));
    if (!eqMatch) {
      out += attrName;
      continue;
    }

    var outerQuote = eqMatch[1];
    var valStart = i + eqMatch[0].length;
    var isTargetAttr = /^(?:cond|expr:[a-zA-Z0-9_-]+)$/i.test(attrName);

    if (!isTargetAttr) {
      var closeQ = tagText.indexOf(outerQuote, valStart);
      if (closeQ === -1) {
        out += tagText.slice(attrStart);
        break;
      }
      out += tagText.slice(attrStart, closeQ + 1);
      i = closeQ + 1;
      continue;
    }

    var span = findCondAndExprAttrSpanWorker(tagText, valStart, outerQuote);
    if (!span.hasCollision || span.valueEndIdx <= valStart) {
      out += tagText.slice(attrStart, span.valueEndIdx + 1);
      i = span.valueEndIdx + 1;
      continue;
    }
    fixedCount++;
    var rawInner = tagText.slice(valStart, span.valueEndIdx);
    var altQuote = outerQuote === '"' ? "'" : '"';
    if (rawInner.indexOf(altQuote) === -1) {
      out += attrName + '=' + altQuote + rawInner + altQuote;
    } else {
      var escaped = rawInner.replace(
        new RegExp(outerQuote, 'g'),
        outerQuote === '"' ? '&quot;' : '&#39;'
      );
      out += attrName + '=' + outerQuote + escaped + outerQuote;
    }
    i = span.valueEndIdx + 1;
  }
  return { fixedTag: out, fixedCount: fixedCount };
}

var WORKER_VALID_ENTITIES = new Set([
  'amp','lt','gt','quot','apos',
  'nbsp','copy','reg','trade','laquo','raquo','lsaquo','rsaquo','mdash','ndash','hellip',
  'lsquo','rsquo','ldquo','rdquo','sbquo','bdquo','bull','middot','deg','times','divide',
  'plusmn','frac12','frac14','frac34','euro','pound','yen','cent','sect','para',
  'larr','uarr','rarr','darr','harr','hearts','spades','clubs','diams',
  'iexcl','iquest','permil','dagger','Dagger','prime','Prime','asymp','ne','le','ge','infin','minus',
  'agrave','aacute','acirc','atilde','auml','aring','aelig','ccedil','egrave','eacute','ecirc','euml',
  'igrave','iacute','icirc','iuml','ntilde','ograve','oacute','ocirc','otilde','ouml','oslash',
  'ugrave','uacute','ucirc','uuml','yacute','yuml','szlig','ensp','emsp','thinsp','zwnj','zwj','lrm','rlm'
]);

function escapeBareAmpersandsWorker(code) {
  var cnt = 0;
  var out = code.replace(/&([a-zA-Z][a-zA-Z0-9]*;|#\\d+;|#x[0-9a-fA-F]+;)?/g, function(full, entityPart) {
    if (entityPart) {
      var rawName = entityPart.slice(0, -1);
      if (rawName[0] === '#' || WORKER_VALID_ENTITIES.has(rawName) || WORKER_VALID_ENTITIES.has(rawName.toLowerCase())) {
        return full;
      }
    }
    cnt++;
    return '&amp;' + (entityPart || '');
  });
  return { text: out, count: cnt };
}

function fixBloggerCondAndExprQuotes(code, counterObj) {
  return code.replace(
    /<[a-zA-Z][a-zA-Z0-9:_-]*\\b(?:"[^"]*"|'[^']*'|[^>"'])*>/g,
    function(fullTag) {
      if (!/\\s(?:cond|expr:[a-zA-Z0-9_-]+)\\s*=\\s*['"]/i.test(fullTag)) return fullTag;
      var res = fixQuoteCollisionsInTagWorker(fullTag);
      counterObj.quoteFixed += res.fixedCount;
      return res.fixedTag;
    }
  );
}

function autoFixDeterministicRound(xml) {
  var fixesApplied = [];
  var out = xml;

  // 1. CDATA Integrity
  out = fixCdataIntegrity(out, fixesApplied);

  // 2. Fix '--' inside XML comments <!-- ... -->
  var commentHyphenFixes = 0;
  out = out.replace(/<!--([\\s\\S]*?)-->/g, function(full, inner) {
    if (inner.indexOf('--') === -1) return full;
    commentHyphenFixes++;
    return '<!--' + inner.replace(/--+/g, '- -') + '-->';
  });
  if (commentHyphenFixes > 0) {
    fixesApplied.push('Menormalkan "--" pada ' + commentHyphenFixes + ' komentar XML');
  }

  // 3. Outside CDATA & comments: quote collisions, duplicate IDs, ampersands, void tags, boolean XHTML attrs
  var ampFixed = 0;
  var voidFixed = 0;
  var boolFixed = 0;
  var quoteCounter = { quoteFixed: 0 };
  var dupIdsFixed = 0;

  var usedSectionIds = new Set();
  var usedWidgetIds = new Set();
  var firstSeenSections = new Set();
  var firstSeenWidgets = new Set();
  var preIdRe = /<(b:section|b:widget)\\b([^>]*)>/gi;
  var preM;
  while ((preM = preIdRe.exec(out)) !== null) {
    var idM = /\\bid\\s*=\\s*(?:"([^"]*)"|'([^']*)')/i.exec(preM[2]);
    var idV = (idM && (idM[1] || idM[2]) ? (idM[1] || idM[2]) : '').trim();
    if (!idV) continue;
    if (preM[1].toLowerCase() === 'b:section') usedSectionIds.add(idV);
    else usedWidgetIds.add(idV);
  }
  function nextUniqueIdWorker(baseId, usedSet) {
    var m = /^(.*?)(\\d+)$/.exec(baseId);
    var prefix = m ? m[1] : baseId + '-';
    var n = m ? parseInt(m[2], 10) + 1 : 2;
    while (usedSet.has(prefix + n)) n++;
    var candidate = prefix + n;
    usedSet.add(candidate);
    return candidate;
  }

  var segs = segmentXmlForAutoFix(out);
  out = segs.map(function(seg) {
    if (seg.type !== 'code') return seg.text;
    var code = seg.text;

    // 3.0 Fix quote collisions in cond / expr:*
    code = fixBloggerCondAndExprQuotes(code, quoteCounter);

    // 3.0b Auto-renumber duplicate <b:section> and <b:widget> IDs
    code = code.replace(/<(b:section|b:widget)\\b([^>]*)>/gi, function(fullTag, tagName, attrs) {
      var lower = tagName.toLowerCase();
      var idM = /\\bid\\s*=\\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
      var idV = (idM && (idM[1] || idM[2]) ? (idM[1] || idM[2]) : '').trim();
      if (!idV) return fullTag;
      if (lower === 'b:section') {
        if (!firstSeenSections.has(idV)) {
          firstSeenSections.add(idV);
          return fullTag;
        }
        var nextSecId = nextUniqueIdWorker(idV, usedSectionIds);
        dupIdsFixed++;
        return fullTag.replace(/\\bid\\s*=\\s*(["'])([^"']*)(\\1)/i, 'id=$1' + nextSecId + '$3');
      }
      if (!firstSeenWidgets.has(idV)) {
        firstSeenWidgets.add(idV);
        return fullTag;
      }
      var nextWidId = nextUniqueIdWorker(idV, usedWidgetIds);
      dupIdsFixed++;
      return fullTag.replace(/\\bid\\s*=\\s*(["'])([^"']*)(\\1)/i, 'id=$1' + nextWidId + '$3');
    });

    // Escape only genuinely bare '&' (preserve XML and HTML named entities like &nbsp;, &copy;, &raquo;)
    var ampRes = escapeBareAmpersandsWorker(code);
    code = ampRes.text;
    ampFixed += ampRes.count;

    // Fix bare boolean attributes outside quotes
    code = code.replace(/<([a-zA-Z][a-zA-Z0-9:_-]*)((?:\\s+(?:"[^"]*"|'[^']*'|[^>"'\\/]|\\/(?!>))+)?)\\s*(\\/?)>/g, function(full, tagName, attrs, slash) {
      if (!attrs) return full;
      var lowerT = tagName.toLowerCase();
      if (lowerT.indexOf('b:') === 0 || lowerT.indexOf('data:') === 0 || lowerT === 'variable' || lowerT === 'group') {
        return full;
      }
      var resBool = fixBareBooleanAttrsWorker(attrs);
      if (resBool.fixedCount === 0) return full;
      boolFixed += resBool.fixedCount;
      return '<' + tagName + resBool.updatedAttrs + slash + '>';
    });

    return code;
  }).join('');

  // Only self-close UNPAIRED void tags and remove ORPHAN closing void tags
  // (preserve valid paired <img>...</img> and <input>...</input> containing <b:attr>/<b:class>)
  var voidSegs = segmentXmlForAutoFix(out);
  var voidStack = [];
  var voidEditsBySeg = {};
  var voidTagRe = /<(\\/?)([a-zA-Z][a-zA-Z0-9:_-]*)((?:\\s+(?:"[^"]*"|'[^']*'|[^>"'\\/]|\\/(?!>))*)?)\\s*(\\/?)>/g;
  for (var vSegIdx = 0; vSegIdx < voidSegs.length; vSegIdx++) {
    var vSeg = voidSegs[vSegIdx];
    if (vSeg.type !== 'code') continue;
    voidTagRe.lastIndex = 0;
    var vtMatch;
    while ((vtMatch = voidTagRe.exec(vSeg.text)) !== null) {
      var vtIsClose = vtMatch[1] === '/';
      var vtName = vtMatch[2];
      var vtLower = vtName.toLowerCase();
      var vtIsSelf = vtMatch[4] === '/' || (!vtIsClose && vtMatch[0].slice(0, -1).trim().endsWith('/'));
      if (vtIsSelf) continue;
      if (!vtIsClose) {
        voidStack.push({
          name: vtName,
          segIdx: vSegIdx,
          start: vtMatch.index,
          end: vtMatch.index + vtMatch[0].length,
          isVoid: VOID_TAGS.has(vtLower)
        });
      } else {
        var vMatchPos = -1;
        for (var vs = voidStack.length - 1; vs >= 0; vs--) {
          if (voidStack[vs].name === vtName) { vMatchPos = vs; break; }
        }
        if (vMatchPos === -1) {
          if (VOID_TAGS.has(vtLower)) {
            if (!voidEditsBySeg[vSegIdx]) voidEditsBySeg[vSegIdx] = [];
            voidEditsBySeg[vSegIdx].push({ start: vtMatch.index, end: vtMatch.index + vtMatch[0].length, action: 'remove' });
          }
        } else {
          var vUnclosed = voidStack.splice(vMatchPos + 1);
          for (var vu = 0; vu < vUnclosed.length; vu++) {
            if (vUnclosed[vu].isVoid) {
              var vuSeg = vUnclosed[vu].segIdx;
              if (!voidEditsBySeg[vuSeg]) voidEditsBySeg[vuSeg] = [];
              voidEditsBySeg[vuSeg].push({ start: vUnclosed[vu].start, end: vUnclosed[vu].end, action: 'selfClose' });
            }
          }
          voidStack.pop();
        }
      }
    }
  }
  for (var vl = 0; vl < voidStack.length; vl++) {
    if (voidStack[vl].isVoid) {
      var vlSeg = voidStack[vl].segIdx;
      if (!voidEditsBySeg[vlSeg]) voidEditsBySeg[vlSeg] = [];
      voidEditsBySeg[vlSeg].push({ start: voidStack[vl].start, end: voidStack[vl].end, action: 'selfClose' });
    }
  }
  out = voidSegs.map(function(vSeg2, vIdx2) {
    if (vSeg2.type !== 'code') return vSeg2.text;
    var edits = voidEditsBySeg[vIdx2];
    if (!edits || edits.length === 0) return vSeg2.text;
    edits.sort(function(a, b) { return b.start - a.start; });
    var txt = vSeg2.text;
    for (var ei = 0; ei < edits.length; ei++) {
      voidFixed++;
      if (edits[ei].action === 'remove') {
        txt = txt.slice(0, edits[ei].start) + txt.slice(edits[ei].end);
      } else {
        var origT = txt.slice(edits[ei].start, edits[ei].end);
        txt = txt.slice(0, edits[ei].start) + origT.replace(/\\s*>$/, '/>') + txt.slice(edits[ei].end);
      }
    }
    return txt;
  }).join('');

  if (quoteCounter.quoteFixed > 0) fixesApplied.push('Memperbaiki ' + quoteCounter.quoteFixed + ' benturan tanda kutip pada atribut cond / expr:*');
  if (dupIdsFixed > 0) fixesApplied.push('Menomori ulang ' + dupIdsFixed + ' ID duplikat (<b:section>/<b:widget>)');
  if (ampFixed > 0) fixesApplied.push('Mengubah ' + ampFixed + ' karakter "&" mentah menjadi "&amp;"');
  if (voidFixed > 0) fixesApplied.push('Menutup ' + voidFixed + ' tag HTML tunggal (<meta>, <link>, <img>, <br>, dll.) menjadi self-closing "/>"');
  if (boolFixed > 0) fixesApplied.push('Memperbaiki ' + boolFixed + ' atribut boolean XHTML (async/defer/crossorigin)');

  // 4. XML declaration & Blogger namespaces on <html>
  if (!/^\\s*<\\?xml\\b/i.test(out)) {
    out = '<?xml version="1.0" encoding="UTF-8" ?>\\n' + out;
    fixesApplied.push('Menambahkan deklarasi <?xml version="1.0" encoding="UTF-8" ?>');
  }

  out = out.replace(/<html\\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/i, function(full, attrs) {
    var nextAttrs = attrs;
    var changed = false;
    if (!/xmlns\\s*=/.test(nextAttrs)) { nextAttrs += " xmlns='http://www.w3.org/1999/xhtml'"; changed = true; }
    if (!/xmlns:b\\s*=/.test(nextAttrs)) { nextAttrs += " xmlns:b='http://www.google.com/2005/gml/b'"; changed = true; }
    if (!/xmlns:data\\s*=/.test(nextAttrs)) { nextAttrs += " xmlns:data='http://www.google.com/2005/gml/data'"; changed = true; }
    if (!/xmlns:expr\\s*=/.test(nextAttrs)) { nextAttrs += " xmlns:expr='http://www.google.com/2005/gml/expr'"; changed = true; }
    if (changed) {
      fixesApplied.push('Melengkapi namespace XML Blogger pada tag <html>');
      return '<html' + nextAttrs + '>';
    }
    return full;
  });

  return { fixedXml: out, fixesApplied: fixesApplied };
}

function autoFixTargetedRound(xml, parserError, round) {
  var fixesApplied = [];
  var out = xml;
  var errMsg = (parserError && parserError.message) ? String(parserError.message) : '';
  var errLine = (parserError && parserError.line) ? parserError.line : 1;

  // Step A: Targeted fixes based on DOMParser("text/xml") diagnostic message
  if (/Open quote is expected|must be followed by either attribute|Attribute name|attributes construct error/i.test(errMsg)) {
    var segsQuote = segmentXmlForAutoFix(out);
    var qc = { quoteFixed: 0 };
    out = segsQuote.map(function(seg) {
      if (seg.type !== 'code') return seg.text;
      return fixBloggerCondAndExprQuotes(seg.text, qc);
    }).join('');
    if (qc.quoteFixed > 0) {
      fixesApplied.push('Putaran ' + round + ': Memperbaiki ' + qc.quoteFixed + ' benturan kutip pada atribut cond / expr:*');
    }
  }

  if (/double hyphen|within comment/i.test(errMsg)) {
    var cFixes = 0;
    out = out.replace(/<!--([\\s\\S]*?)-->/g, function(full, inner) {
      if (inner.indexOf('--') === -1) return full;
      cFixes++;
      return '<!--' + inner.replace(/--+/g, '- -') + '-->';
    });
    if (cFixes > 0) fixesApplied.push('Putaran ' + round + ': Menghapus "--" di dalam komentar XML');
  }

  if (/EntityRef|entity|xmlParseEntityRef/i.test(errMsg)) {
    var segsAmp = segmentXmlForAutoFix(out);
    var ampCnt = 0;
    out = segsAmp.map(function(seg) {
      if (seg.type !== 'code') return seg.text;
      var ampRes2 = escapeBareAmpersandsWorker(seg.text);
      ampCnt += ampRes2.count;
      return ampRes2.text;
    }).join('');
    if (ampCnt > 0) fixesApplied.push('Putaran ' + round + ': Escape ' + ampCnt + ' entitas "&" rusak');
  }

  if (/redefined|already specified|duplicate attribute/i.test(errMsg)) {
    var segsDup = segmentXmlForAutoFix(out);
    var lsDup = buildLineStarts(out);
    var dupAttrFixes = 0;
    out = segsDup.map(function(seg) {
      if (seg.type !== 'code') return seg.text;
      var segStartLine = lineAtOffset(lsDup, seg.start);
      var segEndLine = lineAtOffset(lsDup, seg.start + seg.text.length);
      if (errLine < segStartLine - 2 || errLine > segEndLine + 2) return seg.text;
      return seg.text.replace(/<([a-zA-Z][a-zA-Z0-9:_-]*)((?:\\s+(?:"[^"]*"|'[^']*'|[^>"'])+))(\\/?)>/g, function(full, tName, attrs, slash) {
        var seenAttrs = new Set();
        var changedAttr = false;
        var attrRe = /\\s+([a-zA-Z_:][a-zA-Z0-9_.:-]*)\\s*=\\s*(?:"[^"]*"|'[^']*')/g;
        var rebuiltAttrs = attrs.replace(attrRe, function(aFull, aName) {
          var key = aName.toLowerCase();
          if (seenAttrs.has(key)) { changedAttr = true; dupAttrFixes++; return ''; }
          seenAttrs.add(key);
          return aFull;
        });
        return changedAttr ? '<' + tName + rebuiltAttrs + slash + '>' : full;
      });
    }).join('');
    if (dupAttrFixes > 0) {
      fixesApplied.push('Putaran ' + round + ': Menghapus ' + dupAttrFixes + ' atribut duplikat di sekitar baris ' + errLine);
    }
  }

  // Handle stray '<' strictly outside CDATA/comments around errLine
  if (/StartTag:\\s*invalid element name|not well-formed/i.test(errMsg)) {
    var segsLt = segmentXmlForAutoFix(out);
    var lsLt = buildLineStarts(out);
    var strayLtCount = 0;
    out = segsLt.map(function(seg) {
      if (seg.type !== 'code') return seg.text;
      var segStartLine = lineAtOffset(lsLt, seg.start);
      var segEndLine = lineAtOffset(lsLt, seg.start + seg.text.length);
      if (errLine < segStartLine - 3 || errLine > segEndLine + 3) return seg.text;
      var segLines = seg.text.split('\\n');
      for (var li = 0; li < segLines.length; li++) {
        var curLineNo = segStartLine + li;
        if (Math.abs(curLineNo - errLine) <= 3) {
          segLines[li] = segLines[li].replace(/<(?![a-zA-Z\\/?!])/g, function() {
            strayLtCount++;
            return '&lt;';
          });
        }
      }
      return segLines.join('\\n');
    }).join('');
    if (strayLtCount > 0) {
      fixesApplied.push('Putaran ' + round + ': Meng-escape ' + strayLtCount + ' simbol "<" liar di sekitar baris ' + errLine);
    }
  }

  // Step B: Quote-aware tag balance & mismatch repair outside CDATA/comments
  var beforeTagFix = out;
  var segs = segmentXmlForAutoFix(out);
  var stack = [];
  var balancedCount = 0;

  var balanced = segs.map(function(seg) {
    if (seg.type !== 'code') return seg.text;
    return seg.text.replace(/<\\/?([a-zA-Z][a-zA-Z0-9:_-]*)((?:\\s+(?:"[^"]*"|'[^']*'|[^>"'\\/]|\\/(?!>))*)?)\\s*(\\/?)>/g, function(full, tagName, attrs, slash) {
      var isClosing = full.startsWith('</');
      var isSelfClosing = slash === '/' || (!isClosing && full.slice(0, -1).trim().endsWith('/'));
      if (isSelfClosing) {
        return full;
      }

      if (!isClosing) {
        stack.push(tagName);
        return full;
      }

      var revIdx = -1;
      for (var si = stack.length - 1; si >= 0; si--) {
        if (stack[si] === tagName) { revIdx = stack.length - 1 - si; break; }
      }

      if (revIdx === -1) {
        // Orphan closing tag -> remove without touching surrounding content
        balancedCount++;
        return '';
      }

      var targetPos = stack.length - 1 - revIdx;
      var intermediate = stack.splice(targetPos + 1).reverse();
      stack.pop();
      if (intermediate.length > 0) {
        balancedCount += intermediate.length;
        return intermediate.map(function(t) { return '</' + t + '>'; }).join('') + full;
      }
      return full;
    });
  }).join('');

  if (stack.length > 0) {
    balancedCount += stack.length;
    balanced += '\\n' + stack.slice().reverse().map(function(t) { return '</' + t + '>'; }).join('\\n');
  }

  if (balanced !== beforeTagFix && balancedCount > 0) {
    out = balanced;
    fixesApplied.push('Putaran ' + round + ': Menyeimbangkan ' + balancedCount + ' tag XML tidak tertutup/tidak cocok' + (errLine ? ' (sekitar baris ' + errLine + ')' : ''));
  }

  // Fallback CDATA integrity re-check in case balancing uncovered raw code
  var cdataFixes = [];
  var afterCdata = fixCdataIntegrity(out, cdataFixes);
  if (afterCdata !== out) {
    out = afterCdata;
    for (var cf = 0; cf < cdataFixes.length; cf++) fixesApplied.push('Putaran ' + round + ': ' + cdataFixes[cf]);
  }

  return { fixedXml: out, fixesApplied: fixesApplied };
}

self.onmessage = function(ev) {
  var msg = ev.data || {};
  try {
    if (msg.cmd === 'analyze') {
      var res = runFullAnalysis(msg.xml || '', Array.isArray(msg.safelistPrefixes) ? msg.safelistPrefixes : undefined);
      self.postMessage({ type: 'analyzeResult', data: res.analysis });
    } else if (msg.cmd === 'clean') {
      var cleanRes = runDeadCodeClean(msg.xml || '', msg.options || {});
      self.postMessage({ type: 'cleanResult', data: cleanRes });
    } else if (msg.cmd === 'autofixRound') {
      var round = msg.round || 1;
      var maxRounds = msg.maxRounds || 10;
      postProgress('autofix', Math.min(90, 15 + round * 7), 'Menjalankan Auto-Fix XML (Putaran ' + round + '/' + maxRounds + ')...', {
        round: round,
        maxRounds: maxRounds
      });
      var fx = round === 1
        ? autoFixDeterministicRound(msg.xml || '')
        : autoFixTargetedRound(msg.xml || '', msg.parserError || null, round);
      self.postMessage({ type: 'autofixRoundResult', data: fx, round: round });
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      error: err && err.message ? err.message : 'Terjadi kesalahan di dalam Web Worker.'
    });
  }
};
`;

function createInlineBlobWorker(): { worker: Worker; revoke: () => void } {
  const blob = new Blob([INLINE_WORKER_SOURCE], { type: 'application/javascript' });
  const blobUrl = URL.createObjectURL(blob);
  const worker = new Worker(blobUrl);
  return {
    worker,
    revoke: () => {
      try {
        URL.revokeObjectURL(blobUrl);
      } catch {
        // ignore
      }
    },
  };
}

/**
 * Run O(1) Set-based CSS/JS/Var dead code analysis inside the Inline Blob Web Worker.
 */
export function runAnalyzeDeadCodeWorker(
  xml: string,
  onProgress?: (info: WorkerProgressInfo) => void,
  safelistPrefixes?: string[]
): WorkerJobHandle<DeadCodeAnalysisResult> {
  const { worker, revoke } = createInlineBlobWorker();
  let settled = false;

  const cancel = () => {
    if (settled) return;
    settled = true;
    worker.terminate();
    revoke();
  };

  const promise = new Promise<DeadCodeAnalysisResult>((resolve, reject) => {
    worker.onmessage = (ev: MessageEvent) => {
      const msg = ev.data;
      if (!msg) return;
      if (msg.type === 'progress') {
        onProgress?.({
          phase: msg.phase,
          percent: msg.percent,
          message: msg.message,
        });
      } else if (msg.type === 'analyzeResult') {
        settled = true;
        worker.terminate();
        revoke();
        resolve(msg.data as DeadCodeAnalysisResult);
      } else if (msg.type === 'error') {
        settled = true;
        worker.terminate();
        revoke();
        reject(new Error(msg.error || 'Worker error'));
      }
    };

    worker.onerror = (err) => {
      settled = true;
      worker.terminate();
      revoke();
      reject(new Error(err.message || 'Gagal menjalankan Web Worker.'));
    };

    onProgress?.({ phase: 'indexing', percent: 8, message: 'Mengindeks dokumen...' });
    worker.postMessage({
      cmd: 'analyze',
      xml,
      safelistPrefixes: Array.isArray(safelistPrefixes) ? safelistPrefixes : undefined,
    });
  });

  return { promise, cancel };
}

/**
 * Run Iterative Auto-Fix XML (max 10 rounds) coordinating Main Thread DOMParser("text/xml")
 * with the Inline Blob Web Worker. Supports instant worker.terminate() cancellation.
 */
export function runIterativeAutoFixWorker(
  xml: string,
  onProgress?: (info: WorkerProgressInfo) => void,
  maxRounds = 10
): WorkerJobHandle<IterativeAutoFixResult> {
  const { worker, revoke } = createInlineBlobWorker();
  let settled = false;
  const startedAt = Date.now();

  const cancel = () => {
    if (settled) return;
    settled = true;
    worker.terminate();
    revoke();
  };

  const promise = new Promise<IterativeAutoFixResult>((resolve, reject) => {
    let currentXml = xml;
    const allFixes: string[] = [];
    let currentRound = 1;

    const finishWithValidation = (finalXml: string, roundsExecuted: number) => {
      onProgress?.({
        phase: 'validating',
        percent: 95,
        message: 'Memvalidasi XML dengan DOMParser("text/xml")...',
        round: roundsExecuted,
        maxRounds,
      });

      const domCheck = validateXmlWithDomParser(finalXml);
      const issues: XmlSyntaxIssue[] = domCheck.isValid
        ? []
        : [
            {
              line: domCheck.line ?? 1,
              column: domCheck.column ?? undefined,
              severity: 'error',
              code: 'XML_PARSER_ERROR',
              message: domCheck.message || 'Kesalahan sintaks XML.',
              autoFixable: true,
            },
          ];

      onProgress?.({
        phase: 'done',
        percent: 100,
        message: domCheck.isValid ? 'Validasi XML berhasil (0 error).' : 'Auto-Fix selesai dengan catatan validasi.',
      });

      settled = true;
      worker.terminate();
      revoke();

      resolve({
        fixedXml: finalXml,
        fixesApplied: allFixes,
        roundsExecuted,
        validationAfter: {
          isValid: domCheck.isValid,
          issues,
        },
        domParserValid: domCheck.isValid,
        parserErrorDetail: domCheck.message,
        durationMs: Date.now() - startedAt,
      });
    };

    worker.onmessage = (ev: MessageEvent) => {
      if (settled) return;
      const msg = ev.data;
      if (!msg) return;

      if (msg.type === 'progress') {
        onProgress?.({
          phase: msg.phase,
          percent: msg.percent,
          message: msg.message,
          round: msg.round,
          maxRounds: msg.maxRounds,
        });
        return;
      }

      if (msg.type === 'error') {
        settled = true;
        worker.terminate();
        revoke();
        reject(new Error(msg.error || 'Auto-Fix Web Worker gagal.'));
        return;
      }

      if (msg.type === 'autofixRoundResult') {
        const roundData = msg.data as { fixedXml: string; fixesApplied: string[] };
        const roundChanged = roundData.fixedXml !== currentXml;
        currentXml = roundData.fixedXml;
        for (const f of roundData.fixesApplied) {
          if (!allFixes.includes(f)) allFixes.push(f);
        }

        onProgress?.({
          phase: 'validating',
          percent: Math.min(92, 20 + currentRound * 7),
          message: `Memvalidasi XML (Putaran ${currentRound}/${maxRounds})...`,
          round: currentRound,
          maxRounds,
        });

        const domCheck = validateXmlWithDomParser(currentXml);
        if (domCheck.isValid) {
          finishWithValidation(currentXml, currentRound);
          return;
        }

        // Stop if we reached maxRounds OR if a targeted round (round >= 2) produced no further change
        if (currentRound >= maxRounds || (currentRound >= 2 && !roundChanged)) {
          finishWithValidation(currentXml, currentRound);
          return;
        }

        currentRound++;
        worker.postMessage({
          cmd: 'autofixRound',
          xml: currentXml,
          round: currentRound,
          maxRounds,
          parserError: {
            line: domCheck.line,
            column: domCheck.column,
            message: domCheck.rawMessage || domCheck.message,
          },
        });
      }
    };

    worker.onerror = (err) => {
      settled = true;
      worker.terminate();
      revoke();
      reject(new Error(err.message || 'Gagal menjalankan Auto-Fix Web Worker.'));
    };

    onProgress?.({
      phase: 'autofix',
      percent: 10,
      message: `Memulai Auto-Fix XML (Putaran 1/${maxRounds})...`,
      round: 1,
      maxRounds,
    });
    worker.postMessage({ cmd: 'autofixRound', xml: currentXml, round: 1, maxRounds });
  });

  return { promise, cancel };
}

/**
 * Run Dead CSS/JS/Var Cleaner inside the Inline Blob Web Worker, then strictly validate
 * output with DOMParser("text/xml") before returning. Automatically runs Auto-Fix if needed
 * or rolls back safely to valid XML if deletion broke XML well-formedness.
 */
export function runCleanDeadCodeWorker(
  xml: string,
  options: DeadCleanOptions,
  onProgress?: (info: WorkerProgressInfo) => void
): WorkerJobHandle<DeadCodeCleanResult> {
  const { worker, revoke } = createInlineBlobWorker();
  let settled = false;
  let innerAutoFixCancel: (() => void) | null = null;

  const cancel = () => {
    if (settled) return;
    settled = true;
    innerAutoFixCancel?.();
    worker.terminate();
    revoke();
  };

  const promise = new Promise<DeadCodeCleanResult>((resolve, reject) => {
    const initialDomValid = validateXmlWithDomParser(xml).isValid;

    worker.onmessage = async (ev: MessageEvent) => {
      if (settled) return;
      const msg = ev.data;
      if (!msg) return;

      if (msg.type === 'progress') {
        onProgress?.({
          phase: msg.phase,
          percent: msg.percent,
          message: msg.message,
        });
        return;
      }

      if (msg.type === 'error') {
        settled = true;
        worker.terminate();
        revoke();
        reject(new Error(msg.error || 'Pembersihan Web Worker gagal.'));
        return;
      }

      if (msg.type === 'cleanResult') {
        worker.terminate();
        revoke();

        const rawResult = msg.data as {
          cleanedXml: string;
          stats: DeadCodeCleanResult['stats'];
          removedItemsSummary: string[];
          removedItemsDetail?: DeadCodeCleanResult['removedItemsDetail'];
        };

        onProgress?.({
          phase: 'validating',
          percent: 90,
          message: 'Memvalidasi XML hasil pembersihan dengan DOMParser("text/xml")...',
        });

        let finalXml = rawResult.cleanedXml;
        let domCheck = validateXmlWithDomParser(finalXml);
        let autoFixedAfterClean = false;
        let rolledBackToValid = false;

        if (!domCheck.isValid) {
          onProgress?.({
            phase: 'autofix',
            percent: 93,
            message: 'Menjalankan Auto-Fix XML pasca pembersihan...',
          });

          const fixJob = runIterativeAutoFixWorker(finalXml, (p) => onProgress?.(p), 10);
          innerAutoFixCancel = fixJob.cancel;
          try {
            const fxRes = await fixJob.promise;
            if (settled) return;
            if (fxRes.domParserValid) {
              finalXml = fxRes.fixedXml;
              domCheck = validateXmlWithDomParser(finalXml);
              autoFixedAfterClean = true;
            } else if (initialDomValid) {
              // Rollback cleanly if original XML was valid and cleanup somehow broke structure
              finalXml = xml;
              domCheck = validateXmlWithDomParser(finalXml);
              rolledBackToValid = true;
            }
          } catch {
            if (settled) return;
            if (initialDomValid) {
              finalXml = xml;
              domCheck = validateXmlWithDomParser(finalXml);
              rolledBackToValid = true;
            }
          }
        }

        const isSmallEnoughForSnippet = xml.length <= LARGE_FILE_EDITOR_DOM_THRESHOLD_BYTES;
        onProgress?.({
          phase: 'done',
          percent: 100,
          message: rolledBackToValid
            ? 'Pembersihan dibatalkan otomatis demi menjaga validitas XML.'
            : 'Pembersihan & validasi XML selesai.',
        });

        settled = true;
        resolve({
          cleanedXml: finalXml,
          rolledBackToValid,
          autoFixedAfterClean,
          validationPassed: domCheck.isValid,
          parserErrorSummary: domCheck.message,
          stats: {
            ...rawResult.stats,
            cleanedBytes: finalXml.length,
            savedBytes: Math.max(0, xml.length - finalXml.length),
          },
          removedItemsSummary: rolledBackToValid
            ? ['Pembersihan dibatalkan otomatis karena memicu <parsererror> pada XML.']
            : rawResult.removedItemsSummary,
          removedItemsDetail: rolledBackToValid ? [] : (rawResult.removedItemsDetail || []),
          beforeSnippetSample: isSmallEnoughForSnippet ? xml.slice(0, 4000) : undefined,
          afterSnippetSample: isSmallEnoughForSnippet ? finalXml.slice(0, 4000) : undefined,
        });
      }
    };

    worker.onerror = (err) => {
      settled = true;
      worker.terminate();
      revoke();
      reject(new Error(err.message || 'Gagal menjalankan Pembersih Web Worker.'));
    };

    onProgress?.({ phase: 'indexing', percent: 5, message: 'Mengindeks dokumen...' });
    worker.postMessage({ cmd: 'clean', xml, options });
  });

  return { promise, cancel };
}
