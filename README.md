# DSH Browser

Browser automation for **DeepSeek Harness** (`dsh`), modelled on Anthropic's
"Claude in Chrome": an MV3 browser extension driven by a per-session MCP server
that `dsh` spawns. Same architecture, same tool surface — the agent reads and
drives your real, logged-in browser session, takes screenshots, and inspects the
console and network.

```
dsh agent
  └─ spawns (stdio):  mcp-server            ← MCP tools -> dsh  (mcp__browser__*)
        └─ listens on: UDS  $XDG_RUNTIME_DIR/dsh-chrome/bridge.sock
             └─ connects: native-host       ← spawned by the browser
                  └─ native messaging  ⇄  extension service worker
                       └─ chrome.debugger (CDP) / chrome.tabs / content scripts
```

No network port is opened; the extension and MCP server rendezvous over a
user-only Unix domain socket via a native-messaging host.

## Packages

| Package | Role |
| --- | --- |
| `packages/protocol` | shared wire types + framing + socket-path resolution |
| `packages/mcp-server` | stdio MCP server (talks to `dsh`), owns the UDS listener, ~22 tools |
| `packages/native-host` | native-messaging host: dumb pipe between the browser and the UDS |
| `packages/extension` | MV3 extension: CDP orchestration, accessibility tree, tab-group isolation, per-site permissions, side panel |

## Install (local, Chrome / Brave / Chromium)

```sh
pnpm install
pnpm -w build
node scripts/install-local.mjs --browsers=chrome       # add --write-dsh to patch cordis.patch.yml for you
```

`--browsers` accepts `chrome`, `brave`, `chromium` and `dsh-desktop`. Use the
one you actually browse with; the tunnel in the VPS variant below is browser
independent, so switching later only means re-running the installer.

Then:

1. **Load the extension** — `chrome://extensions` (or `brave://extensions`) →
   enable *Developer mode* →
   *Load unpacked* → select `packages/extension/dist`.
   The extension id is fixed (`pgpcogdpbeneccnckkjfoicgnbikcepb`) via the `key`
   in `manifest.json`, so the native-messaging manifest keeps matching across
   rebuilds.
2. **Wire it into dsh** — add this to `~/.dsh/profiles/web/cordis.patch.yml`
   (the installer prints it, or writes it with `--write-dsh`):

   ```yaml
   - insert:
       - id: mcp-browser
         name: '@deepseek-ai/dsh-mcp-client'
         config:
           serverName: browser
           transport: stdio
           command: /usr/bin/node
           args:
             - /home/dion/Projekte/dsh-chrome-extension/packages/mcp-server/dist/index.js
           toolCallTimeoutMs: 120000
           reconnect:
             enabled: true
   ```

   `patchReload: live` picks it up; otherwise `systemctl --user restart dsh-web.service`.
3. **Verify** — open the *DSH Browser* side panel. It should say *Connected* once
   `dsh` is running. In a `dsh` chat: *"open example.com and describe the page"*.

## Variant: extension local, dsh on a VPS

The socket belongs to the `mcp-server`, and `dsh` spawns that process. Put
`dsh` on a remote box and the socket lives there while the browser and its
native host stay local. One SSH streamlocal forward joins the two:

```
Browser (local) -> native-host (local) -> /run/user/1000/dsh-chrome/bridge.sock (local)
                                             |  ssh -L, unix socket to unix socket
                                             v
                      /run/user/1000/dsh-chrome/bridge.sock (VPS) <- mcp-server (VPS) <- dsh (VPS)
```

1. Copy the repo to the remote host and build the server half:

   ```sh
   rsync -a --exclude node_modules --exclude dist --exclude .git \
     ./ host:/home/dsh/dsh-chrome-extension/
   ssh host 'sudo -u dsh bash -lc "cd /home/dsh/dsh-chrome-extension \
     && pnpm install --frozen-lockfile \
     && pnpm --filter @dsh-browser/protocol run build \
     && pnpm --filter @dsh-browser/mcp-server run build"'
   ```

2. Install `deploy/vps/cordis.patch.yml` as the profile patch of every profile
   that should drive the browser (`~/.dsh/profiles/<name>/cordis.patch.yml`,
   keep a backup). That row pins `DSH_CHROME_SOCKET`, because
   `dsh-web.service` runs without `XDG_RUNTIME_DIR` and the socket would
   otherwise land in `~/.local/state/dsh-chrome/` while an `ssh` login of the
   same user gets `/run/user/1000/dsh-chrome/`.
3. Install `deploy/local/dsh-browser-tunnel.service` into
   `~/.config/systemd/user/`, change the `dsh-vps` alias if your host differs,
   then `systemctl --user enable --now dsh-browser-tunnel.service`.
4. Free the local socket: put `deploy/local/cordis.patch.yml` in place of
   `~/.dsh/profiles/web/cordis.patch.yml`. One socket path has one owner, so
   the local `mcp-server` has to let go. Leaving it in place also breaks the
   tunnel: `StreamLocalBindUnlink=yes` unlinks the live listener's socket.
5. Register the native host for the browser you use and load
   `packages/extension/dist` unpacked there. Only the native-messaging
   manifest is per browser, the tunnel is not:

   ```sh
   node scripts/install-local.mjs --browsers=chrome   # or brave, chromium
   ```

Run the tunnel on one machine at a time. The bridge keeps a single extension
connection, and a second `mcp-server` on the remote host takes the socket over
(`Bridge.start()` unlinks it before binding). To hand the browser back to a
local `dsh`, restore the backup of the local patch file and stop the tunnel.

## Tools (`mcp__browser__*`)

`tabs_context` · `tabs_create` · `tabs_close` · `navigate` · `read_page`
(accessibility tree with `ref_id`s) · `get_page_text` · `find` · `computer`
(screenshot / click / type / scroll / key) · `form_input` · `file_upload` ·
`upload_image` · `read_console_messages` · `read_network_requests` ·
`javascript` · `resize_window` · `gif_creator` · `browser_batch` ·
`list_connected_browsers` · `select_browser` · `switch_browser` ·
`shortcuts_list` · `shortcuts_execute`

Always call `tabs_context` first; automation runs in a dedicated **"DSH
Automation" tab group** so it never touches your other tabs.

## Safety

- **Per-origin gate.** Default mode is *allowlist* — the agent can only act on
  sites you add in the side panel. Switch to *ask* (prompt once per site) or
  *allow-all* in Options.
- **Global pause** switch in the side panel.
- **Visual indicator** — a cyan bar + `dsh` badge shows on any tab under
  automation.
- `chrome.debugger` triggers Brave's *"DSH Browser started debugging this
  browser"* info bar — expected; Claude's extension shows the same. Click
  *Release debugger* in the side panel to detach.
- Optional pairing token: put `{"token":"…"}` in
  `~/.config/dsh-chrome/config.json` and the same value in Options.

## Development

```sh
pnpm -w build             # all packages
pnpm --filter @dsh-browser/extension run watch   # rebuild extension on change
pnpm -r run typecheck
```

Extension is bundled with esbuild (`packages/extension/build.mjs`); no framework.

## Limitations (v1)

- One browser + one `dsh` session at a time (single well-known socket path).
- GIF encoder uses a fixed web-safe palette — fine for UI recordings, not
  photographic.
- `gif_creator` captures a frame after each browser action rather than at a
  fixed wall-clock rate.
