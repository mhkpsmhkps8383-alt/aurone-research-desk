/**
 * ChEMBL — پایگاه آزادِ فعالیت زیستی، نگهداری‌شده توسط EMBL-EBI.
 *
 * چرا مهم است: داده‌های IC50 و Ki را از دلِ مقالات شیمی دارویی استخراج و
 * یکدست کرده‌اند. همان کاری که در Reaxys برای بخش bioactivity می‌کنید،
 * اینجا رایگان و بدون کلید در دسترس است. فقط دادهٔ واکنش و سنتز را ندارد.
 *
 * از مرورگر خوانده می‌شود (CORS دارد) تا سهمیهٔ مشترکِ سرور درگیر نشود.
 */

const B = 'https://www.ebi.ac.uk/chembl/api/data';

async function get(path) {
  const r = await fetch(B + path, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error('ChEMBL پاسخ نداد (' + r.status + ')');
  return r.json();
}

const looksSmiles = (s) =>
  /[=#()[\]]/.test(s) && /^[A-Za-z0-9@+\-[\]()\\/=#$%.]+$/.test(s.trim());

export const structureUrl = (id) => `${B}/image/${id}?format=svg&dimensions=250`;
export const chemblPage = (id) => `https://www.ebi.ac.uk/chembl/compound_report_card/${id}/`;

function shapeMolecule(m) {
  const p = m.molecule_properties || {};
  return {
    id: m.molecule_chembl_id,
    name: m.pref_name || null,
    smiles: m.molecule_structures?.canonical_smiles || null,
    mw: p.full_mwt ? Number(p.full_mwt) : null,
    logp: p.alogp != null ? Number(p.alogp) : null,
    hbd: p.hbd, hba: p.hba, tpsa: p.psa != null ? Number(p.psa) : null,
    ro5: p.num_ro5_violations,
    // تا کجا پیش رفته: ۴ یعنی داروی تأییدشده، ۰ یعنی فقط پژوهشی
    maxPhase: m.max_phase == null ? null : Number(m.max_phase),
    image: structureUrl(m.molecule_chembl_id),
    page: chemblPage(m.molecule_chembl_id),
  };
}

/** نام ترکیب یا SMILES را به رکورد ChEMBL تبدیل می‌کند. */
export async function findMolecule(query) {
  const qv = String(query || '').trim();
  if (!qv) throw new Error('نام ترکیب یا SMILES را بنویسید');
  if (looksSmiles(qv)) {
    const j = await get(`/molecule?molecule_structures__canonical_smiles__flexmatch=${encodeURIComponent(qv)}&format=json&limit=1`);
    if (j.molecules?.length) return shapeMolecule(j.molecules[0]);
  }
  const j = await get(`/molecule/search?q=${encodeURIComponent(qv)}&format=json&limit=1`);
  if (!j.molecules?.length) throw new Error('در ChEMBL پیدا نشد');
  return shapeMolecule(j.molecules[0]);
}

/** مرجع‌های مقالاتی که این اندازه‌گیری‌ها از آنها آمده‌اند. */
async function documents(ids) {
  const uniq = [...new Set(ids.filter(Boolean))].slice(0, 50);
  if (!uniq.length) return new Map();
  const out = new Map();
  for (let i = 0; i < uniq.length; i += 20) {
    try {
      const j = await get(`/document/set/${uniq.slice(i, i + 20).join(';')}?format=json`);
      for (const d of j.documents || []) {
        out.set(d.document_chembl_id, {
          doi: d.doi || null,
          title: d.title || null,
          journal: d.journal || null,
          year: d.year || null,
        });
      }
    } catch { /* بدون مرجع هم ردیف‌ها مفیدند */ }
  }
  return out;
}

function shapeActivity(a, docs) {
  const d = docs.get(a.document_chembl_id) || {};
  return {
    molecule: a.molecule_chembl_id,
    type: a.standard_type || a.type || null,
    relation: a.standard_relation || '=',
    value: a.standard_value != null ? Number(a.standard_value) : null,
    units: a.standard_units || null,
    // pChEMBL لگاریتم منفیِ غلظت مولار است؛ برای مرتب کردن قدرت اثر بهترین معیار
    pchembl: a.pchembl_value != null ? Number(a.pchembl_value) : null,
    target: a.target_pref_name || null,
    organism: a.target_organism || null,
    assay: a.assay_description ? String(a.assay_description).slice(0, 160) : null,
    doi: d.doi || null,
    refTitle: d.title || null,
    journal: d.journal || null,
    year: d.year || null,
  };
}

/** همهٔ آنچه روی یک ترکیب اندازه گرفته‌اند. */
export async function activitiesOf(chemblId, { limit = 60, onlyPotency = true } = {}) {
  const typeFilter = onlyPotency ? '&standard_type__in=IC50,EC50,Ki,Kd,MIC,GI50' : '';
  const j = await get(
    `/activity?molecule_chembl_id=${chemblId}${typeFilter}&format=json&limit=${limit}`);
  const acts = j.activities || [];
  const docs = await documents(acts.map((a) => a.document_chembl_id));
  const rows = acts.map((a) => shapeActivity(a, docs));
  rows.sort((x, y) => (y.pchembl ?? -1) - (x.pchembl ?? -1));
  return { total: j.page_meta?.total_count ?? rows.length, rows };
}

/** جست‌وجوی هدف زیستی: آنزیم یا گیرنده. */
export async function findTargets(query, limit = 8) {
  const qv = String(query || '').trim().toLowerCase();
  const j = await get(`/target/search?q=${encodeURIComponent(query)}&format=json&limit=${limit}`);
  const rows = (j.targets || []).map((t) => ({
    id: t.target_chembl_id,
    name: t.pref_name || '',
    organism: t.organism || '',
    kind: t.target_type || '',
  }));
  // ChEMBL گاهی آنزیم حشره را اول می‌آورد؛ هدفِ انسانی با نام دقیق مفیدتر است
  const score = (t) => {
    const n = t.name.toLowerCase();
    return (n === qv ? 4 : n.includes(qv) ? 2 : 0)
      + (/homo sapiens/i.test(t.organism) ? 3 : 0)
      + (t.kind === 'SINGLE PROTEIN' ? 1 : 0);
  };
  return rows.sort((a, b) => score(b) - score(a));
}

/**
 * همهٔ ترکیباتی که روی یک هدف سنجیده شده‌اند، از قوی به ضعیف.
 * این همان جدولی است که یک کار SAR از آن شروع می‌شود.
 */
export async function activitiesForTarget(targetId, { limit = 50, type = 'IC50' } = {}) {
  const j = await get(
    `/activity?target_chembl_id=${targetId}&standard_type=${encodeURIComponent(type)}` +
    `&pchembl_value__isnull=false&format=json&limit=${limit}&order_by=-pchembl_value`);
  const acts = j.activities || [];
  const docs = await documents(acts.map((a) => a.document_chembl_id));
  const rows = acts.map((a) => shapeActivity(a, docs));

  // نام و ساختار ترکیب‌ها را یکجا می‌گیریم
  const ids = [...new Set(rows.map((r) => r.molecule))].slice(0, 40);
  const names = new Map();
  for (let i = 0; i < ids.length; i += 20) {
    try {
      const m = await get(`/molecule/set/${ids.slice(i, i + 20).join(';')}?format=json`);
      for (const mol of m.molecules || []) names.set(mol.molecule_chembl_id, shapeMolecule(mol));
    } catch { /* بی‌نام هم قابل استفاده است */ }
  }
  rows.forEach((r) => { r.mol = names.get(r.molecule) || null; });
  rows.sort((x, y) => (y.pchembl ?? -1) - (x.pchembl ?? -1));
  return { total: j.page_meta?.total_count ?? rows.length, rows };
}

/** ترکیب‌هایی با ساختار نزدیک — برای پیدا کردن آنالوگ. */
export async function similar(smiles, threshold = 70, limit = 12) {
  const j = await get(`/similarity/${encodeURIComponent(smiles)}/${threshold}?format=json&limit=${limit}`);
  return (j.molecules || []).map(shapeMolecule);
}
