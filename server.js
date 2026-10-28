import express from 'express';
import compression from 'compression';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { q, ensureSchema, seedIfEmpty } from './db.js';
import { enrichDoi, searchPapers } from './scholar.js';
import { toBibtex, toRis } from './cite.js';

const app = express();
// فشرده‌سازی پاسخ‌ها: فهرست مقالات با چکیده‌ها صدها کیلوبایت می‌شود و روی
// شبکهٔ کند ده‌ها ثانیه طول می‌کشید. متن JSON حدود ده برابر کوچک می‌شود.
app.use(compression({ threshold: 1024 }));
const __dirname = dirname(fileURLToPath(import.meta.url));
app.use(express.json({ limit: '2mb' }));
// با ETag اعتبارسنجی می‌شود؛ بدون کش کردنِ کور، تا به‌روزرسانی‌ها بی‌درنگ دیده شوند
app.use(express.static(join(__dirname, 'public'), {
  etag: true,
  maxAge: 0,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));



// پاسخ‌های API هیچ‌وقت کش نشوند، وگرنه بعد از تغییر، نسخهٔ قدیمی دیده می‌شود
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, must-revalidate');
  next();
});

// ───────── وضعیت
app.get('/api/health', async (_req, res) => {
  const n = await q('SELECT count(*)::int AS n FROM papers');
  res.json({ ok: true, papers: n.rows[0].n });
});

// ───────── قالب‌ها
app.get('/api/templates', async (_req, res) => {
  const { rows } = await q('SELECT key,name,description,fields,builtin FROM templates ORDER BY builtin DESC, name');
  res.json(rows);
});

app.post('/api/templates', async (req, res) => {
  const { key, name, description, fields } = req.body || {};
  if (!key || !name || !Array.isArray(fields) || !fields.length)
    return res.status(400).json({ error: 'کلید، نام و دست‌کم یک فیلد لازم است' });
  const clean = fields
    .filter((f) => f && f.key && f.label)
    .map((f) => ({ key: String(f.key).trim(), label: String(f.label).trim(), hint: String(f.hint || '') }));
  await q(
    `INSERT INTO templates (key,name,description,fields,builtin) VALUES ($1,$2,$3,$4,false)
     ON CONFLICT (key) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description,
       fields=EXCLUDED.fields WHERE templates.builtin = false`,
    [String(key).trim(), name, description || '', JSON.stringify(clean)]
  );
  res.json({ ok: true });
});

app.delete('/api/templates/:key', async (req, res) => {
  await q('DELETE FROM templates WHERE key=$1 AND builtin=false', [req.params.key]);
  res.json({ ok: true });
});

// ───────── کتابخانه
app.get('/api/papers', async (req, res) => {
  const { search = '', tag = '', ao = '', nrf2 = '' } = req.query;
  // deep=1 یعنی داخل متنِ کاملِ مقاله‌ها هم بگرد، نه فقط عنوان و خلاصه
  const deep = req.query.deep === '1' && Boolean(search);
  const where = [], params = [];
  let snippet = '';
  if (search) {
    params.push('%' + search + '%');
    const p = params.length;
    where.push(`(title ILIKE $${p} OR doi ILIKE $${p} OR authors ILIKE $${p}
      OR summary ILIKE $${p} OR abstract ILIKE $${p} OR best_compound ILIKE $${p}
      OR fields::text ILIKE $${p}${deep ? ` OR raw_text ILIKE $${p}` : ''})`);
    if (deep) {
      // تکه‌ای از متن دور و برِ جایی که عبارت پیدا شده، برای نمایش در نتیجه
      params.push(search);
      const t = params.length;
      snippet = `CASE WHEN raw_text IS NOT NULL AND position(lower($${t}) in lower(raw_text)) > 0
        THEN substring(raw_text from greatest(1, position(lower($${t}) in lower(raw_text)) - 160) for 420)
        ELSE NULL END AS snippet`;
    }
  }
  if (tag) { params.push(tag); where.push(`tag = $${params.length}`); }
  if (ao) { params.push(ao); where.push(`antioxidant = $${params.length}`); }
  if (nrf2 === '1') where.push('nrf2 = true');
  if (req.query.files === '1') where.push("source = 'file'");
  const sql = `SELECT id,doi,title,journal,year,authors,tag,template,fields,best_compound,
    antioxidant,nrf2,summary,note,source,filename,pages,created_at,
    abstract,citations,oa_url,flags${deep ? ', ' + snippet : ''} FROM papers
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC, id DESC`;
  const { rows } = await q(sql, params);
  res.json(rows);
});

app.post('/api/papers', async (req, res) => {
  const b = req.body || {};
  if (!b.title) return res.status(400).json({ error: 'عنوان لازم است' });
  const { rows } = await q(
    `INSERT INTO papers (doi,title,journal,year,authors,tag,template,fields,best_compound,
       antioxidant,nrf2,summary,raw_text,note,source,filename,pages)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
    [b.doi || null, b.title, b.journal || null, b.year || null, b.authors || null,
     b.tag || null, b.template || 'medchem', JSON.stringify(b.fields || {}),
     b.best_compound || null, b.antioxidant || 'unclear', Boolean(b.nrf2),
     b.summary || null, (b.raw_text || '').slice(0, 40000) || null, b.note || null,
     b.source || 'ai', b.filename || null, b.pages || null]
  );
  res.json({ ok: true, id: rows[0].id });
});

/**
 * متن کامل مقاله جداگانه و فشرده فرستاده می‌شود.
 * دلیلش: سرعتِ آپلود روی برخی شبکه‌ها بسیار پایین است و فرستادن متن خام
 * همراه خودِ رکورد، درخواست را به تایم‌اوت می‌برد. این‌طور مقاله فوری ذخیره
 * می‌شود و متن پشت سرش می‌آید؛ اگر هم نرسید، مقاله و خلاصه‌اش سالم مانده‌اند.
 */
app.post('/api/papers/:id/text',
  express.raw({ type: ['application/gzip', 'application/octet-stream'], limit: '12mb' }),
  async (req, res) => {
    let text = '';
    try { text = gunzipSync(req.body).toString('utf8'); }
    catch { text = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : ''; }
    if (!text) return res.status(400).json({ error: 'متنی دریافت نشد' });
    const clipped = text.slice(0, 120000);
    await q('UPDATE papers SET raw_text=$2, updated_at=now() WHERE id=$1', [req.params.id, clipped]);
    res.json({ ok: true, chars: clipped.length, received: req.body.length });
  });

// ───────── تصویرهای مقاله (ساختارها)
app.post('/api/papers/:id/figures',
  express.raw({ type: ['image/*', 'application/octet-stream'], limit: '4mb' }),
  async (req, res) => {
    if (!req.body?.length) return res.status(400).json({ error: 'تصویری دریافت نشد' });
    const idx = Number(req.query.idx);
    if (!Number.isInteger(idx)) return res.status(400).json({ error: 'شمارهٔ تصویر لازم است' });
    await q(
      `INSERT INTO figures (paper_id, idx, page, width, height, mime, caption, data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (paper_id, idx) DO UPDATE SET
         page=EXCLUDED.page, width=EXCLUDED.width, height=EXCLUDED.height,
         mime=EXCLUDED.mime, caption=EXCLUDED.caption, data=EXCLUDED.data`,
      [req.params.id, idx, Number(req.query.page) || null,
       Number(req.query.w) || null, Number(req.query.h) || null,
       req.get('content-type') || 'image/webp',
       (req.query.caption || '').slice(0, 200) || null, req.body]);
    res.json({ ok: true, idx, bytes: req.body.length });
  });

app.get('/api/papers/:id/figures', async (req, res) => {
  const { rows } = await q(
    `SELECT idx, page, width, height, mime, caption, octet_length(data) AS bytes
     FROM figures WHERE paper_id=$1 ORDER BY idx`, [req.params.id]);
  res.json(rows);
});

app.get('/api/papers/:id/figures/:idx', async (req, res) => {
  const { rows } = await q(
    'SELECT mime, data FROM figures WHERE paper_id=$1 AND idx=$2',
    [req.params.id, req.params.idx]);
  if (!rows.length) return res.status(404).json({ error: 'پیدا نشد' });
  res.setHeader('content-type', rows[0].mime);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.send(rows[0].data);
});

app.delete('/api/papers/:id/figures/:idx', async (req, res) => {
  await q('DELETE FROM figures WHERE paper_id=$1 AND idx=$2', [req.params.id, req.params.idx]);
  res.json({ ok: true });
});

// فهرست شمارهٔ تصویرهای هر مقاله — شماره‌ها پیوسته نیستند، چون فقط
// تصویرهای انتخاب‌شده ذخیره می‌شوند
app.get('/api/figure-index', async (_req, res) => {
  const { rows } = await q(
    'SELECT paper_id, array_agg(idx ORDER BY idx) AS idxs FROM figures GROUP BY paper_id');
  res.json(Object.fromEntries(rows.map((r) => [r.paper_id, r.idxs])));
});

app.get('/api/papers/:id/text', async (req, res) => {
  const { rows } = await q('SELECT title,filename,raw_text FROM papers WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'پیدا نشد' });
  res.json(rows[0]);
});

app.patch('/api/papers/:id', async (req, res) => {
  const { note, tag, summary } = req.body || {};
  await q(`UPDATE papers SET note=COALESCE($2,note), tag=COALESCE($3,tag),
             summary=COALESCE($4,summary), updated_at=now() WHERE id=$1`,
    [req.params.id, note ?? null, tag ?? null, summary ?? null]);
  res.json({ ok: true });
});

app.delete('/api/papers/:id', async (req, res) => {
  await q('DELETE FROM papers WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ───────── پایگاه‌های علمیِ باز (بدون کلید و بدون هزینه)

// یک DOI را بده، هرچه رایگان دربارهٔ آن می‌شود دانست بگیر
app.get('/api/scholar/enrich', async (req, res) => {
  const out = await enrichDoi(req.query.doi || '');
  res.status(out.error ? 404 : 200).json(out);
});

// جست‌وجو در Europe PMC (شامل کل PubMed)
app.get('/api/scholar/search', async (req, res) => {
  const out = await searchPapers(req.query.q || '', req.query.page, req.query.years || '');
  res.status(out.error ? 400 : 200).json(out);
});

const ENRICH_COLS = `title=COALESCE(NULLIF($2,''),title), journal=COALESCE(NULLIF($3,''),journal),
  year=COALESCE($4,year), authors=COALESCE(NULLIF($5,''),authors),
  abstract=COALESCE(NULLIF($6,''),abstract), citations=$7,
  oa_url=COALESCE(NULLIF($8,''),oa_url), pmid=COALESCE(NULLIF($9,''),pmid),
  pmcid=COALESCE(NULLIF($10,''),pmcid), openalex_id=COALESCE(NULLIF($11,''),openalex_id),
  flags=$12, enriched_at=now(), updated_at=now()`;

async function enrichRow(row) {
  const d = await enrichDoi(row.doi);
  if (d.error) {
    await q('UPDATE papers SET enriched_at=now() WHERE id=$1', [row.id]);
    return { id: row.id, ok: false, reason: d.error };
  }
  await q(`UPDATE papers SET ${ENRICH_COLS} WHERE id=$1`, [
    row.id, d.title || '', d.journal || '', d.year || null, d.authors || '',
    d.abstract || '', Number.isFinite(d.citations) ? d.citations : null,
    d.oa_url || '', d.pmid || '', d.pmcid || '', d.openalex_id || '',
    JSON.stringify(d.flags || []),
  ]);
  return { id: row.id, ok: true, citations: d.citations ?? null, oa: Boolean(d.oa_url),
    flags: d.flags || [] };
}

// غنی‌سازی یک مقالهٔ ذخیره‌شده
app.post('/api/papers/:id/enrich', async (req, res) => {
  const { rows } = await q("SELECT id,doi FROM papers WHERE id=$1", [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'پیدا نشد' });
  if (!rows[0].doi) return res.status(400).json({ error: 'این مقاله DOI ندارد' });
  res.json(await enrichRow(rows[0]));
});

// غنی‌سازی دسته‌ای — هر بار چند تا، تا درخواست طولانی نشود
app.post('/api/enrich-batch', async (req, res) => {
  const limit = Math.max(1, Math.min(10, Number(req.body?.limit) || 6));
  const { rows } = await q(
    `SELECT id,doi FROM papers WHERE doi IS NOT NULL AND doi <> '' AND enriched_at IS NULL
     ORDER BY id LIMIT $1`, [limit]);
  const done = [];
  for (const r of rows) done.push(await enrichRow(r));
  const left = await q(
    "SELECT count(*)::int AS n FROM papers WHERE doi IS NOT NULL AND doi <> '' AND enriched_at IS NULL");
  res.json({ done, remaining: left.rows[0].n });
});

app.get('/api/enrich-status', async (_req, res) => {
  const { rows } = await q(`SELECT
     count(*) FILTER (WHERE doi IS NOT NULL AND doi <> '')::int AS with_doi,
     count(*) FILTER (WHERE enriched_at IS NOT NULL)::int AS done,
     count(*) FILTER (WHERE abstract IS NOT NULL)::int AS abstracts,
     count(*) FILTER (WHERE oa_url IS NOT NULL)::int AS free_pdf FROM papers`);
  res.json(rows[0]);
});

// ───────── دیده‌بانی: جست‌وجوی ذخیره‌شده که مقالهٔ تازه‌اش را خبر می‌دهد
app.get('/api/watches', async (_req, res) => {
  const { rows } = await q(
    `SELECT id,label,query,last_checked,jsonb_array_length(seen_ids) AS seen FROM watches ORDER BY id`);
  res.json(rows);
});

app.post('/api/watches', async (req, res) => {
  const { label, query } = req.body || {};
  if (!query || !query.trim()) return res.status(400).json({ error: 'عبارت جست‌وجو لازم است' });
  const first = await searchPapers(query, 1);
  const ids = (first.results || []).map((r) => r.id).filter(Boolean);
  const { rows } = await q(
    `INSERT INTO watches (label,query,seen_ids,last_checked) VALUES ($1,$2,$3,now()) RETURNING id`,
    [(label || query).trim().slice(0, 80), query.trim(), JSON.stringify(ids)]);
  res.json({ ok: true, id: rows[0].id, baseline: ids.length });
});

app.delete('/api/watches/:id', async (req, res) => {
  await q('DELETE FROM watches WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// بررسی همهٔ دیده‌بانی‌ها: چه چیزی از آخرین بار تازه آمده
app.post('/api/watches/check', async (_req, res) => {
  const { rows } = await q('SELECT id,label,query,seen_ids FROM watches ORDER BY id');
  const out = [];
  for (const w of rows) {
    const r = await searchPapers(w.query, 1);
    if (r.error) { out.push({ id: w.id, label: w.label, error: r.error, fresh: [] }); continue; }
    const seen = new Set(w.seen_ids || []);
    const fresh = (r.results || []).filter((x) => x.id && !seen.has(x.id));
    const all = [...new Set([...(w.seen_ids || []), ...(r.results || []).map((x) => x.id)])].slice(-400);
    await q('UPDATE watches SET seen_ids=$2, last_checked=now() WHERE id=$1', [w.id, JSON.stringify(all)]);
    out.push({ id: w.id, label: w.label, total: r.total, fresh });
  }
  res.json({ watches: out, newCount: out.reduce((n, w) => n + (w.fresh?.length || 0), 0) });
});

// ───────── کتابخانهٔ ترکیبات و محاسبات
app.get('/api/compounds', async (req, res) => {
  const { sort = 'score_direct', drug = '', cat = '' } = req.query;
  const col = ['score_direct', 'score_nrf2', 'n_oh', 'logp', 'mw', 'tpsa'].includes(sort) ? sort : 'score_direct';
  const where = [];
  if (drug === '1') where.push('drug_like = true');
  if (cat === '1') where.push('catechol = true');
  const { rows } = await q(
    `SELECT * FROM compounds ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY ${col} DESC NULLS LAST, id LIMIT 300`);
  res.json(rows);
});

app.get('/api/qm', async (_req, res) => {
  const { rows } = await q('SELECT * FROM qm_results ORDER BY bde_min NULLS LAST');
  res.json(rows);
});

// ───────── خروجی
app.get('/api/export.csv', async (_req, res) => {
  const { rows } = await q('SELECT * FROM papers ORDER BY id');
  const keys = new Set();
  rows.forEach((r) => Object.keys(r.fields || {}).forEach((k) => keys.add(k)));
  const extra = [...keys];
  const head = ['id', 'doi', 'title', 'journal', 'year', 'authors', 'tag', 'antioxidant',
    'nrf2', 'best_compound', 'summary', 'note', ...extra];
  const esc = (v) => '"' + String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
  const body = rows.map((r) =>
    head.map((h) => esc(extra.includes(h) ? (r.fields || {})[h] : r[h])).join(',')).join('\n');
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', 'attachment; filename="aurone-library.csv"');
  res.send('﻿' + head.join(',') + '\n' + body);
});

async function forExport(req) {
  const ids = String(req.query.ids || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length) {
    const { rows } = await q('SELECT * FROM papers WHERE id = ANY($1::bigint[]) ORDER BY id', [ids]);
    return rows;
  }
  const { rows } = await q('SELECT * FROM papers ORDER BY id');
  return rows;
}

app.get('/api/export.bib', async (req, res) => {
  const rows = await forExport(req);
  res.setHeader('content-type', 'application/x-bibtex; charset=utf-8');
  res.setHeader('content-disposition', 'attachment; filename="aurone-library.bib"');
  res.send(toBibtex(rows));
});

app.get('/api/export.ris', async (req, res) => {
  const rows = await forExport(req);
  res.setHeader('content-type', 'application/x-research-info-systems; charset=utf-8');
  res.setHeader('content-disposition', 'attachment; filename="aurone-library.ris"');
  res.send(toRis(rows));
});

app.get('/api/export.md', async (_req, res) => {
  const { rows } = await q('SELECT * FROM papers ORDER BY id');
  const out = rows.map((r) => {
    const f = Object.entries(r.fields || {}).filter(([, v]) => v)
      .map(([k, v]) => `- **${k}:** ${v}`).join('\n');
    return `## ${r.title}

**DOI:** ${r.doi || '—'} · **دسته:** ${r.tag || '—'} · **آنتی‌اکسیدان:** ${r.antioxidant}${r.nrf2 ? ' · **Nrf2**' : ''}

${r.best_compound ? '**بهترین ترکیب:** ' + r.best_compound + '\n' : ''}
${r.summary || ''}

${f}`;
  }).join('\n\n---\n\n');
  res.setHeader('content-type', 'text/markdown; charset=utf-8');
  res.setHeader('content-disposition', 'attachment; filename="aurone-library.md"');
  res.send('# کتابخانهٔ مقالات اورون\n\n' + out);
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'خطای سرور' });
});

const port = process.env.PORT || 3000;
ensureSchema()
  .then(seedIfEmpty)
  .then(() => app.listen(port, () => console.log('listening on ' + port)))
  .catch((e) => { console.error('startup failed', e); process.exit(1); });
