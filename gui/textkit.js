'use strict';

// TextKit — funzioni di testo condivise tra app (anteprima/editor) e generatori di stampa.
// - Segnaposto {{campo}} con campi automatici: data, ora, scadenze, contatore.
// - A capo automatico (testo su più righe).
// - Stima della dimensione di un DataMatrix ECC200.
// Funziona sia nel browser (window.TextKit) sia in Node (module.exports).
(function () {
  // Nomi dei segnaposto: lettere/cifre/_ . - più + : / per offset e formati (es. {{date+30:YYYY-MM-DD}}).
  const PH_RE = /\{\{\s*([\w.\-+:\/]+)\s*\}\}/g;

  // ---------------- Campi automatici ----------------
  // {{date}}            data di oggi (DD/MM/YYYY)
  // {{date+30}}         oggi + 30 giorni (anche -N, e suffissi d/m/y: {{date+6m}}, {{date+1y}})
  // {{date:YYYY-MM-DD}} formato personalizzato (YYYY YY MM DD HH mm ss)
  // {{time}}            ora (HH:mm)      {{now}}  data e ora (DD/MM/YYYY HH:mm)
  // {{counter}}         numero progressivo per etichetta; {{counter:4}} → 0001
  const BUILTIN_RE = /^(date|time|now|counter)(?:([+-]\d+)([dmy])?)?(?::(.+))?$/i;

  function isBuiltin(name) { return BUILTIN_RE.test(String(name || '')); }

  const pad = (n, w) => String(n).padStart(w, '0');

  function formatDate(d, fmt) {
    return String(fmt).replace(/YYYY|YY|MM|DD|HH|mm|ss/g, (tok) => ({
      YYYY: String(d.getFullYear()), YY: String(d.getFullYear()).slice(-2),
      MM: pad(d.getMonth() + 1, 2), DD: pad(d.getDate(), 2),
      HH: pad(d.getHours(), 2), mm: pad(d.getMinutes(), 2), ss: pad(d.getSeconds(), 2),
    })[tok]);
  }

  function addOffset(base, amount, unit) {
    const d = new Date(base.getTime());
    if (unit === 'm') d.setMonth(d.getMonth() + amount);
    else if (unit === 'y') d.setFullYear(d.getFullYear() + amount);
    else d.setDate(d.getDate() + amount);
    return d;
  }

  // ctx = { now: Date, counter: number }. Ritorna undefined se il nome non è un campo automatico.
  function resolveBuiltin(name, ctx) {
    const m = BUILTIN_RE.exec(String(name || ''));
    if (!m) return undefined;
    const kind = m[1].toLowerCase();
    const fmt = m[4];
    const c = ctx || {};
    if (kind === 'counter') {
      const n = Number.isFinite(c.counter) ? c.counter : 1;
      const w = Number(fmt) || 0;
      return w > 0 ? pad(n, w) : String(n);
    }
    let d = c.now instanceof Date ? c.now : new Date();
    if (m[2]) d = addOffset(d, Number(m[2]), (m[3] || 'd').toLowerCase());
    const def = kind === 'time' ? 'HH:mm' : kind === 'now' ? 'DD/MM/YYYY HH:mm' : 'DD/MM/YYYY';
    return formatDate(d, fmt || def);
  }

  // Sostituisce i segnaposto. I dati dell'utente hanno la precedenza (es. una colonna CSV "date");
  // se mancano e il nome è un campo automatico, si usa il valore calcolato (ctx o data.__lf).
  function fill(str, data, ctx) {
    if (typeof str !== 'string') return str;
    const d = data || {};
    const context = ctx || d.__lf;
    return str.replace(PH_RE, (_, key) => {
      const val = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), d);
      if (val !== undefined && val !== null && val !== '') return String(val);
      const b = resolveBuiltin(key, context);
      return b === undefined ? '' : b;
    });
  }

  // Nomi dei segnaposto che l'utente deve compilare (esclusi i campi automatici).
  function userPlaceholders(str) {
    const out = [];
    if (typeof str !== 'string') return out;
    let m; const re = new RegExp(PH_RE.source, 'g');
    while ((m = re.exec(str)) !== null) if (!isBuiltin(m[1])) out.push(m[1]);
    return out;
  }

  // Elenco dei dati per etichetta con il contesto dei campi automatici:
  // una voce per ogni etichetta fisica (copie incluse), contatore progressivo su tutto il lavoro.
  function expandLabels(dataList, copies, opts, template) {
    const n = Math.max(1, Number(copies) || 1);
    const valid = (v) => v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v));
    const fromOpts = opts ? opts.counterStart : undefined;
    const fromTpl = template ? template.counter_start : undefined;
    const start = valid(fromOpts) ? Number(fromOpts) : valid(fromTpl) ? Number(fromTpl) : 1;
    const now = (opts && opts.now instanceof Date) ? opts.now : new Date();
    const out = []; let i = 0;
    for (const data of dataList || []) {
      for (let c = 0; c < n; c++) out.push(Object.assign({}, data, { __lf: { now, counter: start + i++ } }));
    }
    return out;
  }

  // Il template usa campi automatici di un certo tipo? (es. per mostrare "contatore da" nella GUI)
  function usesBuiltin(template, kind) {
    return (template && template.elements || []).some((el) => {
      if (typeof el.text !== 'string') return false;
      let m; const re = new RegExp(PH_RE.source, 'g');
      while ((m = re.exec(el.text)) !== null) {
        const b = BUILTIN_RE.exec(m[1]);
        if (b && (!kind || b[1].toLowerCase() === kind)) return true;
      }
      return false;
    });
  }

  // ---------------- A capo automatico ----------------
  // Divide il testo in righe di al massimo maxChars caratteri (a parole; parole troppo lunghe
  // vengono spezzate). Oltre maxLines righe, l'ultima riga viene troncata con "…".
  function wrapText(text, maxChars, maxLines, ellipsis) {
    const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    const limit = Math.max(1, Math.floor(maxChars) || 1);
    const lines = []; let cur = '';
    for (const word of s.split(' ')) {
      let w = word;
      while (w.length > limit) {
        if (cur) { lines.push(cur); cur = ''; }
        lines.push(w.slice(0, limit)); w = w.slice(limit);
      }
      if (!cur) cur = w;
      else if ((cur + ' ' + w).length <= limit) cur += ' ' + w;
      else { lines.push(cur); cur = w; }
    }
    if (cur || !lines.length) lines.push(cur);
    const max = Math.max(1, Number(maxLines) || 1);
    if (lines.length > max) {
      const kept = lines.slice(0, max);
      const last = kept[max - 1];
      const ell = ellipsis == null ? '…' : String(ellipsis);
      kept[max - 1] = (last.length + ell.length > limit ? last.slice(0, Math.max(0, limit - ell.length)) : last) + ell;
      return kept;
    }
    return lines;
  }

  // Righe di testo con la loro x (mm), per i linguaggi senza a capo/allineamento nativi
  // (TSPL/EPL/EZPL/CPCL). charWidthMm = larghezza stimata di un carattere; alignFn = alignInBox.
  // Con una sola riga il risultato è identico alla v1.18 (stesso calcolo dell'allineamento).
  function layoutText(raw, el, charWidthMm, alignFn) {
    const maxLines = Math.max(1, Math.floor(Number(el.max_lines) || 1));
    const box = Number(el.box_width_mm) || 0;
    const x = Number(el.x_mm != null ? el.x_mm : el.x) || 0;
    const text = String(raw == null ? '' : raw);
    const lines = maxLines > 1 && box > 0 ? wrapText(text, box / charWidthMm, maxLines, '...') : [text];
    return lines.map((t) => ({ text: t, x: alignFn ? alignFn(x, t.length * charWidthMm, el.align, box) : x }));
  }

  // ---------------- DataMatrix ECC200: lato del simbolo in moduli (stima) ----------------
  // Stima prudente in sola codifica ASCII (coppie di cifre = 1, ASCII = 1, estesi = 2): usata finché
  // non c'è il calcolo esatto (bwip-js in stampa, immagine generata in anteprima).
  const DM_SIZES = [[10, 3], [12, 5], [14, 8], [16, 12], [18, 18], [20, 22], [22, 30], [24, 36], [26, 44],
    [32, 62], [36, 86], [40, 114], [44, 144], [48, 174], [52, 204], [64, 280], [72, 368], [80, 456],
    [88, 576], [96, 696], [104, 816], [120, 1050], [132, 1304], [144, 1558]];
  function dmModules(text) {
    const s = String(text == null ? '' : text);
    let cw = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 48 && c <= 57 && i + 1 < s.length && s.charCodeAt(i + 1) >= 48 && s.charCodeAt(i + 1) <= 57) { cw++; i++; }
      else cw += c > 127 ? 2 : 1;
    }
    const hit = DM_SIZES.find(([, cap]) => cap >= Math.max(1, cw));
    return hit ? hit[0] : 144;
  }

  const api = { PH_RE, isBuiltin, resolveBuiltin, formatDate, fill, userPlaceholders, expandLabels, usesBuiltin, wrapText, layoutText, dmModules };
  if (typeof window !== 'undefined') window.TextKit = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
