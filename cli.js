#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { buildLabel } = require('./lib/render');
const { sendNetwork, sendUSBWindows, sendUSBUnix, sendWindowsPrinterByName } = require('./lib/print');
const { startServer, startWatch } = require('./lib/server');

const TEMPLATES_DIR = path.join(__dirname, 'templates');

function printUsage() {
  console.log(`
Zebra ZD410 - Stampa etichette (ZPL)

Uso:
  node cli.js print --template <nome-o-file> [--data file.json] [--set campo=valore ...]
                     (--ip <indirizzo> [--port 9100] | --printer <NOME_STAMPANTE_WINDOWS> | --usb <PORTA>)
                     [--copies N] [--counter-start N] [--out file.zpl] [--dry-run]

  node cli.js list-templates
  node cli.js list-printers
  node cli.js calibrate (--ip <indirizzo> | --printer <NOME> | --usb <PORTA>)
  node cli.js test (--ip <indirizzo> | --printer <NOME> | --usb <PORTA>) [--template <nome>]

  node cli.js serve [--port 9110] [--host 127.0.0.1] [--token SEGRETO]
                    [--printer <NOME> | --ip <indirizzo> | --usb <PORTA>]
      Avvia un print server HTTP: altri programmi stampano con POST /print.
  node cli.js watch [--dir ./inbox] [--printer <NOME> | --ip <indirizzo> | --usb <PORTA>]
      Sorveglia una cartella: ogni file .json depositato viene stampato.

Esempi:
  node cli.js print --template product-51x25 --set title="Vite M6" --set subtitle="Confezione 100pz" --set code=8012345 --ip 192.168.1.50
  node cli.js print --template box-102x51 --data ordine.json --printer "Zebra"
  node cli.js print --template shipping-102x152 --data ordini.json --ip 192.168.1.50 --copies 2
  node cli.js list-printers

Campi automatici nei template: {{date}} {{date+30}} {{date:YYYY-MM-DD}} {{time}} {{now}}
{{counter}} {{counter:4}} (numero progressivo per etichetta; partenza con --counter-start).

Nota Windows: --printer "Nome" (come mostrato da "list-printers") funziona con qualsiasi
tipo di porta (USB, rete, WSD, porte virtuali) ed è il metodo consigliato. --usb <PORTA>
è un metodo alternativo che funziona solo con porte "reali" tipo USB001/LPT1.
`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (key === 'set') {
        args.set = args.set || [];
        args.set.push(argv[++i]);
      } else if (key === 'dry-run') {
        args.dryRun = true;
      } else {
        args[key] = argv[++i];
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function loadTemplate(nameOrPath) {
  let file = nameOrPath;
  if (!fs.existsSync(file)) {
    file = path.join(TEMPLATES_DIR, nameOrPath.endsWith('.json') ? nameOrPath : `${nameOrPath}.json`);
  }
  if (!fs.existsSync(file)) {
    throw new Error(`Template non trovato: ${nameOrPath} (cercato anche in ${TEMPLATES_DIR})`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadDataList(args) {
  let list = [{}];
  if (args.data) {
    const raw = JSON.parse(fs.readFileSync(args.data, 'utf8'));
    list = Array.isArray(raw) ? raw : [raw];
  }
  if (args.set) {
    const overrides = {};
    for (const kv of args.set) {
      const idx = kv.indexOf('=');
      if (idx === -1) throw new Error(`--set deve essere nel formato campo=valore, ricevuto: "${kv}"`);
      overrides[kv.slice(0, idx)] = kv.slice(idx + 1);
    }
    list = list.map((d) => Object.assign({}, d, overrides));
  }
  return list;
}

async function cmdListTemplates() {
  const files = fs.readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith('.json'));
  console.log('Template disponibili:\n');
  for (const f of files) {
    const t = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, f), 'utf8'));
    console.log(`  ${t.name.padEnd(20)} ${t.width_mm}x${t.height_mm}mm  - ${t.description || ''}`);
  }
}

function cmdListPrinters() {
  if (process.platform === 'win32') {
    console.log('Stampanti installate su Windows:\n');
    execFile('powershell.exe', ['-NoProfile', '-Command',
      "Get-Printer | Select-Object Name,DriverName,PortName | Format-Table -AutoSize"],
      (err, stdout, stderr) => {
        if (err) {
          console.error('Errore nel leggere le stampanti:', stderr || err.message);
          return;
        }
        console.log(stdout);
        console.log('Usa il valore in "PortName" (es. USB001) con --usb per stampare via USB.');
      });
  } else {
    console.log('Su Linux/Mac controlla le stampanti con: lpstat -p   (oppure guarda /dev/usb/lp*)');
  }
}

async function sendZpl(buffer, args) {
  if (args.ip) {
    const port = args.port ? Number(args.port) : 9100;
    console.log(`Invio a ${args.ip}:${port} ...`);
    await sendNetwork(args.ip, port, buffer);
    console.log('Etichetta inviata (rete).');
  } else if (args.printer) {
    console.log(`Invio alla stampante Windows "${args.printer}" (per nome) ...`);
    const out = await sendWindowsPrinterByName(args.printer, buffer);
    if (out) console.log(out.trim());
    console.log('Etichetta inviata.');
  } else if (args.usb) {
    if (process.platform === 'win32') {
      console.log(`Invio a porta/stampante USB "${args.usb}" ...`);
      await sendUSBWindows(args.usb, buffer);
    } else {
      console.log(`Invio a device "${args.usb}" ...`);
      await sendUSBUnix(args.usb, buffer);
    }
    console.log('Etichetta inviata (USB).');
  } else {
    throw new Error('Specifica --ip <indirizzo>, --printer <nome stampante Windows> oppure --usb <porta>.');
  }
}

async function cmdPrint(args) {
  if (!args.template) throw new Error('Manca --template <nome-o-file>');
  const template = loadTemplate(args.template);
  const dataList = loadDataList(args);
  const copies = args.copies ? Number(args.copies) : 1;
  const buildOpts = { copiesPerLabel: copies };
  if (args['counter-start'] != null) buildOpts.counterStart = Number(args['counter-start']);
  const zpl = buildLabel(template, dataList, buildOpts);

  if (args.out) {
    fs.writeFileSync(args.out, zpl);
    console.log(`ZPL salvato in ${args.out}`);
  }

  if (args.dryRun) {
    console.log('--- ZPL generato (dry-run, nessun invio) ---');
    console.log(zpl.toString('ascii'));
    return;
  }

  await sendZpl(zpl, args);
}

async function cmdCalibrate(args) {
  // ~JC forza la calibrazione automatica dei sensori (media/gap/black mark)
  const buffer = Buffer.from('~JC\n', 'ascii');
  await sendZpl(buffer, args);
  console.log('Comando di calibrazione inviato. La stampante alimenterà alcune etichette per calibrarsi.');
}

async function cmdTest(args) {
  const templateName = args.template || 'product-51x25';
  const template = loadTemplate(templateName);
  const data = {
    title: 'TEST STAMPA',
    subtitle: new Date().toLocaleString('it-IT'),
    code: '123456789',
    qrdata: 'https://example.com/test',
    note: 'Etichetta di prova',
    mittente: 'Azienda Srl',
    destinatario: 'Cliente Test',
    indirizzo: 'Via Roma 1',
    citta_cap: '50100 Firenze (FI)',
    ordine_id: 'ORD-0001',
  };
  const zpl = buildLabel(template, [data]);
  await sendZpl(zpl, args);
}

// Connessione predefinita per serve/watch dai flag CLI (opzionale).
function defaultConnectionFromArgs(args) {
  if (args.printer) return { type: 'printer', printer: args.printer };
  if (args.ip) return { type: 'ip', ip: args.ip, port: args.port ? Number(args.port) : 9100 };
  if (args.usb) return { type: 'usb', usb: args.usb };
  return null;
}

function cmdServe(args) {
  const port = args.port ? Number(args.port) : 9110;
  const host = args.host || '127.0.0.1';
  const conn = defaultConnectionFromArgs(args);
  startServer({ port, host, templatesDir: TEMPLATES_DIR, token: args.token, defaults: conn ? { connection: conn } : {} });
  console.log(`Print server LabelForge in ascolto su http://${host}:${port}`);
  console.log(`  GET  /health        stato del server`);
  console.log(`  GET  /templates     elenco modelli`);
  console.log(`  POST /print         { "template":"...", "data":{...}, "printer|ip|usb":"..." }`);
  if (conn) console.log(`  Connessione predefinita: ${JSON.stringify(conn)}`);
  if (args.token) console.log(`  Autenticazione: header "Authorization: Bearer ${args.token}" oppure "X-Api-Key: ${args.token}"`);
  console.log('Premi Ctrl+C per fermare.');
}

function cmdWatch(args) {
  const dir = path.resolve(args.dir || './inbox');
  const conn = defaultConnectionFromArgs(args);
  startWatch({ dir, templatesDir: TEMPLATES_DIR, defaults: conn ? { connection: conn } : {} });
  console.log(`Watch attivo sulla cartella: ${dir}`);
  console.log('Deposita file .json (es. { "template":"product-51x25", "data":{...}, "printer":"Zebra" }).');
  console.log('I file stampati vanno in printed/, gli errori in errors/. Premi Ctrl+C per fermare.');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  try {
    switch (cmd) {
      case 'print':
        await cmdPrint(args);
        break;
      case 'list-templates':
        await cmdListTemplates();
        break;
      case 'list-printers':
        cmdListPrinters();
        break;
      case 'calibrate':
        await cmdCalibrate(args);
        break;
      case 'test':
        await cmdTest(args);
        break;
      case 'serve':
        cmdServe(args);
        break;
      case 'watch':
        cmdWatch(args);
        break;
      default:
        printUsage();
    }
  } catch (err) {
    console.error('Errore:', err.message);
    process.exitCode = 1;
  }
}

main();
