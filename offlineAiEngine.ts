import type {
  AiDiagnosticItem,
  AiDiagnosticResult,
  DetectedAssetUrl,
  DetectedEncodedCode,
  DetectedPageText,
  FontCustomization,
  ParsedTemplateInfo,
  ThemePaletteOverrides,
} from '../types/blogger';
import type { BloggerErrorDiagnosis, SeoMonetizationReport } from './seoAndErrorAnalyzer';

function computeSeoScore(report: SeoMonetizationReport): number {
  const total = report.counts.found + report.counts.warning + report.counts.missing;
  if (total === 0) return 0;
  return Math.round(((report.counts.found + report.counts.warning * 0.5) / total) * 100);
}

export function summarizeSeoWithOfflineAi(
  report: SeoMonetizationReport,
  parsedInfo: ParsedTemplateInfo
): {
  verdict: 'siap' | 'perlu-optimasi' | 'perhatian';
  headline: string;
  priorityActions: Array<{ area: string; title: string; detail: string }>;
} {
  const overallScore = computeSeoScore(report);
  const verdict: 'siap' | 'perlu-optimasi' | 'perhatian' =
    overallScore >= 80 && !report.hasAdsenseXmlSyntaxRisk
      ? 'siap'
      : overallScore >= 55
        ? 'perlu-optimasi'
        : 'perhatian';

  const actions: Array<{ area: string; title: string; detail: string }> = [];

  if (report.hasAdsenseXmlSyntaxRisk) {
    actions.push({
      area: 'ADSENSE',
      title: 'Amankan Skrip AdSense ke Format XML',
      detail:
        'Skrip AdSense mengandung atribut boolean tanpa nilai atau "&" mentah yang akan ditolak parser Blogger.',
    });
  }

  const missingMeta = report.metaSeo.find((m) => m.status === 'missing');
  if (missingMeta) {
    actions.push({
      area: 'META SEO',
      title: `Lengkapi ${missingMeta.label}`,
      detail: missingMeta.detail,
    });
  }

  if (report.googleSearch.some((m) => m.status === 'missing')) {
    actions.push({
      area: 'SEARCH',
      title: 'Perkuat Structured Data Search',
      detail:
        'Pastikan all-head-content, canonical, serta skema JSON-LD BlogPosting/BreadcrumbList tersedia di <head>.',
    });
  }

  if (actions.length === 0) {
    actions.push({
      area: 'PERFORMA',
      title: 'Pertahankan Kebersihan CSS/JS',
      detail: `Template "${parsedInfo.templateTitle}" sudah memiliki fondasi SEO dan monetisasi yang baik (skor ${overallScore}/100).`,
    });
  }

  const headline =
    verdict === 'siap'
      ? `Template "${parsedInfo.templateTitle}" siap dipublikasikan dengan skor SEO & Monetisasi ${overallScore}/100.`
      : verdict === 'perlu-optimasi'
        ? `Template "${parsedInfo.templateTitle}" memperoleh skor ${overallScore}/100 dan masih dapat ditingkatkan pada ${actions.length} area prioritas.`
        : `Template "${parsedInfo.templateTitle}" membutuhkan perbaikan mendesak pada meta SEO atau validitas XML AdSense (skor ${overallScore}/100).`;

  return {
    verdict,
    headline,
    priorityActions: actions.slice(0, 3),
  };
}

export function summarizeErrorWithOfflineAi(
  diagnosis: BloggerErrorDiagnosis,
  parsedInfo: ParsedTemplateInfo
): {
  autoFixConfidence: string;
  correlationHints: string[];
} {
  const errCount = diagnosis.xmlValidation.issues.filter((i) => i.severity === 'error').length;
  const warnCount = diagnosis.xmlValidation.issues.filter((i) => i.severity === 'warning').length;
  const hints: string[] = [];

  if (diagnosis.extractedLine) {
    hints.push(
      `Studio Blogger menyorot baris ${diagnosis.extractedLine} pada template "${parsedInfo.templateTitle}".`
    );
  }

  if (errCount === 0 && warnCount === 0) {
    hints.push('Tidak ada error struktural XML 1.0 yang tersisa pada pemindaian lokal.');
  } else {
    hints.push(
      `Terdeteksi ${errCount} error kritis dan ${warnCount} peringatan pada kode XML aktif.`
    );
  }

  if (diagnosis.id === 'unescaped-amp') {
    hints.push('Penyebab paling umum adalah karakter "&" telanjang pada URL Font/CDN di luar CDATA.');
  } else if (diagnosis.id === 'boolean-attr') {
    hints.push('Atribut boolean seperti async/defer/disabled di XHTML Blogger wajib ditulis pasangan nilai (async="async").');
  } else if (diagnosis.id === 'bad-cdata-or-lt') {
    hints.push('Blok <script> atau <style> inline dengan operator < atau & harus dibungkus //<![CDATA[ ... //]]> atau /*<![CDATA[*/ ... /*]]>*/.');
  }

  const autoFixConfidence =
    errCount === 0
      ? 'Validasi Bersih'
      : errCount <= 8
        ? 'Akurasi Auto-Fix Tinggi'
        : 'Perlu Auto-Fix Iteratif';

  return {
    autoFixConfidence,
    correlationHints: hints,
  };
}

export function evaluatePageTextWithOfflineAi(item: DetectedPageText): {
  status: 'optimal' | 'saran' | 'perhatian';
  insight: string;
  suggestedText?: string;
} {
  const clean = item.text.trim();
  if (item.sourceType === 'meta-desc' && clean.length > 0 && clean.length < 50) {
    return {
      status: 'saran',
      insight: 'Meta description terlalu singkat (< 50 karakter); idealnya 110–155 karakter agar lebih menarik di Google Search.',
    };
  }
  if (clean.length > 160 && item.sourceType === 'meta-desc') {
    return {
      status: 'perhatian',
      insight: 'Meta description melebihi 160 karakter dan berisiko terpotong di hasil pencarian.',
      suggestedText: `${clean.slice(0, 152).trim()}...`,
    };
  }
  if (/lorem ipsum|sample text|test template/i.test(clean)) {
    return {
      status: 'perhatian',
      insight: 'Terdeteksi teks placeholder/contoh bawaan template yang sebaiknya diganti teks blog asli.',
    };
  }
  return {
    status: 'optimal',
    insight: 'Teks terbaca bersih dan sesuai zona penempatannya.',
  };
}

export function evaluateAssetUrlWithOfflineAi(asset: DetectedAssetUrl): {
  trustLevel: 'resmi' | 'netral' | 'waspada';
  roleLabel: string;
  summary: string;
} {
  const lower = `${asset.host} ${asset.url}`.toLowerCase();
  if (asset.isObfuscated) {
    const extLabel = asset.extension ? `.${asset.extension.toUpperCase()}` : `.${asset.kind.toUpperCase()}`;
    return {
      trustLevel: 'waspada',
      roleLabel: `URL ${extLabel} Disembunyikan (${asset.obfuscationTechnique || 'Obfuscated'})`,
      summary: `URL tujuan (${asset.url}) disamarkan di dalam kode XML/JS menggunakan ${asset.obfuscationTechnique || 'obfuskasi'}. Periksa keamanannya atau hapus bila bukan aset resmi Anda.`,
    };
  }

  if (
    /fonts\.googleapis\.com|fonts\.gstatic\.com|ajax\.googleapis\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|pagead2\.googlesyndication\.com|googletagmanager\.com|blogger\.com|blogspot\.com/.test(
      lower
    )
  ) {
    return {
      trustLevel: 'resmi',
      roleLabel: 'CDN Resmi / Pustaka Tepercaya',
      summary: `Dimuat dari ${asset.host}; aman digunakan untuk tema Blogger produksi.`,
    };
  }

  if (lower.startsWith('http://')) {
    return {
      trustLevel: 'waspada',
      roleLabel: 'Protokol HTTP Non-HTTPS',
      summary: 'Aset masih memakai http:// sehingga dapat memicu peringatan Mixed Content di Blogger HTTPS.',
    };
  }

  const extLabel = asset.extension === 'jss' ? '.JSS' : `.${asset.kind.toUpperCase()}`;
  return {
    trustLevel: 'netral',
    roleLabel: asset.isDataUri ? 'Data URI Tertanam' : `Sumber Eksternal ${extLabel}`,
    summary: `Periksa keandalan dan kecepatan respon dari host ${asset.host}.`,
  };
}

export function evaluateEncodedCodeWithOfflineAi(
  enc: Pick<DetectedEncodedCode, 'decodedText' | 'revealedUrls' | 'signals'> &
    Partial<Pick<DetectedEncodedCode, 'technique' | 'techniqueLabel' | 'zone'>> & {
      appliedLayers?: string[];
    }
): {
  riskLevel: 'rendah' | 'sedang' | 'tinggi';
  classification: string;
  summary: string;
  recommendation: string;
} {
  const decodedLower = enc.decodedText.toLowerCase();
  const hasEvalOrInject =
    /document\.write|createelement\(['"]script|window\.location|eval\(|fromcharcode/.test(
      decodedLower
    ) || enc.revealedUrls.length > 0;
  const label =
    enc.techniqueLabel ||
    (enc.appliedLayers && enc.appliedLayers.length > 0
      ? enc.appliedLayers.join(' + ')
      : 'Payload Terenkode');
  const zoneLabel = enc.zone || 'MANUAL';

  if (enc.technique === 'packer' || enc.technique === 'eval-obfuscation' || hasEvalOrInject) {
    return {
      riskLevel: 'tinggi',
      classification: 'Skrip Terobfuskasi / Injeksi Dinamis',
      summary: `Menggunakan teknik ${label}${enc.revealedUrls.length ? ` dengan ${enc.revealedUrls.length} URL eksternal tersembunyi` : ''}.`,
      recommendation: 'Periksa hasil decode terlebih dahulu atau hapus blok ini jika bukan fitur resmi Anda.',
    };
  }

  if (enc.technique === 'base64' || enc.technique === 'unescape' || enc.technique === 'url-escape') {
    return {
      riskLevel: 'sedang',
      classification: 'Payload Terenkode Base64 / Escape',
      summary: `Berisi string terenkode (${label}) di zona ${zoneLabel}.`,
      recommendation: 'Pastikan payload ini berasal dari widget/fitur tepercaya sebelum dipublikasikan.',
    };
  }

  return {
    riskLevel: 'rendah',
    classification: 'Karakter Escape / Utilitas Aman',
    summary: `Karakter ter-escape (${label}) tanpa indikasi injeksi skrip eksternal.`,
    recommendation: 'Aman dibiarkan apabila merupakan bagian dari fungsi UI tema.',
  };
}

export function generateThemeOfflineAi(
  prompt: string,
  _currentVariables: Array<{ name: string; description: string; type: string; value: string }>
): {
  themeName: string;
  rationale: string;
  colors: Partial<ThemePaletteOverrides>;
  fonts: Partial<FontCustomization>;
  customCss: string;
} {
  const lower = prompt.toLowerCase();

  if (/gelap|dark|malam|cyber|gamer|neon|tech/.test(lower)) {
    return {
      themeName: 'Obsidian Editorial (AI Offline)',
      rationale: 'Palet gelap kontras tinggi dengan aksen biru elektrik untuk blog teknologi & tutorial.',
      colors: {
        background: '#0f172a',
        surface: '#1e293b',
        primary: '#38bdf8',
        heading: '#f8fafc',
        text: '#cbd5e1',
        mutedText: '#94a3b8',
        link: '#38bdf8',
        headerBg: '#020617',
        headerText: '#f8fafc',
        border: '#334155',
      },
      fonts: {
        headingFont: 'Plus Jakarta Sans',
        bodyFont: 'Inter',
        baseFontSize: 16,
        lineHeight: 1.7,
        headingWeight: 700,
        borderRadius: 12,
      },
      customCss:
        '.post-outer, .sidebar-container .widget { box-shadow: 0 8px 24px rgba(2, 6, 23, 0.35); }',
    };
  }

  if (/hijau|alam|eco|botani|organik|sehat/.test(lower)) {
    return {
      themeName: 'Botani Editorial (AI Offline)',
      rationale: 'Nuansa hijau zamrud hangat dengan tipografi serif bersih untuk kenyamanan baca jangka panjang.',
      colors: {
        background: '#f6faf7',
        surface: '#ffffff',
        primary: '#059669',
        heading: '#064e3b',
        text: '#1f2937',
        mutedText: '#6b7280',
        link: '#047857',
        headerBg: '#064e3b',
        headerText: '#ffffff',
        border: '#d1fae5',
      },
      fonts: {
        headingFont: 'Fraunces',
        bodyFont: 'DM Sans',
        baseFontSize: 16,
        lineHeight: 1.7,
        headingWeight: 700,
        borderRadius: 14,
      },
      customCss: '.post-outer { border-width: 1px; }',
    };
  }

  return {
    themeName: 'Jurnal Bersih Modern (AI Offline)',
    rationale: 'Kombinasi latar kertas hangat, tipografi editorial tajam, dan aksen biru klasik.',
    colors: {
      background: '#f8fafc',
      surface: '#ffffff',
      primary: '#2563eb',
      heading: '#0f172a',
      text: '#334155',
      mutedText: '#64748b',
      link: '#1d4ed8',
      headerBg: '#ffffff',
      headerText: '#0f172a',
      border: '#e2e8f0',
    },
    fonts: {
      headingFont: 'Fraunces',
      bodyFont: 'DM Sans',
      baseFontSize: 16,
      lineHeight: 1.65,
      headingWeight: 700,
      borderRadius: 12,
    },
    customCss:
      '.post-outer { transition: transform 0.18s ease, box-shadow 0.18s ease; }\n.post-outer:hover { transform: translateY(-2px); box-shadow: 0 10px 25px rgba(15, 23, 42, 0.06); }',
  };
}

export function generateCustomCssOfflineAi(
  instruction: string,
  currentCss: string
): { css: string; explanation: string } {
  const lower = instruction.toLowerCase();
  const additions: string[] = [];

  if (/radius|bulat|sudut|rounded|kartu/.test(lower)) {
    additions.push('.post-outer, .sidebar-container .widget, .card { border-radius: 16px !important; }');
  }
  if (/bayangan|shadow|elegan/.test(lower)) {
    additions.push(
      '.post-outer, .sidebar-container .widget { box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08) !important; }'
    );
  }
  if (/lebar|container|spacing|jarak/.test(lower)) {
    additions.push('.content-outer, .container { max-width: 1140px; margin-inline: auto; }');
  }
  if (/mobile|responsif|hp/.test(lower)) {
    additions.push(
      '@media (max-width: 768px) { .main-wrapper, .sidebar-wrapper { width: 100% !important; float: none !important; padding-inline: 12px !important; } }'
    );
  }

  if (additions.length === 0) {
    additions.push(
      `/* Penyesuaian: ${instruction.replace(/\*\//g, '').slice(0, 80)} */\n.post-body { line-height: 1.75; font-size: 16px; }\n.post-outer { padding: 20px; border-radius: 12px; }`
    );
  }

  const nextCss = [currentCss.trim(), ...additions].filter(Boolean).join('\n\n');
  return {
    css: nextCss,
    explanation: 'CSS tambahan dihasilkan secara lokal berdasarkan instruksi Anda.',
  };
}

export function generateSampleContentOfflineAi(topic: string) {
  const cleanTopic = topic.trim() || 'Teknologi & Blog';
  return {
    blogTitle: `Catatan ${cleanTopic}`,
    blogDescription: `Panduan praktis, ulasan mendalam, dan wawasan terbaru seputar ${cleanTopic}.`,
    authorName: 'Redaksi TemaLoka',
    authorBio: `Mengulas topik ${cleanTopic} secara terstruktur dan mudah dipahami.`,
    navLinks: [
      { label: 'Beranda' },
      { label: cleanTopic, category: cleanTopic },
      { label: 'Tutorial', category: 'Tutorial' },
      { label: 'Ulasan', category: 'Ulasan' },
    ],
    labels: [
      { name: cleanTopic, count: 14 },
      { name: 'Tutorial', count: 9 },
      { name: 'Ulasan', count: 6 },
    ],
    posts: [
      {
        title: `Panduan Lengkap Memulai ${cleanTopic} untuk Pemula`,
        snippet: `Langkah demi langkah memahami fondasi ${cleanTopic} agar lebih cepat berkembang.`,
        bodyHtml: `<p>Memulai proyek di bidang <strong>${cleanTopic}</strong> membutuhkan fondasi yang terukur serta konsistensi jangka panjang.</p><h3>Poin Utama</h3><ul><li>Menentukan fokus pembahasan yang spesifik</li><li>Menjaga struktur artikel tetap ringkas dan terindeks</li></ul>`,
        category: cleanTopic,
        readTime: '5 mnt baca',
        date: '18 Nov 2026',
      },
      {
        title: `Kesalahan Umum saat Mengelola ${cleanTopic} & Cara Menghindarinya`,
        snippet: `Pelajari kesalahan teknis yang sering memperlambat performa dan kualitas konten.`,
        bodyHtml: `<p>Banyak pengelola ${cleanTopic} melewatkan optimasi dasar seperti ukuran gambar dan struktur heading.</p>`,
        category: 'Tutorial',
        readTime: '4 mnt baca',
        date: '15 Nov 2026',
      },
      {
        title: `Rekomendasi Alat Gratis Terbaik untuk Produktivitas ${cleanTopic}`,
        snippet: `Daftar perkakas ringan yang dapat mempercepat alur kerja harian Anda.`,
        bodyHtml: `<p>Pemilihan alat yang tepat membuat pengerjaan ${cleanTopic} jauh lebih efisien bahkan tanpa koneksi internet terus-menerus.</p>`,
        category: 'Ulasan',
        readTime: '6 mnt baca',
        date: '12 Nov 2026',
      },
    ],
  };
}

export function diagnoseXmlOfflineAi(
  parsedInfo: ParsedTemplateInfo,
  xml: string
): AiDiagnosticResult {
  const items: AiDiagnosticItem[] = [];

  items.push({
    category: 'Responsif',
    title: 'Meta Viewport Perangkat',
    detail: parsedInfo.hasViewportMeta
      ? 'Tag meta viewport sudah terpasang dengan benar.'
      : 'Meta viewport tidak ditemukan — tampilan ponsel dapat mengecil paksa.',
    severity: parsedInfo.hasViewportMeta ? 'good' : 'fixable',
  });

  items.push({
    category: 'Struktur',
    title: 'Namespace & Skin Blogger',
    detail:
      parsedInfo.hasBloggerNamespaces && parsedInfo.hasSkin
        ? `Namespace XML Blogger lengkap dan <b:skin> terpasang (${parsedInfo.variables.length} variabel).`
        : 'Pastikan xmlns:b, xmlns:data, serta blok <b:skin> lengkap di dalam template.',
    severity: parsedInfo.hasBloggerNamespaces && parsedInfo.hasSkin ? 'good' : 'warning',
  });

  const hasResponsiveMediaCss = /@media\s*\(\s*max-width/i.test(xml);
  items.push({
    category: 'CSS',
    title: 'Media Query Responsif',
    detail: hasResponsiveMediaCss
      ? 'Media query layar kecil terdeteksi di dalam stylesheet.'
      : 'Media query @media (max-width) belum terdeteksi; disarankan menambahkan CSS responsif.',
    severity: hasResponsiveMediaCss ? 'good' : 'fixable',
  });

  const needsCssFix = !hasResponsiveMediaCss || !parsedInfo.hasViewportMeta;
  return {
    summary: `Audit offline pada "${parsedInfo.templateTitle}": ${parsedInfo.sections.length} section, ${parsedInfo.widgets.length} widget, ${parsedInfo.redundancyReport.unusedCssRules.length} CSS tidak terpakai.`,
    items,
    suggestedCssFix: needsCssFix
      ? 'img, video, iframe { max-width: 100%; height: auto; }\n@media (max-width: 768px) { .main-wrapper, .sidebar-wrapper { width: 100% !important; float: none !important; } }'
      : undefined,
  };
}
