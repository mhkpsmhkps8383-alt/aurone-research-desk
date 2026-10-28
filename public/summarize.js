/**
 * خلاصه‌سازی استخراجی — تماماً در مرورگر، بدون هیچ سرویس بیرونی و بدون هوش مصنوعی.
 *
 * روشش این است: مهم‌ترین جمله‌های خودِ متن را پیدا می‌کند و بیرون می‌کشد.
 * جمله‌ای مهم است که واژه‌های پرتکرارِ معنادارِ متن را بیشتر داشته باشد (TF-ISF)،
 * نزدیک ابتدای متن باشد، و واژه‌های عنوان در آن تکرار شده باشد.
 * جمله‌ها را بازنویسی نمی‌کند — همان جملات نویسنده را به ترتیب اصلی برمی‌گرداند.
 * فارسی و انگلیسی هر دو.
 */

/**
 * ترمیم متنِ فارسیِ بیرون‌آمده از PDF.
 * استخراج‌کننده‌های PDF پیوندِ «لا» را می‌شکنند و وارونه بیرون می‌دهند، پس
 * «سلامت» می‌شود «سالمت» و «اختلال» می‌شود «اختالل». دو کار می‌کنیم:
 * اول شکل‌های نمایشیِ عربی (FB50–FEFF) را به حرف پایه برمی‌گردانیم — این
 * ریشهٔ مشکل در بسیاری از فایل‌هاست — و بعد پرتکرارترین واژه‌هایی را که
 * این‌طور خراب می‌شوند تصحیح می‌کنیم. متنِ اصلیِ ذخیره‌شده دست‌نخورده می‌ماند.
 */
const LIGATURES = {
  'ﻻ': 'لا', 'ﻼ': 'لا', 'ﻵ': 'لآ', 'ﻶ': 'لآ',
  'ﻷ': 'لأ', 'ﻸ': 'لأ', 'ﻹ': 'لإ', 'ﻺ': 'لإ',
};
const BROKEN = [
  ['سالمت', 'سلامت'], ['اختالل', 'اختلال'], ['اختالف', 'اختلاف'],
  ['تحوالت', 'تحولات'], ['فعاالن', 'فعالان'], ['مسئوالنه', 'مسئولانه'],
  ['مسئوالن', 'مسئولان'], ['رگوالتوری', 'رگولاتوری'], ['اعالم', 'اعلام'],
  ['اسالمی', 'اسلامی'], ['انقالب', 'انقلاب'], ['مقاالت', 'مقالات'],
  ['اطالعات', 'اطلاعات'], ['اطالع', 'اطلاع'], ['استقالل', 'استقلال'],
  ['تالش', 'تلاش'], ['خالصه', 'خلاصه'], ['عالوه', 'علاوه'],
  ['کالس', 'کلاس'], ['اخالق', 'اخلاق'], ['اصالح', 'اصلاح'],
  ['اعالن', 'اعلان'], ['بالفاصله', 'بلافاصله'], ['پالسما', 'پلاسما'],
  ['طالیی', 'طلایی'], ['عالئم', 'علائم'], ['عالقه', 'علاقه'],
  ['ابتال', 'ابتلا'], ['باال', 'بالا'], ['کاال', 'کالا'],
  ['احتماال', 'احتمالا'], ['کامال', 'کاملا'], ['اصوال', 'اصولا'],
  ['اوال', 'اولا'], ['تعاالت', 'تعالات'], ['اشتغال زایی', 'اشتغال‌زایی'],
];
export function repairPdfPersian(s = '') {
  let t = String(s).replace(/[ﭐ-﻿]/g, (ch) => LIGATURES[ch] || ch);
  for (const [bad, good] of BROKEN) t = t.split(bad).join(good);
  return t;
}

/* ───── یکدست‌سازی نویسه‌های عربی و فارسی */
export function normalize(s = '') {
  return String(s)
    .replace(/[يی]/g, 'ی')   // ي عربی → ی
    .replace(/[ك]/g, 'ک')          // ك عربی → ک
    .replace(/[ً-ْٰ]/g, '')   // اعراب
    .replace(/‌/g, '')                  // نیم‌فاصله واژه را نمی‌شکند: «سیاست‌گذاری» یک واژه است
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
}

const FA_STOP = `و در به از که را با این برای آن یک می بر های ها تا کرد شد است بود شده
اما یا هم نیز چه اگر پس هر همه خود دیگر وی باید نمی ای بی دو بین طور نوع مورد
بسیار تواند دارد دارند داشت داشته کند کنند کردن شود شوند بوده گفت دهد روی زیر
چون چرا کجا کدام وقتی هنگام سپس بنابراین همچنین ضمن علاوه یعنی مانند مثل مثلا
نسبت نظر عنوان طی ولی گرچه هرچند بلکه جز غیر بدون درباره توسط براساس اساس
شامل دارای است‌که آیا کل کلی عمده اصلی موجب باعث سبب نتیجه نتایج حال حاضر
بیش کم زیاد بیشتر کمتر خیلی تنها فقط حتی البته واقع واقعا قابل ممکن لازم
گردد گردید نمود نموده یافت یافته آورد آورده رسید رسیده گرفت گرفته داد داده
انجام استفاده وجود عدم طریق سمت جهت سوی سال سال‌های اول دوم سوم چند چندین`
  .split(/\s+/).filter(Boolean);

const EN_STOP = `the a an and or of to in on for with by from as is are was were be been being
that this these those it its at which who whom whose what when where how why
we our us they their them he she his her i you your not no nor but if then than
also such can could may might must shall should will would do does did done
have has had having more most less least very much many few other another same
however therefore thus hence moreover furthermore although though while whereas
between among within without during after before above below over under
study studies result results show shown showed using used use based due both
one two three first second new here there about into through each per via
et al fig figure table section paper article research`
  .split(/\s+/).filter(Boolean);

const STOP = new Set([...FA_STOP, ...EN_STOP]);

const WORD = /[؀-ۿA-Za-z][؀-ۿA-Za-z‌'-]*/g;

function words(s) {
  return (normalize(s).toLowerCase().match(WORD) || [])
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/* ───── تکه‌تکه کردن متن به جمله */
export function sentences(text) {
  const t = String(text)
    .replace(/\r/g, '')
    .replace(/-\n/g, '');             // واژهٔ شکسته سر سطر در PDF

  // سرفصل («۳. نتایج»، «Results and discussion») سطر کوتاهِ جداست، در حالی که
  // سطرهای متنِ اصلی بلندند و وسط جمله می‌شکنند. پس سطرِ کوتاه را مرز جمله
  // می‌گیریم و بقیه را به هم می‌چسبانیم. این‌طور سرفصل‌ها خودشان حذف می‌شوند
  // بدون اینکه واژه‌ای مثل Results از ابتدای یک جملهٔ واقعی کنده شود.
  const marked = t.split('\n').map((ln) => {
    const line = ln.trim();
    if (!line) return ' ¶ ';
    return line.length < 70 ? ' ¶ ' + line + ' ¶ ' : line + ' ';
  }).join('');

  const out = [];
  // نقطه‌ای که بعدش فاصله و حرف بیاید، یا علائم پایان جملهٔ فارسی
  for (const raw of marked.replace(/\s{2,}/g, ' ').split(/(?<=[.!?؟۔])\s+|\s*¶\s*|(?<=[؛])\s+/)) {
    const s = raw.trim().replace(/^[\s•·–—\-*]+/, '');
    if (s.length < 35 || s.length > 600) continue;
    const w = (s.match(WORD) || []).length;
    if (w < 6) continue;
    // سطرهای سرصفحه، شماره صفحه، فهرست منابع
    if (/^\d+\s*$/.test(s)) continue;
    if ((s.match(/\d/g) || []).length > s.length / 3) continue;
    if (/^(doi|https?:|www\.|©|\[\d+\])/i.test(s)) continue;
    out.push(s);
  }
  return out;
}

/* ───── پیدا کردن چکیدهٔ خودِ مقاله، اگر داشته باشد */
export function findAbstract(text) {
  const t = repairPdfPersian(String(text).replace(/\r/g, ''));
  const start = t.search(/(^|\n|\s)(چکیده|چکیدە|abstract|summary)\s*[:：.\-—]?\s*/i);
  if (start < 0) return null;
  const after = t.slice(start).replace(/^(\s|\n)*(چکیده|چکیدە|abstract|summary)\s*[:：.\-—]?\s*/i, '');
  const endRe = /(^|\n|\s)(کلیدواژه|کلید\s*واژه|واژگان\s*کلیدی|مقدمه|keywords?|key\s*words?|introduction|1\.\s*introduction)/i;
  const end = after.search(endRe);
  const body = (end > 60 ? after.slice(0, end) : after.slice(0, 2200))
    .replace(/\s+/g, ' ').trim();
  return body.length > 180 ? body.slice(0, 2000) : null;
}

/* ───── واژه‌های کلیدی */
export function keywords(text, n = 10) {
  const freq = new Map();
  for (const w of words(repairPdfPersian(text.slice(0, 60000)))) freq.set(w, (freq.get(w) || 0) + 1);
  return [...freq.entries()]
    .filter(([w, c]) => c > 2 && w.length > 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([w]) => w);
}

/**
 * خلاصهٔ استخراجی. جمله‌های برگزیده را به ترتیبِ اصلیِ متن برمی‌گرداند.
 * @param {string} text متن کامل
 * @param {object} opt {count: تعداد جمله, title: عنوان برای وزن‌دهی}
 */
export function summarize(text, { count = 5, title = '' } = {}) {
  const body = repairPdfPersian(String(text).slice(0, 120000));
  const sents = sentences(body);
  if (sents.length < 3) return '';
  // سند کوتاه نباید «خلاصه»ای به اندازهٔ خودش بگیرد
  count = Math.max(2, Math.min(count, Math.ceil(sents.length * 0.4)));

  // بسامد واژه در کل متن
  const tf = new Map();
  for (const w of words(body)) tf.set(w, (tf.get(w) || 0) + 1);
  const maxTf = Math.max(1, ...tf.values());

  // چند جمله هر واژه را دارد — واژه‌ای که همه‌جا هست، تمایزی نمی‌سازد
  const df = new Map();
  const toks = sents.map((s) => {
    const set = new Set(words(s));
    for (const w of set) df.set(w, (df.get(w) || 0) + 1);
    return set;
  });

  const titleWords = new Set(words(title || ''));
  const N = sents.length;

  const scored = sents.map((s, i) => {
    let score = 0;
    for (const w of toks[i]) {
      const isf = Math.log(1 + N / (1 + (df.get(w) || 0)));
      score += (tf.get(w) / maxTf) * isf;
      if (titleWords.has(w)) score += 0.45;
    }
    score /= Math.sqrt(toks[i].size || 1);            // جملهٔ بلند امتیاز مفت نگیرد
    if (i < N * 0.15) score *= 1.3;                    // ابتدای متن معمولاً مهم‌تر است
    if (i > N * 0.85) score *= 1.12;                   // نتیجه‌گیری هم همین‌طور
    // جمله‌هایی که صریحاً نتیجه را اعلام می‌کنند
    if (/(نتایج|نشان داد|یافته|نتیجه گرفت|در نهایت|هدف این|این مطالعه|این مقاله|conclusion|we (show|found|report)|results (show|indicate)|in summary)/i.test(normalize(s)))
      score *= 1.25;
    return { i, s, score };
  });

  const top = scored.sort((a, b) => b.score - a.score).slice(0, Math.min(count, N));
  top.sort((a, b) => a.i - b.i);
  return top.map((x) => x.s).join(' ');
}

/**
 * بهترین خلاصهٔ ممکن برای یک متن: اگر خودِ مقاله چکیده دارد همان را بده،
 * وگرنه جمله‌های کلیدی را بیرون بکش.
 */
export function bestSummary(text, title = '') {
  const abs = findAbstract(text);
  if (abs) return { text: abs, kind: 'abstract' };
  const s = summarize(text, { count: 5, title });
  return s ? { text: s, kind: 'extract' } : { text: '', kind: 'none' };
}
