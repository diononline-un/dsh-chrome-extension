/**
 * The UDS bridge: owns the listening socket, tracks the single extension
 * connection, and correlates tool_request -> tool_result round trips.
 */
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  FrameDecoder,
  encodeFrame,
  bridgeSocketPath,
  configPath,
  PROTOCOL_VERSION,
  MCP_SERVER_VERSION,
  type ToolName,
  type ToolResultContent,
  type ExtensionToServer,
} from "@dsh-browser/protocol/node";

export interface BridgeState {
  connected: boolean;
  browser: string;
  tabGroupId: number | null;
}

interface Pending {
  resolve: (content: ToolResultContent[]) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class Bridge {
  private server: net.Server | null = null;
  private conn: net.Socket | null = null;
  private decoder = new FrameDecoder();
  private readonly pending = new Map<string, Pending>();
  private token: string | undefined;
  readonly socketPath = bridgeSocketPath();

  state: BridgeState = { connected: false, browser: "", tabGroupId: null };
  onStateChange: (s: BridgeState) => void = () => {};

  async start(): Promise<void> {
    this.token = readToken();
    const dir = path.dirname(this.socketPath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      fs.rmSync(this.socketPath, { force: true });
    } catch {
      /* ignore */
    }

    await new Promise<void>((resolve, reject) => {
      const srv = net.createServer((sock) => this.handleConnection(sock));
      srv.on("error", reject);
      srv.listen(this.socketPath, () => {
        fs.chmodSync(this.socketPath, 0o600);
        resolve();
      });
      this.server = srv;
    });
  }

  private handleConnection(sock: net.Socket): void {
    // Single-connection model: a new extension replaces the old one.
    if (this.conn) {
      this.conn.destroy();
    }
    this.conn = sock;
    this.decoder = new FrameDecoder();

    sock.on("data", (chunk: Buffer) => {
      let msgs: unknown[];
      try {
        msgs = this.decoder.push(chunk);
      } catch (err) {
        this.logStderr(`decode error: ${String(err)}`);
        sock.destroy();
        return;
      }
      for (const msg of msgs) this.handleMessage(msg as ExtensionToServer);
    });

    const drop = () => {
      if (this.conn !== sock) return;
      this.conn = null;
      this.setState({ connected: false, browser: "", tabGroupId: null });
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error("browser disconnected"));
      }
      this.pending.clear();
    };
    sock.on("close", drop);
    sock.on("error", () => {});
  }

  private handleMessage(msg: ExtensionToServer): void {
    if ((msg as { type?: string }).type === "ping") {
      this.send({ type: "pong", id: (msg as { id?: string }).id ?? "" });
      return;
    }
    switch (msg.type) {
      case "hello": {
        const accepted = !this.token || this.token === msg.token;
        this.send({
          type: "welcome",
          protocolVersion: PROTOCOL_VERSION,
          serverVersion: MCP_SERVER_VERSION,
          accepted,
          reason: accepted ? undefined : "pairing token mismatch",
        });
        if (!accepted) {
          this.logStderr("rejected extension: token mismatch");
          this.conn?.destroy();
          return;
        }
        this.setState({
          connected: true,
          browser: msg.browser || "browser",
          tabGroupId: this.state.tabGroupId,
        });
        break;
      }
      case "status": {
        this.setState({
          connected: msg.connected,
          browser: msg.browser || this.state.browser,
          tabGroupId: msg.tabGroupId,
        });
        break;
      }
      case "pong":
        break;
      case "tool_result": {
        const p = this.pending.get(msg.tool_use_id);
        if (!p) return;
        this.pending.delete(msg.tool_use_id);
        clearTimeout(p.timer);
        if (msg.error) {
          const text = renderContent(msg.error.content);
          p.reject(new Error(text || "tool failed"));
        } else {
          p.resolve(msg.result?.content ?? []);
        }
        break;
      }
    }
  }

  private setState(s: BridgeState): void {
    this.state = s;
    this.onStateChange(s);
  }

  private send(msg: unknown): void {
    this.conn?.write(encodeFrame(msg));
  }

  private logStderr(line: string): void {
    process.stderr.write(`[dsh-browser-mcp] ${line}\n`);
  }

  get connected(): boolean {
    return this.state.connected && this.conn !== null;
  }

  /** Send one tool to the extension and await its result content. */
  callTool(
    tool: ToolName,
    args: Record<string, unknown>,
    timeoutMs = 120_000,
  ): Promise<ToolResultContent[]> {
    if (!this.connected) {
      return Promise.reject(
        new Error(
          "No browser connected. Open Brave, make sure the DSH Browser extension is enabled, " +
            "and click Connect in its side panel.",
        ),
      );
    }
    const id = randomUUID();
    return new Promise<ToolResultContent[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`tool "${tool}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({
        type: "tool_request",
        method: "execute_tool",
        params: { tool_use_id: id, tool, args },
      });
    });
  }

  async stop(): Promise<void> {
    this.conn?.destroy();
    await new Promise<void>((r) => this.server?.close(() => r()));
    try {
      fs.rmSync(this.socketPath, { force: true });
    } catch {
      /* ignore */
    }
  }
}

export function renderContent(content: ToolResultContent[]): string {
  return content
    .filter((c): c is Extract<ToolResultContent, { type: "text" }> => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

function readToken(): string | undefined {
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw) as { token?: unknown };
    return typeof parsed.token === "string" && parsed.token.length > 0
      ? parsed.token
      : undefined;
  } catch {
    return undefined;
  }
}
