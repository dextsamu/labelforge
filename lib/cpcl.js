'use strict';

// Generatore CPCL (Comtec/Zebra mobile) — SPERIMENTALE E NON TESTATO su stampante reale.
// Usato dalle Zebra portatili (serie QL, ZQ in modalità CPCL, iMZ, ecc.).
// Copre testo, Code128/Code39/EAN-13, QR, riquadri e linee.

const { mmToDots, fillPlaceholders } = require('./zpl');
const Barcode = require('../gui/barcode.js');

function renderElement(el, dpi, data) {
  const x = mmToDots(el.x_mm ?? el.x, dpi);
  const y = mmToDots(el.y_mm ?? el.y, dpi);
  const xMm = (el.x_mm ?? el.x) || 0;
  const out = [];
  switch (el.type) {
    case 'text': {
      const raw = String(fillPlaceholders(el.text, data) ?? '');
      // Allineamento (approssimato): font 4 dimensione 0 ≈ 23 dot (~2.9 mm) per carattere.
      const tx = mmToDots(Barcode.alignInBox(xMm, raw.length * 2.9, el.align, el.box_width_mm), dpi);
      out.push(`TEXT 4 0 ${tx} ${y} ${raw}`);
      break;
    }
    case 'barcode128':
    case 'code39':
    case 'code93':
    case 'ean13': {
      const raw = fillPlaceholders(el.text, data);
      const height = el.bar_height_dots || mmToDots(el.bar_height_mm || 10, dpi);
      const sym = el.type === 'barcode128' ? '128' : el.type === 'code39' ? '39' : el.type === 'code93' ? '93' : 'EAN13';
      // Il modulo stretto qui è 1 dot: l'allineamento usa la stessa larghezza.
      const bx = mmToDots(Barcode.alignedX(el.type, raw, xMm, 1 / (dpi / 25.4), el.align, el.box_width_mm), dpi);
      out.push(`BARCODE ${sym} 1 1 ${height} ${bx} ${y} ${raw}`);
      break;
    }
    case 'qrcode': {
      const cell = el.magnification || 4;
      out.push(`B QR ${x} ${y} M 2 U ${cell}`);
      out.push(`MA,${fillPlaceholders(el.text, data)}`);
      out.push('ENDQR');
      break;
    }
    case 'box': {
      const w = mmToDots(el.width_mm, dpi);
      const h = mmToDots(el.height_mm, dpi);
      const t = el.thickness_dots || mmToDots(el.thickness_mm || 0.3, dpi) || 1;
      out.push(`BOX ${x} ${y} ${x + w} ${y + h} ${t}`);
      break;
    }
    case 'line': {
      const w = mmToDots(el.width_mm, dpi);
      const t = el.thickness_dots || mmToDots(el.thickness_mm || 0.3, dpi) || 1;
      out.push(`LINE ${x} ${y} ${x + w} ${y} ${t}`);
      break;
    }
    default:
      out.push(`; (elemento ${el.type} non supportato in CPCL)`);
  }
  return out.join('\n');
}

function renderLabel(template, data, opts) {
  const dpi = template.dpi || 203;
  const heightDots = mmToDots(template.height_mm, dpi);
  const parts = [`! 0 200 200 ${heightDots} 1`, `PW ${mmToDots(template.width_mm, dpi)}`];
  const enabledSet = Array.isArray(opts && opts.enabledIndices) ? new Set(opts.enabledIndices) : null;
  (template.elements || []).forEach((el, i) => {
    const on = enabledSet ? enabledSet.has(i) : el.enabled !== false;
    if (on) parts.push(renderElement(Barcode.withBox(el, template.width_mm), dpi, data));
  });
  parts.push('FORM', 'PRINT');
  return parts.join('\n');
}

function buildCpcl(template, dataList, opts = {}) {
  const chunks = [];
  const copies = opts.copiesPerLabel || 1;
  for (const data of dataList) for (let i = 0; i < copies; i++) chunks.push(renderLabel(template, data, opts));
  return Buffer.from(chunks.join('\r\n') + '\r\n', 'ascii');
}

module.exports = { buildCpcl };
