# Changelog

## 2026-10-01 — VPS-Relay: Extension lokal, dsh auf der VPS

- Neuer Betriebsmodus, dokumentiert in `README.md` und `deploy/`: der `mcp-server` läuft als `dsh`-Kind auf der VPS (hermes-vps, Repo unter `/home/dsh/dsh-chrome-extension`), die lokale Brave-Extension erreicht seinen UDS über SSH-Streamlocal-Forwarding auf denselben Pfad.
- `deploy/vps/cordis.patch.yml` aktiviert `mcp-browser` im VPS-Profil und pinnt `DSH_CHROME_SOCKET=/run/user/1000/dsh-chrome/bridge.sock`; ohne den Pin landet der Socket je nach Startweg in `~/.local/state/dsh-chrome/` (`dsh-web.service` erbt kein `XDG_RUNTIME_DIR`).
- `deploy/local/dsh-browser-tunnel.service` hält den Forward dauerhaft (`StreamLocalBindUnlink`, `ExitOnForwardFailure`, Keep-alive, `Restart=always`), `deploy/local/cordis.patch.yml` schaltet das lokale `mcp-browser` ab, weil ein Socket-Pfad nur einen Besitzer haben kann.
- Verifiziert: Handshake über die Tunnelstrecke liefert `welcome` (protocolVersion 1), VPS-Log `[dsh-browser-mcp] listening on /run/user/1000/dsh-chrome/bridge.sock` und `browser connected`.
- Fix am nativen Host: der letzte `hello`-Frame wird gemerkt und nach einem Socket-Reconnect erneut geschickt. Vorher lernte der mcp-server eine zurückgekehrte Verbindung nie kennen (er kennt die Extension nur über `hello`), die Extension blieb auf „Waiting for dsh" und der Server hatte keinen `conn`.
- Fix in der Extension: `dsh-ui-reconnect` war ein No-op, weil `connect()` bei vorhandenem Port sofort zurückkehrt. `reconnect()` verwirft den alten Port, setzt Handshake und Backoff zurück und öffnet einen frischen; ein `status{connected:false}` setzt zusätzlich `handshakeDone` zurück.
- Regressionstest als Wegwerf-Harness gefahren (echter Native-Host-Prozess, Fake-mcp-server mit simuliertem Drop): zweiter Listener sieht nach dem Drop genau ein `hello`, die Extension ein zweites `welcome`.
- Offen: entpacktes Laden der Extension in Chrome, erster echter Tool-Call aus einer VPS-Session, Incognito-Freigabe für `archive_all_tabs`.

## 2026-09-19 — archive_all_tabs: Incognito-Tabs ins tab-archive

- Neues Tool `archive_all_tabs` (protocol, Handler, MCP-Server): sammelt alle Tabs, optional nur Incognito, mit Titel, bereinigter URL (Tracking-Parameter entfernt, Original in `url_original`), Domain, CDP-JPEG-Thumbnail und HTML5-Video-Dauer.
- Batch-Ingest an den lokalen tab-archive-Container (`POST /api/ingest`), Tabs werden erst nach erfolgreichem Ingest geschlossen.
- WebSocket-Bridge (`ws://127.0.0.1:2345/ws`) mit Reconnect-Backoff und Keep-alive-Alarm, unabhängig von der dsh-native-messaging-Bridge.
- Debugger wird nach jedem Thumbnail wieder detached, Buffer werden geleert.
- Offen: Reload in Brave, Incognito-Freigabe, erster echter Lauf.
