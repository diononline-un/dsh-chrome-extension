/**
 * The automation tab group: an isolated chrome.tabGroups group that every
 * automation tab lives in, so the agent never touches the user's own tabs.
 */
import { TAB_GROUP_TITLE } from "@dsh-browser/protocol";
import { runtime } from "./state.js";

const STORE_KEY = "tabGroupId";

async function loadStoredGroupId(): Promise<number | null> {
  const raw = await chrome.storage.session.get(STORE_KEY);
  const id = raw[STORE_KEY];
  return typeof id === "number" ? id : null;
}

async function storeGroupId(id: number | null): Promise<void> {
  runtime.tabGroupId = id;
  if (id == null) await chrome.storage.session.remove(STORE_KEY);
  else await chrome.storage.session.set({ [STORE_KEY]: id });
}

async function groupExists(id: number): Promise<boolean> {
  try {
    await chrome.tabGroups.get(id);
    return true;
  } catch {
    return false;
  }
}

/** Resolve (and cache) the current automation group id, or null if none yet. */
export async function currentGroupId(): Promise<number | null> {
  if (runtime.tabGroupId != null && (await groupExists(runtime.tabGroupId))) {
    return runtime.tabGroupId;
  }
  const stored = await loadStoredGroupId();
  if (stored != null && (await groupExists(stored))) {
    runtime.tabGroupId = stored;
    return stored;
  }
  // Adopt an existing group with our title if the user still has one open.
  const groups = await chrome.tabGroups.query({ title: TAB_GROUP_TITLE });
  if (groups[0]) {
    await storeGroupId(groups[0].id);
    return groups[0].id;
  }
  await storeGroupId(null);
  return null;
}

export interface TabInfo {
  tabId: number;
  url: string;
  title: string;
  active: boolean;
  status: string;
}

export interface GroupContext {
  tabGroupId: number | null;
  windowId: number | null;
  tabs: TabInfo[];
  activeTabId: number | null;
}

export async function getContext(): Promise<GroupContext> {
  const gid = await currentGroupId();
  if (gid == null) {
    return { tabGroupId: null, windowId: null, tabs: [], activeTabId: null };
  }
  const tabs = await chrome.tabs.query({ groupId: gid });
  const infos: TabInfo[] = tabs.map((t) => ({
    tabId: t.id ?? -1,
    url: t.url ?? t.pendingUrl ?? "",
    title: t.title ?? "",
    active: t.active,
    status: t.status ?? "complete",
  }));
  const active = infos.find((t) => t.active) ?? infos[0] ?? null;
  return {
    tabGroupId: gid,
    windowId: tabs[0]?.windowId ?? null,
    tabs: infos,
    activeTabId: active ? active.tabId : null,
  };
}

export async function createTab(url?: string): Promise<TabInfo> {
  const gid = await currentGroupId();
  let windowId: number | undefined;
  if (gid != null) {
    const existing = await chrome.tabs.query({ groupId: gid });
    windowId = existing[0]?.windowId;
  }
  const tab = await chrome.tabs.create({
    url: url ?? "about:blank",
    active: true,
    windowId,
  });
  if (tab.id == null) throw new Error("failed to create tab");

  let groupId = gid;
  if (groupId == null) {
    groupId = await chrome.tabs.group({ tabIds: tab.id });
    await chrome.tabGroups.update(groupId, {
      title: TAB_GROUP_TITLE,
      color: "cyan",
    });
    await storeGroupId(groupId);
  } else {
    await chrome.tabs.group({ tabIds: tab.id, groupId });
  }

  return {
    tabId: tab.id,
    url: tab.url ?? tab.pendingUrl ?? url ?? "about:blank",
    title: tab.title ?? "",
    active: true,
    status: tab.status ?? "loading",
  };
}

export async function closeTab(tabId: number): Promise<void> {
  const gid = await currentGroupId();
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || tab.groupId !== gid) {
    throw new Error(`tab ${tabId} is not in the automation tab group`);
  }
  await chrome.tabs.remove(tabId);
  const remaining = gid != null ? await chrome.tabs.query({ groupId: gid }) : [];
  if (remaining.length === 0) await storeGroupId(null);
}

/** Resolve the tab a tool should act on. Creates nothing. */
export async function resolveTab(tabId?: number): Promise<number> {
  const ctx = await getContext();
  if (tabId != null) {
    if (!ctx.tabs.some((t) => t.tabId === tabId)) {
      throw new Error(
        `tab ${tabId} is not in the automation tab group. Call tabs_context to list valid tab ids.`,
      );
    }
    return tabId;
  }
  if (ctx.activeTabId != null) return ctx.activeTabId;
  throw new Error(
    "No automation tab open yet. Call tabs_create first (optionally with a url).",
  );
}

export async function windowIdForGroup(): Promise<number | null> {
  const ctx = await getContext();
  return ctx.windowId;
}
