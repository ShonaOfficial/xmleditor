import type {
  BloggerTemplatePreset,
  ColorPalettePreset,
  FontOption,
  SampleBlogData,
} from '../types/blogger';
import {
  buildAuthorAvatarSvgUri,
  buildEditorialCoverSvgUri,
} from '../lib/bloggerTemplateEngine';

export const COLOR_PALETTE_PRESETS: ColorPalettePreset[] = [
  {
    id: 'editorial-blue',
    name: 'Editorial Biru',
    palette: {
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
  },
  {
    id: 'emerald-paper',
    name: 'Zamrud Hangat',
    palette: {
      background: '#f5f8f6',
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
  },
  {
    id: 'obsidian-night',
    name: 'Malam Obsidian',
    palette: {
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
  },
  {
    id: 'terracotta-warm',
    name: 'Terakota Klasik',
    palette: {
      background: '#fdf8f5',
      surface: '#ffffff',
      primary: '#c2410c',
      heading: '#431407',
      text: '#3f3f46',
      mutedText: '#71717a',
      link: '#b45309',
      headerBg: '#431407',
      headerText: '#fff7ed',
      border: '#fed7aa',
    },
  },
];

export const FONT_OPTIONS: FontOption[] = [
  { name: 'Fraunces', category: 'serif', vibe: 'Editorial Modern' },
  { name: 'DM Sans', category: 'sans-serif', vibe: 'Bersih & Ringan' },
  { name: 'Plus Jakarta Sans', category: 'sans-serif', vibe: 'Modern Profesional' },
  { name: 'Inter', category: 'sans-serif', vibe: 'Netral & Tajam' },
  { name: 'Lora', category: 'serif', vibe: 'Klasik Nyaman Baca' },
  { name: 'Merriweather', category: 'serif', vibe: 'Majalah Berita' },
  { name: 'JetBrains Mono', category: 'monospace', vibe: 'Kode & Teknis' },
];

export const DEFAULT_SAMPLE_BLOG: SampleBlogData = {
  blogTitle: 'Jurnal Shona Official',
  blogDescription:
    'Catatan desain web, optimasi template Blogger XML, dan panduan produktivitas digital.',
  authorName: 'Shona Official',
  authorBio:
    'Kreator template Blogger Layout v3 ringan, bersih, dan ramah perangkat mobile.',
  authorAvatar: buildAuthorAvatarSvgUri('Shona Official'),
  navLinks: [
    { label: 'Beranda' },
    { label: 'Blogger XML', category: 'Blogger XML' },
    { label: 'Desain UI', category: 'Desain UI' },
    { label: 'SEO & Performa', category: 'SEO & Performa' },
  ],
  labels: [
    { name: 'Blogger XML', count: 14 },
    { name: 'Desain UI', count: 9 },
    { name: 'SEO & Performa', count: 7 },
    { name: 'Produktivitas', count: 5 },
  ],
  posts: [
    {
      id: 'post-1',
      title: 'Panduan Struktur Blogger Layout v3 yang Bersih dan Mudah Dirawat',
      snippet:
        'Pelajari cara menyusun section, widget, dan variabel b:skin agar tema Blogspot Anda tetap ringan dan valid di Studio Editor.',
      bodyHtml:
        '<p>Template Blogger modern dibangun di atas struktur XML yang rapi dengan pemisahan jelas antara <code>&lt;b:skin&gt;</code>, tata letak dashboard <code>&lt;b:template-skin&gt;</code>, dan widget modular.</p><h3>Mengapa Validitas XML Penting?</h3><p>Setiap karakter <code>&amp;</code> di luar CDATA serta atribut boolean wajib mengikuti standar XML 1.0 agar proses simpan tema di Blogger tidak ditolak oleh parser server.</p>',
      author: 'Shona Official',
      date: '18 Nov 2026',
      category: 'Blogger XML',
      readTime: '5 mnt baca',
      imageUrl: buildEditorialCoverSvgUri(
        'Panduan Struktur Blogger Layout v3',
        'Blogger XML',
        0
      ),
      commentsCount: 8,
    },
    {
      id: 'post-2',
      title: 'Tips Mengurangi CSS Mati dan Skrip Duplikat pada Tema Blogspot',
      snippet:
        'Aturan CSS yang tidak pernah dipanggil di markup hanya menambah ukuran XML tanpa dampak visual. Berikut cara mengidentifikasinya.',
      bodyHtml:
        '<p>Menghapus selektor usang dan pustaka eksternal ganda dapat memangkas ukuran unduhan awal secara signifikan serta memperbaiki skor Core Web Vitals.</p>',
      author: 'Shona Official',
      date: '14 Nov 2026',
      category: 'SEO & Performa',
      readTime: '4 mnt baca',
      imageUrl: buildEditorialCoverSvgUri(
        'Optimasi CSS & Skrip Tema Blogspot',
        'SEO & Performa',
        1
      ),
      commentsCount: 5,
    },
    {
      id: 'post-3',
      title: 'Menata Hirarki Tipografi Editorial agar Nyaman Dibaca di Ponsel',
      snippet:
        'Keseimbangan antara ukuran huruf dasar, tinggi baris, dan rasio kontras warna sangat menentukan betah tidaknya pengunjung membaca artikel.',
      bodyHtml:
        '<p>Gunakan ukuran huruf minimal 16px pada badan artikel dengan tinggi baris 1.65 agar mata pembaca tidak cepat lelah di layar sempit.</p>',
      author: 'Shona Official',
      date: '09 Nov 2026',
      category: 'Desain UI',
      readTime: '4 mnt baca',
      imageUrl: buildEditorialCoverSvgUri(
        'Tipografi Editorial Responsif Mobile',
        'Desain UI',
        2
      ),
      commentsCount: 3,
    },
    {
      id: 'post-4',
      title: 'Strategi Navigasi Label dan Widget Sidebar Tanpa Membuat Layout Penuh',
      snippet:
        'Susun widget PopularPosts, Label, dan kotak pencarian secara proporsional agar halaman utama tetap rapi di desktop maupun HP.',
      bodyHtml:
        '<p>Sidebar yang ringkas membantu pengunjung menemukan topik populer lebih cepat tanpa mengganggu fokus baca pada kolom utama.</p>',
      author: 'Shona Official',
      date: '04 Nov 2026',
      category: 'Produktivitas',
      readTime: '3 mnt baca',
      imageUrl: buildEditorialCoverSvgUri(
        'Navigasi Label & Tata Letak Sidebar',
        'Produktivitas',
        3
      ),
      commentsCount: 2,
    },
  ],
};

const SHONA_EDITORIAL_XML = `<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE html>
<html b:css='false' b:defaultwidgetversion='2' b:layoutsVersion='3' b:responsive='true' xmlns='http://www.w3.org/1999/xhtml' xmlns:b='http://www.google.com/2005/gml/b' xmlns:data='http://www.google.com/2005/gml/data' xmlns:expr='http://www.google.com/2005/gml/expr'>
<head>
  <meta charset='UTF-8'/>
  <meta content='width=device-width, initial-scale=1' name='viewport'/>
  <title><data:blog.pageTitle/></title>
  <b:include data='blog' name='all-head-content'/>
  <link href='https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&amp;family=Fraunces:wght@600;700&amp;display=swap' rel='stylesheet'/>
  <b:skin><![CDATA[/*
-----------------------------------------------
Blogger Template Style
Template Name: Shona Official
Version: 1.2.0
Author: Shona Official
URL: https://www.youtube.com/@ShonaOfficial
Description: Tema editorial ringan berbasis Blogger Layout v3.
----------------------------------------------- */
<Group description="Warna Utama">
  <Variable name="body.background" description="Latar Belakang" type="color" default="#f8fafc" value="#f8fafc"/>
  <Variable name="body.text.color" description="Warna Teks" type="color" default="#334155" value="#334155"/>
  <Variable name="keycolor" description="Warna Aksen" type="color" default="#2563eb" value="#2563eb"/>
</Group>
<Group description="Tipografi">
  <Variable name="body.font" description="Font Paragraf" type="font" default="normal 400 16px 'DM Sans', sans-serif" value="normal 400 16px 'DM Sans', sans-serif"/>
  <Variable name="heading.font" description="Font Judul" type="font" default="normal 700 28px 'Fraunces', serif" value="normal 700 28px 'Fraunces', serif"/>
</Group>
:root {
  --bg: $(body.background);
  --surface: #ffffff;
  --text: $(body.text.color);
  --accent: $(keycolor);
  --border: #e2e8f0;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: $(body.font);
  line-height: 1.65;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.site-shell { max-width: 1140px; margin: 0 auto; padding: 0 20px; }
.header-outer {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  padding: 20px 0;
}
.Header h1, .Header .title {
  margin: 0;
  font: $(heading.font);
  color: #0f172a;
}
.Header .description { margin: 6px 0 0; font-size: 14px; color: #64748b; }
.nav-bar {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.PageList ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
}
.PageList li a {
  display: inline-block;
  padding: 12px 0;
  font-size: 14px;
  font-weight: 500;
  color: #334155;
}
.PageList li.selected a { color: var(--accent); font-weight: 700; }
.layout-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 28px;
  padding: 28px 0;
}
.post-outer {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 22px;
  margin-bottom: 20px;
}
.post-title {
  margin: 0 0 10px;
  font-family: 'Fraunces', serif;
  font-size: 22px;
  line-height: 1.3;
  color: #0f172a;
}
.post-meta { font-size: 12px; color: #64748b; margin-bottom: 12px; }
.post-thumb { width: 100%; border-radius: 8px; margin-bottom: 14px; display: block; }
.sidebar-container .widget {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px;
  margin-bottom: 20px;
}
.sidebar-container .widget h2 {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
}
.footer-outer {
  background: var(--surface);
  border-top: 1px solid var(--border);
  padding: 20px 0;
  text-align: center;
  font-size: 13px;
  color: #64748b;
}
@media (max-width: 860px) {
  .layout-grid { grid-template-columns: 1fr; }
}
]]></b:skin>
  <b:template-skin><![CDATA[
body#layout .site-shell { width: 100%; }
body#layout .layout-grid { display: flex; gap: 16px; }
body#layout .main-wrapper { flex: 1; }
body#layout .sidebar-container { width: 300px; }
]]></b:template-skin>
</head>
<body>
  <header class='header-outer'>
    <div class='site-shell'>
      <b:section class='header' id='header' maxwidgets='1' showaddelement='no'>
        <b:widget id='Header1' locked='true' title='Jurnal Shona Official (Header)' type='Header' version='2' visible='true'>
          <b:includable id='main'>
            <h1 class='title'><data:title/></h1>
            <p class='description'><data:description/></p>
          </b:includable>
        </b:widget>
      </b:section>
    </div>
  </header>
  <nav class='nav-bar'>
    <div class='site-shell'>
      <b:section class='crosscol' id='crosscol' maxwidgets='1' showaddelement='yes'>
        <b:widget id='PageList1' locked='false' title='Menu Navigasi' type='PageList' version='2' visible='true'>
          <b:includable id='main'/>
        </b:widget>
      </b:section>
    </div>
  </nav>
  <div class='site-shell'>
    <div class='layout-grid'>
      <main class='main-wrapper'>
        <b:section class='main' id='main' maxwidgets='2' showaddelement='yes'>
          <b:widget id='Blog1' locked='true' title='Postingan Blog' type='Blog' version='2' visible='true'>
            <b:includable id='main'/>
          </b:widget>
        </b:section>
      </main>
      <aside class='sidebar-container'>
        <b:section class='sidebar' id='sidebar' showaddelement='yes'>
          <b:widget id='BlogSearch1' locked='false' title='Cari Artikel' type='BlogSearch' version='2' visible='true'>
            <b:includable id='main'/>
          </b:widget>
          <b:widget id='PopularPosts1' locked='false' title='Artikel Populer' type='PopularPosts' version='2' visible='true'>
            <b:includable id='main'/>
          </b:widget>
          <b:widget id='Label1' locked='false' title='Kategori' type='Label' version='2' visible='true'>
            <b:includable id='main'/>
          </b:widget>
        </b:section>
      </aside>
    </div>
  </div>
  <footer class='footer-outer'>
    <div class='site-shell'>
      <b:section class='footer' id='footer' maxwidgets='2' showaddelement='yes'>
        <b:widget id='Attribution1' locked='false' title='' type='Attribution' version='2' visible='true'>
          <b:includable id='main'/>
        </b:widget>
      </b:section>
    </div>
  </footer>
</body>
</html>`;

const MINIMAL_ZINE_XML = `<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE html>
<html b:css='false' b:defaultwidgetversion='2' b:layoutsVersion='3' b:responsive='true' xmlns='http://www.w3.org/1999/xhtml' xmlns:b='http://www.google.com/2005/gml/b' xmlns:data='http://www.google.com/2005/gml/data' xmlns:expr='http://www.google.com/2005/gml/expr'>
<head>
  <meta charset='UTF-8'/>
  <meta content='width=device-width, initial-scale=1' name='viewport'/>
  <title><data:blog.pageTitle/></title>
  <b:include data='blog' name='all-head-content'/>
  <b:skin><![CDATA[/*
-----------------------------------------------
Blogger Template Style
Template Name: Zine Satu Kolom
Version: 1.0.0
Author: TemaLoka Presets
Description: Tata letak fokus baca satu kolom tanpa sidebar.
----------------------------------------------- */
<Variable name="body.background" description="Background" type="color" default="#ffffff" value="#ffffff"/>
<Variable name="keycolor" description="Accent" type="color" default="#059669" value="#059669"/>
body { margin: 0; background: $(body.background); color: #1e293b; font-family: system-ui, sans-serif; line-height: 1.7; }
a { color: $(keycolor); text-decoration: none; }
.wrap { max-width: 780px; margin: 0 auto; padding: 0 20px; }
.header-outer { padding: 32px 0 20px; border-bottom: 1px solid #e2e8f0; }
.Header h1 { margin: 0; font-size: 28px; color: #0f172a; }
.post-outer { padding: 26px 0; border-bottom: 1px solid #e2e8f0; }
.post-title { margin: 0 0 8px; font-size: 22px; color: #0f172a; }
.post-meta { font-size: 12px; color: #64748b; margin-bottom: 10px; }
.footer-outer { padding: 28px 0; font-size: 13px; color: #64748b; text-align: center; }
]]></b:skin>
</head>
<body>
  <header class='header-outer'>
    <div class='wrap'>
      <b:section class='header' id='header' maxwidgets='1' showaddelement='no'>
        <b:widget id='Header1' locked='true' title='Zine Satu Kolom' type='Header' version='2' visible='true'>
          <b:includable id='main'/>
        </b:widget>
      </b:section>
    </div>
  </header>
  <main class='wrap'>
    <b:section class='main' id='main' maxwidgets='2' showaddelement='yes'>
      <b:widget id='Blog1' locked='true' title='Artikel' type='Blog' version='2' visible='true'>
        <b:includable id='main'/>
      </b:widget>
    </b:section>
  </main>
  <footer class='footer-outer'>
    <div class='wrap'>
      <b:section class='footer' id='footer' maxwidgets='1' showaddelement='yes'>
        <b:widget id='Attribution1' locked='false' title='' type='Attribution' version='2' visible='true'>
          <b:includable id='main'/>
        </b:widget>
      </b:section>
    </div>
  </footer>
</body>
</html>`;

export const TEMPLATE_PRESETS: BloggerTemplatePreset[] = [
  {
    id: 'shona-editorial',
    name: 'Shona Official Editorial',
    category: 'Editorial',
    description:
      'Template Blogger Layout v3 dua kolom responsif lengkap dengan variabel warna, font, navigasi, dan sidebar widget.',
    xml: SHONA_EDITORIAL_XML,
  },
  {
    id: 'minimal-zine',
    name: 'Zine Satu Kolom',
    category: 'Minimalis',
    description:
      'Desain baca satu kolom ultra-ringan tanpa distraksi untuk blog pribadi dan esai panjang.',
    xml: MINIMAL_ZINE_XML,
  },
];
