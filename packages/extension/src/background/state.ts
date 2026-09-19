/** Cross-module mutable state + storage helpers for the service worker. */

export type PermissionMode = "ask" | "allowlist" | "allow-all";

export interface Settings {
  mode: PermissionMode;
  allowlist: string[]; // origins, e.g. "https://example.com"
  blocklist: string[]; // origins that are always denied, even in allow-all / ask
  paused: boolean;
  token: string; // optional pairing token, "" = none
}

const DEFAULTS: Settings = {
  mode: "allowlist",
  allowlist: [],
  blocklist: [],
  paused: false,
  token: "",
};

export async function getSettings(): Promise<Settings> {
  const raw = await chrome.storage.local.get("settings");
  return {
    ...DEFAULTS,
    ...(raw.settings as Partial<Settings> | undefined),
    // never let a persisted partial drop these to undefined
    allowlist: (raw.settings as Settings | undefined)?.allowlist ?? [],
    blocklist: (raw.settings as Settings | undefined)?.blocklist ?? [],
  };
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export interface RuntimeState {
  bridgeConnected: boolean;
  tabGroupId: number | null;
  lastError: string | null;
  toolLog: Array<{ ts: number; tool: string; ok: boolean; note?: string }>;
}

export const runtime: RuntimeState = {
  bridgeConnected: false,
  tabGroupId: null,
  lastError: null,
  toolLog: [],
};

export function logTool(tool: string, ok: boolean, note?: string): void {
  runtime.toolLog.unshift({ ts: Date.now(), tool, ok, note });
  runtime.toolLog = runtime.toolLog.slice(0, 50);
  void chrome.runtime.sendMessage({ kind: "dsh-state" }).catch(() => {});
}

export function setBridgeConnected(connected: boolean): void {
  runtime.bridgeConnected = connected;
  void chrome.runtime.sendMessage({ kind: "dsh-state" }).catch(() => {});
}
