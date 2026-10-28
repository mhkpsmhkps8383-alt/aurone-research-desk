/**
 * ویرایشگر ترسیم ساختار شیمیایی (JSME) و شناسایی آنچه کشیده‌اید.
 *
 * JSME رایگان است و کامل در مرورگر اجرا می‌شود؛ هیچ ساختاری جایی فرستاده
 * نمی‌شود مگر وقتی خودتان بخواهید در PubChem دنبالش بگردیم.
 */

const JSME_SRC = 'https://cdn.jsdelivr.net/npm/jsme-editor@2024.4.29/jsme.nocache.js';
const PUG = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';

let appletPromise = null;

/** ویرایشگر را یک‌بار بار می‌کند و نمونه‌اش را برمی‌گرداند. */
export function sketcher(containerId, { width = '100%', height = '360px' } = {}) {
  if (appletPromise) return appletPromise;
  appletPromise = new Promise((ok, bad) => {
    const timer = setTimeout(() => bad(new Error('ویرایشگر ساختار دیر بار شد')), 30000);
    // JSME پس از آماده شدن این تابع سراسری را صدا می‌زند
    window.jsmeOnLoad = () => {
      clearTimeout(timer);
      try { ok(new window.JSApplet.JSME(containerId, width, height)); }
      catch (e) { bad(e); }
    };
    const s = document.createElement('script');
    s.src = JSME_SRC;
    s.onerror = () => { clearTimeout(timer); bad(new Error('بارگذاری ویرایشگر ساختار شکست خورد')); };
    document.head.appendChild(s);
  });
  return appletPromise;
}

/**
 * SMILES نویسه‌هایی مثل / و # و + دارد که در آدرس معنا دارند، پس PubChem
 * خودش توصیه می‌کند برای ساختار از POST استفاده شود.
 */
async function pugPost(path, smiles) {
  const r = await fetch(PUG + path, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: 'smiles=' + encodeURIComponent(smiles),
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('PubChem پاسخ نداد (' + r.status + ')');
  return r.json();
}

const PROPS = [
  'MolecularFormula', 'MolecularWeight', 'ConnectivitySMILES', 'CanonicalSMILES',
  'IsomericSMILES', 'InChIKey', 'IUPACName', 'XLogP', 'TPSA',
  'HBondDonorCount', 'HBondAcceptorCount', 'RotatableBondCount',
].join(',');

/** ساختار کشیده‌شده را در PubChem می‌شناسد: نام، فرمول، خواص. */
export async function identify(smiles) {
  if (!smiles || smiles.length < 2) throw new Error('اول ساختاری بکشید');
  const j = await pugPost(`/compound/smiles/property/${PROPS}/JSON`, smiles);
  const p = j?.PropertyTable?.Properties?.[0];
  if (!p?.CID) return { found: false, smiles };

  let synonyms = [];
  try {
    const s = await fetch(`${PUG}/compound/cid/${p.CID}/synonyms/JSON`).then((r) => r.json());
    synonyms = (s.InformationList?.Information?.[0]?.Synonym || [])
      .filter((x) => x.length > 4 && x.length < 90 &&
        !/^(MFCD|SCHEMBL|DTXSID|AKOS|UNII|EINECS|NSC|CID|Q\d|\d{2,7}-\d{2}-\d$)/i.test(x))
      .slice(0, 20);
  } catch { /* بی‌نام هم قابل استفاده است */ }

  const mw = Number(p.MolecularWeight);
  const logp = p.XLogP == null ? null : Number(p.XLogP);
  const viol = [mw > 500, logp != null && logp > 5,
    p.HBondDonorCount > 5, p.HBondAcceptorCount > 10].filter(Boolean).length;

  return {
    found: true,
    cid: p.CID,
    iupac: p.IUPACName || null,
    // نام رایج معمولاً کوتاه‌ترین مترادفِ غیرکدی است
    common: synonyms.slice().sort((a, b) => a.length - b.length)[0] || null,
    synonyms,
    formula: p.MolecularFormula || null,
    mw: Number.isFinite(mw) ? mw : null,
    smiles: p.ConnectivitySMILES || p.CanonicalSMILES || smiles,
    inchikey: p.InChIKey || null,
    logp, tpsa: p.TPSA == null ? null : Number(p.TPSA),
    hbd: p.HBondDonorCount, hba: p.HBondAcceptorCount, rotb: p.RotatableBondCount,
    lipinskiViolations: viol,
    drugLike: viol <= 1,
    image: `${PUG}/compound/cid/${p.CID}/PNG?image_size=300x300`,
    page: `https://pubchem.ncbi.nlm.nih.gov/compound/${p.CID}`,
  };
}

/** ترکیب‌های شبیه، برای وقتی خودِ ساختار در PubChem نیست. */
export async function closest(smiles, { threshold = 85, limit = 8 } = {}) {
  const j = await pugPost(
    `/compound/fastsimilarity_2d/smiles/property/MolecularFormula,MolecularWeight,ConnectivitySMILES/JSON?Threshold=${threshold}&MaxRecords=${limit}`,
    smiles);
  return (j?.PropertyTable?.Properties || []).map((p) => ({
    cid: p.CID,
    formula: p.MolecularFormula,
    mw: Number(p.MolecularWeight),
    smiles: p.ConnectivitySMILES,
    image: `${PUG}/compound/cid/${p.CID}/PNG?image_size=180x180`,
    page: `https://pubchem.ncbi.nlm.nih.gov/compound/${p.CID}`,
  }));
}

/** ترکیب‌هایی که این ساختار را به‌عنوان زیرساختار در خود دارند. */
export async function containing(smiles, { limit = 12 } = {}) {
  const j = await pugPost(
    `/compound/fastsubstructure/smiles/property/MolecularFormula,MolecularWeight,ConnectivitySMILES/JSON?MaxRecords=${limit}`,
    smiles);
  return (j?.PropertyTable?.Properties || []).map((p) => ({
    cid: p.CID,
    formula: p.MolecularFormula,
    mw: Number(p.MolecularWeight),
    smiles: p.ConnectivitySMILES,
    image: `${PUG}/compound/cid/${p.CID}/PNG?image_size=180x180`,
    page: `https://pubchem.ncbi.nlm.nih.gov/compound/${p.CID}`,
  }));
}

/** نام چند CID را یکجا می‌گیرد — برای جست‌وجوی مقاله لازم است. */
export async function namesOf(cids) {
  const out = new Map();
  for (let i = 0; i < cids.length; i += 10) {
    const part = cids.slice(i, i + 10).join(',');
    try {
      const j = await fetch(`${PUG}/compound/cid/${part}/property/IUPACName/JSON`).then((r) => r.json());
      for (const p of j.PropertyTable?.Properties || []) out.set(p.CID, p.IUPACName || null);
    } catch { /* رد شو */ }
  }
  return out;
}
