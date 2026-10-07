'use strict';

// Generatore EPL (EPL2 / Eltron) — SPERIMENTALE E NON TESTATO su stampante reale.
// Usato da vecchie Zebra/Eltron (serie LP/TLP, alcune GK in modalità EPL).
// Copre testo, Code128/Code39/EAN-13, riquadri e linee. QR/DataMatrix non gestiti qui.

const { mmToDots, fillPlaceholders } = require('./zpl');
const Barcode = require('../gui/barcode.js');

function esc(s) { return String(s).replace(/"/g, '\\"'); }

// Ricalcola x_mm per allineamento centrato/destro (EPL non ha un parametro
// nativo di alignment per i barcode). Stessa logica usata nell'anteprima.
function alignedXMm(el, dpi, rawText) {
  const xMm = (el.x_mm ?? el.x) || 0;
  const narrow = el.module_width || 2;
  const moduleMm = narrow / (dpi / 25.4);
  return Barcode.alignedX(el.type, rawText, xMm, moduleMm, el.align, el.box_width_mm);
}

function renderElement(el, dpi, data) {
  const x = mmToDots(el.x_mm ?? el.x, dpi);
  const y = mmToDots(el.y_mm ?? el.y, dpi);
  switch (el.type) {
    case 'text': {
      const mul = Math.max(1, Math.round((el.height_mm || 3) / 2));
      return `A${x},${y},0,3,${mul},${mul},N,"${esc(fillPlaceholders(el.text, data))}"`;
    }
    case 'barcode128':
    case 'code39':
    case 'ean13': {
      const text = fillPlaceholders(el.text, data);
      const height = el.bar_height_dots || mmToDots(el.bar_height_mm || 10, dpi);
      const narrow = el.module_width || 2;
      const wide = narrow * 2;
      const human = el.show_text === false ? 'N' : 'B';
      const sym = el.type === 'barcode128' ? '1' : el.type === 'code39' ? '3' : 'E30';
      const ax = mmToDots(alignedXMm(el, dpi, text), dpi);
      return `B${ax},${y},0,${sym},${narrow},${wide},${height},${human},"${esc(text)}"`;
    }
    case 'qrcode': {
      const cell = el.magnification || 4;
      return `b${x},${y},Q,m2,s${cell},"${esc(fillPlaceholders(el.text, data))}"`;
    }
    case 'box': {
      const w = mmToDots(el.width_mm, dpi);
      const h = mmToDots(el.height_mm, dpi);
      const t = el.thickness_dots || mmToDots(el.thickness_mm || 0.3, dpi) || 1;
      return `X${x},${y},${t},${x + w},${y + h}`;
    }
    case 'line': {
      const w = mmToDots(el.width_mm, dpi);
      const t = el.thickness_dots || mmToDots(el.thickness_mm || 0.3, dpi) || 1;
      return `LO${x},${y},${w},${t}`;
    }
    default:
      return `; (elemento ${el.type} non supportato in EPL)`;
  }
}

function renderLabel(template, data, opts) {
  const dpi = template.dpi || 203;
  const parts = ['N', `q${mmToDots(template.width_mm, dpi)}`];
  const enabledSet = Array.isArray(opts && opts.enabledIndices) ? new Set(opts.enabledIndices) : null;
  (template.elements || []).forEach((el, i) => {
    const on = enabledSet ? enabledSet.has(i) : el.enabled !== false;
    if (on) parts.push(renderElement(el, dpi, data));
  });
  parts.push('P1');
  return parts.join('\n');
}

function buildEpl(template, dataList, opts = {}) {
  const chunks = [];
  const copies = opts.copiesPerLabel || 1;
  for (const data of dataList) for (let i = 0; i < copies; i++) chunks.push(renderLabel(template, data, opts));
  return Buffer.from(chunks.join('\n') + '\n', 'ascii');
}

module.exports = { buildEpl };
