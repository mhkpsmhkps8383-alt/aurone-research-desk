/**
 * جست‌وجوی هم‌زمان در چند پایگاه آزاد و ادغام نتایج.
 *
 * چرا چند پایگاه: هیچ‌کدام کامل نیستند. برای «aurone antioxidant» فقط دو
 * نتیجه از ده نتیجهٔ برترِ Europe PMC و OpenAlex مشترک بود. Europe PMC
 * زیست‌پزشکی را عمیق پوشش می‌دهد ولی مجله‌های شیمی محض را کمتر دارد؛
 * OpenAlex همهٔ رشته‌ها را دارد؛ Crossref تازه‌ترین DOIها را زودتر ثبت می‌کند.
 *
 * OpenAlex و Crossref از مرورگر خوانده می‌شوند (سهمیهٔ بی‌کلیدشان بر پایهٔ
 * آی‌پی است و آی‌پی سرورِ رایگان مشترک است)، Europe PMC از سرور خودمان.
 */

const cleanDoi = (s = '') =>
  String(s).trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '')
    .replace(/[.,;)\]]+$/, '').toLowerCase();

const normTitle = (s = '') =>
  String(s).toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9؀-ۿ]+/g, ' ').trim();

async function getJson(url, ms = 14000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (r.status === 429) throw new Error('سهمیهٔ امروز این پایگاه روی شبکهٔ شما تمام شده');
    if (!r.ok) throw new Error('پاسخ نداد (' + r.status + ')');
    return await r.json();
  } finally { clearTimeout(t); }
}

/* ───── OpenAlex: بیشترین پوشش، همهٔ رشته‌ها */
function deinvert(idx) {
  if (!idx) return null;
  const slots = [];
  for (const [w, ps] of Object.entries(idx)) for (const p of ps) slots[p] = w;
  const s = slots.filter(Boolean).join(' ').trim();
  return s.length > 40 ? s : null;
}

async function fromOpenAlex(query, { page = 1, years = '', broad = false }) {
  const filters = [];
  if (!broad) filters.push('title_and_abstract.search:' + query.replace(/[,|]/g, ' '));
  if (years) filters.push('from_publication_date:' + years + '-01-01');
  const q = new URLSearchParams({
    per_page: '25', page: String(page), sort: 'cited_by_count:desc',
    select: 'id,doi,display_name,publication_year,cited_by_count,authorships,primary_location,best_oa_location,abstract_inverted_index,type',
  });
  if (filters.length) q.set('filter', filters.join(','));
  if (broad) q.set('search', query);
  const j = await getJson('https://api.openalex.org/works?' + q);
  return (j.results || []).map((w) => {
    const loc = w.best_oa_location || {};
    return {
      source: 'OpenAlex',
      doi: cleanDoi(w.doi || '') || null,
      title: w.display_name || '',
      year: w.publication_year || null,
      citations: w.cited_by_count ?? null,
      authors: (w.authorships || []).slice(0, 10).map((a) => a.author?.display_name).filter(Boolean).join(', '),
      journal: w.primary_location?.source?.display_name || null,
      abstract: deinvert(w.abstract_inverted_index),
      oa_url: loc.pdf_url || (loc.is_oa ? loc.landing_page_url : null) || null,
      kind: w.type || null,
    };
  });
}

/* ───── Crossref: تازه‌ترین DOIها، همهٔ ناشران */
async function fromCrossref(query, { page = 1, years = '' }) {
  const q = new URLSearchParams({
    'query.bibliographic': query, rows: '25', offset: String((page - 1) * 25), sort: 'relevance',
    select: 'DOI,title,container-title,issued,author,abstract,is-referenced-by-count,type,updated-by',
  });
  if (years) q.set('filter', 'from-pub-date:' + years + '-01-01');
  const j = await getJson('https://api.crossref.org/works?' + q);
  return (j.message?.items || []).map((m) => ({
    source: 'Crossref',
    doi: cleanDoi(m.DOI || '') || null,
    title: (Array.isArray(m.title) ? m.title[0] : m.title) || '',
    year: m.issued?.['date-parts']?.[0]?.[0] || null,
    citations: m['is-referenced-by-count'] ?? null,
    authors: (m.author || []).slice(0, 10).map((a) => [a.given, a.family].filter(Boolean).join(' ')).join(', '),
    journal: (m['container-title'] || [])[0] || null,
    abstract: m.abstract ? m.abstract.replace(/<[^>]+>/g, '').trim() : null,
    oa_url: null,
    kind: m.type || null,
    flags: [...new Set((m['updated-by'] || []).map((u) => u.type).filter(Boolean))],
  }));
}

/* ───── Europe PMC: از سرور خودمان، چون آنجا محدودیتی نخورده‌ایم */
async function fromEuropePmc(query, { page = 1, years = '', exact = false }) {
  // Europe PMC گیومه را می‌فهمد؛ OpenAlex نمی‌فهمد و با آن صفر نتیجه می‌دهد
  const p = new URLSearchParams({ q: exact ? '"' + query + '"' : query, page: String(page) });
  if (years) p.set('years', years);
  const j = await getJson('/api/scholar/search?' + p);
  if (j.error) throw new Error(j.error);
  return (j.results || []).map((r) => ({ ...r, source: 'Europe PMC', kind: r.kind || null }));
}

export const SOURCES = [
  { key: 'openalex', label: 'OpenAlex', note: 'بیشترین پوشش، همهٔ رشته‌ها', run: fromOpenAlex },
  { key: 'europepmc', label: 'Europe PMC', note: 'کل PubMed، با چکیده و متن رایگان', run: fromEuropePmc },
  { key: 'crossref', label: 'Crossref', note: 'تازه‌ترین DOIها از همهٔ ناشران', run: fromCrossref },
];

/** رکوردِ غنی‌تر برنده است؛ هر فیلدِ خالی از منبع بعدی پر می‌شود. */
function fold(into, extra) {
  for (const k of ['title', 'year', 'authors', 'journal', 'abstract', 'oa_url', 'kind', 'doi']) {
    if (!into[k] && extra[k]) into[k] = extra[k];
  }
  if ((extra.citations ?? -1) > (into.citations ?? -1)) into.citations = extra.citations;
  if (extra.flags?.length) into.flags = [...new Set([...(into.flags || []), ...extra.flags])];
  if (extra.is_oa) into.is_oa = true;
  into.sources = [...new Set([...(into.sources || []), extra.source])];
  return into;
}

/**
 * همهٔ پایگاه‌های انتخاب‌شده را هم‌زمان می‌پرسد و نتایج تکراری را یکی می‌کند.
 * شکستِ یک پایگاه بقیه را از کار نمی‌اندازد.
 */
export async function searchAll(query, { page = 1, years = '', broad = false, use = null, exact = false } = {}) {
  const chosen = SOURCES.filter((s) => !use || use.includes(s.key));
  const settled = await Promise.allSettled(
    chosen.map((s) => s.run(query, { page, years, broad, exact })));

  const byDoi = new Map(), byTitle = new Map(), merged = [];
  const errors = [], counts = {};

  settled.forEach((res, i) => {
    const src = chosen[i];
    if (res.status === 'rejected') { errors.push(src.label + ': ' + (res.reason?.message || 'خطا')); return; }
    counts[src.label] = res.value.length;
    for (const rec of res.value) {
      if (!rec.title) continue;
      rec.sources = [rec.source];
      const kDoi = rec.doi || null;
      const kTitle = normTitle(rec.title);
      const hit = (kDoi && byDoi.get(kDoi)) || byTitle.get(kTitle);
      if (hit) { fold(hit, rec); if (kDoi && !byDoi.has(kDoi)) byDoi.set(kDoi, hit); continue; }
      merged.push(rec);
      if (kDoi) byDoi.set(kDoi, rec);
      if (kTitle) byTitle.set(kTitle, rec);
    }
  });

  // آنچه چند پایگاه هم‌زمان دارند معمولاً مرتبط‌تر است، بعد پراستنادتر
  merged.sort((a, b) =>
    (b.sources.length - a.sources.length) || ((b.citations ?? 0) - (a.citations ?? 0)));

  return { results: merged, counts, errors, raw: settled.filter((s) => s.status === 'fulfilled').reduce((n, s) => n + s.value.length, 0) };
}
