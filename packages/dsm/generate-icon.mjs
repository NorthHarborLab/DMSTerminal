import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const size = Number(process.argv[2]);
const output = process.argv[3];
if (!Number.isInteger(size) || size < 16 || !output) {
  throw new Error("Usage: node generate-icon.mjs <size> <output.png>");
}

const pixels = Buffer.alloc(size * size * 4);
const samples = 4;

function roundedRect(x, y, inset, radius) {
  const left = inset;
  const top = inset;
  const right = size - inset;
  const bottom = size - inset;
  const nearestX = Math.max(left + radius, Math.min(x, right - radius));
  const nearestY = Math.max(top + radius, Math.min(y, bottom - radius));
  return x >= left && x <= right && y >= top && y <= bottom && Math.hypot(x - nearestX, y - nearestY) <= radius;
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    let red = 0;
    let green = 0;
    let blue = 0;
    let alpha = 0;
    for (let sy = 0; sy < samples; sy += 1) {
      for (let sx = 0; sx < samples; sx += 1) {
        const px = x + (sx + 0.5) / samples;
        const py = y + (sy + 0.5) / samples;
        const inside = roundedRect(px, py, size * 0.04, size * 0.2);
        if (!inside) continue;

        const border = !roundedRect(px, py, size * 0.075, size * 0.175);
        let color = border ? [49, 117, 82] : [10, 22, 16];
        const stroke = size * 0.065;
        const chevron = Math.min(
          distanceToSegment(px, py, size * 0.27, size * 0.31, size * 0.48, size * 0.5),
          distanceToSegment(px, py, size * 0.48, size * 0.5, size * 0.27, size * 0.69)
        );
        const underscore = distanceToSegment(px, py, size * 0.53, size * 0.7, size * 0.76, size * 0.7);
        if (chevron <= stroke) color = [86, 239, 154];
        if (underscore <= stroke) color = [231, 255, 242];
        red += color[0];
        green += color[1];
        blue += color[2];
        alpha += 255;
      }
    }
    const count = samples * samples;
    const offset = (y * size + x) * 4;
    pixels[offset] = Math.round(red / count);
    pixels[offset + 1] = Math.round(green / count);
    pixels[offset + 2] = Math.round(blue / count);
    pixels[offset + 3] = Math.round(alpha / count);
  }
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0);
header.writeUInt32BE(size, 4);
header[8] = 8;
header[9] = 6;

const scanlines = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y += 1) {
  const rowOffset = y * (size * 4 + 1);
  scanlines[rowOffset] = 0;
  pixels.copy(scanlines, rowOffset + 1, y * size * 4, (y + 1) * size * 4);
}

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
writeFileSync(output, Buffer.concat([
  signature,
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(scanlines, { level: 9 })),
  chunk("IEND", Buffer.alloc(0))
]));
