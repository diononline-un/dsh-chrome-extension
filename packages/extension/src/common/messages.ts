/** Message shapes exchanged SW <-> content script and SW <-> offscreen. */
import type { ToolResultContent } from "@dsh-browser/protocol";

export interface DomRequest {
  kind: "dsh-dom";
  op: "read_page" | "get_page_text" | "find" | "form_input" | "resolve_rect";
  payload: Record<string, unknown>;
}

export interface DomResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface IndicatorMessage {
  kind: "dsh-indicator";
  active: boolean;
  label?: string;
}

export interface OffscreenRequest {
  kind: "dsh-offscreen";
  op: "gif-start" | "gif-frame" | "gif-stop" | "gif-export" | "gif-status";
  payload?: Record<string, unknown>;
}

export interface OffscreenResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export type ToolContent = ToolResultContent[];

export function text(s: string): ToolContent {
  return [{ type: "text", text: s }];
}

export function image(dataB64: string, mimeType = "image/png"): ToolContent {
  return [{ type: "image", data: dataB64, mimeType }];
}

export function json(value: unknown): ToolContent {
  return [{ type: "text", text: JSON.stringify(value, null, 2) }];
}
