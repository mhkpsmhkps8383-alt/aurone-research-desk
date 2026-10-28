/**
 * یافتن عبارت در متن کاملِ مقاله، همراه شمارهٔ صفحه.
 *
 * هنگام استخراج، صفحه‌ها با \f از هم جدا می‌شوند، پس شمارهٔ صفحه دقیق است.
 * فایل‌هایی که پیش از این قاعده ذخیره شده‌اند مرز صفحه ندارند؛ برای آنها از
 * روی جای عبارت در متن تخمین می‌زنیم و نتیجه را «تخمینی» علامت می‌زنیم.
 */

export const squash = (s) => String(s).toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, '');

/** متن ساده‌شده به‌همراه جای اصلیِ هر نویسه، تا بشود تکهٔ متن را برگرداند. */
export function squashMap(s) {
  let out = '';
  const pos = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i].toLowerCase();
    if (/[a-z0-9؀-ۿ]/.test(ch)) { out += ch; pos.push(i); }
  }
  return { out, pos };
}

export function pageAt(text, at, pages) {
  let ff = 0;
  for (let i = 0; i < at; i++) if (text.charCodeAt(i) === 12) ff++;
  if (ff > 0) return { page: ff + 1, exact: true };
  // متن مرز صفحه ندارد: از روی نسبتِ جای عبارت تخمین می‌زنیم
  if (pages > 0 && text.length) {
    return { page: Math.min(pages, Math.floor(at / (text.length / pages)) + 1), exact: false };
  }
  return { page: null, exact: false };
}

export const snippetAt = (text, at, len) =>
  text.slice(Math.max(0, at - 130), at + len + 150).replace(/\s+/g, ' ').trim();

/** همهٔ جاهایی که این واژه در متن آمده. */
export function hitsIn(text, term, pages, max = 8) {
  const hits = [];
  const hay = text.toLowerCase(), nd = String(term).toLowerCase();
  let at = 0;
  while (hits.length < max) {
    at = hay.indexOf(nd, at);
    if (at === -1) break;
    hits.push({ ...pageAt(text, at, pages), snippet: snippetAt(text, at, nd.length) });
    at += nd.length;
  }
  if (hits.length) return hits;

  // نام‌های شیمیایی را با کنار گذاشتن کاما و خط تیره هم می‌سنجیم
  const needle = squash(term);
  if (needle.length < 3) return hits;
  const { out, pos } = squashMap(text);
  let k = 0;
  while (hits.length < max) {
    k = out.indexOf(needle, k);
    if (k === -1) break;
    const start = pos[k];
    const end = pos[k + needle.length - 1] ?? start;
    hits.push({ ...pageAt(text, start, pages), loose: true, snippet: snippetAt(text, start, end - start + 1) });
    k += needle.length;
  }
  return hits;
}
