/**
 * DOM content script. Runs in every frame at document_start. Answers requests
 * from the service worker: accessibility tree, readable text, fuzzy find,
 * form input, and rect resolution for ref-targeted pointer actions.
 *
 * Element references (`ref_N`) are stable within a page: a WeakRef map keyed by
 * a monotonic counter, with a reverse WeakMap so the same node keeps its ref.
 */

export {}; // ensure module scope

interface RefStore {
  map: Record<string, WeakRef<Element>>;
  reverse: WeakMap<Element, string>;
  counter: number;
}

declare global {
  interface Window {
    __dshRefStore?: RefStore;
  }
}

function store(): RefStore {
  if (!window.__dshRefStore) {
    window.__dshRefStore = { map: {}, reverse: new WeakMap(), counter: 0 };
  }
  return window.__dshRefStore;
}

function refFor(el: Element): string {
  const s = store();
  const existing = s.reverse.get(el);
  if (existing && s.map[existing]?.deref() === el) return existing;
  s.counter += 1;
  const ref = `ref_${s.counter}`;
  s.map[ref] = new WeakRef(el);
  s.reverse.set(el, ref);
  return ref;
}

function deref(ref: string): Element | null {
  const el = store().map[ref]?.deref();
  return el ?? null;
}

// --- role + name ---------------------------------------------------------

const TAG_ROLE: Record<string, string> = {
  a: "link",
  button: "button",
  select: "combobox",
  textarea: "textbox",
  nav: "navigation",
  main: "main",
  header: "banner",
  footer: "contentinfo",
  section: "region",
  article: "article",
  aside: "complementary",
  form: "form",
  table: "table",
  ul: "list",
  ol: "list",
  li: "listitem",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  img: "image",
  label: "label",
};

function roleOf(el: Element): string {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === "input") {
    const t = (el.getAttribute("type") || "text").toLowerCase();
    if (t === "submit" || t === "button" || t === "reset" || t === "file") return "button";
    if (t === "checkbox") return "checkbox";
    if (t === "radio") return "radio";
    if (t === "range") return "slider";
    return "textbox";
  }
  return TAG_ROLE[tag] ?? "generic";
}

function isSensitive(el: Element): boolean {
  const t = (el.getAttribute("type") || "").toLowerCase();
  if (t === "password" || t === "hidden") return true;
  const ac = (el.getAttribute("autocomplete") || "").toLowerCase();
  return [
    "current-password",
    "new-password",
    "one-time-code",
    "cc-number",
    "cc-csc",
    "cc-exp",
    "cc-exp-month",
    "cc-exp-year",
  ].some((s) => ac.includes(s));
}

function labelText(el: Element): string {
  if (el.id) {
    const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (lbl?.textContent?.trim()) return lbl.textContent.trim();
  }
  const wrapping = el.closest("label");
  if (wrapping?.textContent?.trim()) return wrapping.textContent.trim();
  return "";
}

function directText(el: Element): string {
  let out = "";
  for (const n of Array.from(el.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE) out += n.textContent ?? "";
  }
  return out.trim();
}

function accessibleName(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria?.trim()) return aria.trim();
  const labelledby = el.getAttribute("aria-labelledby");
  if (labelledby) {
    const parts = labelledby
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
      .filter(Boolean);
    if (parts.length) return parts.join(" ");
  }
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") {
    if (isSensitive(el)) {
      const ph = el.getAttribute("placeholder") || el.getAttribute("title") || labelText(el);
      return ph || "[sensitive]";
    }
    const lbl = labelText(el);
    if (lbl) return lbl;
    const ph = el.getAttribute("placeholder");
    if (ph?.trim()) return ph.trim();
    if (tag === "input") {
      const t = (el.getAttribute("type") || "").toLowerCase();
      const val = (el as HTMLInputElement).value;
      if ((t === "submit" || t === "button") && val) return val;
      if (val && val.length < 60) return val.trim();
    }
    if (tag === "select") {
      const sel = el as HTMLSelectElement;
      const opt = sel.options[sel.selectedIndex];
      if (opt?.textContent?.trim()) return opt.textContent.trim();
    }
  }
  for (const attr of ["title", "alt"]) {
    const v = el.getAttribute(attr);
    if (v?.trim()) return v.trim();
  }
  const lbl = labelText(el);
  if (lbl) return lbl;
  if (["button", "a", "summary"].includes(tag) || /^h[1-6]$/.test(tag)) {
    const t = (el.textContent ?? "").trim();
    if (t) return t;
  }
  const dt = directText(el);
  if (dt.length >= 2) return dt;
  return "";
}

// --- visibility + interest ---------------------------------------------

function isVisible(el: Element): boolean {
  const s = getComputedStyle(el);
  if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function inViewport(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.top < innerHeight && r.bottom > 0 && r.left < innerWidth && r.right > 0;
}

const INTERACTIVE_TAGS = new Set([
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "details",
  "summary",
]);

function isInteractive(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (INTERACTIVE_TAGS.has(tag)) return true;
  if (el.hasAttribute("onclick")) return true;
  if (el.getAttribute("tabindex") != null) return true;
  if (el.getAttribute("contenteditable") === "true") return true;
  const role = el.getAttribute("role");
  return role != null && ["button", "link", "menuitem", "tab", "checkbox", "radio"].includes(role);
}

function isStructural(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  return (
    /^h[1-6]$/.test(tag) ||
    ["nav", "main", "header", "footer", "section", "article", "aside"].includes(tag) ||
    el.getAttribute("role") != null
  );
}

type Filter = "visible" | "interactive" | "all";

function interesting(el: Element, filter: Filter): boolean {
  const tag = el.tagName.toLowerCase();
  if (["script", "style", "meta", "link", "title", "noscript", "template"].includes(tag)) {
    return false;
  }
  if (filter !== "all" && el.getAttribute("aria-hidden") === "true") return false;
  if (filter !== "all" && !isVisible(el)) return false;
  if (filter === "visible" && !inViewport(el)) return false;
  if (filter === "interactive") return isInteractive(el);
  if (isInteractive(el) || isStructural(el)) return true;
  if (accessibleName(el).length > 0) return true;
  const role = roleOf(el);
  return role !== "generic" && role !== "image";
}

// --- tree build -------------------------------------------------------

interface BuildOpts {
  filter: Filter;
  maxDepth: number;
  maxChars: number;
  root: Element;
}

function buildTree(opts: BuildOpts): { text: string; count: number; truncated: boolean } {
  const lines: string[] = [];
  let count = 0;
  const HARD_CAP = 8000;

  function walk(el: Element, depth: number): void {
    if (count >= HARD_CAP || depth > opts.maxDepth) return;
    const hit = interesting(el, opts.filter);
    if (hit) {
      count += 1;
      const role = roleOf(el);
      const name = accessibleName(el).replace(/\s+/g, " ").slice(0, 120);
      const ref = refFor(el);
      let line = "  ".repeat(depth) + role;
      if (name) line += ` "${name.replace(/"/g, '\\"')}"`;
      line += ` [${ref}]`;
      const href = el.getAttribute("href");
      if (href) line += ` href="${href.slice(0, 200)}"`;
      const type = el.getAttribute("type");
      if (type) line += ` type="${type}"`;
      if ((el as HTMLInputElement).disabled) line += " (disabled)";
      const checked = (el as HTMLInputElement).checked;
      if (el.tagName === "INPUT" && (type === "checkbox" || type === "radio")) {
        line += checked ? " (checked)" : " (unchecked)";
      }
      lines.push(line);
    }
    const nextDepth = hit ? depth + 1 : depth;
    for (const child of Array.from(el.children)) walk(child, nextDepth);
  }

  walk(opts.root, 0);
  let text = lines.join("\n");
  let truncated = count >= HARD_CAP;
  if (text.length > opts.maxChars) {
    const cut = text.lastIndexOf("\n", opts.maxChars);
    text = text.slice(0, cut > 0 ? cut : opts.maxChars);
    truncated = true;
  }
  return { text, count, truncated };
}

// --- readable text ---------------------------------------------------

function readableText(maxChars: number): string {
  const main =
    document.querySelector("main") ??
    document.querySelector("article") ??
    document.querySelector("[role=main]") ??
    document.body;
  if (!main) return "";
  const clone = main.cloneNode(true) as HTMLElement;
  for (const sel of ["script", "style", "noscript", "svg", "nav", "aside", "footer", "header form"]) {
    clone.querySelectorAll(sel).forEach((n) => n.remove());
  }
  const raw = clone.innerText ?? clone.textContent ?? "";
  const text = raw
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > maxChars ? text.slice(0, maxChars) + "\n[truncated]" : text;
}

// --- fuzzy find ----------------------------------------------------------

function findElements(query: string, limit: number): unknown[] {
  const q = query.toLowerCase().trim();
  const results: Array<{ ref: string; role: string; name: string; score: number; text: string }> = [];
  const all = document.body ? Array.from(document.body.querySelectorAll("*")) : [];
  for (const el of all) {
    if (!isVisible(el)) continue;
    const name = accessibleName(el);
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
    const hay = `${name} ${el.getAttribute("placeholder") ?? ""} ${el.getAttribute("aria-label") ?? ""} ${roleOf(el)} ${text}`.toLowerCase();
    if (!hay.includes(q)) continue;
    let score = 0;
    if (name.toLowerCase() === q) score += 100;
    else if (name.toLowerCase().includes(q)) score += 50;
    if (isInteractive(el)) score += 20;
    score -= Math.min(text.length / 40, 10);
    results.push({ ref: refFor(el), role: roleOf(el), name: name.slice(0, 120), score, text });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit).map(({ score: _s, ...rest }) => rest);
}

// --- form input --------------------------------------------------------

function setFormValue(ref: string, value: string | boolean): { ok: boolean; error?: string } {
  const el = deref(ref);
  if (!el) return { ok: false, error: `ref ${ref} not found (re-run read_page)` };
  el.scrollIntoView({ block: "center", inline: "center" });
  const tag = el.tagName.toLowerCase();
  const fire = (name: string) => el.dispatchEvent(new Event(name, { bubbles: true }));

  if (tag === "input") {
    const input = el as HTMLInputElement;
    const type = (input.type || "text").toLowerCase();
    if (type === "checkbox" || type === "radio") {
      input.checked = value === true || value === "true" || value === "on";
      fire("input");
      fire("change");
      return { ok: true };
    }
    input.focus();
    input.value = String(value);
    fire("input");
    fire("change");
    return { ok: true };
  }
  if (tag === "textarea") {
    (el as HTMLTextAreaElement).focus();
    (el as HTMLTextAreaElement).value = String(value);
    fire("input");
    fire("change");
    return { ok: true };
  }
  if (tag === "select") {
    const sel = el as HTMLSelectElement;
    const want = String(value).toLowerCase();
    const opt = Array.from(sel.options).find(
      (o) => o.value.toLowerCase() === want || (o.textContent ?? "").trim().toLowerCase() === want,
    );
    if (!opt) return { ok: false, error: `no option matching "${value}"` };
    sel.value = opt.value;
    fire("input");
    fire("change");
    return { ok: true };
  }
  if (el.getAttribute("contenteditable") === "true") {
    (el as HTMLElement).focus();
    (el as HTMLElement).textContent = String(value);
    fire("input");
    return { ok: true };
  }
  return { ok: false, error: `element ${ref} (${tag}) is not a form control` };
}

function resolveRect(ref: string): { ok: boolean; rect?: DOMRect; error?: string } {
  const el = deref(ref);
  if (!el) return { ok: false, error: `ref ${ref} not found` };
  el.scrollIntoView({ block: "center", inline: "center" });
  const r = el.getBoundingClientRect();
  return {
    ok: true,
    rect: {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      top: r.top,
      left: r.left,
      right: r.right,
      bottom: r.bottom,
    } as DOMRect,
  };
}

// --- message handler -------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.kind !== "dsh-dom") return;
  // Only the top frame answers read_page / get_page_text to avoid duplicates,
  // unless a specific frame was targeted (future: frame routing).
  try {
    const p = msg.payload ?? {};
    switch (msg.op) {
      case "read_page": {
        const filter: Filter = p.filter ?? "visible";
        const res = buildTree({
          filter,
          maxDepth: p.maxDepth ?? 20,
          maxChars: p.maxChars ?? 50_000,
          root: p.refId ? deref(p.refId) ?? document.body : document.body,
        });
        sendResponse({
          ok: true,
          data: {
            url: location.href,
            title: document.title,
            viewport: { width: innerWidth, height: innerHeight },
            filter,
            elementCount: res.count,
            truncated: res.truncated,
            tree: res.text,
          },
        });
        break;
      }
      case "get_page_text": {
        sendResponse({
          ok: true,
          data: {
            url: location.href,
            title: document.title,
            text: readableText(p.maxChars ?? 100_000),
          },
        });
        break;
      }
      case "find": {
        sendResponse({ ok: true, data: findElements(String(p.query ?? ""), p.limit ?? 15) });
        break;
      }
      case "form_input": {
        sendResponse(setFormValue(String(p.ref), p.value));
        break;
      }
      case "resolve_rect": {
        sendResponse(resolveRect(String(p.ref)));
        break;
      }
      case "mark_ref": {
        const el = deref(String(p.ref));
        if (!el) {
          sendResponse({ ok: false, error: `ref ${p.ref} not found` });
        } else {
          document
            .querySelectorAll("[data-dsh-mark]")
            .forEach((n) => n.removeAttribute("data-dsh-mark"));
          el.setAttribute("data-dsh-mark", String(p.ref));
          el.scrollIntoView({ block: "center" });
          sendResponse({ ok: true });
        }
        break;
      }
      default:
        sendResponse({ ok: false, error: `unknown op ${msg.op}` });
    }
  } catch (err) {
    sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
  return true; // async
});
