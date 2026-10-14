#!/usr/bin/env python3
"""
Test der Browser-/iPad-Version in der WebKit-Engine (WebKitGTK, dieselbe Engine
wie Safari). Öffnet den Web-Build mit dauerhaftem Website-Speicher und den
Speicherfunktionen, die Safari standardmäßig aktiviert hat (Storage API, OPFS,
FileSystemSyncAccessHandle), führt webkit-checks.js aus, lädt neu und prüft weiter.

Aufruf (mit laufendem `vite preview` auf Port 4173 und einer X-Anzeige):
    python3.12 tests/e2e-web/webkit-run.py
"""
import json
import os
import shutil
import sys
import tempfile

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import GLib, Gtk, WebKit2  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("E2E_OUT", os.path.join(HERE, "../../target/e2e-web"))
URL = os.environ.get("E2E_URL", "http://127.0.0.1:4173/?e2e")
CHECKS = open(os.path.join(HERE, "webkit-checks.js"), encoding="utf-8").read()
SAFARI_FEATURES = {"StorageAPI", "StorageAPIEstimate", "FileSystem", "AccessHandle", "FileSystemWritableStream"}

data_dir = tempfile.mkdtemp(prefix="studium-webkit-")
manager = WebKit2.WebsiteDataManager(base_data_directory=data_dir, base_cache_directory=os.path.join(data_dir, "cache"))
context = WebKit2.WebContext.new_with_website_data_manager(manager)
view = WebKit2.WebView.new_with_context(context)
settings = view.get_settings()
features = WebKit2.Settings.get_all_features()
for i in range(features.get_length()):
    f = features.get(i)
    if f.get_identifier() in SAFARI_FEATURES:
        settings.set_feature_enabled(f, True)
settings.set_enable_developer_extras(True)

win = Gtk.Window()
win.set_default_size(1180, 820)
win.add(view)
win.show_all()

results = []
state = {"phase": 1}


def finish(code):
    shutil.rmtree(data_dir, ignore_errors=True)
    failed = [r for r in results if not r["ok"]]
    for r in results:
        print(("PASS  " if r["ok"] else "FAIL  ") + r["name"] + (f"  – {r['extra']}" if r.get("extra") else ""))
    print(f"\n{len(results) - len(failed)}/{len(results)} bestanden (WebKitGTK {WebKit2.get_major_version()}.{WebKit2.get_minor_version()}.{WebKit2.get_micro_version()})")
    Gtk.main_quit()
    sys.exit(code if code else (1 if failed else 0))


def on_result(obj, res):
    try:
        val = view.call_async_javascript_function_finish(res)
        results.extend(json.loads(val.to_string()))
    except Exception as e:  # noqa: BLE001
        results.append({"name": f"Phase {state['phase']} ohne Abbruch", "ok": False, "extra": str(e)[:300]})
        finish(1)
        return
    if state["phase"] == 1:
        state["phase"] = 2
        view.reload()
    else:
        view.get_snapshot(WebKit2.SnapshotRegion.VISIBLE, WebKit2.SnapshotOptions.NONE, None, on_snapshot)


def on_snapshot(_v, res):
    try:
        surface = view.get_snapshot_finish(res)
        os.makedirs(OUT, exist_ok=True)
        surface.write_to_png(os.path.join(OUT, "webkit.png"))
    except Exception as e:  # noqa: BLE001
        print("Bildschirmfoto nicht möglich:", e)
    finish(0)


def run_checks():
    body = f"const phase = {state['phase']};\nconst r = await (async () => {{\n{CHECKS}\n}})();\nreturn JSON.stringify(r);"
    view.call_async_javascript_function(body, -1, None, None, None, None, on_result)
    return False


def on_load(_v, event):
    if event == WebKit2.LoadEvent.FINISHED:
        GLib.timeout_add(1500, run_checks)


view.connect("load-changed", on_load)
GLib.timeout_add_seconds(240, lambda: (results.append({"name": "Zeitlimit", "ok": False, "extra": "240 s"}), finish(1)))
view.load_uri(URL)
Gtk.main()
