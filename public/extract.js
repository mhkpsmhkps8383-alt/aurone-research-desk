/**
 * بیرون کشیدن اعدادِ زیست‌سنجی از متن مقاله — با الگو، نه با هوش مصنوعی.
 *
 * چیزی که یک مرورِ SAR را می‌سازد، همین اعداد است: IC50 فلان ترکیب در فلان
 * آزمون. این‌ها در متن مقالات شکل‌های بسیار یکنواختی دارند، پس با الگوی متنی
 * قابل استخراج‌اند. هر عدد با متنِ دور و برش برمی‌گردد تا بشود راستی‌آزمایی کرد.
 */

/* آزمون‌هایی که در کار آنتی‌اکسیدانی و مهار آنزیم تکرار می‌شوند */
const ASSAYS = [
  ['DPPH', /\bDPPH\b/i], ['ABTS', /\bABTS\b/i], ['FRAP', /\bFRAP\b/i],
  ['ORAC', /\bORAC\b/i], ['CUPRAC', /\bCUPRAC\b/i],
  ['سوپراکسید', /superoxide|O2[•·]?[-−]/i], ['هیدروکسیل', /hydroxyl\s+radical/i],
  ['نیتریک اکسید', /nitric\s+oxide|\bNO\b\s+scavenging/i],
  ['لیپید پراکسیداسیون', /lipid\s+peroxidation|TBARS|MDA/i],
  ['گزانتین اکسیداز', /xanthine\s+oxidase/i], ['تیروزیناز', /tyrosinase/i],
  ['استیل‌کولین‌استراز', /acetylcholinesterase|\bAChE\b/i],
  ['بوتیریل‌کولین‌استراز', /butyrylcholinesterase|\bBChE\b/i],
  ['مونوآمین اکسیداز', /monoamine\s+oxidase|\bMAO[-\s]?[AB]?\b/i],
  ['آلفا-گلوکوزیداز', /α-?glucosidase|alpha-?glucosidase/i],
  ['آلفا-آمیلاز', /α-?amylase|alpha-?amylase/i],
  ['۵-لیپواکسیژناز', /5-?lipoxygenase|\b5-?LOX\b/i],
  ['سیکلواکسیژناز', /cyclooxygenase|\bCOX-?[12]\b/i],
  ['کولین‌استراز', /cholinesterase/i], ['آروماتاز', /aromatase/i],
  ['توپوایزومراز', /topoisomerase/i], ['کیناز', /\bkinase\b/i],
  ['Nrf2', /\bNrf-?2\b|\bKeap-?1\b|\bARE\b/i],
  ['سمیت سلولی', /cytotox|\bMTT\b|cell\s+viability/i],
  ['ضدمیکروبی', /antibacterial|antimicrobial|antifungal/i],
];

/* نام معیار و واحدهایی که معنا دارند */
// هیچ الگوی تودرتویی اینجا نیست: الگوهای تودرتو روی متن بلند، مرورگر را
// با backtracking قفل می‌کنند. به جایش اول نام معیار را پیدا می‌کنیم و بعد
// فقط در یک پنجرهٔ کوتاهِ بعد از آن دنبال عدد و واحد می‌گردیم.
// \b لازم است وگرنه Ki داخل «skin» و «Kinetic» هم می‌افتد.
const RX_METRIC = /\b(IC\s?50|IC₅₀|EC\s?50|EC₅₀|SC\s?50|SC₅₀|GI\s?50|LD\s?50|LC\s?50|MIC|MBC|Ki|Kd|ED\s?50)\b/gi;
const RX_UNIT = /(n[Mm]|µ[Mm]|μ[Mm]|uM|mM|mg\s?\/\s?m[Ll]|g\s?\/\s?m[Ll]|µg\s?\/\s?m[Ll]|μg\s?\/\s?m[Ll]|ppm|%)/;
const RX_PLAIN_NUM = /\d{1,4}(?:[.,]\d{1,3})?/g;
const WINDOW = 150;   // عدد معمولاً بلافاصله بعد از نام معیار می‌آید

/* برچسب ترکیب: «compound 7»، «7a»، «derivative 12» */
const RX_LABEL = /\b(?:compound|cpd|derivative|analog(?:ue)?|ligand)\s*[-–]?\s*([0-9]{1,3}[a-z]{0,2})\b/gi;

const tidy = (s) => s.replace(/\s+/g, ' ').trim();

function unitOf(raw) {
  const u = raw.replace(/\s+/g, '').replace(/μ/g, 'µ');
  if (/^µM$/i.test(u)) return 'µM';
  if (/^nM$/i.test(u)) return 'nM';
  if (/^mM$/i.test(u)) return 'mM';
  if (/^µg\/mL$/i.test(u)) return 'µg/mL';
  if (/^mg\/mL$/i.test(u)) return 'mg/mL';
  if (/^g\/mL$/i.test(u)) return 'g/mL';
  return u;
}

/** آزمونی که نزدیک‌ترین نام را به این نقطهٔ متن دارد. */
function assayNear(text, at, span = 420) {
  const win = text.slice(Math.max(0, at - span), at + span);
  const found = [];
  for (const [name, rx] of ASSAYS) if (rx.test(win)) found.push(name);
  return found;
}

/** برچسب ترکیبی که درست قبل از این عدد آمده. */
function labelNear(text, at, back = 220) {
  const win = text.slice(Math.max(0, at - back), at + 60);
  let last = null, m;
  RX_LABEL.lastIndex = 0;
  while ((m = RX_LABEL.exec(win))) last = m[1];
  return last;
}

/**
 * همهٔ اندازه‌گیری‌های متن را درمی‌آورد.
 * @returns {Array<{metric,value,unit,assays,compound,context}>}
 */
export function extractMeasures(text, { limit = 60 } = {}) {
  if (!text) return [];
  const t = String(text).replace(/ /g, ' ');
  const out = [];
  const seen = new Set();
  let m;
  RX_METRIC.lastIndex = 0;
  while ((m = RX_METRIC.exec(t)) && out.length < limit) {
    const metric = m[1].replace(/\s+/g, '').replace('₅₀', '50').toUpperCase();
    const at = m.index;

    // پنجرهٔ کوتاه بعد از نام معیار؛ انحراف معیار (± …) را کنار می‌گذاریم
    const win = t.slice(m.index + m[0].length, m.index + m[0].length + WINDOW)
      .replace(/±\s*\d{1,4}(?:[.,]\d{1,3})?/g, ' ')
      // «compound 12» شمارهٔ ترکیب است نه مقدارِ اندازه‌گیری
      .replace(/\b(?:compound|cpd|derivative|analog(?:ue)?|ligand|entry|No\.?)\s*[-–]?\s*\d{1,3}[a-z]{0,2}\b/gi, ' ');
    const u = RX_UNIT.exec(win);
    if (!u || u.index > 110) continue;
    const unit = unitOf(u[1]);
    // همهٔ عددهایی که پیش از واحد آمده‌اند: «values of 6.3, 9.9 and 14.2 µM»
    const nums = (win.slice(0, u.index).match(RX_PLAIN_NUM) || []).slice(0, 8);
    if (!nums.length) continue;
    const assays = assayNear(t, at);
    const compound = labelNear(t, at);
    const context = tidy(t.slice(Math.max(0, at - 130), at + 170));
    // یک عبارت ممکن است چند عدد داشته باشد؛ هر کدام یک اندازه‌گیری است
    for (const piece of nums) {
      const value = piece.replace(',', '.');
      const key = metric + value + unit;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ metric, value, unit, assays, compound, context });
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** آزمون‌هایی که این مقاله اصلاً انجام داده، فارغ از عدد. */
export function detectAssays(text) {
  if (!text) return [];
  const t = String(text);
  return ASSAYS.filter(([, rx]) => rx.test(t)).map(([name]) => name);
}

/** خلاصهٔ یک‌خطی از قوی‌ترین عدد هر آزمون — برای ستون جدول. */
export function bestPerAssay(measures) {
  const best = new Map();
  for (const x of measures) {
    const v = parseFloat(x.value);
    if (!Number.isFinite(v)) continue;
    for (const a of x.assays.length ? x.assays : ['—']) {
      const cur = best.get(a);
      // در IC50 و هم‌خانواده‌هایش، عددِ کمتر یعنی قوی‌تر
      if (!cur || v < parseFloat(cur.value)) best.set(a, x);
    }
  }
  return [...best.entries()].map(([assay, x]) => ({ assay, ...x }));
}
