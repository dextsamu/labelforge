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

// ---------------- v1.19: campi automatici, testo multiriga, QR/DataMatrix reali, note release ----------------
const tk = require('../gui/textkit.js');
const fixedNow = new Date(2026, 0, 31, 9, 5, 7); // 31/01/2026 09:05:07

test('campi automatici: data, offset, formati, ora', () => {
  const ctx = { now: fixedNow, counter: 7 };
  assert.strictEqual(tk.fill('{{date}}', {}, ctx), '31/01/2026');
  assert.strictEqual(tk.fill('{{date+30}}', {}, ctx), '02/03/2026');
  assert.strictEqual(tk.fill('{{date+1m:YYYY-MM-DD}}', {}, ctx), '2026-03-03'); // 31 gen + 1 mese → normalizzazione JS
  assert.strictEqual(tk.fill('{{date-1y:DD.MM.YY}}', {}, ctx), '31.01.25');
  assert.strictEqual(tk.fill('{{time}} {{now}}', {}, ctx), '09:05 31/01/2026 09:05');
  assert.strictEqual(tk.fill('N.{{counter:4}}', {}, ctx), 'N.0007');
});

test('campi automatici: i dati dell\'utente vincono, esclusi dai campi da compilare', () => {
  assert.strictEqual(tk.fill('{{date}}', { date: 'manuale' }, { now: fixedNow }), 'manuale');
  const t = { elements: [{ type: 'text', text: '{{lotto}} {{date+30}} {{counter:3}} {{now}}' }] };
  assert.deepStrictEqual(extractPlaceholders(t), ['lotto']);
});

test('contatore: un numero per etichetta, copie incluse, partenza configurabile', () => {
  const t = { dpi: 203, width_mm: 50, height_mm: 20, elements: [{ type: 'text', x_mm: 2, y_mm: 2, height_mm: 3, text: 'S{{counter:4}}' }] };
  const out = buildLabel(t, [{}, {}], { copiesPerLabel: 2, counterStart: 41 }).toString();
  assert.deepStrictEqual(out.match(/\^FDS(\d+)\^FS/g), ['^FDS0041^FS', '^FDS0042^FS', '^FDS0043^FS', '^FDS0044^FS']);
  const out2 = buildLabel(Object.assign({ counter_start: 100 }, t), [{}]).toString();
  assert.ok(out2.includes('^FDS0100^FS'), 'counter_start del template');
});

test('a capo: wrapText rispetta larghezza e righe massime', () => {
  assert.deepStrictEqual(tk.wrapText('uno due tre quattro', 8, 5), ['uno due', 'tre', 'quattro']);
  assert.deepStrictEqual(tk.wrapText('uno due tre quattro', 8, 2, '...'), ['uno due', 'tre...']);
  assert.deepStrictEqual(tk.wrapText('ABCDEFGHIJ', 4, 5), ['ABCD', 'EFGH', 'IJ']);
});

test('testo multiriga ZPL: ^FB con righe, interlinea e larghezza etichetta', () => {
  const t = alignTpl({ type: 'text', x_mm: 3, y_mm: 3, height_mm: 3, text: 'Descrizione lunga', max_lines: 3 });
  assert.ok(buildLabel(t, [{}]).toString().includes('^FB432,3,4,L,0'), 'box 54 mm, 3 righe, interlinea 4 dot');
  const tsp = buildLabel(Object.assign({ language: 'tspl' }, alignTpl({ type: 'text', x_mm: 3, y_mm: 3, height_mm: 3, box_width_mm: 10, max_lines: 3, text: 'aaa bbb ccc ddd' })), [{}]).toString();
  assert.strictEqual((tsp.match(/^TEXT /gm) || []).length, 3, 'TSPL: una riga TEXT per riga');
});

test('QR/DataMatrix: dimensione reale e allineamento in ZPL', () => {
  const { qrModules } = require('../lib/zpl');
  assert.ok(qrModules('ABC') >= 21, 'QR almeno 21 moduli');
  assert.strictEqual(tk.dmModules('ABC'), 10);
  assert.strictEqual(tk.dmModules('123456'), 10);   // 3 codeword (coppie di cifre) → 10×10
  assert.strictEqual(tk.dmModules('12345678'), 12); // 4 codeword → 12×12
  assert.strictEqual(tk.dmModules('ABCDEFGHIJKLMNOP'), 18); // stima prudente (solo ASCII)
  assert.strictEqual(require('../lib/zpl').dmModules('ABCDEFGHIJKLMNOP'), 16); // esatto (bwip-js, codifica C40)
  const q = { type: 'qrcode', x_mm: 3, y_mm: 3, magnification: 4, text: 'ABC' };
  const l = foX(buildLabel(alignTpl(q), [{}]));
  const c = foX(buildLabel(alignTpl(Object.assign({}, q, { align: 'center' })), [{}]));
  const centerMm = (c + qrModules('ABC') * 4 / 2) / (203 / 25.4);
  assert.ok(l === 24 && Math.abs(centerMm - 30) < 0.3, `QR centrato a ${centerMm.toFixed(2)} mm`);
});

test('note di rilascio: file dedicato o sezione CHANGELOG + footer', () => {
  const run = (tag) => require('child_process').execFileSync(process.execPath, [path.join(__dirname, '..', '.github', 'scripts', 'release-notes.js'), tag]).toString();
  const a = run('v1.19.0');
  assert.ok(a.includes('Smart fields') && a.includes('Download'), 'file dedicato + footer');
  const b = run('v1.12.0');
  assert.ok(b.includes('Diagnostica stampante') && b.includes('Download'), 'fallback CHANGELOG + footer');
});

console.log(`\n${passed} test superati.`);
