/**
 * Per-origin gate. Every tool that touches page content or navigation is
 * checked against the allowlist / mode / global pause switch first.
 */
import { getSettings, setSettings } from "./state.js";

export class PermissionError extends Error {
  constructor(origin: string) {
    super(
      `Automation is not allowed on ${origin}. ` +
        `Approve it in the DSH Browser side panel (or set the mode to allow-all).`,
    );
    this.name = "PermissionError";
  }
}

function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol === "chrome:" || u.protocol === "chrome-extension:" || u.protocol === "about:") {
      return null;
    }
    return u.origin;
  } catch {
    return null;
  }
}

const pendingPrompts = new Map<string, Promise<boolean>>();

export async function ensureAllowed(url: string): Promise<void> {
  const settings = await getSettings();
  if (settings.paused) {
    throw new Error("DSH Browser automation is paused (toggle it in the side panel).");
  }

  const origin = originOf(url);

  // Blocklist always wins, regardless of mode.
  if (origin != null && matchesList(origin, settings.blocklist)) {
    throw new Error(`Automation is blocked on ${origin} (remove it from the block list to allow).`);
  }

  if (settings.mode === "allow-all") return;

  if (origin == null) {
    // internal pages: allow blank/new-tab, block the rest
    if (url === "about:blank" || url === "" || url.startsWith("about:blank")) return;
    throw new Error(`Cannot automate the browser-internal page ${url}.`);
  }

  if (matchesList(origin, settings.allowlist)) return;

  if (settings.mode === "ask") {
    const granted = await promptForOrigin(origin);
    if (granted) return;
  }
  throw new PermissionError(origin);
}

/** Exact origin match, or a `*.` / bare-host suffix entry (e.g. "github.com"). */
function matchesList(origin: string, list: string[]): boolean {
  if (list.includes(origin)) return true;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  return list.some((entry) => {
    const e = entry.replace(/^\*\./, "").replace(/^https?:\/\//, "");
    return host === e || host.endsWith("." + e);
  });
}

async function promptForOrigin(origin: string): Promise<boolean> {
  const existing = pendingPrompts.get(origin);
  if (existing) return existing;

  const p = (async () => {
    const notifId = `dsh-perm-${origin}-${Date.now()}`;
    await chrome.notifications.create(notifId, {
      type: "basic",
      iconUrl: "icons/icon-128.png",
      title: "DSH Browser",
      message: `Allow dsh to automate ${origin}?`,
      buttons: [{ title: "Allow" }, { title: "Deny" }],
      requireInteraction: true,
    });

    return new Promise<boolean>((resolve) => {
      const onButton = (id: string, btnIdx: number) => {
        if (id !== notifId) return;
        cleanup();
        void chrome.notifications.clear(id);
        if (btnIdx === 0) {
          void addToAllowlist(origin);
          resolve(true);
        } else {
          resolve(false);
        }
      };
      const onClosed = (id: string) => {
        if (id !== notifId) return;
        cleanup();
        resolve(false);
      };
      const onMsg = (m: any) => {
        if (m?.kind === "dsh-perm-response" && m.origin === origin) {
          cleanup();
          if (m.allow) void addToAllowlist(origin);
          resolve(Boolean(m.allow));
        }
      };
      function cleanup() {
        chrome.notifications.onButtonClicked.removeListener(onButton);
        chrome.notifications.onClosed.removeListener(onClosed);
        chrome.runtime.onMessage.removeListener(onMsg);
      }
      chrome.notifications.onButtonClicked.addListener(onButton);
      chrome.notifications.onClosed.addListener(onClosed);
      chrome.runtime.onMessage.addListener(onMsg);
      setTimeout(() => {
        cleanup();
        resolve(false);
      }, 120_000);
    });
  })();

  pendingPrompts.set(origin, p);
  void p.finally(() => pendingPrompts.delete(origin));
  return p;
}

export async function addToAllowlist(origin: string): Promise<void> {
  const s = await getSettings();
  if (!s.allowlist.includes(origin)) {
    await setSettings({ allowlist: [...s.allowlist, origin] });
  }
}

export async function removeFromAllowlist(origin: string): Promise<void> {
  const s = await getSettings();
  await setSettings({ allowlist: s.allowlist.filter((o) => o !== origin) });
}

export async function addToBlocklist(origin: string): Promise<void> {
  const s = await getSettings();
  if (!s.blocklist.includes(origin)) {
    await setSettings({ blocklist: [...s.blocklist, origin] });
  }
}

export async function removeFromBlocklist(origin: string): Promise<void> {
  const s = await getSettings();
  await setSettings({ blocklist: s.blocklist.filter((o) => o !== origin) });
}
