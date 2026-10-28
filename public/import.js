/**
 * خواندن خروجیِ پایگاه‌های دیگر — Reaxys، EndNote، Zotero، Scopus، Excel.
 *
 * همه در مرورگر خوانده می‌شود. ستون‌ها در هر پایگاه نام متفاوتی دارند، پس
 * به‌جای نقشهٔ ثابت، ستون‌ها را از روی نامشان حدس می‌زنیم و نتیجه را پیش از
 * ذخیره نشان می‌دهیم تا خودتان اصلاح کنید.
 */

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const cleanDoi = (s = '') =>
  clean(s).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').replace(/[.,;)\]]+$/, '');

/* ───── RIS — خروجی استاندارد EndNote و Reaxys و Scopus */
export function parseRis(text) {
  const out = [];
  let cur = null, lastTag = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const m = raw.match(/^([A-Z][A-Z0-9])\s{2}-\s?(.*)$/);
    if (m) {
      const [, tag, val] = m;
      lastTag = tag;
      if (tag === 'TY') { cur = { authors: [], keywords: [] }; out.push(cur); continue; }
      if (!cur) { cur = { authors: [], keywords: [] }; out.push(cur); }
      const v = clean(val);
      if (!v) continue;
      if (tag === 'AU' || tag === 'A1' || tag === 'A2') cur.authors.push(v);
      else if (tag === 'TI' || tag === 'T1') cur.title = cur.title || v;
      else if (tag === 'JO' || tag === 'JF' || tag === 'T2' || tag === 'J2') cur.journal = cur.journal || v;
      else if (tag === 'PY' || tag === 'Y1') cur.year = cur.year || (v.match(/\d{4}/) || [])[0];
      else if (tag === 'DO') cur.doi = cur.doi || cleanDoi(v);
      else if (tag === 'AB' || tag === 'N2') cur.abstract = (cur.abstract ? cur.abstract + ' ' : '') + v;
      else if (tag === 'KW') cur.keywords.push(v);
      else if (tag === 'UR' && !cur.doi && /10\.\d{4,9}\//.test(v)) cur.doi = cleanDoi(v);
      else if (tag === 'N1') cur.note = (cur.note ? cur.note + ' · ' : '') + v;
    } else if (cur && lastTag && raw.trim()) {
      // ادامهٔ خط قبلی
      const v = clean(raw);
      if (lastTag === 'AB' || lastTag === 'N2') cur.abstract = (cur.abstract || '') + ' ' + v;
      else if (lastTag === 'TI' || lastTag === 'T1') cur.title = (cur.title || '') + ' ' + v;
    }
  }
  return out.filter((r) => r.title).map(norm);
}

/* ───── BibTeX */
export function parseBibtex(text) {
  const out = [];
  const src = String(text);
  const rx = /@(\w+)\s*\{([^,]*),/g;
  let m;
  while ((m = rx.exec(src))) {
    // بدنهٔ رکورد تا جایی که آکولادها بسته شوند
    let depth = 1, i = rx.lastIndex;
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      i++;
    }
    const body = src.slice(rx.lastIndex, i - 1);
    const rec = { authors: [], keywords: [] };
    const fx = /(\w+)\s*=\s*(\{([\s\S]*?)\}|"([^"]*)"|([^,\n]+))\s*,?/g;
    let f;
    while ((f = fx.exec(body))) {
      const key = f[1].toLowerCase();
      const val = clean((f[3] ?? f[4] ?? f[5] ?? '').replace(/[{}]/g, ''));
      if (!val) continue;
      if (key === 'title') rec.title = val;
      else if (key === 'author') rec.authors = val.split(/\s+and\s+/).map(clean);
      else if (key === 'journal' || key === 'booktitle') rec.journal = val;
      else if (key === 'year') rec.year = (val.match(/\d{4}/) || [])[0];
      else if (key === 'doi') rec.doi = cleanDoi(val);
      else if (key === 'abstract') rec.abstract = val;
      else if (key === 'keywords') rec.keywords = val.split(/[;,]/).map(clean).filter(Boolean);
      else if (key === 'note' || key === 'annote') rec.note = val;
      else if (key === 'url' && !rec.doi && /10\.\d{4,9}\//.test(val)) rec.doi = cleanDoi(val);
    }
    if (rec.title) out.push(norm(rec));
  }
  return out;
}

/* ───── جدول: CSV یا Excel — ستون‌ها را از روی نامشان می‌شناسیم */
const FIELD_HINTS = [
  ['doi', /^doi$|\bdoi\b/i],
  ['title', /^(article\s*)?title$|document title|^ti$|عنوان/i],
  ['journal', /journal|source title|publication|^so$|periodical|مجله/i],
  ['year', /^year$|publication year|^py$|^pub.*date|سال/i],
  ['authors', /author|^au$|نویسند/i],
  ['abstract', /abstract|چکیده/i],
  ['keywords', /keyword|index terms|کلیدواژه/i],
  ['note', /note|comment|یادداشت/i],
];

function headerMap(headers) {
  const map = {};
  headers.forEach((h, i) => {
    const name = clean(h);
    if (!name) return;
    for (const [field, rx] of FIELD_HINTS) {
      if (map[field] === undefined && rx.test(name)) { map[field] = i; return; }
    }
  });
  return map;
}

/** CSV با پشتیبانی از فیلدهای گیومه‌دار و کاما یا نقطه‌ویرگول یا تب. */
export function parseCsv(text) {
  const src = String(text).replace(/^﻿/, '');
  const head = src.slice(0, 2000);
  const sep = [[',', (head.match(/,/g) || []).length],
               [';', (head.match(/;/g) || []).length],
               ['\t', (head.match(/\t/g) || []).length]]
    .sort((a, b) => b[1] - a[1])[0][0];

  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rowsToRecords(rows);
}

export function rowsToRecords(rows) {
  if (rows.length < 2) return [];
  // سرستون ممکن است چند سطر پایین‌تر باشد (Reaxys بالای فایل توضیح می‌گذارد)
  let hi = 0, best = -1;
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const m = headerMap(rows[i].map(clean));
    const n = Object.keys(m).length;
    if (n > best) { best = n; hi = i; }
  }
  const map = headerMap(rows[hi].map(clean));
  if (!map.title && !map.doi) return [];

  const out = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;
    const pick = (k) => (map[k] === undefined ? '' : clean(r[map[k]]));
    const rec = {
      title: pick('title'), doi: cleanDoi(pick('doi')), journal: pick('journal'),
      year: (pick('year').match(/\d{4}/) || [])[0],
      authors: pick('authors').split(/;|\band\b/).map(clean).filter(Boolean),
      abstract: pick('abstract'), note: pick('note'),
      keywords: pick('keywords').split(/[;,]/).map(clean).filter(Boolean),
    };
    if (!rec.title && !rec.doi) continue;
    out.push(norm(rec));
  }
  return out;
}

/* ───── Excel — SheetJS را فقط وقتی لازم شد بار می‌کنیم */
let xlsxLoading = null;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (xlsxLoading) return xlsxLoading;
  xlsxLoading = new Promise((ok, bad) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = () => (window.XLSX ? ok(window.XLSX) : bad(new Error('خوانندهٔ Excel بار نشد')));
    s.onerror = () => bad(new Error('دانلود خوانندهٔ Excel شکست خورد'));
    document.head.appendChild(s);
  });
  return xlsxLoading;
}

export async function parseXlsx(buf) {
  const XLSX = await loadXlsx();
  const wb = XLSX.read(buf, { type: 'array' });
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, defval: '' });
    const recs = rowsToRecords(rows.map((r) => r.map((c) => String(c ?? ''))));
    if (recs.length) return recs;
  }
  return [];
}

function norm(r) {
  const authors = Array.isArray(r.authors) ? r.authors.filter(Boolean) : [];
  return {
    title: clean(r.title),
    doi: r.doi ? cleanDoi(r.doi) : null,
    journal: clean(r.journal) || null,
    year: r.year ? Number(r.year) : null,
    authors: authors.length ? authors.join(', ') : null,
    abstract: clean(r.abstract) || null,
    summary: clean(r.abstract) || null,
    note: clean(r.note) || null,
    tag: (r.keywords || [])[0] || null,
  };
}

/** فایل را بر پایهٔ پسوندش می‌خواند. */
export async function parseFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.ris') || name.endsWith('.nbib') || name.endsWith('.txt')) {
    const t = await file.text();
    const recs = parseRis(t);
    if (recs.length) return { kind: 'RIS', records: recs };
    const b = parseBibtex(t);
    if (b.length) return { kind: 'BibTeX', records: b };
    return { kind: 'RIS', records: [] };
  }
  if (name.endsWith('.bib') || name.endsWith('.bibtex')) {
    return { kind: 'BibTeX', records: parseBibtex(await file.text()) };
  }
  if (name.endsWith('.csv') || name.endsWith('.tsv')) {
    return { kind: 'CSV', records: parseCsv(await file.text()) };
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    return { kind: 'Excel', records: await parseXlsx(await file.arrayBuffer()) };
  }
  throw new Error('فرمت پشتیبانی نمی‌شود — RIS، BibTeX، CSV یا Excel بدهید');
}
