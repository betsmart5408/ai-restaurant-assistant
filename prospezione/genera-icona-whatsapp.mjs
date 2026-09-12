/**
 * Genera un'icona PNG quadrata di LingoFork (sfondo corallo + forchetta
 * bianca) da mandare come immagine nei messaggi WhatsApp del bot vendite.
 * WhatsApp non mostra le SVG in anteprima, quindi serve un vero PNG.
 * Zero dipendenze: incapsula un piccolo encoder PNG (solo rettangoli pieni,
 * niente bisogno di antialiasing a questa dimensione).
 *
 *   node prospezione/genera-icona-whatsapp.mjs
 *
 * Scrive apps/landing/wa-icon.png (pubblicata su https://lingofork.com/wa-icon.png).
 */
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';

const QUI = dirname(fileURLToPath(import.meta.url));
const OUT = join(QUI, '..', 'apps', 'landing', 'wa-icon.png');
let TABELLA_CRC = null; // riempita al primo uso da crc32()

const N = 512; // lato in pixel
const CORALLO = [255, 77, 94];
const BIANCO = [255, 255, 255];

// Canvas RGB pieno di corallo
const px = new Uint8Array(N * N * 3);
for (let i = 0; i < N * N; i++) {
  px[i * 3] = CORALLO[0]; px[i * 3 + 1] = CORALLO[1]; px[i * 3 + 2] = CORALLO[2];
}

function fillRect(x0, y0, x1, y1, [r, g, b]) {
  for (let y = Math.max(0, y0); y < Math.min(N, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(N, x1); x++) {
      const i = (y * N + x) * 3;
      px[i] = r; px[i + 1] = g; px[i + 2] = b;
    }
  }
}

// Forchetta bianca, stilizzata a blocchi (3 rebbi + ponte + manico)
const cx = N / 2;
fillRect(cx - 100, 108, cx - 60, 260, BIANCO);
fillRect(cx - 20, 108, cx + 20, 260, BIANCO);
fillRect(cx + 60, 108, cx + 100, 260, BIANCO);
fillRect(cx - 100, 260, cx + 100, 300, BIANCO);
fillRect(cx - 44, 300, cx + 44, 428, BIANCO);

writeFileSync(OUT, encodePng(N, N, px));
console.log(`Scritto ${OUT} (${N}x${N})`);

// ── Encoder PNG minimale (RGB 8 bit, senza filtro per riga) ─────────────────
function encodePng(w, h, rgb) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = chunk('IHDR', (() => {
    const b = Buffer.alloc(13);
    b.writeUInt32BE(w, 0); b.writeUInt32BE(h, 4);
    b[8] = 8; b[9] = 2; b[10] = 0; b[11] = 0; b[12] = 0; // bit depth 8, color type 2 = RGB
    return b;
  })());
  const rgbBuf = Buffer.from(rgb);
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0; // filtro "none"
    rgbBuf.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, y * w * 3 + w * 3);
  }
  const idat = chunk('IDAT', zlib.deflateSync(raw, { level: 9 }));
  const iend = chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function crc32(buf) {
  if (!TABELLA_CRC) {
    TABELLA_CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      TABELLA_CRC[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABELLA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
