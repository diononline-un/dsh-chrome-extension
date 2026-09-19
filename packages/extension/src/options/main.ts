/** Options page. */
export {};
const $ = (id: string) => document.getElementById(id) as HTMLElement;

async function call(kind: string, extra: Record<string, unknown> = {}): Promise<any> {
  return chrome.runtime.sendMessage({ kind, ...extra });
}

async function load(): Promise<void> {
  const s = await call("dsh-ui-get-state");
  ($("token") as HTMLInputElement).value = s?.settings?.token ?? "";
  const mode = s?.settings?.mode ?? "allowlist";
  document.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach((r) => {
    r.checked = r.value === mode;
    r.onchange = () => {
      if (r.checked) void call("dsh-ui-set-settings", { patch: { mode: r.value } });
    };
  });
  $("extid").textContent = chrome.runtime.id;
}

$("saveToken").onclick = async () => {
  await call("dsh-ui-set-settings", { patch: { token: ($("token") as HTMLInputElement).value.trim() } });
  await call("dsh-ui-reconnect");
  ($("saveToken") as HTMLButtonElement).textContent = "Saved ✓";
  setTimeout(() => (($("saveToken") as HTMLButtonElement).textContent = "Save"), 1500);
};

$("reset").onclick = async () => {
  await call("dsh-ui-set-settings", {
    patch: { allowlist: [], blocklist: [], mode: "allowlist", paused: false, token: "" },
  });
  void load();
};

void load();
