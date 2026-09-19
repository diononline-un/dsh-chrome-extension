/** Screenshot capture via CDP (works for background tabs, unlike captureVisibleTab). */
import { attach, send } from "./cdp.js";

export async function captureScreenshot(tabId: number, fullPage = false): Promise<string> {
  await attach(tabId);
  const params: Record<string, unknown> = { format: "png", captureBeyondViewport: fullPage };
  if (fullPage) {
    const metrics = await send<{ cssContentSize?: { width: number; height: number } }>(
      tabId,
      "Page.getLayoutMetrics",
    );
    const size = metrics.cssContentSize;
    if (size) {
      params.clip = { x: 0, y: 0, width: size.width, height: size.height, scale: 1 };
    }
  }
  const res = await send<{ data: string }>(tabId, "Page.captureScreenshot", params);
  return res.data; // base64 png
}
