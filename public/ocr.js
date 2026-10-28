/**
 * OCR برای PDFهای اسکنی — تماماً در مرورگر، با Tesseract.
 * هیچ فایلی جایی فرستاده نمی‌شود؛ تصویر صفحه‌ها همین‌جا پردازش می‌شود.
 *
 * دادهٔ زبان یک‌بار از CDN دانلود و در کش مرورگر می‌ماند؛ فارسی حدود ۱۵
 * و انگلیسی حدود ۱۵ مگابایت است، پس بار اول کمی طول می‌کشد.
 */

const TESS = 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js';
const LANG_PATH = 'https://tessdata.projectnaptha.com/4.0.0';

let loading = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (loading) return loading;
  loading = new Promise((ok, bad) => {
    const s = document.createElement('script');
    s.src = TESS;
    s.onload = () => (window.Tesseract ? ok(window.Tesseract) : bad(new Error('Tesseract بار نشد')));
    s.onerror = () => bad(new Error('دانلود موتور OCR شکست خورد'));
    document.head.appendChild(s);
  });
  return loading;
}

/** هر صفحهٔ PDF را به تصویر تبدیل می‌کند تا OCR رویش اجرا شود. */
async function pageToCanvas(pdf, n, scale = 2) {
  const page = await pdf.getPage(n);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(2400, Math.round(viewport.width));
  canvas.height = Math.round(viewport.height * (canvas.width / viewport.width));
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({
    canvasContext: ctx,
    viewport: page.getViewport({ scale: scale * (canvas.width / viewport.width) }),
  }).promise;
  return canvas;
}

/**
 * متن یک PDF اسکنی را با OCR درمی‌آورد.
 * @param {ArrayBuffer} buf محتوای فایل
 * @param {object} opt {langs, maxPages, onProgress(done,total,note)}
 */
export async function ocrPdf(buf, { langs = 'fas+eng', maxPages = 12, onProgress = () => {} } = {}) {
  if (!window.pdfjsLib) throw new Error('خوانندهٔ PDF بار نشده');
  onProgress(0, 1, 'آماده‌سازی موتور OCR…');
  const T = await loadTesseract();

  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const total = Math.min(pdf.numPages, maxPages);

  const worker = await T.createWorker(langs, 1, {
    langPath: LANG_PATH,
    logger: (m) => {
      if (m.status === 'loading language traineddata' || m.status === 'initializing tesseract')
        onProgress(0, total, 'دانلود دادهٔ زبان… ' + Math.round((m.progress || 0) * 100) + '٪');
    },
  });

  const parts = [];
  try {
    for (let i = 1; i <= total; i++) {
      onProgress(i - 1, total, 'صفحهٔ ' + i + ' از ' + total);
      const canvas = await pageToCanvas(pdf, i);
      const { data } = await worker.recognize(canvas);
      parts.push((data.text || '').trim());
      canvas.width = canvas.height = 0;   // آزاد کردن حافظه
      onProgress(i, total, 'صفحهٔ ' + i + ' از ' + total);
    }
  } finally {
    await worker.terminate().catch(() => {});
  }

  return {
    text: parts.join('\n\n').replace(/[ \t]{2,}/g, ' ').trim(),
    pages: pdf.numPages,
    ocrPages: total,
  };
}

/** آیا این PDF اسکنی است؟ متنِ استخراج‌شدهٔ بسیار کم یعنی تصویر است. */
export function looksScanned(text, pages) {
  const chars = (text || '').replace(/\s/g, '').length;
  return chars < Math.max(120, (pages || 1) * 60);
}
