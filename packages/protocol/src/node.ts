/** Node-only protocol helpers: native-messaging framing + socket paths. */
import { homedir } from "node:os";
import { join } from "node:path";

export * from "./index.js";

export function encodeFrame(msg: unknown): Uint8Array {
  const json = Buffer.from(JSON.stringify(msg), "utf8");
  const frame = Buffer.allocUnsafe(4 + json.length);
  frame.writeUInt32LE(json.length, 0);
  json.copy(frame, 4);
  return frame;
}

/**
 * Incremental frame decoder. Feed it chunks; it yields whole messages.
 * Bounds the length prefix so a corrupt stream cannot allocate unbounded memory.
 */
export class FrameDecoder {
  private buf: Buffer = Buffer.alloc(0);
  private readonly maxFrame: number;

  constructor(maxFrameBytes = 128 * 1024 * 1024) {
    this.maxFrame = maxFrameBytes;
  }

  push(chunk: Buffer): unknown[] {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
    const out: unknown[] = [];
    while (this.buf.length >= 4) {
      const len = this.buf.readUInt32LE(0);
      if (len > this.maxFrame) {
        throw new Error(`frame length ${len} exceeds max ${this.maxFrame}`);
      }
      if (this.buf.length < 4 + len) break;
      const body = this.buf.subarray(4, 4 + len);
      this.buf = this.buf.subarray(4 + len);
      out.push(JSON.parse(body.toString("utf8")));
    }
    return out;
  }
}

export function bridgeSocketPath(): string {
  const override = process.env.DSH_CHROME_SOCKET;
  if (override) return override;
  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  if (runtimeDir) return join(runtimeDir, "dsh-chrome", "bridge.sock");
  return join(homedir(), ".local", "state", "dsh-chrome", "bridge.sock");
}

export function configPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
  return join(base, "dsh-chrome", "config.json");
}
