#!/usr/bin/env node
/**
 * DSH Browser native-messaging host.
 *
 * The browser spawns this process when the extension calls
 * chrome.runtime.connectNative("com.dsh.browser_bridge"). Its only job is to
 * bridge the browser's native-messaging stdio to the Unix domain socket that
 * the dsh-spawned mcp-server listens on.
 *
 * While the mcp-server is not reachable it answers the extension with a
 * `status: disconnected` frame and keeps retrying. When the socket drops it
 * reports the drop and exits, so the extension's reconnect loop can respawn a
 * fresh host.
 */
import net from "node:net";
import {
  FrameDecoder,
  encodeFrame,
  bridgeSocketPath,
  PROTOCOL_VERSION,
} from "@dsh-browser/protocol/node";

const SOCKET_PATH = bridgeSocketPath();
const RECONNECT_DELAYS_MS = [250, 500, 1000, 2000, 3000, 5000];

function logStderr(...args: unknown[]): void {
  // stdout is the native-messaging channel; diagnostics must go to stderr.
  process.stderr.write(`[dsh-browser-bridge] ${args.join(" ")}\n`);
}

/** Write a framed message to the browser (stdout). */
function toBrowser(msg: unknown): void {
  process.stdout.write(encodeFrame(msg));
}

let socket: net.Socket | null = null;
let socketReady = false;
let reconnectAttempt = 0;
let shuttingDown = false;

/** Frames received from the browser before the socket is ready. */
const pending: unknown[] = [];

const browserDecoder = new FrameDecoder();
const socketDecoder = new FrameDecoder();

function flushPending(): void {
  if (!socket || !socketReady) return;
  while (pending.length > 0) {
    const msg = pending.shift();
    socket.write(encodeFrame(msg));
  }
}

function connect(): void {
  if (shuttingDown) return;
  const s = net.createConnection(SOCKET_PATH);
  socket = s;

  s.on("connect", () => {
    socketReady = true;
    reconnectAttempt = 0;
    logStderr("connected to", SOCKET_PATH);
    flushPending();
  });

  s.on("data", (chunk: Buffer) => {
    let msgs: unknown[];
    try {
      msgs = socketDecoder.push(chunk);
    } catch (err) {
      logStderr("socket decode error:", String(err));
      s.destroy();
      return;
    }
    for (const msg of msgs) toBrowser(msg);
  });

  const onClose = () => {
    if (socket !== s) return;
    socket = null;
    socketReady = false;
    if (shuttingDown) return;
    toBrowser({
      type: "status",
      connected: false,
      tabGroupId: null,
      browser: "",
    });
    if (reconnectAttempt < RECONNECT_DELAYS_MS.length) {
      const delay = RECONNECT_DELAYS_MS[reconnectAttempt] ?? 5000;
      reconnectAttempt += 1;
      setTimeout(connect, delay);
    } else {
      logStderr("giving up on mcp-server; exiting so the extension can respawn");
      process.exit(0);
    }
  };

  s.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code !== "ENOENT" && err.code !== "ECONNREFUSED") {
      logStderr("socket error:", err.message);
    }
  });
  s.on("close", onClose);
}

// --- browser -> host ---
process.stdin.on("data", (chunk: Buffer) => {
  let msgs: unknown[];
  try {
    msgs = browserDecoder.push(chunk);
  } catch (err) {
    logStderr("browser decode error:", String(err));
    shutdown(1);
    return;
  }
  for (const msg of msgs) {
    if (socket && socketReady) {
      socket.write(encodeFrame(msg));
    } else {
      // Answer health probes locally so the extension knows we're alive but waiting.
      const t = (msg as { type?: string }).type;
      if (t === "ping") {
        toBrowser({ type: "pong", id: (msg as { id?: string }).id ?? "" });
      } else {
        pending.push(msg);
        if (pending.length > 64) pending.shift();
        toBrowser({
          type: "status",
          connected: false,
          tabGroupId: null,
          browser: "",
        });
      }
    }
  }
});

process.stdin.on("end", () => shutdown(0));
process.stdin.on("close", () => shutdown(0));

function shutdown(code: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  socket?.destroy();
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

logStderr(`starting, protocol v${PROTOCOL_VERSION}, socket ${SOCKET_PATH}`);
toBrowser({ type: "status", connected: false, tabGroupId: null, browser: "" });
connect();
