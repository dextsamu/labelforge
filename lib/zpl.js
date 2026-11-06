'use strict';

/**
 * Costruttore di etichette ZPL per Zebra ZD410.
 * Converte un "template" JSON dinamico (misure in mm) + dati in un buffer ZPL pronto da inviare alla stampante.
 */

function mmToDots(mm, dpi) {
  return Math.round((Number(mm) || 0) * (dpi / 25.4));
}

const TextKit = require('../gui/textkit.js');

// Sostituisce i placeholder {{campo}} con i valori presenti in data.
// Se un campo manca, lascia una stringa vuota (evita "{{undefined}}" in stampa).
// Supporta i campi automatici {{date}}, {{date+30}}, {{time}}, {{now}}, {{counter:4}} (v1.19).
function fillPlaceholders(str, data) {
  return TextKit.fill(str, data);
}

// In pratica per la maggior parte delle etichette (testo/numeri/date) non servono caratteri
// speciali ZPL nel contenuto. Usiamo una escape "soft": sostituiamo solo se il testo contiene
// davvero ^ o ~, altrimenti lasciamo il testo intatto per non complicare l'output.
function safeFieldData(text) {
  const s = String(text);
  if (s.includes('^') || s.includes('~')) {
    return s.replace(/\^/g, '').replace(/~/g, '');
  }
  return s;
}

const Barcode = require('../gui/barcode.js');

// Lato del QR in moduli (stessa correzione d'errore usata in stampa: "QA," = livello Q).
// Serve per allineare QR/DataMatrix e per far coincidere l'anteprima con la stampa.
let QRCode = null;
try { QRCode = require('qrcode'); } catch (_) { /* dipendenza opzionale nei test */ }
function qrModules(text, ecc = 'Q') {
  try { return QRCode ? QRCode.create(String(text || ' '), { errorCorrectionLevel: ecc }).modules.size : 25; }
  catch (_) { return 25; }
}
// Lato del DataMatrix in moduli: calcolo esatto con bwip-js (codifica ottimale come la stampante),
// altrimenti stima ECC200 in sola codifica ASCII.
let bwip = null;
try { bwip = require('bwip-js'); } catch (_) { /* dipendenza opzionale nei test */ }
function dmModules(text) {
  try { if (bwip) { const r = bwip.raw('datamatrix', String(text || ' '), ''); if (r && r[0] && r[0].pixx) return r[0].pixx; } }
  catch (_) { /* testo non codificabile: uso la stima */ }
  return TextKit.dmModules(text);
}
// x (dot) di un simbolo quadrato largo sizeDots, allineato nella box dell'elemento.
function alignedSquareX(el, dpi, sizeDots) {
  const xMm = (el.x_mm ?? el.x) || 0;
  return mmToDots(Barcode.alignInBox(xMm, sizeDots / (dpi / 25.4), el.align, el.box_width_mm), dpi);
}

// Ricalcola x_mm per allineamento centrato/destro su un tipo barcode supportato
// (stessa logica usata nell'anteprima), dato il testo già risolto (con {{field}}
// sostituiti). Se align è assente/left o box_width_mm manca, o il tipo non è
// calcolabile, ritorna x_mm invariato.
function alignedXMm(el, dpi, rawText) {
  const xMm = (el.x_mm ?? el.x) || 0;
  const moduleMm = (el.module_width || 2) / (dpi / 25.4);
  return Barcode.alignedX(el.type, rawText, xMm, moduleMm, el.align, el.box_width_mm);
}

function renderElement(el, dpi, data) {
  const x = mmToDots(el.x_mm ?? el.x, dpi);
  const y = mmToDots(el.y_mm ?? el.y, dpi);
  const lines = [];

  // Un codice a barre/QR con dato vuoto può bloccare la stampante: in quel caso salta l'elemento.
  const barcodeTypes = ['barcode128', 'code39', 'ean13', 'code93', 'qrcode', 'datamatrix'];
  if (barcodeTypes.includes(el.type)) {
    const t = safeFieldData(fillPlaceholders(el.text, data));
    if (!t || !t.trim()) return '';
  }

  switch (el.type) {
    case 'text': {
      const text = safeFieldData(fillPlaceholders(el.text, data));
      const font = el.font || '0';
      const h = el.height_dots || mmToDots(el.height_mm || 3, dpi);
      const w = el.width_dots || mmToDots(el.width_mm || 3, dpi);
      lines.push(`^FO${x},${y}`);
      if (el.rotate) lines.push(`^A${font}${el.rotate},${h},${w}`);
      else lines.push(`^A${font}N,${h},${w}`);
      // ^FB (field block) nativo ZPL: allineamento C/R e a capo automatico su più righe.
      const boxW = Number(el.box_width_mm) || 0;
      const maxLines = Math.max(1, Math.floor(Number(el.max_lines) || 1));
      const aligned = el.align === 'center' || el.align === 'right';
      if (boxW > 0 && (aligned || maxLines > 1)) {
        const just = el.align === 'center' ? 'C' : el.align === 'right' ? 'R' : 'L';
        const gap = maxLines > 1 ? Math.round(h * 0.15) : 0; // interlinea (dot)
        lines.push(`^FB${mmToDots(boxW, dpi)},${maxLines},${gap},${just},0`);
      }
      lines.push(`^FD${text}^FS`);
      break;
    }
    case 'barcode128': {
      const text = safeFieldData(fillPlaceholders(el.text, data));
      const height = el.bar_height_dots || mmToDots(el.bar_height_mm || 10, dpi);
      const printText = el.show_text === false ? 'N' : 'Y';
      const moduleWidth = el.module_width || 2;
      const ax = mmToDots(alignedXMm(el, dpi, text), dpi);
      lines.push(`^FO${ax},${y}`);
      lines.push(`^BY${moduleWidth}`);
      lines.push(`^BCN,${height},${printText},N,N`);
      lines.push(`^FD${text}^FS`);
      break;
    }
    case 'code39': {
      const text = safeFieldData(fillPlaceholders(el.text, data));
      const height = el.bar_height_dots || mmToDots(el.bar_height_mm || 10, dpi);
      const printText = el.show_text === false ? 'N' : 'Y';
      const moduleWidth = el.module_width || 2;
      const ax = mmToDots(alignedXMm(el, dpi, text), dpi);
      lines.push(`^FO${ax},${y}`);
      lines.push(`^BY${moduleWidth}`);
      lines.push(`^B3N,N,${height},${printText},N`);
      lines.push(`^FD${text}^FS`);
      break;
    }
    case 'ean13': {
      const text = safeFieldData(fillPlaceholders(el.text, data)).replace(/\D/g, '');
      const height = el.bar_height_dots || mmToDots(el.bar_height_mm || 10, dpi);
      const printText = el.show_text === false ? 'N' : 'Y';
      const moduleWidth = el.module_width || 2;
      const ax = mmToDots(alignedXMm(el, dpi, text), dpi);
      lines.push(`^FO${ax},${y}`);
      lines.push(`^BY${moduleWidth}`);
      lines.push(`^BEN,${height},${printText},N`);
      lines.push(`^FD${text}^FS`);
      break;
    }
    case 'code93': {
      const text = safeFieldData(fillPlaceholders(el.text, data));
      const height = el.bar_height_dots || mmToDots(el.bar_height_mm || 10, dpi);
      const printText = el.show_text === false ? 'N' : 'Y';
      const moduleWidth = el.module_width || 2;
      const ax = mmToDots(alignedXMm(el, dpi, text), dpi);
      lines.push(`^FO${ax},${y}`);
      lines.push(`^BY${moduleWidth}`);
      lines.push(`^BAN,${height},${printText},N`);
      lines.push(`^FD${text}^FS`);
      break;
    }
    case 'datamatrix': {
      const text = safeFieldData(fillPlaceholders(el.text, data));
      const cell = el.magnification || 5; // dimensione modulo (dot)
      lines.push(`^FO${alignedSquareX(el, dpi, dmModules(text) * cell)},${y}`);
      lines.push(`^BXN,${cell},200`);
      lines.push(`^FD${text}^FS`);
      break;
    }
    case 'qrcode': {
      const text = safeFieldData(fillPlaceholders(el.text, data));
      const magnification = el.magnification || 4;
      lines.push(`^FO${alignedSquareX(el, dpi, qrModules(text) * magnification)},${y}`);
      lines.push(`^BQN,2,${magnification}`);
      lines.push(`^FDQA,${text}^FS`);
      break;
    }
    case 'line':
    case 'box': {
      const w = mmToDots(el.width_mm, dpi);
      const h = mmToDots(el.height_mm, dpi);
      const thickness = el.thickness_dots || mmToDots(el.thickness_mm || 0.3, dpi) || 1;
      lines.push(`^FO${x},${y}`);
      lines.push(`^GB${w},${h},${thickness}^FS`);
      break;
    }
    default:
      throw new Error(`Tipo di elemento non supportato: ${el.type}`);
  }
  return lines.join('');
}

/**
 * Renderizza un singolo set di dati usando un template.
 * @param {object} template - { dpi, width_mm, height_mm, elements: [...] }
 * @param {object} data - valori da inserire nei placeholder {{campo}}
 * @returns {string} ZPL per una etichetta (senza ^XA/^XZ)
 */
function renderLabelBody(template, data, opts = {}) {
  const dpi = template.dpi || 203;
  const parts = [];
  parts.push(`^PW${mmToDots(template.width_mm, dpi)}`);
  parts.push(`^LL${mmToDots(template.height_mm, dpi)}`);
  parts.push('^LH0,0');
  // Modalità di stampa: 'T' = tear-off (strappo), la stampante fa avanzare l'etichetta
  // fino alla barra di strappo dopo la stampa. Default: tear-off.
  parts.push(`^MM${template.print_mode || 'T'}`);
  // Rilevamento media: 'Y' = etichette con gap/spazio (default per rotoli comuni).
  // Usare 'M' per etichette con tacca nera (black mark).
  parts.push(`^MN${template.media_tracking || 'Y'}`);
  // Regolazione posizione di strappo: valori positivi fanno avanzare di più l'etichetta
  // (utile se resta dentro), valori negativi la fanno arretrare. Range -120..120 dot.
  if (template.tear_off !== undefined) parts.push(`~TA${template.tear_off}`);
  // Intensità/velocità: l'opzione globale (opts) ha priorità sul template.
  const darkness = (opts && opts.darkness !== undefined && opts.darkness !== '' && opts.darkness !== null) ? opts.darkness : template.darkness;
  const speed = (opts && opts.speed !== undefined && opts.speed !== '' && opts.speed !== null) ? opts.speed : template.speed;
  if (darkness !== undefined) parts.push(`~SD${darkness}`);
  if (speed !== undefined) parts.push(`^PR${speed}`);

  // Selezione elementi da stampare:
  // - opts.enabledIndices (array di indici) sovrascrive tutto (usato dalla GUI)
  // - altrimenti si rispetta il flag "enabled" del singolo elemento (default: true)
  const enabledSet = Array.isArray(opts.enabledIndices) ? new Set(opts.enabledIndices) : null;
  const elements = template.elements || [];
  elements.forEach((el, i) => {
    const on = enabledSet ? enabledSet.has(i) : el.enabled !== false;
    if (on) parts.push(renderElement(Barcode.withBox(el, template.width_mm), dpi, data));
  });
  return parts.join('\n');
}

/**
 * Genera lo ZPL completo per N copie / N record di dati.
 * @param {object} template
 * @param {object[]} dataList - array di oggetti dati, una etichetta per elemento
 * @param {object} opts - { copiesPerLabel: number, enabledIndices: number[] }
 * @returns {Buffer}
 */
function buildZpl(template, dataList, opts = {}) {
  // Una voce per etichetta fisica (copie incluse): serve al contatore progressivo.
  const chunks = TextKit.expandLabels(dataList, opts.copiesPerLabel, opts, template)
    .map((data) => `^XA\n${renderLabelBody(template, data, opts)}\n^XZ`);
  return Buffer.from(chunks.join('\n'), 'ascii');
}

/**
 * Estrae la lista dei placeholder {{campo}} presenti in un template,
 * nell'ordine in cui appaiono, senza duplicati. Utile alla GUI per generare i campi.
 */
function extractPlaceholders(template) {
  const found = [];
  const seen = new Set();
  // I campi automatici (data, ora, contatore) non vanno chiesti all'utente.
  const scan = (str) => {
    for (const name of TextKit.userPlaceholders(str)) {
      if (!seen.has(name)) {
        seen.add(name);
        found.push(name);
      }
    }
  };
  for (const el of template.elements || []) scan(el.text);
  return found;
}

module.exports = { mmToDots, fillPlaceholders, buildZpl, renderLabelBody, extractPlaceholders, qrModules, dmModules, alignedSquareX };
