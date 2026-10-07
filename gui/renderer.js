'use strict';

const el = (id) => document.getElementById(id);
const t = (k, v) => window.I18N.t(k, v);
const debounce = (fn, ms = 120) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
function humanize(name) { const s = String(name).replace(/[_\-.]/g, ' ').trim(); return s.charAt(0).toUpperCase() + s.slice(1); }

let templates = [];        // riepiloghi
let current = null;        // riepilogo selezionato
let rawTemplate = null;    // JSON completo del template selezionato (per anteprima/stampa)
let editing = null;        // bozza in modifica (editor)
let scanFieldName = null;
let settings = {};
let editorSel = null;      // indice elemento selezionato nell'editor
let editorGrid = { show: true, snap: true, step: 0.5 };
let importedRows = null;   // righe importate da CSV (stampa in blocco)
const qrCache = {};        // valore QR -> { size, data } (matrice reale)
let tplFilter = '';        // filtro ricerca template
let history = [];          // storico stampe
let undoStack = [];        // editor: stati precedenti
let redoStack = [];        // editor: stati rifatti
let defaultCopies = 1;     // copie predefinite (impostazioni)
let printDarkness = '';    // intensità stampa (~SD) globale
let printSpeed = '';       // velocità stampa (^PR) globale
let defaultLanguage = 'zpl'; // linguaggio predefinito per i nuovi modelli

function fillPh(str, data) {
  if (typeof str !== 'string') return '';
  return str.replace(/\{\{\s*([\w.\-]+)\s*\}\}/g, (_, k) => { const v = (data || {})[k]; return v == null ? '' : String(v); });
}
function qrValuesOf(tpl, data) {
  const vals = [];
  (tpl.elements || []).forEach((e) => { if (e.type === 'qrcode') { const v = fillPh(e.text, data); if (v) vals.push(v); } });
  return vals;
}
function dmValuesOf(tpl, data) {
  const vals = [];
  (tpl.elements || []).forEach((e) => { if (e.type === 'datamatrix') { const v = fillPh(e.text, data); if (v) vals.push(v); } });
  return vals;
}
// Recupera QR e DataMatrix mancanti dal processo principale, poi ridisegna.
async function ensureQR(values, rerender, dmValues) {
  let added = false;
  for (const v of values) {
    if (!(v in qrCache)) {
      qrCache[v] = { size: 0 };
      try { const m = await window.zebra.qrMatrix(v); if (m && m.size) { qrCache[v] = m; added = true; } } catch (_) {}
    }
  }
  for (const v of (dmValues || [])) {
    const key = 'dm:' + v;
    if (!(key in qrCache)) {
      qrCache[key] = '';
      try { const url = await window.zebra.dmImage(v); if (url) { qrCache[key] = url; added = true; } } catch (_) {}
    }
  }
  if (added && typeof rerender === 'function') rerender();
}

// Parser CSV semplice: rileva delimitatore (, o ;), gestisce virgolette. Prima riga = intestazioni.
function parseCSV(text) {
  text = text.replace(/^﻿/, ''); // rimuove il BOM aggiunto da Excel
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim().length);
  if (!lines.length) return [];
  const delim = lines[0].split(';').length > lines[0].split(',').length ? ';' : ',';
  const parseLine = (line) => {
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else { if (c === '"') q = true; else if (c === delim) { out.push(cur); cur = ''; } else cur += c; }
    }
    out.push(cur); return out;
  };
  const headers = parseLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((l) => {
    const cells = parseLine(l); const o = {};
    headers.forEach((h, i) => { o[h] = (cells[i] ?? '').trim(); });
    return o;
  });
}

/* ============================ STAMPA ============================ */

function pickScanField(fields) {
  const textFields = fields.filter((f) => !f.type || f.type === 'text');
  const priority = textFields.find((f) => /codice|cf|barcode|qr|matricola|seriale|ean/i.test(f.name));
  return (priority || textFields[textFields.length - 1] || null)?.name || null;
}
function fieldLabel(field) { return field.label || humanize(field.name); }

function renderFields(tpl) {
  const container = el('fields');
  container.innerHTML = '';
  scanFieldName = pickScanField(tpl.fields);

  tpl.fields.forEach((field) => {
    const isScan = field.name === scanFieldName;
    const wrap = document.createElement('div');
    wrap.className = 'field' + (isScan ? ' scan' : '');
    const label = document.createElement('label');
    label.textContent = fieldLabel(field);
    if (isScan) { const b = document.createElement('span'); b.className = 'scan-badge'; b.textContent = t('dyn.scanner'); label.appendChild(b); }
    wrap.appendChild(label);

    if (field.type === 'multi-qty' && Array.isArray(field.options)) {
      const tubes = document.createElement('div'); tubes.className = 'tubes';
      field.options.forEach((opt) => {
        const row = document.createElement('div'); row.className = 'tube-row';
        const name = document.createElement('span'); name.className = 'tube-name tube-' + String(opt).toLowerCase(); name.textContent = opt;
        const minus = document.createElement('button'); minus.type = 'button'; minus.className = 'qbtn'; minus.textContent = '−';
        const qty = document.createElement('input'); qty.type = 'number'; qty.min = '0'; qty.value = '0'; qty.className = 'qty'; qty.dataset.multi = field.name; qty.dataset.value = opt;
        const plus = document.createElement('button'); plus.type = 'button'; plus.className = 'qbtn'; plus.textContent = '+';
        minus.onclick = () => { qty.value = Math.max(0, (Number(qty.value) || 0) - 1); updatePrintPreview(); };
        plus.onclick = () => { qty.value = (Number(qty.value) || 0) + 1; updatePrintPreview(); };
        qty.oninput = updatePrintPreview;
        row.append(name, minus, qty, plus); tubes.appendChild(row);
      });
      wrap.appendChild(tubes);
    } else if (field.type === 'select' && Array.isArray(field.options)) {
      const sel = document.createElement('select');
      field.options.forEach((opt) => { const o = document.createElement('option'); o.value = opt; o.textContent = opt; sel.appendChild(o); });
      sel.id = 'f_' + field.name; sel.dataset.field = field.name; sel.oninput = updatePrintPreview;
      wrap.appendChild(sel);
    } else {
      const input = document.createElement('input'); input.type = 'text'; input.autocomplete = 'off';
      input.id = 'f_' + field.name; input.dataset.field = field.name;
      input.addEventListener('keydown', onFieldKeydown);
      input.addEventListener('input', updatePrintPreview);
      wrap.appendChild(input);
    }
    container.appendChild(wrap);
  });

  if (scanFieldName) { const s = el('f_' + scanFieldName); if (s) setTimeout(() => s.focus(), 50); }
}

function renderElementsToggle(tpl) {
  const box = el('elementsBox'); const container = el('elements'); container.innerHTML = '';
  const els = tpl.elements || [];
  if (els.length === 0) { box.style.display = 'none'; return; }
  box.style.display = 'block';
  els.forEach((e) => {
    const item = document.createElement('label'); item.className = 'elem-item';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = e.enabledDefault; cb.dataset.index = e.index; cb.className = 'elem-cb';
    cb.onchange = updatePrintPreview;
    const txt = document.createElement('span'); txt.textContent = e.label;
    const type = document.createElement('span'); type.className = 'etype'; type.textContent = e.type;
    item.append(cb, txt, type); container.appendChild(item);
  });
}

function onFieldKeydown(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const autoprint = el('autoprint').checked;
  const inputs = Array.from(document.querySelectorAll('#fields input[data-field]'));
  const idx = inputs.indexOf(e.target);
  if (autoprint) doPrint();
  else if (idx > -1 && idx < inputs.length - 1) inputs[idx + 1].focus();
  else doPrint();
}

function collectData() {
  const data = {};
  document.querySelectorAll('#fields [data-field]').forEach((inp) => { data[inp.dataset.field] = (inp.value || '').trim(); });
  return data;
}
function collectMulti() {
  const qtys = Array.from(document.querySelectorAll('#fields .qty[data-multi]'));
  if (qtys.length === 0) return null;
  const field = qtys[0].dataset.multi;
  const items = qtys.map((q) => ({ value: q.dataset.value, qty: Number(q.value) || 0 })).filter((it) => it.qty > 0);
  return { field, items };
}
function collectEnabledIndices() {
  return Array.from(document.querySelectorAll('.elem-cb')).filter((cb) => cb.checked).map((cb) => Number(cb.dataset.index));
}
function getConnection() {
  const type = el('connType').value;
  if (type === 'printer') return { type, printer: el('printerSelect').value };
  if (type === 'ip') return { type, ip: el('ipInput').value.trim(), port: 9100 };
  if (type === 'usb') return { type, usb: el('usbInput').value.trim() };
  return { type };
}
function setStatus(kind, msg) { const s = el('status'); s.className = kind; s.textContent = msg; }
function applyTheme(t) {
  document.body.classList.toggle('dark', t === 'dark');
  const b = el('themeBtn'); if (b) b.textContent = t === 'dark' ? '☀️' : '🌙';
}

// Applica le impostazioni salvate ai controlli e alle variabili globali.
function applySettings(s) {
  applyTheme(s.theme || 'light');
  if (typeof s.autoprint === 'boolean') el('autoprint').checked = s.autoprint;
  defaultCopies = Number(s.defaultCopies) || 1;
  printDarkness = (s.darkness === undefined || s.darkness === null) ? '' : s.darkness;
  printSpeed = (s.speed === undefined || s.speed === null) ? '' : s.speed;
  defaultLanguage = s.defaultLanguage || 'zpl';
  editorGrid.show = s.gridShow !== false;
  editorGrid.snap = s.gridSnap !== false;
  editorGrid.step = Number(s.gridStep) || 0.5;
  // sincronizza i controlli inline dell'anteprima
  if (el('chkGrid')) el('chkGrid').checked = editorGrid.show;
  if (el('chkSnap')) el('chkSnap').checked = editorGrid.snap;
  if (el('gridStep')) el('gridStep').value = String(editorGrid.step);
}

// Popola i campi del pannello Impostazioni dai valori correnti.
function fillSettingsModal() {
  el('setTheme').value = document.body.classList.contains('dark') ? 'dark' : 'light';
  el('setAutoprint').checked = el('autoprint').checked;
  el('setCopies').value = defaultCopies || 1;
  el('setDarkness').value = printDarkness === '' ? '' : printDarkness;
  el('setSpeed').value = printSpeed === '' ? '' : printSpeed;
  el('setLang').value = defaultLanguage;
  el('srvEnable').checked = !!settings.serverEnabled;
  el('srvPort').value = settings.serverPort || 9110;
  el('srvToken').value = settings.serverToken || '';
  refreshServerStatus();
  el('setGrid').checked = editorGrid.show;
  el('setSnap').checked = editorGrid.snap;
  el('setStep').value = String(editorGrid.step);
}

// Legge il pannello, aggiorna variabili + controlli e salva.
function commitSettings() {
  const theme = el('setTheme').value;
  applyTheme(theme);
  el('autoprint').checked = el('setAutoprint').checked;
  defaultCopies = Math.max(1, Number(el('setCopies').value) || 1);
  printDarkness = el('setDarkness').value === '' ? '' : Math.max(0, Math.min(30, Number(el('setDarkness').value)));
  printSpeed = el('setSpeed').value === '' ? '' : Math.max(1, Math.min(6, Number(el('setSpeed').value)));
  defaultLanguage = el('setLang').value;
  editorGrid.show = el('setGrid').checked;
  editorGrid.snap = el('setSnap').checked;
  editorGrid.step = Number(el('setStep').value) || 0.5;
  if (el('chkGrid')) el('chkGrid').checked = editorGrid.show;
  if (el('chkSnap')) el('chkSnap').checked = editorGrid.snap;
  if (el('gridStep')) el('gridStep').value = String(editorGrid.step);
  window.zebra.saveSettings({
    theme, autoprint: el('autoprint').checked, defaultCopies, darkness: printDarkness, speed: printSpeed,
    defaultLanguage, gridShow: editorGrid.show, gridSnap: editorGrid.snap, gridStep: editorGrid.step,
  });
  if (el('editorView').style.display !== 'none') drawEditorCanvas();
}

function updatePrintPreview() {
  if (!rawTemplate) return;
  let data = collectData();
  if (importedRows && importedRows.length) {
    data = { ...data, ...importedRows[0] }; // anteprima con la prima riga del CSV
  }
  const multi = collectMulti();
  if (multi) { const first = multi.items[0]; data[multi.field] = first ? first.value : (current.fields.find(f => f.name === multi.field)?.options?.[0] || ''); }
  ensureQR(qrValuesOf(rawTemplate, data), updatePrintPreview, dmValuesOf(rawTemplate, data));
  el('previewFrame').innerHTML = window.LabelPreview.renderPreviewSVG(rawTemplate, data, collectEnabledIndices(), qrCache);
  el('previewNote').textContent = `${rawTemplate.width_mm}×${rawTemplate.height_mm} mm · ${rawTemplate.dpi || 203} dpi`;
}

async function testConnection() {
  const box = el('connStatus');
  box.style.color = '#94a3b8';
  box.textContent = t('dyn.testRunning');
  const r = await window.zebra.testConnection(getConnection());
  box.style.color = r.ok ? '#16a34a' : '#dc2626';
  box.textContent = (r.ok ? '✓ ' : '✗ ') + (r.ok ? r.message : (r.error || 'errore'));
}

async function refreshServerStatus() {
  const box = el('srvStatus'); if (!box) return;
  const st = await window.zebra.serverStatus();
  box.textContent = st.running ? t('set.serverOn', { url: st.url }) : t('set.serverOff');
  box.style.color = st.running ? '#16a34a' : 'var(--muted)';
}
async function toggleServer() {
  const enabled = el('srvEnable').checked;
  window.zebra.saveSettings({ serverEnabled: enabled, serverPort: Number(el('srvPort').value) || 9110, serverToken: el('srvToken').value.trim() });
  settings.serverEnabled = enabled; settings.serverPort = Number(el('srvPort').value) || 9110; settings.serverToken = el('srvToken').value.trim();
  if (enabled) { const r = await window.zebra.serverStart(); if (!r.ok) el('srvStatus').textContent = 'Errore: ' + r.error; }
  else await window.zebra.serverStop();
  refreshServerStatus();
}

async function runDiagnostics() {
  const box = el('diagResults');
  box.innerHTML = '<span style="color:var(--muted);font-size:12px;">' + t('dyn.diagRunning') + '</span>';
  const res = await window.zebra.diagnose(getConnection());
  const rows = (res && res.results) || [];
  if (!rows.length) { box.innerHTML = ''; return; }
  box.innerHTML = rows.map((r) =>
    `<div style="display:flex;gap:8px;align-items:flex-start;padding:6px 8px;border:1px solid var(--border);border-radius:7px;margin-bottom:6px;background:var(--card);">
      <span style="font-size:14px;">${r.ok ? '✅' : '❌'}</span>
      <div style="font-size:12px;"><b>${r.label}</b><br><span style="color:var(--muted);">${r.detail}</span></div>
    </div>`).join('');
}

async function exportTemplate() {
  let tpl;
  if (el('editorView').style.display !== 'none' && editing) { readEditorIntoDraft(); tpl = editing; }
  else tpl = rawTemplate;
  if (!tpl) return;
  const base = (el('edName') && el('edName').value.trim()) || tpl.name || 'template';
  const r = await window.zebra.saveFile({ defaultName: base + '.json', content: JSON.stringify(tpl, null, 2) });
  if (!r.canceled) setEditorStatus('ok', t('dyn.exported', { p: r.path }));
}

async function importTemplate() {
  const r = await window.zebra.pickFile('json');
  if (r.canceled) { if (r.error) setEditorStatus('err', r.error); return; }
  let json;
  try { json = JSON.parse(r.content); } catch (e) { setEditorStatus('err', t('dyn.badJson', { e: e.message })); return; }
  const fileName = json.name || r.name.replace(/\.json$/i, '') || 'importato';
  const res = await window.zebra.saveTemplate(fileName, json);
  if (res && res.ok) {
    await reloadTemplates();
    await selectTemplate(res.file);
    openEditor(json);
    setEditorStatus('ok', t('dyn.imported'));
  } else setEditorStatus('err', res?.error || 'Import error.');
}

async function doPrint() {
  if (!current) return;
  const data = collectData();
  const mult = Number(el('copies').value) || 1;

  // Stampa in blocco da CSV
  if (importedRows && importedRows.length) {
    el('printBtn').disabled = true;
    const total = importedRows.length * mult;
    setStatus('info', t('dyn.sendingCsv', { n: total }));
    const payload = {
      file: current.file, data, copies: el('copies').value, connection: getConnection(),
      enabledIndices: collectEnabledIndices(), rows: importedRows,
      darkness: printDarkness, speed: printSpeed,
    };
    const res = await window.zebra.print(payload);
    el('printBtn').disabled = false;
    if (res && res.ok) { setStatus('ok', t('dyn.sentCsv', { n: res.count })); recordHistory(payload, res.count); }
    else setStatus('err', t('dyn.printErr', { e: res?.error || '?' }));
    return;
  }

  if (scanFieldName && !data[scanFieldName]) { setStatus('err', t('dyn.fillField', { f: (current.fields.find(f => f.name === scanFieldName)?.label) || humanize(scanFieldName) })); el('f_' + scanFieldName)?.focus(); return; }
  const multi = collectMulti();
  if (multi && multi.items.length === 0) { setStatus('err', t('dyn.tubesMin')); return; }
  const total = multi ? multi.items.reduce((s, it) => s + it.qty, 0) * mult : mult;

  el('printBtn').disabled = true;
  setStatus('info', t('dyn.sending', { n: total }));
  const payload = {
    file: current.file, data, copies: el('copies').value, connection: getConnection(),
    enabledIndices: collectEnabledIndices(), multiField: multi ? multi.field : null, multiItems: multi ? multi.items : null,
    darkness: printDarkness, speed: printSpeed,
  };
  const res = await window.zebra.print(payload);
  el('printBtn').disabled = false;
  if (res && res.ok) {
    setStatus('ok', t('dyn.sent', { n: res.count }));
    recordHistory(payload, res.count);
    if (el('autoprint').checked && scanFieldName) { const s = el('f_' + scanFieldName); if (s) { s.value = ''; s.focus(); } updatePrintPreview(); }
  } else setStatus('err', t('dyn.printErr', { e: res?.error || '?' }));
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function sampleForField(name) {
  if (/codice|cf|sku|ean|barcode|matricola|seriale|id/i.test(name)) return 'ABC-123456';
  return humanize(name);
}

async function downloadCsvTemplate() {
  if (!current) return;
  const fields = current.fields.map((f) => f.name);
  if (!fields.length) { setStatus('err', t('dyn.csvNoFields')); return; }
  const header = fields.map(csvCell).join(',');
  const sample = fields.map((f) => csvCell(sampleForField(f))).join(',');
  const content = '﻿' + header + '\r\n' + sample + '\r\n'; // BOM per Excel
  const r = await window.zebra.saveFile({ defaultName: current.name + '-esempio.csv', content });
  if (!r.canceled) setStatus('ok', t('dyn.csvSaved', { p: r.path }));
}

let csvRaw = null; // { name, cols, rows } dell'ultimo CSV importato

// Ricostruisce importedRows applicando la mappatura campo→colonna scelta nei menu.
function applyCsvMapping() {
  if (!csvRaw || !current) return;
  const map = {};
  current.fields.forEach((f) => { const s = el('map_' + f.name); if (s) map[f.name] = s.value; });
  importedRows = csvRaw.rows.map((r) => {
    const o = {};
    current.fields.forEach((f) => { const col = map[f.name]; o[f.name] = col ? (r[col] ?? '') : ''; });
    return o;
  });
  updatePrintPreview();
}

async function importCsv() {
  if (!current) return;
  const r = await window.zebra.pickFile('csv');
  if (r.canceled) { if (r.error) setStatus('err', r.error); return; }
  const rows = parseCSV(r.content);
  if (!rows.length) { setStatus('err', t('dyn.csvNoRows')); return; }

  const cols = Object.keys(rows[0]);
  csvRaw = { name: r.name, cols, rows };
  const fields = current.fields;

  const banner = el('csvBanner');
  banner.style.display = 'block';
  const norm = (s) => s.toLowerCase().replace(/[_\-.\s]/g, '');
  const rowsHtml = fields.map((f) => {
    const autoCol = cols.find((c) => norm(c) === norm(f.name)) || '';
    const opts = [`<option value="">${t('dyn.csvEmpty')}</option>`]
      .concat(cols.map((c) => `<option value="${c}"${c === autoCol ? ' selected' : ''}>${c}</option>`))
      .join('');
    return `<div style="display:flex;align-items:center;gap:8px;margin:3px 0;">
      <span style="min-width:150px;font-weight:600;">${fieldLabel(f)}</span>
      <span style="color:var(--muted);">←</span>
      <select id="map_${f.name}" style="flex:1;">${opts}</select>
    </div>`;
  }).join('');

  banner.innerHTML = t('dyn.csvMap', { n: rows.length, name: r.name }) +
    `<div style="margin:8px 0;">${rowsHtml}</div>` +
    `${t('dyn.csvThenPrint')} <a href="#" id="csvCancel">${t('dyn.csvCancel')}</a>`;
  el('csvCancel').onclick = (e) => { e.preventDefault(); csvRaw = null; importedRows = null; banner.style.display = 'none'; updatePrintPreview(); };
  fields.forEach((f) => { const s = el('map_' + f.name); if (s) s.addEventListener('change', applyCsvMapping); });
  applyCsvMapping();
}

/* ============================ SIDEBAR / TEMPLATE ============================ */

function renderTemplateList() {
  const list = el('tplList'); list.innerHTML = '';
  const q = tplFilter.trim().toLowerCase();
  templates
    .filter((tpl) => !q || tpl.name.toLowerCase().includes(q) || (tpl.description || '').toLowerCase().includes(q))
    .forEach((tpl) => {
      const b = document.createElement('button');
      b.innerHTML = `${tpl.name}<br><span class="tag">${tpl.width_mm}×${tpl.height_mm}mm · ${tpl.editable ? t('dyn.custom') : t('dyn.factory')}</span>`;
      if (current && tpl.file === current.file) b.classList.add('active');
      b.onclick = () => selectTemplate(tpl.file);
      list.appendChild(b);
    });
}

/* ---- Storico stampe ---- */
function recordHistory(payload, count) {
  const p = { ...payload };
  if (Array.isArray(p.rows) && p.rows.length > 500) p.rows = p.rows.slice(0, 500);
  history.unshift({ ts: Date.now(), templateName: current ? current.name : payload.file, count, payload: p });
  history = history.slice(0, 15);
  window.zebra.saveSettings({ history });
  renderHistory();
}
function renderHistory() {
  const box = el('historyBox'), listEl = el('historyList');
  if (!history.length) { box.style.display = 'none'; return; }
  box.style.display = 'block';
  listEl.innerHTML = '';
  history.forEach((h, i) => {
    const d = new Date(h.ts);
    const when = d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const item = document.createElement('div'); item.className = 'hist-item';
    item.innerHTML = `<div class="meta"><b>${h.templateName}</b> — ${h.count} ${t('dyn.labels')}<br><small>${when}</small></div>`;
    const btn = document.createElement('button'); btn.className = 'ghost'; btn.textContent = t('dyn.reprint');
    btn.onclick = () => reprint(i);
    item.appendChild(btn);
    listEl.appendChild(item);
  });
}
async function reprint(i) {
  const h = history[i]; if (!h) return;
  setStatus('info', t('dyn.sending', { n: h.count || '' }));
  const res = await window.zebra.print(h.payload);
  if (res && res.ok) setStatus('ok', t('dyn.reprinted', { n: res.count }));
  else setStatus('err', t('dyn.printErr', { e: res?.error || '?' }));
}

async function selectTemplate(file) {
  current = templates.find((t) => t.file === file);
  if (!current) return;
  importedRows = null; csvRaw = null;
  const cb = el('csvBanner'); if (cb) cb.style.display = 'none';
  rawTemplate = await window.zebra.loadTemplateRaw(file);
  el('tplTitle').textContent = current.name;
  el('templateDesc').textContent = `${current.width_mm}×${current.height_mm} mm — ${current.description}`;
  renderFields(current);
  renderElementsToggle(current);
  renderTemplateList();
  el('copies').value = defaultCopies || 1;
  updatePrintPreview();
  window.zebra.saveSettings({ lastTemplate: file });
  // Se siamo in modalità Editor, ricarica l'editor con il modello appena scelto
  // (altrimenti si aggiornerebbe solo l'anteprima). Fix issue #1.
  if (el('editorView').style.display !== 'none') { editing = null; openEditor(rawTemplate); }
}

/* ============================ EDITOR ============================ */

function blankTemplate() {
  return { name: 'nuovo-modello', description: '', language: defaultLanguage || 'zpl', dpi: 203, width_mm: 51, height_mm: 25, tear_off: 30,
    field_meta: {}, elements: [{ label: 'Testo', type: 'text', x_mm: 3, y_mm: 3, font: '0', height_mm: 3, width_mm: 3, text: '{{testo}}' }] };
}

function refreshEditorUI() {
  el('edDesc').value = editing.description || '';
  el('edW').value = editing.width_mm; el('edH').value = editing.height_mm;
  el('edDpi').value = String(editing.dpi || 203); el('edTear').value = editing.tear_off ?? 30;
  if (el('edLang')) el('edLang').value = editing.language || 'zpl';
  renderEditorElements(); renderFieldMeta();
  updateEditorPreview();
}
function openEditor(raw) {
  editing = JSON.parse(JSON.stringify(raw));
  editorSel = null; undoStack = []; redoStack = [];
  el('edName').value = (current && current.file ? current.file.replace('.json', '') : editing.name) || 'nuovo-modello';
  if (el('edTitle')) el('edTitle').textContent = current ? t('dyn.editTitle', { n: (current.name || el('edName').value) }) : t('dyn.newTitle');
  refreshEditorUI();
  updateUndoButtons();
  setMode('editor');
}

// --- Undo / Redo dell'editor (snapshot su operazioni strutturali) ---
function pushSnapshot() {
  if (!editing) return;
  undoStack.push(JSON.stringify(editing));
  if (undoStack.length > 50) undoStack.shift();
  redoStack = [];
  updateUndoButtons();
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(editing));
  editing = JSON.parse(undoStack.pop());
  editorSel = null; refreshEditorUI(); updateUndoButtons();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(editing));
  editing = JSON.parse(redoStack.pop());
  editorSel = null; refreshEditorUI(); updateUndoButtons();
}
function updateUndoButtons() {
  const u = el('undoBtn'), r = el('redoBtn');
  if (u) u.disabled = undoStack.length === 0;
  if (r) r.disabled = redoStack.length === 0;
}

// Etichette come chiavi i18n (risolte con t() al render).
const ALIGN_OPTS = [['left', 'align.left'], ['center', 'align.center'], ['right', 'align.right']];
const ELEMENT_PROPS = {
  text: [['text', 'p.text', 'text', 'full'], ['height_mm', 'p.h', 'number'], ['width_mm', 'p.w', 'number'], ['font', 'p.font', 'text']],
  barcode128: [['text', 'p.data', 'text', 'full'], ['bar_height_mm', 'p.barh', 'number'], ['module_width', 'p.module', 'number'], ['show_text', 'p.showtext', 'bool'], ['align', 'p.align', 'select', null, ALIGN_OPTS], ['box_width_mm', 'p.boxw', 'number']],
  code39: [['text', 'p.data', 'text', 'full'], ['bar_height_mm', 'p.barh', 'number'], ['module_width', 'p.module', 'number'], ['show_text', 'p.showtext', 'bool'], ['align', 'p.align', 'select', null, ALIGN_OPTS], ['box_width_mm', 'p.boxw', 'number']],
  ean13: [['text', 'p.dataDigits', 'text', 'full'], ['bar_height_mm', 'p.barh', 'number'], ['module_width', 'p.module', 'number'], ['show_text', 'p.showtext', 'bool'], ['align', 'p.align', 'select', null, ALIGN_OPTS], ['box_width_mm', 'p.boxw', 'number']],
  code93: [['text', 'p.data', 'text', 'full'], ['bar_height_mm', 'p.barh', 'number'], ['module_width', 'p.module', 'number'], ['show_text', 'p.showtext', 'bool'], ['align', 'p.align', 'select', null, ALIGN_OPTS], ['box_width_mm', 'p.boxw', 'number']],
  datamatrix: [['text', 'p.data', 'text', 'full'], ['magnification', 'p.dmsize', 'number']],
  qrcode: [['text', 'p.data', 'text', 'full'], ['magnification', 'p.mag', 'number']],
  box: [['width_mm', 'p.w', 'number'], ['height_mm', 'p.h', 'number'], ['thickness_mm', 'p.thick', 'number']],
  line: [['width_mm', 'p.w', 'number'], ['height_mm', 'p.h', 'number'], ['thickness_mm', 'p.thick', 'number']],
};

function selectElement(i) {
  editorSel = i;
  renderEditorElements();
  drawEditorCanvas();
  // porta in vista la riga selezionata
  const row = document.querySelector(`#edElements .elrow[data-index="${i}"]`);
  if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function renderEditorElements() {
  const c = el('edElements'); c.innerHTML = '';
  (editing.elements || []).forEach((elem, i) => {
    const open = i === editorSel;
    const row = document.createElement('div'); row.className = 'elrow' + (open ? ' open' : ''); row.dataset.index = i;

    // Header (fisarmonica): click per selezionare/espandere
    const head = document.createElement('div'); head.className = 'elhead';
    const caret = document.createElement('span'); caret.textContent = open ? '▾' : '▸'; caret.style.cssText = 'cursor:pointer;color:var(--muted);width:14px;';
    const title = document.createElement('span'); title.style.cssText = 'flex:1;cursor:pointer;font-weight:600;';
    title.innerHTML = `${elem.label || elem.type} <span class="etype">${elem.type}</span>`;
    caret.onclick = title.onclick = () => selectElement(open ? -1 : i);

    const up = document.createElement('button'); up.className = 'qbtn'; up.textContent = '↑'; up.title = 'Su';
    const dn = document.createElement('button'); dn.className = 'qbtn'; dn.textContent = '↓'; dn.title = 'Giù';
    const del = document.createElement('button'); del.className = 'qbtn'; del.textContent = '✕'; del.title = 'Elimina'; del.style.color = 'var(--err)';
    up.onclick = () => { readEditorIntoDraft(); pushSnapshot(); if (i > 0) { [editing.elements[i - 1], editing.elements[i]] = [editing.elements[i], editing.elements[i - 1]]; editorSel = i - 1; } renderEditorElements(); drawEditorCanvas(); };
    dn.onclick = () => { readEditorIntoDraft(); pushSnapshot(); if (i < editing.elements.length - 1) { [editing.elements[i + 1], editing.elements[i]] = [editing.elements[i], editing.elements[i + 1]]; editorSel = i + 1; } renderEditorElements(); drawEditorCanvas(); };
    del.onclick = () => { readEditorIntoDraft(); pushSnapshot(); editing.elements.splice(i, 1); editorSel = null; renderEditorElements(); drawEditorCanvas(); };

    head.append(caret, title, up, dn, del);
    row.appendChild(head);

    if (open) {
      const bar = document.createElement('div'); bar.className = 'elhead'; bar.style.marginTop = '8px';
      const typeSel = document.createElement('select');
      ['text', 'barcode128', 'code39', 'code93', 'ean13', 'datamatrix', 'qrcode', 'box', 'line'].forEach((t) => { const o = document.createElement('option'); o.value = t; o.textContent = t; if (t === elem.type) o.selected = true; typeSel.appendChild(o); });
      typeSel.onchange = () => { readEditorIntoDraft(); pushSnapshot(); editing.elements[i].type = typeSel.value; renderEditorElements(); drawEditorCanvas(); };
      const lbl = document.createElement('input'); lbl.type = 'text'; lbl.placeholder = t('dyn.elLabelPh'); lbl.value = elem.label || ''; lbl.dataset.prop = 'label'; lbl.style.flex = '1';
      const en = document.createElement('label'); en.className = 'checkbox'; en.style.margin = '0';
      const enc = document.createElement('input'); enc.type = 'checkbox'; enc.checked = elem.enabled !== false; enc.dataset.prop = 'enabled';
      en.append(enc, document.createTextNode(' ' + t('dyn.elActive')));
      bar.append(typeSel, lbl, en);
      row.appendChild(bar);

      const grid = document.createElement('div'); grid.className = 'grid';
      const common = [['x_mm', 'X (mm)', 'number'], ['y_mm', 'Y (mm)', 'number']];
      const props = common.concat(ELEMENT_PROPS[elem.type] || []);
      props.forEach(([prop, label, kind, span, options]) => {
        const fld = document.createElement('div'); fld.className = 'fld' + (span === 'full' ? ' full' : '');
        const l = document.createElement('label'); l.textContent = t(label); fld.appendChild(l);
        let input;
        if (kind === 'bool') {
          input = document.createElement('select');
          [['true', t('bool.yes')], ['false', t('bool.no')]].forEach(([v, txt]) => { const o = document.createElement('option'); o.value = v; o.textContent = txt; input.appendChild(o); });
          input.value = String(elem[prop] !== false);
        } else if (kind === 'select') {
          input = document.createElement('select');
          (options || []).forEach(([v, txt]) => { const o = document.createElement('option'); o.value = v; o.textContent = t(txt); input.appendChild(o); });
          input.value = elem[prop] || (options && options[0] && options[0][0]) || '';
        } else {
          input = document.createElement('input'); input.type = kind === 'number' ? 'number' : 'text'; if (kind === 'number') input.step = '0.5';
          input.value = elem[prop] ?? '';
        }
        input.dataset.prop = prop;
        fld.appendChild(input); grid.appendChild(fld);
      });
      row.appendChild(grid);
      row.querySelectorAll('input, select').forEach((inp) => inp.addEventListener('input', debounce(() => { readEditorIntoDraft(); drawEditorCanvas(); })));
    }
    c.appendChild(row);
  });
}

function renderFieldMeta() {
  const c = el('edFieldMeta'); c.innerHTML = '';
  const meta = editing.field_meta || {};
  Object.keys(meta).forEach((name) => addFieldMetaRow(name, meta[name]));
}
function addFieldMetaRow(name, m) {
  const c = el('edFieldMeta');
  const row = document.createElement('div'); row.className = 'elrow fm-row';
  row.innerHTML = `
    <div class="grid" style="grid-template-columns:1fr 1fr;">
      <div class="fld"><label>${t('fm.name')}</label><input type="text" class="fm-name" value="${(name || '')}"></div>
      <div class="fld"><label>${t('fm.type')}</label><select class="fm-type">
        <option value="select">${t('fm.typeSelect')}</option>
        <option value="multi-qty">${t('fm.typeMulti')}</option>
      </select></div>
      <div class="fld full"><label>${t('fm.label')}</label><input type="text" class="fm-label" value="${(m && m.label) ? m.label : ''}"></div>
      <div class="fld full"><label>${t('fm.options')}</label><textarea class="fm-options" rows="4">${(m && m.options ? m.options.join('\n') : '')}</textarea></div>
    </div>
    <button class="qbtn fm-del" style="color:var(--err);margin-top:6px;">${t('fm.remove')}</button>`;
  row.querySelector('.fm-type').value = (m && m.type) || 'select';
  row.querySelector('.fm-del').onclick = () => { row.remove(); readEditorIntoDraft(); updateEditorPreview(); };
  row.querySelectorAll('input, select, textarea').forEach((inp) => inp.addEventListener('input', debounce(() => { readEditorIntoDraft(); updateEditorPreview(); })));
  c.appendChild(row);
}

// Legge un singolo elemento dell'editor (riga aperta) in un oggetto template.
function readElementRow(row, prevType) {
  const typeSel = row.querySelector('select');
  const type = typeSel ? typeSel.value : prevType;
  const obj = { type };
  row.querySelectorAll('[data-prop]').forEach((inp) => {
    const prop = inp.dataset.prop; const val = inp.value;
    if (prop === 'enabled') { obj.enabled = inp.checked; return; }
    if (prop === 'show_text') { obj.show_text = (val === 'true'); return; }
    if (val === '') return;
    const numeric = ['x_mm', 'y_mm', 'height_mm', 'width_mm', 'bar_height_mm', 'module_width', 'magnification', 'thickness_mm', 'box_width_mm'];
    obj[prop] = numeric.includes(prop) ? Number(val) : val;
  });
  if (obj.enabled === true) delete obj.enabled; // default true: non serve salvarlo
  if (obj.align === 'left') delete obj.align; // default: non serve salvarlo
  return obj;
}

// Legge i controlli dell'editor dentro `editing`.
// NB: con la lista a fisarmonica solo la riga selezionata ha i campi nel DOM;
// le altre restano quelle già presenti in `editing` (anche le posizioni cambiate col trascinamento).
function readEditorIntoDraft() {
  if (!editing) return;
  editing.description = el('edDesc').value.trim();
  editing.dpi = Number(el('edDpi').value) || 203;
  editing.width_mm = Number(el('edW').value) || 0;
  editing.height_mm = Number(el('edH').value) || 0;
  const tear = el('edTear').value; editing.tear_off = tear === '' ? undefined : Number(tear);
  if (el('edLang')) editing.language = el('edLang').value;

  // solo l'elemento aperto (se presente)
  const openRow = document.querySelector('#edElements .elrow.open');
  if (openRow && editorSel != null && editing.elements[editorSel]) {
    const prev = editing.elements[editorSel];
    const merged = readElementRow(openRow, prev.type);
    // conserva la label se non modificata (input label ha data-prop="label")
    editing.elements[editorSel] = merged;
  }

  // field_meta
  const meta = {};
  document.querySelectorAll('#edFieldMeta .fm-row').forEach((row) => {
    const name = row.querySelector('.fm-name').value.trim();
    if (!name) return;
    const type = row.querySelector('.fm-type').value;
    const label = row.querySelector('.fm-label').value.trim();
    const options = row.querySelector('.fm-options').value.split(/\n/).map((s) => s.trim()).filter(Boolean);
    meta[name] = { type, options };
    if (label) meta[name].label = label;
  });
  editing.field_meta = meta;
}

function sampleData(tpl) {
  const data = {};
  const ph = new Set();
  (tpl.elements || []).forEach((e) => { const s = e.text || ''; const re = /\{\{\s*([\w.\-]+)\s*\}\}/g; let m; while ((m = re.exec(s))) ph.add(m[1]); });
  ph.forEach((name) => {
    if (/codice|cf/i.test(name)) data[name] = 'ABC-123456';
    else if ((tpl.field_meta || {})[name] && tpl.field_meta[name].options && tpl.field_meta[name].options[0]) data[name] = tpl.field_meta[name].options[0];
    else data[name] = humanize(name);
  });
  return data;
}

function updateEditorPreview() { drawEditorCanvas(); }

function snapVal(v) {
  if (!editorGrid.snap) return Math.round(v * 10) / 10;
  const s = editorGrid.step;
  return Math.round(v / s) * s;
}

function gridSVG(W, H) {
  if (!editorGrid.show) return '';
  let g = '';
  const minor = editorGrid.step >= 1 ? editorGrid.step : 1;
  for (let x = 0; x <= W; x += minor) g += `<line class="gridline${x % 5 === 0 ? ' major' : ''}" x1="${x}" y1="0" x2="${x}" y2="${H}"/>`;
  for (let y = 0; y <= H; y += minor) g += `<line class="gridline${y % 5 === 0 ? ' major' : ''}" x1="0" y1="${y}" x2="${W}" y2="${y}"/>`;
  return g;
}

function drawEditorCanvas() {
  if (!editing) return;
  const W = Number(editing.width_mm) || 50, H = Number(editing.height_mm) || 25;
  const data = sampleData(editing);
  const allIdx = (editing.elements || []).map((_, i) => i); // in editor mostra tutti
  ensureQR(qrValuesOf(editing, data), drawEditorCanvas, dmValuesOf(editing, data));
  const visual = window.LabelPreview.renderPreviewSVG(editing, data, allIdx, qrCache).replace('<svg ', '<svg class="visual" ');
  const boxes = window.LabelPreview.computeBoxes(editing, data);

  let ov = `<svg class="overlay" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">`;
  ov += gridSVG(W, H);
  boxes.forEach((b) => {
    const w = Math.max(b.w, 2), h = Math.max(b.h, 2);
    if (b.index === editorSel) {
      ov += `<rect class="sel" x="${b.x}" y="${b.y}" width="${w}" height="${h}"/>`;
      ov += `<rect class="handle" data-handle="${b.index}" x="${(b.x + w - 1.2).toFixed(2)}" y="${(b.y + h - 1.2).toFixed(2)}" width="2.4" height="2.4"/>`;
    }
    ov += `<rect class="hit" data-hit="${b.index}" x="${b.x}" y="${b.y}" width="${w}" height="${h}"/>`;
  });
  ov += `</svg>`;

  el('previewFrame').innerHTML = `<div class="canvaswrap">${visual}${ov}</div>`;
  el('previewNote').textContent = `${W}×${H} mm · ${editing.dpi || 203} dpi (${t('prev.note.editor')})`;
  attachCanvasHandlers();
}

// Restituisce l'SVG overlay attualmente nel DOM (viene ricreato ad ogni ridisegno).
function liveOverlay() { return el('previewFrame').querySelector('svg.overlay'); }

function clientToMm(evt, svg) {
  if (!svg) return null;
  const m = svg.getScreenCTM();
  if (!m) return null;
  const pt = svg.createSVGPoint(); pt.x = evt.clientX; pt.y = evt.clientY;
  const p = pt.matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
}

function attachCanvasHandlers() {
  const svg = liveOverlay();
  if (!svg) return;
  svg.querySelectorAll('.hit').forEach((rect) => {
    rect.addEventListener('pointerdown', (e) => startDrag(e, Number(rect.dataset.hit), 'move'));
  });
  const handle = svg.querySelector('.handle');
  if (handle) handle.addEventListener('pointerdown', (e) => startDrag(e, Number(handle.dataset.handle), 'resize'));
}

function startDrag(e, index, mode) {
  e.preventDefault(); e.stopPropagation();
  if (editorSel !== index) selectElement(index);
  const elem = editing.elements[index];
  // Legge sempre dall'SVG vivo: dopo selectElement/ridisegno l'elemento cambia.
  const start = clientToMm(e, liveOverlay());
  if (!start) return;
  const orig = { x: Number(elem.x_mm) || 0, y: Number(elem.y_mm) || 0 };

  let raf = null;
  const move = (ev) => {
    const pt = clientToMm(ev, liveOverlay());
    if (!pt) return;
    if (mode === 'move') {
      elem.x_mm = Math.max(0, snapVal(orig.x + (pt.x - start.x)));
      elem.y_mm = Math.max(0, snapVal(orig.y + (pt.y - start.y)));
    } else {
      const w = snapVal(Math.max(1, pt.x - orig.x));
      const h = snapVal(Math.max(1, pt.y - orig.y));
      if (elem.type === 'text') { elem.height_mm = Math.max(1, h); elem.width_mm = Math.max(1, h); }
      else if (elem.type === 'barcode128') { elem.bar_height_mm = Math.max(2, h); }
      else if (elem.type === 'qrcode') { elem.magnification = Math.min(10, Math.max(1, Math.round(w / 5))); }
      else { elem.width_mm = Math.max(1, w); elem.height_mm = Math.max(0, snapVal(pt.y - orig.y)); }
    }
    if (!raf) raf = requestAnimationFrame(() => { raf = null; drawEditorCanvas(); });
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    renderEditorElements(); // sincronizza i campi numerici
    drawEditorCanvas();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function setEditorStatus(kind, msg) {
  const s = el('editorStatus'); s.className = kind; s.textContent = msg;
  s.style.cssText = 'margin-top:12px;padding:10px 12px;border-radius:7px;font-weight:500;' +
    (kind === 'ok' ? 'background:#dcfce7;color:#16a34a;' : kind === 'err' ? 'background:#fee2e2;color:#dc2626;' : 'background:#dbeafe;color:#2563eb;');
}

async function saveEditor(asNew) {
  readEditorIntoDraft();
  let name = el('edName').value.trim();
  if (!name) { setEditorStatus('err', t('dyn.nameNeeded')); return; }
  editing.name = name.replace(/\.json$/, '');
  if (asNew && current && (name + '.json') === current.file) name = name + '-copy';
  const res = await window.zebra.saveTemplate(name, editing);
  if (res && res.ok) {
    setEditorStatus('ok', t('dyn.saved'));
    await reloadTemplates();
    await selectTemplate(res.file);
  } else setEditorStatus('err', t('dyn.printErr', { e: res?.error || '?' }));
}

async function deleteEditor() {
  if (!current) return;
  if (!current.editable) { setEditorStatus('err', t('dyn.factoryDelete')); return; }
  const res = await window.zebra.deleteTemplate(current.file);
  if (res && res.ok) { await reloadTemplates(); if (templates[0]) await selectTemplate(templates[0].file); setMode('print'); }
  else setEditorStatus('err', res?.error || 'Cannot delete.');
}

/* ============================ MODO / INIT ============================ */

function setMode(mode) {
  const isEditor = mode === 'editor';
  el('printView').style.display = isEditor ? 'none' : 'block';
  el('editorView').style.display = isEditor ? 'block' : 'none';
  el('modePrint').classList.toggle('active', !isEditor);
  el('modeEditor').classList.toggle('active', isEditor);
  el('previewControls').style.display = isEditor ? 'flex' : 'none';
  el('previewHint').style.display = isEditor ? 'block' : 'none';
  if (isEditor) { if (!editing) openEditor(rawTemplate || blankTemplate()); else updateEditorPreview(); }
  else updatePrintPreview();
}

function onConnTypeChange() {
  const type = el('connType').value;
  el('wrapPrinter').style.display = type === 'printer' ? 'block' : 'none';
  el('wrapIp').style.display = type === 'ip' ? 'block' : 'none';
  el('wrapUsb').style.display = type === 'usb' ? 'block' : 'none';
  window.zebra.saveSettings({ connType: type });
  updateConnSummary();
}

// Riepilogo compatto della connessione mostrato nella barra laterale.
function updateConnSummary() {
  const box = el('connSummary'); if (!box) return;
  const type = el('connType').value;
  if (type === 'printer') box.textContent = '🖨️ ' + (el('printerSelect').value || t('dyn.noPrinter'));
  else if (type === 'ip') box.textContent = '🌐 ' + (el('ipInput').value || t('dyn.noIp')) + ':9100';
  else box.textContent = '🔌 USB ' + (el('usbInput').value || '(porta?)');
}

async function reloadTemplates() {
  templates = await window.zebra.listTemplates();
  renderTemplateList();
}

async function init() {
  settings = await window.zebra.getSettings() || {};

  // Lingua interfaccia (default English)
  const uiLang = settings.uiLang || 'en';
  window.I18N.setLang(uiLang);
  document.documentElement.lang = uiLang;
  window.I18N.applyStatic();
  if (el('uiLang')) {
    el('uiLang').value = uiLang;
    el('uiLang').addEventListener('change', () => { window.zebra.saveSettings({ uiLang: el('uiLang').value }); location.reload(); });
  }

  // Stampanti
  const printers = await window.zebra.listPrinters();
  const sel = el('printerSelect');
  printers.forEach((n) => { const o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o); });
  const zebra = printers.find((n) => /zebra|zd410/i.test(n));
  if (settings.printer && printers.includes(settings.printer)) sel.value = settings.printer;
  else if (zebra) sel.value = zebra;

  if (settings.connType) el('connType').value = settings.connType;
  if (settings.ip) el('ipInput').value = settings.ip;
  if (settings.usb) el('usbInput').value = settings.usb;
  applySettings(settings);

  // Template
  await reloadTemplates();
  const startFile = (settings.lastTemplate && templates.some((t) => t.file === settings.lastTemplate))
    ? settings.lastTemplate
    : (templates.find((t) => /codice-fiscale/i.test(t.file))?.file || templates[0]?.file);
  if (startFile) await selectTemplate(startFile);

  // Eventi
  el('connType').addEventListener('change', onConnTypeChange);
  el('printerSelect').addEventListener('change', () => { window.zebra.saveSettings({ printer: el('printerSelect').value }); updateConnSummary(); });
  el('ipInput').addEventListener('change', () => { window.zebra.saveSettings({ ip: el('ipInput').value.trim() }); updateConnSummary(); });
  el('usbInput').addEventListener('change', () => { window.zebra.saveSettings({ usb: el('usbInput').value.trim() }); updateConnSummary(); });
  el('autoprint').addEventListener('change', () => window.zebra.saveSettings({ autoprint: el('autoprint').checked }));
  el('printBtn').addEventListener('click', doPrint);

  el('modePrint').addEventListener('click', () => setMode('print'));
  el('modeEditor').addEventListener('click', () => { editing = null; setMode('editor'); });
  el('editThisBtn').addEventListener('click', () => { editing = null; openEditor(rawTemplate || blankTemplate()); });
  el('backToPrintBtn').addEventListener('click', () => setMode('print'));
  el('newTemplateBtn').addEventListener('click', () => { current = null; rawTemplate = null; editing = null; openEditor(blankTemplate()); });

  el('saveTplBtn').addEventListener('click', () => saveEditor(false));
  el('duplicateTplBtn').addEventListener('click', () => saveEditor(true));
  el('deleteTplBtn').addEventListener('click', deleteEditor);
  el('exportTplBtn').addEventListener('click', exportTemplate);
  el('importTplBtn').addEventListener('click', importTemplate);
  el('testConnBtn').addEventListener('click', testConnection);
  el('diagBtn').addEventListener('click', runDiagnostics);
  el('importCsvBtn').addEventListener('click', importCsv);
  el('csvTemplateBtn').addEventListener('click', downloadCsvTemplate);
  el('undoBtn').addEventListener('click', undo);
  el('redoBtn').addEventListener('click', redo);

  // Ricerca template
  el('tplSearch').addEventListener('input', () => { tplFilter = el('tplSearch').value; renderTemplateList(); });

  // Tema chiaro/scuro (toggle rapido)
  el('themeBtn').addEventListener('click', () => {
    const nt = document.body.classList.contains('dark') ? 'light' : 'dark';
    applyTheme(nt); window.zebra.saveSettings({ theme: nt });
  });

  // Pannello Impostazioni
  const showSettings = (v) => { if (v) fillSettingsModal(); el('settingsModal').style.display = v ? 'flex' : 'none'; };
  el('settingsBtn').addEventListener('click', () => showSettings(true));
  el('openSettingsBtn').addEventListener('click', () => showSettings(true));
  el('settingsClose').addEventListener('click', () => showSettings(false));
  el('settingsModal').addEventListener('click', (e) => { if (e.target === el('settingsModal')) showSettings(false); });
  ['setTheme', 'setAutoprint', 'setCopies', 'setDarkness', 'setSpeed', 'setLang', 'setGrid', 'setSnap', 'setStep']
    .forEach((id) => el(id).addEventListener('change', commitSettings));

  // Generale: apri cartella, ripristina, versione
  ['srvEnable', 'srvPort', 'srvToken'].forEach((id) => el(id).addEventListener('change', toggleServer));
  el('openFolderBtn').addEventListener('click', () => window.zebra.openTemplatesFolder());
  el('resetSettingsBtn').addEventListener('click', async () => {
    if (!confirm(t('dyn.confirmReset'))) return;
    await window.zebra.resetSettings();
    location.reload();
  });
  window.zebra.appVersion().then((v) => { const e = el('appVersion'); if (e) e.textContent = 'LabelForge v' + v; }).catch(() => {});

  // Esc chiude le finestre
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { el('settingsModal').style.display = 'none'; el('helpModal').style.display = 'none'; }
  });

  // Legenda scorciatoie
  const showHelp = (v) => { el('helpModal').style.display = v ? 'flex' : 'none'; };
  el('helpBtn').addEventListener('click', () => showHelp(true));
  el('helpClose').addEventListener('click', () => showHelp(false));
  el('helpModal').addEventListener('click', (e) => { if (e.target === el('helpModal')) showHelp(false); });

  // Storico stampe
  history = Array.isArray(settings.history) ? settings.history : [];
  renderHistory();

  // Scorciatoie da tastiera
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const inEditor = el('editorView').style.display !== 'none';
    const k = e.key.toLowerCase();
    if (k === 'p') { e.preventDefault(); if (!inEditor) doPrint(); }
    else if (k === 's') { if (inEditor) { e.preventDefault(); saveEditor(false); } }
    else if (k === 'f') { e.preventDefault(); el('tplSearch').focus(); }
    else if (k === 'z') { if (inEditor) { e.preventDefault(); undo(); } }
    else if (k === 'y') { if (inEditor) { e.preventDefault(); redo(); } }
  });
  el('addFieldMetaBtn').addEventListener('click', () => addFieldMetaRow('', { type: 'select', options: [] }));

  // Controlli griglia / snap dell'anteprima interattiva
  el('chkGrid').addEventListener('change', () => { editorGrid.show = el('chkGrid').checked; window.zebra.saveSettings({ gridShow: editorGrid.show }); drawEditorCanvas(); });
  el('chkSnap').addEventListener('change', () => { editorGrid.snap = el('chkSnap').checked; window.zebra.saveSettings({ gridSnap: editorGrid.snap }); });
  el('gridStep').addEventListener('change', () => { editorGrid.step = Number(el('gridStep').value); window.zebra.saveSettings({ gridStep: editorGrid.step }); drawEditorCanvas(); });

  // Proprietà editor → anteprima live
  el('edName').addEventListener('input', () => { if (el('edTitle')) el('edTitle').textContent = t('dyn.editTitle', { n: (el('edName').value || '—') }); });
  ['edName', 'edDesc', 'edW', 'edH', 'edDpi', 'edTear', 'edLang'].forEach((id) =>
    el(id).addEventListener('input', debounce(() => { readEditorIntoDraft(); updateEditorPreview(); })));

  document.querySelectorAll('[data-add]').forEach((btn) => btn.addEventListener('click', () => {
    readEditorIntoDraft();
    pushSnapshot();
    const t = btn.dataset.add;
    const defaults = {
      text: { label: 'Testo', type: 'text', x_mm: 3, y_mm: 3, font: '0', height_mm: 3, width_mm: 3, text: '{{campo}}' },
      barcode128: { label: 'Barcode', type: 'barcode128', x_mm: 3, y_mm: 3, bar_height_mm: 10, module_width: 2, show_text: false, text: '{{campo}}' },
      code39: { label: 'Code39', type: 'code39', x_mm: 3, y_mm: 3, bar_height_mm: 10, module_width: 2, show_text: true, text: '{{campo}}' },
      ean13: { label: 'EAN-13', type: 'ean13', x_mm: 3, y_mm: 3, bar_height_mm: 12, module_width: 2, show_text: true, text: '{{campo}}' },
      code93: { label: 'Code93', type: 'code93', x_mm: 3, y_mm: 3, bar_height_mm: 10, module_width: 2, show_text: true, text: '{{campo}}' },
      datamatrix: { label: 'DataMatrix', type: 'datamatrix', x_mm: 3, y_mm: 3, magnification: 5, text: '{{campo}}' },
      qrcode: { label: 'QR code', type: 'qrcode', x_mm: 3, y_mm: 3, magnification: 4, text: '{{campo}}' },
      box: { label: 'Riquadro', type: 'box', x_mm: 2, y_mm: 2, width_mm: 40, height_mm: 20, thickness_mm: 0.4 },
      line: { label: 'Linea', type: 'line', x_mm: 2, y_mm: 10, width_mm: 40, height_mm: 0, thickness_mm: 0.4 },
    };
    editing.elements.push(defaults[t]); renderEditorElements(); updateEditorPreview();
  }));

  onConnTypeChange();
  updateConnSummary();
}

init();
