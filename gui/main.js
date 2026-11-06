'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const net = require('net');

// Archivio dati dedicato per la versione pubblica (non condivide i template
// eventualmente salvati da altre build sullo stesso PC).
app.setName('LabelForge');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const QRCode = require('qrcode');
const bwipjs = require('bwip-js');
const { buildLabel, extractPlaceholders } = require('../lib/render');
const { sendNetwork, sendWindowsPrinterByName, sendUSBWindows, sendUSBUnix } = require('../lib/print');
const { startServer } = require('../lib/server');

let printServer = null; // istanza del print server HTTP (se attivo)

// --- Cartelle template ---
// I template "di fabbrica" sono in bundle (sola lettura in app impacchettate),
// i template creati/modificati dall'utente vanno in una cartella scrivibile (userData).
function resolveBundledTemplatesDir() {
  const res = process.resourcesPath || '';
  const candidates = [
    path.join(__dirname, '..', 'templates'),
    path.join(res, 'templates'),
    path.join(res, 'app', 'templates'),
    path.join(res, 'app.asar', 'templates'),
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch (_) { /* asar */ }
  }
  return candidates[0];
}

const BUNDLED_TEMPLATES_DIR = resolveBundledTemplatesDir();
let USER_TEMPLATES_DIR = null; // impostata a app-ready
let SETTINGS_FILE = null;

function ensureUserDirs() {
  USER_TEMPLATES_DIR = path.join(app.getPath('userData'), 'templates');
  SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
  try { fs.mkdirSync(USER_TEMPLATES_DIR, { recursive: true }); } catch (_) {}
}

// --- Impostazioni ---
function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch (_) {
    return {};
  }
}
function saveSettings(obj) {
  try {
    const current = loadSettings();
    const merged = Object.assign({}, current, obj);
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf8');
    return merged;
  } catch (e) {
    return { error: e.message };
  }
}

// --- Template ---
function readTemplateFile(dir, file) {
  return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
}

// Elenco unito: i file in USER_TEMPLATES_DIR hanno precedenza su quelli bundled con lo stesso nome.
function listTemplateFiles() {
  const map = new Map(); // file -> { dir, editable }
  try {
    for (const f of fs.readdirSync(BUNDLED_TEMPLATES_DIR)) {
      if (f.endsWith('.json')) map.set(f, { dir: BUNDLED_TEMPLATES_DIR, editable: false });
    }
  } catch (_) {}
  try {
    for (const f of fs.readdirSync(USER_TEMPLATES_DIR)) {
      if (f.endsWith('.json')) map.set(f, { dir: USER_TEMPLATES_DIR, editable: true });
    }
  } catch (_) {}
  return map;
}

function templateSummary(file, dir, editable) {
  const t = readTemplateFile(dir, file);
  const elements = (t.elements || []).map((el, i) => ({
    index: i,
    label: el.label || `${el.type}${el.text ? ' — ' + el.text : ''}`,
    type: el.type,
    enabledDefault: el.enabled !== false,
  }));
  const meta = t.field_meta || {};
  const fields = extractPlaceholders(t).map((name) => {
    const m = meta[name] || {};
    return { name, label: m.label || null, type: m.type || 'text', options: m.options || null };
  });
  return {
    file,
    editable,
    name: t.name || file.replace('.json', ''),
    description: t.description || '',
    dpi: t.dpi || 203,
    width_mm: t.width_mm,
    height_mm: t.height_mm,
    tear_off: t.tear_off,
    fields,
    elements,
  };
}

function listTemplates() {
  const out = [];
  for (const [file, info] of listTemplateFiles()) {
    try { out.push(templateSummary(file, info.dir, info.editable)); } catch (_) {}
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// Carica il JSON completo di un template (per l'editor).
function loadTemplateRaw(file) {
  const map = listTemplateFiles();
  const info = map.get(file);
  if (!info) throw new Error('Template not found: ' + file);
  return readTemplateFile(info.dir, file);
}

// Carica per la stampa (qualunque sia la cartella).
function loadTemplateForPrint(file) {
  return loadTemplateRaw(file);
}

// Salva/crea un template nella cartella utente (scrivibile).
function saveTemplate(file, json) {
  const safe = path.basename(file).replace(/[^\w.\-]/g, '_');
  const name = safe.endsWith('.json') ? safe : safe + '.json';
  const full = path.join(USER_TEMPLATES_DIR, name);
  fs.writeFileSync(full, JSON.stringify(json, null, 2), 'utf8');
  return { ok: true, file: name };
}

function deleteTemplate(file) {
  const full = path.join(USER_TEMPLATES_DIR, path.basename(file));
  if (fs.existsSync(full)) { fs.unlinkSync(full); return { ok: true }; }
  return { ok: false, error: 'Only custom templates can be deleted.' };
}

function listWindowsPrinters() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve([]);
    execFile(
      'powershell.exe',
      ['-NoProfile', '-Command', 'Get-Printer | Select-Object -ExpandProperty Name'],
      (err, stdout) => {
        if (err) return resolve([]);
        resolve(stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
      }
    );
  });
}

async function doPrint({ file, data, copies, connection, enabledIndices, multiField, multiItems, rows, darkness, speed, counterStart }) {
  const template = loadTemplateForPrint(file);
  const mult = Number(copies) || 1;

  let dataList = [];
  if (Array.isArray(rows) && rows.length) {
    // Stampa in blocco da CSV: una etichetta per riga (× copie)
    for (const row of rows) {
      for (let i = 0; i < mult; i++) dataList.push({ ...data, ...row });
    }
  } else if (multiField && Array.isArray(multiItems) && multiItems.length) {
    for (const it of multiItems) {
      const q = (Number(it.qty) || 0) * mult;
      for (let i = 0; i < q; i++) dataList.push({ ...data, [multiField]: it.value });
    }
  } else {
    for (let i = 0; i < mult; i++) dataList.push({ ...data });
  }
  if (dataList.length === 0) {
    throw new Error('Nothing to print: set at least one quantity greater than 0.');
  }

  const opts = {};
  if (Array.isArray(enabledIndices)) opts.enabledIndices = enabledIndices;
  if (darkness !== undefined && darkness !== '' && darkness !== null) opts.darkness = darkness;
  if (speed !== undefined && speed !== '' && speed !== null) opts.speed = speed;
  if (counterStart !== undefined && counterStart !== '' && counterStart !== null) opts.counterStart = Number(counterStart);
  const zpl = buildLabel(template, dataList, opts);

  if (connection.type === 'printer') {
    if (!connection.printer) throw new Error('Select a printer.');
    await sendWindowsPrinterByName(connection.printer, zpl);
  } else if (connection.type === 'ip') {
    if (!connection.ip) throw new Error('Enter the printer IP address.');
    await sendNetwork(connection.ip, Number(connection.port) || 9100, zpl);
  } else if (connection.type === 'usb') {
    if (!connection.usb) throw new Error('Enter the USB port (e.g. USB001).');
    if (process.platform === 'win32') await sendUSBWindows(connection.usb, zpl);
    else await sendUSBUnix(connection.usb, zpl);
  } else {
    throw new Error('Invalid connection method.');
  }
  return { ok: true, count: dataList.length };
}

// --- Finestra ---
function createWindow() {
  const s = loadSettings();
  const b = s.windowBounds || {};
  const win = new BrowserWindow({
    width: b.width || 1200,
    height: b.height || 820,
    x: b.x,
    y: b.y,
    minWidth: 900,
    minHeight: 600,
    title: 'LabelForge',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  if (s.windowMaximized) win.maximize();
  win.loadFile(path.join(__dirname, 'index.html'));

  const persistBounds = () => {
    if (!win.isMaximized()) saveSettings({ windowBounds: win.getBounds() });
    saveSettings({ windowMaximized: win.isMaximized() });
  };
  win.on('resize', persistBounds);
  win.on('move', persistBounds);
}

// --- IPC ---
ipcMain.handle('list-templates', () => listTemplates());
ipcMain.handle('load-template-raw', (_e, file) => loadTemplateRaw(file));
ipcMain.handle('save-template', (_e, { file, json }) => {
  try { return saveTemplate(file, json); }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('delete-template', (_e, file) => {
  try { return deleteTemplate(file); }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('list-printers', () => listWindowsPrinters());

// Apri un file (CSV o JSON) e restituisci nome + contenuto testuale.
ipcMain.handle('pick-file', async (_e, kind) => {
  const filters = kind === 'csv'
    ? [{ name: 'CSV', extensions: ['csv', 'txt'] }]
    : [{ name: 'Template JSON', extensions: ['json'] }];
  const r = await dialog.showOpenDialog({ properties: ['openFile'], filters });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  try {
    const content = fs.readFileSync(r.filePaths[0], 'utf8');
    return { canceled: false, name: path.basename(r.filePaths[0]), content };
  } catch (e) { return { canceled: true, error: e.message }; }
});

// Salva contenuto testuale scegliendo dove (Salva con nome).
ipcMain.handle('save-file', async (_e, { defaultName, content }) => {
  const r = await dialog.showSaveDialog({ defaultPath: defaultName || 'export.json' });
  if (r.canceled || !r.filePath) return { canceled: true };
  try { fs.writeFileSync(r.filePath, content, 'utf8'); return { canceled: false, path: r.filePath }; }
  catch (e) { return { canceled: true, error: e.message }; }
});

// Test rapido di raggiungibilità della stampante.
ipcMain.handle('test-connection', async (_e, connection) => {
  try {
    if (connection.type === 'ip') {
      await new Promise((resolve, reject) => {
        const sock = new net.Socket();
        sock.setTimeout(4000);
        sock.once('connect', () => { sock.destroy(); resolve(); });
        sock.once('timeout', () => { sock.destroy(); reject(new Error('timeout')); });
        sock.once('error', (err) => reject(err));
        sock.connect(Number(connection.port) || 9100, connection.ip);
      });
      return { ok: true, message: `Printer reachable at ${connection.ip}:${connection.port || 9100}.` };
    }
    if (connection.type === 'printer') {
      const printers = await listWindowsPrinters();
      const found = printers.includes(connection.printer);
      return found
        ? { ok: true, message: `Printer "${connection.printer}" found in Windows.` }
        : { ok: false, error: `Printer "${connection.printer}" not found among installed printers.` };
    }
    return { ok: true, message: 'Manual check for the USB port.' };
  } catch (e) {
    return { ok: false, error: 'Not reachable: ' + e.message };
  }
});

// Matrice QR reale per l'anteprima (0/1 per modulo).
ipcMain.handle('qr-matrix', (_e, text) => {
  try {
    const qr = QRCode.create(String(text || ' '), { errorCorrectionLevel: 'Q' }); // come ZPL "QA,"
    return { size: qr.modules.size, data: Array.from(qr.modules.data) };
  } catch (e) {
    return { size: 0, data: [] };
  }
});

// Immagine DataMatrix (PNG dataURL) per l'anteprima.
ipcMain.handle('dm-image', async (_e, text) => {
  try {
    const png = await bwipjs.toBuffer({ bcid: 'datamatrix', text: String(text || ' '), scale: 4, includetext: false });
    return 'data:image/png;base64,' + png.toString('base64');
  } catch (e) { return ''; }
});

// --- Diagnostica ---
function tcpConnect(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const s = new net.Socket(); let done = false;
    const fin = (e) => { if (done) return; done = true; s.destroy(); e ? reject(e) : resolve(); };
    s.setTimeout(timeoutMs);
    s.once('timeout', () => fin(new Error('timeout')));
    s.once('error', fin);
    s.connect(port, host, () => fin());
  });
}
function tcpQuery(host, port, payload, timeoutMs) {
  return new Promise((resolve) => {
    const s = new net.Socket(); let buf = ''; let done = false;
    const fin = () => { if (done) return; done = true; s.destroy(); resolve(buf); };
    s.setTimeout(timeoutMs);
    s.once('timeout', fin);
    s.once('error', fin);
    s.once('end', fin);
    s.connect(port, host, () => s.write(payload));
    s.on('data', (d) => { buf += d.toString('latin1'); if (buf.length > 4096) fin(); });
  });
}
function nonZeroHex(line) { return (line.match(/[0-9a-fA-F]{8}/g) || []).some((t) => /[1-9a-fA-F]/.test(t)); }
function parseHQES(resp) {
  if (!resp || !/ERROR|WARNING|PRINTER STATUS/i.test(resp)) return { ok: true, message: 'Connected. Firmware does not report status (normal on some models).' };
  const lines = resp.split(/\r?\n/);
  const err = lines.find((l) => /ERROR/i.test(l)) || '';
  const warn = lines.find((l) => /WARNING/i.test(l)) || '';
  if (nonZeroHex(err)) return { ok: false, message: 'The printer reports an ERROR (out of media, head open, or paused). Check the printer.' };
  if (nonZeroHex(warn)) return { ok: true, message: 'Connected, with an active warning (e.g. media low or head warm).' };
  return { ok: true, message: 'Connected, no errors reported.' };
}
function getPrinterInfo(name) {
  return new Promise((resolve) => {
    const esc = name.replace(/'/g, "''");
    execFile('powershell.exe', ['-NoProfile', '-Command',
      `$ErrorActionPreference='SilentlyContinue'; $p=Get-Printer -Name '${esc}'; $j=(Get-PrintJob -PrinterName '${esc}' | Measure-Object).Count; Write-Output ($p.PrinterStatus.ToString()+'|'+$p.PortName+'|'+$j)`],
      (err, stdout) => {
        if (err || !stdout) return resolve({});
        const [status, port, jobs] = stdout.trim().split('|');
        resolve({ status, port, jobCount: Number(jobs) || 0 });
      });
  });
}

ipcMain.handle('diagnose', async (_e, connection) => {
  const results = [];
  const add = (ok, label, detail) => results.push({ ok, label, detail });
  try {
    if (connection.type === 'ip') {
      const host = connection.ip; const port = Number(connection.port) || 9100;
      if (!host) { add(false, 'IP address', 'No IP set.'); return { results }; }
      try { await tcpConnect(host, port, 4000); add(true, 'Network reachability', `${host}:${port} reachable.`); }
      catch (e) { add(false, 'Network reachability', `Cannot connect to ${host}:${port}. Make sure the printer is on and the IP is correct (it may have changed).`); return { results }; }
      const resp = await tcpQuery(host, port, '~HQES\r\n', 3000);
      const st = parseHQES(resp);
      add(st.ok, 'Printer status', st.message);
    } else if (connection.type === 'printer') {
      if (process.platform !== 'win32') { add(true, 'Printer', 'Diagnostics by name available only on Windows.'); return { results }; }
      const printers = await listWindowsPrinters();
      const found = printers.includes(connection.printer);
      add(found, 'Printer installed', found ? `"${connection.printer}" present in Windows.` : `"${connection.printer}" not found among installed printers.`);
      if (!found) return { results };
      const info = await getPrinterInfo(connection.printer);
      const statusOk = !info.status || /normal|idle/i.test(info.status);
      add(statusOk, 'Windows status', `Status: ${info.status || '?'} · port: ${info.port || '?'}`);
      add(info.jobCount === 0, 'Print queue', info.jobCount > 0 ? `${info.jobCount} jobs queued: possible block. Clear the queue or restart the spooler.` : 'Queue empty.');
      if (/^lan_|_ip_|tcp|zdesigner/i.test(info.port || '')) {
        add(true, 'Tip', 'Network/virtual port: if jobs stay queued without printing, the printer IP may have changed. Try the "Network (IP)" method with the current address, or set a static IP.');
      }
    } else {
      add(true, 'USB', 'Make sure the printer is on and connected; on Windows that the USB port is the right one.');
    }
  } catch (e) {
    add(false, 'Diagnostics error', e.message);
  }
  return { results };
});

// --- Print server HTTP (avviabile dalla GUI) ---
function connectionFromSettings(s) {
  const type = s.connType || 'printer';
  if (type === 'printer') return { type: 'printer', printer: s.printer };
  if (type === 'ip') return { type: 'ip', ip: s.ip, port: 9100 };
  if (type === 'usb') return { type: 'usb', usb: s.usb };
  return null;
}
function startPrintServer() {
  const s = loadSettings();
  const port = Number(s.serverPort) || 9110;
  const token = s.serverToken || '';
  try {
    printServer = startServer({
      port, host: '127.0.0.1', token: token || undefined,
      resolveTemplate: (file) => loadTemplateRaw(file),
      listTemplateNames: () => listTemplates().map((t) => t.file.replace(/\.json$/, '')),
      defaults: { connection: connectionFromSettings(s) },
    });
    printServer.on('error', () => {}); // es. porta occupata
    return { ok: true, running: true, port, url: `http://127.0.0.1:${port}` };
  } catch (e) {
    printServer = null;
    return { ok: false, error: e.message };
  }
}
function stopPrintServer() {
  if (printServer) { try { printServer.close(); } catch (_) {} printServer = null; }
  return { ok: true, running: false };
}
ipcMain.handle('server-start', () => startPrintServer());
ipcMain.handle('server-stop', () => stopPrintServer());
ipcMain.handle('server-status', () => {
  const s = loadSettings();
  return { running: !!printServer, port: Number(s.serverPort) || 9110, url: `http://127.0.0.1:${Number(s.serverPort) || 9110}` };
});

ipcMain.handle('get-settings', () => loadSettings());
ipcMain.handle('save-settings', (_e, obj) => saveSettings(obj));
ipcMain.handle('reset-settings', () => {
  try { fs.writeFileSync(SETTINGS_FILE, '{}', 'utf8'); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('app-version', () => app.getVersion());
ipcMain.handle('open-templates-folder', async () => {
  try { await shell.openPath(USER_TEMPLATES_DIR); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('print', async (_e, payload) => {
  try { return await doPrint(payload); }
  catch (err) { return { ok: false, error: err.message }; }
});

// Crea automaticamente il collegamento sul Desktop al primo avvio dell'app impacchettata.
function ensureDesktopShortcut() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  const s = loadSettings();
  if (s.shortcutCreated) return;
  try {
    const lnk = path.join(app.getPath('desktop'), 'LabelForge.lnk');
    shell.writeShortcutLink(lnk, 'create', {
      target: process.execPath,
      description: 'Zebra ZD410 label printer',
      icon: process.execPath,
      iconIndex: 0,
    });
    saveSettings({ shortcutCreated: true });
  } catch (_) { /* ignora se non riesce */ }
}

ipcMain.handle('create-desktop-shortcut', () => {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only.' };
  try {
    const target = app.isPackaged ? process.execPath : process.execPath; // in dev punta a electron.exe
    const lnk = path.join(app.getPath('desktop'), 'LabelForge.lnk');
    shell.writeShortcutLink(lnk, 'create', { target, description: 'Zebra ZD410 label printer', icon: target, iconIndex: 0 });
    saveSettings({ shortcutCreated: true });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

app.whenReady().then(() => {
  ensureUserDirs();
  createWindow();
  ensureDesktopShortcut();
  if (loadSettings().serverEnabled) startPrintServer();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
