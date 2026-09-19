/**
 * WebSocket bridge to the local tab-archive service (127.0.0.1:2345).
 *
 * Independent from the dsh native-messaging bridge: the service can trigger an
 * archive run over this socket, the extension reports progress back. The
 * keep-alive alarm doubles as the service worker wake-up source.
 */
import { detectBrowser } from "./browser-info.js";
import { archiveAllTabs, type ArchiveSummary } from "./archive.js";
import { logTool } from "./state.js";

const WS_URL = "ws://127.0.0.1:2345/ws";
const BACKOFF_MS = [1000, 2000, 5000, 10000, 20000, 30000];

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let backoffIdx = 0;
let running = false;

function send(msg: unknown): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  const delay = BACKOFF_MS[Math.min(backoffIdx, BACKOFF_MS.length - 1)] ?? 30000;
  backoffIdx += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

async function handleCommand(raw: unknown): Promise<void> {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(String(raw)) as Record<string, unknown>;
  } catch {
    return;
  }
  if (msg.type !== "archive_all_tabs") return;

  const runId = String(msg.run_id ?? "");
  if (running) {
    send({ type: "archive_error", run_id: runId, error: "another archive run is active" });
    return;
  }
  running = true;
  const options = (msg.options ?? {}) as Record<string, unknown>;
  try {
    const summary: ArchiveSummary = await archiveAllTabs(
      {
        ingestUrl: String(msg.ingest_url ?? "http://127.0.0.1:2345/api/ingest"),
        incognitoOnly: options.incognito_only !== false,
        closeAfter: options.close_after !== false,
      },
      (progress) => {
        send({ type: "archive_progress", run_id: runId, ...progress });
      },
    );
    send({ type: "archive_done", run_id: runId, ...summary });
    logTool(
      "archive_all_tabs",
      true,
      `${summary.processed} processed, ${summary.closed} closed, ${summary.failed} failed`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    send({ type: "archive_error", run_id: runId, error: message });
    logTool("archive_all_tabs", false, message);
  } finally {
    running = false;
  }
}

export function connect(): void {
  if (ws) return;
  let socket: WebSocket;
  try {
    socket = new WebSocket(WS_URL);
  } catch {
    scheduleReconnect();
    return;
  }
  ws = socket;

  socket.onopen = () => {
    backoffIdx = 0;
    send({
      type: "hello",
      ext_version: chrome.runtime.getManifest().version,
      browser: detectBrowser(),
    });
  };
  socket.onmessage = (event) => {
    void handleCommand(event.data);
  };
  socket.onclose = () => {
    if (ws === socket) ws = null;
    scheduleReconnect();
  };
  socket.onerror = () => {
    /* onclose follows */
  };
}

export function initTabArchiveBridge(): void {
  chrome.alarms.create("tab-archive-keepalive", { periodInMinutes: 0.4 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== "tab-archive-keepalive") return;
    if (!ws) {
      connect();
    } else if (ws.readyState === WebSocket.OPEN) {
      send({ type: "ping" });
    }
  });
  connect();
}
