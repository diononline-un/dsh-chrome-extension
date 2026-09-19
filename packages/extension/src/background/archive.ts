/**
 * Tab archiving: collects every tab (optionally Incognito only) with title,
 * cleaned URL, tags source data, CDP thumbnail and HTML5 video duration, POSTs
 * batches to a local tab-archive service, then closes the archived tabs.
 */
import { attach, detach, clearBuffers, send } from "./cdp.js";

const TRACKING_PARAMS = new Set([
  "fbclid", "gclid", "gbraid", "wbraid", "msclkid", "twclid", "ttclid", "yclid",
  "mc_cid", "mc_eid", "igshid", "igsh", "si", "spm", "s_kwcid", "_ga", "_gl",
  "mkt_tok", "oly_anon_id", "oly_enc_id", "vero_id", "wickedid", "rb_clickid",
  "sc_cid", "campaignid", "adgroupid", "adid", "clickid", "ref_src", "ref_url",
]);

export function cleanUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return raw;
    for (const key of [...u.searchParams.keys()]) {
      const lower = key.toLowerCase();
      if (TRACKING_PARAMS.has(lower) || lower.startsWith("utm_")) {
        u.searchParams.delete(key);
      }
    }
    return u.toString();
  } catch {
    return raw;
  }
}

export function domainOf(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return "";
  }
}

export interface ArchiveRecord {
  title: string;
  url: string;
  url_original: string | null;
  domain: string;
  duration_seconds: number | null;
  has_video: boolean;
  thumb_b64: string | null;
  thumb_mime: string;
  window_id: number;
  tab_index: number;
  incognito: boolean;
}

export interface ArchiveOptions {
  ingestUrl: string;
  incognitoOnly?: boolean;
  closeAfter?: boolean;
  batchSize?: number;
}

export interface ArchiveSummary {
  total: number;
  processed: number;
  closed: number;
  failed: number;
  skipped: number;
  current: string | null;
  errors: string[];
}

async function collectDuration(tabId: number): Promise<number | null> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const videos = Array.from(document.querySelectorAll("video"));
        let best: number | null = null;
        for (const v of videos) {
          const d = v.duration;
          if (Number.isFinite(d) && d > 0 && (best === null || d > best)) best = d;
        }
        return best;
      },
    });
    const value = results?.[0]?.result;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

async function captureThumb(tabId: number): Promise<string | null> {
  try {
    await attach(tabId);
    const res = await send<{ data: string }>(tabId, "Page.captureScreenshot", {
      format: "jpeg",
      quality: 55,
    });
    return res.data ?? null;
  } catch {
    return null;
  } finally {
    await detach(tabId);
    clearBuffers(tabId);
  }
}

async function collect(tab: chrome.tabs.Tab): Promise<{ tabId: number; record: ArchiveRecord } | null> {
  const tabId = tab.id;
  if (tabId == null) return null;
  const rawUrl = tab.url ?? tab.pendingUrl ?? "";
  if (!rawUrl) return null;

  const url = cleanUrl(rawUrl);
  const [duration, thumb] = await Promise.all([collectDuration(tabId), captureThumb(tabId)]);

  return {
    tabId,
    record: {
      title: tab.title ?? "",
      url,
      url_original: rawUrl === url ? null : rawUrl,
      domain: domainOf(url),
      duration_seconds: duration,
      has_video: duration !== null,
      thumb_b64: thumb,
      thumb_mime: "image/jpeg",
      window_id: tab.windowId,
      tab_index: tab.index,
      incognito: Boolean(tab.incognito),
    },
  };
}

export async function archiveAllTabs(
  opts: ArchiveOptions,
  onProgress: (summary: ArchiveSummary) => void,
): Promise<ArchiveSummary> {
  const all = await chrome.tabs.query({});
  const tabs = all.filter((t) => t.id != null && (!opts.incognitoOnly || t.incognito));
  const batchSize = Math.min(Math.max(opts.batchSize ?? 6, 1), 20);

  const summary: ArchiveSummary = {
    total: tabs.length,
    processed: 0,
    closed: 0,
    failed: 0,
    skipped: 0,
    current: null,
    errors: [],
  };

  let buffer: Array<{ tabId: number; record: ArchiveRecord }> = [];

  const flush = async (): Promise<void> => {
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    let ok = false;
    try {
      const res = await fetch(opts.ingestUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tabs: batch.map((b) => b.record) }),
      });
      if (!res.ok) throw new Error(`ingest returned ${res.status}`);
      ok = true;
    } catch (err) {
      summary.failed += batch.length;
      summary.errors.push(
        `ingest batch of ${batch.length}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (ok && opts.closeAfter !== false) {
      for (const item of batch) {
        try {
          await chrome.tabs.remove(item.tabId);
          summary.closed += 1;
        } catch (err) {
          summary.failed += 1;
          summary.errors.push(
            `close ${item.record.url}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
    onProgress(summary);
  };

  for (const tab of tabs) {
    summary.current = tab.title ?? tab.url ?? "";
    onProgress(summary);
    const item = await collect(tab);
    summary.processed += 1;
    if (!item) {
      summary.skipped += 1;
      continue;
    }
    buffer.push(item);
    if (buffer.length >= batchSize) await flush();
  }
  await flush();

  summary.current = null;
  summary.errors = summary.errors.slice(0, 50);
  onProgress(summary);
  return summary;
}
