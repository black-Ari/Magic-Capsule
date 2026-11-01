'use strict';

// Draws the app icon without any image library: a dark tile with a notch at the top.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;
const OUT = path.join(__dirname, '..', 'assets');

const roundedBox = (x, y, cx, cy, halfW, halfH, radius) => {
  const qx = Math.abs(x - cx) - halfW + radius;
  const qy = Math.abs(y - cy) - halfH + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
};
const coverage = (distance) => Math.max(0, Math.min(1, 0.5 - distance));
const mix = (a, b, t) => a + (b - a) * t;

function pixel(x, y) {
  const tile = coverage(roundedBox(x, y, 128, 128, 120, 120, 54));
  const notch = coverage(roundedBox(x, y, 128, 74, 74, 30, 30));
  const dot = coverage(Math.hypot(x - 174, y - 74) - 11);
  const glow = Math.max(0, 1 - Math.max(0, roundedBox(x, y, 128, 74, 74, 30, 30)) / 46) ** 2 * 0.55;

  const channel = (base, notchColor, dotColor, glowColor) => {
    let value = mix(base, glowColor, glow);
    value = mix(value, notchColor, notch);
    return Math.round(mix(value, dotColor, dot * notch));
  };
  return [channel(16, 8, 142, 142), channel(16, 8, 203, 203), channel(20, 10, 255, 255), Math.round(tile * 255)];
}

function crcTable() {
  return Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
}
const TABLE = crcTable();
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png() {
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    const row = y * (SIZE * 4 + 1);
    for (let x = 0; x < SIZE; x += 1) Buffer.from(pixel(x, y)).copy(raw, row + 1 + x * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8; // 8 bits per channel
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

function ico(image) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(image.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, image]);
}

const image = png();
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'icon.png'), image);
fs.writeFileSync(path.join(OUT, 'icon.ico'), ico(image));
