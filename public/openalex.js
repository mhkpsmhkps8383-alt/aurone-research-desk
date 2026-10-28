/**
 * OpenAlex از مرورگر خودِ کاربر خوانده می‌شود، نه از سرور.
 * دلیلش: OpenAlex سهمیهٔ بی‌کلید را بر پایهٔ آی‌پی حساب می‌کند و آی‌پیِ سرورِ
 * رایگان بین پروژه‌های زیادی مشترک است، پس سهمیه‌اش همیشه ته کشیده. آی‌پی خانگی
 * شما سهمیهٔ دست‌نخوردهٔ خودش را دارد. این API باز و فقط-خواندنی است و CORS دارد.
 */

const OA = 'https://api.openalex.org';

async function oaGet(path) {
  const r = await fetch(OA + path, { headers: { accept: 'application/json' } });
  if (r.status === 429) throw new Error('سهمیهٔ امروزِ OpenAlex روی این شبکه تمام شده — فردا دوباره امتحان کنید');
  if (!r.ok) throw new Error('OpenAlex پاسخ نداد (' + r.status + ')');
  return r.json();
}

const WORK_FIELDS = 'id,doi,display_name,publication_year,cited_by_count,authorships,primary_location,best_oa_location';

const cleanDoi = (s = '') =>
  String(s).trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').replace(/[.,;)\]]+$/, '');

function shape(w) {
  return {
    doi: cleanDoi(w.doi || '') || null,
    title: w.display_name,
    year: w.publication_year,
    citations: w.cited_by_count,
    authors: (w.authorships || []).slice(0, 8).map((a) => a.author?.display_name).filter(Boolean).join(', '),
    journal: w.primary_location?.source?.display_name || null,
    oa_url: w.best_oa_location?.pdf_url || w.best_oa_location?.landing_page_url || null,
  };
}

/** مقالاتی که به یک مقالهٔ معین استناد کرده‌اند. */
export async function citedBy(doi, limit = 25) {
  // فیلتر cites فقط شناسهٔ OpenAlex را می‌پذیرد، نه DOI — اول باید ترجمه شود
  const w = await oaGet(`/works/doi:${encodeURIComponent(cleanDoi(doi))}?select=id`);
  const id = String(w?.id || '').replace('https://openalex.org/', '');
  if (!id) throw new Error('این مقاله در OpenAlex نیست');
  const j = await oaGet(
    `/works?filter=cites:${id}&per-page=${limit}&sort=cited_by_count:desc&select=${WORK_FIELDS}`);
  return { total: j.meta?.count || 0, results: (j.results || []).map(shape) };
}

/**
 * منابعی که چند مقالهٔ کتابخانه به آنها استناد کرده‌اند ولی خودشان در کتابخانه نیستند.
 * onStep برای نشان دادن پیشرفت صدا زده می‌شود، چون چند درخواست پشت‌سرهم لازم است.
 */
export async function recommend(libraryDois, limit = 20, onStep = () => {}) {
  const dois = libraryDois.map(cleanDoi).filter((d) => /^10\.\d{4,9}\//.test(d));
  if (dois.length < 2) throw new Error('برای پیشنهاد، دست‌کم دو مقالهٔ DOI‌دار لازم است');
  const have = new Set(dois.map((d) => d.toLowerCase()));
  const seeds = dois.slice(0, 50);
  const counts = new Map();

  const chunks = [];
  for (let i = 0; i < seeds.length; i += 25) chunks.push(seeds.slice(i, i + 25));
  let step = 0;
  for (const ch of chunks) {
    onStep(++step, chunks.length + 3, 'خواندن منابعِ مقالات شما');
    const j = await oaGet(`/works?filter=doi:${ch.map(encodeURIComponent).join('%7C')}&per-page=25&select=id,referenced_works`);
    for (const w of j.results || [])
      for (const ref of w.referenced_works || []) counts.set(ref, (counts.get(ref) || 0) + 1);
  }

  const top = [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 60);
  if (!top.length) return { results: [], seen: counts.size };

  const out = [];
  for (let i = 0; i < top.length && out.length < limit; i += 20) {
    onStep(++step, chunks.length + 3, 'آوردن مشخصات مقالات پیشنهادی');
    const ids = top.slice(i, i + 20).map(([id]) => id.replace('https://openalex.org/', '')).join('%7C');
    const j = await oaGet(`/works?filter=openalex_id:${ids}&per-page=20&select=${WORK_FIELDS}`);
    for (const w of j.results || []) {
      const s = shape(w);
      if (s.doi && have.has(s.doi.toLowerCase())) continue;
      out.push({ ...s, shared: counts.get(w.id) || 0 });
    }
  }
  out.sort((a, b) => b.shared - a.shared || b.citations - a.citations);
  return { results: out.slice(0, limit), seen: counts.size };
}
