/**
 * Tool registration. Every tool is a thin wrapper: validate args with zod,
 * forward `{tool, args}` to the extension over the bridge, translate the
 * returned content blocks into an MCP CallToolResult.
 *
 * Behavioural parity target: `mcp__claude-in-chrome__*`.
 */
import { z, type ZodRawShape } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolName, ToolResultContent } from "@dsh-browser/protocol";
import type { Bridge } from "./bridge.js";

const tabId = z
  .number()
  .int()
  .optional()
  .describe("Target tab id from tabs_context. Omit to use the active automation tab.");

interface ToolSpec {
  name: ToolName;
  description: string;
  schema: ZodRawShape;
  /** default 120s; screenshots/gif export can be slow */
  timeoutMs?: number;
}

const SPECS: ToolSpec[] = [
  {
    name: "tabs_context",
    description:
      "Get context about the DSH automation tab group: its id, every tab id inside it, and which tab is active. Call this first in a session before using other tools.",
    schema: {},
  },
  {
    name: "tabs_create",
    description: "Create a new empty tab inside the DSH automation tab group and make it active.",
    schema: { url: z.string().url().optional().describe("Optional URL to open in the new tab.") },
  },
  {
    name: "tabs_close",
    description: "Close a tab in the DSH automation tab group by its id.",
    schema: { tabId: z.number().int().describe("Tab id to close.") },
  },
  {
    name: "navigate",
    description:
      "Navigate a tab to a URL, or move through history. Pass exactly one of url / back / forward / reload.",
    schema: {
      url: z.string().optional().describe("Absolute URL to load."),
      back: z.boolean().optional(),
      forward: z.boolean().optional(),
      reload: z.boolean().optional(),
      tabId,
    },
  },
  {
    name: "read_page",
    description:
      "Return an accessibility-tree view of the page: interactive and structural elements, each tagged with a [ref_id] you can pass to computer / form_input / find. Sensitive field values are redacted.",
    schema: {
      filter: z
        .enum(["visible", "interactive", "all"])
        .optional()
        .describe('"visible" (default) = on-screen elements, "interactive" = only controls, "all" = whole tree.'),
      maxDepth: z.number().int().min(1).max(40).optional(),
      maxChars: z.number().int().min(1000).max(200_000).optional().describe("Default 50000."),
      refId: z.string().optional().describe("Restrict the tree to the subtree rooted at this ref."),
      tabId,
    },
  },
  {
    name: "get_page_text",
    description:
      "Extract readable text from the page, prioritising main article content, as Markdown-ish plain text.",
    schema: { maxChars: z.number().int().min(1000).max(500_000).optional(), tabId },
  },
  {
    name: "find",
    description:
      "Fuzzy-search the page for elements whose text / label / role matches a query. Returns matches with [ref_id]s.",
    schema: {
      query: z.string().describe("Text or description to look for."),
      limit: z.number().int().min(1).max(50).optional(),
      tabId,
    },
  },
  {
    name: "computer",
    description:
      "Drive mouse and keyboard and take screenshots. actions: screenshot | left_click | right_click | double_click | move | scroll | type | key | wait. Use coordinate [x,y] (CSS px from top-left of the viewport) or a ref from read_page.",
    schema: {
      action: z.enum([
        "screenshot",
        "left_click",
        "right_click",
        "double_click",
        "move",
        "scroll",
        "type",
        "key",
        "wait",
      ]),
      coordinate: z.tuple([z.number(), z.number()]).optional(),
      ref: z.string().optional().describe("ref_id from read_page; used instead of coordinate."),
      text: z.string().optional().describe("Text for the type action."),
      key: z.string().optional().describe('Key combo for the key action, e.g. "Enter", "Control+a".'),
      scroll_direction: z.enum(["up", "down", "left", "right"]).optional(),
      scroll_amount: z.number().int().optional().describe("Wheel clicks (default 3)."),
      duration_ms: z.number().int().min(0).max(10_000).optional().describe("For the wait action."),
      tabId,
    },
    timeoutMs: 60_000,
  },
  {
    name: "form_input",
    description:
      "Set the value of a form control (input, textarea, select, checkbox, radio, contenteditable) identified by a ref_id from read_page.",
    schema: {
      ref: z.string().describe("ref_id of the target control."),
      value: z.union([z.string(), z.boolean()]).describe("Text value, or boolean for checkbox/radio."),
      tabId,
    },
  },
  {
    name: "file_upload",
    description:
      "Attach local files to a file <input> identified by a ref_id. Paths are resolved on the machine running dsh.",
    schema: {
      ref: z.string(),
      paths: z.array(z.string()).min(1).describe("Absolute paths to the files to attach."),
      tabId,
    },
  },
  {
    name: "upload_image",
    description:
      "Attach a local image file to a file <input> identified by a ref_id (convenience wrapper around file_upload).",
    schema: { ref: z.string(), path: z.string(), tabId },
  },
  {
    name: "read_console_messages",
    description:
      "Return recent browser console output (log / warn / error / info + uncaught exceptions) captured for a tab since automation attached.",
    schema: {
      level: z.enum(["all", "error", "warning", "info", "log"]).optional(),
      limit: z.number().int().min(1).max(500).optional(),
      tabId,
    },
  },
  {
    name: "read_network_requests",
    description:
      "Return recent HTTP requests (XHR / fetch / document / script / image ...) captured for a tab: method, url, status, type, timing.",
    schema: {
      filter: z.string().optional().describe("Substring match on the URL."),
      resourceType: z
        .enum(["all", "xhr", "fetch", "document", "script", "stylesheet", "image", "font", "other"])
        .optional(),
      limit: z.number().int().min(1).max(500).optional(),
      tabId,
    },
  },
  {
    name: "javascript",
    description:
      "Evaluate a JavaScript expression in the page's main world and return its JSON-serialisable result. Runs with the page's privileges.",
    schema: {
      expression: z.string().describe("A JS expression or IIFE. `await` is allowed."),
      tabId,
    },
    timeoutMs: 60_000,
  },
  {
    name: "resize_window",
    description: "Resize the browser window that owns the automation tab group.",
    schema: { width: z.number().int().min(200).max(10_000), height: z.number().int().min(200).max(10_000) },
  },
  {
    name: "gif_creator",
    description:
      "Record the automation tab as a GIF. commands: start | stop | export | status. export returns the encoded GIF as an image.",
    schema: {
      command: z.enum(["start", "stop", "export", "status"]),
      fps: z.number().int().min(1).max(30).optional().describe("For start (default 5)."),
      maxSeconds: z.number().int().min(1).max(120).optional(),
      tabId,
    },
    timeoutMs: 120_000,
  },
  {
    name: "browser_batch",
    description:
      "Run a sequence of browser tool calls in one round trip. Each item is {name, input}. Stops at the first error unless continueOnError is set. Returns each step's result in order.",
    schema: {
      actions: z
        .array(z.object({ name: z.string(), input: z.record(z.unknown()).optional() }))
        .min(1)
        .max(50),
      continueOnError: z.boolean().optional(),
    },
    timeoutMs: 180_000,
  },
  {
    name: "list_connected_browsers",
    description: "List browsers currently paired with this dsh session.",
    schema: {},
  },
  {
    name: "select_browser",
    description: "Select which paired browser subsequent tools act on, by id from list_connected_browsers.",
    schema: { browserId: z.string() },
  },
  {
    name: "switch_browser",
    description: "Alias of select_browser.",
    schema: { browserId: z.string() },
  },
  {
    name: "shortcuts_list",
    description: "List saved automation shortcuts (named tool-call sequences) stored in the extension.",
    schema: {},
  },
  {
    name: "shortcuts_execute",
    description: "Run a saved shortcut by name.",
    schema: { name: z.string(), params: z.record(z.unknown()).optional() },
  },
  {
    name: "archive_all_tabs",
    description:
      "Archive every Incognito tab (title, cleaned URL, tags, thumbnail, HTML5 video duration) into the local tab-archive service and close each tab after a successful ingest. Duplicates are deduplicated by URL on the service side.",
    schema: {
      ingest_url: z
        .string()
        .url()
        .optional()
        .describe("Archive service ingest endpoint. Defaults to http://127.0.0.1:2345/api/ingest"),
      incognito_only: z.boolean().optional().describe("Default true."),
      close_after: z.boolean().optional().describe("Close tabs after ingest. Default true."),
      batch_size: z.number().int().min(1).max(20).optional().describe("Default 6."),
    },
    timeoutMs: 600_000,
  },
];

function toCallResult(content: ToolResultContent[]): CallToolResult {
  if (content.length === 0) {
    return { content: [{ type: "text", text: "(no output)" }] };
  }
  return {
    content: content.map((c) =>
      c.type === "image"
        ? { type: "image" as const, data: c.data, mimeType: c.mimeType }
        : { type: "text" as const, text: c.text },
    ),
  };
}

export function registerTools(server: McpServer, bridge: Bridge): void {
  for (const spec of SPECS) {
    server.tool(
      spec.name,
      spec.description,
      spec.schema,
      async (args: Record<string, unknown>): Promise<CallToolResult> => {
        try {
          const content = await bridge.callTool(spec.name, args ?? {}, spec.timeoutMs);
          return toCallResult(content);
        } catch (err) {
          return {
            isError: true,
            content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
          };
        }
      },
    );
  }
}
