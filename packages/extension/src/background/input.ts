/** CDP-based mouse/keyboard synthesis for the `computer` tool. */
import { send } from "./cdp.js";

export async function mouseClick(
  tabId: number,
  x: number,
  y: number,
  button: "left" | "right" = "left",
  clickCount = 1,
): Promise<void> {
  await send(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await send(tabId, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button,
    buttons: button === "left" ? 1 : 2,
    clickCount,
  });
  await send(tabId, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button,
    buttons: 0,
    clickCount,
  });
}

export async function mouseMove(tabId: number, x: number, y: number): Promise<void> {
  await send(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
}

export async function wheel(
  tabId: number,
  x: number,
  y: number,
  deltaX: number,
  deltaY: number,
): Promise<void> {
  await send(tabId, "Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x,
    y,
    deltaX,
    deltaY,
  });
}

export async function typeText(tabId: number, text: string): Promise<void> {
  for (const ch of text) {
    if (ch === "\n") {
      await pressKey(tabId, "Enter");
      continue;
    }
    await send(tabId, "Input.dispatchKeyEvent", { type: "keyDown", text: ch });
    await send(tabId, "Input.dispatchKeyEvent", { type: "keyUp", text: ch });
  }
}

const KEY_CODES: Record<string, { key: string; code: string; keyCode: number }> = {
  Enter: { key: "Enter", code: "Enter", keyCode: 13 },
  Tab: { key: "Tab", code: "Tab", keyCode: 9 },
  Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  Delete: { key: "Delete", code: "Delete", keyCode: 46 },
  Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  Home: { key: "Home", code: "Home", keyCode: 36 },
  End: { key: "End", code: "End", keyCode: 35 },
  PageUp: { key: "PageUp", code: "PageUp", keyCode: 33 },
  PageDown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  Space: { key: " ", code: "Space", keyCode: 32 },
};

const MODIFIER_BITS: Record<string, number> = { Alt: 1, Control: 2, Ctrl: 2, Meta: 4, Shift: 8 };

/** Accepts combos like "Control+a", "Shift+Tab", "Enter". */
export async function pressKey(tabId: number, combo: string): Promise<void> {
  const parts = combo.split("+").map((p) => p.trim());
  const keyName = parts.pop() ?? "";
  let modifiers = 0;
  for (const m of parts) modifiers |= MODIFIER_BITS[m] ?? 0;

  const def =
    KEY_CODES[keyName] ??
    (keyName.length === 1
      ? { key: keyName, code: `Key${keyName.toUpperCase()}`, keyCode: keyName.toUpperCase().charCodeAt(0) }
      : { key: keyName, code: keyName, keyCode: 0 });

  const base = {
    modifiers,
    key: def.key,
    code: def.code,
    windowsVirtualKeyCode: def.keyCode,
    nativeVirtualKeyCode: def.keyCode,
  };
  await send(tabId, "Input.dispatchKeyEvent", {
    type: modifiers ? "rawKeyDown" : "keyDown",
    ...base,
    text: !modifiers && def.key.length === 1 ? def.key : undefined,
  });
  await send(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...base });
}
