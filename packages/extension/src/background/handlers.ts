/** Tool dispatch: maps a ToolName + args to result content. */
import type { ToolName } from "@dsh-browser/protocol";
import { text, json, image, type ToolContent } from "../common/messages.js";
import { getContext, createTab, closeTab, resolveTab, windowIdForGroup } from "./tabgroup.js";
import { ensureAllowed } from "./permissions.js";
import { attach, send, getConsole, getNetwork } from "./cdp.js";
import { domCall } from "./dom-call.js";
import { mouseClick, mouseMove, wheel, typeText, pressKey } from "./input.js";
import { captureScreenshot } from "./screenshot.js";
import { archiveAllTabs } from "./archive.js";
import { detectBrowser } from "./browser-info.js";
import { setIndicator } from "./indicator-control.js";
import { gifActive, gifCapture, gifOp } from "./gif-control.js";
import { logTool } from "./state.js";

type Args = Record<string, any>;

async function tabUrl(tabId: number): Promise<string> {
  const t = await chrome.tabs.get(tabId);
  return t.url ?? t.pendingUrl ?? "";
}

async function guardTab(tabId: number): Promise<void> {
  await ensureAllowed(await tabUrl(tabId));
}

async function withIndicator<T>(tabId: number, label: string, fn: () => Promise<T>): Promise<T> {
  await setIndicator(tabId, true, label);
  try {
    return await fn();
  } finally {
    setTimeout(() => void setIndicator(tabId, false), 1200);
    if (gifActive()) await gifCapture(tabId);
  }
}

async function refToCoordinate(tabId: number, ref: string): Promise<[number, number]> {
  const res = await domCall(tabId, "resolve_rect", { ref });
  if (!res.ok || !res.data) throw new Error(res.error ?? `could not resolve ${ref}`);
  const r = res.data as { x: number; y: number; width: number; height: number };
  return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)];
}

async function doComputer(args: Args): Promise<ToolContent> {
  const tabId = await resolveTab(args.tabId);
  await guardTab(tabId);
  await attach(tabId);
  const action = args.action as string;

  return withIndicator(tabId, action, async () => {
    let coord: [number, number] | undefined = args.coordinate;
    if (!coord && args.ref) coord = await refToCoordinate(tabId, args.ref);

    switch (action) {
      case "screenshot":
        break;
      case "left_click":
      case "right_click":
      case "double_click": {
        if (!coord) throw new Error("coordinate or ref required");
        await mouseClick(
          tabId,
          coord[0],
          coord[1],
          action === "right_click" ? "right" : "left",
          action === "double_click" ? 2 : 1,
        );
        break;
      }
      case "move": {
        if (!coord) throw new Error("coordinate or ref required");
        await mouseMove(tabId, coord[0], coord[1]);
        break;
      }
      case "scroll": {
        const [x, y] = coord ?? [Math.round(200), Math.round(200)];
        const amount = (args.scroll_amount ?? 3) * 100;
        const dir = args.scroll_direction ?? "down";
        const dx = dir === "left" ? -amount : dir === "right" ? amount : 0;
        const dy = dir === "up" ? -amount : dir === "down" ? amount : 0;
        await wheel(tabId, x, y, dx, dy);
        break;
      }
      case "type": {
        if (!args.text) throw new Error("text required");
        await typeText(tabId, String(args.text));
        break;
      }
      case "key": {
        if (!args.key) throw new Error("key required");
        await pressKey(tabId, String(args.key));
        break;
      }
      case "wait": {
        await new Promise((r) => setTimeout(r, Math.min(args.duration_ms ?? 500, 10_000)));
        break;
      }
      default:
        throw new Error(`unknown action ${action}`);
    }

    await new Promise((r) => setTimeout(r, 120));
    const shot = await captureScreenshot(tabId);
    return image(shot);
  });
}

async function fileUpload(args: Args): Promise<ToolContent> {
  const tabId = await resolveTab(args.tabId);
  await guardTab(tabId);
  const paths: string[] = args.paths ?? (args.path ? [args.path] : []);
  if (paths.length === 0) throw new Error("no file paths given");
  const mark = await domCall(tabId, "mark_ref", { ref: args.ref });
  if (!mark.ok) throw new Error(mark.error ?? "ref not found");
  await attach(tabId);
  const doc = await send<{ root: { nodeId: number } }>(tabId, "DOM.getDocument", { depth: -1 });
  const q = await send<{ nodeId: number }>(tabId, "DOM.querySelector", {
    nodeId: doc.root.nodeId,
    selector: `[data-dsh-mark="${args.ref}"]`,
  });
  if (!q.nodeId) throw new Error("could not locate the marked element via CDP");
  await send(tabId, "DOM.setFileInputFiles", { nodeId: q.nodeId, files: paths });
  return text(`attached ${paths.length} file(s) to ${args.ref}`);
}

async function runNavigate(args: Args): Promise<ToolContent> {
  const tabId = await resolveTab(args.tabId);
  if (args.url) {
    await ensureAllowed(String(args.url));
    await withIndicator(tabId, "navigate", async () => {
      await chrome.tabs.update(tabId, { url: String(args.url) });
      await waitForLoad(tabId);
    });
    return text(`navigated to ${await tabUrl(tabId)}`);
  }
  await guardTab(tabId);
  if (args.back) await chrome.tabs.goBack(tabId);
  else if (args.forward) await chrome.tabs.goForward(tabId);
  else if (args.reload) await chrome.tabs.reload(tabId);
  else throw new Error("pass one of url / back / forward / reload");
  await waitForLoad(tabId);
  return text(`now at ${await tabUrl(tabId)}`);
}

function waitForLoad(tabId: number, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    };
    const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === "complete") done();
    };
    const timer = setTimeout(done, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    void chrome.tabs.get(tabId).then((t) => {
      if (t.status === "complete") done();
    });
  });
}

async function runJavascript(args: Args): Promise<ToolContent> {
  const tabId = await resolveTab(args.tabId);
  await guardTab(tabId);
  await attach(tabId);
  const res = await send<{ result: any; exceptionDetails?: any }>(tabId, "Runtime.evaluate", {
    expression: String(args.expression),
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
    timeout: 30_000,
  });
  if (res.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text ?? "evaluation error");
  }
  const v = res.result?.value;
  return v === undefined ? text(String(res.result?.type ?? "undefined")) : json(v);
}

async function runConsole(args: Args): Promise<ToolContent> {
  const tabId = await resolveTab(args.tabId);
  let entries = getConsole(tabId);
  const level = args.level ?? "all";
  if (level !== "all") {
    const want = level === "warning" ? ["warning", "warn"] : [level];
    entries = entries.filter((e) => want.includes(e.level));
  }
  entries = entries.slice(-(args.limit ?? 100));
  if (entries.length === 0) return text("(no console messages captured for this tab)");
  return json(entries);
}

async function runNetwork(args: Args): Promise<ToolContent> {
  const tabId = await resolveTab(args.tabId);
  let entries = getNetwork(tabId);
  if (args.filter) entries = entries.filter((e) => e.url.includes(String(args.filter)));
  if (args.resourceType && args.resourceType !== "all") {
    entries = entries.filter((e) => e.resourceType === args.resourceType);
  }
  entries = entries.slice(-(args.limit ?? 100));
  if (entries.length === 0) return text("(no network requests captured for this tab)");
  return json(
    entries.map((e) => ({
      method: e.method,
      url: e.url,
      status: e.failed ? `failed: ${e.errorText}` : e.status,
      type: e.resourceType,
      mime: e.mimeType,
      bytes: e.encodedDataLength,
    })),
  );
}

async function runDom(op: string, args: Args): Promise<ToolContent> {
  const tabId = await resolveTab(args.tabId);
  await guardTab(tabId);
  const res = await domCall(tabId, op, args);
  if (!res.ok) throw new Error(res.error ?? `${op} failed`);
  return json(res.data);
}

async function resizeWindow(args: Args): Promise<ToolContent> {
  const windowId = await windowIdForGroup();
  if (windowId == null) throw new Error("no automation window open");
  await chrome.windows.update(windowId, { width: args.width, height: args.height });
  return text(`window resized to ${args.width}x${args.height}`);
}

async function shortcutsList(): Promise<ToolContent> {
  const raw = await chrome.storage.local.get("shortcuts");
  const list = (raw.shortcuts as any[]) ?? [];
  return json(list.map((s) => ({ name: s.name, steps: s.actions?.length ?? 0, description: s.description })));
}

async function shortcutsExecute(args: Args): Promise<ToolContent> {
  const raw = await chrome.storage.local.get("shortcuts");
  const list = (raw.shortcuts as any[]) ?? [];
  const sc = list.find((s) => s.name === args.name);
  if (!sc) throw new Error(`no shortcut named "${args.name}"`);
  return runBatch({ actions: sc.actions, continueOnError: false });
}

async function runBatch(args: Args): Promise<ToolContent> {
  const actions: Array<{ name: string; input?: Args }> = args.actions ?? [];
  const out: unknown[] = [];
  for (let i = 0; i < actions.length; i++) {
    const step = actions[i]!;
    try {
      const content = await runTool(step.name as ToolName, step.input ?? {});
      out.push({ step: i, name: step.name, ok: true, content });
    } catch (err) {
      out.push({ step: i, name: step.name, ok: false, error: err instanceof Error ? err.message : String(err) });
      if (!args.continueOnError) break;
    }
  }
  return json(out);
}

async function runArchive(args: Args): Promise<ToolContent> {
  const summary = await archiveAllTabs(
    {
      ingestUrl: String(args.ingest_url ?? "http://127.0.0.1:2345/api/ingest"),
      incognitoOnly: args.incognito_only !== false,
      closeAfter: args.close_after !== false,
      batchSize: typeof args.batch_size === "number" ? args.batch_size : undefined,
    },
    () => {},
  );
  return json(summary);
}

export async function runTool(tool: ToolName, args: Args): Promise<ToolContent> {
  try {
    const result = await dispatch(tool, args);
    logTool(tool, true);
    return result;
  } catch (err) {
    logTool(tool, false, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

function dispatch(tool: ToolName, args: Args): Promise<ToolContent> {
  switch (tool) {
    case "tabs_context":
      return getContext().then(json);
    case "tabs_create":
      return createTab(args.url).then((t) => json(t));
    case "tabs_close":
      return closeTab(args.tabId).then(() => text(`closed tab ${args.tabId}`));
    case "navigate":
      return runNavigate(args);
    case "read_page":
      return runDom("read_page", args);
    case "get_page_text":
      return runDom("get_page_text", args);
    case "find":
      return runDom("find", args);
    case "computer":
      return doComputer(args);
    case "form_input":
      return runDom("form_input", args).then(() => text(`set ${args.ref}`));
    case "file_upload":
    case "upload_image":
      return fileUpload(args);
    case "read_console_messages":
      return runConsole(args);
    case "read_network_requests":
      return runNetwork(args);
    case "javascript":
      return runJavascript(args);
    case "resize_window":
      return resizeWindow(args);
    case "gif_creator":
      return gifOp(args, () => resolveTab(args.tabId));
    case "browser_batch":
      return runBatch(args);
    case "list_connected_browsers":
      return Promise.resolve(json([{ id: "default", name: detectBrowser(), active: true }]));
    case "select_browser":
    case "switch_browser":
      return Promise.resolve(
        args.browserId === "default"
          ? text("selected default browser")
          : text(`only the default browser is paired; ignoring "${args.browserId}"`),
      );
    case "shortcuts_list":
      return shortcutsList();
    case "shortcuts_execute":
      return shortcutsExecute(args);
    case "archive_all_tabs":
      return runArchive(args);
    default:
      return Promise.reject(new Error(`unimplemented tool: ${tool}`));
  }
}
