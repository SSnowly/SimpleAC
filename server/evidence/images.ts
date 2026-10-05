export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface ImageInfo {
  mediaType: ImageMediaType;
  extension: 'jpg' | 'png' | 'webp';
  width: number;
  height: number;
}

const MAX_DIMENSION = 16384;

function valid(width: number, height: number): boolean {
  return width > 0 && height > 0 && width <= MAX_DIMENSION && height <= MAX_DIMENSION;
}

function readJpeg(buffer: Buffer): ImageInfo | null {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    if (marker === undefined) return null;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return valid(width, height)
        ? { mediaType: 'image/jpeg', extension: 'jpg', width, height }
        : null;
    }
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

function readPng(buffer: Buffer): ImageInfo | null {
  if (buffer.length < 24 || buffer.toString('latin1', 12, 16) !== 'IHDR') return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return valid(width, height) ? { mediaType: 'image/png', extension: 'png', width, height } : null;
}

function readWebp(buffer: Buffer): ImageInfo | null {
  if (buffer.length < 30) return null;
  const chunk = buffer.toString('latin1', 12, 16);
  let width = 0;
  let height = 0;
  if (chunk === 'VP8 ') {
    width = buffer.readUInt16LE(26) & 0x3fff;
    height = buffer.readUInt16LE(28) & 0x3fff;
  } else if (chunk === 'VP8L') {
    const bits = buffer.readUInt32LE(21);
    width = (bits & 0x3fff) + 1;
    height = ((bits >> 14) & 0x3fff) + 1;
  } else if (chunk === 'VP8X') {
    width = 1 + (buffer[24] ?? 0) + ((buffer[25] ?? 0) << 8) + ((buffer[26] ?? 0) << 16);
    height = 1 + (buffer[27] ?? 0) + ((buffer[28] ?? 0) << 8) + ((buffer[29] ?? 0) << 16);
  } else {
    return null;
  }
  return valid(width, height)
    ? { mediaType: 'image/webp', extension: 'webp', width, height }
    : null;
}

/** Identifies an upload from its bytes alone; the declared content type is never trusted. */
export function sniffImage(buffer: Buffer): ImageInfo | null {
  if (buffer.length < 16) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return readJpeg(buffer);
  if (buffer.toString('latin1', 1, 4) === 'PNG' && buffer[0] === 0x89) return readPng(buffer);
  if (buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') {
    return readWebp(buffer);
  }
  return null;
}
