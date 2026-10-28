/** تولید BibTeX و RIS از رکوردهای کتابخانه، برای وارد کردن در Word و EndNote و Zotero. */

const ascii = (s = '') =>
  String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '').trim();

/** کلید استنادی یکتا: نام‌خانوادگیِ نویسندهٔ اول + سال + واژهٔ اول عنوان. */
function key(p, used) {
  const first = (p.authors || '').split(/,|;| and /)[0].trim().split(/\s+/).pop() || 'anon';
  const word = (ascii(p.title || '').split(/\s+/).find((w) => w.length > 3) || 'paper').toLowerCase();
  let base = (ascii(first).toLowerCase() || 'anon') + (p.year || 'nd') + word;
  base = base.replace(/[^a-z0-9]/g, '') || 'ref';
  let k = base, i = 1;
  while (used.has(k)) k = base + String.fromCharCode(96 + ++i);
  used.add(k);
  return k;
}

const esc = (s = '') => String(s).replace(/[{}]/g, '').replace(/\\/g, '').replace(/\s+/g, ' ').trim();

export function toBibtex(papers) {
  const used = new Set();
  return papers.map((p) => {
    const f = [
      ['title', esc(p.title)],
      ['author', esc((p.authors || '').replace(/,\s*/g, ' and '))],
      ['journal', esc(p.journal)],
      ['year', p.year || ''],
      ['doi', p.doi || ''],
      ['url', p.doi ? 'https://doi.org/' + p.doi : p.oa_url || ''],
      ['abstract', esc(p.abstract || p.summary || '').slice(0, 1500)],
      ['keywords', esc(p.tag || '')],
      ['note', esc(p.note || '')],
    ].filter(([, v]) => v);
    return `@article{${key(p, used)},\n` +
      f.map(([k, v]) => `  ${k} = {${v}}`).join(',\n') + '\n}';
  }).join('\n\n') + '\n';
}

export function toRis(papers) {
  return papers.map((p) => {
    const lines = ['TY  - JOUR'];
    for (const a of (p.authors || '').split(/,\s*/).filter(Boolean).slice(0, 40)) lines.push('AU  - ' + a.trim());
    if (p.title) lines.push('TI  - ' + esc(p.title));
    if (p.journal) lines.push('JO  - ' + esc(p.journal));
    if (p.year) lines.push('PY  - ' + p.year);
    if (p.doi) lines.push('DO  - ' + p.doi);
    if (p.abstract || p.summary) lines.push('AB  - ' + esc(p.abstract || p.summary).slice(0, 4000));
    if (p.tag) lines.push('KW  - ' + esc(p.tag));
    if (p.note) lines.push('N1  - ' + esc(p.note));
    if (p.doi) lines.push('UR  - https://doi.org/' + p.doi);
    else if (p.oa_url) lines.push('UR  - ' + p.oa_url);
    lines.push('ER  - ', '');
    return lines.join('\r\n');
  }).join('\r\n');
}
