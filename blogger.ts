export type DevicePreset = 'desktop' | 'laptop' | 'tablet' | 'mobile';

export type PreviewPageType = 'index' | 'post' | 'item' | 'archive' | 'page';

export interface BloggerVariable {
  name: string;
  description: string;
  type: string;
  defaultValue: string;
  value: string;
  group?: string;
  source: 'b:skin' | 'b:template-skin' | 'head';
  min?: string;
  max?: string;
}

export interface CssCustomProperty {
  name: string;
  value: string;
  selector: string;
  valueType: 'color' | 'length' | 'size' | 'font' | 'other';
  occurrences: number;
}

export interface BloggerWidgetSetting {
  widgetId: string;
  widgetType: string;
  name: string;
  value: string;
}

export interface HardcodedColorToken {
  color: string;
  count: number;
  sampleContext: string;
}

export interface HardcodedFontToken {
  fontFamily: string;
  count: number;
}

export interface ExternalResourceInfo {
  kind: 'font' | 'stylesheet' | 'script';
  url: string;
}

export interface BloggerSectionInfo {
  id: string;
  className: string;
  widgetCount: number;
  maxWidgets?: string;
  showAddElement?: string;
}

export interface BloggerWidgetInfo {
  id: string;
  type: string;
  title: string;
  sectionId: string;
  version?: string;
  locked?: string;
  visible?: string;
  line: number;
}

export interface DetectedImageAsset {
  id: string;
  url: string;
  sourceKind: 'img' | 'expr-img' | 'meta-og' | 'favicon' | 'css-url';
  context: string;
  line: number;
  count: number;
}

export interface DetectedSvgAsset {
  index: number;
  idAttr: string;
  classAttr: string;
  viewBox: string;
  width: string;
  height: string;
  fill: string;
  context: string;
  line: number;
  rawSvg: string;
}

export interface DetectedNavLink {
  index: number;
  text: string;
  href: string;
  zone: string;
  line: number;
  rawTag: string;
}

export interface DetectedRegionBlock {
  id: string;
  zone: 'meta' | 'header' | 'footer' | 'copyright' | string;
  label: string;
  line: number;
  previewText: string;
  rawSnippet: string;
  editableValue?: string;
  isDynamic?: boolean;
}

export interface DetectedPageText {
  id: string;
  zone: 'meta' | 'header' | 'nav' | 'main' | 'sidebar' | 'footer' | 'copyright' | 'widget' | string;
  sourceType: 'meta-title' | 'meta-desc' | 'widget-title' | 'widget-setting-content' | 'html-text';
  label: string;
  text: string;
  line: number;
  rawSnippet: string;
  widgetId?: string;
  settingName?: string;
  isDynamic?: boolean;
}

export interface DetectedAssetUrl {
  id: string;
  kind: 'js' | 'css';
  extension?: 'js' | 'jss' | 'mjs' | 'cjs' | 'css' | 'data-uri' | 'unknown';
  url: string;
  rawUrl: string;
  host: string;
  sourceContext: string;
  isDataUri: boolean;
  isObfuscated?: boolean;
  obfuscationTechnique?: string;
  decodedUrl?: string;
  rawExpression?: string;
  line: number;
  count: number;
}

export interface ExtractedCodeBlock {
  id: string;
  kind: 'css' | 'js';
  sourceLabel: string;
  startLine: number;
  endLine: number;
  code: string;
  byteSize: number;
}

export interface ExtractedTemplateViews {
  htmlMarkup: string;
  htmlRenderPreview: string;
  htmlLineCount: number;
  cssBlocks: ExtractedCodeBlock[];
  combinedCss: string;
  jsBlocks: ExtractedCodeBlock[];
  combinedJs: string;
  externalUrls: DetectedAssetUrl[];
}

export interface DetectedEncodedCode {
  id: string;
  technique:
    | 'packer'
    | 'base64'
    | 'hex-unicode'
    | 'charcode'
    | 'unescape'
    | 'url-escape'
    | 'eval-obfuscation'
    | 'unknown';
  techniqueLabel: string;
  zone: string;
  line: number;
  rawSnippet: string;
  decodedText: string;
  revealedUrls: string[];
  signals: string[];
}

export interface XmlTextRange {
  start: number;
  end: number;
}

export interface DuplicateAssetEntry {
  id: string;
  kind: 'css' | 'js';
  duplicateType: 'exact-url' | 'same-library' | 'identical-inline' | 'inline-block';
  label: string;
  occurrences: number;
  lines: number[];
  urlsOrSnippets: string[];
  removableRawTags: string[];
  removableRanges?: XmlTextRange[];
  reason: string;
  estimatedSavedBytes: number;
}

export interface DuplicateCssRuleEntry {
  id: string;
  selector: string;
  duplicateType: 'identical-rule' | 'repeated-selector' | 'duplicate-css-var';
  occurrences: number;
  lines: number[];
  source: 'b:skin' | 'b:template-skin' | 'style';
  sampleBody: string;
  removableRawRules: string[];
  removableRanges?: XmlTextRange[];
  reason: string;
  estimatedSavedBytes: number;
}

export interface UnusedCssRuleEntry {
  id: string;
  selector: string;
  fullRule: string;
  tokensChecked: string[];
  line: number;
  source: 'b:skin' | 'b:template-skin' | 'style';
  confidence: 'pasti' | 'kemungkinan';
  estimatedBytes: number;
  range?: XmlTextRange;
  reason: string;
}

export interface UnusedCssVarEntry {
  id: string;
  name: string;
  value: string;
  selector: string;
  line: number;
  declarationRaw: string;
  range?: XmlTextRange;
}

export interface CssJsRedundancyReport {
  duplicateCssAssets: DuplicateAssetEntry[];
  duplicateJsAssets: DuplicateAssetEntry[];
  duplicateCssRules: DuplicateCssRuleEntry[];
  unusedCssRules: UnusedCssRuleEntry[];
  unusedCssVars: UnusedCssVarEntry[];
  totalDuplicateCssCount: number;
  totalDuplicateJsCount: number;
  totalUnusedCssCount: number;
  totalEstimatedSavingsBytes: number;
}

export interface TemplateByteBreakdown {
  totalBytes: number;
  skinBytes: number;
  templateSkinBytes: number;
  inlineScriptBytes: number;
  markupBytes: number;
  lineCount: number;
  lineEnding: 'CRLF' | 'LF';
  hasBom: boolean;
}

export interface ParsedTemplateInfo {
  templateTitle: string;
  variables: BloggerVariable[];
  cssCustomProperties: CssCustomProperty[];
  widgetSettings: BloggerWidgetSetting[];
  hardcodedColors: HardcodedColorToken[];
  hardcodedFonts: HardcodedFontToken[];
  externalResources: ExternalResourceInfo[];
  images: DetectedImageAsset[];
  svgs: DetectedSvgAsset[];
  navLinks: DetectedNavLink[];
  regions: DetectedRegionBlock[];
  pageTexts: DetectedPageText[];
  assetUrls: DetectedAssetUrl[];
  encodedCodes: DetectedEncodedCode[];
  redundancyReport: CssJsRedundancyReport;
  themeSignatureTokens: string[];
  fontFamiliesUsed: string[];
  sections: BloggerSectionInfo[];
  widgets: BloggerWidgetInfo[];
  includableCount: number;
  conditionalCount: number;
  loopCount: number;
  hasSkin: boolean;
  hasTemplateSkin: boolean;
  hasViewportMeta: boolean;
  hasBloggerNamespaces: boolean;
  rawSkinCss: string;
  xmlByteSize: number;
  byteBreakdown: TemplateByteBreakdown;
}

export interface ThemePaletteOverrides {
  enabled: boolean;
  background: string;
  surface: string;
  primary: string;
  heading: string;
  text: string;
  mutedText: string;
  link: string;
  headerBg: string;
  headerText: string;
  border: string;
}

export interface FontCustomization {
  enabled: boolean;
  headingFont: string;
  bodyFont: string;
  monoFont: string;
  baseFontSize: number;
  lineHeight: number;
  headingWeight: number;
  letterSpacing: number;
  borderRadius: number;
}

export interface SamplePost {
  id: string;
  title: string;
  snippet: string;
  bodyHtml: string;
  author: string;
  date: string;
  category: string;
  readTime: string;
  imageUrl: string;
  commentsCount: number;
}

export interface SampleNavLink {
  label: string;
  category?: string;
}

export interface SampleLabelItem {
  name: string;
  count: number;
}

export interface SampleBlogData {
  blogTitle: string;
  blogDescription: string;
  authorName: string;
  authorBio: string;
  authorAvatar: string;
  navLinks: SampleNavLink[];
  labels: SampleLabelItem[];
  posts: SamplePost[];
}

export interface BloggerTemplatePreset {
  id: string;
  name: string;
  category: string;
  description: string;
  xml: string;
}

export interface ColorPalettePreset {
  id: string;
  name: string;
  palette: Omit<ThemePaletteOverrides, 'enabled'>;
}

export interface FontOption {
  name: string;
  category: 'sans-serif' | 'serif' | 'monospace';
  vibe: string;
}

export interface AiDiagnosticItem {
  category: string;
  title: string;
  detail: string;
  severity: 'good' | 'warning' | 'fixable';
}

export interface AiDiagnosticResult {
  summary: string;
  items: AiDiagnosticItem[];
  suggestedCssFix?: string;
}

export type DevConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'network';
export type DevConsoleSource = 'preview' | 'url' | 'xml' | 'user-input';

export interface DevConsoleLogEntry {
  id: string;
  timestamp: string;
  level: DevConsoleLevel;
  source: DevConsoleSource;
  title: string;
  detail?: string;
  url?: string;
  line?: number | null;
  codeSnippet?: string;
}
