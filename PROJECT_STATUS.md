---
status: in-development
progress: 90
version: "0.1.0"
tags: [browser, extension, mcp, brave, automation, archive]
scope: "MV3-Browser-Extension plus MCP-Server für Browser-Automation (dsh, Claude-in-Chrome-Parität): Tab-Gruppe, CDP-Tools, Sidepanel. Neu: archive_all_tabs erfasst alle Incognito-Tabs und übergibt sie per WebSocket an den lokalen tab-archive-Container."
last_updated: "2026-09-19"
next_steps:
  - Extension in Brave neu laden, Incognito-Freigabe setzen, archive_all_tabs end-to-end testen
  - Erstes GitHub-Repo-Push und PR-Ablauf etablieren
---

# DSH Browser

Monorepo: `protocol`, `extension`, `mcp-server`, `native-host`. Automation läuft über eine eigene Tab-Gruppe und UDS/native-messaging; die Tab-Archivierung läuft getrennt davon über `ws://127.0.0.1:2345/ws` gegen tab-archive.
