'use strict';

// Integrazioni: print server HTTP e watch-folder.
// Permettono ad altri programmi di stampare tramite LabelForge (via HTTP o depositando un file JSON).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { buildLabel } = require('./render');
const { sendNetwork, sendWindowsPrinterByName, sendUSBWindows, sendUSBUnix } = require('./print');

let VERSION = '0.0.0';
try { VERSION = require('../package.json').version; } catch (_) {}

function loadTemplate(dir, file) {
  const base = path.basename(String(file || ''));
  const name = base.endsWith('.json') ? base : base + '.json';
  return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
}

// Connessione: accetta { connection:{...} } oppure scorciatoie printer/ip/usb nel job.
function resolveConnection(job) {
  if (job.connection) return job.connection;
  if (job.printer) return { type: 'printer', printer: job.printer };
  if (job.ip) return { type: 'ip', ip: job.ip, port: job.port };
  if (job.usb) return { type: 'usb', usb: job.usb };
  return null;
}
function sendToConnection(zpl, c) {
  if (!c) return Promise.reject(new Error('No connection specified (printer/ip/usb).'));
  if (c.type === 'ip' || c.ip) return sendNetwork(c.ip, Number(c.port) || 9100, zpl);
  if (c.type === 'printer' || c.printer) return sendWindowsPrinterByName(c.printer, zpl);
  if (c.type === 'usb' || c.usb) return process.platform === 'win32' ? sendUSBWindows(c.usb, zpl) : sendUSBUnix(c.usb, zpl);
  return Promise.reject(new Error('Invalid connection.'));
}

// Crea la funzione che carica un template: usa un resolver personalizzato (GUI, con template utente)
// oppure legge dalla cartella indicata.
function makeLoader(opts) {
  if (opts && typeof opts.resolveTemplate === 'function') return opts.resolveTemplate;
  return (file) => loadTemplate(opts.templatesDir, file);
}

// Esegue un job di stampa. job = { template|file, data, rows, copies, connection|printer|ip|usb, darkness, speed, enabledIndices, multiField, multiItems, counterStart }
// loadTpl(file) -> oggetto template.
async function printJob(loadTpl, job) {
  if (!job || (!job.template && !job.file)) throw new Error('Missing "template".');
  const template = loadTpl(job.template || job.file);
  const mult = Number(job.copies) || 1;
  const base = job.data || {};
  let dataList = [];
  if (Array.isArray(job.rows) && job.rows.length) {
    for (const row of job.rows) for (let i = 0; i < mult; i++) dataList.push({ ...base, ...row });
  } else if (job.multiField && Array.isArray(job.multiItems) && job.multiItems.length) {
    for (const it of job.multiItems) { const q = (Number(it.qty) || 0) * mult; for (let i = 0; i < q; i++) dataList.push({ ...base, [job.multiField]: it.value }); }
  } else {
    for (let i = 0; i < mult; i++) dataList.push({ ...base });
  }
  if (!dataList.length) throw new Error('Nothing to print.');
  const opts = {};
  if (Array.isArray(job.enabledIndices)) opts.enabledIndices = job.enabledIndices;
  if (job.darkness != null && job.darkness !== '') opts.darkness = job.darkness;
  if (job.speed != null && job.speed !== '') opts.speed = job.speed;
  if (job.counterStart != null && job.counterStart !== '') opts.counterStart = Number(job.counterStart);
  const zpl = buildLabel(template, dataList, opts);
  await sendToConnection(zpl, resolveConnection(job));
  return { ok: true, count: dataList.length };
}

// ---------------- HTTP print server ----------------
function startServer(opts = {}) {
  const { port = 9110, host = '127.0.0.1', token, defaults } = opts;
  const loadTpl = makeLoader(opts);
  const listNames = opts.listTemplateNames || (() => {
    try { return fs.readdirSync(opts.templatesDir).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', '')); }
    catch (_) { return []; }
  });
  const srv = http.createServer((req, res) => {
    const send = (code, obj) => {
      res.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Api-Key',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      });
      res.end(JSON.stringify(obj));
    };
    if (req.method === 'OPTIONS') return send(200, { ok: true });
    if (token) {
      const auth = req.headers['authorization'] || '';
      if (auth !== 'Bearer ' + token && req.headers['x-api-key'] !== token) return send(401, { ok: false, error: 'Unauthorized' });
    }
    const url = req.url.split('?')[0];
    if (req.method === 'GET' && url === '/health') return send(200, { ok: true, name: 'LabelForge', version: VERSION });
    if (req.method === 'GET' && url === '/templates') {
      try { return send(200, { ok: true, templates: listNames() }); }
      catch (e) { return send(500, { ok: false, error: e.message }); }
    }
    if (req.method === 'POST' && url === '/print') {
      let body = '';
      req.on('data', (d) => { body += d; if (body.length > 4e6) req.destroy(); });
      req.on('end', async () => {
        try {
          const job = Object.assign({}, defaults, JSON.parse(body || '{}'));
          const r = await printJob(loadTpl, job);
          send(200, r);
        } catch (e) { send(400, { ok: false, error: e.message }); }
      });
      return;
    }
    send(404, { ok: false, error: 'Not found' });
  });
  srv.listen(port, host);
  return srv;
}

// ---------------- Watch folder ----------------
function startWatch(opts = {}) {
  const { dir, defaults, log = console.log } = opts;
  const loadTpl = makeLoader(opts);
  fs.mkdirSync(dir, { recursive: true });
  const printedDir = path.join(dir, 'printed');
  const errorsDir = path.join(dir, 'errors');
  fs.mkdirSync(printedDir, { recursive: true });
  fs.mkdirSync(errorsDir, { recursive: true });
  const seen = new Set();

  async function processFile(f) {
    if (!f.endsWith('.json')) return;
    const full = path.join(dir, f);
    if (seen.has(full)) return;
    seen.add(full);
    setTimeout(() => seen.delete(full), 5000);
    try {
      const job = Object.assign({}, defaults, JSON.parse(fs.readFileSync(full, 'utf8')));
      const r = await printJob(loadTpl, job);
      fs.renameSync(full, path.join(printedDir, Date.now() + '_' + f));
      log(`[watch] stampato ${f}: ${r.count} etichette`);
    } catch (e) {
      try {
        fs.renameSync(full, path.join(errorsDir, Date.now() + '_' + f));
        fs.writeFileSync(path.join(errorsDir, Date.now() + '_' + f + '.error.txt'), String(e.message));
      } catch (_) {}
      log(`[watch] ERRORE su ${f}: ${e.message}`);
    }
  }

  // File già presenti all'avvio
  try { fs.readdirSync(dir).forEach((f) => { if (fs.statSync(path.join(dir, f)).isFile()) processFile(f); }); } catch (_) {}
  // Nuovi file
  const watcher = fs.watch(dir, (evt, f) => { if (f) setTimeout(() => { try { if (fs.existsSync(path.join(dir, f))) processFile(f); } catch (_) {} }, 300); });
  return watcher;
}

module.exports = { printJob, startServer, startWatch };
