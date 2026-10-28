import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { q, ensureSchema, seedIfEmpty } from './db.js';

const app = express();
const __dirname = dirname(fileURLToPath(import.meta.url));
app.use(express.json({ limit: '2mb' }));
// با ETag اعتبارسنجی می‌شود؛ بدون کش کردنِ کور، تا به‌روزرسانی‌ها بی‌درنگ دیده شوند
app.use(express.static(join(__dirname, 'public'), {
  etag: true,
  maxAge: 0,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const KEY = process.env.ANTHROPIC_API_KEY;

/** یک فراخوانی ساده به Claude. اگر کلید تنظیم نشده باشد، خطای روشن برمی‌گرداند. */
async function askClaude(prompt, { maxTokens = 2000, system } = {}) {
  if (!KEY) {
    const e = new Error('ANTHROPIC_API_KEY تنظیم نشده است');
    e.code = 'no_key';
    throw e;
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    const e = new Error('Claude API: ' + res.status + ' ' + body.slice(0, 300));
    e.code = res.status === 401 ? 'bad_key' : 'upstream';
    throw e;
  }
  const data = await res.json();
  return (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
}

function parseJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(raw);
}

const ERR_FA = {
  no_key: 'کلید Claude روی سرور تنظیم نشده. در داشبورد Render متغیر ANTHROPIC_API_KEY را اضافه کنید.',
  bad_key: 'کلید Claude پذیرفته نشد. مقدار ANTHROPIC_API_KEY را در Render بررسی کنید.',
  upstream: 'پاسخ از سرویس Claude گرفته نشد. چند لحظه بعد دوباره امتحان کنید.',
};
const fail = (res, e) => {
  console.error(e.message);
  res.status(e.code === 'no_key' || e.code === 'bad_key' ? 400 : 502)
     .json({ error: ERR_FA[e.code] || 'خطای ناشناخته: ' + e.message, code: e.code || 'unknown' });
};

// ───────── وضعیت
app.get('/api/health', async (_req, res) => {
  const n = await q('SELECT count(*)::int AS n FROM papers');
  res.json({ ok: true, papers: n.rows[0].n, ai: Boolean(KEY), model: MODEL });
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

// ───────── تحلیل خودکار مقالهٔ جدید
app.post('/api/analyze', async (req, res) => {
  const { text, template = 'medchem' } = req.body || {};
  if (!text || text.trim().length < 60)
    return res.status(400).json({ error: 'متن مقاله یا چکیده را بگذارید (دست‌کم ۶۰ نویسه)' });
  const t = await q('SELECT fields FROM templates WHERE key=$1', [template]);
  if (!t.rows.length) return res.status(400).json({ error: 'قالب پیدا نشد' });
  const fields = t.rows[0].fields;

  const shape = fields.map((f) => `  "${f.key}": "…"   // ${f.label}${f.hint ? ' — ' + f.hint : ''}`).join('\n');
  const prompt =
`این متن یک مقالهٔ علمی است. آن را بخوان و اطلاعات خواسته‌شده را استخراج کن.

قواعد:
- فقط چیزی را بنویس که در متن آمده است. حدس نزن.
- اگر موردی در متن نیست، مقدارش را رشتهٔ خالی بگذار.
- مقادیر عددی را با واحدشان بیاور.
- همهٔ پاسخ‌ها به فارسی باشد، جز نام ترکیب‌ها، آنزیم‌ها و اصطلاحات انگلیسی.
- فقط JSON برگردان، بدون هیچ متن دیگر.

شکل خروجی:
{
  "title": "…",          // عنوان مقاله
  "doi": "…",            // DOI اگر در متن بود
  "journal": "…",
  "year": 0,
  "authors": "…",        // نویسندهٔ اول و همکاران
  "antioxidant": "yes|no|unclear",   // آیا اثر آنتی‌اکسیدانی بررسی و تأیید شده؟
  "nrf2": true,          // آیا مسیر Nrf2 یا Keap1 یا ARE مطرح شده؟
  "summary": "…",        // سه تا پنج جملهٔ فشرده از مهم‌ترین نکات
${shape}
}

متن مقاله:
"""
${String(text).slice(0, 120000)}
"""`;

  try {
    const out = await askClaude(prompt, { maxTokens: 3000 });
    const data = parseJson(out);
    const known = new Set(fields.map((f) => f.key));
    const extra = {};
    for (const k of Object.keys(data)) if (known.has(k)) extra[k] = data[k];
    res.json({
      title: data.title || '', doi: data.doi || '', journal: data.journal || '',
      year: Number(data.year) || null, authors: data.authors || '',
      antioxidant: ['yes', 'no', 'unclear'].includes(data.antioxidant) ? data.antioxidant : 'unclear',
      nrf2: Boolean(data.nrf2), summary: data.summary || '',
      best_compound: data.best_compound || '', template, fields: extra,
    });
  } catch (e) {
    if (e instanceof SyntaxError)
      return res.status(502).json({ error: 'پاسخ مدل قابل خواندن نبود. دوباره امتحان کنید.', code: 'bad_json' });
    fail(res, e);
  }
});

// ───────── کتابخانه
app.get('/api/papers', async (req, res) => {
  const { search = '', tag = '', ao = '', nrf2 = '' } = req.query;
  const where = [], params = [];
  if (search) {
    params.push('%' + search + '%');
    where.push(`(title ILIKE $${params.length} OR doi ILIKE $${params.length}
      OR summary ILIKE $${params.length} OR best_compound ILIKE $${params.length}
      OR fields::text ILIKE $${params.length})`);
  }
  if (tag) { params.push(tag); where.push(`tag = $${params.length}`); }
  if (ao) { params.push(ao); where.push(`antioxidant = $${params.length}`); }
  if (nrf2 === '1') where.push('nrf2 = true');
  if (req.query.files === '1') where.push("source = 'file'");
  const sql = `SELECT id,doi,title,journal,year,authors,tag,template,fields,best_compound,
    antioxidant,nrf2,summary,note,source,filename,pages,created_at FROM papers
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

app.get('/api/papers/:id/text', async (req, res) => {
  const { rows } = await q('SELECT title,filename,raw_text FROM papers WHERE id=$1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'پیدا نشد' });
  res.json(rows[0]);
});

app.patch('/api/papers/:id', async (req, res) => {
  const { note, tag } = req.body || {};
  await q('UPDATE papers SET note=COALESCE($2,note), tag=COALESCE($3,tag), updated_at=now() WHERE id=$1',
    [req.params.id, note ?? null, tag ?? null]);
  res.json({ ok: true });
});

app.delete('/api/papers/:id', async (req, res) => {
  await q('DELETE FROM papers WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ───────── پرسش از کل کتابخانه
app.post('/api/ask', async (req, res) => {
  const { question } = req.body || {};
  if (!question || question.trim().length < 5)
    return res.status(400).json({ error: 'سؤال را بنویسید' });
  const { rows } = await q(
    `SELECT id,title,doi,tag,antioxidant,nrf2,best_compound,summary,fields FROM papers
     ORDER BY id`);
  if (!rows.length) return res.status(400).json({ error: 'کتابخانه خالی است' });

  const corpus = rows.map((r) => {
    const f = Object.entries(r.fields || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' | ');
    return `[#${r.id}] ${r.title}
DOI: ${r.doi || '—'} | دسته: ${r.tag || '—'} | آنتی‌اکسیدان: ${r.antioxidant} | Nrf2: ${r.nrf2 ? 'بله' : 'خیر'}
بهترین ترکیب: ${(r.best_compound || '—').slice(0, 400)}
خلاصه: ${(r.summary || '').slice(0, 900)}
${f ? 'فیلدها: ' + f.slice(0, 900) : ''}`;
  }).join('\n\n').slice(0, 180000);

  const prompt =
`تو دستیار پژوهشی هستی. فقط بر پایهٔ مقالات زیر به سؤال پاسخ بده.

قواعد:
- هر ادعایی را به شمارهٔ مقاله ارجاع بده، به شکل [#12].
- اگر پاسخ در این مقالات نیست، صریح بگو که این مجموعه جواب را ندارد.
- اگر مقالات با هم اختلاف دارند، اختلاف را نشان بده و پنهانش نکن.
- فارسی بنویس، روان و دقیق، بدون مقدمه‌چینی.

سؤال: ${question}

مقالات:
${corpus}`;

  try {
    const answer = await askClaude(prompt, { maxTokens: 2500 });
    await q('INSERT INTO asks (question,answer,n_papers) VALUES ($1,$2,$3)',
      [question, answer, rows.length]);
    res.json({ answer, n_papers: rows.length });
  } catch (e) { fail(res, e); }
});

app.get('/api/asks', async (_req, res) => {
  const { rows } = await q('SELECT id,question,answer,n_papers,created_at FROM asks ORDER BY id DESC LIMIT 30');
  res.json(rows);
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
