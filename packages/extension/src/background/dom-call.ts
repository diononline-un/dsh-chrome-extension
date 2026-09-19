/** Talk to the DOM content script in a specific tab, injecting it if needed. */
import type { DomResponse } from "../common/messages.js";

export async function domCall(
  tabId: number,
  op: string,
  payload: Record<string, unknown> = {},
): Promise<DomResponse> {
  const message = { kind: "dsh-dom", op, payload };
  try {
    return (await chrome.tabs.sendMessage(tabId, message, { frameId: 0 })) as DomResponse;
  } catch {
    // content script not present yet (page predates install, or SW just woke)
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: ["content-dom.js"],
    });
    return (await chrome.tabs.sendMessage(tabId, message, { frameId: 0 })) as DomResponse;
  }
}
