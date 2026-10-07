# LabelForge — Integration Guide

Print labels from other programs through LabelForge. Three integration methods:

1. **HTTP print server** — call a local REST endpoint (recommended)
2. **Watch folder** — drop a JSON job file and it prints automatically
3. **CLI** — shell out to the command line for one‑off prints

All three share the same **job schema** (see [below](#job-schema)).

---

## 1. HTTP print server

### Start it

From the desktop app: **⚙️ Settings → Print server → Enable HTTP print server** (set port/token).
From the CLI:

```bash
node cli.js serve --port 9110 --printer "Zebra"     # or --ip 192.168.1.50 / --usb USB001
# optional: --token SECRET   --host 0.0.0.0 (expose on LAN — use a token!)
```

By default it listens on **`127.0.0.1`** (localhost only).

### Endpoints

| Method | Path | Description |
|---|---|---|
| GET  | `/health`    | `{ ok, name, version }` |
| GET  | `/templates` | `{ ok, templates: ["product-51x25", ...] }` |
| POST | `/print`     | Print one or more labels. Body = a **job** (JSON). Returns `{ ok, count }` or `{ ok:false, error }`. |

CORS is enabled (`Access-Control-Allow-Origin: *`).

### Authentication (optional)

If a token is set, send it as either header:

```
Authorization: Bearer SECRET
X-Api-Key: SECRET
```

### Examples

**curl**
```bash
curl -X POST http://localhost:9110/print \
  -H "Content-Type: application/json" \
  -d '{"template":"product-51x25","data":{"title":"Item","code":"12345"},"printer":"Zebra"}'
```

**Python**
```python
import requests
requests.post("http://localhost:9110/print", json={
    "template": "product-51x25",
    "data": {"title": "Apple", "code": "8012345"},
    "printer": "Zebra",          # or "ip": "192.168.1.50" / "usb": "USB001"
    "copies": 2
})
```

**PowerShell**
```powershell
Invoke-RestMethod -Uri http://localhost:9110/print -Method Post -ContentType application/json -Body '{
  "template":"product-51x25","data":{"title":"Item","code":"12345"},"printer":"Zebra"}'
```

**Node / JavaScript (fetch)**
```js
await fetch("http://localhost:9110/print", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ template: "product-51x25", data: { title: "Item", code: "12345" }, printer: "Zebra" }),
});
```

**C# (.NET)**
```csharp
using var http = new HttpClient();
var body = new StringContent(
  "{\"template\":\"product-51x25\",\"data\":{\"title\":\"Item\",\"code\":\"12345\"},\"printer\":\"Zebra\"}",
  System.Text.Encoding.UTF8, "application/json");
await http.PostAsync("http://localhost:9110/print", body);
```

### Batch printing

Send a `rows` array — one label per row (columns become fields):

```json
{
  "template": "product-51x25",
  "rows": [
    { "title": "Apple",  "code": "8012345000019" },
    { "title": "Pear",   "code": "8012345000026" }
  ],
  "printer": "Zebra"
}
```

---

## 2. Watch folder

Start it (app default connection is used if the job omits one):

```bash
node cli.js watch --dir ./inbox --printer "Zebra"
```

Any program that writes a `*.json` file into `./inbox` triggers a print. Job files use the same
[job schema](#job-schema). After printing, the file moves to `inbox/printed/`; on error it moves to
`inbox/errors/` with a `*.error.txt` describing the problem.

Example job file `inbox/order-42.json`:
```json
{ "template": "shipping-102x152", "data": { "destinatario": "Mario Rossi", "ordine": "ORD-42" }, "printer": "Zebra" }
```

---

## 3. CLI (one‑off)

```bash
node cli.js print --template product-51x25 --set title="Item" --set code=12345 --printer "Zebra"
node cli.js print --template product-51x25 --data job.json --ip 192.168.1.50
node cli.js print --template product-51x25 --set title=Test --out out.zpl --dry-run   # inspect ZPL only
```

---

## Job schema

| Field | Type | Description |
|---|---|---|
| `template` | string | **Required.** Template name (without `.json`) as listed by `/templates`. |
| `data` | object | Values for the `{{fields}}` in the template. |
| `rows` | array<object> | Batch: one label per row (merged over `data`). Overrides `multiItems`. |
| `copies` | number | Copies per label (default 1). Multiplies rows/quantities. |
| `multiField` + `multiItems` | string + `[{value,qty}]` | Print one label per value × qty (e.g. sizes). |
| `enabledIndices` | number[] | Only render these element indices (others skipped). |
| `darkness` | 0–30 | ZPL print darkness (`~SD`). Optional. |
| `speed` | 1–6 | ZPL print speed (`^PR`). Optional. |
| **Connection** (one of) | | |
| `printer` | string | Windows printer name. |
| `ip` (+ `port`) | string (+ number) | Network printer, default port 9100. |
| `usb` | string | USB device/port (Linux: `/dev/usb/lp0`; Windows: `USB001`). |
| `connection` | object | Alternatively `{ type, printer|ip|usb, port }`. |

If the connection is omitted, the HTTP server / watch folder use the app's saved default connection
(when started from the desktop app) or the `--printer/--ip/--usb` passed to the CLI.

### Responses

```json
{ "ok": true, "count": 3 }
{ "ok": false, "error": "Printer \"Zebra\" not found among installed printers." }
```

---

## Notes

- Output language follows the template's `language` field (ZPL by default; TSPL/EPL/CPCL/EZPL experimental).
- Barcode/QR fields with empty data are skipped (avoids printer jams).
- Layout (positions, alignment, sizes) lives in the template, not in the job: a field aligned
  `center` in the template stays centered whatever value you send (e.g. variable‑length codes).
  See the *Templates* section of the README for `align` / `box_width_mm`.
- For LAN exposure use `--host 0.0.0.0` **with** a `--token`, and restrict access at the firewall level.
