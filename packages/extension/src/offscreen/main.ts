/**
 * Offscreen document: accumulates screenshot frames pushed by the service
 * worker and encodes them to a GIF on demand. (An offscreen document gets a
 * DOM + canvas, which the SW does not.)
 */
import { encodeGif, type GifFrame } from "./gif.js";

interface Session {
  frames: GifFrame[];
  fps: number;
  startedAt: number;
  maxFrames: number;
}

let session: Session | null = null;

async function dataUrlToFrame(dataUrl: string, delayMs: number): Promise<GifFrame> {
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, 800 / bmp.width);
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  return { data: img.data, width: w, height: h, delayMs };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.kind !== "dsh-offscreen") return;
  (async () => {
    switch (msg.op) {
      case "gif-start": {
        const fps = msg.payload?.fps ?? 5;
        const maxSeconds = msg.payload?.maxSeconds ?? 30;
        session = { frames: [], fps, startedAt: Date.now(), maxFrames: fps * maxSeconds };
        return { ok: true, data: { fps, maxSeconds } };
      }
      case "gif-frame": {
        if (!session) return { ok: false, error: "no active recording" };
        if (session.frames.length >= session.maxFrames) return { ok: true, data: { dropped: true } };
        const frame = await dataUrlToFrame(msg.payload.dataUrl, Math.round(1000 / session.fps));
        session.frames.push(frame);
        return { ok: true, data: { frames: session.frames.length } };
      }
      case "gif-status": {
        return {
          ok: true,
          data: session
            ? { recording: true, frames: session.frames.length, seconds: (Date.now() - session.startedAt) / 1000 }
            : { recording: false },
        };
      }
      case "gif-stop": {
        return { ok: true, data: { frames: session?.frames.length ?? 0 } };
      }
      case "gif-export": {
        if (!session || session.frames.length === 0) return { ok: false, error: "no frames recorded" };
        const bytes = encodeGif(session.frames);
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) {
          bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        const b64 = btoa(bin);
        const frames = session.frames.length;
        session = null;
        return { ok: true, data: { base64: b64, frames, mimeType: "image/gif" } };
      }
      default:
        return { ok: false, error: `unknown op ${msg.op}` };
    }
  })().then(sendResponse, (err) => sendResponse({ ok: false, error: String(err) }));
  return true;
});
