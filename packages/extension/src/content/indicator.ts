/**
 * On-page visual indicator shown while dsh is actively driving this tab.
 * Toggled by the service worker via a `dsh-indicator` message.
 */
const ID = "__dsh_browser_indicator__";

function ensureEl(): HTMLElement {
  let el = document.getElementById(ID);
  if (el) return el;
  el = document.createElement("div");
  el.id = ID;
  el.setAttribute("role", "status");
  Object.assign(el.style, {
    position: "fixed",
    top: "0",
    left: "0",
    right: "0",
    height: "3px",
    background: "linear-gradient(90deg,#06b6d4,#3b82f6)",
    zIndex: "2147483647",
    pointerEvents: "none",
    transition: "opacity .2s",
  } satisfies Partial<CSSStyleDeclaration>);

  const badge = document.createElement("div");
  badge.textContent = "dsh";
  Object.assign(badge.style, {
    position: "fixed",
    top: "6px",
    right: "6px",
    font: "600 11px/1.4 system-ui,sans-serif",
    color: "#fff",
    background: "#0891b2",
    padding: "2px 7px",
    borderRadius: "999px",
    zIndex: "2147483647",
    pointerEvents: "none",
    boxShadow: "0 1px 4px rgba(0,0,0,.3)",
  } satisfies Partial<CSSStyleDeclaration>);
  badge.id = ID + "_badge";
  el.appendChild(badge);
  (document.documentElement || document.body).appendChild(el);
  return el;
}

function setActive(active: boolean, label?: string): void {
  if (!active) {
    document.getElementById(ID)?.remove();
    return;
  }
  const el = ensureEl();
  el.style.opacity = "1";
  const badge = document.getElementById(ID + "_badge");
  if (badge && label) badge.textContent = `dsh · ${label}`;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.kind === "dsh-indicator") setActive(Boolean(msg.active), msg.label);
});
