import type {
  BloggerSectionInfo,
  BloggerVariable,
  BloggerWidgetInfo,
  BloggerWidgetSetting,
  CssCustomProperty,
  DevicePreset,
  DetectedImageAsset,
  DetectedNavLink,
  DetectedPageText,
  DetectedRegionBlock,
  DetectedSvgAsset,
  ExternalResourceInfo,
  FontCustomization,
  HardcodedColorToken,
  HardcodedFontToken,
  ParsedTemplateInfo,
  PreviewPageType,
  SampleBlogData,
  SamplePost,
  TemplateByteBreakdown,
  ThemePaletteOverrides,
} from '../types/blogger';
import {
  analyzeCssJsRedundancyInXml,
  detectEncodedCodesInXml,
  detectJsCssUrlsInXml,
} from './scriptAndCodeInspector';
import {
  buildSkinVariableMap,
  decodeXmlEntities,
  ensureRealisticSampleData,
  renderBloggerBodyFromXml,
} from './bloggerTemplateEngine';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function resolvePreviewImageUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
    return url;
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${url.startsWith('/') ? '' : '/'}${url}`;
  }
  return url;
}

export function extractSkinContent(xml: string): string {
  const skinMatch = /<b:skin[^>]*>([\s\S]*?)<\/b:skin>/i.exec(xml);
  if (!skinMatch) return '';
  let content = skinMatch[1];
  content = content.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  return content;
}

function extractAllStyleBlocks(xml: string): string[] {
  const blocks: string[] = [];
  const skin = extractSkinContent(xml);
  if (skin) blocks.push(skin);

  const templateSkinMatch = /<b:template-skin[^>]*>([\s\S]*?)<\/b:template-skin>/i.exec(xml);
  if (templateSkinMatch) {
    blocks.push(templateSkinMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
  }

  const styleRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let m: RegExpExecArray | null;
  while ((m = styleRegex.exec(xml)) !== null) {
    if (m[1]) {
      blocks.push(
        m[1]
          .replace(/\/\*<!\[CDATA\[\*\//g, '')
          .replace(/\/\*\]\]>\*\//g, '')
          .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      );
    }
  }
  return blocks;
}

function classifyCssValueType(name: string, val: string): CssCustomProperty['valueType'] {
  const v = val.trim().toLowerCase();
  const n = name.toLowerCase();
  if (
    /^#[0-9a-f]{3,8}$/i.test(v) ||
    /^(?:rgb|rgba|hsl|hsla)\s*\(/i.test(v) ||
    n.includes('color') ||
    n.includes('bg') ||
    n.endsWith('c')
  ) {
    if (/^#[0-9a-f]{3,8}$/i.test(v) || /^(?:rgb|rgba|hsl|hsla)\s*\(/i.test(v)) {
      return 'color';
    }
  }
  if (n.includes('font') || v.includes('sans-serif') || v.includes('serif') || v.includes('monospace')) {
    return 'font';
  }
  if (/^-?\d*\.?\d+(?:px|rem|em|vh|vw|%)$/i.test(v)) {
    return 'length';
  }
  return 'other';
}

const utf8TextEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

export function getUtf8ByteLength(text: string): number {
  if (!text) return 0;
  return utf8TextEncoder ? utf8TextEncoder.encode(text).length : text.length * 2;
}

const parsedXmlLruCache: Array<{
  xml: string;
  skipRedundancy: boolean;
  result: ParsedTemplateInfo;
}> = [];

export function parseBloggerXml(
  xml: string,
  options?: { skipRedundancyAnalysis?: boolean }
): ParsedTemplateInfo {
  const skipRedundancy = Boolean(options?.skipRedundancyAnalysis);
  for (let i = 0; i < parsedXmlLruCache.length; i++) {
    const entry = parsedXmlLruCache[i];
    if (entry.xml === xml && entry.skipRedundancy === skipRedundancy) {
      if (i > 0) {
        parsedXmlLruCache.splice(i, 1);
        parsedXmlLruCache.unshift(entry);
      }
      return entry.result;
    }
  }

  const rawSkinCss = extractSkinContent(xml);
  const templateSkinMatch = /<b:template-skin[^>]*>([\s\S]*?)<\/b:template-skin>/i.exec(xml);
  const rawTemplateSkin = templateSkinMatch
    ? templateSkinMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    : '';
  const allCssText = extractAllStyleBlocks(xml).join('\n');

  const variables: BloggerVariable[] = [];
  const seenVarNames = new Set<string>();

  const extractVarsFromChunk = (
    chunk: string,
    groupName: string | undefined,
    source: BloggerVariable['source']
  ) => {
    const varRegex = /<Variable\b([\s\S]*?)(?:\/>|><\/Variable>)/gi;
    let varMatch: RegExpExecArray | null;
    while ((varMatch = varRegex.exec(chunk)) !== null) {
      const attrs = varMatch[1];
      const name = getAttr(attrs, 'name');
      if (!name || seenVarNames.has(name)) continue;
      seenVarNames.add(name);

      const description = getAttr(attrs, 'description') || name;
      const type = getAttr(attrs, 'type') || 'string';
      const defaultValue = getAttr(attrs, 'default') || '';
      const value = getAttr(attrs, 'value') || defaultValue;
      const min = getAttr(attrs, 'min') || undefined;
      const max = getAttr(attrs, 'max') || undefined;

      variables.push({
        name,
        description,
        type,
        defaultValue,
        value,
        group: groupName,
        source,
        min,
        max,
      });
    }
  };

  const scanGroupsAndVars = (chunk: string, source: BloggerVariable['source']) => {
    const groupRegex = /<Group\b([\s\S]*?)>([\s\S]*?)<\/Group>/gi;
    let groupMatch: RegExpExecArray | null;
    while ((groupMatch = groupRegex.exec(chunk)) !== null) {
      const groupAttrs = groupMatch[1];
      const groupDesc = getAttr(groupAttrs, 'description') || 'Grup Tema';
      extractVarsFromChunk(groupMatch[2], groupDesc, source);
    }
    extractVarsFromChunk(chunk, undefined, source);
  };

  scanGroupsAndVars(rawSkinCss, 'b:skin');
  if (rawTemplateSkin) scanGroupsAndVars(rawTemplateSkin, 'b:template-skin');
  scanGroupsAndVars(xml, 'head');

  // Aggressively extract CSS Custom Properties (--var-name: value;) from all CSS blocks in O(N)
  const cssCustomProperties: CssCustomProperty[] = [];
  const seenCssVars = new Set<string>();
  const strippedCommentsCss = allCssText.replace(/\/\*[\s\S]*?\*\//g, '');

  const cssVarUsageCounts = new Map<string, number>();
  const cssVarUsageRe = /var\(\s*(--[a-zA-Z0-9_-]+)/g;
  let usageMatch: RegExpExecArray | null;
  while ((usageMatch = cssVarUsageRe.exec(strippedCommentsCss)) !== null) {
    const vName = usageMatch[1];
    cssVarUsageCounts.set(vName, (cssVarUsageCounts.get(vName) || 0) + 1);
  }

  const ruleBlockRegex = /([^{};]+)\{([^{}]*)\}/g;
  let ruleMatch: RegExpExecArray | null;
  while ((ruleMatch = ruleBlockRegex.exec(strippedCommentsCss)) !== null) {
    const selector = ruleMatch[1].trim().replace(/\s+/g, ' ').slice(0, 60);
    const body = ruleMatch[2];
    const propRegex = /(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+);?/g;
    let propMatch: RegExpExecArray | null;
    while ((propMatch = propRegex.exec(body)) !== null) {
      const propName = propMatch[1].trim();
      const propVal = propMatch[2].trim();
      const uniqueKey = `${selector}::${propName}`;
      if (seenCssVars.has(uniqueKey)) continue;
      seenCssVars.add(uniqueKey);

      cssCustomProperties.push({
        name: propName,
        value: propVal,
        selector,
        valueType: classifyCssValueType(propName, propVal),
        occurrences: cssVarUsageCounts.get(propName) || 0,
      });
    }
  }

  // Aggressively scan dominant hardcoded colors in CSS (outside <Variable> tags)
  const cssWithoutVars = strippedCommentsCss
    .replace(/<Group\b[\s\S]*?<\/Group>/gi, '')
    .replace(/<Variable\b[\s\S]*?(?:\/>|><\/Variable>)/gi, '');

  const colorFreq = new Map<string, { count: number; sampleContext: string }>();
  const colorLineRegex = /([a-zA-Z-]+\s*:\s*[^;\n{}]*(?:#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|(?:rgb|rgba|hsl|hsla)\([^)]+\))[^;\n{}]*)/gi;
  let cLineMatch: RegExpExecArray | null;
  while ((cLineMatch = colorLineRegex.exec(cssWithoutVars)) !== null) {
    const lineSnippet = cLineMatch[1].trim().slice(0, 80);
    const hexTokens = lineSnippet.match(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g) || [];
    for (const rawHex of hexTokens) {
      let norm = rawHex.toLowerCase();
      if (norm.length === 4) {
        norm = `#${norm[1]}${norm[1]}${norm[2]}${norm[2]}${norm[3]}${norm[3]}`;
      }
      const prev = colorFreq.get(norm);
      if (prev) {
        prev.count++;
      } else {
        colorFreq.set(norm, { count: 1, sampleContext: lineSnippet });
      }
    }
  }
  const hardcodedColors: HardcodedColorToken[] = Array.from(colorFreq.entries())
    .map(([color, info]) => ({ color, count: info.count, sampleContext: info.sampleContext }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 40);

  // Aggressively scan declared font-family rules
  const fontFreq = new Map<string, number>();
  const fontRegex = /font-family\s*:\s*([^;{}!\n]+)/gi;
  let fMatch: RegExpExecArray | null;
  while ((fMatch = fontRegex.exec(cssWithoutVars)) !== null) {
    const family = fMatch[1].trim().replace(/\s+/g, ' ');
    if (family && !family.startsWith('$') && !family.startsWith('var(')) {
      fontFreq.set(family, (fontFreq.get(family) || 0) + 1);
    }
  }
  const hardcodedFonts: HardcodedFontToken[] = Array.from(fontFreq.entries())
    .map(([fontFamily, count]) => ({ fontFamily, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  // External stylesheets, fonts, and scripts
  const externalResources: ExternalResourceInfo[] = [];
  const seenUrls = new Set<string>();
  const linkRegex = /<link\b([^>]*?)\/?>/gi;
  let lMatch: RegExpExecArray | null;
  while ((lMatch = linkRegex.exec(xml)) !== null) {
    const attrs = lMatch[1];
    const rel = getAttr(attrs, 'rel').toLowerCase();
    const href = getAttr(attrs, 'href');
    if (href && (rel.includes('stylesheet') || href.includes('fonts.googleapis.com')) && !seenUrls.has(href)) {
      seenUrls.add(href);
      externalResources.push({
        kind: href.includes('fonts.') ? 'font' : 'stylesheet',
        url: href.replace(/&amp;/g, '&'),
      });
    }
  }
  const extScriptRegex = /<script\b([^>]*?)src\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let sMatch: RegExpExecArray | null;
  while ((sMatch = extScriptRegex.exec(xml)) !== null) {
    const src = sMatch[2] || sMatch[3];
    if (src && !seenUrls.has(src)) {
      seenUrls.add(src);
      externalResources.push({ kind: 'script', url: src.replace(/&amp;/g, '&') });
    }
  }

  const lineStarts: number[] = [0];
  for (let i = 0; i < xml.length; i++) {
    if (xml.charCodeAt(i) === 10) lineStarts.push(i + 1);
  }
  const lineAt = (idx: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lineStarts[mid] <= idx) lo = mid + 1;
      else hi = mid - 1;
    }
    return Math.max(1, lo);
  };

  // Sections, Widgets, and <b:widget-setting>
  const sections: BloggerSectionInfo[] = [];
  const widgets: BloggerWidgetInfo[] = [];
  const widgetSettings: BloggerWidgetSetting[] = [];
  const seenWidgetIds = new Set<string>();

  const sectionRegex = /<b:section\b([^>]*?)(?:\/>|>([\s\S]*?)<\/b:section>)/gi;
  let secMatch: RegExpExecArray | null;
  while ((secMatch = sectionRegex.exec(xml)) !== null) {
    const secAttrs = secMatch[1];
    const secId = getAttr(secAttrs, 'id') || `section-${sections.length + 1}`;
    const secClass = getAttr(secAttrs, 'class') || '';
    const secBody = secMatch[2] || '';
    const secBodyOffset = secMatch.index + secMatch[0].indexOf('>') + 1;

    let widgetCount = 0;
    const widgetRegex = /<b:widget\b([^>]*?)(?:\/>|>([\s\S]*?)<\/b:widget>)/gi;
    let wMatch: RegExpExecArray | null;
    while ((wMatch = widgetRegex.exec(secBody)) !== null) {
      widgetCount++;
      const wAttrs = wMatch[1];
      const wBody = wMatch[2] || '';
      const wId = getAttr(wAttrs, 'id') || `Widget${widgets.length + 1}`;
      const wType = getAttr(wAttrs, 'type') || 'HTML';
      seenWidgetIds.add(wId);

      widgets.push({
        id: wId,
        type: wType,
        title: getAttr(wAttrs, 'title') || wType || 'Widget',
        sectionId: secId,
        version: getAttr(wAttrs, 'version') || undefined,
        locked: getAttr(wAttrs, 'locked') || undefined,
        visible: getAttr(wAttrs, 'visible') || undefined,
        line: lineAt(secBodyOffset + wMatch.index),
      });

      const settingRegex = /<b:widget-setting\b([^>]*?)>([\s\S]*?)<\/b:widget-setting>/gi;
      let stMatch: RegExpExecArray | null;
      while ((stMatch = settingRegex.exec(wBody)) !== null) {
        const stName = getAttr(stMatch[1], 'name');
        if (stName) {
          widgetSettings.push({
            widgetId: wId,
            widgetType: wType,
            name: stName,
            value: stMatch[2].trim(),
          });
        }
      }
    }

    sections.push({
      id: secId,
      className: secClass,
      widgetCount,
      maxWidgets: getAttr(secAttrs, 'maxwidgets') || undefined,
      showAddElement: getAttr(secAttrs, 'showaddelement') || undefined,
    });
  }

  // Also detect any standalone <b:widget> outside <b:section>
  const standaloneWidgetRegex = /<b:widget\b([^>]*?)(?:\/>|>([\s\S]*?)<\/b:widget>)/gi;
  let swMatch: RegExpExecArray | null;
  while ((swMatch = standaloneWidgetRegex.exec(xml)) !== null) {
    const wAttrs = swMatch[1];
    const wId = getAttr(wAttrs, 'id') || `Widget${widgets.length + 1}`;
    if (seenWidgetIds.has(wId)) continue;
    seenWidgetIds.add(wId);
    const wType = getAttr(wAttrs, 'type') || 'HTML';
    widgets.push({
      id: wId,
      type: wType,
      title: getAttr(wAttrs, 'title') || wType || 'Widget',
      sectionId: '(standalone)',
      version: getAttr(wAttrs, 'version') || undefined,
      locked: getAttr(wAttrs, 'locked') || undefined,
      visible: getAttr(wAttrs, 'visible') || undefined,
      line: lineAt(swMatch.index),
    });
  }

  // Aggressively detect Images (<img>, CSS url(...), og:image, favicon, expr:src)
  const imageMap = new Map<string, DetectedImageAsset>();
  const addImage = (
    rawUrl: string,
    sourceKind: DetectedImageAsset['sourceKind'],
    context: string,
    idx: number
  ) => {
    const cleaned = rawUrl.trim().replace(/^['"]|['"]$/g, '');
    if (
      !cleaned ||
      cleaned.startsWith('data:image/svg+xml') ||
      cleaned.startsWith('#') ||
      cleaned.length < 4
    ) {
      return;
    }
    const existing = imageMap.get(cleaned);
    if (existing) {
      existing.count++;
    } else {
      imageMap.set(cleaned, {
        id: `img-${imageMap.size + 1}`,
        url: cleaned,
        sourceKind,
        context,
        line: lineAt(idx),
        count: 1,
      });
    }
  };

  const imgTagRegex = /<img\b([^>]*?)\/?>/gi;
  let imgMatch: RegExpExecArray | null;
  while ((imgMatch = imgTagRegex.exec(xml)) !== null) {
    const attrs = imgMatch[1];
    const src = getAttr(attrs, 'src') || getAttr(attrs, 'data-src') || getAttr(attrs, 'data-original');
    const exprSrc = getAttr(attrs, 'expr:src');
    const alt = getAttr(attrs, 'alt') || getAttr(attrs, 'class') || 'Tag <img>';
    if (src) addImage(src, 'img', alt, imgMatch.index);
    else if (exprSrc) addImage(exprSrc, 'expr-img', `expr:src (${alt})`, imgMatch.index);
  }

  const metaOgRegex = /<meta\b([^>]*?(?:og:image|twitter:image)[^>]*?)\/?>/gi;
  let ogMatch: RegExpExecArray | null;
  while ((ogMatch = metaOgRegex.exec(xml)) !== null) {
    const content = getAttr(ogMatch[1], 'content');
    if (content) addImage(content, 'meta-og', 'Meta OG / Social Thumbnail', ogMatch.index);
  }

  const iconRegex = /<link\b([^>]*?rel\s*=\s*["'][^"']*icon[^"']*["'][^>]*?)\/?>/gi;
  let icMatch: RegExpExecArray | null;
  while ((icMatch = iconRegex.exec(xml)) !== null) {
    const href = getAttr(icMatch[1], 'href');
    if (href) addImage(href, 'favicon', 'Favicon / App Icon', icMatch.index);
  }

  const cssUrlRegex = /url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi;
  let cuMatch: RegExpExecArray | null;
  while ((cuMatch = cssUrlRegex.exec(allCssText)) !== null) {
    const url = cuMatch[2];
    if (/\.(png|jpe?g|webp|gif|avif|ico|bmp)(?:\?|$)/i.test(url) || url.startsWith('data:image/')) {
      addImage(url, 'css-url', 'CSS background-image / url()', 0);
    }
  }
  const images = Array.from(imageMap.values()).slice(0, 60);

  // Aggressively detect inline <svg> elements
  const svgs: DetectedSvgAsset[] = [];
  const svgRegex = /<svg\b([^>]*)>([\s\S]*?)<\/svg>/gi;
  let svgMatch: RegExpExecArray | null;
  while ((svgMatch = svgRegex.exec(xml)) !== null) {
    if (svgs.length >= 60) break;
    const attrs = svgMatch[1];
    const surrounding = xml.slice(Math.max(0, svgMatch.index - 120), svgMatch.index);
    const parentHintMatch = /<(?:a|button|div|span|li|h[1-6])\b[^>]*(?:id|class|aria-label|title)=["']([^"']+)["'][^>]*>\s*$/i.exec(surrounding);
    svgs.push({
      index: svgs.length,
      idAttr: getAttr(attrs, 'id'),
      classAttr: getAttr(attrs, 'class'),
      viewBox: getAttr(attrs, 'viewBox') || '-',
      width: getAttr(attrs, 'width') || 'auto',
      height: getAttr(attrs, 'height') || 'auto',
      fill: getAttr(attrs, 'fill') || 'currentColor',
      context: parentHintMatch?.[1] || getAttr(attrs, 'aria-label') || getAttr(attrs, 'class') || 'Inline SVG',
      line: lineAt(svgMatch.index),
      rawSvg: svgMatch[0],
    });
  }

  // Aggressively detect Navigation Links (Header, Nav, PageList, LinkList, Footer)
  const xmlLower = xml.toLowerCase();
  const lastInWindow = (token: string, minStart: number, maxFrom: number): number => {
    if (maxFrom < 0) return -1;
    const found = xmlLower.lastIndexOf(token, maxFrom);
    return found >= minStart ? found : -1;
  };

  const navLinks: DetectedNavLink[] = [];
  const detectZone = (idx: number): DetectedNavLink['zone'] => {
    const minStart = Math.max(0, idx - 1200);
    const maxFrom = idx - 1;
    const lastHeader = Math.max(
      lastInWindow('<header', minStart, maxFrom),
      lastInWindow("id='header", minStart, maxFrom),
      lastInWindow('id="header', minStart, maxFrom)
    );
    const lastHeaderClose = lastInWindow('</header>', minStart, maxFrom);
    if (lastHeader > lastHeaderClose) return 'header';

    const lastNav = Math.max(
      lastInWindow('<nav', minStart, maxFrom),
      lastInWindow("class='nav", minStart, maxFrom),
      lastInWindow('class="nav', minStart, maxFrom),
      lastInWindow("class='menu", minStart, maxFrom),
      lastInWindow('class="menu', minStart, maxFrom)
    );
    const lastNavClose = lastInWindow('</nav>', minStart, maxFrom);
    if (lastNav > lastNavClose) return 'nav';

    const lastFooter = Math.max(
      lastInWindow('<footer', minStart, maxFrom),
      lastInWindow("id='footer", minStart, maxFrom),
      lastInWindow('id="footer', minStart, maxFrom)
    );
    const lastFooterClose = lastInWindow('</footer>', minStart, maxFrom);
    if (lastFooter > lastFooterClose) return 'footer';

    const lastWidget = lastInWindow('<b:widget', minStart, maxFrom);
    const lastWidgetClose = lastInWindow('</b:widget>', minStart, maxFrom);
    if (lastWidget > lastWidgetClose) return 'widget';

    return 'body';
  };

  const anchorRegex = /<a\b([^>]*?)>([\s\S]*?)<\/a>/gi;
  let aMatch: RegExpExecArray | null;
  while ((aMatch = anchorRegex.exec(xml)) !== null) {
    if (navLinks.length >= 80) break;
    const attrs = aMatch[1];
    const href = getAttr(attrs, 'href') || getAttr(attrs, 'expr:href');
    if (!href) continue;
    // Skip dynamic post-level loops where href is data:post.url
    if (href.includes('data:post.') && !href.includes('homepageUrl')) continue;

    const zone = detectZone(aMatch.index);
    if (zone === 'body') continue; // focus on header, nav, footer, and widget menus

    const cleanText = aMatch[2]
      .replace(/<svg[\s\S]*?<\/svg>/gi, '[SVG]')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    navLinks.push({
      index: navLinks.length,
      text: cleanText || '(Ikon / Tanpa Teks)',
      href,
      zone,
      line: lineAt(aMatch.index),
      rawTag: aMatch[0],
    });
  }

  const isBloggerDynamicExpr = (text?: string, snippet?: string): boolean => {
    const combined = `${text || ''}\n${snippet || ''}`;
    return (
      /<b:(?:if|elseif|else|with|loop|switch|case|default|eval|include|attr|class|tag)\b/i.test(combined) ||
      /<data:[a-zA-Z0-9_.-]+/i.test(combined) ||
      /\bexpr:[a-zA-Z0-9_-]+\s*=/i.test(combined) ||
      /\bdata:[a-zA-Z0-9_.-]+/i.test(combined) ||
      /\$\([a-zA-Z0-9_.-]+\)/.test(combined)
    );
  };

  // Detect Header, Footer, Meta SEO, and Copyright Regions
  const regions: DetectedRegionBlock[] = [];
  const headTitleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(xml);
  if (headTitleMatch) {
    const titleInner = headTitleMatch[1].trim();
    regions.push({
      id: 'meta-title',
      zone: 'meta',
      label: 'Judul Blog (<title>)',
      line: lineAt(headTitleMatch.index),
      previewText: titleInner,
      rawSnippet: headTitleMatch[0],
      editableValue: titleInner,
      isDynamic: isBloggerDynamicExpr(titleInner, headTitleMatch[0]),
    });
  }

  const metaDescRegex = /<meta\b([^>]*\bname\s*=\s*["']description["'][^>]*)\/?>/gi;
  const mdMatch = metaDescRegex.exec(xml);
  if (mdMatch) {
    const content = getAttr(mdMatch[1], 'content') || getAttr(mdMatch[1], 'expr:content');
    const isDyn = isBloggerDynamicExpr(content, mdMatch[0]);
    regions.push({
      id: 'meta-desc',
      zone: 'meta',
      label: 'Meta Description SEO',
      line: lineAt(mdMatch.index),
      previewText: content || '(Dinamis / kosong)',
      rawSnippet: mdMatch[0],
      editableValue: content,
      isDynamic: isDyn,
    });
  }

  const headerBlockMatch = /<header\b([^>]*)>([\s\S]*?)<\/header>/i.exec(xml);
  if (headerBlockMatch) {
    const textPreview = headerBlockMatch[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    regions.push({
      id: 'region-header',
      zone: 'header',
      label: 'Blok <header> Utama',
      line: lineAt(headerBlockMatch.index),
      previewText: textPreview.slice(0, 140) || '(Header dengan widget Blogger)',
      rawSnippet: headerBlockMatch[0],
    });
  }

  const footerBlockMatch = /<footer\b([^>]*)>([\s\S]*?)<\/footer>/i.exec(xml);
  if (footerBlockMatch) {
    const textPreview = footerBlockMatch[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    regions.push({
      id: 'region-footer',
      zone: 'footer',
      label: 'Blok <footer> Utama',
      line: lineAt(footerBlockMatch.index),
      previewText: textPreview.slice(0, 140) || '(Footer dengan widget Blogger)',
      rawSnippet: footerBlockMatch[0],
    });
  }

  const copyrightRegex = /(<(?:div|p|span)\b[^>]*>(?:[^<]*?(?:&copy;|&#169;|©|copyright|powered by|designed by)[^<]*?)<\/(?:div|p|span)>)/gi;
  let cpMatch: RegExpExecArray | null;
  while ((cpMatch = copyrightRegex.exec(xml)) !== null) {
    if (regions.filter((r) => r.zone === 'copyright').length >= 5) break;
    const textPreview = cpMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    regions.push({
      id: `copyright-${regions.length + 1}`,
      zone: 'copyright',
      label: 'Teks Copyright / Kredit Footer',
      line: lineAt(cpMatch.index),
      previewText: textPreview.slice(0, 140),
      rawSnippet: cpMatch[1],
      editableValue: cpMatch[1],
    });
  }

  // 6. Aggressive Page Text Detector (Widget titles, Widget content, Header/Footer/Nav/Heading/Body literal text, Meta)
  const pageTexts: DetectedPageText[] = [];
  const seenTextSnippets = new Set<string>();

  const inferTextZone = (idx: number, tagName: string): DetectedPageText['zone'] => {
    const minStart = Math.max(0, idx - 6000);
    const maxFrom = idx - 1;
    const lastHeader = Math.max(
      lastInWindow('<header', minStart, maxFrom),
      lastInWindow("id='header", minStart, maxFrom),
      lastInWindow('id="header', minStart, maxFrom)
    );
    const lastHeaderClose = lastInWindow('</header>', minStart, maxFrom);
    if (lastHeader > lastHeaderClose) return 'header';

    const lastFooter = Math.max(
      lastInWindow('<footer', minStart, maxFrom),
      lastInWindow("id='footer", minStart, maxFrom),
      lastInWindow('id="footer', minStart, maxFrom)
    );
    const lastFooterClose = lastInWindow('</footer>', minStart, maxFrom);
    if (lastFooter > lastFooterClose) return 'footer';

    const lastNav = Math.max(
      lastInWindow('<nav', minStart, maxFrom),
      lastInWindow("class='nav", minStart, maxFrom),
      lastInWindow('class="nav', minStart, maxFrom)
    );
    const lastNavClose = lastInWindow('</nav>', minStart, maxFrom);
    if (lastNav > lastNavClose) return 'nav';

    const lastWidget = lastInWindow('<b:widget', minStart, maxFrom);
    const lastWidgetClose = lastInWindow('</b:widget>', minStart, maxFrom);
    if (lastWidget > lastWidgetClose) return 'widget';

    if (/^h[1-6]$/i.test(tagName)) return 'heading';
    return 'content';
  };

  // 6a. Meta Title & Meta Description (include both static and dynamic with Dynamic Tag Guard)
  if (headTitleMatch) {
    const innerTitle = headTitleMatch[1].trim();
    if (innerTitle) {
      pageTexts.push({
        id: 'meta-title',
        zone: 'meta',
        sourceType: 'meta-title',
        label: 'Judul Blog (<title>)',
        text: innerTitle,
        line: lineAt(headTitleMatch.index),
        rawSnippet: headTitleMatch[0],
        isDynamic: isBloggerDynamicExpr(innerTitle, headTitleMatch[0]),
      });
    }
  }
  const mdMatchForText = /<meta\b([^>]*\bname\s*=\s*["']description["'][^>]*)\/?>/i.exec(xml);
  if (mdMatchForText) {
    const contentVal = getAttr(mdMatchForText[1], 'content') || getAttr(mdMatchForText[1], 'expr:content');
    if (contentVal) {
      pageTexts.push({
        id: 'meta-desc',
        zone: 'meta',
        sourceType: 'meta-desc',
        label: 'Meta Description',
        text: contentVal,
        line: lineAt(mdMatchForText.index),
        rawSnippet: mdMatchForText[0],
        isDynamic: isBloggerDynamicExpr(contentVal, mdMatchForText[0]),
      });
    }
  }

  // 6b. Widget Titles
  for (const w of widgets) {
    if (w.title && w.title.trim()) {
      const secLower = `${w.sectionId} ${w.id}`.toLowerCase();
      const zone: DetectedPageText['zone'] = secLower.includes('header')
        ? 'header'
        : secLower.includes('footer')
          ? 'footer'
          : w.type.toLowerCase() === 'pagelist' || w.type.toLowerCase() === 'linklist'
            ? 'nav'
            : 'widget';
      pageTexts.push({
        id: `wtitle-${w.id}`,
        zone,
        sourceType: 'widget-title',
        label: `Judul Widget ${w.id} (${w.type})`,
        text: w.title,
        line: w.line || 1,
        rawSnippet: w.id,
        widgetId: w.id,
      });
    }
  }

  // 6c. Widget <b:widget-setting name='content'> (and copyright/text settings)
  for (const ws of widgetSettings) {
    if (
      ['content', 'copyright', 'text', 'description', 'html'].includes(ws.name.toLowerCase()) &&
      ws.value.trim()
    ) {
      const parentWidget = widgets.find((w) => w.id === ws.widgetId);
      const secLower = `${parentWidget?.sectionId || ''} ${ws.widgetId}`.toLowerCase();
      const zone: DetectedPageText['zone'] = secLower.includes('footer')
        ? 'footer'
        : secLower.includes('header')
          ? 'header'
          : 'widget';
      pageTexts.push({
        id: `wset-${ws.widgetId}-${ws.name}`,
        zone,
        sourceType: 'widget-setting-content',
        label: `Isi Widget ${ws.widgetId} (${ws.name})`,
        text: ws.value,
        line: parentWidget?.line || 1,
        rawSnippet: ws.value,
        widgetId: ws.widgetId,
        settingName: ws.name,
      });
    }
  }

  // 6d. Visible literal HTML text nodes inside <body> (Header, Footer, Nav, Headings, Buttons, Paragraphs, Copyright)
  const bodyBlockMatch = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(xml);
  if (bodyBlockMatch) {
    const bodyStartIdx = bodyBlockMatch.index + bodyBlockMatch[0].indexOf(bodyBlockMatch[1]);
    // Strip <script> and <style> content cleanly while keeping indexes accurate via spaces
    const bodyClean = bodyBlockMatch[1]
      .replace(/<script[\s\S]*?<\/script>/gi, (m) => ' '.repeat(m.length))
      .replace(/<style[\s\S]*?<\/style>/gi, (m) => ' '.repeat(m.length))
      .replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));

    const leafTextRegex = /<(h[1-6]|p|a|button|span|div|li|small|strong|label|b)\b([^>]*)>([^<>]{2,260})<\/\1>/gi;
    let ltMatch: RegExpExecArray | null;
    while ((ltMatch = leafTextRegex.exec(bodyClean)) !== null) {
      if (pageTexts.length >= 120) break;
      const tagName = ltMatch[1];
      const textBody = ltMatch[3].replace(/\s+/g, ' ').trim();
      if (!textBody || textBody.length < 2) continue;
      // Ignore template expressions / pure punctuation / numbers
      if (/^(?:\$\([^)]+\)|\{[^}]+\}|&nbsp;|&middot;|[•·|/\-–—]+)$/i.test(textBody)) continue;

      const absIdx = bodyStartIdx + ltMatch.index;
      const origSnippet = xml.slice(absIdx, absIdx + ltMatch[0].length);
      if (!origSnippet || seenTextSnippets.has(origSnippet)) continue;
      seenTextSnippets.add(origSnippet);

      const zone = inferTextZone(absIdx, tagName);
      const classAttr = getAttr(ltMatch[2], 'class');
      const idAttr = getAttr(ltMatch[2], 'id');
      const descriptor = idAttr ? `#${idAttr}` : classAttr ? `.${classAttr.split(/\s+/)[0]}` : `<${tagName}>`;

      pageTexts.push({
        id: `txt-${pageTexts.length + 1}`,
        zone,
        sourceType: 'html-text',
        label: `Teks ${zone.toUpperCase()} (${descriptor})`,
        text: textBody,
        line: lineAt(absIdx),
        rawSnippet: origSnippet,
        isDynamic: isBloggerDynamicExpr(textBody, origSnippet),
      });
    }
  }

  // 7. Forensic Theme Signature Tokens & Font Families for Accurate Blog == Template Detection
  const GENERIC_TOKENS = new Set([
    'widget', 'widget-content', 'section', 'blog', 'header', 'footer', 'main', 'sidebar',
    'post', 'posts', 'post-outer', 'post-title', 'post-body', 'post-meta', 'post-footer',
    'clear', 'clearfix', 'container', 'wrapper', 'content', 'title', 'description',
    'html', 'label', 'popularposts', 'pagelist', 'attribution', 'featuredpost', 'blogsearch',
    'hfeed', 'hentry', 'entry-title', 'entry-content', 'status-msg-wrap', 'jump-link',
    'active', 'selected', 'hidden', 'show', 'open', 'item', 'list', 'nav', 'menu', 'btn',
  ]);
  const signatureTokenCounts = new Map<string, number>();
  const combinedCss = allCssText;
  const selectorRegex = /(?:^|[\s,}])([.#][a-zA-Z_-][a-zA-Z0-9_-]{2,})/g;
  let sigMatch: RegExpExecArray | null;
  while ((sigMatch = selectorRegex.exec(combinedCss)) !== null) {
    const rawTok = sigMatch[1].slice(1).toLowerCase();
    if (!GENERIC_TOKENS.has(rawTok)) {
      signatureTokenCounts.set(rawTok, (signatureTokenCounts.get(rawTok) || 0) + 1);
    }
  }
  // Also include class/id tokens from <body> markup
  if (bodyBlockMatch) {
    const attrTokensRegex = /\b(?:id|class)\s*=\s*["']([^"']+)["']/gi;
    let am: RegExpExecArray | null;
    while ((am = attrTokensRegex.exec(bodyBlockMatch[1])) !== null) {
      for (const part of am[1].split(/\s+/)) {
        const cleanTok = part.trim().toLowerCase();
        if (cleanTok.length >= 3 && !GENERIC_TOKENS.has(cleanTok) && !cleanTok.includes(':')) {
          signatureTokenCounts.set(cleanTok, (signatureTokenCounts.get(cleanTok) || 0) + 1);
        }
      }
    }
  }
  const themeSignatureTokens = Array.from(signatureTokenCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 120)
    .map(([tok]) => tok);

  const fontFamiliesSet = new Set<string>();
  for (const f of hardcodedFonts) {
    const primaryFont = f.fontFamily.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
    if (primaryFont && !['sans-serif', 'serif', 'monospace', 'system-ui', 'inherit'].includes(primaryFont)) {
      fontFamiliesSet.add(primaryFont);
    }
  }
  for (const res of externalResources) {
    if (res.url.includes('fonts.googleapis.com')) {
      const famMatches = res.url.matchAll(/family=([^:&]+)/gi);
      for (const fm of famMatches) {
        try {
          fontFamiliesSet.add(decodeURIComponent(fm[1].replace(/\+/g, ' ')).split(':')[0].toLowerCase().trim());
        } catch {
          // ignore
        }
      }
    }
  }
  const fontFamiliesUsed = Array.from(fontFamiliesSet);

  // Exact Byte Breakdown (via fast TextEncoder without Blob heap allocations)
  const totalBytes = getUtf8ByteLength(xml);
  const skinBytes = getUtf8ByteLength(rawSkinCss);
  const templateSkinBytes = getUtf8ByteLength(rawTemplateSkin);
  const inlineScriptMatches = xml.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi) || [];
  const inlineScriptBytes = getUtf8ByteLength(inlineScriptMatches.join(''));
  const markupBytes = Math.max(0, totalBytes - skinBytes - templateSkinBytes - inlineScriptBytes);

  const byteBreakdown: TemplateByteBreakdown = {
    totalBytes,
    skinBytes,
    templateSkinBytes,
    inlineScriptBytes,
    markupBytes,
    lineCount: lineStarts.length,
    lineEnding: xml.includes('\r\n') ? 'CRLF' : 'LF',
    hasBom: xml.charCodeAt(0) === 0xfeff,
  };

  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(xml);
  const templateNameComment =
    /(?:Template\s*Name|Theme\s*Name|Name)\s*:\s*([^\n\r*>-]+)/i.exec(rawSkinCss) ||
    /(?:Template\s*Name|Theme\s*Name|Name)\s*:\s*([^\n\r*>-]+)/i.exec(xml.slice(0, 2500));
  const rawTitle =
    templateNameComment?.[1]?.trim() ||
    titleMatch?.[1]?.replace(/<[^>]+>/g, '').trim() ||
    'Template Blogger XML';

  const redundancyReport = skipRedundancy
    ? {
        duplicateCssAssets: [],
        duplicateJsAssets: [],
        duplicateCssRules: [],
        unusedCssRules: [],
        unusedCssVars: [],
        totalDuplicateCssCount: 0,
        totalDuplicateJsCount: 0,
        totalUnusedCssCount: 0,
        totalEstimatedSavingsBytes: 0,
      }
    : analyzeCssJsRedundancyInXml(xml);

  const parsedResult: ParsedTemplateInfo = {
    templateTitle: rawTitle || 'Template Blogger XML',
    variables,
    cssCustomProperties,
    widgetSettings,
    hardcodedColors,
    hardcodedFonts,
    externalResources,
    images,
    svgs,
    navLinks,
    regions,
    pageTexts,
    assetUrls: detectJsCssUrlsInXml(xml),
    encodedCodes: detectEncodedCodesInXml(xml),
    redundancyReport,
    themeSignatureTokens,
    fontFamiliesUsed,
    sections,
    widgets,
    includableCount: (xml.match(/<b:includable\b/gi) || []).length,
    conditionalCount: (xml.match(/<b:if\b/gi) || []).length,
    loopCount: (xml.match(/<b:loop\b/gi) || []).length,
    hasSkin: /<b:skin/i.test(xml),
    hasTemplateSkin: /<b:template-skin/i.test(xml),
    hasViewportMeta: /name=["']viewport["']/i.test(xml),
    hasBloggerNamespaces: /xmlns:b=/i.test(xml) && /xmlns:data=/i.test(xml),
    rawSkinCss,
    xmlByteSize: totalBytes,
    byteBreakdown,
  };

  parsedXmlLruCache.unshift({ xml, skipRedundancy, result: parsedResult });
  if (parsedXmlLruCache.length > 2) parsedXmlLruCache.pop();
  return parsedResult;
}

function getAttr(attrString: string, attrName: string): string {
  const regex = new RegExp(`\\b${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const match = regex.exec(attrString);
  return match ? (match[1] ?? match[2] ?? '') : '';
}

function substituteSkinVariables(
  skinCss: string,
  variables: Record<string, string>,
  parsedVars: BloggerVariable[]
): string {
  // Remove <Group> and <Variable> XML declarations from CSS output
  let css = skinCss
    .replace(/\/\*<!\[CDATA\[\*\//g, '')
    .replace(/\/\*\]\]>\*\//g, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<Group\b[^>]*>[\s\S]*?<\/Group>/gi, '')
    .replace(/<Variable\b[^>]*\/?>/gi, '');

  const valueMap = buildSkinVariableMap(variables, parsedVars);

  // Replace $(var.name) and $var.name
  css = css.replace(/\$\(([a-zA-Z0-9_.-]+)\)/g, (_, name: string) => {
    return valueMap[name] ?? 'inherit';
  });

  css = css.replace(/\$([a-zA-Z][a-zA-Z0-9_.-]*)/g, (full, name: string) => {
    if (name in valueMap) return valueMap[name];
    return full;
  });

  // Decode XML entities commonly found in CSS selectors inside XML templates (e.g. .nav &gt; li)
  css = decodeXmlEntities(css);

  return css;
}

function renderWidgetHtml(
  widgetType: string,
  widgetId: string,
  widgetTitle: string,
  sampleData: SampleBlogData,
  pageType: PreviewPageType,
  activePostId: string,
  activeCategory: string | null,
  widgetInnerXml = '',
  previewQueryParams: Record<string, string> = {}
): string {
  const type = widgetType.toLowerCase();

  // Extract <b:widget-setting name='content'> or 'copyright' / 'text' / 'description' / 'html' if present
  const settingContentMatch = /<b:widget-setting\b[^>]*name\s*=\s*["'](?:content|copyright|text|description|html)["'][^>]*>([\s\S]*?)<\/b:widget-setting>/i.exec(
    widgetInnerXml
  );
  const rawSettingContent = settingContentMatch ? settingContentMatch[1].trim() : '';

  if (type === 'header') {
    const headerTitle =
      widgetTitle && !/^(header|judul blog)$/i.test(widgetTitle.trim())
        ? widgetTitle
        : sampleData.blogTitle;
    return `<div class="widget Header" id="${escapeHtml(widgetId)}">
      <div id="header-inner">
        <div class="titlewrapper">
          <h1 class="title"><a href="#home" data-tl-action="home">${escapeHtml(headerTitle)}</a></h1>
        </div>
        <div class="descriptionwrapper">
          <p class="description"><span>${escapeHtml(rawSettingContent || sampleData.blogDescription)}</span></p>
        </div>
      </div>
    </div>`;
  }

  if (type === 'pagelist' || type === 'linklist') {
    const linksHtml = sampleData.navLinks
      .map((item) => {
        const isActive =
          (pageType === 'index' && !activeCategory && !item.category) ||
          (activeCategory && item.category === activeCategory);
        const actionAttr = item.category
          ? `data-tl-action="category" data-tl-category="${escapeHtml(item.category)}"`
          : `data-tl-action="home"`;
        return `<li class="${isActive ? 'selected' : ''}"><a href="#nav" ${actionAttr}>${escapeHtml(item.label)}</a></li>`;
      })
      .join('');
    return `<div class="widget PageList" id="${escapeHtml(widgetId)}">
      <div class="widget-content">
        <ul>${linksHtml}</ul>
      </div>
    </div>`;
  }

  if (type === 'blogsearch') {
    const activeSearchVal = previewQueryParams.q || previewQueryParams.query || previewQueryParams.search || '';
    return `<div class="widget BlogSearch" id="${escapeHtml(widgetId)}">
      ${widgetTitle ? `<h2>${escapeHtml(widgetTitle)}</h2>` : ''}
      <div class="widget-content">
        <form method="get" action="/search">
          <input type="text" name="q" value="${escapeHtml(activeSearchVal)}" placeholder="Cari artikel..." aria-label="Cari artikel" />
          <input type="submit" value="Cari" />
        </form>
      </div>
    </div>`;
  }

  if (type === 'profile') {
    const avatarSrc = resolvePreviewImageUrl(sampleData.authorAvatar);
    return `<div class="widget Profile" id="${escapeHtml(widgetId)}">
      <h2>${escapeHtml(widgetTitle || 'Tentang Penulis')}</h2>
      <div class="widget-content">
        <div class="profile-wrap">
          <img src="${escapeHtml(avatarSrc)}" alt="${escapeHtml(sampleData.authorName)}" class="profile-img" />
          <div>
            <div class="profile-name" style="font-weight:700;">${escapeHtml(sampleData.authorName)}</div>
            <div style="font-size:12px;opacity:0.75;">Penulis &amp; Editor</div>
          </div>
        </div>
        <p class="profile-textblock" style="margin:0;font-size:13.5px;">${escapeHtml(sampleData.authorBio)}</p>
      </div>
    </div>`;
  }

  if (type === 'popularposts') {
    const itemsHtml = sampleData.posts
      .slice(0, 3)
      .map((post) => {
        const imgSrc = resolvePreviewImageUrl(post.imageUrl);
        return `<li>
          <a href="#post-${escapeHtml(post.id)}" data-tl-action="post" data-tl-post-id="${escapeHtml(post.id)}">
            <img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(post.title)}" />
          </a>
          <div class="item-title">
            <a href="#post-${escapeHtml(post.id)}" data-tl-action="post" data-tl-post-id="${escapeHtml(post.id)}">${escapeHtml(post.title)}</a>
          </div>
        </li>`;
      })
      .join('');
    return `<div class="widget PopularPosts" id="${escapeHtml(widgetId)}">
      <h2>${escapeHtml(widgetTitle || 'Artikel Populer')}</h2>
      <div class="widget-content popular-posts">
        <ul>${itemsHtml}</ul>
      </div>
    </div>`;
  }

  if (type === 'label') {
    const itemsHtml = sampleData.labels
      .map(
        (lbl) =>
          `<li><a href="#label-${escapeHtml(lbl.name)}" data-tl-action="category" data-tl-category="${escapeHtml(lbl.name)}">${escapeHtml(lbl.name)} <span>(${lbl.count})</span></a></li>`
      )
      .join('');
    return `<div class="widget Label" id="${escapeHtml(widgetId)}">
      <h2>${escapeHtml(widgetTitle || 'Label')}</h2>
      <div class="widget-content list-label-widget-content">
        <ul>${itemsHtml}</ul>
      </div>
    </div>`;
  }

  if (type === 'attribution') {
    return `<div class="widget Attribution" id="${escapeHtml(widgetId)}">
      <div class="widget-content">
        ${rawSettingContent ? rawSettingContent : `&copy; 2026 <a href="#home" data-tl-action="home">${escapeHtml(sampleData.blogTitle)}</a> &middot; Diberdayakan oleh pratinjau TemaLoka.`}
      </div>
    </div>`;
  }

  if (type === 'featuredpost') {
    const featured = sampleData.posts[0];
    if (!featured) return '';
    return `<div class="widget FeaturedPost" id="${escapeHtml(widgetId)}">
      <h2>${escapeHtml(widgetTitle || 'Artikel Unggulan')}</h2>
      <div class="post-summary">
        <h3><a href="#post-${escapeHtml(featured.id)}" data-tl-action="post" data-tl-post-id="${escapeHtml(featured.id)}">${escapeHtml(featured.title)}</a></h3>
        <img class="image post-thumb" src="${escapeHtml(resolvePreviewImageUrl(featured.imageUrl))}" alt="${escapeHtml(featured.title)}" />
        <p>${escapeHtml(featured.snippet)}</p>
      </div>
    </div>`;
  }

  if (type === 'blog') {
    const filteredPosts = activeCategory
      ? sampleData.posts.filter((p) => p.category.toLowerCase() === activeCategory.toLowerCase())
      : sampleData.posts;
    const postsToShow: SamplePost[] =
      pageType === 'item'
        ? [sampleData.posts.find((p) => p.id === activePostId) || sampleData.posts[0]].filter(Boolean)
        : filteredPosts.length > 0
          ? filteredPosts
          : sampleData.posts;

    const archiveBanner =
      pageType === 'archive' || activeCategory
        ? `<div class="status-msg-wrap" style="margin-bottom:18px;padding:12px 16px;border:1px solid rgba(100,116,139,0.25);border-radius:8px;display:flex;justify-content:space-between;align-items:center;">
            <span>Menampilkan artikel untuk topik: <strong>${escapeHtml(activeCategory || 'Semua Arsip')}</strong></span>
            <a href="#home" data-tl-action="home" style="font-size:13px;font-weight:600;">Tampilkan semua</a>
          </div>`
        : '';

    const backLink =
      pageType === 'item'
        ? `<div style="margin-bottom:14px;"><a href="#home" data-tl-action="home" style="font-size:13px;font-weight:600;">&larr; Kembali ke Beranda</a></div>`
        : '';

    const postsHtml = postsToShow
      .map((post) => {
        const imgSrc = resolvePreviewImageUrl(post.imageUrl);
        const bodyContent =
          pageType === 'item'
            ? post.bodyHtml
            : `<p>${escapeHtml(post.snippet)}</p>`;
        const jumpLink =
          pageType === 'item'
            ? `<div class="post-footer" style="margin-top:24px;padding-top:16px;border-top:1px solid rgba(100,116,139,0.2);font-size:13px;">
                <span>Ditulis oleh <strong>${escapeHtml(post.author)}</strong></span> &middot;
                <span>Kategori: <a href="#cat" data-tl-action="category" data-tl-category="${escapeHtml(post.category)}">${escapeHtml(post.category)}</a></span> &middot;
                <span>${post.commentsCount} Komentar</span>
              </div>`
            : `<div class="jump-link">
                <a href="#post-${escapeHtml(post.id)}" data-tl-action="post" data-tl-post-id="${escapeHtml(post.id)}">Baca Selengkapnya</a>
              </div>`;

        return `<article class="post-outer">
          <div class="post hentry">
            <a href="#post-${escapeHtml(post.id)}" data-tl-action="post" data-tl-post-id="${escapeHtml(post.id)}">
              <img class="post-thumb" src="${escapeHtml(imgSrc)}" alt="${escapeHtml(post.title)}" />
            </a>
            <div class="post-content">
              <div class="post-meta">
                <span>${escapeHtml(post.category)}</span>
                <span>&middot;</span>
                <span>${escapeHtml(post.date)}</span>
                <span>&middot;</span>
                <span>${escapeHtml(post.readTime)}</span>
              </div>
              <h2 class="post-title entry-title">
                <a href="#post-${escapeHtml(post.id)}" data-tl-action="post" data-tl-post-id="${escapeHtml(post.id)}">${escapeHtml(post.title)}</a>
              </h2>
              <div class="post-body entry-content">${bodyContent}</div>
              ${jumpLink}
            </div>
          </div>
        </article>`;
      })
      .join('');

    return `<div class="widget Blog" id="${escapeHtml(widgetId)}">
      ${archiveBanner}
      ${backLink}
      <div class="blog-posts hfeed ${pageType === 'item' ? 'is-single' : ''}">
        ${postsHtml}
      </div>
    </div>`;
  }

  if (type === 'blogarchive') {
    return `<div class="widget BlogArchive" id="${escapeHtml(widgetId)}">
      <h2>${escapeHtml(widgetTitle || 'Arsip Blog')}</h2>
      <div class="widget-content">
        <div id="ArchiveList">
          <ul class="hierarchy">
            <li class="archivedate expanded">
              <a class="post-count-link" href="#archive-2026" data-tl-action="home">2026</a> <span class="post-count">(${sampleData.posts.length})</span>
              <ul class="hierarchy">
                <li class="archivedate expanded">
                  <a class="post-count-link" href="#archive-2026-11" data-tl-action="home">November</a> <span class="post-count">(${sampleData.posts.length})</span>
                  <ul class="posts">
                    ${sampleData.posts
                      .slice(0, 4)
                      .map(
                        (p) =>
                          `<li><a href="#post-${escapeHtml(p.id)}" data-tl-action="post" data-tl-post-id="${escapeHtml(p.id)}">${escapeHtml(p.title)}</a></li>`
                      )
                      .join('')}
                  </ul>
                </li>
              </ul>
            </li>
          </ul>
        </div>
      </div>
    </div>`;
  }

  if (type === 'image') {
    const imgFallback = resolvePreviewImageUrl(sampleData.posts[0]?.imageUrl || '');
    return `<div class="widget Image" id="${escapeHtml(widgetId)}">
      ${widgetTitle ? `<h2>${escapeHtml(widgetTitle)}</h2>` : ''}
      <div class="widget-content">
        <img src="${escapeHtml(imgFallback)}" alt="${escapeHtml(widgetTitle || sampleData.blogTitle)}" style="width:100%;border-radius:8px;display:block;" />
        ${rawSettingContent ? `<p class="caption" style="margin:8px 0 0;font-size:13px;">${escapeHtml(decodeXmlEntities(rawSettingContent))}</p>` : ''}
      </div>
    </div>`;
  }

  if (type === 'stats') {
    return `<div class="widget Stats" id="${escapeHtml(widgetId)}">
      <h2>${escapeHtml(widgetTitle || 'Statistik Pengunjung')}</h2>
      <div class="widget-content">
        <div class="counter-wrapper" style="font-size:22px;font-weight:700;font-variant-numeric:tabular-nums;">12.840</div>
        <div style="font-size:12px;opacity:0.75;">Total Tayangan Halaman</div>
      </div>
    </div>`;
  }

  if (type === 'followbyemail') {
    return `<div class="widget FollowByEmail" id="${escapeHtml(widgetId)}">
      <h2>${escapeHtml(widgetTitle || 'Langganan Artikel')}</h2>
      <div class="widget-content">
        <form onsubmit="return false;" style="display:flex;gap:6px;flex-wrap:wrap;">
          <input type="email" placeholder="Alamat email Anda..." aria-label="Alamat email" style="flex:1;min-width:140px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;" />
          <input type="submit" value="Ikuti" style="padding:8px 14px;border-radius:6px;cursor:pointer;" />
        </form>
      </div>
    </div>`;
  }

  if (type === 'adsense') {
    const clientMatch =
      /<b:widget-setting\b[^>]*name\s*=\s*["']adClient["'][^>]*>([^<]+)<\/b:widget-setting>/i.exec(widgetInnerXml) ||
      /\b(ca-pub-\d{10,20})\b/i.exec(widgetInnerXml);
    const slotMatch =
      /<b:widget-setting\b[^>]*name\s*=\s*["']adSlot["'][^>]*>([^<]+)<\/b:widget-setting>/i.exec(widgetInnerXml) ||
      /data-ad-slot\s*=\s*["'](\d+)["']/i.exec(widgetInnerXml);
    const formatMatch =
      /<b:widget-setting\b[^>]*name\s*=\s*["']adFormat["'][^>]*>([^<]+)<\/b:widget-setting>/i.exec(widgetInnerXml);
    const adClient = clientMatch?.[1]?.trim() || 'ca-pub-0000000000000000';
    const adSlot = slotMatch?.[1]?.trim() || '';
    const adFormat = formatMatch?.[1]?.trim() || 'responsive';
    return `<div class="widget AdSense" id="${escapeHtml(widgetId)}">
      ${widgetTitle ? `<h2>${escapeHtml(widgetTitle)}</h2>` : ''}
      <div class="widget-content">
        <div class="tl-adsense-preview-slot" style="display:block;width:100%;">
          <div class="tl-adsense-inner">
            <span class="tl-adsense-badge">Google AdSense</span>
            <strong class="tl-adsense-title">${escapeHtml(widgetTitle || `Slot Iklan (${adFormat})`)}</strong>
            <span class="tl-adsense-meta">${escapeHtml(adClient)}${adSlot ? ` &middot; Slot ${escapeHtml(adSlot)}` : ''}</span>
          </div>
        </div>
      </div>
    </div>`;
  }

  // Generic HTML/Text/Unknown widget fallback — render real <b:widget-setting name='content'> (decoding XML-escaped HTML) or inner includable text
  const decodedSetting = rawSettingContent ? decodeXmlEntities(rawSettingContent) : '';
  const mainIncludableMatch = /<b:includable\b[^>]*id\s*=\s*["']main["'][^>]*>([\s\S]*?)<\/b:includable>/i.exec(
    widgetInnerXml
  );
  const resolvedBody =
    decodedSetting ||
    (mainIncludableMatch
      ? replaceBloggerDataTags(
          mainIncludableMatch[1],
          sampleData,
          sampleData.posts[0] || {
            id: '1',
            title: 'Artikel',
            snippet: '',
            bodyHtml: '',
            author: sampleData.authorName,
            date: '14 Nov 2026',
            category: 'Umum',
            readTime: '3 mnt baca',
            imageUrl: '',
            commentsCount: 0,
          },
          previewQueryParams
        ).trim()
      : '');

  return `<div class="widget ${escapeHtml(widgetType)}" id="${escapeHtml(widgetId)}">
    ${widgetTitle ? `<h2>${escapeHtml(widgetTitle)}</h2>` : ''}
    <div class="widget-content">
      ${
        resolvedBody ||
        `<p style="margin:0;font-size:13.5px;opacity:0.8;">${escapeHtml(
          sampleData.blogDescription
        )}</p>`
      }
    </div>
  </div>`;
}

function replaceBloggerDataTags(
  htmlChunk: string,
  sampleData: SampleBlogData,
  post: SamplePost,
  previewQueryParams: Record<string, string> = {}
): string {
  let out = htmlChunk;
  // Remove Blogger-only control tags safely when compiling custom inline markup
  out = out.replace(/<\/?b:(?:includable|include|if|elseif|else|loop|attr|class|with|switch|case|default)[^>]*>/gi, '');

  const searchQ = previewQueryParams.q || previewQueryParams.query || previewQueryParams.search || '';
  const map: Record<string, string> = {
    'data:blog.title': escapeHtml(sampleData.blogTitle),
    'data:blog.pageTitle': escapeHtml(sampleData.blogTitle),
    'data:blog.description': escapeHtml(sampleData.blogDescription),
    'data:blog.homepageUrl': '#home',
    'data:blog.searchQuery': escapeHtml(searchQ),
    'data:view.search.query': escapeHtml(searchQ),
    'data:post.title': escapeHtml(post.title),
    'data:post.snippet': escapeHtml(post.snippet),
    'data:post.body': post.bodyHtml,
    'data:post.url': `#post-${post.id}`,
    'data:post.author.name': escapeHtml(post.author),
    'data:post.author': escapeHtml(post.author),
    'data:post.dateHeader': escapeHtml(post.date),
    'data:post.timestamp': escapeHtml(post.date),
    'data:post.featuredImage': resolvePreviewImageUrl(post.imageUrl),
    'data:post.thumbnailUrl': resolvePreviewImageUrl(post.imageUrl),
  };

  for (const [tag, value] of Object.entries(map)) {
    const regex = new RegExp(`<${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*/?>`, 'gi');
    out = out.replace(regex, value);
  }

  // Replace <data:view.url.params.KEY/> dynamically when active in previewQueryParams
  out = out.replace(/<data:view\.url\.params\.([a-zA-Z0-9_.-]+)\s*\/?>/gi, (_, key: string) => {
    return key in previewQueryParams ? escapeHtml(previewQueryParams[key] ?? '') : '';
  });

  // Replace remaining <data:.../> gracefully
  out = out.replace(/<data:[^>]+>/gi, '');
  return out;
}

export function buildGoogleFontsLink(fonts: FontCustomization): string {
  if (!fonts.enabled) return '';
  const families = Array.from(
    new Set([fonts.headingFont, fonts.bodyFont, fonts.monoFont].filter(Boolean))
  );
  if (families.length === 0) return '';
  const query = families
    .map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;500;600;700;800`)
    .join('&');
  return `https://fonts.googleapis.com/css2?${query}&display=swap`;
}

export function buildLiveOverrideCss(
  colors: ThemePaletteOverrides,
  fonts: FontCustomization,
  customCss: string
): string {
  const rules: string[] = [];

  if (colors.enabled) {
    rules.push(`
:root {
  --tl-bg: ${colors.background};
  --tl-surface: ${colors.surface};
  --tl-primary: ${colors.primary};
  --tl-heading: ${colors.heading};
  --tl-text: ${colors.text};
  --tl-muted: ${colors.mutedText};
  --tl-link: ${colors.link};
  --tl-header-bg: ${colors.headerBg};
  --tl-header-text: ${colors.headerText};
  --tl-border: ${colors.border};
}
html, body {
  background-color: var(--tl-bg) !important;
  color: var(--tl-text) !important;
}
a {
  color: var(--tl-link);
}
h1, h2, h3, h4, .post-title, .post-title a, .PopularPosts .item-title, .sidebar-container .widget h2 {
  color: var(--tl-heading) !important;
}
.header-outer, header, #header-wrapper, .navbar {
  background-color: var(--tl-header-bg) !important;
  color: var(--tl-header-text) !important;
  border-color: var(--tl-border) !important;
}
.Header h1, .Header .title, .Header .description, .PageList a, .header-outer a {
  color: var(--tl-header-text) !important;
}
.post-outer, .post, .sidebar-container .widget, .card, article.post-outer {
  background-color: var(--tl-surface) !important;
  border-color: var(--tl-border) !important;
  color: var(--tl-text) !important;
}
.post-meta, .post-footer, .Label li a {
  color: var(--tl-muted) !important;
  border-color: var(--tl-border) !important;
}
.jump-link a, .BlogSearch input[type='submit'], button.btn-primary {
  background-color: var(--tl-primary) !important;
  color: #ffffff !important;
  border-color: var(--tl-primary) !important;
}
.footer-outer {
  border-color: var(--tl-border) !important;
}`);
  }

  if (fonts.enabled) {
    rules.push(`
body, .post-body, p, li, input, textarea {
  font-family: '${fonts.bodyFont}', system-ui, sans-serif !important;
  font-size: ${fonts.baseFontSize}px !important;
  line-height: ${fonts.lineHeight} !important;
  letter-spacing: ${fonts.letterSpacing}em !important;
}
h1, h2, h3, h4, .Header h1, .Header .title, .post-title, .sidebar-container .widget h2 {
  font-family: '${fonts.headingFont}', system-ui, serif !important;
  font-weight: ${fonts.headingWeight} !important;
}
code, pre, .post-meta {
  font-family: '${fonts.monoFont}', monospace;
}
.post-outer, .sidebar-container .widget {
  border-radius: ${fonts.borderRadius}px !important;
}`);
  }

  if (customCss.trim()) {
    rules.push(`/* Kustomisasi CSS Pengguna & AI */\n${customCss}`);
  }

  return rules.join('\n');
}

export interface CompilePreviewOptions {
  xml: string;
  variableValues: Record<string, string>;
  cssVarValues?: Record<string, string>;
  colorReplacements?: Record<string, string>;
  parsedInfo: ParsedTemplateInfo;
  colors: ThemePaletteOverrides;
  fonts: FontCustomization;
  customCss: string;
  sampleData: SampleBlogData;
  pageType: PreviewPageType;
  activePostId: string;
  activeCategory: string | null;
  device?: DevicePreset;
  offlineMode?: boolean;
  previewQueryParams?: Record<string, string>;
}

function applyCssCustomPropEdits(css: string, cssVarValues: Record<string, string>): string {
  let out = css;
  for (const [key, nextVal] of Object.entries(cssVarValues)) {
    // key format is "selector::--varName" or "--varName"
    const varName = key.includes('::') ? key.split('::')[1] : key;
    if (!varName.startsWith('--')) continue;
    const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(${escaped}\\s*:\\s*)([^;{}]+)`, 'g'), `$1${nextVal}`);
  }
  return out;
}

function applyHardcodedColorReplacements(css: string, replacements: Record<string, string>): string {
  let out = css;
  for (const [oldHex, newHex] of Object.entries(replacements)) {
    if (!oldHex || !newHex || oldHex.toLowerCase() === newHex.toLowerCase()) continue;
    const shortHex =
      oldHex.length === 7 &&
      oldHex[1] === oldHex[2] &&
      oldHex[3] === oldHex[4] &&
      oldHex[5] === oldHex[6]
        ? `#${oldHex[1]}${oldHex[3]}${oldHex[5]}`
        : null;
    const pattern = shortHex
      ? `(?:${oldHex.replace('#', '#')}|${shortHex})\\b`
      : `${oldHex}\\b`;
    out = out.replace(new RegExp(pattern, 'gi'), newHex);
  }
  return out;
}

function extractSafeQueryScriptsForPreview(xml: string): string {
  const scriptBlocks: string[] = [];
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(xml)) !== null) {
    const attrs = m[1] || '';
    if (/\b(?:src|expr:src)\s*=/i.test(attrs)) continue;
    const typeAttr = getAttr(attrs, 'type').toLowerCase();
    if (typeAttr.includes('ld+json') || typeAttr === 'application/json') continue;

    let body = (m[2] || '')
      .replace(/^\s*\/\/\s*<!\[CDATA\[/i, '')
      .replace(/^\s*\/\*\s*<!\[CDATA\[\s*\*\//i, '')
      .replace(/^\s*<!\[CDATA\[/i, '')
      .replace(/\/\/\s*\]\]>\s*$/i, '')
      .replace(/\/\*\s*\]\]>\s*\*\/\s*$/i, '')
      .replace(/\]\]>\s*$/i, '')
      .trim();

    if (!body) continue;
    if (
      !/URLSearchParams|location\.search|\.searchParams|getQueryParam|getUrlParameter|getParameterByName|getQueryVariable|getParam/i.test(
        body
      )
    ) {
      continue;
    }
    // Skip dynamic Blogger XML tags inside JS or unsafe document.write
    if (/<b:|<\/b:|document\.write\s*\(/i.test(body)) continue;

    // Redirect location.search reads to simulated query string and avoid breaking script tags
    body = body
      .replace(/\b(?:window\.|document\.)?location\.search\b/g, '(window.__TEMALOKA_QUERY_STRING__ || "")')
      .replace(/<\/script/gi, '<\\/script');

    scriptBlocks.push(
      `try {\n${body}\n} catch (err) { console.warn('Query Script Preview:', err && err.message ? err.message : String(err)); }`
    );
  }
  return scriptBlocks.join('\n\n');
}

export function compileBloggerPreviewHtml(opts: CompilePreviewOptions): string {
  const {
    xml,
    variableValues,
    cssVarValues = {},
    colorReplacements = {},
    parsedInfo,
    colors,
    fonts,
    customCss,
    sampleData: rawSampleData,
    pageType,
    activePostId,
    activeCategory,
    device = 'desktop',
    offlineMode = false,
    previewQueryParams = {},
  } = opts;

  const sampleData = ensureRealisticSampleData(rawSampleData);

  const activeQueryEntries = Object.entries(previewQueryParams).filter(
    ([key]) => key.trim().length > 0
  );
  const activeQueryMap = Object.fromEntries(activeQueryEntries);
  const activeQueryString =
    activeQueryEntries.length > 0
      ? `?${new URLSearchParams(activeQueryEntries).toString()}`
      : '';
  const safeQueryStringJson = JSON.stringify(activeQueryString).replace(/</g, '\\u003c');
  const safeQueryMapJson = JSON.stringify(activeQueryMap).replace(/</g, '\\u003c');

  // 1. Extract and compile <b:skin> + <b:template-skin>
  let compiledSkin = substituteSkinVariables(parsedInfo.rawSkinCss, variableValues, parsedInfo.variables);
  compiledSkin = applyCssCustomPropEdits(compiledSkin, cssVarValues);
  compiledSkin = applyHardcodedColorReplacements(compiledSkin, colorReplacements);

  const templateSkinMatch = /<b:template-skin[^>]*>([\s\S]*?)<\/b:template-skin>/i.exec(xml);
  let compiledTemplateSkin = templateSkinMatch
    ? substituteSkinVariables(
        templateSkinMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'),
        variableValues,
        parsedInfo.variables
      )
    : '';
  compiledTemplateSkin = applyCssCustomPropEdits(compiledTemplateSkin, cssVarValues);
  compiledTemplateSkin = applyHardcodedColorReplacements(compiledTemplateSkin, colorReplacements);

  // 2. Collect external stylesheets and process <style> blocks from <head>
  const headMatch = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(xml);
  let headLinksHtml = '';
  let headCompiledStylesCss = '';
  if (headMatch) {
    const linkMatches = offlineMode
      ? []
      : headMatch[1].match(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi) || [];
    headLinksHtml = linkMatches.join('\n');

    const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
    const styleChunks: string[] = [];
    let sm: RegExpExecArray | null;
    while ((sm = styleRe.exec(headMatch[1])) !== null) {
      if (!sm[1]) continue;
      let processed = substituteSkinVariables(sm[1], variableValues, parsedInfo.variables);
      processed = applyCssCustomPropEdits(processed, cssVarValues);
      processed = applyHardcodedColorReplacements(processed, colorReplacements);
      if (processed.trim()) styleChunks.push(processed);
    }
    headCompiledStylesCss = styleChunks.join('\n\n');
  }

  // 3. Render <body> using full Blogger AST parser & evaluator (<b:section>, <b:widget>, <b:if>, <b:loop>, <b:include>, <data:.../>)
  const variableMap = buildSkinVariableMap(variableValues, parsedInfo.variables);
  const bodyAstResult = renderBloggerBodyFromXml(xml, {
    sampleData,
    pageType,
    activePostId,
    activeCategory,
    device,
    previewQueryParams: activeQueryMap,
    variableMap,
    renderWidgetFallback: (wType, wId, wTitle, wInner) =>
      renderWidgetHtml(
        wType,
        wId,
        wTitle,
        sampleData,
        pageType,
        activePostId,
        activeCategory,
        wInner,
        activeQueryMap
      ),
  });

  const bodyAttrsString = bodyAstResult.hasBody ? bodyAstResult.bodyAttrsString : '';
  const bodyContent =
    bodyAstResult.hasBody && bodyAstResult.bodyHtml.trim()
      ? bodyAstResult.bodyHtml
      : `<header class="header-outer"><div class="header-inner">${renderWidgetHtml('Header', 'Header1', 'Header', sampleData, pageType, activePostId, activeCategory, '', activeQueryMap)}</div></header>
    <main class="main-outer">${renderWidgetHtml('Blog', 'Blog1', 'Blog', sampleData, pageType, activePostId, activeCategory, '', activeQueryMap)}</main>`;

  const queryAwareScripts = extractSafeQueryScriptsForPreview(xml);
  const googleFontsUrl = offlineMode ? '' : buildGoogleFontsLink(fonts);
  const liveOverridesCss = buildLiveOverrideCss(colors, fonts, customCss);

  // Defensive layout isolation CSS inside iframe so floats/preloaders/wide media never stack or clip layout
  const baseSafetyCss = `
*, *::before, *::after { box-sizing: border-box; }
html { overflow-x: hidden; -webkit-text-size-adjust: 100%; }
body { margin: 0; overflow-x: hidden; min-height: 100%; }
img, video, svg, iframe { max-width: 100%; }
img { height: auto; }
.section::after, .widget::after, .blog-posts::after, .clear::after, .clearfix::after { content: ""; display: table; clear: both; }
#preloader, .preloader, #page-loader, .page-loader, .loading-overlay, .loader-wrapper { display: none !important; }
.tl-adsense-preview-slot { max-width: 100% !important; min-height: 90px; background: repeating-linear-gradient(135deg, #f8fafc, #f8fafc 10px, #f1f5f9 10px, #f1f5f9 20px); border: 1.5px dashed #94a3b8; border-radius: 10px; padding: 14px 16px; display: flex !important; align-items: center; justify-content: center; text-align: center; text-decoration: none; overflow: hidden; margin: 10px auto; box-sizing: border-box; }
.tl-adsense-inner { display: flex; flex-direction: column; align-items: center; gap: 4px; color: #334155; font-family: system-ui, -apple-system, sans-serif; line-height: 1.35; }
.tl-adsense-badge { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #047857; background: #d1fae5; padding: 2px 8px; border-radius: 4px; }
.tl-adsense-title { font-size: 13px; font-weight: 700; color: #0f172a; }
.tl-adsense-meta { font-size: 11px; font-family: ui-monospace, SFMono-Regular, monospace; color: #64748b; word-break: break-all; }
`;

  const offlineCspMeta = offlineMode
    ? `<meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob: 'unsafe-inline'; img-src * data: blob:; style-src 'unsafe-inline' data: blob:; font-src 'self' data: blob:; script-src 'unsafe-inline'; connect-src 'none';" />`
    : '';

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  ${offlineCspMeta}
  <title>${escapeHtml(sampleData.blogTitle)}</title>
  <script>
  (function(){
    // Safe in-memory Storage shim when iframe runs in strict opaque-origin sandbox (CSS/DOM isolated)
    function makeMemStorage(){
      var store = {};
      return {
        getItem: function(k){ return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
        setItem: function(k, v){ store[String(k)] = String(v); },
        removeItem: function(k){ delete store[String(k)]; },
        clear: function(){ store = {}; },
        key: function(i){ return Object.keys(store)[i] || null; },
        get length(){ return Object.keys(store).length; }
      };
    }
    try { void window.localStorage; } catch(e) {
      try { Object.defineProperty(window, 'localStorage', { value: makeMemStorage(), configurable: true }); } catch(_){}
    }
    try { void window.sessionStorage; } catch(e) {
      try { Object.defineProperty(window, 'sessionStorage', { value: makeMemStorage(), configurable: true }); } catch(_){}
    }

    window.__TEMALOKA_QUERY_STRING__ = ${safeQueryStringJson};
    window.__TEMALOKA_QUERY_PARAMS__ = ${safeQueryMapJson};
    var NativeUSP = window.URLSearchParams;
    if (typeof NativeUSP === 'function') {
      var PatchedUSP = function(init) {
        if ((init === undefined || init === '' || init === window.location.search) && window.__TEMALOKA_QUERY_STRING__) {
          return new NativeUSP(window.__TEMALOKA_QUERY_STRING__);
        }
        return new NativeUSP(init);
      };
      PatchedUSP.prototype = NativeUSP.prototype;
      window.URLSearchParams = PatchedUSP;
    }
    if (window.__tlConsoleHooked) return;
    window.__tlConsoleHooked = true;
    function formatArg(v){
      if (typeof v === 'string') return v;
      if (v instanceof Error) return v.name + ': ' + v.message;
      try { return JSON.stringify(v); } catch(e) { return String(v); }
    }
    function emit(level, args, line, url){
      try {
        var msg = Array.prototype.slice.call(args || []).map(formatArg).join(' ');
        if (!msg) return;
        window.parent.postMessage({
          source: 'temaloka-preview-console',
          level: level,
          message: msg.slice(0, 1200),
          line: typeof line === 'number' ? line : undefined,
          url: url || undefined
        }, '*');
      } catch(e){}
    }
    ['log','info','warn','error'].forEach(function(lv){
      var orig = console[lv];
      console[lv] = function(){
        emit(lv === 'log' ? 'log' : lv, arguments);
        if (typeof orig === 'function') return orig.apply(console, arguments);
      };
    });
    window.addEventListener('error', function(ev){
      var target = ev && ev.target;
      if (target && target.tagName === 'IMG' && !target.dataset.tlFallbackApplied) {
        target.dataset.tlFallbackApplied = '1';
        target.src = ${JSON.stringify(sampleData.posts[0]?.imageUrl || '')};
        return;
      }
      emit('error', [ev.message || 'Kesalahan Skrip / Sumber Daya Pratinjau'], ev.lineno, ev.filename);
    }, true);
    window.addEventListener('unhandledrejection', function(ev){
      emit('error', ['UnhandledPromiseRejection: ' + formatArg(ev.reason)]);
    });
  })();
  </script>
  ${headLinksHtml}
  ${googleFontsUrl ? `<link rel="stylesheet" href="${escapeHtml(googleFontsUrl)}" />` : ''}
  <style id="temaloka-base-safety-css">
${baseSafetyCss}
  </style>
  <style id="blogger-skin-css">
${headCompiledStylesCss}
${compiledSkin}
${compiledTemplateSkin}
  </style>
  <style id="temaloka-live-overrides">
${liveOverridesCss}
  </style>
</head>
<body${bodyAttrsString}>
${bodyContent}
<script>
  document.addEventListener('DOMContentLoaded', function() {
    var activeParams = window.__TEMALOKA_QUERY_PARAMS__ || {};
    var paramKeys = Object.keys(activeParams);
    if (paramKeys.length > 0) {
      paramKeys.forEach(function(k) {
        var val = activeParams[k];
        var fields = document.querySelectorAll('input[name], select[name], textarea[name]');
        for (var i = 0; i < fields.length; i++) {
          var el = fields[i];
          if (el.getAttribute('name') === k) {
            if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
              el.checked = el.value === val || val === 'true' || val === '1';
            } else {
              el.value = val;
            }
          }
        }
      });
    }
${queryAwareScripts ? `\n${queryAwareScripts}\n` : ''}
  });

  document.addEventListener('submit', function(e) {
    var form = e.target;
    if (!form || form.tagName !== 'FORM') return;
    var method = (form.getAttribute('method') || 'get').toLowerCase();
    if (method === 'post') return;
    e.preventDefault();
    var fd = new FormData(form);
    var nextParams = {};
    fd.forEach(function(val, key) {
      if (key && String(val).trim() !== '') nextParams[key] = String(val);
    });
    window.parent.postMessage({
      source: 'temaloka-preview',
      action: 'apply-query',
      params: nextParams
    }, '*');
  });

  document.addEventListener('click', function(e) {
    var target = e.target;
    while (target && target !== document) {
      if (target.hasAttribute && target.hasAttribute('data-tl-action')) {
        e.preventDefault();
        var action = target.getAttribute('data-tl-action');
        var postId = target.getAttribute('data-tl-post-id') || '';
        var category = target.getAttribute('data-tl-category') || '';
        window.parent.postMessage({
          source: 'temaloka-preview',
          action: action,
          postId: postId,
          category: category
        }, '*');
        return;
      }
      if (target.tagName === 'A') {
        var href = target.getAttribute('href') || '';
        if (href.includes('?')) {
          var qPart = href.split('?')[1].split('#')[0];
          if (qPart && !href.startsWith('http')) {
            e.preventDefault();
            var parsed = new URLSearchParams(qPart);
            var linkParams = {};
            parsed.forEach(function(v, k) {
              if (k) linkParams[k] = v;
            });
            window.parent.postMessage({
              source: 'temaloka-preview',
              action: 'apply-query',
              params: linkParams
            }, '*');
            return;
          }
        }
        e.preventDefault();
      }
      target = target.parentNode;
    }
  });
</script>
</body>
</html>`;
}

export interface ExportSizeReason {
  label: string;
  bytesDelta: number;
}

export interface ExportModifiedResult {
  exportedXml: string;
  cssOnlySnippet: string;
  originalBytes: number;
  exportedBytes: number;
  deltaBytes: number;
  reasons: ExportSizeReason[];
}

export function exportModifiedBloggerXml(
  originalXml: string,
  variableValues: Record<string, string>,
  colors: ThemePaletteOverrides,
  fonts: FontCustomization,
  customCss: string,
  options?: {
    cssVarValues?: Record<string, string>;
    colorReplacements?: Record<string, string>;
    minimalExport?: boolean;
    initialUploadBytes?: number | null;
  }
): ExportModifiedResult {
  const cssVarValues = options?.cssVarValues || {};
  const colorReplacements = options?.colorReplacements || {};
  const minimalExport = options?.minimalExport ?? false;

  const originalBytes = options?.initialUploadBytes ?? getUtf8ByteLength(originalXml);
  const reasons: ExportSizeReason[] = [];

  let exported = originalXml;

  // 1. Update <Variable ... value="..." /> attributes in XML
  const beforeVarsBytes = getUtf8ByteLength(exported);
  if (Object.keys(variableValues).length > 0) {
    exported = exported.replace(/<Variable\b([\s\S]*?)(\/?)>/gi, (full, attrs: string, selfClose: string) => {
      const name = getAttr(attrs, 'name');
      if (!name || !(name in variableValues)) return full;
      const newValue = escapeXmlAttr(variableValues[name]);

      if (/\bvalue\s*=\s*(?:"[^"]*"|'[^']*')/i.test(attrs)) {
        const updatedAttrs = attrs.replace(
          /\bvalue\s*=\s*(?:"[^"]*"|'[^']*')/i,
          `value="${newValue}"`
        );
        return `<Variable${updatedAttrs}${selfClose}>`;
      }
      return `<Variable${attrs} value="${newValue}"${selfClose}>`;
    });
  }
  const afterVarsBytes = getUtf8ByteLength(exported);
  if (afterVarsBytes !== beforeVarsBytes) {
    reasons.push({
      label: 'Perubahan nilai <Variable> Blogger',
      bytesDelta: afterVarsBytes - beforeVarsBytes,
    });
  }

  // 2. Update CSS Custom Properties (--var) and hardcoded color replacements inside <b:skin> / <style>
  const beforeTokensBytes = getUtf8ByteLength(exported);
  if (Object.keys(cssVarValues).length > 0) {
    exported = exported.replace(
      /(<(?:b:skin|b:template-skin|style)\b[^>]*>)([\s\S]*?)(<\/(?:b:skin|b:template-skin|style)>)/gi,
      (_, open: string, body: string, close: string) => {
        return `${open}${applyCssCustomPropEdits(body, cssVarValues)}${close}`;
      }
    );
  }
  if (Object.keys(colorReplacements).length > 0) {
    exported = exported.replace(
      /(<(?:b:skin|b:template-skin|style)\b[^>]*>)([\s\S]*?)(<\/(?:b:skin|b:template-skin|style)>)/gi,
      (_, open: string, body: string, close: string) => {
        return `${open}${applyHardcodedColorReplacements(body, colorReplacements)}${close}`;
      }
    );
  }
  const afterTokensBytes = getUtf8ByteLength(exported);
  if (afterTokensBytes !== beforeTokensBytes) {
    reasons.push({
      label: 'Penggantian CSS Variables (--*) / warna CSS asli',
      bytesDelta: afterTokensBytes - beforeTokensBytes,
    });
  }

  const cssOnlySnippet = buildLiveOverrideCss(colors, fonts, customCss).trim();

  if (!minimalExport) {
    // 3. Inject Google Fonts <link> in <head> (XHTML-escaped '&amp;' for Blogger XML compliance)
    const beforeFontBytes = getUtf8ByteLength(exported);
    const googleFontsUrl = buildGoogleFontsLink(fonts);
    if (googleFontsUrl) {
      const xhtmlFontsUrl = googleFontsUrl.replace(/&/g, '&amp;');
      const fontLinkTag = `<link href='${xhtmlFontsUrl}' rel='stylesheet' type='text/css'/>`;
      if (!exported.includes(xhtmlFontsUrl) && /<\/head>/i.test(exported)) {
        exported = exported.replace(/<\/head>/i, `  ${fontLinkTag}\n</head>`);
      }
    }
    const afterFontBytes = getUtf8ByteLength(exported);
    if (afterFontBytes !== beforeFontBytes) {
      reasons.push({
        label: 'Injeksi tag <link> Google Fonts ke <head>',
        bytesDelta: afterFontBytes - beforeFontBytes,
      });
    }

    // 4. Inject live color/font/custom CSS inside <b:skin> before ]]></b:skin>
    const beforeCssInjectBytes = getUtf8ByteLength(exported);
    if (cssOnlySnippet) {
      const blockToInject = `\n/* === Kustomisasi TemaLoka === */\n${cssOnlySnippet.replace(/\]\]>/g, ']]&gt;')}\n`;
      if (/((?:\/\*|\/\/)?\s*\]\]>(?:\s*\*\/)?)\s*<\/b:skin>/i.test(exported)) {
        exported = exported.replace(/((?:\/\*|\/\/)?\s*\]\]>(?:\s*\*\/)?)\s*<\/b:skin>/i, `${blockToInject}$1</b:skin>`);
      } else if (/<\/b:skin>/i.test(exported)) {
        exported = exported.replace(/<\/b:skin>/i, `${blockToInject}</b:skin>`);
      }
    }
    const afterCssInjectBytes = getUtf8ByteLength(exported);
    if (afterCssInjectBytes !== beforeCssInjectBytes) {
      reasons.push({
        label: 'Injeksi blok CSS kustomisasi palet/tipografi ke <b:skin>',
        bytesDelta: afterCssInjectBytes - beforeCssInjectBytes,
      });
    }
  }

  const exportedBytes = getUtf8ByteLength(exported);
  const deltaBytes = exportedBytes - originalBytes;

  // Check if editor/line-ending normalization or Auto-Fix caused a delta from original upload bytes
  const currentSourceBytes = getUtf8ByteLength(originalXml);
  if (originalBytes !== currentSourceBytes) {
    reasons.unshift({
      label: 'Edit manual / Auto-Fix sintaks / normalisasi baris (CRLF ke LF)',
      bytesDelta: currentSourceBytes - originalBytes,
    });
  }

  return {
    exportedXml: exported,
    cssOnlySnippet,
    originalBytes,
    exportedBytes,
    deltaBytes,
    reasons,
  };
}

/**
 * Surgical XML Mutators for Inspector Quick-Edit
 */
export function updateWidgetAttrInXml(
  xml: string,
  widgetId: string,
  attrName: 'title' | 'locked' | 'visible',
  newValue: string
): string {
  const escapedId = widgetId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const widgetOpenRegex = new RegExp(
    `(<b:widget\\b[^>]*\\bid\\s*=\\s*["']${escapedId}["'][^>]*?)(\\/?>)`,
    'i'
  );
  return xml.replace(widgetOpenRegex, (_, openTag: string, closeChars: string) => {
    const safeVal = escapeXmlAttr(newValue);
    const attrRegex = new RegExp(`\\b${attrName}\\s*=\\s*(?:"[^"]*"|'[^']*')`, 'i');
    if (attrRegex.test(openTag)) {
      return `${openTag.replace(attrRegex, `${attrName}='${safeVal}'`)}${closeChars}`;
    }
    return `${openTag} ${attrName}='${safeVal}'${closeChars}`;
  });
}

export function updateWidgetSettingInXml(
  xml: string,
  widgetId: string,
  settingName: string,
  newValue: string
): string {
  const escapedId = widgetId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedSetting = settingName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const widgetBlockRegex = new RegExp(
    `(<b:widget\\b[^>]*\\bid\\s*=\\s*["']${escapedId}["'][^>]*>[\\s\\S]*?<\\/b:widget>)`,
    'i'
  );
  return xml.replace(widgetBlockRegex, (widgetBlock: string) => {
    const settingRegex = new RegExp(
      `(<b:widget-setting\\b[^>]*\\bname\\s*=\\s*["']${escapedSetting}["'][^>]*>)[\\s\\S]*?(<\\/b:widget-setting>)`,
      'i'
    );
    return widgetBlock.replace(settingRegex, (_, open: string, close: string) => `${open}${newValue}${close}`);
  });
}

export function replaceAssetUrlInXml(xml: string, oldUrl: string, newUrl: string): string {
  if (!oldUrl || !newUrl || oldUrl === newUrl) return xml;
  return xml.split(oldUrl).join(newUrl);
}

export function replaceSvgByIndexInXml(
  xml: string,
  targetIndex: number,
  newSvgMarkup: string
): string {
  let currentIdx = 0;
  return xml.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, (match) => {
    const idx = currentIdx++;
    return idx === targetIndex ? newSvgMarkup : match;
  });
}

export function updateNavLinkInXml(
  xml: string,
  rawTag: string,
  newHref: string,
  newText: string
): string {
  if (!rawTag || !xml.includes(rawTag)) return xml;
  let updatedTag = rawTag;
  const safeHref = escapeXmlAttr(newHref);

  if (/\bhref\s*=\s*(?:"[^"]*"|'[^']*')/i.test(updatedTag)) {
    updatedTag = updatedTag.replace(
      /\bhref\s*=\s*(?:"[^"]*"|'[^']*')/i,
      () => `href='${safeHref}'`
    );
  }
  updatedTag = updatedTag.replace(/^(<a\b[^>]*>)([\s\S]*?)(<\/a>)$/i, (_, open, inner, close) => {
    if (/<svg\b/i.test(inner) && newText.includes('[SVG]')) {
      return `${open}${inner}${close}`;
    }
    return `${open}${newText}${close}`;
  });
  return xml.replace(rawTag, () => updatedTag);
}

export function updateSnippetInXml(
  xml: string,
  oldSnippet: string,
  newSnippet: string
): string {
  if (!oldSnippet || !xml.includes(oldSnippet)) return xml;
  return xml.replace(oldSnippet, () => newSnippet);
}

export function addNewWidgetToSectionInXml(
  xml: string,
  sectionId: string,
  widgetType: string,
  widgetTitle: string
): string {
  const escapedSec = sectionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const secRegex = new RegExp(
    `(<b:section\\b[^>]*\\bid\\s*=\\s*["']${escapedSec}["'][^>]*)(?:/>|>([\\s\\S]*?)(<\\/b:section>))`,
    'i'
  );

  const existingIds = new Set(
    Array.from(xml.matchAll(/<b:widget\b[^>]*\bid\s*=\s*["']([^"']+)["']/gi)).map((m) => m[1])
  );
  let num = 1;
  while (existingIds.has(`${widgetType}${num}`)) num++;
  const newId = `${widgetType}${num}`;
  const safeTitle = escapeXmlAttr(widgetTitle || widgetType);

  const widgetSnippet = `  <b:widget id='${newId}' locked='false' title='${safeTitle}' type='${escapeXmlAttr(widgetType)}' visible='true'/>\n`;

  return xml.replace(secRegex, (full, openPart: string, inner?: string, closeTag?: string) => {
    if (full.endsWith('/>')) {
      return `${openPart}>\n${widgetSnippet}</b:section>`;
    }
    return `${openPart}>${inner ?? ''}${widgetSnippet}${closeTag ?? '</b:section>'}`;
  });
}

export function removeWidgetFromXml(xml: string, widgetId: string): string {
  const escapedId = widgetId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const selfClosingOrBlock = new RegExp(
    `\\s*<b:widget\\b[^>]*\\bid\\s*=\\s*["']${escapedId}["'][^>]*(?:\\/>|>[\\s\\S]*?<\\/b:widget>)`,
    'i'
  );
  return xml.replace(selfClosingOrBlock, '');
}

export function moveWidgetOrderInSectionXml(
  xml: string,
  sectionId: string,
  widgetId: string,
  direction: 'up' | 'down'
): string {
  const escapedSec = sectionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const secRegex = new RegExp(
    `(<b:section\\b[^>]*\\bid\\s*=\\s*["']${escapedSec}["'][^>]*>)([\\s\\S]*?)(<\\/b:section>)`,
    'i'
  );
  return xml.replace(secRegex, (full, open: string, inner: string, close: string) => {
    const widgetMatches = Array.from(
      inner.matchAll(/<b:widget\b[^>]*(?:\/>|>[\s\S]*?<\/b:widget>)/gi)
    );
    if (widgetMatches.length < 2) return full;

    const targetIdx = widgetMatches.findIndex((m) => {
      const idM = /\bid\s*=\s*["']([^"']+)["']/i.exec(m[0]);
      return idM?.[1] === widgetId;
    });
    if (targetIdx === -1) return full;

    const swapIdx = direction === 'up' ? targetIdx - 1 : targetIdx + 1;
    if (swapIdx < 0 || swapIdx >= widgetMatches.length) return full;

    const a = widgetMatches[Math.min(targetIdx, swapIdx)];
    const b = widgetMatches[Math.max(targetIdx, swapIdx)];
    const aStart = a.index ?? 0;
    const aEnd = aStart + a[0].length;
    const bStart = b.index ?? 0;
    const bEnd = bStart + b[0].length;

    const swappedInner =
      inner.slice(0, aStart) +
      b[0] +
      inner.slice(aEnd, bStart) +
      a[0] +
      inner.slice(bEnd);

    return `${open}${swappedInner}${close}`;
  });
}

export function updatePageTextInXml(
  xml: string,
  item: DetectedPageText,
  newText: string
): string {
  if (item.sourceType === 'widget-title' && item.widgetId) {
    return updateWidgetAttrInXml(xml, item.widgetId, 'title', newText);
  }
  if (item.sourceType === 'widget-setting-content' && item.widgetId && item.settingName) {
    return updateWidgetSettingInXml(xml, item.widgetId, item.settingName, newText);
  }
  if (item.sourceType === 'meta-title') {
    if (item.rawSnippet && xml.includes(item.rawSnippet)) {
      const updated = item.rawSnippet.replace(
        /^(<title\b[^>]*>)([\s\S]*?)(<\/title>)$/i,
        (_, open: string, __: string, close: string) => `${open}${newText}${close}`
      );
      return xml.replace(item.rawSnippet, () => updated);
    }
    return xml.replace(
      /(<title\b[^>]*>)([\s\S]*?)(<\/title>)/i,
      (_, open: string, __: string, close: string) => `${open}${newText}${close}`
    );
  }
  if (item.sourceType === 'meta-desc') {
    if (item.rawSnippet && xml.includes(item.rawSnippet)) {
      const safeAttr = escapeXmlAttr(newText);
      const updated = /\b(?:expr:)?content\s*=\s*(?:"[^"]*"|'[^']*')/i.test(item.rawSnippet)
        ? item.rawSnippet.replace(
            /\b(?:expr:)?content\s*=\s*(?:"[^"]*"|'[^']*')/i,
            () => `content='${safeAttr}'`
          )
        : item.rawSnippet;
      return xml.replace(item.rawSnippet, () => updated);
    }
    return xml;
  }
  if (item.sourceType === 'html-text' && item.rawSnippet && xml.includes(item.rawSnippet)) {
    const updatedTag = item.rawSnippet.replace(
      /^(<[^>]+>)([\s\S]*?)(<\/[a-zA-Z0-9:-]+>)$/,
      (_, open: string, __: string, close: string) => `${open}${newText}${close}`
    );
    return xml.replace(item.rawSnippet, () => updatedTag);
  }
  return xml;
}

export function extractTemplateSkinRawBlock(xml: string): string {
  const m = /<b:template-skin\b[^>]*>[\s\S]*?<\/b:template-skin>|<b:template-skin\b[^>]*\/>/i.exec(xml);
  return m ? m[0] : '';
}

function classifyLayoutZoneForTemplateSkin(
  sectionId: string,
  className: string
): 'top' | 'header' | 'crosscol' | 'main' | 'sidebar' | 'footer' | 'other' {
  const s = `${sectionId} ${className}`.toLowerCase();
  if (/navbar|topbar|top-nav|announcement/.test(s)) return 'top';
  if (/header|logo|branding/.test(s)) return 'header';
  if (/crosscol|nav|menu|slider|featured/.test(s)) return 'crosscol';
  if (/footer|bottom|credit|sub-footer/.test(s)) return 'footer';
  if (/main|content|post|blog/.test(s)) return 'main';
  if (/sidebar|aside|right|left|rail/.test(s)) return 'sidebar';
  return 'other';
}

export function generateTemplateSkinInXml(
  xml: string,
  parsedInfo: ParsedTemplateInfo,
  mode: 'auto' | 'empty' = 'auto'
): string {
  let block = '';

  if (mode === 'empty') {
    block = [
      '<b:template-skin>',
      '<![CDATA[',
      '/* Tata Letak Dashboard Blogger (<b:template-skin>) */',
      'body#layout .section { margin: 8px 0; padding: 10px; border: 1px dashed #cbd5e1; }',
      ']]>',
      '</b:template-skin>',
    ].join('\n');
  } else {
    const grouped: Record<string, string[]> = {
      top: [],
      header: [],
      crosscol: [],
      main: [],
      sidebar: [],
      footer: [],
      other: [],
    };
    for (const sec of parsedInfo.sections) {
      const zone = classifyLayoutZoneForTemplateSkin(sec.id, sec.className);
      grouped[zone].push(`#${sec.id}`);
    }

    const mainSelectors = grouped.main.length
      ? grouped.main.map((id) => `body#layout ${id}`).join(', ')
      : 'body#layout #main, body#layout .main-wrapper';
    const sidebarSelectors = grouped.sidebar.length
      ? grouped.sidebar.map((id) => `body#layout ${id}`).join(', ')
      : 'body#layout #sidebar, body#layout .sidebar-wrapper';
    const fullWidthSelectors = [...grouped.top, ...grouped.header, ...grouped.crosscol, ...grouped.other]
      .map((id) => `body#layout ${id}`);
    const footerSelectors = grouped.footer.map((id) => `body#layout ${id}`);
    const footerCols = Math.max(1, Math.min(3, grouped.footer.length || 1));
    const footerWidth = footerCols === 3 ? '31.5%' : footerCols === 2 ? '48.5%' : '100%';

    const layoutRules: string[] = [
      '/* Generator Otomatis <b:template-skin> (Tata Letak Blogger Studio) */',
      '<Variable name="content.width" description="Lebar Kontainer Utama" type="length" default="1040px" min="760px" max="1400px" value="1040px"/>',
      '<Variable name="main.column.left.width" description="Lebar Sidebar Kiri" type="length" default="0px" min="0px" max="420px" value="0px"/>',
      '<Variable name="main.column.right.width" description="Lebar Sidebar Kanan" type="length" default="320px" min="200px" max="460px" value="320px"/>',
      '',
      'body#layout { min-width: 820px; padding: 12px; background: #f8fafc; font-family: Arial, sans-serif; }',
      'body#layout .content-outer, body#layout #outer-wrapper, body#layout .container { width: 100%; max-width: $(content.width); margin: 0 auto; }',
      'body#layout .section { margin: 8px 0; padding: 10px; border: 1px dashed #94a3b8; border-radius: 6px; background: #ffffff; box-sizing: border-box; }',
      'body#layout .widget { margin: 6px 0; }',
    ];

    if (fullWidthSelectors.length > 0) {
      layoutRules.push(
        `${fullWidthSelectors.join(', ')} { width: 100%; clear: both; }`
      );
    }

    layoutRules.push(
      `${mainSelectors} { width: 65%; float: left; }`,
      `${sidebarSelectors} { width: 32%; float: right; }`,
      'body#layout .content-wrapper::after, body#layout #content-wrapper::after, body#layout #main-wrapper::after { content: ""; display: table; clear: both; }'
    );

    if (footerSelectors.length > 0) {
      layoutRules.push(
        `${footerSelectors.join(', ')} { width: ${footerWidth}; display: inline-block; vertical-align: top; margin-right: 1%; clear: none; }`
      );
    }

    block = [
      '<b:template-skin>',
      '<![CDATA[',
      ...layoutRules,
      ']]>',
      '</b:template-skin>',
    ].join('\n');
  }

  const existingRegex = /<b:template-skin\b[^>]*>[\s\S]*?<\/b:template-skin>|<b:template-skin\b[^>]*\/>/i;
  if (existingRegex.test(xml)) {
    return xml.replace(existingRegex, () => block);
  }

  if (/<\/b:skin>/i.test(xml)) {
    return xml.replace(/<\/b:skin>/i, (m) => `${m}\n${block}`);
  }

  if (/<\/head>/i.test(xml)) {
    return xml.replace(/<\/head>/i, (m) => `${block}\n${m}`);
  }

  if (/<body\b[^>]*>/i.test(xml)) {
    return xml.replace(/<body\b[^>]*>/i, (m) => `<head>\n${block}\n</head>\n${m}`);
  }

  return `${block}\n${xml}`;
}

export function addEmptyLayoutWidgetToSectionInXml(
  xml: string,
  sectionId: string,
  style: 'self-closing' | 'with-includable' = 'self-closing',
  widgetTitle = ''
): string {
  const escapedSec = sectionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const secRegex = new RegExp(
    `(<b:section\\b[^>]*\\bid\\s*=\\s*["']${escapedSec}["'][^>]*)(?:/>|>([\\s\\S]*?)(<\\/b:section>))`,
    'i'
  );

  if (!secRegex.test(xml)) return xml;

  const existingIds = new Set(
    Array.from(xml.matchAll(/<b:widget\b[^>]*\bid\s*=\s*["']([^"']+)["']/gi)).map((m) => m[1])
  );
  let num = 1;
  while (existingIds.has(`HTML${num}`)) num++;
  const newId = `HTML${num}`;
  const safeTitle = escapeXmlAttr(widgetTitle);

  const widgetSnippet =
    style === 'with-includable'
      ? [
          `  <b:widget id='${newId}' locked='false' title='${safeTitle}' type='HTML' visible='true'>`,
          `    <b:includable id='main'>`,
          `      <b:if cond='data:title != &quot;&quot;'><h2 class='title'><data:title/></h2></b:if>`,
          `      <div class='widget-content'><data:content/></div>`,
          `    </b:includable>`,
          `  </b:widget>`,
        ].join('\n') + '\n'
      : `  <b:widget id='${newId}' locked='false' title='${safeTitle}' type='HTML' visible='true'/>\n`;

  return xml.replace(secRegex, (full, openPart: string, inner?: string, closeTag?: string) => {
    if (full.endsWith('/>')) {
      return `${openPart}>\n${widgetSnippet}</b:section>`;
    }
    const prefix = inner && !inner.endsWith('\n') ? `${inner}\n` : inner ?? '\n';
    return `${openPart}>${prefix}${widgetSnippet}${closeTag ?? '</b:section>'}`;
  });
}

export function createEmptyLayoutSectionInXml(
  xml: string,
  desiredSectionId: string,
  zone: 'header' | 'crosscol' | 'main' | 'sidebar' | 'footer' | 'other' = 'other',
  withEmptyWidget = true,
  emptyWidgetStyle: 'self-closing' | 'with-includable' = 'self-closing'
): { xml: string; createdSectionId: string } {
  const cleaned = desiredSectionId
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || `section-${zone}`;

  const existingSectionIds = new Set(
    Array.from(xml.matchAll(/<b:section\b[^>]*\bid\s*=\s*["']([^"']+)["']/gi)).map((m) =>
      m[1].toLowerCase()
    )
  );

  let finalId = cleaned;
  let counter = 2;
  while (existingSectionIds.has(finalId.toLowerCase())) {
    finalId = `${cleaned}-${counter}`;
    counter++;
  }

  const classMap: Record<typeof zone, string> = {
    header: 'header section',
    crosscol: 'crosscol nav section',
    main: 'main section',
    sidebar: 'sidebar section',
    footer: 'footer section',
    other: 'section',
  };

  let sectionBlock = `<b:section class='${classMap[zone]}' id='${escapeXmlAttr(finalId)}' showaddelement='yes'>\n</b:section>`;
  let nextXml = xml;

  if (/<\/body>/i.test(nextXml)) {
    nextXml = nextXml.replace(/<\/body>/i, (m) => `  ${sectionBlock}\n${m}`);
  } else {
    nextXml = `${nextXml}\n${sectionBlock}`;
  }

  if (withEmptyWidget) {
    nextXml = addEmptyLayoutWidgetToSectionInXml(nextXml, finalId, emptyWidgetStyle, '');
  }

  return { xml: nextXml, createdSectionId: finalId };
}

export function populateEmptySectionsWithEmptyWidgetsInXml(
  xml: string,
  parsedInfo: ParsedTemplateInfo,
  style: 'self-closing' | 'with-includable' = 'self-closing'
): { xml: string; addedCount: number } {
  const populatedIds = new Set(parsedInfo.widgets.map((w) => w.sectionId));
  let nextXml = xml;
  let addedCount = 0;

  for (const sec of parsedInfo.sections) {
    const canAdd = sec.showAddElement !== 'false' && sec.showAddElement !== 'no';
    if (!canAdd) continue;
    if (!populatedIds.has(sec.id)) {
      const updated = addEmptyLayoutWidgetToSectionInXml(nextXml, sec.id, style, '');
      if (updated !== nextXml) {
        nextXml = updated;
        addedCount++;
      }
    }
  }

  return { xml: nextXml, addedCount };
}

export function scaffoldEmptyBloggerLayoutInXml(
  xml: string,
  options: {
    includeEmptyWidgets?: boolean;
    emptyWidgetStyle?: 'self-closing' | 'with-includable';
    alsoGenerateTemplateSkin?: boolean;
  } = {}
): {
  xml: string;
  addedSections: string[];
  addedWidgets: number;
  generatedTemplateSkin: boolean;
} {
  const {
    includeEmptyWidgets = true,
    emptyWidgetStyle = 'self-closing',
    alsoGenerateTemplateSkin = true,
  } = options;

  let nextXml = xml;
  const addedSections: string[] = [];
  let addedWidgets = 0;

  const existingIds = new Set(
    Array.from(nextXml.matchAll(/<b:section\b[^>]*\bid\s*=\s*["']([^"']+)["']/gi)).map((m) =>
      m[1].toLowerCase()
    )
  );

  const blueprint: Array<{
    id: string;
    zone: 'header' | 'crosscol' | 'main' | 'sidebar' | 'footer';
  }> = [
    { id: 'header', zone: 'header' },
    { id: 'crosscol', zone: 'crosscol' },
    { id: 'main', zone: 'main' },
    { id: 'sidebar', zone: 'sidebar' },
    { id: 'footer-1', zone: 'footer' },
    { id: 'footer-2', zone: 'footer' },
  ];

  for (const slot of blueprint) {
    if (existingIds.has(slot.id)) continue;
    const res = createEmptyLayoutSectionInXml(
      nextXml,
      slot.id,
      slot.zone,
      includeEmptyWidgets,
      emptyWidgetStyle
    );
    nextXml = res.xml;
    addedSections.push(res.createdSectionId);
    if (includeEmptyWidgets) addedWidgets++;
  }

  let generatedTemplateSkin = false;
  if (alsoGenerateTemplateSkin) {
    const reparsed = parseBloggerXml(nextXml);
    const updatedSkin = generateTemplateSkinInXml(nextXml, reparsed, 'auto');
    if (updatedSkin !== nextXml) {
      nextXml = updatedSkin;
      generatedTemplateSkin = true;
    }
  }

  return {
    xml: nextXml,
    addedSections,
    addedWidgets,
    generatedTemplateSkin,
  };
}

export function insertCustomTemplateSkinInXml(xml: string, rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) return xml;

  let block = trimmed;
  const tagMatch = /<b:template-skin\b([^>]*)>([\s\S]*?)<\/b:template-skin>/i.exec(trimmed);

  if (tagMatch) {
    const attrs = tagMatch[1] || '';
    const inner = tagMatch[2].trim();
    if (/<!\[CDATA\[/i.test(inner)) {
      block = `<b:template-skin${attrs}>\n${inner}\n</b:template-skin>`;
    } else {
      const safeInner = inner.replace(/\]\]>/g, ']]&gt;');
      block = `<b:template-skin${attrs}>\n<![CDATA[\n${safeInner}\n]]>\n</b:template-skin>`;
    }
  } else {
    const unwrapped = trimmed.replace(/^<!\[CDATA\[|\]\]>$/g, '').trim();
    const safeInner = unwrapped.replace(/\]\]>/g, ']]&gt;');
    block = `<b:template-skin>\n<![CDATA[\n${safeInner}\n]]>\n</b:template-skin>`;
  }

  const existingRegex = /<b:template-skin\b[^>]*>[\s\S]*?<\/b:template-skin>|<b:template-skin\b[^>]*\/>/i;
  if (existingRegex.test(xml)) {
    return xml.replace(existingRegex, () => block);
  }

  if (/<\/b:skin>/i.test(xml)) {
    return xml.replace(/<\/b:skin>/i, (m) => `${m}\n${block}`);
  }

  if (/<\/head>/i.test(xml)) {
    return xml.replace(/<\/head>/i, (m) => `${block}\n${m}`);
  }

  if (/<body\b[^>]*>/i.test(xml)) {
    return xml.replace(/<body\b[^>]*>/i, (m) => `<head>\n${block}\n</head>\n${m}`);
  }

  return `${block}\n${xml}`;
}

export type XmlDownloadMethod = 'saf' | 'data-uri' | 'blob' | 'cancelled' | 'noop';

export interface XmlDownloadResult {
  filename: string;
  method: XmlDownloadMethod;
}

const FIVE_MB_BYTES = 5 * 1024 * 1024;

export function normalizeXmlForExport(xmlContent: string): string {
  let normalizedXml = (xmlContent || '')
    .replace(/^\uFEFF/, '')
    .replace(/^\s+(?=<\?xml\b)/i, '');
  if (normalizedXml.trim() && !/^\s*<\?xml\b/i.test(normalizedXml)) {
    normalizedXml = `<?xml version="1.0" encoding="UTF-8" ?>\n${normalizedXml}`;
  }
  return normalizedXml;
}

export function resolveXmlExportFilename(templateTitle?: string): string {
  const raw = (templateTitle || '').trim();
  if (!raw) return 'template-blogger.xml';
  if (/^template-blogger(?:\.xml)?$/i.test(raw)) return 'template-blogger.xml';
  const cleanTitle = raw.replace(/(?:\.xml(?:\.txt)?|\.txt)$/i, '').trim();
  if (!cleanTitle) return 'template-blogger.xml';
  // Keep explicit snapshot suffix if requested, otherwise use standard Android MediaStore-safe filename
  if (/-snapshot$/i.test(cleanTitle)) {
    const safeSlug = cleanTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return `${safeSlug || 'template-blogger'}.xml`;
  }
  return 'template-blogger.xml';
}

function triggerAnchorXmlDownload(normalizedXml: string, filename: string): 'data-uri' | 'blob' {
  const byteSize = getUtf8ByteLength(normalizedXml);

  const link = document.createElement('a');
  link.download = filename;
  link.setAttribute('download', filename);
  link.type = 'text/xml';
  link.rel = 'noopener noreferrer';
  link.style.display = 'none';

  let blobUrlToRevoke: string | null = null;
  let method: 'data-uri' | 'blob' = 'data-uri';

  if (byteSize <= FIVE_MB_BYTES) {
    // Priority 2: Data URI so Android DownloadManager registers MIME text/xml properly
    const dataUrl = 'data:text/xml;charset=utf-8,' + encodeURIComponent(normalizedXml);
    link.href = dataUrl;
  } else if (typeof Blob !== 'undefined') {
    // Use Blob only when XML size exceeds 5 MB
    const blob = new Blob([normalizedXml], { type: 'text/xml;charset=utf-8' });
    blobUrlToRevoke = URL.createObjectURL(blob);
    link.href = blobUrlToRevoke;
    method = 'blob';
  } else {
    link.href = 'data:text/xml;charset=utf-8,' + encodeURIComponent(normalizedXml);
  }

  document.body.appendChild(link);
  link.click();

  window.setTimeout(() => {
    try {
      if (link.parentNode) {
        link.parentNode.removeChild(link);
      }
    } catch {
      // ignore cleanup error
    }
    if (blobUrlToRevoke) {
      try {
        URL.revokeObjectURL(blobUrlToRevoke);
      } catch {
        // ignore cleanup error
      }
    }
  }, 15000);

  return method;
}

interface SaveFilePickerHandle {
  name?: string;
  createWritable: () => Promise<{
    write: (data: string | Blob) => Promise<void>;
    close: () => Promise<void>;
  }>;
}

interface WindowWithSaveFilePicker extends Window {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{
      description?: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<SaveFilePickerHandle>;
}

/**
 * Download Blogger XML with Android MediaStore text/xml compatibility:
 * Priority 1: File System Access API (window.showSaveFilePicker)
 * Priority 2: Data URI (data:text/xml;charset=utf-8,...) for <= 5MB, Blob fallback for > 5MB
 */
export async function downloadXmlFile(
  xmlContent: string,
  templateTitle?: string
): Promise<XmlDownloadResult> {
  const filename = resolveXmlExportFilename(templateTitle);
  const normalizedXml = normalizeXmlForExport(xmlContent);

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { filename, method: 'noop' };
  }

  const win = window as WindowWithSaveFilePicker;
  if (typeof win.showSaveFilePicker === 'function') {
    try {
      const handle = await win.showSaveFilePicker({
        suggestedName: 'template-blogger.xml',
        types: [
          {
            description: 'XML Document',
            accept: {
              'text/xml': ['.xml'],
            },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(normalizedXml);
      await writable.close();
      return {
        filename: handle.name || 'template-blogger.xml',
        method: 'saf',
      };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { filename: 'template-blogger.xml', method: 'cancelled' };
      }
      // Cross-origin iframe SecurityError or unsupported SAF -> fallback cleanly to Data URI
    }
  }

  const method = triggerAnchorXmlDownload(normalizedXml, filename);
  return { filename, method };
}

export function canShareXmlFile(
  xmlContent = '<template/>',
  templateTitle?: string
): boolean {
  if (
    typeof navigator === 'undefined' ||
    typeof File === 'undefined' ||
    typeof navigator.share !== 'function' ||
    typeof navigator.canShare !== 'function'
  ) {
    return false;
  }
  try {
    const filename = resolveXmlExportFilename(templateTitle);
    const file = new File([xmlContent], filename, { type: 'text/xml' });
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/**
 * Priority 3: Share XML file via Web Share API (navigator.share) so mobile users
 * can save directly to File Manager with a valid text/xml MIME type.
 */
export async function shareXmlFileViaNavigator(
  xmlContent: string,
  templateTitle?: string
): Promise<'shared' | 'cancelled' | 'unsupported'> {
  if (
    typeof navigator === 'undefined' ||
    typeof File === 'undefined' ||
    typeof navigator.share !== 'function'
  ) {
    return 'unsupported';
  }
  const filename = resolveXmlExportFilename(templateTitle);
  const normalizedXml = normalizeXmlForExport(xmlContent);
  const file = new File([normalizedXml], filename, { type: 'text/xml' });

  if (typeof navigator.canShare === 'function' && !navigator.canShare({ files: [file] })) {
    return 'unsupported';
  }

  try {
    await navigator.share({
      files: [file],
      title: filename,
    });
    return 'shared';
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return 'cancelled';
    }
    throw err;
  }
}

/**
 * Synchronous-signature wrapper that immediately kicks off Priority 1 (SAF) -> Priority 2 (Data URI).
 */
export function triggerXmlFileDownload(
  xmlContent: string,
  templateTitle?: string,
  onCompleted?: (result: XmlDownloadResult) => void
): string {
  const filename = resolveXmlExportFilename(templateTitle);
  void downloadXmlFile(xmlContent, templateTitle).then((res) => {
    onCompleted?.(res);
  });
  return filename;
}




