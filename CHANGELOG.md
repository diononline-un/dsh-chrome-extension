# Changelog

## 2026-09-19 — archive_all_tabs: Incognito-Tabs ins tab-archive

- Neues Tool `archive_all_tabs` (protocol, Handler, MCP-Server): sammelt alle Tabs, optional nur Incognito, mit Titel, bereinigter URL (Tracking-Parameter entfernt, Original in `url_original`), Domain, CDP-JPEG-Thumbnail und HTML5-Video-Dauer.
- Batch-Ingest an den lokalen tab-archive-Container (`POST /api/ingest`), Tabs werden erst nach erfolgreichem Ingest geschlossen.
- WebSocket-Bridge (`ws://127.0.0.1:2345/ws`) mit Reconnect-Backoff und Keep-alive-Alarm, unabhängig von der dsh-native-messaging-Bridge.
- Debugger wird nach jedem Thumbnail wieder detached, Buffer werden geleert.
- Offen: Reload in Brave, Incognito-Freigabe, erster echter Lauf.
