/** GIF recording: offscreen-document lifecycle + frame capture orchestration. */
import { text, image, json, type ToolContent } from "../common/messages.js";
import { captureScreenshot } from "./screenshot.js";

let recording = false;
let offscreenReady = false;

async function ensureOffscreen(): Promise<void> {
  if (offscreenReady) return;
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (existing.length === 0) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.BLOBS],
      justification: "Encode screen-recording frames into a GIF.",
    });
  }
  offscreenReady = true;
}

async function offscreen(op: string, payload?: Record<string, unknown>): Promise<any> {
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({ kind: "dsh-offscreen", op, payload });
  if (!res?.ok) throw new Error(res?.error ?? `${op} failed`);
  return res.data;
}

export function gifActive(): boolean {
  return recording;
}

/** Capture one frame from the given tab into the active recording. */
export async function gifCapture(tabId: number): Promise<void> {
  if (!recording) return;
  try {
    const b64 = await captureScreenshot(tabId);
    await offscreen("gif-frame", { dataUrl: `data:image/png;base64,${b64}` });
  } catch {
    /* dropped frame — non-fatal */
  }
}

export async function gifOp(
  args: Record<string, any>,
  resolveTab: () => Promise<number>,
): Promise<ToolContent> {
  const cmd = args.command as string;
  switch (cmd) {
    case "start": {
      const data = await offscreen("gif-start", { fps: args.fps ?? 5, maxSeconds: args.maxSeconds ?? 30 });
      recording = true;
      await gifCapture(await resolveTab());
      return text(`recording started (${data.fps} fps, up to ${data.maxSeconds}s). Frames are captured after each browser action; call gif_creator export when done.`);
    }
    case "stop": {
      recording = false;
      const data = await offscreen("gif-stop");
      return text(`recording stopped with ${data.frames} frame(s). Call export to get the GIF.`);
    }
    case "status": {
      const data = await offscreen("gif-status");
      return json(data);
    }
    case "export": {
      recording = false;
      const data = await offscreen("gif-export");
      return image(data.base64, "image/gif").concat(
        text(`GIF with ${data.frames} frame(s).`),
      );
    }
    default:
      throw new Error(`unknown gif command "${cmd}"`);
  }
}
