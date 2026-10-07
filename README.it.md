<div align="center">

<img src="docs/banner.svg" width="820" alt="LabelForge">

### Stampa etichette ZPL su stampanti Zebra — app desktop + CLI, con editor visuale dei template.

Progetta le etichette visivamente, compila i campi (o scansionali) e stampa via rete o USB.

[![Licenza: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Piattaforma](https://img.shields.io/badge/piattaforma-Windows%20%7C%20Linux%20%7C%20macOS-blue)](#-requisiti)
[![Electron](https://img.shields.io/badge/Electron-31-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Build](https://github.com/dextsamu/labelforge/actions/workflows/build.yml/badge.svg)](https://github.com/dextsamu/labelforge/actions/workflows/build.yml)
[![Test](https://github.com/dextsamu/labelforge/actions/workflows/test.yml/badge.svg)](https://github.com/dextsamu/labelforge/actions/workflows/test.yml)

[🇬🇧 English](README.md) · **🇮🇹 Italiano**

</div>

---

> **LabelForge** trasforma template JSON dinamici in ZPL e li invia direttamente a una stampante
> Zebra (testata su **ZD410**). Funziona da un'interfaccia desktop pulita *oppure* da riga di
> comando, con editor dei template drag‑and‑drop e anteprima live. Nessuna dipendenza a pagamento.

<div align="center">
  <img src="docs/Screenshot.png" width="880" alt="LabelForge — vista di stampa con anteprima live">
</div>

## ✨ Caratteristiche

| | |
|---|---|
| 🖨️ **Connessioni multiple** | Rete (porta raw 9100), stampante Windows per nome (API Win32 — funziona con qualsiasi porta, anche quelle virtuali di Zebra Setup Utilities), o device USB su Linux/Mac. |
| 🌐 **Più linguaggi** | Stampa in **ZPL** (testato) e, in via sperimentale, **TSPL / EPL / CPCL / EZPL**. Stessi editor e anteprima; cambiano solo i comandi generati. |
| 🧩 **Template dinamici** | Template JSON con testo, codici a barre (Code128, Code39, Code93, EAN‑13), QR code, DataMatrix, linee e riquadri. Misure in mm; 203/300 dpi. |
| 🎨 **Editor visuale** | Anteprima live con **barcode Code128 e QR reali**; seleziona, trascina, ridimensiona e aggancia gli elementi a una griglia. Allineamento sinistra/centro/destra con un clic per testo e barcode (sull'etichetta o entro una box), con guida visiva. Nessuna modifica manuale del JSON. |
| ⌨️ **Campi intelligenti** | Campi `{{campo}}` come testo, menu a tendina o liste con quantità per voce (una etichetta per unità). |
| ⚡ **Scansiona e stampa** | Stampa automatica dopo la scansione (il lettore si comporta come tastiera) — ideale per raffiche. |
| 📄 **Stampa in blocco da CSV** | Importa un CSV e stampa una etichetta per riga (le colonne riempiono i `{{campi}}`). |
| 🔁 **Condividi i template** | Esporta/importa i template come `.json`; testa la connessione alla stampante prima di stampare. |
| 🕘 **Storico e scorciatoie** | Ristampa dallo storico, ricerca template, tema chiaro/scuro, undo/redo nell'editor e scorciatoie (Ctrl+P/S/F/Z/Y). |
| 🔌 **Integrazione** | Stampa da altri programmi tramite print server HTTP o watch‑folder (deposita un job JSON). |
| 🌍 **Interfaccia bilingue** | Inglese (predefinito) e Italiano, selezionabile nelle Impostazioni. |
| 💾 **Ricorda tutto** | Stampante, ultimo template, tema, lingua e preferenze salvati tra un avvio e l'altro. |
| 📦 **Distribuisci come app** | Pacchettizzazione in `.exe` Windows; collegamento sul Desktop creato automaticamente al primo avvio. |

## 📋 Requisiti

- [Node.js](https://nodejs.org) 18+ (consigliato 20+)
- Windows per la stampa USB tramite nome stampante — la rete (IP) funziona ovunque

## ⬇️ Installazione

- **Windows / Linux / macOS** — scarica l'app per il tuo sistema dall'[ultima release](https://github.com/dextsamu/labelforge/releases/latest).
- **Arch Linux (AUR)** — `yay -S labelforge-bin` (pacchetto community: [labelforge-bin](https://aur.archlinux.org/packages/labelforge-bin), grazie @gyfooya).
- **Dai sorgenti** — vedi Avvio rapido qui sotto.

## 🚀 Avvio rapido (GUI)

```bash
npm install
npm start
```

## 🖥️ Riga di comando (CLI)

```bash
node cli.js list-templates                 # elenco template
node cli.js list-printers                  # elenco stampanti Windows
# stampa via rete
node cli.js print --template product-51x25 --ip 192.168.1.50 --set title="Prodotto" --set code=12345
# stampa per nome stampante Windows (consigliato)
node cli.js print --template product-51x25 --printer "Zebra" --set title="Prodotto" --set code=12345
node cli.js test --printer "Zebra"         # etichetta di prova
node cli.js calibrate --printer "Zebra"    # calibrazione automatica sensori
```

## 📦 Creare l'eseguibile Windows

Metodo consigliato (nessun problema di code‑signing):

```bash
npm install
npm run pack:exe
```

Risultato in `dist-app/LabelForge-win32-x64/` — eseguibile avviabile a doppio clic.
In alternativa un installer con `npm run dist` (electron‑builder; su Windows può richiedere la Modalità sviluppatore).

### 🤖 Build automatica su GitHub

Il workflow [`build.yml`](.github/workflows/build.yml) compila l'app per **Windows, Linux e macOS**.
Pubblica un tag `vX.Y.Z` per generare una **Release** con i tre zip allegati, oppure lancialo dalla
scheda **Actions**:

```bash
git tag v1.0.0
git push origin v1.0.0
```

## 🤝 Contribuire

I contributi sono benvenuti — vedi [CONTRIBUTING.md](CONTRIBUTING.md). Apri una issue (ci sono i
modelli) prima di modifiche importanti. L'app impacchettata non è firmata, quindi Windows SmartScreen
può avvisare al primo avvio; firma e auto‑aggiornamento sono opzionali.

## 🔌 Integrazione (stampa da altri programmi)

Altri programmi possono stampare tramite LabelForge senza la GUI:

**Print server HTTP** — avvialo, poi qualsiasi programma (script, app web, altro PC) invia una POST:

```bash
node cli.js serve --port 9110 --printer "Zebra"     # oppure --ip 192.168.1.50
```
```bash
curl -X POST http://localhost:9110/print -H "Content-Type: application/json" \
  -d '{"template":"product-51x25","data":{"title":"Articolo","code":"12345"},"printer":"Zebra"}'
```
Endpoint: `GET /health`, `GET /templates`, `POST /print`. In blocco: invia `"rows":[{...},{...}]`.
Autenticazione opzionale con `--token SEGRETO` (`Authorization: Bearer SEGRETO` o `X-Api-Key: SEGRETO`).
La connessione si può indicare per richiesta (`printer`/`ip`/`usb`) o come default del server via flag CLI.

**Watch folder** — deposita un file `.json` in una cartella e viene stampato in automatico:

```bash
node cli.js watch --dir ./inbox --printer "Zebra"
```
Ogni file tipo `{"template":"product-51x25","data":{...}}` viene stampato e spostato in `printed/`
(o `errors/` in caso di errore). Ideale per gestionali che sanno solo scrivere file.

**CLI diretta** — `node cli.js print --template ... --set campo=valore --printer "Zebra"` per stampe singole.

📖 API completa e schema del job: **[docs/INTEGRATION.md](docs/INTEGRATION.md)**.

## 🖨️ Linguaggi stampante e compatibilità

LabelForge genera il linguaggio di comando della stampante dallo stesso template visuale. Il
linguaggio si imposta per template (editor → *Linguaggio stampante*).

| Linguaggio | Stato | Stampanti tipiche |
|---|---|---|
| **ZPL** | ✅ Testato (ZD410) | Famiglia Zebra ZPL: ZD410/ZD420/ZD620, GK420/GX420, ZT230/ZT411, ZQ mobile — 203/300/600 dpi |
| **TSPL** | 🧪 Sperimentale, non testato | TSC (TE200, TDP‑244, TTP‑244), alcune Godex (EZPL è simile) |
| **EPL** | 🧪 Sperimentale, non testato | Vecchie Zebra/Eltron (LP2824, TLP2844, alcune GK in modalità EPL) |
| **CPCL** | 🧪 Sperimentale, non testato | Zebra portatili (QLn, ZQ511/ZQ521, iMZ) |
| **EZPL** | 🧪 Sperimentale, non testato | Godex (G500, RT200, DT2x) |

> ⚠️ **Solo ZPL è testato su hardware reale.** TSPL, EPL, CPCL ed EZPL sono forniti come punto di
> partenza e **non** sono stati verificati su stampanti fisiche — la sintassi dei comandi e soprattutto
> la dimensione del testo potrebbero richiedere aggiustamenti. Segnalazioni e contributi di test per
> questi linguaggi sono molto graditi (apri una issue).

## 🧩 Template

I template stanno in `templates/*.json`. Esempio minimo:

```json
{
  "name": "product-51x25",
  "dpi": 203,
  "width_mm": 51,
  "height_mm": 25,
  "tear_off": 30,
  "field_meta": {
    "category": { "type": "select", "label": "Categoria", "options": ["A", "B", "C"] }
  },
  "elements": [
    { "type": "text", "x_mm": 3, "y_mm": 2, "height_mm": 3, "width_mm": 3, "text": "{{title}}" },
    { "type": "barcode128", "x_mm": 3, "y_mm": 11, "bar_height_mm": 8, "text": "{{code}}" }
  ]
}
```

**Tipi di elemento:** `text`, `barcode128`, `code39`, `code93`, `ean13`, `datamatrix`, `qrcode`, `box`, `line`.

**Allineamento** (testo e barcode lineari): `"align": "left" | "center" | "right"` con
`"box_width_mm"` facoltativo. L'elemento viene allineato dentro una box che parte da `x_mm` ed è
larga `box_width_mm`; se `box_width_mm` manca, la box è l'intera etichetta e `x_mm` fa da margine
su entrambi i lati (quindi `"align": "center"` centra sull'etichetta). I dati a lunghezza variabile
restano centrati. In ZPL il testo usa il blocco nativo `^FB`; nei linguaggi sperimentali la
posizione è stimata.

```json
{ "type": "barcode128", "x_mm": 3, "y_mm": 11, "bar_height_mm": 8, "text": "{{code}}", "align": "center" }
```
**Tipi di campo** (`field_meta`): `select` → menu a tendina, `multi-qty` → lista con quantità per
voce (una etichetta per unità). Esempi inclusi: prodotto, spedizione, QR e `product-variants`
(tendina + lista quantità).

## 🗂️ Struttura del progetto

```
cli.js                        riga di comando
gui/                          app Electron (main, preload, index.html, renderer, preview)
lib/zpl.js                    generatore ZPL
lib/print.js                  invio rete / stampante Windows / USB
scripts/send-raw-printer.ps1  invio RAW a stampante Windows per nome
templates/                    template di esempio (modificabili)
.github/workflows/build.yml   build automatica dell'exe
```

## 🔧 Note tecniche

Lo ZPL viene inviato **raw**: su Windows tramite `OpenPrinter`/`WritePrinter` (qualsiasi tipo di
porta, anche virtuali); via rete su porta 9100; su Linux/Mac scrivendo sul device (es.
`/dev/usb/lp0`). Se le etichette non si fermano sulla barra di strappo, esegui `calibrate` e regola
`tear_off` nel template.

> `npm audit` può segnalare avvisi dagli strumenti di sviluppo (Electron/builder). Non finiscono
> nell'app e si possono ignorare — **non** lanciare `npm audit fix --force` (rompe il build).

## 🙌 Crediti

Grazie a tutti coloro che segnalano problemi e contribuiscono.

**Contributori**

- [@dextsamu](https://github.com/dextsamu) — autore e maintainer
- [@gyfooya](https://github.com/gyfooya) — pacchetto [AUR di Arch Linux](https://aur.archlinux.org/packages/labelforge-bin), primi feedback e fix del ricaricamento dell'editor (#1)
- [@PaloTrucoo](https://github.com/PaloTrucoo) (Juan Manuel) — allineamento dei codici a barre (sinistra/centro/destra)

Vuoi comparire in questa lista? I contributi sono benvenuti — vedi [CONTRIBUTING.md](CONTRIBUTING.md).

## 📄 Licenza

Rilasciato sotto [Licenza MIT](LICENSE).
