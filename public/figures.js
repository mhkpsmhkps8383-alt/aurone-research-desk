/**
 * بیرون کشیدن تصویرهای داخل PDF — یعنی همان ساختارهای شیمیایی و نمودارها.
 *
 * تصویرها در PDF به‌صورت شیء جدا ذخیره شده‌اند، پس لازم نیست صفحه را عکس
 * بگیریم و ببُریم؛ می‌شود خودِ تصویر اصلی را با کیفیت کامل برداشت.
 * همه‌چیز در مرورگر انجام می‌شود و فایل جایی فرستاده نمی‌شود.
 */

/** شیء تصویرِ pdf.js را به canvas تبدیل می‌کند. */
function toCanvas(img) {
  if (!img || !img.width || !img.height) return null;
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  const ctx = cv.getContext('2d');

  if (img.bitmap) { ctx.drawImage(img.bitmap, 0, 0); return cv; }
  if (!img.data) return null;

  const out = ctx.createImageData(img.width, img.height);
  const d = out.data, src = img.data;
  if (img.kind === 3 && src.length >= d.length) {        // RGBA
    d.set(src.subarray(0, d.length));
  } else if (img.kind === 2) {                            // RGB
    for (let i = 0, j = 0; j < d.length; i += 3, j += 4) {
      d[j] = src[i]; d[j + 1] = src[i + 1]; d[j + 2] = src[i + 2]; d[j + 3] = 255;
    }
  } else if (img.kind === 1) {                            // تک‌بیتی
    const rowBytes = (img.width + 7) >> 3;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const bit = (src[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        const v = bit ? 255 : 0, j = (y * img.width + x) * 4;
        d[j] = d[j + 1] = d[j + 2] = v; d[j + 3] = 255;
      }
    }
  } else return null;
  ctx.putImageData(out, 0, 0);
  return cv;
}

/** اثر انگشت کوچکِ تصویر، برای حذف لوگوهایی که در هر صفحه تکرار شده‌اند. */
function fingerprint(cv) {
  const s = document.createElement('canvas');
  s.width = s.height = 12;
  const c = s.getContext('2d');
  c.drawImage(cv, 0, 0, 12, 12);
  const px = c.getImageData(0, 0, 12, 12).data;
  let out = '';
  for (let i = 0; i < px.length; i += 4) out += (px[i] + px[i + 1] + px[i + 2] > 382 ? '1' : '0');
  return out;
}

/** تصویرِ یک‌دست (کادر سفید یا خط رنگی) چیزی برای دیدن ندارد. */
function isBlank(cv) {
  const s = document.createElement('canvas');
  s.width = s.height = 16;
  const c = s.getContext('2d');
  c.drawImage(cv, 0, 0, 16, 16);
  const px = c.getImageData(0, 0, 16, 16).data;
  let min = 255, max = 0;
  for (let i = 0; i < px.length; i += 4) {
    const v = (px[i] + px[i + 1] + px[i + 2]) / 3;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return max - min < 18;
}

const objOf = (page, name) => new Promise((res) => {
  try { page.objs.get(name, res); } catch { res(null); }
});

/**
 * همهٔ تصویرهای قابل‌استفادهٔ یک PDF.
 * @returns {Promise<Array<{canvas,width,height,page}>>}
 */
export async function extractFigures(buf, {
  maxPages = 30, minSide = 90, minPixels = 14000, onProgress = () => {},
} = {}) {
  if (!window.pdfjsLib) throw new Error('خوانندهٔ PDF بار نشده');
  const OPS = pdfjsLib.OPS;
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const total = Math.min(pdf.numPages, maxPages);
  const seen = new Set();
  const found = [];

  for (let n = 1; n <= total; n++) {
    onProgress(n, total);
    let page, ops;
    try {
      page = await pdf.getPage(n);
      ops = await page.getOperatorList();
    } catch { continue; }

    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      const inline = fn === OPS.paintInlineImageXObject;
      if (fn !== OPS.paintImageXObject && fn !== OPS.paintJpegXObject && !inline) continue;

      const arg = ops.argsArray[i][0];
      let img = null;
      try { img = inline ? arg : await objOf(page, arg); } catch { continue; }
      if (!img) continue;

      // خیلی کوچک یعنی آیکون یا جداکننده، نه ساختار
      if (img.width < minSide || img.height < minSide) continue;
      if (img.width * img.height < minPixels) continue;
      // نوار باریک معمولاً خط جدولی است
      const ratio = img.width / img.height;
      if (ratio > 12 || ratio < 1 / 12) continue;

      const cv = toCanvas(img);
      if (!cv || isBlank(cv)) continue;

      const fp = fingerprint(cv);
      if (seen.has(fp)) continue;     // لوگوی تکراری سرصفحه
      seen.add(fp);

      found.push({ canvas: cv, width: cv.width, height: cv.height, page: n });
      if (found.length >= 60) return found;
    }
  }
  return found;
}

/** تصویر را برای ذخیره کوچک و فشرده می‌کند — آپلود باید سبک بماند. */
export async function toCompact(canvas, maxDim = 520, quality = 0.82) {
  const scale = Math.min(1, maxDim / Math.max(canvas.width, canvas.height));
  let cv = canvas;
  if (scale < 1) {
    cv = document.createElement('canvas');
    cv.width = Math.round(canvas.width * scale);
    cv.height = Math.round(canvas.height * scale);
    const c = cv.getContext('2d');
    c.fillStyle = '#fff';
    c.fillRect(0, 0, cv.width, cv.height);
    c.drawImage(canvas, 0, 0, cv.width, cv.height);
  }
  const types = ['image/webp', 'image/jpeg'];
  for (const type of types) {
    const blob = await new Promise((r) => cv.toBlob(r, type, quality));
    if (blob && blob.type === type) return { blob, width: cv.width, height: cv.height };
  }
  const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
  return { blob, width: cv.width, height: cv.height };
}
