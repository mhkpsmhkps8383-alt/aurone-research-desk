/**
 * PubChem — بزرگ‌ترین پایگاه آزادِ ترکیبات شیمیایی، بدون کلید و بدون هزینه.
 * از مرورگر خوانده می‌شود چون تصویر ساختار را هم مستقیم به صفحه می‌دهد.
 */

const PUG = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';

const PROPS = [
  'MolecularFormula', 'MolecularWeight', 'CanonicalSMILES', 'ConnectivitySMILES',
  'IsomericSMILES', 'InChIKey', 'XLogP', 'TPSA', 'HBondDonorCount',
  'HBondAcceptorCount', 'RotatableBondCount', 'HeavyAtomCount', 'Charge',
].join(',');

async function pug(path) {
  const r = await fetch(PUG + path, { headers: { accept: 'application/json' } });
  if (r.status === 404) throw new Error('در PubChem پیدا نشد');
  if (!r.ok) throw new Error('PubChem پاسخ نداد (' + r.status + ')');
  return r.json();
}

const isSmiles = (s) => /^[A-Za-z0-9@+\-[\]()\\/=#$%.]+$/.test(s) && /[=#()[\]]|[A-Z][a-z]?\d/.test(s);

/** تصویر دوبعدی ساختار — آدرسی که مستقیم در <img> می‌نشیند. */
export const structureUrl = (cid, big = false) =>
  `${PUG}/compound/cid/${cid}/PNG?image_size=${big ? 'large' : '300x300'}`;

/** نام ترکیب یا SMILES را بگیر و هر چه PubChem دارد برگردان. */
export async function lookup(query) {
  const qv = String(query || '').trim();
  if (!qv) throw new Error('نام ترکیب یا SMILES را بنویسید');
  const route = isSmiles(qv) ? 'smiles' : 'name';
  const j = await pug(`/compound/${route}/${encodeURIComponent(qv)}/property/${PROPS}/JSON`);
  const p = j.PropertyTable?.Properties?.[0];
  if (!p) throw new Error('در PubChem پیدا نشد');

  // نام‌های دیگر همان ترکیب — برای اطمینان از اینکه درست را گرفته‌ایم
  let synonyms = [];
  try {
    const s = await pug(`/compound/cid/${p.CID}/synonyms/JSON`);
    synonyms = (s.InformationList?.Information?.[0]?.Synonym || []).slice(0, 6);
  } catch { /* مهم نیست */ }

  const mw = Number(p.MolecularWeight);
  const logp = p.XLogP == null ? null : Number(p.XLogP);
  const hbd = p.HBondDonorCount, hba = p.HBondAcceptorCount;

  // قاعدهٔ پنج لیپینسکی — همان چیزی که برای دارومانندی نگاه می‌کنند
  const viol = [mw > 500, logp != null && logp > 5, hbd > 5, hba > 10].filter(Boolean).length;

  return {
    cid: p.CID,
    name: synonyms[0] || qv,
    synonyms,
    formula: p.MolecularFormula || null,
    mw: Number.isFinite(mw) ? mw : null,
    smiles: p.ConnectivitySMILES || p.CanonicalSMILES || p.IsomericSMILES || null,
    inchikey: p.InChIKey || null,
    logp,
    tpsa: p.TPSA == null ? null : Number(p.TPSA),
    hbd, hba,
    rotb: p.RotatableBondCount,
    heavy: p.HeavyAtomCount,
    lipinskiViolations: viol,
    drugLike: viol <= 1,
    image: structureUrl(p.CID),
    page: `https://pubchem.ncbi.nlm.nih.gov/compound/${p.CID}`,
  };
}

/** ترکیب‌هایی که ساختارشان شبیه این است — برای پیدا کردن آنالوگ. */
export async function similar(smiles, limit = 12) {
  const j = await pug(`/compound/fastsimilarity_2d/smiles/${encodeURIComponent(smiles)}/property/MolecularFormula,MolecularWeight,ConnectivitySMILES/JSON?Threshold=90&MaxRecords=${limit}`);
  return (j.PropertyTable?.Properties || []).map((p) => ({
    cid: p.CID,
    formula: p.MolecularFormula,
    mw: Number(p.MolecularWeight),
    smiles: p.ConnectivitySMILES,
    image: structureUrl(p.CID),
    page: `https://pubchem.ncbi.nlm.nih.gov/compound/${p.CID}`,
  }));
}
