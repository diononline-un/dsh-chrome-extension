/** Drive the on-page automation indicator in a tab. */
export async function setIndicator(tabId: number, active: boolean, label?: string): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { kind: "dsh-indicator", active, label }, { frameId: 0 });
  } catch {
    /* indicator script not present on this page — non-fatal */
  }
}
