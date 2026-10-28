/**
 * اتصال به پایگاه‌های علمیِ باز. هیچ‌کدام کلید API نمی‌خواهند و همگی رایگانند:
 *   Europe PMC  — کل PubMed به‌علاوهٔ منابع دیگر، با چکیده و لینک متن کامل
 *   OpenAlex    — تعداد استناد و گرافِ منابع (چه چیزی به چه چیزی استناد کرده)
 *   Crossref    — فراداده‌های رسمیِ هر DOI، برای وقتی مقاله زیست‌پزشکی نیست
 */

const UA = 'AuroneResearchDesk/1.0 (+https://aurone-research-desk.onrender.com)';
const EPMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest';

/** درخواست با مهلت زمانی؛ هیچ‌وقت نباید سرور را معلق نگه دارد. */
export let lastError = null;

async function get(url, ms = 9000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': UA, accept: 'application/json' } });
    if (!r.ok) {
      lastError = `HTTP ${r.status} — ${(await r.text().catch(() => '')).slice(0, 200)}`;
      return null;
    }
    return await r.json();
  } catch (e) {
    lastError = String(e?.cause?.message || e?.message || e).slice(0, 200);
    return null;
  } finally {
    clearTimeout(t);
  }
}

export const cleanDoi = (s = '') =>
  String(s).trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').replace(/[.,;)\]]+$/, '');

/** OpenAlex چکیده را وارونه ذخیره می‌کند؛ اینجا به متن برمی‌گردانیمش. */
function deinvert(idx) {
  if (!idx) return null;
  const slots = [];
  for (const [word, positions] of Object.entries(idx)) for (const p of positions) slots[p] = word;
  const text = slots.filter(Boolean).join(' ').trim();
  return text.length > 40 ? text : null;
}

function fromEpmc(r) {
  if (!r) return {};
  const oa = (r.fullTextUrlList?.fullTextUrl || [])
    .filter((u) => /open|free/i.test(u.availability || ''))
    .sort((a, b) => (a.documentStyle === 'pdf' ? -1 : 1))[0];
  return {
    title: r.title?.replace(/\.$/, '') || null,
    authors: r.authorString || null,
    journal: r.journalInfo?.journal?.title || r.bookOrReportDetails?.publisher || null,
    year: r.pubYear ? Number(r.pubYear) : null,
    abstract: r.abstractText ? r.abstractText.replace(/<[^>]+>/g, '').trim() : null,
    citations: Number.isFinite(r.citedByCount) ? r.citedByCount : null,
    pmid: r.pmid || null,
    pmcid: r.pmcid || null,
    oa_url: oa?.url || (r.pmcid ? `https://www.ncbi.nlm.nih.gov/pmc/articles/${r.pmcid}/` : null),
  };
}

function fromOpenAlex(w) {
  if (!w) return {};
  const loc = w.best_oa_location || w.primary_location || {};
  return {
    title: w.display_name || null,
    authors: (w.authorships || []).map((a) => a.author?.display_name).filter(Boolean).join(', ') || null,
    journal: w.primary_location?.source?.display_name || null,
    year: w.publication_year || null,
    abstract: deinvert(w.abstract_inverted_index),
    citations: Number.isFinite(w.cited_by_count) ? w.cited_by_count : null,
    oa_url: loc.pdf_url || (loc.is_oa ? loc.landing_page_url : null) || null,
    openalex_id: w.id || null,
    referenced: Array.isArray(w.referenced_works) ? w.referenced_works : [],
    type: w.type || null,
  };
}

function fromCrossref(m) {
  if (!m) return {};
  return {
    title: Array.isArray(m.title) ? m.title[0] : m.title || null,
    authors: (m.author || []).map((a) => [a.given, a.family].filter(Boolean).join(' ')).filter(Boolean).join(', ') || null,
    journal: (m['container-title'] || [])[0] || null,
    year: m.issued?.['date-parts']?.[0]?.[0] || null,
    abstract: m.abstract ? m.abstract.replace(/<[^>]+>/g, '').trim() : null,
    type: m.type || null,
  };
}

/** هر فیلدی که هنوز خالی است را از منبع بعدی پر می‌کند. */
function merge(...parts) {
  const out = {};
  for (const p of parts) for (const [k, v] of Object.entries(p || {})) {
    if (out[k] === undefined || out[k] === null || out[k] === '' ||
        (Array.isArray(out[k]) && !out[k].length)) {
      if (v !== undefined && v !== null && v !== '') out[k] = v;
    }
  }
  return out;
}

/** همهٔ آنچه دربارهٔ یک DOI می‌شود رایگان فهمید. */
export async function enrichDoi(rawDoi) {
  const doi = cleanDoi(rawDoi);
  if (!/^10\.\d{4,9}\//.test(doi)) return { error: 'DOI معتبر نیست' };
  // OpenAlex عمداً اینجا نیست: سهمیهٔ بی‌کلیدش بر پایهٔ آی‌پی است و آی‌پی سرورِ
  // رایگان مشترک است. آن بخش از مرورگر کاربر خوانده می‌شود (public/openalex.js).
  const [epmc, cr] = await Promise.all([
    get(`${EPMC}/search?query=DOI:%22${encodeURIComponent(doi)}%22&format=json&resultType=core&pageSize=1`),
    get(`https://api.crossref.org/works/${encodeURIComponent(doi)}`),
  ]);
  const merged = merge(fromEpmc(epmc?.resultList?.result?.[0]), fromCrossref(cr?.message));
  if (!merged.title) return { error: 'در هیچ پایگاهی پیدا نشد' };
  return { doi, ...merged, found_in: [epmc?.resultList?.result?.length && 'EuropePMC', cr?.message && 'Crossref'].filter(Boolean) };
}

/** جست‌وجوی مقاله در Europe PMC (شامل کل PubMed). */
export async function searchPapers(query, page = 1, years = '') {
  if (!query || query.trim().length < 2) return { error: 'عبارت جست‌وجو کوتاه است' };
  let qy = query.trim();
  if (years) qy += ` AND (FIRST_PDATE:[${years}-01-01 TO 3000-12-31])`;
  const j = await get(
    `${EPMC}/search?query=${encodeURIComponent(qy)}&format=json&resultType=core` +
    `&pageSize=25&page=${Math.max(1, Math.min(40, Number(page) || 1))}&sort=CITED%20desc`,
    12000
  );
  if (!j) return { error: 'پایگاه پاسخ نداد' };
  const results = (j.resultList?.result || []).map((r) => {
    const m = fromEpmc(r);
    return {
      id: r.id, source: r.source, doi: r.doi || null, ...m,
      is_oa: r.isOpenAccess === 'Y',
      snippet: m.abstract ? m.abstract.slice(0, 320) + (m.abstract.length > 320 ? '…' : '') : null,
    };
  });
  return { total: j.hitCount || 0, page: Number(page) || 1, results };
}

/**
 * پیشنهاد مقاله بر پایهٔ گرافِ استناد: مقالاتی که چند مقالهٔ کتابخانه به آنها
 * استناد کرده‌اند ولی خودشان در کتابخانه نیستند. هرچه بیشتر تکرار شده باشند،
 * احتمال اینکه مقالهٔ کلیدیِ جاافتاده باشند بیشتر است.
 */
export async function recommend(libraryDois, limit = 20) {
  const dois = libraryDois.map(cleanDoi).filter((d) => /^10\./.test(d));
  if (dois.length < 2) return { error: 'برای پیشنهاد، دست‌کم دو مقالهٔ DOI‌دار لازم است' };
  const have = new Set(dois.map((d) => d.toLowerCase()));
  const seeds = dois.slice(0, 50);
  const counts = new Map();

  // OpenAlex تا ۵۰ شناسه را در یک درخواست می‌پذیرد
  for (let i = 0; i < seeds.length; i += 25) {
    // نحو OR در OpenAlex: filter=doi:a|b — نه اینکه کلید تکرار شود.
    // خطِ لوله‌ای باید کدگذاری شود وگرنه fetch نود آدرس را نامعتبر می‌داند.
    const filt = 'doi:' + seeds.slice(i, i + 25).map(encodeURIComponent).join('%7C');
    const j = await get(`https://api.openalex.org/works?filter=${filt}&per-page=25&select=id,referenced_works`, 15000);
    for (const w of j?.results || [])
      for (const ref of w.referenced_works || []) counts.set(ref, (counts.get(ref) || 0) + 1);
  }

  const debug = { seeds: seeds.length, refs_seen: counts.size, lastError };
  const top = [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 60);
  if (!top.length) return { results: [], debug };

  const out = [];
  for (let i = 0; i < top.length && out.length < limit; i += 20) {
    const ids = top.slice(i, i + 20).map(([id]) => id.replace('https://openalex.org/', '')).join('%7C');
    const j = await get(
      `https://api.openalex.org/works?filter=openalex_id:${ids}&per-page=20` +
      `&select=id,doi,display_name,publication_year,cited_by_count,authorships,primary_location,best_oa_location`, 12000);
    for (const w of j?.results || []) {
      const doi = cleanDoi(w.doi || '');
      if (doi && have.has(doi.toLowerCase())) continue;
      out.push({
        doi: doi || null,
        title: w.display_name,
        year: w.publication_year,
        citations: w.cited_by_count,
        authors: (w.authorships || []).slice(0, 6).map((a) => a.author?.display_name).filter(Boolean).join(', '),
        journal: w.primary_location?.source?.display_name || null,
        oa_url: w.best_oa_location?.pdf_url || w.best_oa_location?.landing_page_url || null,
        shared: counts.get(w.id) || 0,
      });
    }
  }
  out.sort((a, b) => b.shared - a.shared || b.citations - a.citations);
  return { results: out.slice(0, limit), debug };
}

/** مقالاتی که به یک مقالهٔ معین استناد کرده‌اند — برای دنبال کردن ادامهٔ یک کار. */
export async function citedBy(doi, limit = 25) {
  const d = cleanDoi(doi);
  const j = await get(
    `https://api.openalex.org/works?filter=cites:doi:${encodeURIComponent(d)}` +
    `&per-page=${limit}&sort=cited_by_count:desc` +
    `&select=id,doi,display_name,publication_year,cited_by_count,authorships,primary_location,best_oa_location`, 12000);
  if (!j) return { error: 'پایگاه پاسخ نداد' };
  return {
    total: j.meta?.count || 0,
    results: (j.results || []).map((w) => ({
      doi: cleanDoi(w.doi || '') || null,
      title: w.display_name,
      year: w.publication_year,
      citations: w.cited_by_count,
      authors: (w.authorships || []).slice(0, 6).map((a) => a.author?.display_name).filter(Boolean).join(', '),
      journal: w.primary_location?.source?.display_name || null,
      oa_url: w.best_oa_location?.pdf_url || w.best_oa_location?.landing_page_url || null,
    })),
  };
}
