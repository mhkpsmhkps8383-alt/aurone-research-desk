/**
 * سنجشِ «عبارت دقیق» روی نتایج جست‌وجو.
 *
 * چرا لازم است: پایگاه‌ها عبارت را می‌شکنند و ریشه‌یابی می‌کنند، پس برای نامی
 * مثل 4,6-dihydroxy-2,3-dihydro-1-benzofuran-3-one چیزهای نامربوط می‌آورند.
 * OpenAlex گیومه را هم نمی‌فهمد. بنابراین پایگاه‌ها را برای «یافتن نامزدها»
 * می‌خواهیم و درستیِ عبارت را خودمان می‌سنجیم.
 *
 * نکتهٔ نام‌های شیمیایی: یک ترکیب را به چند شکل می‌نویسند —
 * «4,6-dihydroxy…» و «4, 6-dihydroxy…» و با خط تیرهٔ یونیکدی متفاوت.
 * پس پیش از مقایسه همه‌چیز جز حرف و رقم را کنار می‌گذاریم؛ توالیِ
 * حرف‌ها و رقم‌ها به‌قدر کافی یکتاست.
 */

const DASHES = /[‐-―−˗﹘﹣－]/g;

/** شکل ساده‌شده برای مقایسه: فقط حرف و رقم، همه کوچک. */
export const squash = (s = '') =>
  String(s).replace(DASHES, '-').toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, '');

/** متن با نگه داشتن جای حرف‌ها، تا بشود تکهٔ متن را پیدا کرد. */
function squashWithMap(s = '') {
  const src = String(s).replace(DASHES, '-');
  let out = '';
  const pos = [];
  for (let i = 0; i < src.length; i++) {
    const ch = src[i].toLowerCase();
    if (/[a-z0-9؀-ۿ]/.test(ch)) { out += ch; pos.push(i); }
  }
  return { out, pos, src };
}

/** آیا عبارت در این متن هست؟ اگر بله، تکهٔ متنِ دور و برش را هم می‌دهد. */
export function findPhrase(text, phrase, { pad = 150 } = {}) {
  if (!text || !phrase) return null;
  const needle = squash(phrase);
  if (!needle) return null;
  const { out, pos, src } = squashWithMap(text);
  const at = out.indexOf(needle);
  if (at < 0) return null;
  const from = Math.max(0, pos[at] - pad);
  const to = Math.min(src.length, (pos[at + needle.length - 1] ?? pos[at]) + pad);
  return {
    snippet: src.slice(from, to).replace(/\s+/g, ' ').trim(),
    exact: src.slice(pos[at], (pos[at + needle.length - 1] ?? pos[at]) + 1),
  };
}

const EPMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest';

/** متن کاملِ مقالات دسترسی‌آزاد از Europe PMC. غیرآزادها متن کامل ندارند. */
async function openAccessText(rec) {
  const pmcid = rec.pmcid || (rec.oa_url || '').match(/PMC\d+/)?.[0];
  if (!pmcid) return null;
  try {
    const r = await fetch(`${EPMC}/PMC/${pmcid}/fullTextXML`);
    if (!r.ok) return null;
    const xml = await r.text();
    // برچسب‌های XML را برمی‌داریم و فقط متن می‌ماند
    return xml.replace(/<\/?[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ');
  } catch { return null; }
}

/**
 * نتایج را به آنهایی محدود می‌کند که عبارت واقعاً در آنها هست.
 * @param rows نتایج جست‌وجو
 * @param phrase عبارتی که باید عیناً باشد
 * @param opt {fullText: متن کاملِ مقالات رایگان هم خوانده شود, onProgress}
 */
export async function keepOnlyExact(rows, phrase, { fullText = true, onProgress = () => {} } = {}) {
  const kept = [], dropped = [];
  let checkedFullText = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    onProgress(i + 1, rows.length);

    const inTitle = findPhrase(r.title, phrase);
    if (inTitle) { kept.push({ ...r, matchedIn: 'عنوان', snippet: inTitle.snippet }); continue; }

    const body = r.abstract || r.snippet || r.summary || '';
    const inAbs = findPhrase(body, phrase);
    if (inAbs) { kept.push({ ...r, matchedIn: 'چکیده', snippet: inAbs.snippet }); continue; }

    if (fullText && (r.oa_url || r.is_oa || r.pmcid)) {
      const text = await openAccessText(r);
      if (text) {
        checkedFullText++;
        const inFull = findPhrase(text, phrase);
        if (inFull) { kept.push({ ...r, matchedIn: 'متن کامل', snippet: inFull.snippet }); continue; }
      }
    }
    dropped.push(r);
  }

  return { kept, droppedCount: dropped.length, checkedFullText };
}
