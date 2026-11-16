import { fail } from "./http";

export function imageType(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 137 && String.fromCharCode(...bytes.slice(1, 8)) === 'PNG\r\n\x1a\n') return 'image/png';
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  fail(415, '사진 형식을 읽을 수 없습니다. JPG, PNG 또는 WebP를 선택해 주세요.');
}

function u16be(bytes: Uint8Array, offset: number) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function u24le(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function u32be(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false);
}

export function imageDimensions(buffer: ArrayBuffer, type: string) {
  const bytes = new Uint8Array(buffer);
  if (type === "image/png" && bytes.length >= 24 && String.fromCharCode(...bytes.slice(1, 4)) === "PNG") {
    return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
  }
  if (type === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      if (marker >= 0xc0 && marker <= 0xc3) return { height: u16be(bytes, offset + 5), width: u16be(bytes, offset + 7) };
      const length = u16be(bytes, offset + 2);
      if (length < 2) break;
      offset += 2 + length;
    }
  }
  if (type === "image/webp" && bytes.length >= 30 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") {
    const kind = new TextDecoder().decode(bytes.slice(12, 16));
    if (kind === "VP8X") return { width: 1 + u24le(bytes, 24), height: 1 + u24le(bytes, 27) };
    if (kind === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return { width: (bytes[26] | bytes[27] << 8) & 0x3fff, height: (bytes[28] | bytes[29] << 8) & 0x3fff };
    if (kind === 'VP8L' && bytes[20] === 0x2f) return { width: 1 + (bytes[21] | (bytes[22] & 63) << 8), height: 1 + ((bytes[22] >> 6) | bytes[23] << 2 | (bytes[24] & 15) << 10) };
  }
  fail(415, "The uploaded file is not a supported panorama image.");
}
