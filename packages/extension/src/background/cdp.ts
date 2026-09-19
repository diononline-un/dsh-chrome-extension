/**
 * chrome.debugger (Chrome DevTools Protocol) wrapper.
 *
 * Attaches lazily per tab, keeps ring buffers of console + network events so
 * read_console_messages / read_network_requests can answer for activity that
 * happened before the tool was called (as long as automation was attached).
 */

const PROTOCOL_VERSION = "1.3";

export interface ConsoleEntry {
  ts: number;
  level: string;
  text: string;
  url?: string;
  line?: number;
}

export interface NetEntry {
  ts: number;
  requestId: string;
  method: string;
  url: string;
  resourceType: string;
  status?: number;
  statusText?: string;
  mimeType?: string;
  fromCache?: boolean;
  failed?: boolean;
  errorText?: string;
  encodedDataLength?: number;
}

interface TabBuffers {
  console: ConsoleEntry[];
  net: Map<string, NetEntry>;
  netOrder: string[];
}

const attached = new Set<number>();
const buffers = new Map<number, TabBuffers>();
const MAX_CONSOLE = 500;
const MAX_NET = 500;

function buf(tabId: number): TabBuffers {
  let b = buffers.get(tabId);
  if (!b) {
    b = { console: [], net: new Map(), netOrder: [] };
    buffers.set(tabId, b);
  }
  return b;
}

export async function attach(tabId: number): Promise<void> {
  if (attached.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, PROTOCOL_VERSION);
  attached.add(tabId);
  await Promise.all([
    send(tabId, "Page.enable"),
    send(tabId, "Runtime.enable"),
    send(tabId, "Log.enable"),
    send(tabId, "Network.enable"),
    send(tabId, "DOM.enable"),
  ]);
}

export async function detach(tabId: number): Promise<void> {
  if (!attached.has(tabId)) return;
  attached.delete(tabId);
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    /* already gone */
  }
}

export async function detachAll(): Promise<void> {
  await Promise.all([...attached].map((t) => detach(t)));
}

export function isAttached(tabId: number): boolean {
  return attached.has(tabId);
}

export function send<T = unknown>(
  tabId: number,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  return chrome.debugger.sendCommand({ tabId }, method, params) as Promise<T>;
}

export function getConsole(tabId: number): ConsoleEntry[] {
  return buf(tabId).console.slice();
}

export function getNetwork(tabId: number): NetEntry[] {
  const b = buf(tabId);
  return b.netOrder.map((id) => b.net.get(id)).filter((e): e is NetEntry => Boolean(e));
}

export function clearBuffers(tabId: number): void {
  buffers.delete(tabId);
}

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId != null) {
    attached.delete(source.tabId);
  }
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  if (tabId == null) return;
  const p = (params ?? {}) as Record<string, any>;
  const b = buf(tabId);

  switch (method) {
    case "Runtime.consoleAPICalled": {
      const textVal = (p.args ?? [])
        .map((a: any) => (a.value !== undefined ? String(a.value) : a.description ?? a.type))
        .join(" ");
      pushConsole(b, {
        ts: Date.now(),
        level: p.type ?? "log",
        text: textVal,
        url: p.stackTrace?.callFrames?.[0]?.url,
        line: p.stackTrace?.callFrames?.[0]?.lineNumber,
      });
      break;
    }
    case "Runtime.exceptionThrown": {
      const d = p.exceptionDetails ?? {};
      pushConsole(b, {
        ts: Date.now(),
        level: "error",
        text:
          d.exception?.description ??
          d.text ??
          d.exception?.value ??
          "uncaught exception",
        url: d.url,
        line: d.lineNumber,
      });
      break;
    }
    case "Log.entryAdded": {
      const e = p.entry ?? {};
      pushConsole(b, {
        ts: Date.now(),
        level: e.level ?? "log",
        text: e.text ?? "",
        url: e.url,
        line: e.lineNumber,
      });
      break;
    }
    case "Network.requestWillBeSent": {
      const entry: NetEntry = {
        ts: Date.now(),
        requestId: p.requestId,
        method: p.request?.method ?? "GET",
        url: p.request?.url ?? "",
        resourceType: (p.type ?? "Other").toLowerCase(),
      };
      if (!b.net.has(p.requestId)) b.netOrder.push(p.requestId);
      b.net.set(p.requestId, entry);
      while (b.netOrder.length > MAX_NET) {
        const old = b.netOrder.shift();
        if (old) b.net.delete(old);
      }
      break;
    }
    case "Network.responseReceived": {
      const e = b.net.get(p.requestId);
      if (e) {
        e.status = p.response?.status;
        e.statusText = p.response?.statusText;
        e.mimeType = p.response?.mimeType;
        e.resourceType = (p.type ?? e.resourceType).toLowerCase();
      }
      break;
    }
    case "Network.loadingFinished": {
      const e = b.net.get(p.requestId);
      if (e) e.encodedDataLength = p.encodedDataLength;
      break;
    }
    case "Network.loadingFailed": {
      const e = b.net.get(p.requestId);
      if (e) {
        e.failed = true;
        e.errorText = p.errorText;
      }
      break;
    }
  }
});

function pushConsole(b: TabBuffers, entry: ConsoleEntry): void {
  b.console.push(entry);
  while (b.console.length > MAX_CONSOLE) b.console.shift();
}
