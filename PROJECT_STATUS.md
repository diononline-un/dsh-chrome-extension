---
status: in-development
progress: 90
version: "0.1.0"
tags: [browser, extension, mcp, chrome, automation, archive]
scope: "MV3-Browser-Extension plus MCP-Server für Browser-Automation (dsh, Claude-in-Chrome-Parität): Tab-Gruppe, CDP-Tools, Sidepanel. Neu: archive_all_tabs erfasst alle Incognito-Tabs und übergibt sie per WebSocket an den lokalen tab-archive-Container. Neu: VPS-Relay (deploy/) — mcp-server läuft auf der VPS, die lokale Chrome-Extension erreicht ihn per SSH-Streamlocal-Forwarding."
last_updated: "2026-10-01"
next_steps:
  - Extension in Chrome nach dem Reconnect-Fix neu laden, Sidepanel muss "Connected" zeigen
  - Ersten echten Tool-Call aus einer VPS-dsh-Session fahren (tabs_context, navigate)
  - Incognito-Freigabe für archive_all_tabs setzen und Lauf testen
  - Deploy-Artefakte (deploy/) committen und PR-Ablauf etablieren
---

# DSH Browser

Monorepo: `protocol`, `extension`, `mcp-server`, `native-host`. Automation läuft über eine eigene Tab-Gruppe und UDS/native-messaging; die Tab-Archivierung läuft getrennt davon über `ws://127.0.0.1:2345/ws` gegen tab-archive.

Betriebsmodus aktuell: **VPS-Relay**. Der mcp-server läuft als `dsh`-Kind auf hermes-vps (`dsh-vps`), Chrome lokal; dazwischen der systemd-User-Dienst `dsh-browser-tunnel.service` (SSH `-L` von lokalem auf den VPS-Socket). Lokales `mcp-browser` ist dafür abgeschaltet.
