import pg from 'pg';
import { readFileSync, existsSync } from 'node:fs';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
});

export const q = (text, params) => pool.query(text, params);

const DDL = [
  `CREATE TABLE IF NOT EXISTS papers (
     id bigserial PRIMARY KEY, doi text, title text NOT NULL, journal text, year int,
     authors text, tag text, template text NOT NULL DEFAULT 'medchem',
     fields jsonb NOT NULL DEFAULT '{}'::jsonb, best_compound text,
     antioxidant text, nrf2 boolean NOT NULL DEFAULT false, summary text,
     raw_text text, note text, source text NOT NULL DEFAULT 'manual',
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS templates (
     key text PRIMARY KEY, name text NOT NULL, description text,
     fields jsonb NOT NULL, builtin boolean NOT NULL DEFAULT false,
     created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS compounds (
     id text PRIMARY KEY, scaffold text, ring_a text, ring_b text, ring_a_fa text,
     ring_b_fa text, smiles text, mw numeric, logp numeric, tpsa numeric, hbd int,
     hba int, n_oh int, catechol boolean, rot_b int, score_direct numeric,
     score_nrf2 numeric, lipinski_viol int, drug_like boolean)`,
  `CREATE TABLE IF NOT EXISTS qm_results (
     name text PRIMARY KEY, label_fa text, smiles text, bde_min numeric,
     ip_ev numeric, n_oh int, sites jsonb, level text)`,
  `CREATE TABLE IF NOT EXISTS asks (
     id bigserial PRIMARY KEY, question text NOT NULL, answer text, n_papers int,
     created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS papers_created_idx ON papers (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS papers_tag_idx ON papers (tag)`,
];

// قالب‌های استخراج پیش‌فرض — کاربر می‌تواند قالب دلخواه خودش را هم بسازد
export const BUILTIN_TEMPLATES = [
  {
    key: 'medchem',
    name: 'شیمی دارویی',
    description: 'برای مقالات سنتز و ارزیابی زیستی ترکیبات',
    builtin: true,
    fields: [
      { key: 'best_compound', label: 'بهترین ترکیب', hint: 'نام یا شمارهٔ ترکیب برتر و مقدار فعالیتش' },
      { key: 'activity', label: 'فعالیت بررسی‌شده', hint: 'آنتی‌اکسیدانی، ضدسرطان، مهار آنزیم و غیره' },
      { key: 'potency', label: 'قدرت اثر', hint: 'IC50، MIC، EC50 با واحد و ترکیب شاهد' },
      { key: 'sar', label: 'رابطهٔ ساختار-فعالیت', hint: 'کدام استخلاف اثر را زیاد یا کم کرد' },
      { key: 'mechanism', label: 'مکانیسم', hint: 'سازوکار مولکولی یا سلولی گزارش‌شده' },
      { key: 'scaffold', label: 'اسکلت شیمیایی', hint: 'هستهٔ ساختاری ترکیبات' },
      { key: 'limitation', label: 'محدودیت', hint: 'چه چیزی بررسی نشده یا ضعف کار' },
    ],
  },
  {
    key: 'clinical',
    name: 'بالینی',
    description: 'برای کارآزمایی و مطالعات انسانی',
    builtin: true,
    fields: [
      { key: 'population', label: 'جمعیت', hint: 'چه کسانی، چند نفر' },
      { key: 'intervention', label: 'مداخله', hint: 'دارو، دوز، مدت' },
      { key: 'comparator', label: 'گروه شاهد', hint: 'دارونما یا داروی مقایسه' },
      { key: 'outcome', label: 'پیامد اصلی', hint: 'چه چیزی اندازه‌گیری شد' },
      { key: 'result', label: 'نتیجه', hint: 'عدد و معناداری آماری' },
      { key: 'safety', label: 'ایمنی', hint: 'عوارض گزارش‌شده' },
      { key: 'limitation', label: 'محدودیت', hint: 'سوگیری یا ضعف روش' },
    ],
  },
  {
    key: 'general',
    name: 'عمومی',
    description: 'برای هر مقاله‌ای از هر رشته',
    builtin: true,
    fields: [
      { key: 'objective', label: 'هدف', hint: 'مسئله‌ای که مقاله حل می‌کند' },
      { key: 'method', label: 'روش', hint: 'چطور بررسی شد' },
      { key: 'finding', label: 'یافتهٔ اصلی', hint: 'مهم‌ترین نتیجه با عدد' },
      { key: 'novelty', label: 'نوآوری', hint: 'چه چیزی نسبت به کارهای قبلی جدید است' },
      { key: 'limitation', label: 'محدودیت', hint: 'ضعف‌ها و آنچه بررسی نشده' },
      { key: 'next_step', label: 'گام بعدی', hint: 'پیشنهاد نویسندگان برای ادامهٔ کار' },
    ],
  },
];

export async function ensureSchema() {
  for (const ddl of DDL) await q(ddl);
  // مهاجرت‌های تدریجی — روی دیتابیسی که از قبل ساخته شده هم بی‌خطر اجرا می‌شوند
  await q(`ALTER TABLE papers ADD COLUMN IF NOT EXISTS filename text`);
  await q(`ALTER TABLE papers ADD COLUMN IF NOT EXISTS pages int`);
  // فراداده‌هایی که از پایگاه‌های باز می‌آیند
  for (const [col, type] of [
    ['abstract', 'text'], ['citations', 'int'], ['oa_url', 'text'],
    ['pmid', 'text'], ['pmcid', 'text'], ['openalex_id', 'text'],
    ['enriched_at', 'timestamptz'],
  ]) await q(`ALTER TABLE papers ADD COLUMN IF NOT EXISTS ${col} ${type}`);
  await q(`CREATE TABLE IF NOT EXISTS watches (
     id bigserial PRIMARY KEY, label text NOT NULL, query text NOT NULL,
     seen_ids jsonb NOT NULL DEFAULT '[]'::jsonb, last_checked timestamptz,
     created_at timestamptz NOT NULL DEFAULT now())`);
  for (const t of BUILTIN_TEMPLATES) {
    await q(
      `INSERT INTO templates (key, name, description, fields, builtin)
       VALUES ($1,$2,$3,$4,true)
       ON CONFLICT (key) DO UPDATE SET name=EXCLUDED.name,
         description=EXCLUDED.description, fields=EXCLUDED.fields`,
      [t.key, t.name, t.description, JSON.stringify(t.fields)]
    );
  }
}

function load(file) {
  const p = new URL('./data/' + file, import.meta.url);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : [];
}

/** بار اول که سایت بالا می‌آید، کتابخانهٔ موجود را داخل دیتابیس می‌ریزد. */
export async function seedIfEmpty() {
  const { rows } = await q('SELECT count(*)::int AS n FROM papers');
  if (rows[0].n === 0) {
    for (const p of load('papers.json')) {
      await q(
        `INSERT INTO papers (doi,title,tag,antioxidant,nrf2,best_compound,summary,source,template)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'medchem')`,
        [p.doi, p.title, p.tag, p.antioxidant, p.nrf2, p.best_compound, p.summary, p.source]
      );
    }
    console.log('seeded papers');
  }
  const c = await q('SELECT count(*)::int AS n FROM compounds');
  if (c.rows[0].n === 0) {
    for (const r of load('compounds.json')) {
      await q(
        `INSERT INTO compounds (id,scaffold,ring_a,ring_b,ring_a_fa,ring_b_fa,smiles,mw,logp,
           tpsa,hbd,hba,n_oh,catechol,rot_b,score_direct,score_nrf2,lipinski_viol,drug_like)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT (id) DO NOTHING`,
        [r.id, r.scaffold, r.ring_a, r.ring_b, r.ring_a_fa, r.ring_b_fa, r.smiles, r.mw,
         r.logp, r.tpsa, r.hbd, r.hba, r.n_oh, r.catechol, r.rot_b, r.score_direct,
         r.score_nrf2, r.lipinski_viol, r.drug_like]
      );
    }
    console.log('seeded compounds');
  }
  const Qm = await q('SELECT count(*)::int AS n FROM qm_results');
  if (Qm.rows[0].n === 0) {
    for (const m of load('qm.json')) {
      await q(
        `INSERT INTO qm_results (name,label_fa,smiles,bde_min,ip_ev,n_oh,sites,level)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (name) DO NOTHING`,
        [m.name, m.label_fa, m.smiles, m.bde_min, m.ip_ev, m.n_oh, JSON.stringify(m.sites), m.level]
      );
    }
    console.log('seeded qm');
  }
}
