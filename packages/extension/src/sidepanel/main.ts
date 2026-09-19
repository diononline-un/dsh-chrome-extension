/** Side panel: live status, permission controls, tool-call log. */
export {};

interface UiState {
  bridgeConnected: boolean;
  browser: string;
  tabGroupId: number | null;
  tabs: Array<{ tabId: number; url: string; title: string; active: boolean }>;
  lastError: string | null;
  toolLog: Array<{ ts: number; tool: string; ok: boolean; note?: string }>;
  settings: { mode: string; allowlist: string[]; blocklist: string[]; paused: boolean; token: string };
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function call(kind: string, extra: Record<string, unknown> = {}): Promise<any> {
  try {
    const res = await chrome.runtime.sendMessage({ kind, ...extra });
    if (res && typeof res === "object" && "error" in res) {
      showError(String((res as { error: unknown }).error));
    }
    return res;
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
    return null;
  }
}

function showError(msg: string): void {
  $("err").textContent = msg;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

const MODE_LABEL: Record<string, string> = {
  allowlist: "Allowlist only",
  ask: "Ask per site",
  "allow-all": "Allow all",
};

/** Status half — safe to repaint often; touches no form control. */
function renderStatus(s: UiState): void {
  $("dot").className = "dot " + (s.bridgeConnected ? "on" : "off");
  $("browser").textContent = s.browser ?? "";
  $("status").textContent = s.bridgeConnected
    ? `Connected to dsh. Tab group ${s.tabGroupId ?? "(none yet)"}.`
    : "Waiting for dsh — start a dsh session with the browser MCP server configured.";
  if (s.lastError) $("err").textContent = s.lastError;

  $("tabs").innerHTML = s.tabs.length
    ? s.tabs
        .map(
          (t) =>
            `<li><code>${t.active ? "▶ " : ""}${escapeHtml(t.title || t.url || "tab")}</code><span class="muted">#${t.tabId}</span></li>`,
        )
        .join("")
    : '<li class="muted">none</li>';

  $("log").innerHTML = s.toolLog
    .map(
      (e) =>
        `<div class="${e.ok ? "" : "bad"}">${new Date(e.ts).toLocaleTimeString()} ${e.tool}${e.note ? " — " + escapeHtml(e.note) : ""}</div>`,
    )
    .join("");
}

/** Settings half — reflects SW truth; skips a text field the user is typing in. */
function renderSettings(s: UiState): void {
  const active = document.activeElement;

  $("modeNow").textContent = `— currently: ${MODE_LABEL[s.settings.mode] ?? s.settings.mode}`;
  for (const btn of document.querySelectorAll<HTMLButtonElement>(".modeBtn")) {
    btn.classList.toggle("active", btn.dataset.mode === s.settings.mode);
  }

  const paused = $("paused") as HTMLInputElement;
  if (active !== paused) paused.checked = s.settings.paused;

  renderList("allowlist", s.settings.allowlist, "dsh-ui-remove-origin");
  renderList("blocklist", s.settings.blocklist, "dsh-ui-unblock-origin");
}

function renderList(id: string, origins: string[], removeKind: string): void {
  const ul = $(id);
  ul.innerHTML = "";
  if (origins.length === 0) {
    ul.innerHTML = '<li class="muted">none</li>';
    return;
  }
  for (const origin of origins) {
    const li = document.createElement("li");
    const span = document.createElement("code");
    span.textContent = origin;
    const btn = document.createElement("button");
    btn.textContent = "✕";
    btn.title = "remove";
    btn.onclick = async () => {
      await call(removeKind, { origin });
      void refreshAll();
    };
    li.append(span, btn);
    ul.append(li);
  }
}

async function getState(): Promise<UiState | null> {
  const s: UiState = await call("dsh-ui-get-state");
  return s ?? null;
}

async function refreshStatus(): Promise<void> {
  const s = await getState();
  if (s) renderStatus(s);
}

async function refreshAll(): Promise<void> {
  const s = await getState();
  if (s) {
    renderStatus(s);
    renderSettings(s);
  }
}

// --- control handlers -------------------------------------------------

$("reconnect").onclick = () => call("dsh-ui-reconnect").then(refreshAll);
$("detach").onclick = () => call("dsh-ui-detach-all").then(refreshAll);

($("paused") as HTMLInputElement).onchange = async (e) => {
  await call("dsh-ui-set-settings", { patch: { paused: (e.target as HTMLInputElement).checked } });
  void refreshAll();
};

for (const btn of document.querySelectorAll<HTMLButtonElement>(".modeBtn")) {
  btn.onclick = async () => {
    const mode = btn.dataset.mode;
    const res = await call("dsh-ui-set-settings", { patch: { mode } });
    if (res && res.mode === mode) {
      const saved = $("modeSaved");
      saved.hidden = false;
      setTimeout(() => (saved.hidden = true), 1500);
    }
    void refreshAll();
  };
}

function wireAddForm(formId: string, inputId: string, kind: string): void {
  $(formId).addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $(inputId) as HTMLInputElement;
    const val = input.value.trim();
    if (!val) return;
    try {
      const origin = new URL(val.includes("://") ? val : `https://${val}`).origin;
      await call(kind, { origin });
      input.value = "";
      void refreshAll();
    } catch {
      input.value = "";
      input.placeholder = "invalid URL";
    }
  });
}
wireAddForm("addAllowForm", "addAllowOrigin", "dsh-ui-allow-origin");
wireAddForm("addBlockForm", "addBlockOrigin", "dsh-ui-block-origin");

// SW pushes this on tool activity / connection change — status only.
chrome.runtime.onMessage.addListener((m) => {
  if (m?.kind === "dsh-state") void refreshStatus();
});

// Settings can change from the options page or another panel — reflect immediately.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) void refreshAll();
});

void refreshAll();
setInterval(refreshStatus, 2000);
setInterval(() => {
  const a = document.activeElement;
  if (!(a instanceof HTMLInputElement)) void refreshAll();
}, 4000);
