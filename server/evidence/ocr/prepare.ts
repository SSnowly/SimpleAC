import { deflateSync, inflateSync } from 'node:zlib';
import { decode as decodeJpeg } from 'jpeg-js';

export interface PreparedImage {
  bytes: Buffer;
  /** Factor from the prepared image back to the original (original width / prepared width). */
  scale: number;
}

interface Gray {
  width: number;
  height: number;
  pixels: Uint8Array;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_PIXELS = 16384 * 16384;

const luma = (red: number, green: number, blue: number): number =>
  (red * 299 + green * 587 + blue * 114) / 1000;

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceUp = Math.abs(estimate - up);
  const distanceUpLeft = Math.abs(estimate - upLeft);
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) return left;
  return distanceUp <= distanceUpLeft ? up : upLeft;
}

/** Decodes 8-bit, non-interlaced grayscale/RGB/RGBA PNGs, which is what a canvas produces. */
function decodePng(buffer: Buffer): Gray | null {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const chunks: Buffer[] = [];
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) return null;
      colorType = data[9] ?? -1;
    } else if (type === 'IDAT') {
      chunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  if (!channels || width <= 0 || height <= 0 || width * height > MAX_PIXELS) return null;

  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return null;

  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const source = y * (stride + 1) + 1;
    const target = y * stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[source + x] ?? 0;
      const left = x >= channels ? (rows[target + x - channels] ?? 0) : 0;
      const up = y > 0 ? (rows[target - stride + x] ?? 0) : 0;
      const upLeft = y > 0 && x >= channels ? (rows[target - stride + x - channels] ?? 0) : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) predicted = paeth(left, up, upLeft);
      else if (filter !== 0) return null;
      rows[target + x] = (value + predicted) & 0xff;
    }
  }

  const pixels = new Uint8Array(width * height);
  for (let index = 0; index < pixels.length; index++) {
    const at = index * channels;
    pixels[index] =
      channels < 3 ? (rows[at] ?? 0) : luma(rows[at] ?? 0, rows[at + 1] ?? 0, rows[at + 2] ?? 0);
  }
  return { width, height, pixels };
}

function decodeJpegGray(buffer: Buffer): Gray | null {
  const image = decodeJpeg(buffer, {
    useTArray: true,
    formatAsRGBA: true,
    maxMemoryUsageInMB: 512,
  });
  if (image.width * image.height > MAX_PIXELS) return null;
  const pixels = new Uint8Array(image.width * image.height);
  for (let index = 0; index < pixels.length; index++) {
    const at = index * 4;
    pixels[index] = luma(image.data[at] ?? 0, image.data[at + 1] ?? 0, image.data[at + 2] ?? 0);
  }
  return { width: image.width, height: image.height, pixels };
}

/** Area-average downscale: keeps thin strokes readable, unlike dropping pixels. */
function downscale(image: Gray, width: number): Gray {
  const height = Math.max(1, Math.round((image.height * width) / image.width));
  const ratioX = image.width / width;
  const ratioY = image.height / height;
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * ratioY);
    const y1 = Math.max(y0 + 1, Math.min(image.height, Math.floor((y + 1) * ratioY)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * ratioX);
      const x1 = Math.max(x0 + 1, Math.min(image.width, Math.floor((x + 1) * ratioX)));
      let sum = 0;
      for (let sy = y0; sy < y1; sy++) {
        const row = sy * image.width;
        for (let sx = x0; sx < x1; sx++) sum += image.pixels[row + sx] ?? 0;
      }
      pixels[y * width + x] = Math.round(sum / ((y1 - y0) * (x1 - x0)));
    }
  }
  return { width, height, pixels };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

function encodeGrayPng(image: Gray): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = 0;
  const raw = Buffer.alloc((image.width + 1) * image.height);
  for (let y = 0; y < image.height; y++) {
    raw.set(
      image.pixels.subarray(y * image.width, (y + 1) * image.width),
      y * (image.width + 1) + 1,
    );
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 1 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Grayscale copy of a screenshot no wider than `maxWidth`, which is what the OCR engine reads. The original is never
 * touched. Anything this cannot decode (or a screenshot already small enough) comes back unchanged with scale 1.
 */
export function prepareForOcr(bytes: Buffer, maxWidth: number): PreparedImage {
  const unchanged = { bytes, scale: 1 };
  if (maxWidth <= 0) return unchanged;
  try {
    const decoded =
      bytes[0] === 0xff && bytes[1] === 0xd8 ? decodeJpegGray(bytes) : decodePng(bytes);
    if (!decoded || decoded.width <= maxWidth) return unchanged;
    const scaled = downscale(decoded, maxWidth);
    return { bytes: encodeGrayPng(scaled), scale: decoded.width / scaled.width };
  } catch {
    return unchanged;
  }
}
