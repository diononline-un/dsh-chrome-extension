/** Service worker entry point. */
import type { ServerToExtension, ToolResultMessage } from "@dsh-browser/protocol";
import { initNativePort, setMessageHandler, send } from "./native-port.js";
import { runTool } from "./handlers.js";
import { runtime, getSettings, setSettings, logTool } from "./state.js";
import { getContext } from "./tabgroup.js";
import { detachAll } from "./cdp.js";
import {
  removeFromAllowlist,
  addToAllowlist,
  addToBlocklist,
  removeFromBlocklist,
} from "./permissions.js";
import { detectBrowser } from "./browser-info.js";
import { initTabArchiveBridge } from "./ws-bridge.js";

setMessageHandler(async (msg: ServerToExtension) => {
  if (msg.type === "ping") {
    send({ type: "pong", id: msg.id });
    return;
  }
  if (msg.type === "tool_request") {
    const { tool_use_id, tool, args } = msg.params;
    const reply: ToolResultMessage = { type: "tool_result", tool_use_id };
    try {
      const content = await runTool(tool, args ?? {});
      reply.result = { content };
    } catch (err) {
      reply.error = {
        content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
      };
    }
    send(reply);
    // keep the mcp-server's view of the tab group fresh
    const ctx = await getContext().catch(() => null);
    send({
      type: "status",
      connected: true,
      tabGroupId: ctx?.tabGroupId ?? null,
      browser: detectBrowser(),
    });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => initNativePort());

// UI (sidepanel / options) <-> SW control channel
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return;
  (async () => {
    switch (msg.kind) {
      case "dsh-ui-get-state": {
        const settings = await getSettings();
        const ctx = await getContext().catch(() => null);
        return {
          bridgeConnected: runtime.bridgeConnected,
          browser: detectBrowser(),
          tabGroupId: ctx?.tabGroupId ?? null,
          tabs: ctx?.tabs ?? [],
          lastError: runtime.lastError,
          toolLog: runtime.toolLog,
          settings,
        };
      }
      case "dsh-ui-set-settings":
        return await setSettings(msg.patch);
      case "dsh-ui-allow-origin":
        await addToAllowlist(msg.origin);
        return { ok: true };
      case "dsh-ui-remove-origin":
        await removeFromAllowlist(msg.origin);
        return { ok: true };
      case "dsh-ui-block-origin":
        await addToBlocklist(msg.origin);
        return { ok: true };
      case "dsh-ui-unblock-origin":
        await removeFromBlocklist(msg.origin);
        return { ok: true };
      case "dsh-ui-reconnect":
        initNativePort();
        return { ok: true };
      case "dsh-ui-detach-all":
        await detachAll();
        return { ok: true };
      default:
        return undefined;
    }
  })().then(sendResponse, (err) => sendResponse({ error: String(err) }));
  return true;
});

initNativePort();
initTabArchiveBridge();
logTool("startup", true, `DSH Browser ${chrome.runtime.getManifest().version}`);
