/**
 * Manages the long-lived native-messaging connection to `com.dsh.browser_bridge`,
 * which in turn bridges to the dsh-spawned mcp-server over a Unix socket.
 *
 * Chrome frames/deframes native messages for us, so here we deal in plain
 * objects. We keep a supervised reconnect loop and a keep-alive alarm so the
 * MV3 service worker is not torn down mid-session.
 */
import {
  NATIVE_HOST_NAME,
  PROTOCOL_VERSION,
  type ServerToExtension,
  type ExtensionToServer,
} from "@dsh-browser/protocol";
import { getSettings, setBridgeConnected, runtime } from "./state.js";
import { detectBrowser } from "./browser-info.js";

type Handler = (msg: ServerToExtension) => void | Promise<void>;

let port: chrome.runtime.Port | null = null;
let handshakeDone = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let backoffIdx = 0;
const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000];
let onMessage: Handler = () => {};

export function setMessageHandler(fn: Handler): void {
  onMessage = fn;
}

export function send(msg: ExtensionToServer): void {
  port?.postMessage(msg);
}

export function isConnected(): boolean {
  return port !== null && handshakeDone && runtime.bridgeConnected;
}

async function sendHello(): Promise<void> {
  const settings = await getSettings();
  send({
    type: "hello",
    extVersion: chrome.runtime.getManifest().version,
    browser: detectBrowser(),
    token: settings.token || undefined,
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  const delay = BACKOFF_MS[Math.min(backoffIdx, BACKOFF_MS.length - 1)] ?? 15000;
  backoffIdx += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

export function connect(): void {
  if (port) return;
  handshakeDone = false;
  let p: chrome.runtime.Port;
  try {
    p = chrome.runtime.connectNative(NATIVE_HOST_NAME);
  } catch (err) {
    runtime.lastError = `connectNative failed: ${String(err)}`;
    setBridgeConnected(false);
    scheduleReconnect();
    return;
  }
  port = p;

  p.onMessage.addListener((raw: unknown) => {
    const msg = raw as ServerToExtension | { type: "status"; connected: boolean };
    if (msg.type === "welcome") {
      handshakeDone = true;
      backoffIdx = 0;
      if (!msg.accepted) {
        runtime.lastError = `bridge rejected: ${msg.reason ?? "unknown"}`;
        setBridgeConnected(false);
        p.disconnect();
        return;
      }
      if (msg.protocolVersion !== PROTOCOL_VERSION) {
        runtime.lastError = `protocol mismatch: server v${msg.protocolVersion}, extension v${PROTOCOL_VERSION}`;
      }
      runtime.lastError = null;
      setBridgeConnected(true);
      return;
    }
    if ((msg as { type: string }).type === "status") {
      // emitted by the native-host while it cannot reach the mcp-server
      const live = Boolean((msg as { connected: boolean }).connected);
      if (!live) handshakeDone = false;
      setBridgeConnected(live);
      return;
    }
    void onMessage(msg as ServerToExtension);
  });

  p.onDisconnect.addListener(() => {
    // A superseded port (manual reconnect) must not touch the new one's state.
    if (port !== p) return;
    const err = chrome.runtime.lastError?.message;
    port = null;
    handshakeDone = false;
    setBridgeConnected(false);
    if (err && !/Native host has exited/i.test(err)) {
      runtime.lastError = err;
    }
    scheduleReconnect();
  });

  // Kick the handshake; the native-host answers `status` until the socket is up,
  // then relays our hello to the mcp-server which replies `welcome`.
  void sendHello();
}

/**
 * Drop the live native port and open a fresh one. `connect()` returns early
 * while a port exists, so a port whose handshake went stale (native host up,
 * mcp-server side gone) needs this to redo the `hello`/`welcome` exchange.
 */
export function reconnect(): void {
  const stale = port;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  port = null;
  handshakeDone = false;
  backoffIdx = 0;
  try {
    stale?.disconnect();
  } catch {
    /* already gone */
  }
  connect();
}

export function initNativePort(): void {
  chrome.alarms.create("dsh-keepalive", { periodInMinutes: 0.4 });
  chrome.alarms.onAlarm.addListener((a) => {
    if (a.name !== "dsh-keepalive") return;
    if (!port) {
      connect();
    } else if (handshakeDone) {
      send({ type: "pong", id: "keepalive" });
    }
  });
  connect();
}
