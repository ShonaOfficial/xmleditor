import { extractSkinContent } from './bloggerCompiler';

/**
 * Dynamic Tag Guard: detect Blogger template expressions or dynamic variables
 */
export function containsBloggerDynamicSyntax(text?: string, rawSnippet?: string): boolean {
  const combined = `${text || ''}\n${rawSnippet || ''}`;
  if (!combined.trim()) return false;
  return (
    /<b:(?:if|elseif|else|with|loop|switch|case|default|defaultmarkups|eval|include|includable|attr|class|tag|variable|skin|template-skin)\b/i.test(combined) ||
    /<data:[a-zA-Z0-9_.-]+/i.test(combined) ||
    /\bexpr:[a-zA-Z0-9_-]+\s*=/i.test(combined) ||
    /\bdata:[a-zA-Z0-9_.-]+/i.test(combined) ||
    /\$\([a-zA-Z0-9_.-]+\)/.test(combined)
  );
}

/**
 * Blogger XML Snippet Injector Presets (100% offline)
 */
export interface BloggerSnippetPreset {
  id: string;
  label: string;
  description: string;
  code: string;
}

export const BLOGGER_SNIPPET_PRESETS: BloggerSnippetPreset[] = [
  {
    id: 'isHomepage',
    label: 'data:view.isHomepage',
    description: 'Tampilkan blok khusus hanya di halaman beranda blog.',
    code: `<b:if cond='data:view.isHomepage'>\n  <!-- Konten khusus Beranda -->\n</b:if>`,
  },
  {
    id: 'isPost',
    label: 'data:view.isPost',
    description: 'Tampilkan blok khusus hanya di halaman artikel tunggal.',
    code: `<b:if cond='data:view.isPost'>\n  <!-- Konten khusus Halaman Artikel -->\n</b:if>`,
  },
  {
    id: 'resizeImage',
    label: 'resizeImage()',
    description: 'Optimasi ukuran & rasio gambar thumbnail Blogger otomatis.',
    code: `<img expr:alt='data:post.title' expr:src='resizeImage(data:post.featuredImage, 720, &quot;16:9&quot;)' loading='lazy'/>`,
  },
  {
    id: 'bLoop',
    label: '<b:loop>',
    description: 'Perulangan daftar postingan atau label Blogger.',
    code: `<b:loop values='data:posts' var='post'>\n  <article class='post-item'>\n    <a expr:href='data:post.url'><data:post.title/></a>\n  </article>\n</b:loop>`,
  },
  {
    id: 'bIncludable',
    label: '<b:includable>',
    description: 'Blok komponen reusable di dalam <b:widget>.',
    code: `<b:includable id='customBlock' var='post'>\n  <div class='custom-block'>\n    <data:post.title/>\n  </div>\n</b:includable>`,
  },
];

/**
 * Inline SVG Cleaner: strips editor metadata, comments, title/desc, and empty groups
 */
export function cleanInlineSvgMarkup(rawSvg: string): {
  cleanedSvg: string;
  changed: boolean;
  savedBytes: number;
} {
  if (!rawSvg || !/<svg\b/i.test(rawSvg)) {
    return { cleanedSvg: rawSvg, changed: false, savedBytes: 0 };
  }

  let out = rawSvg;
  // Remove XML comments
  out = out.replace(/<!--[\s\S]*?-->/g, '');
  // Remove metadata, title, desc blocks
  out = out.replace(/<(metadata|title|desc)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  // Remove editor-specific XML namespaces & attributes (Inkscape, Sodipodi, Adobe Illustrator, Sketch, etc.)
  out = out.replace(
    /\s+xmlns:(?:inkscape|sodipodi|dc|cc|rdf|i|x|graph|sketch|serif|vectornator)=["'][^"']*["']/gi,
    ''
  );
  out = out.replace(
    /\s+(?:inkscape|sodipodi|sketch|vectornator):[a-zA-Z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*')/gi,
    ''
  );
  out = out.replace(/\s+(?:data-name|enable-background|xml:space)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
  // Remove empty <g> containers (two passes for nested empty groups)
  for (let pass = 0; pass < 2; pass++) {
    out = out.replace(/<g\b[^>]*>\s*<\/g>/gi, '');
  }
  // Collapse inter-tag whitespace cleanly without breaking inline spaces
  out = out.replace(/>\s+</g, '><');
  out = out.replace(/\s{2,}/g, ' ').trim();

  const savedBytes = Math.max(0, rawSvg.length - out.length);
  return {
    cleanedSvg: out,
    changed: out !== rawSvg,
    savedBytes,
  };
}

export function cleanAllSvgsInXml(xml: string): {
  nextXml: string;
  cleanedCount: number;
  savedBytes: number;
} {
  if (!xml) return { nextXml: xml, cleanedCount: 0, savedBytes: 0 };

  let cleanedCount = 0;
  let savedBytes = 0;
  // Segment around CDATA & comments so SVGs inside JS strings or skin comments are never altered blindly
  const tokenRegex = /(<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->)/gi;
  let lastIndex = 0;
  const parts: string[] = [];
  let match: RegExpExecArray | null;

  const cleanCodeSlice = (slice: string) =>
    slice.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, (fullSvg) => {
      const res = cleanInlineSvgMarkup(fullSvg);
      if (res.changed) {
        cleanedCount++;
        savedBytes += res.savedBytes;
        return res.cleanedSvg;
      }
      return fullSvg;
    });

  while ((match = tokenRegex.exec(xml)) !== null) {
    if (match.index > lastIndex) {
      parts.push(cleanCodeSlice(xml.slice(lastIndex, match.index)));
    }
    parts.push(match[0]);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < xml.length) {
    parts.push(cleanCodeSlice(xml.slice(lastIndex)));
  }

  return {
    nextXml: parts.join(''),
    cleanedCount,
    savedBytes,
  };
}

/**
 * Widget & Section Tree Explorer + Fold Ranges (Single-pass O(N))
 */
export interface TreeWidgetNode {
  id: string;
  type: string;
  title: string;
  locked: string;
  visible: string;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
}

export interface TreeSectionNode {
  id: string;
  className: string;
  maxWidgets: string;
  showAddElement: string;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  widgets: TreeWidgetNode[];
}

export interface ParsedLayoutTree {
  sections: TreeSectionNode[];
  skinBlock: {
    label: string;
    startLine: number;
    endLine: number;
    startOffset: number;
    endOffset: number;
  } | null;
}

function getAttrFromRaw(attrs: string, name: string): string {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(attrs);
  return m ? (m[1] ?? m[2] ?? '') : '';
}

function buildFastLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function lineAtFast(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= offset) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi + 1;
}

export function parseBloggerLayoutTree(xml: string): ParsedLayoutTree {
  const lineStarts = buildFastLineStarts(xml);
  const sections: TreeSectionNode[] = [];
  let skinBlock: ParsedLayoutTree['skinBlock'] = null;

  const skinMatch = /<b:skin\b[^>]*>[\s\S]*?<\/b:skin>/i.exec(xml);
  if (skinMatch) {
    const startOffset = skinMatch.index;
    const endOffset = startOffset + skinMatch[0].length;
    skinBlock = {
      label: '<b:skin>',
      startLine: lineAtFast(lineStarts, startOffset),
      endLine: lineAtFast(lineStarts, endOffset),
      startOffset,
      endOffset,
    };
  }

  // Scan <b:section> and <b:widget> tags cleanly outside CDATA/comments
  const tokenRegex =
    /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<(\/?)(b:section|b:widget)\b((?:\s+(?:"[^"]*"|'[^']*'|[^>"'])*)?)\s*(\/?)>/gi;

  const sectionStack: TreeSectionNode[] = [];
  const widgetStack: Array<{ node: TreeWidgetNode; parentSection: TreeSectionNode | null }> = [];

  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(xml)) !== null) {
    const raw = m[0];
    if (raw.startsWith('<![CDATA[') || raw.startsWith('<!--')) continue;

    const isClose = m[1] === '/';
    const tagLower = (m[2] || '').toLowerCase();
    const attrs = m[3] || '';
    const isSelfClose = m[4] === '/';
    const startOffset = m.index;
    const endOffset = startOffset + raw.length;
    const line = lineAtFast(lineStarts, startOffset);

    if (tagLower === 'b:section') {
      if (!isClose) {
        const node: TreeSectionNode = {
          id: getAttrFromRaw(attrs, 'id') || `section-${sections.length + 1}`,
          className: getAttrFromRaw(attrs, 'class'),
          maxWidgets: getAttrFromRaw(attrs, 'maxwidgets'),
          showAddElement: getAttrFromRaw(attrs, 'showaddelement'),
          startLine: line,
          endLine: line,
          startOffset,
          endOffset,
          widgets: [],
        };
        if (isSelfClose) {
          sections.push(node);
        } else {
          sectionStack.push(node);
        }
      } else if (sectionStack.length > 0) {
        const popped = sectionStack.pop()!;
        popped.endLine = line;
        popped.endOffset = endOffset;
        sections.push(popped);
      }
    } else if (tagLower === 'b:widget') {
      const currentSection = sectionStack.length > 0 ? sectionStack[sectionStack.length - 1] : null;
      if (!isClose) {
        const wNode: TreeWidgetNode = {
          id: getAttrFromRaw(attrs, 'id') || 'Widget',
          type: getAttrFromRaw(attrs, 'type') || 'HTML',
          title: getAttrFromRaw(attrs, 'title') || '',
          locked: getAttrFromRaw(attrs, 'locked') || 'false',
          visible: getAttrFromRaw(attrs, 'visible') || 'true',
          startLine: line,
          endLine: line,
          startOffset,
          endOffset,
        };
        if (isSelfClose) {
          if (currentSection) currentSection.widgets.push(wNode);
        } else {
          widgetStack.push({ node: wNode, parentSection: currentSection });
        }
      } else if (widgetStack.length > 0) {
        const popped = widgetStack.pop()!;
        popped.node.endLine = line;
        popped.node.endOffset = endOffset;
        if (popped.parentSection) {
          popped.parentSection.widgets.push(popped.node);
        }
      }
    }
  }

  // Handle any unclosed sections gracefully
  while (sectionStack.length > 0) {
    const leftover = sectionStack.pop()!;
    sections.push(leftover);
  }

  sections.sort((a, b) => a.startOffset - b.startOffset);
  return { sections, skinBlock };
}

/**
 * Deterministic Code Folding helper for Editor XML
 */
export interface FoldRangeItem {
  key: string;
  label: string;
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
}

export function buildFoldedEditorView(
  rawXml: string,
  foldedKeys: Set<string>,
  tree: ParsedLayoutTree
): {
  displayText: string;
  placeholderToOriginal: Record<string, string>;
  hasActiveFolds: boolean;
} {
  if (foldedKeys.size === 0) {
    return { displayText: rawXml, placeholderToOriginal: {}, hasActiveFolds: false };
  }

  const candidates: FoldRangeItem[] = [];
  if (tree.skinBlock && foldedKeys.has('skin:b:skin')) {
    candidates.push({
      key: 'skin:b:skin',
      label: '<b:skin>...</b:skin>',
      startOffset: tree.skinBlock.startOffset,
      endOffset: tree.skinBlock.endOffset,
      startLine: tree.skinBlock.startLine,
      endLine: tree.skinBlock.endLine,
    });
  }
  for (const sec of tree.sections) {
    const secKey = `section:${sec.id}`;
    if (foldedKeys.has(secKey) && sec.endOffset > sec.startOffset) {
      candidates.push({
        key: secKey,
        label: `<b:section id='${sec.id}'>`,
        startOffset: sec.startOffset,
        endOffset: sec.endOffset,
        startLine: sec.startLine,
        endLine: sec.endLine,
      });
      continue; // Section fold subsumes its child widget folds
    }
    for (const w of sec.widgets) {
      const wKey = `widget:${w.id}`;
      if (foldedKeys.has(wKey) && w.endOffset > w.startOffset) {
        candidates.push({
          key: wKey,
          label: `<b:widget id='${w.id}' type='${w.type}'>`,
          startOffset: w.startOffset,
          endOffset: w.endOffset,
          startLine: w.startLine,
          endLine: w.endLine,
        });
      }
    }
  }

  if (candidates.length === 0) {
    return { displayText: rawXml, placeholderToOriginal: {}, hasActiveFolds: false };
  }

  candidates.sort((a, b) => a.startOffset - b.startOffset);
  const nonOverlapping: FoldRangeItem[] = [];
  for (const c of candidates) {
    const prev = nonOverlapping[nonOverlapping.length - 1];
    if (!prev || c.startOffset >= prev.endOffset) {
      nonOverlapping.push(c);
    }
  }

  const placeholderToOriginal: Record<string, string> = {};
  const chunks: string[] = [];
  let cursor = 0;

  for (const item of nonOverlapping) {
    if (item.startOffset > cursor) {
      chunks.push(rawXml.slice(cursor, item.startOffset));
    }
    const origBlock = rawXml.slice(item.startOffset, item.endOffset);
    const linesInside = Math.max(1, item.endLine - item.startLine + 1);
    const placeholder = `<!-- [[FOLD:${item.key}|${item.label}|${linesInside} baris]] -->`;
    placeholderToOriginal[placeholder] = origBlock;
    chunks.push(placeholder);
    cursor = item.endOffset;
  }

  if (cursor < rawXml.length) {
    chunks.push(rawXml.slice(cursor));
  }

  return {
    displayText: chunks.join(''),
    placeholderToOriginal,
    hasActiveFolds: true,
  };
}

export function unfoldEditorText(
  displayText: string,
  placeholderToOriginal: Record<string, string>
): string {
  let out = displayText;
  for (const [placeholder, original] of Object.entries(placeholderToOriginal)) {
    if (out.includes(placeholder)) {
      out = out.split(placeholder).join(original);
    }
  }
  return out;
}

/**
 * Widget Extractor & Importer (Portable Widget + Associated CSS Bundle)
 */
export interface ExtractedWidgetBundle {
  format: 'temaloka-widget-bundle';
  version: 1;
  widgetId: string;
  widgetType: string;
  widgetTitle: string;
  sourceSectionId: string;
  widgetXml: string;
  extractedCss: string;
  matchedSelectorsCount: number;
  exportedAt: string;
}

const GENERIC_WIDGET_CSS_CLASSES = new Set([
  'widget',
  'widget-content',
  'title',
  'content',
  'clear',
  'clearfix',
  'container',
  'wrapper',
  'item',
  'list',
  'active',
  'show',
  'hide',
  'hidden',
  'open',
  'close',
]);

function extractBalancedCssRules(cssText: string): Array<{ selector: string; fullRule: string; mediaPrefix: string }> {
  const cleaned = cssText
    .replace(/<Group\b[^>]*>[\s\S]*?<\/Group>/gi, '')
    .replace(/<Variable\b[^>]*\/?>/gi, '');
  const rules: Array<{ selector: string; fullRule: string; mediaPrefix: string }> = [];

  const scan = (src: string, mediaPrefix: string) => {
    let i = 0;
    const len = src.length;
    while (i < len) {
      while (i < len && /\s/.test(src[i])) i++;
      if (i >= len) break;
      if (src[i] === '/' && src[i + 1] === '*') {
        const endC = src.indexOf('*/', i + 2);
        i = endC === -1 ? len : endC + 2;
        continue;
      }
      const braceOpen = src.indexOf('{', i);
      if (braceOpen === -1) break;
      const header = src.slice(i, braceOpen).trim();
      let depth = 1;
      let p = braceOpen + 1;
      let quote: string | null = null;
      while (p < len && depth > 0) {
        const ch = src[p];
        if (quote) {
          if (ch === '\\') { p += 2; continue; }
          if (ch === quote) quote = null;
          p++;
          continue;
        }
        if (ch === '"' || ch === "'") { quote = ch; p++; continue; }
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        p++;
      }
      const inner = src.slice(braceOpen + 1, Math.max(braceOpen + 1, p - 1));
      const fullRule = src.slice(i, p).trim();
      if (/^@media\b/i.test(header)) {
        scan(inner, header);
      } else if (!header.startsWith('@') && header) {
        rules.push({ selector: header, fullRule, mediaPrefix });
      }
      i = p;
    }
  };

  scan(cleaned, '');
  return rules;
}

export function extractWidgetBundle(xml: string, widgetId: string): ExtractedWidgetBundle | null {
  const tree = parseBloggerLayoutTree(xml);
  let targetWidget: TreeWidgetNode | null = null;
  let sourceSectionId = 'sidebar';

  for (const sec of tree.sections) {
    const found = sec.widgets.find((w) => w.id === widgetId);
    if (found) {
      targetWidget = found;
      sourceSectionId = sec.id;
      break;
    }
  }
  if (!targetWidget) return null;

  const widgetXml = xml.slice(targetWidget.startOffset, targetWidget.endOffset).trim();

  // Collect ID & class tokens referenced inside widgetXml
  const tokenIds = new Set<string>([widgetId]);
  const tokenClasses = new Set<string>();
  const attrRe = /\b(id|class)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let am: RegExpExecArray | null;
  while ((am = attrRe.exec(widgetXml)) !== null) {
    const attrName = am[1].toLowerCase();
    const val = (am[2] ?? am[3] ?? '').trim();
    if (!val) continue;
    if (attrName === 'id') {
      tokenIds.add(val);
    } else {
      for (const cls of val.split(/\s+/)) {
        if (cls.length >= 3 && !GENERIC_WIDGET_CSS_CLASSES.has(cls.toLowerCase())) {
          tokenClasses.add(cls);
        }
      }
    }
  }

  // Extract CSS from <b:skin> and <style>
  const cssSources: string[] = [];
  const skinCss = extractSkinContent(xml);
  if (skinCss) cssSources.push(skinCss);
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = styleRe.exec(xml)) !== null) {
    if (sm[1]) {
      cssSources.push(
        sm[1]
          .replace(/\/\*<!\[CDATA\[\*\//g, '')
          .replace(/\/\*\]\]>\*\//g, '')
          .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      );
    }
  }

  const allRules = extractBalancedCssRules(cssSources.join('\n'));
  const matchedNormal: string[] = [];
  const matchedByMedia = new Map<string, string[]>();
  let matchedCount = 0;

  for (const rule of allRules) {
    let matches = false;
    tokenIds.forEach((idTok) => {
      const idRe = new RegExp(`#${idTok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-zA-Z0-9_-])`);
      if (idRe.test(rule.selector)) matches = true;
    });
    if (!matches) {
      tokenClasses.forEach((clsTok) => {
        const clsRe = new RegExp(`\\.${clsTok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-zA-Z0-9_-])`);
        if (clsRe.test(rule.selector)) matches = true;
      });
    }

    if (matches) {
      matchedCount++;
      if (rule.mediaPrefix) {
        const list = matchedByMedia.get(rule.mediaPrefix) || [];
        list.push(`  ${rule.fullRule}`);
        matchedByMedia.set(rule.mediaPrefix, list);
      } else {
        matchedNormal.push(rule.fullRule);
      }
    }
  }

  const mediaBlocks: string[] = [];
  matchedByMedia.forEach((innerRules, mediaHeader) => {
    mediaBlocks.push(`${mediaHeader} {\n${innerRules.join('\n')}\n}`);
  });

  const extractedCss = [...matchedNormal, ...mediaBlocks].join('\n\n').trim();

  return {
    format: 'temaloka-widget-bundle',
    version: 1,
    widgetId: targetWidget.id,
    widgetType: targetWidget.type,
    widgetTitle: targetWidget.title,
    sourceSectionId,
    widgetXml,
    extractedCss,
    matchedSelectorsCount: matchedCount,
    exportedAt: new Date().toISOString(),
  };
}

function generateUniqueWidgetId(baseId: string, existingIds: Set<string>): string {
  if (!existingIds.has(baseId)) return baseId;
  const match = /^(.*?)(\d+)$/.exec(baseId);
  const prefix = match ? match[1] : baseId;
  let num = match ? Number.parseInt(match[2], 10) + 1 : 2;
  while (existingIds.has(`${prefix}${num}`)) {
    num++;
  }
  return `${prefix}${num}`;
}

export function importWidgetBundleIntoXml(
  targetXml: string,
  rawBundleInput: string | ExtractedWidgetBundle,
  targetSectionId: string
): {
  nextXml: string;
  finalWidgetId: string;
  renamedFrom: string | null;
  cssInjected: boolean;
  error?: string;
} {
  let widgetXml = '';
  let extractedCss = '';
  let originalId = '';

  if (typeof rawBundleInput === 'string') {
    const trimmed = rawBundleInput.trim();
    if (!trimmed) {
      return {
        nextXml: targetXml,
        finalWidgetId: '',
        renamedFrom: null,
        cssInjected: false,
        error: 'Konten paket widget masih kosong.',
      };
    }
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as Partial<ExtractedWidgetBundle>;
        widgetXml = (parsed.widgetXml || '').trim();
        extractedCss = (parsed.extractedCss || '').trim();
        originalId = (parsed.widgetId || '').trim();
      } catch {
        return {
          nextXml: targetXml,
          finalWidgetId: '',
          renamedFrom: null,
          cssInjected: false,
          error: 'Format JSON paket widget tidak valid.',
        };
      }
    } else {
      widgetXml = trimmed;
    }
  } else {
    widgetXml = rawBundleInput.widgetXml.trim();
    extractedCss = rawBundleInput.extractedCss.trim();
    originalId = rawBundleInput.widgetId.trim();
  }

  if (!/<b:widget\b/i.test(widgetXml)) {
    return {
      nextXml: targetXml,
      finalWidgetId: '',
      renamedFrom: null,
      cssInjected: false,
      error: 'Kode impor tidak mengandung tag <b:widget> yang valid.',
    };
  }

  const openWidgetMatch = /<b:widget\b([^>]*?)(\/?)>/i.exec(widgetXml);
  if (!openWidgetMatch) {
    return {
      nextXml: targetXml,
      finalWidgetId: '',
      renamedFrom: null,
      cssInjected: false,
      error: 'Tag pembuka <b:widget> tidak terbaca.',
    };
  }

  if (!originalId) {
    originalId = getAttrFromRaw(openWidgetMatch[1], 'id') || 'HTML1';
  }

  // Collect all existing widget IDs in target template
  const existingIds = new Set<string>();
  const allWidgetsRe = /<b:widget\b([^>]*?)>/gi;
  let wm: RegExpExecArray | null;
  while ((wm = allWidgetsRe.exec(targetXml)) !== null) {
    const wid = getAttrFromRaw(wm[1], 'id');
    if (wid) existingIds.add(wid);
  }

  const finalWidgetId = generateUniqueWidgetId(originalId, existingIds);
  const renamedFrom = finalWidgetId !== originalId ? originalId : null;

  let finalWidgetXml = widgetXml;
  let finalCss = extractedCss;

  if (renamedFrom) {
    // Update id attribute on <b:widget ...>
    finalWidgetXml = finalWidgetXml.replace(
      /(<b:widget\b[^>]*?\bid\s*=\s*)(["'])([^"']*)(\2)/i,
      `$1$2${finalWidgetId}$4`
    );
    // Rewrite #OldId references inside extracted CSS and widget XML safely
    const escapedOld = renamedFrom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (finalCss) {
      finalCss = finalCss.replace(new RegExp(`#${escapedOld}(?![a-zA-Z0-9_-])`, 'g'), `#${finalWidgetId}`);
    }
  }

  // Inject CSS safely before ]]></b:skin> (or fallback <style> before </head>)
  let outXml = targetXml;
  let cssInjected = false;
  if (finalCss) {
    const cssBlockComment = `\n/* Widget Bundle: ${finalWidgetId} */\n${finalCss}\n`;
    if (/(<b:skin\b[^>]*>[\s\S]*?)((?:\/\*|\/\/)?\s*\]\]>(?:\s*\*\/)?\s*<\/b:skin>)/i.test(outXml)) {
      outXml = outXml.replace(/(<b:skin\b[^>]*>[\s\S]*?)((?:\/\*|\/\/)?\s*\]\]>(?:\s*\*\/)?\s*<\/b:skin>)/i, `$1${cssBlockComment}$2`);
      cssInjected = true;
    } else if (/<\/head>/i.test(outXml)) {
      outXml = outXml.replace(
        /<\/head>/i,
        `<style type='text/css'>/*<![CDATA[*/${cssBlockComment}/*]]>*/</style>\n</head>`
      );
      cssInjected = true;
    }
  }

  // Insert <b:widget> into chosen <b:section id='targetSectionId'>
  const secIdEscaped = targetSectionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const selfClosingSectionRe = new RegExp(
    `(<b:section\\b[^>]*\\bid\\s*=\\s*["']${secIdEscaped}["'][^>]*?)\\s*/>`,
    'i'
  );
  if (selfClosingSectionRe.test(outXml)) {
    outXml = outXml.replace(selfClosingSectionRe, `$1>\n  ${finalWidgetXml}\n</b:section>`);
  } else {
    // Find opening of target <b:section> and locate its matching </b:section>
    const secOpenRe = new RegExp(
      `<b:section\\b[^>]*\\bid\\s*=\\s*["']${secIdEscaped}["'][^>]*>`,
      'i'
    );
    const openMatch = secOpenRe.exec(outXml);
    if (!openMatch) {
      return {
        nextXml: targetXml,
        finalWidgetId,
        renamedFrom,
        cssInjected: false,
        error: `Section tujuan "${targetSectionId}" tidak ditemukan di template.`,
      };
    }

    const searchFrom = openMatch.index + openMatch[0].length;
    const closeIdx = outXml.indexOf('</b:section>', searchFrom);
    if (closeIdx === -1) {
      return {
        nextXml: targetXml,
        finalWidgetId,
        renamedFrom,
        cssInjected: false,
        error: `Tag penutup </b:section> untuk "${targetSectionId}" tidak ditemukan.`,
      };
    }

    outXml = `${outXml.slice(0, closeIdx)}\n  ${finalWidgetXml}\n${outXml.slice(closeIdx)}`;
  }

  return {
    nextXml: outXml,
    finalWidgetId,
    renamedFrom,
    cssInjected,
  };
}

/**
 * Windowed Side-by-Side Line Diff (O(N) fast even for >300 KB / multi-MB XML)
 */
export interface DiffSideRow {
  kind: 'context' | 'changed' | 'added' | 'removed' | 'hunk-gap';
  leftLine: number | null;
  rightLine: number | null;
  leftText: string;
  rightText: string;
}

export interface DiffHunkResult {
  rows: DiffSideRow[];
  totalAddedLines: number;
  totalRemovedLines: number;
  totalChangedHunks: number;
  truncated: boolean;
}

export function computeSideBySideDiffHunks(
  beforeText: string,
  afterText: string,
  options?: { maxTotalRows?: number; contextLines?: number }
): DiffHunkResult {
  if (beforeText === afterText) {
    return {
      rows: [],
      totalAddedLines: 0,
      totalRemovedLines: 0,
      totalChangedHunks: 0,
      truncated: false,
    };
  }

  const maxTotalRows = options?.maxTotalRows ?? 220;
  const contextLines = options?.contextLines ?? 2;

  const leftLines = beforeText.split(/\r?\n/);
  const rightLines = afterText.split(/\r?\n/);

  // Trim identical prefix & suffix in O(N)
  let prefix = 0;
  const minLen = Math.min(leftLines.length, rightLines.length);
  while (prefix < minLen && leftLines[prefix] === rightLines[prefix]) {
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    leftLines[leftLines.length - 1 - suffix] === rightLines[rightLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  const lEnd = leftLines.length - suffix;
  const rEnd = rightLines.length - suffix;

  const rows: DiffSideRow[] = [];
  let totalAdded = 0;
  let totalRemoved = 0;
  let hunks = 0;
  let truncated = false;

  if (prefix > 0) {
    const ctxStart = Math.max(0, prefix - contextLines);
    if (ctxStart > 0) {
      rows.push({
        kind: 'hunk-gap',
        leftLine: null,
        rightLine: null,
        leftText: `... (${ctxStart} baris awal identik disembunyikan)`,
        rightText: `... (${ctxStart} baris awal identik disembunyikan)`,
      });
    }
    for (let c = ctxStart; c < prefix; c++) {
      rows.push({
        kind: 'context',
        leftLine: c + 1,
        rightLine: c + 1,
        leftText: leftLines[c],
        rightText: rightLines[c],
      });
    }
  }

  let li = prefix;
  let ri = prefix;
  const lookahead = 40;

  while (li < lEnd || ri < rEnd) {
    if (li < lEnd && ri < rEnd && leftLines[li] === rightLines[ri]) {
      // Collect run of matching lines inside the middle window
      let runEndL = li;
      let runEndR = ri;
      while (runEndL < lEnd && runEndR < rEnd && leftLines[runEndL] === rightLines[runEndR]) {
        runEndL++;
        runEndR++;
      }
      const runLen = runEndL - li;
      if (runLen > contextLines * 2 + 1) {
        for (let k = 0; k < contextLines; k++) {
          if (rows.length < maxTotalRows) {
            rows.push({
              kind: 'context',
              leftLine: li + k + 1,
              rightLine: ri + k + 1,
              leftText: leftLines[li + k],
              rightText: rightLines[ri + k],
            });
          }
        }
        if (rows.length < maxTotalRows) {
          rows.push({
            kind: 'hunk-gap',
            leftLine: null,
            rightLine: null,
            leftText: `... (${runLen - contextLines * 2} baris identik)`,
            rightText: `... (${runLen - contextLines * 2} baris identik)`,
          });
        }
        for (let k = runLen - contextLines; k < runLen; k++) {
          if (rows.length < maxTotalRows) {
            rows.push({
              kind: 'context',
              leftLine: li + k + 1,
              rightLine: ri + k + 1,
              leftText: leftLines[li + k],
              rightText: rightLines[ri + k],
            });
          }
        }
      } else {
        for (let k = 0; k < runLen; k++) {
          if (rows.length < maxTotalRows) {
            rows.push({
              kind: 'context',
              leftLine: li + k + 1,
              rightLine: ri + k + 1,
              leftText: leftLines[li + k],
              rightText: rightLines[ri + k],
            });
          }
        }
      }
      li = runEndL;
      ri = runEndR;
      continue;
    }

    // Re-sync search within lookahead window
    hunks++;
    let foundMatch = false;
    let nextLi = lEnd;
    let nextRi = rEnd;

    outer: for (let dist = 1; dist <= lookahead; dist++) {
      for (let dl = 0; dl <= dist; dl++) {
        const dr = dist - dl;
        if (li + dl < lEnd && ri + dr < rEnd && leftLines[li + dl] === rightLines[ri + dr]) {
          nextLi = li + dl;
          nextRi = ri + dr;
          foundMatch = true;
          break outer;
        }
      }
    }

    if (!foundMatch) {
      nextLi = Math.min(lEnd, li + lookahead);
      nextRi = Math.min(rEnd, ri + lookahead);
    }

    const delCount = nextLi - li;
    const addCount = nextRi - ri;
    totalRemoved += delCount;
    totalAdded += addCount;

    const pairCount = Math.max(delCount, addCount);
    for (let p = 0; p < pairCount; p++) {
      const hasL = p < delCount;
      const hasR = p < addCount;
      if (rows.length < maxTotalRows) {
        rows.push({
          kind: hasL && hasR ? 'changed' : hasL ? 'removed' : 'added',
          leftLine: hasL ? li + p + 1 : null,
          rightLine: hasR ? ri + p + 1 : null,
          leftText: hasL ? leftLines[li + p] : '',
          rightText: hasR ? rightLines[ri + p] : '',
        });
      } else {
        truncated = true;
      }
    }

    li = nextLi;
    ri = nextRi;
  }

  if (suffix > 0 && rows.length < maxTotalRows) {
    const sufTake = Math.min(suffix, contextLines);
    for (let s = 0; s < sufTake; s++) {
      if (rows.length >= maxTotalRows) {
        truncated = true;
        break;
      }
      rows.push({
        kind: 'context',
        leftLine: lEnd + s + 1,
        rightLine: rEnd + s + 1,
        leftText: leftLines[lEnd + s],
        rightText: rightLines[rEnd + s],
      });
    }
  }

  return {
    rows,
    totalAddedLines: totalAdded,
    totalRemovedLines: totalRemoved,
    totalChangedHunks: hunks,
    truncated,
  };
}

/**
 * Safe CSS Minifier for <b:skin>, <b:template-skin>, and <style> blocks
 * Preserves <![CDATA[...]]>, Blogger <Group>/<Variable> metadata (both inside and outside comments),
 * $(var.name), inline <b:eval>/<data:...>, license /*! comments, and string literals.
 */
export function minifyCssTextSafe(css: string): string {
  if (!css.trim()) return css;

  const keepTokens: string[] = [];
  const blockTokens: string[] = [];
  const inlineTokens: string[] = [];

  const readQuoteAwareXmlTag = (src: string, startIdx: number): number => {
    let p = startIdx + 1;
    let q: string | null = null;
    while (p < src.length) {
      const ch = src[p];
      if (q) {
        if (ch === q) q = null;
      } else if (ch === '"' || ch === "'") {
        q = ch;
      } else if (ch === '>') {
        return p + 1;
      }
      p++;
    }
    return -1;
  };

  // Pass 1: Protect strings, special comments (/*!, <Variable, <Group, CDATA),
  // standalone <Group>/<Variable> blocks, inline <b:...>/<data:...>, and $(...)
  const workParts: string[] = [];
  let i = 0;
  const len = css.length;
  let quote: string | null = null;

  while (i < len) {
    const ch = css[i];

    if (quote) {
      workParts.push(ch);
      if (ch === '\\' && i + 1 < len) {
        workParts.push(css[i + 1]);
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      workParts.push(ch);
      i++;
      continue;
    }

    if (ch === '/' && css[i + 1] === '*') {
      const endC = css.indexOf('*/', i + 2);
      if (endC === -1) {
        workParts.push(css.slice(i));
        break;
      }
      const cmt = css.slice(i, endC + 2);
      if (
        cmt.startsWith('/*!') ||
        /<Variable\b|<b:variable\b|<Group\b|<!\[CDATA\[|\]\]>/i.test(cmt)
      ) {
        const idx = keepTokens.push(cmt) - 1;
        workParts.push(`__TEMALOKA_KEEP_${idx}__`);
      }
      i = endC + 2;
      continue;
    }

    if (ch === '<') {
      const rest = css.slice(i);
      if (/^<Group\b/i.test(rest)) {
        const closeGroup = /<\/Group\s*>/i.exec(rest);
        if (closeGroup) {
          const fullGroup = rest.slice(0, closeGroup.index + closeGroup[0].length);
          const idx = blockTokens.push(fullGroup) - 1;
          workParts.push(`__TEMALOKA_BLOCK_${idx}__`);
          i += fullGroup.length;
          continue;
        }
      }
      if (/^<(?:Variable|b:variable)\b/i.test(rest)) {
        const isBVar = /^<b:variable\b/i.test(rest);
        const tagEnd = readQuoteAwareXmlTag(css, i);
        if (tagEnd !== -1) {
          let fullVar = css.slice(i, tagEnd);
          if (!fullVar.trimEnd().endsWith('/>')) {
            const closeVar = isBVar
              ? /^\s*<\/b:variable\s*>/i.exec(css.slice(tagEnd))
              : /^\s*<\/Variable\s*>/i.exec(css.slice(tagEnd));
            if (closeVar) {
              fullVar += closeVar[0];
            }
          }
          const idx = blockTokens.push(fullVar) - 1;
          workParts.push(`__TEMALOKA_BLOCK_${idx}__`);
          i += fullVar.length;
          continue;
        }
      }
      if (/^<\/?(?:b|data):[a-zA-Z0-9_.:-]+/i.test(rest)) {
        const tagEnd = readQuoteAwareXmlTag(css, i);
        if (tagEnd !== -1) {
          const fullBTag = css.slice(i, tagEnd);
          const idx = inlineTokens.push(fullBTag) - 1;
          workParts.push(`__TEMALOKA_INLINE_${idx}__`);
          i = tagEnd;
          continue;
        }
      }
      if (/^<!\[CDATA\[/i.test(rest)) {
        const idx = inlineTokens.push('<![CDATA[') - 1;
        workParts.push(`__TEMALOKA_INLINE_${idx}__`);
        i += 9;
        continue;
      }
    }

    if (css.startsWith(']]>', i)) {
      const idx = inlineTokens.push(']]>') - 1;
      workParts.push(`__TEMALOKA_INLINE_${idx}__`);
      i += 3;
      continue;
    }

    if (ch === '$' && css[i + 1] === '(') {
      const closeParen = css.indexOf(')', i + 2);
      const newlineIdx = css.indexOf('\n', i + 2);
      if (closeParen !== -1 && (newlineIdx === -1 || closeParen < newlineIdx)) {
        const expr = css.slice(i, closeParen + 1);
        const idx = inlineTokens.push(expr) - 1;
        workParts.push(`__TEMALOKA_INLINE_${idx}__`);
        i = closeParen + 1;
        continue;
      }
    }

    workParts.push(ch);
    i++;
  }

  const work = workParts.join('');

  // Pass 2: Collapse whitespace outside string literals while preserving calc(+/-) and @media keyword spacing
  const finalParts: string[] = [];
  let q2: string | null = null;
  let buf = '';
  const flushBuf = () => {
    if (!buf) return;
    let s = buf.replace(/\s+/g, ' ');
    s = s.replace(/\s*([{}:;,])\s*/g, '$1');
    s = s.replace(/;}/g, '}');
    // Guarantee mandatory CSS spaces after @media / media-query logical keywords before '('
    s = s.replace(/@media\s*\(/gi, '@media (');
    s = s.replace(/(\s|\))\b(and|or|only|not)\s*\(/gi, '$1$2 (');
    // Normalize calc() binary '+' and '-' spacing without touching unary negatives or --custom-vars
    s = s.replace(
      /(calc\([^;{}]*)/gi,
      (calcChunk: string) =>
        calcChunk.replace(
          /(\d(?:\.\d+)?(?:%|px|em|rem|vw|vh|vmin|vmax|ch|ex|cm|mm|in|pt|pc|fr)?|\))\s+([+-])\s+/g,
          '$1 $2 '
        )
    );
    finalParts.push(s);
    buf = '';
  };

  for (let k = 0; k < work.length; k++) {
    const c = work[k];
    if (q2) {
      finalParts.push(c);
      if (c === '\\' && k + 1 < work.length) {
        finalParts.push(work[k + 1]);
        k++;
        continue;
      }
      if (c === q2) q2 = null;
      continue;
    }
    if (c === '"' || c === "'") {
      flushBuf();
      q2 = c;
      finalParts.push(c);
      continue;
    }
    buf += c;
  }
  flushBuf();

  let minified = finalParts.join('').trim();
  minified = minified.replace(/__TEMALOKA_INLINE_(\d+)__/g, (_, idxStr: string) => {
    return inlineTokens[Number.parseInt(idxStr, 10)] || '';
  });
  minified = minified.replace(/__TEMALOKA_BLOCK_(\d+)__/g, (_, idxStr: string) => {
    const tok = blockTokens[Number.parseInt(idxStr, 10)] || '';
    return `\n${tok}\n`;
  });
  minified = minified.replace(/__TEMALOKA_KEEP_(\d+)__/g, (_, idxStr: string) => {
    const tok = keepTokens[Number.parseInt(idxStr, 10)] || '';
    return `\n${tok}\n`;
  });

  return minified
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export function minifyCssInXmlOffline(xml: string): {
  nextXml: string;
  changed: boolean;
  savedBytes: number;
  blocksMinified: number;
} {
  let blocksMinified = 0;
  const nextXml = xml.replace(
    /<(b:skin|b:template-skin|style)\b((?:"[^"]*"|'[^']*'|[^>"'/]|\/(?!>))*)>([\s\S]*?)<\/\1>/gi,
    (full, tagName: string, attrs: string, inner: string) => {
      const lowerTag = tagName.toLowerCase();
      if (lowerTag === 'style' && /(?:^|\s)(?:expr:)?src\s*=/i.test(attrs)) {
        return full;
      }
      if (!inner.trim()) return full;

      // 1. Single outer CDATA wrapper: /*<![CDATA[*/ ... /*]]>*/ or <![CDATA[ ... ]]> (or //<![CDATA[ ... //]]>)
      const outerCdata =
        /^\s*((?:\/\*|\/\/)?\s*<!\[CDATA\[(?:\s*\*\/)?)\s*([\s\S]*?)\s*((?:\/\*|\/\/)?\s*\]\]>(?:\s*\*\/)?)\s*$/i.exec(
          inner
        );
      if (outerCdata && !/<!\[CDATA\[|\]\]>/i.test(outerCdata[2])) {
        const pure = outerCdata[2];
        const min = minifyCssTextSafe(pure);
        const alreadyWrappedCssCdata =
          outerCdata[1].trim() === '/*<![CDATA[*/' && outerCdata[3].trim() === '/*]]>*/';
        if (alreadyWrappedCssCdata && (min === pure.trim() || min.length >= pure.length)) {
          return full;
        }
        if (min === pure.trim() && min.length >= pure.length && !alreadyWrappedCssCdata) {
          // Pure CSS unchanged, still ensure clean /*<![CDATA[*/.../*]]>*/ wrapper
          const wrappedSame = `/*<![CDATA[*/\n${min}\n/*]]>*/`;
          if (wrappedSame === inner.trim()) return full;
          blocksMinified++;
          return `<${tagName}${attrs}>${wrappedSame}</${tagName}>`;
        }
        blocksMinified++;
        return `<${tagName}${attrs}>/*<![CDATA[*/\n${min}\n/*]]>*/</${tagName}>`;
      }

      // 2. Multiple CDATA blocks or content outside CDATA (e.g. <Variable>/<Group>/<b:if> + <![CDATA[...]]>)
      if (/<!\[CDATA\[/i.test(inner)) {
        const cdataBlockRe =
          /((?:\/\*|\/\/)?\s*<!\[CDATA\[(?:\s*\*\/)?)\s*([\s\S]*?)\s*((?:\/\*|\/\/)?\s*\]\]>(?:\s*\*\/)?)/gi;
        let lastPos = 0;
        let m: RegExpExecArray | null;
        const rebuiltParts: string[] = [];
        let matchedAny = false;

        while ((m = cdataBlockRe.exec(inner)) !== null) {
          matchedAny = true;
          if (m.index > lastPos) {
            const outsideSeg = inner.slice(lastPos, m.index);
            if (outsideSeg.trim()) {
              rebuiltParts.push(minifyCssTextSafe(outsideSeg));
            }
          }
          const pureSeg = m[2];
          const minSeg = minifyCssTextSafe(pureSeg);
          rebuiltParts.push(`/*<![CDATA[*/\n${minSeg}\n/*]]>*/`);
          lastPos = m.index + m[0].length;
        }

        if (matchedAny) {
          if (lastPos < inner.length) {
            const tailSeg = inner.slice(lastPos);
            if (tailSeg.trim()) {
              rebuiltParts.push(minifyCssTextSafe(tailSeg));
            }
          }
          const nextInner = rebuiltParts.join('\n');
          if (nextInner !== inner && nextInner.length <= inner.length) {
            blocksMinified++;
            return `<${tagName}${attrs}>${nextInner}</${tagName}>`;
          }
          return full;
        }
      }

      // 3. No CDATA originally: minify CSS and wrap with /*<![CDATA[*/.../*]]>*/ if static style has >, <, or &
      const min = minifyCssTextSafe(inner);
      const hasDynamicBloggerTags =
        /<b:(?:eval|if|elseif|else|loop|switch|case|with|attr|class|variable)\b/i.test(inner) ||
        /<data:[a-zA-Z_][a-zA-Z0-9_.-]*/i.test(inner);
      const hasRawXmlChars = /[&<>]/.test(
        min.replace(
          /<\/?(?:b:|data:|expr:|Group\b|Variable\b)(?:"[^"]*"|'[^']*'|[^>"'])*>/gi,
          ''
        )
      );
      if (hasRawXmlChars && !(lowerTag === 'style' && hasDynamicBloggerTags)) {
        blocksMinified++;
        return `<${tagName}${attrs}>/*<![CDATA[*/\n${min}\n/*]]>*/</${tagName}>`;
      }

      if (min === inner.trim() || min.length >= inner.length) return full;
      blocksMinified++;
      return `<${tagName}${attrs}>${min}</${tagName}>`;
    }
  );

  const savedBytes = Math.max(0, xml.length - nextXml.length);
  return {
    nextXml,
    changed: nextXml !== xml,
    savedBytes,
    blocksMinified,
  };
}

/**
 * Safe JavaScript Minifier for Blogger <script> blocks:
 * - Never strips '//' inside strings ("https://..."), template literals (`...`), or regexes (/https?:\/\/[^/]+/g)
 * - Preserves //<![CDATA[, //]]>, /*<![CDATA[* /, /*]]>* /, and /*! license comments
 * - Protects inline Blogger tags (<b:eval>, <b:if>, <data:...>)
 * - ASI-safe: preserves newline statement boundaries (never collapses lines without semicolons)
 */
export function minifyJsTextSafe(js: string): string {
  if (!js.trim()) return js;

  const protectedTags: string[] = [];
  const readQuoteAwareTag = (src: string, startIdx: number): number => {
    let p = startIdx + 1;
    let q: string | null = null;
    while (p < src.length) {
      const c = src[p];
      if (q) {
        if (c === q) q = null;
      } else if (c === '"' || c === "'") {
        q = c;
      } else if (c === '>') {
        return p + 1;
      }
      p++;
    }
    return -1;
  };

  type LexSegment = { kind: 'literal' | 'code'; text: string };
  const segments: LexSegment[] = [];
  let codeBuf = '';
  let lastNonWsChar = '';
  let lastWord = '';

  const flushCodeBuf = () => {
    if (codeBuf) {
      segments.push({ kind: 'code', text: codeBuf });
      codeBuf = '';
    }
  };

  const canStartRegex = () => {
    if (!lastNonWsChar) return true;
    if ('(=,[!:;&|?{}~+-*%^<>'.indexOf(lastNonWsChar) !== -1) return true;
    return /^(?:return|typeof|void|delete|throw|case|in|of|new|else|do|yield|await)$/.test(lastWord);
  };

  const trackCodeChar = (ch: string) => {
    if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') {
      lastNonWsChar = ch;
      if (/[a-zA-Z0-9_$]/.test(ch)) {
        lastWord += ch;
      } else {
        lastWord = '';
      }
    }
  };

  const len = js.length;
  let i = 0;

  while (i < len) {
    const ch = js[i];

    // 1. Single or Double Quoted Strings
    if (ch === "'" || ch === '"') {
      flushCodeBuf();
      const q = ch;
      let j = i + 1;
      while (j < len) {
        const sc = js[j];
        if (sc === '\\' && j + 1 < len) {
          j += 2;
          continue;
        }
        if (sc === q) {
          j++;
          break;
        }
        j++;
      }
      segments.push({ kind: 'literal', text: js.slice(i, j) });
      lastNonWsChar = q;
      lastWord = '';
      i = j;
      continue;
    }

    // 2. Template Literal (`...${expr}...`) with nested JS lexing inside ${...}
    if (ch === '`') {
      flushCodeBuf();
      let j = i + 1;
      let tplPart = '`';
      while (j < len) {
        const tc = js[j];
        if (tc === '\\' && j + 1 < len) {
          tplPart += js[j] + js[j + 1];
          j += 2;
          continue;
        }
        if (tc === '$' && js[j + 1] === '{') {
          tplPart += '${';
          j += 2;
          let depth = 1;
          let innerStart = j;
          let innerQ: string | null = null;
          while (j < len && depth > 0) {
            const ic = js[j];
            if (innerQ) {
              if (ic === '\\' && j + 1 < len) {
                j += 2;
                continue;
              }
              if (ic === innerQ) innerQ = null;
              j++;
              continue;
            }
            if (ic === "'" || ic === '"' || ic === '`') {
              innerQ = ic;
              j++;
              continue;
            }
            if (ic === '/' && js[j + 1] === '/') {
              const nl = js.indexOf('\n', j + 2);
              j = nl === -1 ? len : nl + 1;
              continue;
            }
            if (ic === '/' && js[j + 1] === '*') {
              const ec = js.indexOf('*/', j + 2);
              j = ec === -1 ? len : ec + 2;
              continue;
            }
            if (ic === '{') depth++;
            else if (ic === '}') {
              depth--;
              if (depth === 0) break;
            }
            j++;
          }
          const exprRaw = js.slice(innerStart, j);
          tplPart += minifyJsTextSafe(exprRaw);
          if (j < len && js[j] === '}') {
            tplPart += '}';
            j++;
          }
          continue;
        }
        if (tc === '`') {
          tplPart += '`';
          j++;
          break;
        }
        tplPart += tc;
        j++;
      }
      segments.push({ kind: 'literal', text: tplPart });
      lastNonWsChar = '`';
      lastWord = '';
      i = j;
      continue;
    }

    // 3. Single-line comment // (preserve //<![CDATA[ and //]]>)
    if (ch === '/' && js[i + 1] === '/') {
      const nl = js.indexOf('\n', i + 2);
      const lineText = nl === -1 ? js.slice(i) : js.slice(i, nl);
      if (/^\/\/\s*(?:<!\[CDATA\[|\]\]>)/i.test(lineText)) {
        flushCodeBuf();
        segments.push({ kind: 'literal', text: lineText });
        if (nl !== -1) codeBuf += '\n';
      } else if (nl !== -1) {
        codeBuf += '\n';
      }
      i = nl === -1 ? len : nl + 1;
      continue;
    }

    // 4. Block comment /* ... */ (preserve /*! and CDATA wrappers)
    if (ch === '/' && js[i + 1] === '*') {
      const endC = js.indexOf('*/', i + 2);
      if (endC === -1) {
        codeBuf += js.slice(i);
        break;
      }
      const cmt = js.slice(i, endC + 2);
      if (cmt.startsWith('/*!') || /<!\[CDATA\[|\]\]>/i.test(cmt)) {
        flushCodeBuf();
        segments.push({ kind: 'literal', text: cmt });
      } else {
        // Keep newline if multiline comment bridged statements (ASI protection)
        codeBuf += cmt.includes('\n') ? '\n' : ' ';
      }
      i = endC + 2;
      continue;
    }

    // 5. Regex literal /.../flags with [...] character class support
    if (ch === '/' && canStartRegex()) {
      flushCodeBuf();
      let j = i + 1;
      let inClass = false;
      while (j < len) {
        const rc = js[j];
        if (rc === '\\' && j + 1 < len) {
          j += 2;
          continue;
        }
        if (rc === '\n' || rc === '\r') break;
        if (rc === '[' && !inClass) {
          inClass = true;
        } else if (rc === ']' && inClass) {
          inClass = false;
        } else if (rc === '/' && !inClass) {
          j++;
          while (j < len && /[a-zA-Z]/.test(js[j])) j++;
          break;
        }
        j++;
      }
      segments.push({ kind: 'literal', text: js.slice(i, j) });
      lastNonWsChar = '/';
      lastWord = '';
      i = j;
      continue;
    }

    // 6. Inline Blogger XML tags inside <script> (<b:eval>, <b:if>, <data:.../>)
    if (ch === '<' && /^<\/?(?:b|data):[a-zA-Z0-9_.:-]+/i.test(js.slice(i))) {
      const tagEnd = readQuoteAwareTag(js, i);
      if (tagEnd !== -1) {
        flushCodeBuf();
        const idx = protectedTags.push(js.slice(i, tagEnd)) - 1;
        segments.push({ kind: 'literal', text: `__TEMALOKA_JSTAG_${idx}__` });
        lastNonWsChar = '_';
        lastWord = '';
        i = tagEnd;
        continue;
      }
    }

    codeBuf += ch;
    trackCodeChar(ch);
    i++;
  }
  flushCodeBuf();

  // Safely compress ONLY horizontal whitespace inside code segments (preserving newlines for ASI!)
  const compressed = segments
    .map((seg) => {
      if (seg.kind === 'literal') return seg.text;
      return seg.text
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/[ \t]*([{},;=()[\]])[ \t]*/g, '$1');
    })
    .join('');

  const cleanedLines = compressed
    .split('\n')
    .map((line) => line.replace(/^[ \t]+|[ \t]+$/g, ''))
    .filter((line) => line.length > 0)
    .join('\n');

  return cleanedLines.replace(/__TEMALOKA_JSTAG_(\d+)__/g, (_, idxStr: string) => {
    return protectedTags[Number.parseInt(idxStr, 10)] || '';
  });
}

export function minifyJsInXmlOffline(xml: string): {
  nextXml: string;
  changed: boolean;
  savedBytes: number;
  blocksMinified: number;
} {
  let blocksMinified = 0;
  // Skip XML comments so commented-out <script> blocks are untouched
  const nextXml = xml.replace(
    /<!--[\s\S]*?-->|<script\b((?:"[^"]*"|'[^']*'|[^>"'/]|\/(?!>))*)>([\s\S]*?)<\/script>/gi,
    (full, attrs?: string, inner?: string) => {
      if (attrs === undefined || inner === undefined) return full;
      if (/(?:^|\s)(?:expr:)?src\s*=/i.test(attrs)) return full;
      const typeMatch = /(?:^|\s)type\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
      const typeVal = (typeMatch?.[1] ?? typeMatch?.[2] ?? '').toLowerCase().trim();
      if (
        typeVal &&
        typeVal !== 'text/javascript' &&
        typeVal !== 'application/javascript' &&
        typeVal !== 'module'
      ) {
        return full;
      }
      if (!inner.trim()) return full;

      const hasDynamicBloggerTags =
        /<b:(?:eval|if|elseif|else|loop|switch|case|with|attr|class|variable)\b/i.test(inner) ||
        /<data:[a-zA-Z_][a-zA-Z0-9_.-]*/i.test(inner) ||
        /\bdata:[a-zA-Z_][a-zA-Z0-9_.-]*/i.test(inner);

      const outerCdata =
        /^\s*((?:\/\/|\/\*)\s*<!\[CDATA\[(?:\s*\*\/)?|<!\[CDATA\[)\s*([\s\S]*?)\s*((?:\/\/|\/\*)\s*\]\]>(?:\s*\*\/)?|\]\]>)\s*$/i.exec(
          inner
        );
      if (outerCdata && !/<!\[CDATA\[|\]\]>/i.test(outerCdata[2])) {
        const pure = outerCdata[2];
        const min = minifyJsTextSafe(pure);
        const wrappedMin = `//<![CDATA[\n${min}\n//]]>`;
        const alreadyCleanCdata =
          outerCdata[1].trim() === '//<![CDATA[' && outerCdata[3].trim() === '//]]>';
        if (alreadyCleanCdata && (min === pure.trim() || min.length >= pure.length)) {
          return full;
        }
        if (wrappedMin === inner.trim() || wrappedMin.length >= inner.length) {
          if (alreadyCleanCdata) return full;
        }
        blocksMinified++;
        return `<script${attrs}>${wrappedMin}</script>`;
      }

      // No single outer CDATA wrapper
      const min = minifyJsTextSafe(inner);
      const hasRawXmlChars = /[&<>]/.test(
        min.replace(/<\/?(?:b:|data:|expr:)(?:"[^"]*"|'[^']*'|[^>"'])*>/gi, '')
      );
      if (hasRawXmlChars && !hasDynamicBloggerTags && !/<!\[CDATA\[/i.test(min)) {
        blocksMinified++;
        return `<script${attrs}>//<![CDATA[\n${min}\n//]]></script>`;
      }

      if (min === inner.trim() || min.length >= inner.length) return full;
      blocksMinified++;
      return `<script${attrs}>${min}</script>`;
    }
  );

  const savedBytes = Math.max(0, xml.length - nextXml.length);
  return {
    nextXml,
    changed: nextXml !== xml,
    savedBytes,
    blocksMinified,
  };
}
