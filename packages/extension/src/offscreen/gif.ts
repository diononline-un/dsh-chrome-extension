/**
 * Minimal GIF89a encoder with LZW compression and a fixed 6x6x6 web-safe
 * palette (216 colours + grays). Good enough for screen-recording UI flows;
 * not a photographic quantiser.
 */

const PALETTE: Array<[number, number, number]> = (() => {
  const p: Array<[number, number, number]> = [];
  const steps = [0, 51, 102, 153, 204, 255];
  for (const r of steps) for (const g of steps) for (const b of steps) p.push([r, g, b]);
  for (let i = 0; i < 40; i++) {
    const v = Math.round((i / 39) * 255);
    p.push([v, v, v]);
  }
  return p; // 256 entries
})();

function nearest(r: number, g: number, b: number): number {
  // web-safe channels quantise independently; grays handled by the 6x6x6 diag too
  const q = (v: number) => Math.round(v / 51);
  const idx = q(r) * 36 + q(g) * 6 + q(b);
  return idx < 216 ? idx : 0;
}

class BitWriter {
  bytes: number[] = [];
  private cur = 0;
  private nbits = 0;
  write(code: number, len: number): void {
    this.cur |= code << this.nbits;
    this.nbits += len;
    while (this.nbits >= 8) {
      this.bytes.push(this.cur & 0xff);
      this.cur >>= 8;
      this.nbits -= 8;
    }
  }
  flush(): void {
    if (this.nbits > 0) {
      this.bytes.push(this.cur & 0xff);
      this.cur = 0;
      this.nbits = 0;
    }
  }
}

function lzwEncode(indices: Uint8Array, minCodeSize: number): number[] {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let dict = new Map<string, number>();
  const reset = () => {
    dict = new Map();
    for (let i = 0; i < clearCode; i++) dict.set(String(i), i);
  };
  reset();
  let next = eoiCode + 1;
  const bw = new BitWriter();
  bw.write(clearCode, codeSize);

  let prefix = String(indices[0]);
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i]!;
    const combined = prefix + "," + k;
    if (dict.has(combined)) {
      prefix = combined;
    } else {
      bw.write(dict.get(prefix)!, codeSize);
      dict.set(combined, next++);
      if (next === (1 << codeSize) + 1 && codeSize < 12) codeSize++;
      if (next > 4095) {
        bw.write(clearCode, codeSize);
        reset();
        next = eoiCode + 1;
        codeSize = minCodeSize + 1;
      }
      prefix = String(k);
    }
  }
  bw.write(dict.get(prefix)!, codeSize);
  bw.write(eoiCode, codeSize);
  bw.flush();
  return bw.bytes;
}

export interface GifFrame {
  data: Uint8ClampedArray; // RGBA
  width: number;
  height: number;
  delayMs: number;
}

export function encodeGif(frames: GifFrame[]): Uint8Array {
  if (frames.length === 0) throw new Error("no frames");
  const { width, height } = frames[0]!;
  const out: number[] = [];
  const push = (...b: number[]) => out.push(...b);
  const pushStr = (s: string) => {
    for (const c of s) out.push(c.charCodeAt(0));
  };
  const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];

  pushStr("GIF89a");
  push(...u16(width), ...u16(height));
  push(0xf7, 0, 0); // global color table, 256 entries
  for (const [r, g, b] of PALETTE) push(r, g, b);

  // NETSCAPE loop
  push(0x21, 0xff, 0x0b);
  pushStr("NETSCAPE2.0");
  push(0x03, 0x01, 0, 0, 0x00);

  for (const frame of frames) {
    const px = frame.width * frame.height;
    const indices = new Uint8Array(px);
    for (let i = 0; i < px; i++) {
      indices[i] = nearest(
        frame.data[i * 4]!,
        frame.data[i * 4 + 1]!,
        frame.data[i * 4 + 2]!,
      );
    }
    const delayCs = Math.max(2, Math.round(frame.delayMs / 10));
    push(0x21, 0xf9, 0x04, 0x00, ...u16(delayCs), 0x00, 0x00); // GCE

    push(0x2c, ...u16(0), ...u16(0), ...u16(frame.width), ...u16(frame.height), 0x00);
    const minCodeSize = 8;
    push(minCodeSize);
    const bytes = lzwEncode(indices, minCodeSize);
    for (let i = 0; i < bytes.length; i += 255) {
      const chunk = bytes.slice(i, i + 255);
      push(chunk.length, ...chunk);
    }
    push(0x00);
  }

  push(0x3b);
  return Uint8Array.from(out);
}
