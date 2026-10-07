# Changelog

Tutte le modifiche rilevanti a LabelForge. / All notable changes to LabelForge.

## v1.17.0
- 🎯 **Allineamento barcode** (grazie @PaloTrucoo — Juan Manuel): nuove proprietà `align`
  (sinistra/centro/destra) e `box_width_mm` per gli elementi barcode (Code128, Code39, Code93,
  EAN‑13). Il codice viene centrato o allineato a destra dentro una larghezza di riferimento.
  Applicato in modo coerente sia all'anteprima sia a tutti i backend (ZPL/TSPL/EPL/EZPL), così
  stampa e anteprima restano identiche. Retrocompatibile: default "sinistra" = nessun cambiamento. /
  Barcode alignment (left/center/right within a reference box width), consistent across preview and
  all backends. Thanks @PaloTrucoo.

## v1.16.1
- 🐛 Fix (issue #1, grazie @gyfooya): in modalità Editor, selezionando un altro modello ora si
  ricarica l'editor con quel modello (prima si aggiornava solo l'anteprima e serviva riclickare
  "Editor"). / Selecting a template while in Editor mode now reloads the editor with it.

## v1.16.0
- 🔌 **Integrazione**: print server HTTP (`POST /print`, `GET /templates`, `GET /health`, token opzionale, CORS)
  e **watch-folder** (deposita un file JSON → stampa). Avviabili da CLI (`serve`/`watch`) o dal pannello
  Impostazioni dell'app (toggle "Print server"). / HTTP print server + watch-folder integration.
- 📖 Documentazione tecnica d'integrazione: `docs/INTEGRATION.md` (API, esempi, schema del job).

## v1.14.0
- 🌍 **Interfaccia bilingue** English (predefinito) + Italiano, con selettore lingua nelle Impostazioni. / Bilingual UI (English default + Italian), switchable in Settings.
- 🎨 Icona dell'app dedicata (exe, installer, finestra). / Dedicated app icon.
- 🧪 Smoke test + workflow CI di test; metadati `package.json` completi; `SECURITY.md` e `CODE_OF_CONDUCT.md`.
- 📝 Correzioni documentazione (EZPL, versioni). / Docs fixes.

## v1.12.0
- 🩺 **Diagnostica stampante**: verifica raggiungibilità di rete, stato reale della stampante
  (errori tipo carta finita / testina aperta / pausa via `~HQES`), stato e coda della stampante
  Windows, con suggerimenti mirati (es. IP cambiato).
- 🧭 Mappatura colonne CSV → campi del modello (import robusto con qualsiasi intestazione).
- ⬇ Generazione di un CSV di esempio con le colonne giuste per il modello selezionato.
- 🎛️ Pannello **Impostazioni** unificato: connessione, stampante, tema, copie predefinite,
  intensità/velocità di stampa, griglia editor, linguaggio predefinito, ripristino, apri cartella.
- 🧰 Barra editor ridisegnata (gruppi, titolo del modello, azioni rapide).
- 🛡️ I codici a barre/QR con dato vuoto non vengono più inviati (evita blocchi della stampante).

## Funzionalità principali (storico)
- 🖨️ Stampa via rete (porta 9100), stampante Windows per nome, o USB (Linux/Mac).
- 🌐 Linguaggi: **ZPL** (testato) + **TSPL/EPL/CPCL/EZPL** (sperimentali).
- 🔠 Codici: testo, Code128, Code39, Code93, EAN‑13, QR Code, DataMatrix; linee e riquadri.
- 🎨 Editor visuale con anteprima live (barcode e QR reali), trascinamento, ridimensionamento, snap.
- 🧩 Campi dinamici `{{campo}}`: testo, menu a tendina, liste con quantità (una etichetta per voce).
- ⚡ Stampa automatica dopo scansione; import CSV per stampe in blocco.
- 🕘 Storico con ristampa, ricerca modelli, tema chiaro/scuro, scorciatoie, undo/redo.
- 📦 Pacchettizzazione `.exe` e build automatica Windows/Linux/macOS via GitHub Actions.

Nota: solo ZPL è testato su hardware reale; gli altri linguaggi sono sperimentali.
