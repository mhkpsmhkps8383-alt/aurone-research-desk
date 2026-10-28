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
let draft = null;

/* ───── مسیریابی */
const VIEWS = ['analyze', 'library', 'ask', 'templates', 'chem'];
function route() {
  let v = (location.hash || '#analyze').slice(1);
  if (!VIEWS.includes(v)) v = 'analyze';
  VIEWS.forEach((k) => { $('#v-' + k).hidden = k !== v; });
  document.querySelectorAll('#nav a').forEach((a) => {
    a.toggleAttribute('aria-current', a.dataset.v === v);
    if (a.dataset.v === v) a.setAttribute('aria-current', 'page');
  });
  if (v === 'library') loadLibrary();
  if (v === 'ask') loadAsks();
  if (v === 'templates') renderTemplates();
  if (v === 'chem') loadChem();
}
addEventListener('hashchange', route);

/* ───── وضعیت سرور */
async function health() {
  const s = $('#status');
  try {
    const h = await api('/api/health');
    if (h.ai) { s.textContent = 'آمادهٔ تحلیل · ' + fa(h.papers) + ' مقاله'; s.className = 'status ok'; }
    else { s.textContent = 'کلید Claude تنظیم نشده'; s.className = 'status warn'; }
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

/* ───── تحلیل */
$('#clearIn').onclick = () => { $('#txtIn').value = ''; $('#result').hidden = true; $('#aState').textContent = ''; };

$('#goAnalyze').onclick = async () => {
  const text = $('#txtIn').value.trim();
  const st = $('#aState'), btn = $('#goAnalyze');
  if (text.length < 60) { st.textContent = 'متن خیلی کوتاه است'; return; }
  btn.disabled = true;
  st.innerHTML = '<span class="spin"></span>Claude در حال خواندن مقاله…';
  $('#result').hidden = true;
  try {
    draft = await post('/api/analyze', { text, template: $('#tplSel').value });
    draft.raw_text = text;
    draft.tag = $('#tagIn').value.trim() || null;
    showResult(draft);
    st.textContent = '';
  } catch (e) {
    st.textContent = '';
    const r = $('#result'); r.hidden = false; r.innerHTML = '';
    r.appendChild(el('div', 'note err', e.message));
  } finally { btn.disabled = false; }
};

function showResult(d) {
  const r = $('#result'); r.hidden = false; r.innerHTML = '';
  const c = el('div', 'panel');
  const head = el('div', 'tags');
  if (d.antioxidant === 'yes') head.appendChild(el('span', 'tag ok', 'اثر آنتی‌اکسیدانی دارد'));
  if (d.antioxidant === 'no') head.appendChild(el('span', 'tag no', 'آنتی‌اکسیدانی بررسی نشده'));
  if (d.nrf2) head.appendChild(el('span', 'tag nrf', 'Nrf2'));
  if (d.year) head.appendChild(el('span', 'tag', fa(d.year)));
  c.appendChild(head);
  c.appendChild(el('h3', null, d.title || 'بدون عنوان'));
  if (d.doi) c.appendChild(el('div', 'doi', d.doi));
  if (d.journal || d.authors) c.appendChild(el('div', 'hint', [d.journal, d.authors].filter(Boolean).join(' · ')));
  if (d.summary) c.appendChild(el('div', 'body', d.summary));

  const tpl = TEMPLATES.find((t) => t.key === d.template);
  const dl = el('dl', 'kv');
  (tpl ? tpl.fields : []).forEach((f) => {
    const v = (d.fields || {})[f.key];
    if (!v) return;
    dl.appendChild(el('dt', null, f.label));
    dl.appendChild(el('dd', null, String(v)));
  });
  if (dl.children.length) c.appendChild(dl);

  const row = el('div', 'row');
  const save = el('button', 'btn primary', 'ذخیره در کتابخانه');
  const again = el('button', 'btn ghost', 'تحلیل دوباره');
  const note = el('span', 'hint');
  save.onclick = async () => {
    save.disabled = true; note.textContent = 'در حال ذخیره…';
    try {
      await post('/api/papers', { ...d, source: 'ai' });
      note.textContent = 'ذخیره شد';
      save.textContent = 'ذخیره شد ✓';
      health();
    } catch (e) { note.textContent = e.message; save.disabled = false; }
  };
  again.onclick = () => $('#goAnalyze').click();
  row.append(save, again, note);
  c.appendChild(row);
  r.appendChild(c);
}

/* ───── کتابخانه */
let onlyNrf2 = false;
$('#nrfChip').onclick = (e) => {
  onlyNrf2 = !onlyNrf2;
  e.target.setAttribute('aria-pressed', String(onlyNrf2));
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
  if (r.source !== 'manual' && r.source !== 'ai') head.appendChild(el('span', 'tag', 'کتابخانهٔ پایه'));
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

/* ───── پرسش */
$('#goAsk').onclick = async () => {
  const question = $('#qAsk').value.trim();
  const st = $('#askState'), out = $('#askOut'), btn = $('#goAsk');
  if (question.length < 5) { st.textContent = 'سؤال را بنویسید'; return; }
  btn.disabled = true;
  st.innerHTML = '<span class="spin"></span>Claude در حال خواندن کتابخانه…';
  out.hidden = true;
  try {
    const r = await post('/api/ask', { question });
    out.hidden = false;
    out.innerHTML = '';
    out.appendChild(renderRefs(r.answer));
    out.appendChild(el('div', 'hint', 'بر پایهٔ ' + fa(r.n_papers) + ' مقالهٔ کتابخانه'));
    st.textContent = '';
    loadAsks();
  } catch (e) {
    out.hidden = false; out.innerHTML = '';
    out.appendChild(el('div', 'note err', e.message));
    st.textContent = '';
  } finally { btn.disabled = false; }
};

function renderRefs(text) {
  const frag = document.createElement('div');
  const parts = String(text).split(/(\[#\d+\])/g);
  parts.forEach((p) => {
    if (/^\[#\d+\]$/.test(p)) frag.appendChild(el('span', 'ref', p.replace(/\d+/, (d) => fa(d))));
    else frag.appendChild(document.createTextNode(p));
  });
  return frag;
}

async function loadAsks() {
  const rows = await api('/api/asks');
  const w = $('#askHist'); w.innerHTML = '';
  $('#histTitle').hidden = rows.length === 0;
  rows.forEach((r) => {
    const c = el('div', 'card');
    c.appendChild(el('h3', null, r.question));
    const d = el('details');
    d.appendChild(el('summary', null, 'پاسخ'));
    const body = el('div', 'body');
    body.appendChild(renderRefs(r.answer || ''));
    d.appendChild(body);
    c.appendChild(d);
    w.appendChild(c);
  });
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
