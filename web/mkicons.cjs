// Regenerates web/icons.js. Usage: curl -sLo lucide.js https://unpkg.com/lucide@0.469.0/dist/umd/lucide.js && node web/mkicons.cjs <icon-name>... > web/icons.js
// Builds web/icons.js: only the lucide icons the page uses, plus a tiny createIcons().
const L = require(require('path').resolve('lucide.js'));
const names = process.argv.slice(2);
const out = {};
const pascal = n => n.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase());
for (const n of names) {
  const node = L[pascal(n)];
  if (!node) throw new Error('missing icon ' + n);
  out[n] = node[2].map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('');
}
process.stdout.write(`// Generated from lucide@0.469.0 (ISC) — only the icons this page uses. Regenerate if you add one.
window.lucide = { createIcons() {
  const I = ${JSON.stringify(out)};
  document.querySelectorAll('i[data-lucide]').forEach(el => {
    const n = el.dataset.lucide;
    if (!I[n]) return console.warn('icon not bundled:', n);
    el.outerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="lucide lucide-' + n + (el.className ? ' ' + el.className : '') + '">' + I[n] + '</svg>';
  });
} };
`);
