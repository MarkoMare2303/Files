#!/usr/bin/env node
/**
 * Erzeugt die App-Icons der PWA.
 *
 * Warum ein Skript statt Binärdateien im Repository?
 *   • Die Icons sind aus den Design-Tokens abgeleitet — ändert sich die
 *     Markenfarbe, ändern sich die Icons mit einem Befehl mit.
 *   • Ein PNG im Git-Diff ist nicht überprüfbar; dieses Skript ist es.
 *
 * Erzeugt werden:
 *   icon-192.png          Standard-Icon (Android, Browser-Tab)
 *   icon-512.png          Grosses Icon (Splashscreen, Store-Listen)
 *   maskable-512.png      Für adaptive Icons — Motiv innerhalb der Safe Zone
 *   apple-touch-icon.png  180×180, iOS-Home-Bildschirm (kein Alphakanal)
 *   badge-72.png          Monochrome Badge für Android-Benachrichtigungen
 *   favicon-32.png        Klassisches Browser-Icon
 *
 * Aufruf:  node scripts/generate-icons.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

// Aus packages/ui/src/tokens.ts — bewusst dupliziert, damit das Skript ohne
// Build der Workspace-Pakete läuft.
const BRAND = [0x1e, 0x6b, 0xaa];
const BRAND_DARK = [0x0d, 0x2e, 0x4a];
const SIGNAL = [0xff, 0x8a, 0x3d];
const WHITE = [0xff, 0xff, 0xff];

/** Einfache RGBA-Zeichenfläche. */
function createCanvas(size) {
  const data = new Uint8Array(size * size * 4);
  return {
    size,
    data,
    set(x, y, [r, g, b], alpha = 1) {
      if (x < 0 || y < 0 || x >= size || y >= size || alpha <= 0) return;
      const index = (y * size + x) * 4;
      const existingAlpha = data[index + 3] / 255;
      const outAlpha = alpha + existingAlpha * (1 - alpha);
      if (outAlpha === 0) return;
      // Klassisches „source over" — nötig, damit Kantenglättung sauber wirkt.
      data[index] = Math.round((r * alpha + data[index] * existingAlpha * (1 - alpha)) / outAlpha);
      data[index + 1] = Math.round(
        (g * alpha + data[index + 1] * existingAlpha * (1 - alpha)) / outAlpha,
      );
      data[index + 2] = Math.round(
        (b * alpha + data[index + 2] * existingAlpha * (1 - alpha)) / outAlpha,
      );
      data[index + 3] = Math.round(outAlpha * 255);
    },
  };
}

/**
 * Deckungsgrad eines Pixels über 4×4-Überabtastung.
 * Ohne das wirken Rundungen bei 192 px sichtbar treppig.
 */
function coverage(x, y, inside) {
  let hits = 0;
  for (let sy = 0; sy < 4; sy += 1) {
    for (let sx = 0; sx < 4; sx += 1) {
      if (inside(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) hits += 1;
    }
  }
  return hits / 16;
}

function fill(canvas, color, inside) {
  for (let y = 0; y < canvas.size; y += 1) {
    for (let x = 0; x < canvas.size; x += 1) {
      const alpha = coverage(x, y, inside);
      if (alpha > 0) canvas.set(x, y, color, alpha);
    }
  }
}

const roundRect = (x0, y0, x1, y1, radius) => (px, py) => {
  if (px < x0 || px > x1 || py < y0 || py > y1) return false;
  const cx = Math.min(Math.max(px, x0 + radius), x1 - radius);
  const cy = Math.min(Math.max(py, y0 + radius), y1 - radius);
  return (px - cx) ** 2 + (py - cy) ** 2 <= radius ** 2;
};

const circle = (cx, cy, r) => (px, py) => (px - cx) ** 2 + (py - cy) ** 2 <= r * r;

/** PNG-Datei aus RGBA-Daten (RFC 2083, Farbtyp 6, 8 Bit). */
function encodePng(canvas) {
  const { size, data } = canvas;

  // Jede Zeile bekommt ein Filter-Byte; 0 = keine Filterung.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(data.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }

  const chunk = (type, payload) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(payload.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), payload]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // Bittiefe
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // Deflate
  ihdr[11] = 0; // Adaptive Filterung
  ihdr[12] = 0; // Kein Interlacing

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

/**
 * Das Motiv: die Front eines Fahrzeugs, stark abstrahiert — zwei Fenster,
 * ein Lichtband, darunter der Signalpunkt der Melden-Aktion.
 *
 * `inset` steuert, wie viel Rand bleibt: maskierbare Icons brauchen mehr,
 * weil Android bis zu 10 % ringsum wegschneidet.
 */
function drawMark(canvas, { inset, rounded }) {
  const s = canvas.size;
  const u = s / 512; // Alle Masse sind für 512 px notiert.

  // Hintergrund
  if (rounded) {
    fill(canvas, BRAND, roundRect(0, 0, s, s, 96 * u));
  } else {
    fill(canvas, BRAND, () => true);
  }

  const scale = 1 - inset;
  const cx = s / 2;
  const cy = s / 2;
  const at = (value) => cy + (value - 256) * scale * u;
  const ax = (value) => cx + (value - 256) * scale * u;

  // Wagenkasten
  fill(canvas, WHITE, roundRect(ax(160), at(112), ax(352), at(376), 44 * scale * u));

  // Fensterband
  fill(canvas, BRAND_DARK, roundRect(ax(184), at(146), ax(328), at(232), 22 * scale * u));

  // Trennsteg zwischen den beiden Fenstern
  fill(canvas, WHITE, roundRect(ax(250), at(146), ax(262), at(232), 2 * scale * u));

  // Scheinwerfer
  fill(canvas, BRAND_DARK, circle(ax(198), at(300), 15 * scale * u));
  fill(canvas, BRAND_DARK, circle(ax(314), at(300), 15 * scale * u));

  // Signalpunkt — dieselbe Farbe wie die Melden-Aktion in der App.
  fill(canvas, SIGNAL, circle(ax(256), at(408), 30 * scale * u));
}

/** Monochromes Badge: Android färbt es selbst ein, es zählt nur die Silhouette. */
function drawBadge(canvas) {
  const s = canvas.size;
  const u = s / 72;
  fill(canvas, WHITE, roundRect(18 * u, 12 * u, 54 * u, 52 * u, 10 * u));
  fill(canvas, [0, 0, 0], roundRect(24 * u, 18 * u, 48 * u, 32 * u, 5 * u));
  fill(canvas, WHITE, circle(36 * u, 60 * u, 6 * u));
}

function write(name, canvas) {
  const file = resolve(OUT_DIR, name);
  writeFileSync(file, encodePng(canvas));
  console.log(`✓ ${name} (${canvas.size}×${canvas.size})`);
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  for (const size of [192, 512]) {
    const canvas = createCanvas(size);
    drawMark(canvas, { inset: 0.06, rounded: true });
    write(`icon-${size}.png`, canvas);
  }

  // Maskierbar: das Motiv bleibt innerhalb des sicheren Kreises (80 %).
  const maskable = createCanvas(512);
  drawMark(maskable, { inset: 0.22, rounded: false });
  write('maskable-512.png', maskable);

  // iOS schneidet die Ecken selbst ab und mag keinen Alphakanal am Rand.
  const apple = createCanvas(180);
  drawMark(apple, { inset: 0.1, rounded: false });
  write('apple-touch-icon.png', apple);

  const favicon = createCanvas(32);
  drawMark(favicon, { inset: 0.04, rounded: true });
  write('favicon-32.png', favicon);

  const badge = createCanvas(72);
  drawBadge(badge);
  write('badge-72.png', badge);
}

main();
