/**
 * ترجمهٔ متن مقاله به فارسی — رایگان و بدون کلید.
 *
 * دو موتور، به ترتیب اولویت:
 *  ۱) مترجمِ درون‌ساختهٔ مرورگر (Chrome ۱۳۸ به بعد). روی خود دستگاه اجرا
 *     می‌شود، سقف ندارد و متن جایی فرستاده نمی‌شود.
 *  ۲) MyMemory — سرویس آزاد، بدون کلید، ولی سقف روزانه دارد.
 *
 * ترجمهٔ ماشینیِ متن علمی پیش‌نویس است، نه ترجمهٔ نهایی: اصطلاحات تخصصی و
 * نام ترکیبات را باید خودتان بازبینی کنید. برای همین متن اصلی همیشه کنارش می‌ماند.
 */

const MM = 'https://api.mymemory.translated.net/get';

/** موتورهایی که همین حالا در دسترس‌اند. */
export async function availableEngines() {
  const out = [];
  try {
    const T = globalThis.Translator;
    if (T?.availability) {
      const a = await T.availability({ sourceLanguage: 'en', targetLanguage: 'fa' });
      if (a && a !== 'unavailable') {
        out.push({ key: 'browser', label: 'مترجم خود مرورگر', note: a === 'available' ? 'آمادهٔ استفاده' : 'بار اول باید بستهٔ زبان دانلود شود', state: a });
      }
    }
  } catch { /* مرورگر پشتیبانی نمی‌کند */ }
  out.push({ key: 'mymemory', label: 'MyMemory', note: 'سرویس آزاد، سقف روزانه دارد' });
  return out;
}

/* ───── موتور مرورگر */
let browserTranslator = null;
async function browserEngine(onProgress) {
  if (browserTranslator) return browserTranslator;
  const T = globalThis.Translator;
  if (!T?.create) throw new Error('مرورگر شما مترجم درون‌ساخته ندارد');
  browserTranslator = await T.create({
    sourceLanguage: 'en',
    targetLanguage: 'fa',
    monitor(m) {
      m.addEventListener?.('downloadprogress', (e) => {
        onProgress?.('دانلود بستهٔ زبان: ' + Math.round((e.loaded || 0) * 100) + '٪');
      });
    },
  });
  return browserTranslator;
}

/* ───── MyMemory: تکه‌تکه، چون سقف هر درخواست کوتاه است */
async function myMemoryChunk(text) {
  const u = `${MM}?q=${encodeURIComponent(text)}&langpair=en|fa`;
  const r = await fetch(u);
  if (!r.ok) throw new Error('سرویس ترجمه پاسخ نداد (' + r.status + ')');
  const j = await r.json();
  if (j.responseStatus && Number(j.responseStatus) !== 200) {
    throw new Error(String(j.responseDetails || 'سرویس ترجمه خطا داد').slice(0, 120));
  }
  return j.responseData?.translatedText || '';
}

/** متن را به تکه‌هایی می‌شکند که از مرز جمله رد نشوند. */
export function chunk(text, max = 480) {
  const parts = [];
  let buf = '';
  for (const piece of String(text).split(/(?<=[.!?؟؛])\s+/)) {
    if ((buf + ' ' + piece).trim().length > max) {
      if (buf) parts.push(buf.trim());
      // جمله‌ای که خودش از سقف بلندتر است را سر فاصله می‌شکنیم
      if (piece.length > max) {
        let rest = piece;
        while (rest.length > max) {
          const cut = rest.lastIndexOf(' ', max);
          parts.push(rest.slice(0, cut > 40 ? cut : max).trim());
          rest = rest.slice(cut > 40 ? cut : max);
        }
        buf = rest;
      } else buf = piece;
    } else buf = (buf ? buf + ' ' : '') + piece;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

/**
 * ترجمهٔ یک متن.
 * @param text متن انگلیسی
 * @param opt {engine, onProgress(done,total,note)}
 */
export async function translate(text, { engine = 'auto', onProgress = () => {} } = {}) {
  const src = String(text || '').trim();
  if (!src) throw new Error('متنی برای ترجمه نیست');

  let use = engine;
  if (use === 'auto') {
    const list = await availableEngines();
    use = list[0]?.key || 'mymemory';
  }

  if (use === 'browser') {
    onProgress(0, 1, 'آماده‌سازی مترجم مرورگر…');
    const tr = await browserEngine((note) => onProgress(0, 1, note));
    const parts = chunk(src, 3000);
    const out = [];
    for (let i = 0; i < parts.length; i++) {
      onProgress(i, parts.length, 'ترجمه…');
      out.push(await tr.translate(parts[i]));
    }
    onProgress(parts.length, parts.length, '');
    return { text: out.join(' '), engine: 'مترجم خود مرورگر' };
  }

  const parts = chunk(src, 480);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    onProgress(i, parts.length, 'ترجمهٔ تکهٔ ' + (i + 1) + ' از ' + parts.length);
    out.push(await myMemoryChunk(parts[i]));
    // سرویس آزاد است؛ پشت سر هم کوبیدن باعث بسته شدن می‌شود
    if (i < parts.length - 1) await new Promise((r) => setTimeout(r, 350));
  }
  onProgress(parts.length, parts.length, '');
  return { text: out.join(' '), engine: 'MyMemory' };
}

/**
 * متن مقاله را به بخش‌های عنوان‌دار می‌شکند، تا بشود گفت «فقط این بخش را ترجمه کن».
 * سرفصل‌ها سطرهای کوتاه‌اند؛ همان قاعده‌ای که در خلاصه‌سازی هم به کار می‌رود.
 */
export function sections(text) {
  const KNOWN = /^(\d+\s*[.)-]?\s*)?(abstract|summary|introduction|background|related work|materials?\s*(and|&)\s*methods?|methods?|experimental([\s-]*section)?|chemistry|synthesis|results?([\s-]*and[\s-]*discussion)?|discussion|conclusions?|acknowledge?ments?|references?|supporting information|abbreviations|keywords?|data availability|conflicts? of interest|چکیده|مقدمه|روش.*|نتایج|بحث|نتیجه.?گیری|منابع)\s*:?\s*$/i;
  const lines = String(text).split(/\n|\f/);
  const out = [];
  let cur = { title: 'ابتدای مقاله', body: [] };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { cur.body.push(''); continue; }
    const short = line.length <= 70;
    const isHead = short && (KNOWN.test(line) ||
      (/^[\d.]+\s+\S/.test(line) && line.length < 60) ||
      (line === line.toUpperCase() && /[A-Z]{3}/.test(line) && line.length < 60));
    if (isHead) {
      if (cur.body.join(" ").trim().length > 40) out.push(cur);
      cur = { title: line, body: [] };
    } else cur.body.push(line);
  }
  if (cur.body.join(" ").trim().length > 40) out.push(cur);
  return out.map((s, i) => ({
    i,
    title: s.title,
    text: s.body.join(' ').replace(/\s+/g, ' ').trim(),
  })).filter((s) => s.text.length > 40);
}
