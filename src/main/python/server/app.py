# SPDX-License-Identifier: GPL-2.0-or-later
""" The local web server: security checks, API routes, live events and the built UI. """
import asyncio
import contextlib
import logging
import os
import secrets

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

from protocol.qmk_settings_codec import QmkSettingsCodec
from server import edits, model, schemas
from server.describe import parse
from server.device import NotConnected, KeyboardLocked

log = logging.getLogger(__name__)

COOKIE = "vial_session"

PLACEHOLDER_PAGE = """<!doctype html>
<html><head><meta charset="utf-8"><title>Vial</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem">
<h1>Vial server is running</h1>
<p>The web interface isn't built yet. The API is available under <code>/api</code>.</p>
</body></html>"""

NEED_TOKEN_PAGE = """<!doctype html>
<html><head><meta charset="utf-8"><title>Vial</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem">
<h1>Open Vial from its link</h1>
<p>For security, open the link Vial printed in its terminal window (it ends with <code>?token=...</code>).</p>
</body></html>"""


class EventHub:
    """ Tracks open UI tabs (WebSocket connections) and broadcasts events to them """

    def __init__(self, on_all_clients_gone=None, grace_seconds=3.0):
        self.clients = set()
        self.on_all_clients_gone = on_all_clients_gone
        self.grace_seconds = grace_seconds
        self.ever_connected = False

    async def add(self, ws):
        self.clients.add(ws)
        self.ever_connected = True

    async def remove(self, ws):
        self.clients.discard(ws)
        if not self.clients and self.on_all_clients_gone is not None:
            asyncio.get_running_loop().create_task(self._notify_if_still_empty())

    async def _notify_if_still_empty(self):
        await asyncio.sleep(self.grace_seconds)
        if not self.clients:
            self.on_all_clients_gone()

    async def broadcast(self, event):
        for ws in list(self.clients):
            try:
                await ws.send_json(event)
            except Exception:
                self.clients.discard(ws)


def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone=None,
               poll_interval=1.0, close_grace=3.0, instance_id=None):
    """
    manager: DeviceManager; names: NamesStore; token: session secret; port: the port the server listens on
    static_dir: built UI (web/dist) or None for a placeholder page
    on_all_clients_gone: called once the last UI tab has been closed for close_grace seconds
    """
    allowed_hosts = {"127.0.0.1:{}".format(port), "localhost:{}".format(port)}
    allowed_origins = {"http://" + h for h in allowed_hosts}
    hub = EventHub(on_all_clients_gone, close_grace)
    instance_id = instance_id or secrets.token_hex(8)

    @contextlib.asynccontextmanager
    async def lifespan(app):
        async def poll():
            while True:
                await asyncio.sleep(poll_interval)
                for event in await asyncio.to_thread(manager.check):
                    await hub.broadcast({"type": event})
        task = asyncio.create_task(poll()) if poll_interval else None
        yield
        if task:
            task.cancel()

    app = FastAPI(title="Vial", lifespan=lifespan)
    app.state.hub = hub

    def token_ok(value):
        return value is not None and secrets.compare_digest(value, token)

    @app.middleware("http")
    async def security(request: Request, call_next):
        if request.headers.get("host") not in allowed_hosts:
            return JSONResponse({"detail": "forbidden host"}, status_code=403)
        origin = request.headers.get("origin")
        if origin is not None and origin not in allowed_origins:
            return JSONResponse({"detail": "forbidden origin"}, status_code=403)
        path = request.url.path
        if path == "/api/health":
            return await call_next(request)
        if path == "/" and token_ok(request.query_params.get("token")):
            response = RedirectResponse("/", status_code=303)
            response.set_cookie(COOKIE, token, httponly=True, samesite="strict", path="/")
            return response
        if not token_ok(request.cookies.get(COOKIE)):
            if path.startswith("/api/"):
                return JSONResponse({"detail": "missing or wrong session token"}, status_code=401)
            return HTMLResponse(NEED_TOKEN_PAGE, status_code=401)
        return await call_next(request)

    @app.exception_handler(NotConnected)
    async def not_connected(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=503)

    @app.exception_handler(KeyboardLocked)
    async def locked(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=423)

    @app.exception_handler(ValueError)
    async def bad_value(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=422)

    @app.exception_handler(RuntimeError)
    async def device_error(request, exc):
        log.exception("keyboard error")
        return JSONResponse({"detail": "the keyboard didn't respond: {}".format(exc)}, status_code=502)

    def run(fn):
        return manager.run(fn)

    async def resync():
        """ After a write failed halfway: read the keyboard again and tell the UI to do the same """
        try:
            await asyncio.to_thread(manager.reload)
        except Exception:
            log.exception("could not re-read the keyboard after a failed write")
        if manager.connected:
            await hub.broadcast({"type": "reloaded"})

    def names_for(kb):
        return names.get(model.uid_of(kb))

    @app.get("/api/health")
    def health():
        return {"app": "vial", "instance": instance_id}

    @app.get("/api/session", response_model=schemas.Session)
    def session():
        return schemas.Session(status="connected" if manager.connected else "disconnected",
                               fake=manager.backend.fake, device=manager.title, error=manager.error)

    @app.get("/api/keyboard", response_model=schemas.KeyboardModel)
    def keyboard():
        return run(lambda kb: model.build(kb, names_for(kb), manager.unlocked))

    @app.post("/api/reload", response_model=schemas.KeyboardModel)
    async def reload():
        await asyncio.to_thread(manager.reload)
        await hub.broadcast({"type": "reloaded"})
        return run(lambda kb: model.build(kb, names_for(kb), manager.unlocked))

    @app.put("/api/keymap/{layer}/{row}/{col}", response_model=schemas.Described)
    def set_key(layer: int, row: int, col: int, body: schemas.SetKeycode):
        return run(lambda kb: edits.set_key(kb, layer, row, col, body.code))

    @app.put("/api/encoders/{layer}/{index}/{direction}", response_model=schemas.Described)
    def set_encoder(layer: int, index: int, direction: int, body: schemas.SetKeycode):
        return run(lambda kb: edits.set_encoder(kb, layer, index, direction, body.code))

    @app.put("/api/layout-options")
    def set_layout_options(body: schemas.SetLayoutOptions):
        return {"value": run(lambda kb: edits.set_layout_options(kb, body.value))}

    @app.get("/api/keycodes")
    def keycodes():
        return run(lambda kb: model.keycode_catalogue())

    @app.post("/api/keycodes/parse", response_model=schemas.Described)
    def parse_keycode(body: schemas.ParseRequest):
        return run(lambda kb: schemas.Described(**parse(body.expression)))

    @app.put("/api/tap-dance/{index}", response_model=schemas.TapDance)
    def set_tap_dance(index: int, body: schemas.TapDanceIn):
        return run(lambda kb: edits.set_tap_dance(kb, index, body, names_for(kb)))

    @app.put("/api/combos/{index}", response_model=schemas.Combo)
    def set_combo(index: int, body: schemas.ComboIn):
        return run(lambda kb: edits.set_combo(kb, index, body))

    @app.put("/api/key-overrides/{index}", response_model=schemas.KeyOverride)
    def set_key_override(index: int, body: schemas.KeyOverrideIn):
        return run(lambda kb: edits.set_key_override(kb, index, body))

    @app.put("/api/alt-repeat/{index}", response_model=schemas.AltRepeatKey)
    def set_alt_repeat_key(index: int, body: schemas.AltRepeatKeyIn):
        return run(lambda kb: edits.set_alt_repeat_key(kb, index, body))

    @app.put("/api/macros", response_model=schemas.Macros)
    def set_macros(body: schemas.MacrosIn):
        return run(lambda kb: edits.set_macros(kb, body, names_for(kb)))

    @app.get("/api/qmk-settings/definitions")
    def setting_definitions():
        QmkSettingsCodec.fields()
        return QmkSettingsCodec.settings_defs

    @app.put("/api/qmk-settings/{qsid}", response_model=schemas.QmkSetting)
    def set_setting(qsid: int, body: schemas.SettingIn):
        return schemas.QmkSetting(qsid=qsid, value=run(lambda kb: edits.set_setting(kb, qsid, body.value)))

    @app.post("/api/qmk-settings/reset", response_model=list[schemas.QmkSetting])
    def reset_settings():
        def do(kb):
            edits.reset_settings(kb)
            return [schemas.QmkSetting(qsid=q, value=v) for q, v in sorted(kb.settings.items())]
        return run(do)

    @app.put("/api/lighting", response_model=schemas.Lighting)
    def set_lighting(body: schemas.LightingIn):
        return run(lambda kb: edits.set_lighting(kb, body))

    @app.get("/api/names", response_model=schemas.Names)
    def get_names():
        return run(lambda kb: names_for(kb))

    @app.put("/api/names/{kind}/{index}", response_model=schemas.Names)
    def set_name(kind: str, index: int, body: schemas.NameIn):
        def do(kb):
            edits.check_name(kb, kind, index)
            return names.set(model.uid_of(kb), kind, index, body.name)
        return run(do)

    @app.get("/api/layout-file")
    def download_layout():
        data = run(lambda kb: kb.save_layout())
        return Response(data, media_type="application/json",
                        headers={"Content-Disposition": 'attachment; filename="keyboard.vil"'})

    @app.post("/api/layout-file", response_model=schemas.KeyboardModel)
    async def upload_layout(request: Request):
        data = await request.body()
        if len(data) > 1024 * 1024:
            raise ValueError("layout file is too large")
        writing = []

        def restore(kb):
            apply = edits.prepare_layout_file(kb, data)  # checks the whole file; nothing is written if it fails
            writing.append(True)
            apply()
            return model.build(kb, names_for(kb), manager.unlocked)

        try:
            result = await asyncio.to_thread(run, restore)
        except Exception:
            if writing:
                # part of the file may have been written: re-read the keyboard and make the UI do the same
                await resync()
            raise
        await hub.broadcast({"type": "reloaded"})
        return result

    @app.websocket("/api/events")
    async def events(ws: WebSocket):
        if ws.headers.get("host") not in allowed_hosts or \
                ws.headers.get("origin") not in allowed_origins or not token_ok(ws.cookies.get(COOKIE)):
            await ws.close(code=1008)
            return
        await ws.accept()
        await hub.add(ws)
        try:
            await ws.send_json({"type": "connected" if manager.connected else "disconnected"})
            while True:
                await ws.receive_text()
        except WebSocketDisconnect:
            pass
        finally:
            await hub.remove(ws)

    if static_dir and os.path.isdir(static_dir):
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="ui")
    else:
        @app.get("/", response_class=HTMLResponse)
        def placeholder():
            return PLACEHOLDER_PAGE

    return app
