import { recommend as oaRecommend, citedBy as oaCitedBy } from '/openalex.js?v=7';
import { bestSummary, summarize, keywords as kwOf } from '/summarize.js?v=8';

const $ = (s) => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const fa = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const api = async (url, opts) => {
  const r = await fetch(url, opts);
  const data = await r.json().catch(() => ({ error: 'پاسخ سرور خوانده نشد' }));
  if (!r.ok) throw new Error(data.error || 'خطای ' + r.status);
  return data;
};
const post = (url, body) => api(url, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

let TEMPLATES = [];

/* ───── مسیریابی */
const VIEWS = ['add', 'discover', 'library', 'templates', 'chem'];
function route() {
  let v = (location.hash || '#add').slice(1);
  if (!VIEWS.includes(v)) v = 'add';
  VIEWS.forEach((k) => { $('#v-' + k).hidden = k !== v; });
  document.querySelectorAll('#nav a').forEach((a) => {
    a.toggleAttribute('aria-current', a.dataset.v === v);
    if (a.dataset.v === v) a.setAttribute('aria-current', 'page');
  });
  if (v === 'library') { loadLibrary(); enrichStatus(); }
  if (v === 'discover') loadWatches();
  if (v === 'templates') renderTemplates();
  if (v === 'chem') loadChem();
}
addEventListener('hashchange', route);

/* ───── وضعیت سرور */
async function health() {
  const s = $('#status');
  try {
    const h = await api('/api/health');
    s.textContent = fa(h.papers) + ' مقاله در کتابخانه';
    s.className = 'status ok';
  } catch { s.textContent = 'سرور در دسترس نیست'; s.className = 'status warn'; }
}

/* ───── قالب‌ها */
async function loadTemplates() {
  TEMPLATES = await api('/api/templates');
  const sel = $('#tplSel');
  sel.innerHTML = '';
  TEMPLATES.forEach((t) => {
    const o = el('option', null, t.name + (t.builtin ? '' : ' (شخصی)'));
    o.value = t.key; sel.appendChild(o);
  });
}

function renderTemplates() {
  const w = $('#tplList'); w.innerHTML = '';
  TEMPLATES.forEach((t) => {
    const c = el('div', 'card');
    const head = el('div', 'tags');
    head.appendChild(el('span', 'tag id', t.key));
    head.appendChild(el('span', 'tag', t.builtin ? 'آماده' : 'شخصی'));
    c.appendChild(head);
    c.appendChild(el('h3', null, t.name));
    if (t.description) c.appendChild(el('div', 'hint', t.description));
    const dl = el('dl', 'kv');
    t.fields.forEach((f) => {
      dl.appendChild(el('dt', null, f.label));
      dl.appendChild(el('dd', null, f.hint || '—'));
    });
    c.appendChild(dl);
    if (!t.builtin) {
      const row = el('div', 'row');
      const del = el('button', 'btn danger sm', 'حذف قالب');
      del.onclick = async () => {
        await fetch('/api/templates/' + encodeURIComponent(t.key), { method: 'DELETE' });
        await loadTemplates(); renderTemplates();
      };
      row.appendChild(del); c.appendChild(row);
    }
    w.appendChild(c);
  });
}

$('#saveTpl').onclick = async () => {
  const st = $('#tplState');
  const fields = $('#ntFields').value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [key, label, hint] = l.split('|').map((s) => (s || '').trim());
    return { key, label: label || key, hint: hint || '' };
  }).filter((f) => f.key);
  if (!$('#ntKey').value.trim() || !$('#ntName').value.trim() || !fields.length) {
    st.textContent = 'کلید، نام و دست‌کم یک فیلد لازم است'; return;
  }
  st.textContent = 'در حال ذخیره…';
  try {
    await post('/api/templates', {
      key: $('#ntKey').value.trim(), name: $('#ntName').value.trim(),
      description: $('#ntDesc').value.trim(), fields,
    });
    $('#ntKey').value = $('#ntName').value = $('#ntDesc').value = $('#ntFields').value = '';
    await loadTemplates(); renderTemplates();
    st.textContent = 'ذخیره شد';
  } catch (e) { st.textContent = e.message; }
};

/* ───── افزودن فایل مقاله */
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

const QUEUE = [];

async function textFromFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) {
    if (!window.pdfjsLib) throw new Error('خوانندهٔ PDF بارگذاری نشد');
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const max = Math.min(pdf.numPages, 25);
    const parts = [];
    for (let i = 1; i <= max; i++) {
      const tc = await (await pdf.getPage(i)).getTextContent();
      parts.push(tc.items.map((it) => it.str).join(' '));
    }
    return { text: parts.join('\n\n').replace(/[ \t]{2,}/g, ' ').trim(), pages: pdf.numPages };
  }
  if (name.endsWith('.docx')) {
    if (!window.mammoth) throw new Error('خوانندهٔ Word بارگذاری نشد');
    const out = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return { text: (out.value || '').trim(), pages: null };
  }
  if (name.endsWith('.txt') || name.endsWith('.md')) return { text: (await file.text()).trim(), pages: null };
  throw new Error('فقط PDF، Word، txt و md پشتیبانی می‌شود');
}

/** از روی متن مقاله، شناسه‌ها را بدون هیچ سرویس بیرونی حدس می‌زند. */
function guessMeta(text, filename) {
  const head = text.slice(0, 4000);
  const doi = (head.match(/\b10\.\d{4,9}\/[^\s"'<>,;)\]]+/i) || [])[0] || '';
  const years = [...head.matchAll(/\b(19[89]\d|20[0-4]\d)\b/g)].map((m) => +m[1]);
  const year = years.length ? Math.max(...years) : null;

  const SKIP = /^(abstract|introduction|keywords?|contents|available online|journal homepage|research (article|paper)|review|original|http|www\.|doi|©|received|accepted|published|elsevier|springer|wiley|open access)/i;
  let title = '';
  for (const raw of head.split(/\n+/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (line.length < 25 || line.length > 220) continue;
    if (SKIP.test(line)) continue;
    if ((line.match(/\d/g) || []).length > line.length / 4) continue;
    title = line;
    break;
  }
  if (!title) title = filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');

  const journal = (head.match(/\b(Journal|Bioorganic|European Journal|Molecules|RSC Advances|Tetrahedron|Phytochemistry|Food Chemistry|Chemistry)[^\n|]{0,60}/i) || [])[0] || '';
  return { doi, year, title, journal: journal.replace(/\s+/g, ' ').trim().slice(0, 90) };
}

function fieldInput(it, key, label, value, type) {
  const l = el('label', 'fld', null);
  l.textContent = label;
  const i = document.createElement(type === 'area' ? 'textarea' : 'input');
  if (type === 'num') i.type = 'number';
  if (type === 'area') i.rows = 3;
  i.value = value || '';
  i.oninput = () => { it.rec[key] = i.value; };
  l.appendChild(i);
  return l;
}

function renderQueue() {
  $('#queueBar').hidden = QUEUE.length === 0;
  const w = $('#queue');
  w.innerHTML = '';
  QUEUE.forEach((it, idx) => {
    const c = el('div', 'card' + (it.state === 'saved' ? ' savedCard' : ''));
    const head = el('div', 'tags');
    head.appendChild(el('span', 'tag id', it.file.name));
    if (it.rec.pages) head.appendChild(el('span', 'tag', fa(it.rec.pages) + ' صفحه'));
    if (it.state === 'reading') head.appendChild(el('span', 'tag', 'در حال خواندن…'));
    if (it.enriched) head.appendChild(el('span', 'tag nrf', 'تکمیل‌شده از ' + it.enriched));
    if (it.summaryKind === 'abstract') head.appendChild(el('span', 'tag ok', 'چکیدهٔ خود مقاله'));
    if (it.summaryKind === 'extract') head.appendChild(el('span', 'tag', 'خلاصهٔ استخراجی'));
    if (it.state === 'saved') head.appendChild(el('span', 'tag ok', 'در کتابخانه ✓'));
    if (it.state === 'err') head.appendChild(el('span', 'tag no', it.error));
    const x = el('button', 'x', '×');
    x.title = 'حذف از فهرست';
    x.onclick = () => { QUEUE.splice(idx, 1); renderQueue(); };
    head.appendChild(x);
    c.appendChild(head);

    if (it.state === 'ready' || it.state === 'saved') {
      const r1 = el('div', 'row');
      r1.appendChild(fieldInput(it, 'title', 'عنوان', it.rec.title));
      r1.querySelector('.fld').classList.add('grow');
      r1.appendChild(fieldInput(it, 'year', 'سال', it.rec.year, 'num'));
      c.appendChild(r1);
      const r2 = el('div', 'row');
      r2.appendChild(fieldInput(it, 'doi', 'DOI', it.rec.doi));
      r2.querySelector('.fld').classList.add('grow');
      r2.appendChild(fieldInput(it, 'journal', 'مجله', it.rec.journal));
      c.appendChild(r2);
      c.appendChild(fieldInput(it, 'summary', 'یادداشت یا خلاصه', it.rec.summary, 'area'));

      const tpl = TEMPLATES.find((t) => t.key === $('#tplSel').value);
      if (tpl) {
        const r3 = el('div', 'row');
        tpl.fields.forEach((f) => {
          const l = el('label', 'fld', null);
          l.textContent = f.label;
          const i = document.createElement('input');
          i.placeholder = f.hint || '';
          i.value = (it.rec.fields || {})[f.key] || '';
          i.oninput = () => { it.rec.fields = it.rec.fields || {}; it.rec.fields[f.key] = i.value; };
          l.appendChild(i);
          r3.appendChild(l);
        });
        c.appendChild(r3);
      }
      const bar = el('div', 'row');
      const one = el('button', 'btn sm', it.state === 'saved' ? 'ذخیرهٔ دوباره' : 'ذخیرهٔ همین یکی');
      one.onclick = () => saveOne(it);
      bar.appendChild(one);
      if (it.rec.raw_text) {
        const longer = el('button', 'btn ghost sm', 'خلاصهٔ بلندتر');
        longer.onclick = () => {
          const n = (it.summaryLen = Math.min(14, (it.summaryLen || 5) + 3));
          it.rec.summary = summarize(it.rec.raw_text, { count: n, title: it.rec.title });
          it.summaryKind = 'extract';
          renderQueue();
        };
        bar.appendChild(longer);
      }
      c.appendChild(bar);
    }
    w.appendChild(c);
  });
}

async function saveOne(it) {
  const st = $('#qState');
  try {
    it.rec.tag = $('#tagIn').value.trim() || it.rec.tag || null;
    it.rec.template = $('#tplSel').value;
    it.rec.source = 'file';
    if (!it.rec.title) { st.textContent = 'عنوان نمی‌تواند خالی باشد'; return false; }
    await post('/api/papers', it.rec);
    it.state = 'saved';
    renderQueue();
    health();
    return true;
  } catch (e) { it.state = 'err'; it.error = e.message; renderQueue(); return false; }
}

async function addFiles(files) {
  for (const file of [...files]) {
    if (QUEUE.some((it) => it.file.name === file.name && it.file.size === file.size)) continue;
    const it = { file, state: 'reading', error: '', rec: {} };
    QUEUE.push(it);
    renderQueue();
    try {
      const { text, pages } = await textFromFile(file);
      if (text.length < 40) throw new Error('متنی استخراج نشد — احتمالاً اسکن تصویری است');
      const g = guessMeta(text, file.name);
      // خلاصه را همین‌جا در مرورگر از خود متن می‌سازیم — چه DOI داشته باشد چه نداشته باشد
      const sum = bestSummary(text, g.title);
      it.rec = {
        ...g, pages, filename: file.name, raw_text: text,
        summary: sum.text,
        fields: { 'واژه‌های کلیدی': kwOf(text, 8).join('، ') },
      };
      it.summaryKind = sum.kind;
      it.state = 'ready';
      renderQueue();
      // اگر DOI در متن بود، بقیهٔ اطلاعات را از پایگاه‌های باز می‌گیریم — حدسِ متنی جای این را نمی‌گیرد
      if (g.doi) {
        try {
          const d = await api('/api/scholar/enrich?doi=' + encodeURIComponent(g.doi));
          if (!d.error) {
            it.rec = {
              ...it.rec,
              title: d.title || it.rec.title,
              journal: d.journal || it.rec.journal,
              year: d.year || it.rec.year,
              authors: d.authors || null,
              abstract: d.abstract || null,
              // چکیدهٔ رسمیِ خود مقاله بر خلاصهٔ استخراجی اولویت دارد
              summary: d.abstract || it.rec.summary || '',
            };
            if (d.abstract) it.summaryKind = 'abstract';
            it.enriched = (d.found_in || []).join(' + ');
          }
        } catch { /* بدون اینترنت هم همان حدسِ متنی می‌ماند */ }
      }
    } catch (e) {
      it.state = 'err';
      it.error = e.message;
      it.rec = { title: file.name.replace(/\.[^.]+$/, ''), filename: file.name, fields: {} };
    }
    renderQueue();
  }
}

const drop = $('#drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => {
  e.preventDefault(); drop.classList.add('over');
}));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
  e.preventDefault();
  if (ev === 'dragleave' && drop.contains(e.relatedTarget)) return;
  drop.classList.remove('over');
}));
drop.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); });
$('#pickBtn').onclick = () => $('#fileIn').click();
$('#fileIn').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
$('#clearQueue').onclick = () => { QUEUE.length = 0; renderQueue(); $('#qState').textContent = ''; };
$('#tplSel').addEventListener('change', renderQueue);

$('#saveAll').onclick = async () => {
  const btn = $('#saveAll'), st = $('#qState');
  btn.disabled = true;
  let n = 0;
  for (const it of QUEUE.filter((x) => x.state === 'ready')) if (await saveOne(it)) n++;
  btn.disabled = false;
  st.textContent = n ? fa(n) + ' مقاله به کتابخانه اضافه شد' : 'چیزی برای ذخیره نبود';
};

/* ───── افزودن دستی */
$('#saveManual').onclick = async () => {
  const st = $('#mState');
  const title = $('#mTitle').value.trim();
  if (!title) { st.textContent = 'عنوان لازم است'; return; }
  st.textContent = 'در حال ذخیره…';
  try {
    await post('/api/papers', {
      title,
      doi: $('#mDoi').value.trim() || null,
      journal: $('#mJournal').value.trim() || null,
      year: Number($('#mYear').value) || null,
      tag: $('#mTag').value.trim() || null,
      summary: $('#mSummary').value.trim() || null,
      source: 'manual',
    });
    ['#mTitle', '#mDoi', '#mJournal', '#mYear', '#mTag', '#mSummary'].forEach((s2) => { $(s2).value = ''; });
    st.textContent = 'اضافه شد';
    health();
  } catch (e) { st.textContent = e.message; }
};

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

/* ═════════ پایگاه‌های علمیِ باز ═════════ */

/** کارت یک مقالهٔ بیرونی، با دکمهٔ افزودن به کتابخانه. */
function resultCard(r, extra) {
  const c = el('div', 'card');
  const head = el('div', 'tags');
  if (r.year) head.appendChild(el('span', 'tag id', fa(r.year)));
  if (Number.isFinite(r.citations)) head.appendChild(el('span', 'tag', fa(r.citations) + ' استناد'));
  if (r.shared) head.appendChild(el('span', 'tag nrf', fa(r.shared) + ' مقالهٔ شما به آن استناد کرده'));
  if (r.oa_url || r.is_oa) head.appendChild(el('span', 'tag ok', 'متن کامل رایگان'));
  if (extra) head.appendChild(el('span', 'tag', extra));
  c.appendChild(head);

  c.appendChild(el('h3', null, r.title || '—'));
  if (r.authors) c.appendChild(el('div', 'hint', r.authors.split(',').slice(0, 8).join('،')));
  const meta = [r.journal, r.doi].filter(Boolean).join(' · ');
  if (meta) c.appendChild(el('div', 'doi', meta));
  if (r.snippet || r.abstract) {
    const d = el('details');
    d.appendChild(el('summary', null, 'چکیده'));
    d.appendChild(el('div', 'body', r.abstract || r.snippet));
    c.appendChild(d);
  }

  const row = el('div', 'row');
  const add = el('button', 'btn primary sm', 'افزودن به کتابخانه');
  add.onclick = async () => {
    add.disabled = true; add.textContent = 'در حال افزودن…';
    try {
      await post('/api/papers', {
        title: r.title, doi: r.doi || null, journal: r.journal || null, year: r.year || null,
        authors: r.authors || null, summary: r.abstract || r.snippet || null, source: 'scholar',
      });
      add.className = 'btn sm'; add.textContent = 'در کتابخانه ✓';
      health();
    } catch (e) { add.disabled = false; add.textContent = e.message; }
  };
  row.appendChild(add);
  if (r.oa_url) {
    const a = el('a', 'btn ghost sm', 'متن کامل');
    a.href = r.oa_url; a.target = '_blank'; a.rel = 'noopener';
    row.appendChild(a);
  }
  if (r.doi) {
    const a = el('a', 'btn ghost sm', 'صفحهٔ ناشر');
    a.href = 'https://doi.org/' + r.doi; a.target = '_blank'; a.rel = 'noopener';
    row.appendChild(a);
    const cb = el('button', 'btn ghost sm', 'چه کسانی استنادش کرده‌اند');
    cb.onclick = async () => {
      cb.disabled = true; cb.textContent = 'در حال خواندن…';
      try {
        const j = await oaCitedBy(r.doi);
        cb.remove();
        const box = el('div', 'stack sub-stack');
        box.appendChild(el('div', 'hint', fa(j.total) + ' مقاله به این کار استناد کرده‌اند؛ پراستنادترین‌هایشان:'));
        (j.results || []).forEach((x) => box.appendChild(resultCard(x)));
        c.appendChild(box);
      } catch (e) { cb.disabled = false; cb.textContent = e.message; }
    };
    row.appendChild(cb);
  }
  c.appendChild(row);
  return c;
}

/* ───── تب‌های بخش کشف */
document.querySelectorAll('#dTabs .tab').forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll('#dTabs .tab').forEach((x) => x.classList.toggle('on', x === t));
    ['search', 'rec', 'watch'].forEach((k) => { $('#d-' + k).hidden = k !== t.dataset.d; });
  };
});

/* ───── جست‌وجوی آنلاین */
let sPage = 1;
async function runSearch(reset = true) {
  const qv = $('#sQ').value.trim();
  if (qv.length < 2) { $('#sState').textContent = 'عبارت را کامل‌تر بنویسید'; return; }
  if (reset) { sPage = 1; $('#sList').innerHTML = ''; }
  $('#sState').textContent = 'در حال جست‌وجو…';
  $('#sMore').hidden = true;
  try {
    const p = new URLSearchParams({ q: qv, page: sPage });
    if ($('#sYear').value) p.set('years', $('#sYear').value);
    const j = await api('/api/scholar/search?' + p);
    $('#sState').textContent = j.total
      ? fa(j.total.toLocaleString('en-US')) + ' نتیجه — پراستنادترین‌ها اول'
      : 'نتیجه‌ای نبود';
    const w = $('#sList');
    j.results.forEach((r) => w.appendChild(resultCard(r)));
    $('#sMore').hidden = !(j.results.length === 25);
  } catch (e) { $('#sState').textContent = e.message; }
}
$('#sGo').onclick = () => runSearch(true);
$('#sQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(true); });
$('#sYear').onchange = () => { if ($('#sQ').value.trim()) runSearch(true); };
$('#sNext').onclick = () => { sPage++; runSearch(false); };
document.querySelectorAll('.chip.ex').forEach((b) => {
  b.onclick = () => { $('#sQ').value = b.textContent; runSearch(true); };
});

/* ───── پیشنهاد بر پایهٔ گراف استناد */
$('#recGo').onclick = async () => {
  const st = $('#recState'), w = $('#recList');
  $('#recGo').disabled = true;
  st.textContent = 'در حال خواندن گرافِ استناد…';
  w.innerHTML = '';
  try {
    const rows = await api('/api/papers');
    const dois = rows.map((r) => r.doi).filter(Boolean);
    const j = await oaRecommend(dois, 20, (i, n, what) => {
      st.textContent = what + ' — گام ' + fa(i) + ' از ' + fa(n);
    });
    const n = (j.results || []).length;
    st.textContent = n
      ? fa(n) + ' مقاله که احتمالاً باید در کتابخانه‌تان باشد (از میان ' + fa(j.seen) + ' منبعِ بررسی‌شده)'
      : 'چیز تازه‌ای پیدا نشد';
    (j.results || []).forEach((r) => w.appendChild(resultCard(r)));
  } catch (e) { st.textContent = e.message; }
  $('#recGo').disabled = false;
};

/* ───── دیده‌بانی */
async function loadWatches() {
  try {
    const rows = await api('/api/watches');
    const w = $('#wList'); w.innerHTML = '';
    if (!rows.length) { w.appendChild(el('div', 'note', 'هنوز دیده‌بانی ندارید.')); return; }
    rows.forEach((r) => {
      const c = el('div', 'card');
      const head = el('div', 'tags');
      head.appendChild(el('span', 'tag id', r.label));
      head.appendChild(el('span', 'tag', fa(r.seen) + ' مقالهٔ دیده‌شده'));
      const x = el('button', 'x', '×');
      x.title = 'حذف دیده‌بان';
      x.onclick = async () => { await fetch('/api/watches/' + r.id, { method: 'DELETE' }); loadWatches(); };
      head.appendChild(x);
      c.appendChild(head);
      c.appendChild(el('div', 'doi', r.query));
      w.appendChild(c);
    });
  } catch { /* سرور خواب است */ }
}

$('#wAdd').onclick = async () => {
  const st = $('#wState');
  const query = $('#wQ').value.trim();
  if (!query) { st.textContent = 'عبارت لازم است'; return; }
  st.textContent = 'در حال ثبت و خواندن وضعیت فعلی…';
  try {
    const j = await post('/api/watches', { query, label: $('#wLabel').value.trim() || query });
    $('#wQ').value = $('#wLabel').value = '';
    st.textContent = 'ثبت شد — ' + fa(j.baseline) + ' مقالهٔ فعلی به‌عنوان «دیده‌شده» علامت خورد';
    loadWatches();
  } catch (e) { st.textContent = e.message; }
};

async function checkWatches(silent = false) {
  const st = $('#wState'), w = $('#wFresh');
  if (!silent) st.textContent = 'در حال بررسی…';
  try {
    const j = await post('/api/watches/check', {});
    const badge = $('#newBadge');
    badge.hidden = !j.newCount;
    badge.textContent = fa(j.newCount);
    if (silent) return j.newCount;
    w.innerHTML = '';
    st.textContent = j.newCount ? fa(j.newCount) + ' مقالهٔ تازه' : 'چیز تازه‌ای نیست';
    j.watches.forEach((wa) => {
      if (!wa.fresh?.length) return;
      w.appendChild(el('h2', 'sub', 'تازه در «' + wa.label + '»'));
      wa.fresh.forEach((r) => w.appendChild(resultCard(r, 'تازه')));
    });
    return j.newCount;
  } catch (e) { if (!silent) st.textContent = e.message; return 0; }
}
$('#wCheck').onclick = () => checkWatches(false);

/* ───── آوردن مقاله با DOI */
function doiPreview(d) {
  const w = $('#doiCard'); w.innerHTML = '';
  const c = resultCard(d, (d.found_in || []).join(' + '));
  c.classList.add('found');
  w.appendChild(c);
}
$('#doiGo').onclick = async () => {
  const st = $('#doiState'), v = $('#doiIn').value.trim();
  if (!v) { st.textContent = 'یک DOI بنویسید'; return; }
  st.textContent = 'در حال خواندن از پایگاه‌ها…';
  $('#doiCard').innerHTML = '';
  try {
    const d = await api('/api/scholar/enrich?doi=' + encodeURIComponent(v));
    st.textContent = 'پیدا شد — بررسی کنید و اگر درست است اضافه کنید.';
    doiPreview(d);
  } catch (e) { st.textContent = e.message; }
};
$('#doiIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#doiGo').click(); });

/* ───── تکمیل خودکار کتابخانهٔ موجود */
async function enrichStatus() {
  try {
    const s = await api('/api/enrich-status');
    const left = s.with_doi - Math.min(s.done, s.with_doi);
    $('#enrichHint').textContent = left > 0
      ? fa(left) + ' مقالهٔ DOI‌دار هنوز تکمیل نشده. با یک دکمه چکیده، نویسنده‌ها، تعداد استناد و لینک PDF رایگانشان را می‌آورم.'
      : fa(s.abstracts) + ' چکیده و ' + fa(s.free_pdf) + ' لینک متن کاملِ رایگان آمده. همه تکمیل‌اند.';
    $('#enrichGo').disabled = left === 0;
  } catch { /* بی‌خیال */ }
}

$('#enrichGo').onclick = async () => {
  const btn = $('#enrichGo'), bar = $('#enrichBar'), hint = $('#enrichHint');
  btn.disabled = true; bar.hidden = false;
  let total = 0, ok = 0;
  try {
    const s = await api('/api/enrich-status');
    total = Math.max(1, s.with_doi - s.done);
    for (let guard = 0; guard < 60; guard++) {
      const j = await post('/api/enrich-batch', { limit: 6 });
      ok += j.done.filter((d) => d.ok).length;
      const pct = Math.round(100 * (total - j.remaining) / total);
      bar.firstElementChild.style.width = Math.min(100, Math.max(4, pct)) + '%';
      hint.textContent = fa(total - j.remaining) + ' از ' + fa(total) + ' تکمیل شد…';
      if (!j.remaining || !j.done.length) break;
    }
    hint.textContent = fa(ok) + ' مقاله تکمیل شد.';
    loadLibrary();
  } catch (e) { hint.textContent = e.message; }
  bar.hidden = true;
  enrichStatus();
};

/* ───── کتابخانه */
let onlyNrf2 = false, onlyFiles = false;
$('#nrfChip').onclick = (e) => {
  onlyNrf2 = !onlyNrf2;
  e.target.setAttribute('aria-pressed', String(onlyNrf2));
  loadLibrary();
};
$('#fileChip').onclick = (e) => {
  onlyFiles = !onlyFiles;
  e.target.setAttribute('aria-pressed', String(onlyFiles));
  loadLibrary();
};
['#qLib', '#aoSel'].forEach((s) => $(s).addEventListener('input', () => loadLibrary()));

let libTimer;
async function loadLibrary() {
  clearTimeout(libTimer);
  libTimer = setTimeout(async () => {
    const p = new URLSearchParams();
    if ($('#qLib').value.trim()) p.set('search', $('#qLib').value.trim());
    if ($('#aoSel').value) p.set('ao', $('#aoSel').value);
    if (onlyNrf2) p.set('nrf2', '1');
    if (onlyFiles) p.set('files', '1');
    const rows = await api('/api/papers?' + p);
    $('#libCount').textContent = fa(rows.length) + ' مقاله';
    const w = $('#libList'); w.innerHTML = '';
    if (!rows.length) { w.appendChild(el('div', 'note', 'چیزی پیدا نشد.')); return; }
    rows.forEach((r) => w.appendChild(paperCard(r)));
  }, 180);
}

function paperCard(r) {
  const c = el('div', 'card');
  const head = el('div', 'tags');
  head.appendChild(el('span', 'tag id', '#' + fa(r.id)));
  if (r.tag) head.appendChild(el('span', 'tag', r.tag));
  if (r.antioxidant === 'yes') head.appendChild(el('span', 'tag ok', 'آنتی‌اکسیدان'));
  if (r.antioxidant === 'no') head.appendChild(el('span', 'tag no', 'بررسی نشده'));
  if (r.nrf2) head.appendChild(el('span', 'tag nrf', 'Nrf2'));
  if (r.source === 'seed-59') head.appendChild(el('span', 'tag', 'کتابخانهٔ پایه'));
  if (r.source === 'file') head.appendChild(el('span', 'tag id', 'از فایل'));
  if (r.source === 'scholar') head.appendChild(el('span', 'tag id', 'از جست‌وجو'));
  if (Number.isFinite(r.citations)) head.appendChild(el('span', 'tag', fa(r.citations) + ' استناد'));
  if (r.oa_url) head.appendChild(el('span', 'tag ok', 'متن کامل رایگان'));
  if (r.filename) head.appendChild(el('span', 'tag', r.filename + (r.pages ? ' · ' + fa(r.pages) + ' صفحه' : '')));
  c.appendChild(head);
  c.appendChild(el('h3', null, r.title));
  if (r.authors) c.appendChild(el('div', 'hint', r.authors.split(',').slice(0, 8).join('،')));
  const meta2 = [r.journal, r.year ? fa(r.year) : '', r.doi].filter(Boolean).join(' · ');
  if (meta2) c.appendChild(el('div', 'doi', meta2));
  if (r.abstract) {
    const d = el('details');
    d.appendChild(el('summary', null, 'چکیده'));
    d.appendChild(el('div', 'body', r.abstract));
    c.appendChild(d);
  }
  if (r.best_compound) {
    const d = el('details');
    d.appendChild(el('summary', null, 'بهترین ترکیب'));
    d.appendChild(el('div', 'body', r.best_compound));
    c.appendChild(d);
  }
  if (r.summary) c.appendChild(el('div', 'body', r.summary));
  const f = Object.entries(r.fields || {}).filter(([, v]) => v);
  if (f.length) {
    const dl = el('dl', 'kv');
    f.forEach(([k, v]) => { dl.appendChild(el('dt', null, k)); dl.appendChild(el('dd', null, String(v))); });
    c.appendChild(dl);
  }
  const row = el('div', 'row');
  if (r.filename || r.source === 'file') {
    const sm = el('button', 'btn ghost sm', r.summary ? 'خلاصهٔ تازه بساز' : 'خلاصه بساز');
    sm.onclick = async () => {
      sm.disabled = true; sm.textContent = 'در حال خواندن متن…';
      try {
        const t = await api('/api/papers/' + r.id + '/text');
        if (!t.raw_text) throw new Error('متن این مقاله ذخیره نشده');
        const s = bestSummary(t.raw_text, r.title);
        if (!s.text) throw new Error('متن برای خلاصه کردن کافی نیست');
        await api('/api/papers/' + r.id, {
          method: 'PATCH', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ summary: s.text }),
        });
        loadLibrary();
      } catch (e) { sm.disabled = false; sm.textContent = e.message; }
    };
    row.appendChild(sm);
  }
  if (r.oa_url) {
    const a = el('a', 'btn ghost sm', 'متن کامل');
    a.href = r.oa_url; a.target = '_blank'; a.rel = 'noopener';
    row.appendChild(a);
  }
  if (r.doi) {
    const a = el('a', 'btn ghost sm', 'صفحهٔ ناشر');
    a.href = 'https://doi.org/' + r.doi; a.target = '_blank'; a.rel = 'noopener';
    row.appendChild(a);
    const en = el('button', 'btn ghost sm', r.abstract ? 'به‌روزرسانی از پایگاه‌ها' : 'تکمیل از پایگاه‌ها');
    en.onclick = async () => {
      en.disabled = true; en.textContent = 'در حال خواندن…';
      try { await post('/api/papers/' + r.id + '/enrich', {}); loadLibrary(); }
      catch (e) { en.disabled = false; en.textContent = e.message; }
    };
    row.appendChild(en);
  }
  const del = el('button', 'btn danger sm', 'حذف');
  let armed = false;
  del.onclick = async () => {
    if (!armed) { armed = true; del.textContent = 'مطمئنید؟ دوباره بزنید'; setTimeout(() => { armed = false; del.textContent = 'حذف'; }, 4000); return; }
    await fetch('/api/papers/' + r.id, { method: 'DELETE' });
    loadLibrary(); health();
  };
  row.appendChild(del);
  c.appendChild(row);
  return c;
}

/* ───── ترکیبات */
let cDrug = false, cCat = false;
$('#cDrug').onclick = (e) => { cDrug = !cDrug; e.target.setAttribute('aria-pressed', String(cDrug)); loadChem(); };
$('#cCat').onclick = (e) => { cCat = !cCat; e.target.setAttribute('aria-pressed', String(cCat)); loadChem(); };
$('#cSort').onchange = () => loadChem();

async function loadChem() {
  const p = new URLSearchParams({ sort: $('#cSort').value });
  if (cDrug) p.set('drug', '1');
  if (cCat) p.set('cat', '1');
  const rows = await api('/api/compounds?' + p);
  const tb = $('#cTable tbody'); tb.innerHTML = '';
  rows.slice(0, 120).forEach((r) => {
    const tr = el('tr');
    [[r.id, 'n'], [r.ring_a_fa], [r.ring_b_fa], [Number(r.score_direct).toFixed(1), 'n'],
     [Number(r.score_nrf2).toFixed(1), 'n'], [Number(r.logp).toFixed(2), 'n'], [fa(r.n_oh), 'n']]
      .forEach(([v, c]) => tr.appendChild(el('td', c || null, String(v))));
    tb.appendChild(tr);
  });

  const qm = await api('/api/qm');
  const qb = $('#qTable tbody'); qb.innerHTML = '';
  qm.forEach((m) => {
    const tr = el('tr');
    [[m.name, 'n'], [m.label_fa], [m.bde_min == null ? '—' : Number(m.bde_min).toFixed(1), 'n'],
     [m.ip_ev == null ? '—' : Number(m.ip_ev).toFixed(2), 'n'], [fa(m.n_oh), 'n']]
      .forEach(([v, c]) => tr.appendChild(el('td', c || null, String(v))));
    qb.appendChild(tr);
  });
  if (qm.length) $('#qLevel').textContent = 'سطح محاسبه: ' + qm[0].level;
}

/* ───── راه‌اندازی */
(async () => {
  health();
  try { await loadTemplates(); } catch (e) { console.error(e); }
  route();
  // بررسی بی‌صدای دیده‌بانی‌ها، تا نشانِ «تازه» کنار «کشف مقاله» بنشیند
  setTimeout(() => checkWatches(true).catch(() => {}), 1500);
})();
