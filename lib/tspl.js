'use strict';

// Generatore TSPL (TSC Printer Language) — usato da molte stampanti economiche
// (TSC, e con varianti simili Godex/EZPL). Rispecchia gli stessi template usati per lo ZPL,
// così l'editor e l'anteprima restano identici: cambia solo il linguaggio prodotto.
// Nota: la resa del testo in TSPL usa font interni con moltiplicatori interi, quindi la
// dimensione è approssimata rispetto ai mm (a differenza dello ZPL).

const { mmToDots, fillPlaceholders } = require('./zpl');
const Barcode = require('../gui/barcode.js');

function esc(s) { return String(s).replace(/"/g, '\\"'); }

function renderElement(el, dpi, data) {
  const x = mmToDots(el.x_mm ?? el.x, dpi);
  const y = mmToDots(el.y_mm ?? el.y, dpi);
  const out = [];
  switch (el.type) {
    case 'text': {
      const text = esc(fillPlaceholders(el.text, data));
      const mul = Math.max(1, Math.round((el.height_mm || 3) / 1.6));
      out.push(`TEXT ${x},${y},"0",0,${mul},${mul},"${text}"`);
      break;
    }
    case 'barcode128':
    case 'code39':
    case 'code93':
    case 'ean13': {
      const raw = fillPlaceholders(el.text, data);
      const text = esc(raw);
      const height = el.bar_height_dots || mmToDots(el.bar_height_mm || 10, dpi);
      const narrow = el.module_width || 2;
      const wide = narrow * 2;
      const human = el.show_text === false ? 0 : 1;
      const sym = el.type === 'barcode128' ? '128' : el.type === 'code39' ? '39' : el.type === 'code93' ? '93' : 'EAN13';
      // TSPL non ha un parametro nativo di allineamento: ricalcoliamo qui la x di
      // partenza in base alla larghezza reale codificata (stessa logica dell'anteprima),
      // così stampa e anteprima restano coerenti.
      const moduleMm = narrow / (dpi / 25.4);
      const xMm = (el.x_mm ?? el.x) || 0;
      const alignedXMm = Barcode.alignedX(el.type, raw, xMm, moduleMm, el.align, el.box_width_mm);
      const ax = mmToDots(alignedXMm, dpi);
      out.push(`BARCODE ${ax},${y},"${sym}",${height},${human},0,${narrow},${wide},"${text}"`);
      break;
    }
    case 'qrcode': {
      const text = esc(fillPlaceholders(el.text, data));
      const cell = el.magnification || 4;
      out.push(`QRCODE ${x},${y},M,${cell},A,0,"${text}"`);
      break;
    }
    case 'datamatrix': {
      const text = esc(fillPlaceholders(el.text, data));
      const size = (el.magnification || 5) * 10;
      out.push(`DMATRIX ${x},${y},${size},${size},"${text}"`);
      break;
    }
    case 'box': {
      const w = mmToDots(el.width_mm, dpi);
      const h = mmToDots(el.height_mm, dpi);
      const t = el.thickness_dots || mmToDots(el.thickness_mm || 0.3, dpi) || 1;
      out.push(`BOX ${x},${y},${x + w},${y + h},${t}`);
      break;
    }
    case 'line': {
      const w = mmToDots(el.width_mm, dpi);
      const t = el.thickness_dots || mmToDots(el.thickness_mm || 0.3, dpi) || 1;
      out.push(`BAR ${x},${y},${w},${t}`);
      break;
    }
    default: break;
  }
  return out.join('\n');
}

function renderLabel(template, data, opts) {
  const dpi = template.dpi || 203;
  const parts = [];
  parts.push(`SIZE ${template.width_mm} mm,${template.height_mm} mm`);
  parts.push(`GAP ${template.gap_mm != null ? template.gap_mm : 2} mm,0 mm`);
  parts.push('DIRECTION 1');
  parts.push('CLS');
  const enabledSet = Array.isArray(opts && opts.enabledIndices) ? new Set(opts.enabledIndices) : null;
  (template.elements || []).forEach((el, i) => {
    const on = enabledSet ? enabledSet.has(i) : el.enabled !== false;
    if (on) { const s = renderElement(el, dpi, data); if (s) parts.push(s); }
  });
  parts.push('PRINT 1,1');
  return parts.join('\n');
}

function buildTspl(template, dataList, opts = {}) {
  const chunks = [];
  const copies = opts.copiesPerLabel || 1;
  for (const data of dataList) {
    for (let i = 0; i < copies; i++) chunks.push(renderLabel(template, data, opts));
  }
  return Buffer.from(chunks.join('\n') + '\n', 'ascii');
}

module.exports = { buildTspl };
