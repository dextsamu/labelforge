'use strict';

// Smoke test senza dipendenze: verifica le parti core (generatori e encoder).
// Eseguire con: node test/smoke.js
const assert = require('assert');
const path = require('path');

const { buildLabel, extractPlaceholders } = require('../lib/render');
const barcode = require('../gui/barcode.js'); // esporta module.exports in Node

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + ' → ' + e.message); process.exitCode = 1; }
}

const tpl = {
  dpi: 203, width_mm: 60, height_mm: 40,
  field_meta: { cat: { type: 'select', options: ['A', 'B'] } },
  elements: [
    { type: 'text', x_mm: 3, y_mm: 3, height_mm: 4, text: '{{title}}' },
    { type: 'barcode128', x_mm: 3, y_mm: 12, bar_height_mm: 10, text: '{{code}}' },
    { type: 'qrcode', x_mm: 45, y_mm: 10, magnification: 4, text: '{{code}}' },
  ],
};

console.log('LabelForge smoke test');

test('extractPlaceholders trova i campi', () => {
  assert.deepStrictEqual(extractPlaceholders(tpl), ['title', 'code']);
});

test('buildLabel ZPL (default) produce ^XA...^XZ', () => {
  const z = buildLabel(tpl, [{ title: 'X', code: 'ABC' }]).toString();
  assert.ok(z.startsWith('^XA') && z.trimEnd().endsWith('^XZ'), 'delimitatori ZPL');
});

test('buildLabel TSPL produce comandi TSPL', () => {
  const t = buildLabel(Object.assign({ language: 'tspl' }, tpl), [{ title: 'X', code: 'ABC' }]).toString();
  assert.ok(t.includes('SIZE ') && t.includes('PRINT 1,1'), 'header TSPL');
});

test('dispatcher lingue: epl/cpcl/ezpl non vuoti', () => {
  for (const lang of ['epl', 'cpcl', 'ezpl']) {
    const out = buildLabel(Object.assign({ language: lang }, tpl), [{ title: 'X', code: 'ABC' }]).toString();
    assert.ok(out.length > 10, 'output ' + lang);
  }
});

test('barcode con dato vuoto viene saltato (ZPL)', () => {
  const z = buildLabel(tpl, [{ title: 'Solo testo', code: '' }]).toString();
  assert.ok(!z.includes('^BC') && !z.includes('^BQ'), 'niente barcode/QR vuoti');
});

test('Code128: pattern validi e checksum ("AB" = 57 moduli)', () => {
  assert.strictEqual(barcode.PATTERNS.length, 107);
  const w = barcode.encode128B('AB');
  assert.strictEqual(w.reduce((a, b) => a + b, 0), 57);
});

test('EAN-13: cifra di controllo corretta e 95 moduli', () => {
  assert.strictEqual(barcode.ean13CheckDigit('978030640615'), 7);
  const e = barcode.encodeEAN13('978030640615');
  assert.strictEqual(e.bits.length, 95);
  assert.ok(e.bits.startsWith('101') && e.bits.endsWith('101'));
});

test('Code93: tutti i pattern sommano 9', () => {
  const w = barcode.encode93('TEST'); // deve produrre una sequenza non vuota
  assert.ok(w.length > 10);
});

// ---------------- Allineamento (v1.17 barcode di @PaloTrucoo, v1.18 testo + auto) ----------------
const alignTpl = (el) => ({ dpi: 203, width_mm: 60, height_mm: 30, elements: [el] });
const foX = (buf) => Number(buf.toString().match(/\^FO(\d+),/)[1]);

test('alignInBox: left < center < right, box vuota = invariato', () => {
  assert.strictEqual(barcode.alignInBox(3, 10, 'center', 30), 13);
  assert.strictEqual(barcode.alignInBox(3, 10, 'right', 30), 23);
  assert.strictEqual(barcode.alignInBox(3, 10, 'left', 30), 3);
  assert.strictEqual(barcode.alignInBox(3, 10, 'center', 0), 3);
});

test('effectiveBoxWidth: esplicita vince, auto = etichetta − 2×X, left = 0', () => {
  assert.strictEqual(barcode.effectiveBoxWidth({ x_mm: 3, align: 'center', box_width_mm: 20 }, 60), 20);
  assert.strictEqual(barcode.effectiveBoxWidth({ x_mm: 3, align: 'center' }, 60), 54);
  assert.strictEqual(barcode.effectiveBoxWidth({ x_mm: 3 }, 60), 0);
});

test('barcode: allineamento sposta ^FO (left < center < right)', () => {
  const base = { type: 'barcode128', x_mm: 3, y_mm: 5, bar_height_mm: 8, text: 'ABC123', box_width_mm: 45 };
  const l = foX(buildLabel(alignTpl(base), [{}]));
  const c = foX(buildLabel(alignTpl(Object.assign({}, base, { align: 'center' })), [{}]));
  const r = foX(buildLabel(alignTpl(Object.assign({}, base, { align: 'right' })), [{}]));
  assert.ok(l < c && c < r, `${l} < ${c} < ${r}`);
});

test('barcode "centra sull\'etichetta" (senza box): centro ≈ metà etichetta', () => {
  const el = { type: 'barcode128', x_mm: 3, y_mm: 5, bar_height_mm: 8, module_width: 2, text: 'ABC123', align: 'center' };
  const x = foX(buildLabel(alignTpl(el), [{}]));
  const widthDots = barcode.widthModules('barcode128', 'ABC123') * 2; // modulo = 2 dot
  const centerMm = (x + widthDots / 2) / (203 / 25.4);
  assert.ok(Math.abs(centerMm - 30) < 0.3, 'centro a ' + centerMm.toFixed(2) + ' mm');
});

test('testo ZPL: ^FB nativo con giustificazione C/R, nessun ^FB se a sinistra', () => {
  const t = { type: 'text', x_mm: 3, y_mm: 3, height_mm: 3, text: 'Ciao' };
  assert.ok(!buildLabel(alignTpl(t), [{}]).toString().includes('^FB'), 'retrocompatibile');
  const c = buildLabel(alignTpl(Object.assign({}, t, { align: 'center' })), [{}]).toString();
  assert.ok(c.includes('^FB432,1,0,C,0'), 'auto box 54 mm = 432 dot, centrato');
  const r = buildLabel(alignTpl(Object.assign({}, t, { align: 'right', box_width_mm: 20 })), [{}]).toString();
  assert.ok(r.includes('^FB160,1,0,R,0'), 'box 20 mm = 160 dot, a destra');
});

test('testo nei linguaggi sperimentali: centrato sta più a destra di sinistra', () => {
  const t = { type: 'text', x_mm: 3, y_mm: 3, height_mm: 3, text: 'Ciao' };
  const pick = { tspl: /TEXT (\d+),/, epl: /\nA(\d+),/, ezpl: /AA,(\d+),/, cpcl: /TEXT 4 0 (\d+) / };
  for (const lang of Object.keys(pick)) {
    const left = buildLabel(Object.assign({ language: lang }, alignTpl(t)), [{}]).toString().match(pick[lang]);
    const cen = buildLabel(Object.assign({ language: lang }, alignTpl(Object.assign({}, t, { align: 'center' }))), [{}]).toString().match(pick[lang]);
    assert.ok(left && cen && Number(cen[1]) > Number(left[1]), lang + ': ' + (left && left[1]) + ' → ' + (cen && cen[1]));
  }
});

console.log(`\n${passed} test superati.`);
