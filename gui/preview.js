'use strict';

// Anteprima SVG dell'etichetta. Non è una resa ZPL esatta, ma riproduce
// fedelmente posizioni e dimensioni (in mm) di testo, barcode, QR, linee e riquadri,
// così da vedere il layout mentre si compila o si modifica un template.
(function () {
  function fillPlaceholders(str, data) {
    if (typeof str !== 'string') return '';
    return str.replace(/\{\{\s*([\w.\-]+)\s*\}\}/g, (_, k) => {
      const v = (data || {})[k];
      return v === undefined || v === null || v === '' ? '' : String(v);
    });
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Genera barre pseudo-casuali ma deterministiche dal valore (solo estetica anteprima).
  function barcodeBars(value, x, y, totalW, h) {
    const seedStr = value || '000';
    let bars = '';
    let cursor = x;
    let seed = 0;
    for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) % 100000;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    while (cursor < x + totalW - 0.3) {
      const w = 0.25 + rnd() * 0.6;
      if (rnd() > 0.4) {
        bars += `<rect x="${cursor.toFixed(2)}" y="${y}" width="${w.toFixed(2)}" height="${h}" fill="#111"/>`;
      }
      cursor += w + 0.2;
    }
    return bars;
  }

  // QR reale se la matrice è disponibile in cache; altrimenti box segnaposto.
  function qrBox(value, x, y, size, qrCache) {
    const m = qrCache && qrCache[value];
    if (m && m.size) {
      const n = m.size;
      const cell = size / n;
      let cells = `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="#fff"/>`;
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (m.data[r * n + c]) {
            cells += `<rect x="${(x + c * cell).toFixed(3)}" y="${(y + r * cell).toFixed(3)}" width="${(cell + 0.02).toFixed(3)}" height="${(cell + 0.02).toFixed(3)}" fill="#111"/>`;
          }
        }
      }
      return cells;
    }
    // segnaposto finché la matrice non è pronta
    return `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="#fff" stroke="#111" stroke-width="0.2"/>` +
      `<text x="${(x + size / 2).toFixed(2)}" y="${(y + size / 2).toFixed(2)}" font-size="${(size / 6).toFixed(2)}" text-anchor="middle" dominant-baseline="middle" fill="#94a3b8">QR</text>`;
  }

  function renderElement(el, dpi, data, qrCache) {
    const x = Number(el.x_mm) || 0;
    const y = Number(el.y_mm) || 0;
    switch (el.type) {
      case 'text': {
        const text = fillPlaceholders(el.text, data);
        // altezza carattere in mm: da height_mm o da height_dots
        const hmm = el.height_mm || (el.height_dots ? (el.height_dots / dpi) * 25.4 : 3);
        const fontSize = hmm * 0.95;
        return `<text x="${x}" y="${y}" font-size="${fontSize.toFixed(2)}" font-family="Arial, sans-serif" dominant-baseline="text-before-edge" fill="#111">${esc(text) || ' '}</text>`;
      }
      case 'barcode128': {
        const text = fillPlaceholders(el.text, data) || '000';
        const h = el.bar_height_mm || (el.bar_height_dots ? (el.bar_height_dots / dpi) * 25.4 : 10);
        const moduleMm = (el.module_width || 2) / (dpi / 25.4); // modulo reale in mm
        let out, w, drawX = x;
        if (typeof window !== 'undefined' && window.Barcode) {
          drawX = window.Barcode.alignedX('barcode128', text, x, moduleMm, el.align, el.box_width_mm);
          const r = window.Barcode.code128SVG(text, drawX, y, h, moduleMm);
          out = r.svg; w = r.width;
        } else {
          w = Math.max(20, (text.length || 6) * 2.2);
          out = barcodeBars(text, x, y, w, h);
        }
        if (el.show_text !== false) {
          out += `<text x="${(drawX + w / 2).toFixed(2)}" y="${(y + h + 3).toFixed(2)}" font-size="2.6" font-family="monospace" text-anchor="middle" fill="#111">${esc(text)}</text>`;
        }
        return out;
      }
      case 'code39':
      case 'code93':
      case 'ean13': {
        const text = fillPlaceholders(el.text, data) || (el.type === 'ean13' ? '000000000000' : '000');
        const h = el.bar_height_mm || 10;
        const moduleMm = (el.module_width || 2) / (dpi / 25.4);
        let out = '', w = 20, label = text, drawX = x;
        if (typeof window !== 'undefined' && window.Barcode) {
          drawX = window.Barcode.alignedX(el.type, text, x, moduleMm, el.align, el.box_width_mm);
          let r;
          if (el.type === 'ean13') r = window.Barcode.ean13SVG(text, drawX, y, h, moduleMm);
          else if (el.type === 'code93') r = window.Barcode.code93SVG(text, drawX, y, h, moduleMm);
          else r = window.Barcode.code39SVG(text, drawX, y, h, moduleMm);
          if (r) { out = r.svg; w = r.width; if (r.digits) label = r.digits; }
        }
        if (!out) out = barcodeBars(text, x, y, Math.max(20, text.length * 2.2), h);
        if (el.show_text !== false) {
          out += `<text x="${(drawX + w / 2).toFixed(2)}" y="${(y + h + 3).toFixed(2)}" font-size="2.6" font-family="monospace" text-anchor="middle" fill="#111">${esc(label)}</text>`;
        }
        return out;
      }
      case 'datamatrix': {
        const text = fillPlaceholders(el.text, data);
        const size = (el.magnification || 5) * 4; // ~mm indicativi
        const url = qrCache && qrCache['dm:' + text];
        if (url) {
          return `<image x="${x}" y="${y}" width="${size}" height="${size}" href="${url}" style="image-rendering:pixelated"/>`;
        }
        return `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="#fff" stroke="#111" stroke-width="0.2"/>` +
          `<text x="${(x + size / 2).toFixed(2)}" y="${(y + size / 2).toFixed(2)}" font-size="${(size / 6).toFixed(2)}" text-anchor="middle" dominant-baseline="middle" fill="#94a3b8">DM</text>`;
      }
      case 'qrcode': {
        const text = fillPlaceholders(el.text, data);
        const size = (el.magnification || 4) * 5; // ~mm indicativi
        return qrBox(text, x, y, size, qrCache);
      }
      case 'line':
      case 'box': {
        const w = Number(el.width_mm) || 0;
        const h = Number(el.height_mm) || 0;
        const t = el.thickness_mm || 0.3;
        return `<rect x="${x}" y="${y}" width="${w}" height="${Math.max(h, t)}" fill="none" stroke="#111" stroke-width="${t}"/>`;
      }
      default:
        return '';
    }
  }

  // Ritorna una stringa SVG. enabledIndices opzionale (array). qrCache opzionale.
  function renderPreviewSVG(template, data, enabledIndices, qrCache) {
    const dpi = template.dpi || 203;
    const W = Number(template.width_mm) || 50;
    const H = Number(template.height_mm) || 25;
    const enabledSet = Array.isArray(enabledIndices) ? new Set(enabledIndices) : null;
    let body = '';
    (template.elements || []).forEach((el, i) => {
      const on = enabledSet ? enabledSet.has(i) : el.enabled !== false;
      if (on) body += renderElement(el, dpi, data, qrCache);
    });
    return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;">
      <rect x="0" y="0" width="${W}" height="${H}" fill="#fff" stroke="#cbd5e1" stroke-width="0.3"/>
      ${body}
    </svg>`;
  }

  // Bounding box (in mm) di ogni elemento, per l'interazione (selezione/trascinamento) nell'editor.
  function computeBoxes(template, data) {
    const dpi = template.dpi || 203;
    const boxes = [];
    (template.elements || []).forEach((el, index) => {
      const x = Number(el.x_mm) || 0;
      const y = Number(el.y_mm) || 0;
      let w = 4, h = 4;
      if (el.type === 'text') {
        const text = fillPlaceholders(el.text, data) || 'testo';
        const hmm = el.height_mm || (el.height_dots ? (el.height_dots / dpi) * 25.4 : 3);
        h = hmm; w = Math.max(6, text.length * hmm * 0.62);
      } else if (el.type === 'barcode128' || el.type === 'code39' || el.type === 'code93' || el.type === 'ean13') {
        const text = fillPlaceholders(el.text, data);
        h = el.bar_height_mm || 10; w = Math.max(20, (text.length || 6) * 2.4);
        if (el.show_text !== false) h += 3.5;
      } else if (el.type === 'qrcode') {
        w = h = (el.magnification || 4) * 5;
      } else if (el.type === 'datamatrix') {
        w = h = (el.magnification || 5) * 4;
      } else if (el.type === 'box' || el.type === 'line') {
        w = Number(el.width_mm) || 0; h = Math.max(Number(el.height_mm) || 0, el.thickness_mm || 0.3);
      }
      boxes.push({ index, type: el.type, x, y, w, h });
    });
    return boxes;
  }

  window.LabelPreview = { renderPreviewSVG, computeBoxes };
})();
