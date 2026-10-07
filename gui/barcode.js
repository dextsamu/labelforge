'use strict';

// Encoder Code 128 (subset B) — genera la sequenza di larghezze di barre/spazi.
// Usato per disegnare un barcode REALE nell'anteprima. La stampa vera resta gestita
// dalla stampante via ZPL; questo serve solo a mostrare fedelmente il codice.
(function () {
  // Pattern canonici Code 128 (indice 0..106). Ogni pattern è la sequenza di
  // larghezze barra/spazio (inizia con una barra). I pattern dati sommano 11, lo stop 13.
  const PATTERNS = [
    '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
    '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
    '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
    '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
    '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
    '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
    '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
    '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
    '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
    '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
    '114131','311141','411131','211412','211214','211232','2331112'
  ];
  const START_B = 104;
  const STOP = 106;

  // Ritorna un array di larghezze (in moduli) alternate barra/spazio, iniziando con barra.
  function encode128B(text) {
    const s = String(text).replace(/[^\x20-\x7E]/g, ''); // solo ASCII stampabile
    const values = [START_B];
    for (const ch of s) values.push(ch.charCodeAt(0) - 32);
    let sum = START_B;
    for (let i = 1; i < values.length; i++) sum += values[i] * i;
    values.push(sum % 103);
    values.push(STOP);
    const widths = [];
    for (const v of values) for (const d of PATTERNS[v]) widths.push(Number(d));
    return widths; // sequenza: barra, spazio, barra, ... (l'ultima barra dello stop è la barra finale)
  }

  // Genera <rect> SVG per il barcode, a partire da (x,y) in mm, altezza h, e larghezza modulo in mm.
  function code128SVG(text, x, y, h, moduleMm) {
    const widths = encode128B(text);
    let out = '';
    let cursor = x;
    for (let i = 0; i < widths.length; i++) {
      const w = widths[i] * moduleMm;
      if (i % 2 === 0) { // posizioni pari = barra
        out += `<rect x="${cursor.toFixed(3)}" y="${y}" width="${w.toFixed(3)}" height="${h}" fill="#111"/>`;
      }
      cursor += w;
    }
    return { svg: out, width: cursor - x };
  }

  // ---------------- Code 39 ----------------
  // Ogni carattere = 9 elementi (barra/spazio), 3 dei quali "larghi". 'n'=stretto, 'w'=largo.
  const CODE39 = {
    '0':'nnnwwnwnn','1':'wnnwnnnnw','2':'nnwwnnnnw','3':'wnwwnnnnn','4':'nnnwwnnnw',
    '5':'wnnwwnnnn','6':'nnwwwnnnn','7':'nnnwnnwnw','8':'wnnwnnwnn','9':'nnwwnnwnn',
    'A':'wnnnnwnnw','B':'nnwnnwnnw','C':'wnwnnwnnn','D':'nnnnwwnnw','E':'wnnnwwnnn',
    'F':'nnwnwwnnn','G':'nnnnnwwnw','H':'wnnnnwwnn','I':'nnwnnwwnn','J':'nnnnwwwnn',
    'K':'wnnnnnnww','L':'nnwnnnnww','M':'wnwnnnnwn','N':'nnnnwnnww','O':'wnnnwnnwn',
    'P':'nnwnwnnwn','Q':'nnnnnnwww','R':'wnnnnnwwn','S':'nnwnnnwwn','T':'nnnnwnwwn',
    'U':'wwnnnnnnw','V':'nwwnnnnnw','W':'wwwnnnnnn','X':'nwnnwnnnw','Y':'wwnnwnnnn',
    'Z':'nwwnwnnnn','-':'nwnnnnwnw','.':'wwnnnnwnn',' ':'nwwnnnwnn','$':'nwnwnwnnn',
    '/':'nwnwnnnwn','+':'nwnnnwnwn','%':'nnnwnwnwn','*':'nwnnwnwnn'
  };
  function encode39(text) {
    const clean = String(text).toUpperCase().replace(/[^0-9A-Z\-. $\/+%]/g, '');
    const chars = ('*' + clean + '*').split('');
    const widths = [];
    chars.forEach((ch, idx) => {
      const pat = CODE39[ch] || CODE39['*'];
      for (const e of pat) widths.push(e === 'w' ? 3 : 1);
      if (idx < chars.length - 1) widths.push(1); // gap stretto tra i caratteri
    });
    return widths; // alternati barra/spazio a partire da barra
  }
  function code39SVG(text, x, y, h, moduleMm) {
    const widths = encode39(text);
    let out = ''; let cursor = x;
    for (let i = 0; i < widths.length; i++) {
      const w = widths[i] * moduleMm;
      if (i % 2 === 0) out += `<rect x="${cursor.toFixed(3)}" y="${y}" width="${w.toFixed(3)}" height="${h}" fill="#111"/>`;
      cursor += w;
    }
    return { svg: out, width: cursor - x };
  }

  // ---------------- EAN-13 ----------------
  const EAN_L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
  const EAN_G = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
  const EAN_R = ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100'];
  const EAN_PARITY = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];
  function ean13CheckDigit(d12) {
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(d12[i]) * (i % 2 === 0 ? 1 : 3);
    return (10 - (sum % 10)) % 10;
  }
  // Ritorna { bits, digits } oppure null se input non valido.
  function encodeEAN13(text) {
    let d = String(text).replace(/\D/g, '');
    if (d.length === 12) d += String(ean13CheckDigit(d));
    if (d.length !== 13) return null;
    const parity = EAN_PARITY[Number(d[0])];
    let bits = '101';
    for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === 'L' ? EAN_L : EAN_G)[Number(d[i])];
    bits += '01010';
    for (let i = 7; i <= 12; i++) bits += EAN_R[Number(d[i])];
    bits += '101';
    return { bits, digits: d };
  }
  function ean13SVG(text, x, y, h, moduleMm) {
    const enc = encodeEAN13(text);
    if (!enc) return null;
    let out = ''; let i = 0;
    while (i < enc.bits.length) {
      if (enc.bits[i] === '1') {
        let j = i; while (j < enc.bits.length && enc.bits[j] === '1') j++;
        const w = (j - i) * moduleMm;
        out += `<rect x="${(x + i * moduleMm).toFixed(3)}" y="${y}" width="${w.toFixed(3)}" height="${h}" fill="#111"/>`;
        i = j;
      } else i++;
    }
    return { svg: out, width: enc.bits.length * moduleMm, digits: enc.digits };
  }

  // ---------------- Code 93 ----------------
  // 47 simboli + start/stop '*'. Ogni pattern = 6 elementi (barra/spazio) che sommano 9 moduli.
  const C93_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';
  const C93_PAT = {
    '0':'131112','1':'111213','2':'111312','3':'111411','4':'121113','5':'121212','6':'121311',
    '7':'111114','8':'131211','9':'141111','A':'211113','B':'211212','C':'211311','D':'221112',
    'E':'221211','F':'231111','G':'112113','H':'112212','I':'112311','J':'122112','K':'132111',
    'L':'111123','M':'111222','N':'111321','O':'121122','P':'131121','Q':'212112','R':'212211',
    'S':'211122','T':'211221','U':'221121','V':'222111','W':'112122','X':'112221','Y':'122121',
    'Z':'123111','-':'121131','.':'311112',' ':'311211','$':'321111','/':'112131','+':'113121',
    '%':'211131','*':'111141'
  };
  function code93Checks(data) {
    const vals = data.split('').map((c) => C93_CHARS.indexOf(c));
    // C: pesi 1..20 da destra
    let c = 0;
    for (let i = 0; i < vals.length; i++) c += vals[vals.length - 1 - i] * ((i % 20) + 1);
    c %= 47;
    const withC = vals.concat(c);
    let k = 0;
    for (let i = 0; i < withC.length; i++) k += withC[withC.length - 1 - i] * ((i % 15) + 1);
    k %= 47;
    return C93_CHARS[c] + C93_CHARS[k];
  }
  function encode93(text) {
    const clean = String(text).toUpperCase().replace(/[^0-9A-Z\-. $\/+%]/g, '');
    const checks = code93Checks(clean);
    const seq = '*' + clean + checks + '*';
    const widths = [];
    for (const ch of seq) { const p = C93_PAT[ch] || C93_PAT['*']; for (const d of p) widths.push(Number(d)); }
    widths.push(1); // barra di terminazione
    return widths;
  }
  function code93SVG(text, x, y, h, moduleMm) {
    const widths = encode93(text);
    let out = ''; let cursor = x;
    for (let i = 0; i < widths.length; i++) {
      const w = widths[i] * moduleMm;
      if (i % 2 === 0) out += `<rect x="${cursor.toFixed(3)}" y="${y}" width="${w.toFixed(3)}" height="${h}" fill="#111"/>`;
      cursor += w;
    }
    return { svg: out, width: cursor - x };
  }

  // ---------------- Allineamento (centrato/destro) ----------------
  // Calcola la larghezza codificata (in "moduli", non in mm) per i tipi di barcode
  // gestiti qui. Ritorna null se il tipo non è supportato o il testo non è valido
  // (es. EAN-13 con lunghezza errata): in quel caso il chiamante deve usare x_mm invariato.
  function widthModules(type, text) {
    switch (type) {
      case 'barcode128': return encode128B(text).reduce((a, b) => a + b, 0);
      case 'code39': return encode39(text).reduce((a, b) => a + b, 0);
      case 'code93': return encode93(text).reduce((a, b) => a + b, 0);
      case 'ean13': { const e = encodeEAN13(text); return e ? e.bits.length : null; }
      default: return null;
    }
  }

  // Dato un x_mm di partenza (bordo sinistro "naturale"), un modulo in mm e una
  // "box" di riferimento larga box_width_mm che inizia anch'essa a x_mm, ritorna
  // il nuovo x_mm che centra (o allinea a destra) il barcode dentro quella box.
  // Se align è 'left'/assente, o manca box_width_mm, o il tipo non è calcolabile,
  // ritorna x_mm invariato (nessuna sorpresa per template esistenti).
  function alignedX(type, text, xMm, moduleMm, align, boxWidthMm) {
    const x = Number(xMm) || 0;
    if (!align || align === 'left' || !boxWidthMm || !moduleMm) return x;
    const mods = widthModules(type, text);
    if (mods == null) return x;
    const widthMm = mods * moduleMm;
    const slack = Math.max(0, Number(boxWidthMm) - widthMm);
    if (align === 'center') return x + slack / 2;
    if (align === 'right') return x + slack;
    return x;
  }

  const api = { encode128B, code128SVG, encode39, code39SVG, encodeEAN13, ean13SVG, ean13CheckDigit, encode93, code93SVG, widthModules, alignedX, PATTERNS };
  if (typeof window !== 'undefined') window.Barcode = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
