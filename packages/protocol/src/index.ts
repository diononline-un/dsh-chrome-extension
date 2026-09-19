/**
 * Shared wire protocol for the DSH Browser bridge (browser-safe part).
 *
 * Three processes speak this protocol:
 *   - mcp-server   (spawned by dsh, owns the UDS listener, talks MCP to dsh)
 *   - native-host  (spawned by the browser, dumb pipe: native-messaging stdio <-> UDS)
 *   - extension    (MV3 service worker, executes tool commands via CDP / chrome.* APIs)
 *
 * Node-only helpers (framing, socket-path resolution) live in `./node`.
 */

export const PROTOCOL_VERSION = 1 as const;

export const NATIVE_HOST_NAME = "com.dsh.browser_bridge" as const;
export const MCP_SERVER_NAME = "dsh-browser" as const;
export const MCP_SERVER_VERSION = "0.1.0" as const;

export const TAB_GROUP_TITLE = "DSH Automation" as const;

/** Tools exposed to the model. dsh prefixes them as `mcp__browser__<name>`. */
export const TOOL_NAMES = [
  "tabs_context",
  "tabs_create",
  "tabs_close",
  "navigate",
  "read_page",
  "get_page_text",
  "find",
  "computer",
  "form_input",
  "file_upload",
  "upload_image",
  "read_console_messages",
  "read_network_requests",
  "javascript",
  "resize_window",
  "gif_creator",
  "browser_batch",
  "list_connected_browsers",
  "select_browser",
  "switch_browser",
  "shortcuts_list",
  "shortcuts_execute",
  "archive_all_tabs",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

// ---------------------------------------------------------------------------
// Message envelopes
// ---------------------------------------------------------------------------

export interface HelloMessage {
  type: "hello";
  extVersion: string;
  browser: string;
  /** optional shared secret from ~/.config/dsh-chrome/config.json (defense in depth) */
  token?: string;
}

export interface WelcomeMessage {
  type: "welcome";
  protocolVersion: number;
  serverVersion: string;
  accepted: boolean;
  reason?: string;
}

export interface PingMessage {
  type: "ping";
  id: string;
}
export interface PongMessage {
  type: "pong";
  id: string;
}

export interface ToolRequestMessage {
  type: "tool_request";
  method: "execute_tool";
  params: {
    tool_use_id: string;
    tool: ToolName;
    args: Record<string, unknown>;
  };
}

export interface ToolResultContentText {
  type: "text";
  text: string;
}
export interface ToolResultContentImage {
  type: "image";
  data: string; // base64, no data: prefix
  mimeType: string;
}
export type ToolResultContent = ToolResultContentText | ToolResultContentImage;

export interface ToolResultMessage {
  type: "tool_result";
  tool_use_id: string;
  result?: { content: ToolResultContent[] };
  error?: { content: ToolResultContent[] };
}

export interface StatusMessage {
  type: "status";
  connected: boolean;
  tabGroupId: number | null;
  browser: string;
}

export type ServerToExtension = WelcomeMessage | PingMessage | ToolRequestMessage;
export type ExtensionToServer =
  | HelloMessage
  | PongMessage
  | ToolResultMessage
  | StatusMessage;
export type BridgeMessage = ServerToExtension | ExtensionToServer;
