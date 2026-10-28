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
const VIEWS = ['add', 'library', 'templates', 'chem'];
function route() {
  let v = (location.hash || '#add').slice(1);
  if (!VIEWS.includes(v)) v = 'add';
  VIEWS.forEach((k) => { $('#v-' + k).hidden = k !== v; });
  document.querySelectorAll('#nav a').forEach((a) => {
    a.toggleAttribute('aria-current', a.dataset.v === v);
    if (a.dataset.v === v) a.setAttribute('aria-current', 'page');
  });
  if (v === 'library') loadLibrary();
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
      it.rec = { ...g, pages, filename: file.name, raw_text: text, summary: '', fields: {} };
      it.state = 'ready';
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
  if (r.filename) head.appendChild(el('span', 'tag', r.filename + (r.pages ? ' · ' + fa(r.pages) + ' صفحه' : '')));
  c.appendChild(head);
  c.appendChild(el('h3', null, r.title));
  if (r.doi) c.appendChild(el('div', 'doi', r.doi));
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
})();
