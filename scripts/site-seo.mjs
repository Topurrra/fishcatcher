// One-shot site build/enhance for SEO + AEO + GEO. Assembles the new content
// pages from body fragments and enhances the existing pages with canonical,
// Open Graph, JSON-LD, clean-URL hrefs, and a CSP-clean theme init. Output is
// plain static HTML (no build step needed to host).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(root, 'site');
const FRAG = process.env.FRAG_DIR || join(root, '_frag'); // fragments dir
const BASE = 'https://fishcatcher.dev';
const OG = BASE + '/assets/og.jpg';
const DATE = '2026-08-11';
const DATE_HUMAN = '11 August 2026';

const GH = 'https://github.com/Topurrra/fishcatcher';
const GH_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.8 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11 11 0 0 1 6 0C17 4.6 18 4.9 18 4.9c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.5-2.7 5.5-5.3 5.8.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z"/></svg>';
const INSTALL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 11 5 4 5-4"/><path d="M5 21h14"/></svg>';
const SUN = '<svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/></svg>';
const CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l2.5 1.5"/></svg>';

const NAV = `<nav class="site-nav">
  <div class="wrap">
    <a class="brand" href="/"><span class="wm"><span class="wm-swap"><span class="wm-fish">Fish</span><span class="wm-phish" data-text="Phish">Phish</span></span> Catcher</span></a>
    <div class="nav-links">
      <a href="/">Home</a>
      <a href="/docs">Docs</a>
      <a class="icon-btn" href="${GH}" aria-label="GitHub" title="GitHub">${GH_SVG}</a>
      <a class="icon-btn" href="/#install" aria-label="Install Fish Catcher" title="Install Fish Catcher">${INSTALL_SVG}</a>
      <button class="theme-toggle" aria-label="Switch light or dark theme">${SUN}${MOON}</button>
    </div>
  </div>
</nav>`;

const FOOTER = `<footer class="site-foot">
  <div class="wrap">
    <div class="about">
      <a class="brand" href="/"><span class="wm"><span class="wm-swap"><span class="wm-fish">Fish</span><span class="wm-phish" data-text="Phish">Phish</span></span> Catcher</span></a>
      <p>Free, open-source phishing protection for people who are not security experts.</p>
      <p class="foot-note">MIT licensed. No account, no tracking, nothing leaves your browser.</p>
    </div>
    <div><h4>Product</h4><ul><li><a href="/#how">How it works</a></li><li><a href="/#install">Install</a></li><li><a href="/privacy">Privacy</a></li></ul></div>
    <div><h4>Learn</h4><ul><li><a href="/learn">Lessons</a></li><li><a href="/docs">Docs</a></li><li><a href="/transparency">Transparency</a></li></ul></div>
    <div><h4>Open source</h4><ul><li><a href="${GH}">GitHub</a></li><li><a href="https://github.com/Topurrra/fishcatcher-registry">Threat registry</a></li><li><a href="${GH}/blob/main/LICENSE">MIT license</a></li></ul></div>
  </div>
</footer>`;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
const crumb = (arr) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: arr.map((x, i) => ({ '@type': 'ListItem', position: i + 1, name: x.name, item: BASE + x.path })) });

function head({ url, title, description, ogType = 'website', jsonld = [], docsCss = false }) {
  const canon = BASE + url;
  return `<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canon}">
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="Fish Catcher">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canon}">
<meta property="og:image" content="${OG}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${OG}">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/assets/fonts/inter.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/jetbrains-mono.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/site.css">${docsCss ? '\n<link rel="stylesheet" href="/assets/docs.css">' : ''}
<script src="/assets/theme-init.js"></script>
${jsonld.map(ld).join('\n')}
</head>`;
}

function articlePage({ url, title, description, h1, pill, breadcrumb, bodyHtml, jsonld, backHref = '/learn', backLabel = 'Learn', backText = 'All lessons' }) {
  const bc = breadcrumb.map((c, i) => i < breadcrumb.length - 1 ? `<a href="${c.path}">${c.name}</a>` : c.name).join(' / ');
  return `<!doctype html>
<html lang="en">
${head({ url, title, description, ogType: 'article', jsonld, docsCss: true })}
<body>

${NAV}

<main class="wrap doc-article">
  <article class="docs-main">
    <div class="breadcrumb">${bc}</div>
    <h1>${esc(h1)}</h1>
    <div class="meta-row">
      <span>${CLOCK} Updated <time datetime="${DATE}">${DATE_HUMAN}</time></span>
      <span class="sep"></span>
      <a href="${GH}">${GH_SVG} View source</a>
    </div>
    <div class="rule"><span class="line"></span><span class="pill-mono">${pill}</span><span class="line"></span></div>

${bodyHtml}

    <div class="prevnext">
      <a href="${backHref}"><small>${backLabel}</small>${backText}</a>
      <a class="nx" href="/"><small>Home</small>Back to the overview</a>
    </div>
  </article>
</main>

${FOOTER}

<script src="/assets/theme.js"></script>
</body>
</html>
`;
}

function readFrag(name) {
  const raw = readFileSync(join(FRAG, name + '.html'), 'utf8');
  const m = raw.match(/^<!--META\s+title="([^"]*)"\s+desc="([^"]*)"\s+updated="([^"]*)"-->/);
  const meta = m ? { title: m[1], desc: m[2] } : { title: name, desc: '' };
  const body = raw.replace(/^<!--META[^]*?-->\s*/, '').trim();
  return { meta, body };
}

const built = [];

// ---- Learn articles ----
const LEARN = [
  { slug: 'qr-code-phishing', h1: 'How QR code phishing (quishing) scams work' },
  { slug: 'device-code-phishing', h1: 'What is a device-code phishing attack?' },
  { slug: 'aitm-attack', h1: 'What is an AiTM (adversary-in-the-middle) attack?' },
  { slug: 'lookalike-domain', h1: 'How to spot a lookalike domain' },
  { slug: 'fake-login-page', h1: 'How to spot a fake login page' },
  { slug: 'disguised-download', h1: 'How to spot a disguised download' },
  { slug: 'golden-rules', h1: 'Golden rules for avoiding phishing' }
];
for (const a of LEARN) {
  const { meta, body } = readFrag(a.slug);
  const url = '/' + a.slug;
  const jsonld = [
    { '@context': 'https://schema.org', '@type': 'TechArticle', headline: meta.title, description: meta.desc, url: BASE + url, mainEntityOfPage: BASE + url, datePublished: DATE, dateModified: DATE, inLanguage: 'en', author: { '@type': 'Organization', name: 'Fish Catcher' }, publisher: { '@type': 'Organization', name: 'Fish Catcher', url: BASE } },
    crumb([{ name: 'Home', path: '/' }, { name: 'Learn', path: '/learn' }, { name: a.h1, path: url }])
  ];
  const html = articlePage({ url, title: meta.title, description: meta.desc, h1: a.h1, pill: 'Stay safe', breadcrumb: [{ name: 'Home', path: '/' }, { name: 'Learn', path: '/learn' }, { name: a.h1 }], bodyHtml: body, jsonld });
  writeFileSync(join(SITE, a.slug + '.html'), html);
  built.push(a.slug);
}

// ---- Comparison pages ----
const COMPARE = [
  { file: 'fishcatcher-vs-netcraft', frag: 'vs-netcraft', h1: 'Fish Catcher vs Netcraft' },
  { file: 'fishcatcher-vs-bitdefender-trafficlight', frag: 'vs-bitdefender-trafficlight', h1: 'Fish Catcher vs Bitdefender TrafficLight' },
  { file: 'fishcatcher-vs-safe-browsing', frag: 'vs-safe-browsing', h1: 'Fish Catcher vs built-in Safe Browsing' }
];
for (const c of COMPARE) {
  const { meta, body } = readFrag(c.frag);
  const url = '/' + c.file;
  const jsonld = [
    { '@context': 'https://schema.org', '@type': 'Article', headline: meta.title, description: meta.desc, url: BASE + url, mainEntityOfPage: BASE + url, datePublished: DATE, dateModified: DATE, inLanguage: 'en', author: { '@type': 'Organization', name: 'Fish Catcher' }, publisher: { '@type': 'Organization', name: 'Fish Catcher', url: BASE } },
    crumb([{ name: 'Home', path: '/' }, { name: c.h1, path: url }])
  ];
  const html = articlePage({ url, title: meta.title, description: meta.desc, h1: c.h1, pill: 'Honest comparison', breadcrumb: [{ name: 'Home', path: '/' }, { name: c.h1 }], bodyHtml: body, jsonld, backHref: '/docs', backLabel: 'Docs', backText: 'Documentation' });
  writeFileSync(join(SITE, c.file + '.html'), html);
  built.push(c.file);
}

// ---- Learn hub (rebuilt) ----
{
  const cards = LEARN.map((a) => { const { meta } = readFrag(a.slug); return { slug: a.slug, h1: a.h1, desc: meta.desc }; });
  const cardHtml = cards.map((c) => `      <a href="/${c.slug}"><b>${esc(c.h1)}</b><span>${esc(c.desc.split('.')[0])}.</span></a>`).join('\n');
  const url = '/learn';
  const title = 'Learn to Spot Phishing: QR, Login, Domain & More';
  const desc = 'Short, plain-language lessons on how phishing works and how to spot it: QR code scams, fake login pages, lookalike domains, AiTM, and more.';
  const jsonld = [
    crumb([{ name: 'Home', path: '/' }, { name: 'Learn', path: '/learn' }]),
    { '@context': 'https://schema.org', '@type': 'ItemList', name: 'Phishing lessons', itemListElement: cards.map((c, i) => ({ '@type': 'ListItem', position: i + 1, url: BASE + '/' + c.slug, name: c.h1 })) }
  ];
  const body = `    <p class="lead-p">Phishing uses the same handful of tricks again and again. Once you can name them, they are much easier to catch. Each lesson is short, plain, and free.</p>
    <h2 id="lessons">The lessons</h2>
    <div class="article-cards">
${cardHtml}
    </div>
    <p>Fish Catcher puts these checks in your browser and warns you in plain language when a site looks like one of these tricks. It never blocks a page; you always decide.</p>`;
  const html = articlePage({ url, title, description: desc, h1: 'Learn to spot a scam', pill: 'Stay safe', breadcrumb: [{ name: 'Home', path: '/' }, { name: 'Learn' }], bodyHtml: body, jsonld, backHref: '/', backLabel: 'Home', backText: 'Back to the overview' });
  writeFileSync(join(SITE, 'learn.html'), html);
  built.push('learn (hub)');
}

// ---- Benchmark page ----
{
  const url = '/benchmark';
  const title = 'Phishing Detection False-Positive Benchmark (0.005%)';
  const desc = 'How accurate is Fish Catcher? Measured false-positive rate of 0.005% over 100,000 legitimate domains, with a reproducible method and version history.';
  const jsonld = [
    { '@context': 'https://schema.org', '@type': 'Dataset', name: 'Fish Catcher false-positive benchmark', description: 'False-positive rate of the Fish Catcher passive URL engine over 100,000 legitimate domains from the Majestic Million.', url: BASE + url, creator: { '@type': 'Organization', name: 'Fish Catcher' }, license: 'https://opensource.org/licenses/MIT', dateModified: DATE, isAccessibleForFree: true, measurementTechnique: 'Passive URL analysis, counting high and critical warnings', variableMeasured: 'phishing false-positive rate' },
    crumb([{ name: 'Home', path: '/' }, { name: 'Transparency', path: '/transparency' }, { name: 'Benchmark', path: url }])
  ];
  const body = `    <p class="lead-p">A false positive is a warning shown on a site that is actually fine, and the false-positive rate is the share of legitimate sites a detector wrongly warns about.</p>
    <p>A warning tool is only useful if it stays quiet on normal sites. So we measure how often Fish Catcher cries wolf, publish the number, and make it reproducible. If it is not measured, it is just a claim.</p>

    <h2 id="method">Method</h2>
    <p>We run the address-only part of the Fish Catcher engine, with no page-content signals, over the Majestic Million, a public list of the most-linked websites. These are treated as known-legitimate. We count how many the engine would warn about at <b>high</b> or <b>critical</b>, the two levels that actually alarm a user, and divide by the total scanned. Lower is better.</p>
    <ul>
      <li>Corpus: Majestic Million, first 100,000 domains.</li>
      <li>Engine: the shipped passive URL analyzer (no page content, no cloud lookups).</li>
      <li>Metric: (high + critical warnings) / total domains scanned.</li>
    </ul>

    <h2 id="result">Latest result</h2>
    <p>Latest run, <time datetime="${DATE}">${DATE_HUMAN}</time>, over 100,000 legitimate sites:</p>
    <div class="table-wrap">
      <table>
        <thead><tr><th scope="col">Measure</th><th scope="col">Value</th></tr></thead>
        <tbody>
          <tr><td>Warnings at high</td><td>5</td></tr>
          <tr><td>Warnings at critical</td><td>0</td></tr>
          <tr><td>Rate</td><td>0.005% (5 in 100,000)</td></tr>
        </tbody>
      </table>
    </div>
    <p>The five flagged sites were all very short, digit-heavy names on high-abuse endings, like <code>hy315.cc</code>. The offending domains are printed by the audit, so the number is auditable.</p>

    <h2 id="history">Version history</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th scope="col">Date</th><th scope="col">Corpus</th><th scope="col">High</th><th scope="col">Critical</th><th scope="col">Rate</th></tr></thead>
        <tbody>
          <tr><td>2026-08-11</td><td>Majestic Million, 100,000</td><td>5</td><td>0</td><td>0.005%</td></tr>
        </tbody>
      </table>
    </div>
    <p>We plan to rerun this monthly and add a row each time, so the trend stays public.</p>

    <h2 id="reproduce">Reproduce it</h2>
    <p>Clone the source repository and run the audit. It prints every domain it flagged, so you can check the number yourself:</p>
    <pre data-lang="bash"><code>node scripts/fp-audit.mjs</code></pre>
    <p>Add <code>--selftest</code> to check the harness on a small built-in set, <code>--limit N</code> to scan fewer domains, or <code>--cache path.csv</code> to reuse an already-downloaded corpus.</p>`;
  const html = articlePage({ url, title, description: desc, h1: 'False-positive benchmark', pill: 'Show the numbers', breadcrumb: [{ name: 'Home', path: '/' }, { name: 'Transparency', path: '/transparency' }, { name: 'Benchmark' }], bodyHtml: body, jsonld, backHref: '/transparency', backLabel: 'Transparency', backText: 'Transparency' });
  writeFileSync(join(SITE, 'benchmark.html'), html);
  built.push('benchmark');
}

// ---- Enhance existing pages (index, docs, privacy, transparency) ----
const APP_DESC = 'Fish Catcher warns you, in plain language, when a website looks like phishing or a scam. Free, open source, and on-device by default.';
const softwareLd = { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'Fish Catcher', applicationCategory: 'BrowserApplication', operatingSystem: 'Chrome, Brave, Edge, Opera, Firefox', description: APP_DESC, url: BASE + '/', softwareVersion: '1.0.0', license: 'https://opensource.org/licenses/MIT', isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, publisher: { '@type': 'Organization', name: 'Fish Catcher', url: BASE } };
const orgLd = { '@context': 'https://schema.org', '@type': 'Organization', name: 'Fish Catcher', url: BASE, logo: OG, sameAs: [GH, 'https://github.com/Topurrra/fishcatcher-registry'] };
const siteLd = { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Fish Catcher', url: BASE };
const docsFaq = [
  ['Does it slow down my browsing?', 'No. The checks are small string operations that run on your device in a fraction of a second.'],
  ['Will it block me from a site?', 'Never. Fish Catcher only warns. You always decide what to do.'],
  ['Does it send my browsing anywhere?', 'No. See the privacy policy for exactly what the optional online features send.'],
  ['It flagged a site I trust. What now?', 'Open the panel and choose Trust this site. It stops being flagged, and you can undo it in Settings.']
];
const faqLd = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: docsFaq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) };

const ENHANCE = [
  { file: 'index.html', url: '/', title: 'Fish Catcher: Free Phishing Detection Browser Extension', description: 'A free, open-source browser extension that warns you in plain language when a website looks like phishing or a scam. On-device and private by default.', ogType: 'website', jsonld: [softwareLd, orgLd, siteLd] },
  { file: 'docs.html', url: '/docs', title: 'Fish Catcher Docs: Install, Settings & Risk Levels', description: 'How to install and use Fish Catcher: what it checks, the green to red risk levels, settings including Google Safe Browsing, automatic updates, and building from source.', ogType: 'website', jsonld: [faqLd, crumb([{ name: 'Home', path: '/' }, { name: 'Docs', path: '/docs' }])] },
  { file: 'privacy.html', url: '/privacy', title: 'Fish Catcher Privacy: On-Device, No Tracking, No Server', description: 'Fish Catcher does its checks on your device. No account, no tracking, and nothing about the pages you visit leaves your browser by default. Optional features are off until you turn them on.', ogType: 'website', jsonld: [crumb([{ name: 'Home', path: '/' }, { name: 'Privacy', path: '/privacy' }])] },
  { file: 'transparency.html', url: '/transparency', title: 'Fish Catcher Transparency: False-Positive Rate & Tests', description: 'How Fish Catcher measures its false-positive rate (0.005% over 100,000 domains), what it detects, and how to reproduce the numbers yourself.', ogType: 'website', jsonld: [crumb([{ name: 'Home', path: '/' }, { name: 'Transparency', path: '/transparency' }])] }
];

function migrate(html) {
  return html
    .replace(/ onclick="fcToggleTheme\(\)"/g, '')
    .replace(/href="index\.html"/g, 'href="/"')
    .replace(/href="index\.html(#[a-z0-9_-]*)"/g, 'href="/$1"')
    .replace(/href="([a-z0-9_-]+)\.html(#[a-z0-9_-]*)?"/g, 'href="/$1$2"')
    .replace(/href="assets\//g, 'href="/assets/')
    .replace(/src="assets\//g, 'src="/assets/');
}

for (const p of ENHANCE) {
  let html = readFileSync(join(SITE, p.file), 'utf8');
  // title + description
  html = html.replace(/<title>[^]*?<\/title>/, `<title>${esc(p.title)}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(p.description)}">`);
  // remove the inline no-flash theme script (replaced by /assets/theme-init.js below)
  html = html.replace(/<script>\(function\(\)\{[^]*?fc-theme[^]*?<\/script>\s*/, '');
  // migrate hrefs, strip onclick, absolutise assets
  html = migrate(html);
  // build the SEO block and inject before </head>
  const canon = BASE + p.url;
  const seo = `<link rel="canonical" href="${canon}">
<meta property="og:type" content="${p.ogType}">
<meta property="og:site_name" content="Fish Catcher">
<meta property="og:title" content="${esc(p.title)}">
<meta property="og:description" content="${esc(p.description)}">
<meta property="og:url" content="${canon}">
<meta property="og:image" content="${OG}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(p.title)}">
<meta name="twitter:description" content="${esc(p.description)}">
<meta name="twitter:image" content="${OG}">
<link rel="preload" href="/assets/fonts/inter.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/jetbrains-mono.woff2" as="font" type="font/woff2" crossorigin>
<script src="/assets/theme-init.js"></script>
${p.jsonld.map(ld).join('\n')}
</head>`;
  html = html.replace('</head>', seo);
  writeFileSync(join(SITE, p.file), html);
  built.push(p.file + ' (enhanced)');
}

console.log('Built/enhanced:\n- ' + built.join('\n- '));
