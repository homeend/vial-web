# SPDX-License-Identifier: GPL-2.0-or-later
""" The local web server: security checks, API routes, live events and the built UI. """
import asyncio
import contextlib
import logging
import os
import secrets

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

from protocol.qmk_settings_codec import QmkSettingsCodec
from server import edits, model, schemas
from server.describe import parse
from server.device import NotConnected, KeyboardLocked

log = logging.getLogger(__name__)

COOKIE = "vial_session"
MAX_LAYOUT_FILE = 1024 * 1024
""" largest .vil upload, in bytes """
SECURITY_HEADERS = {
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
}

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

    def __init__(self, on_all_clients_gone=None, grace_seconds=3.0, send_timeout=1.0):
        self.clients = set()
        self.on_all_clients_gone = on_all_clients_gone
        self.grace_seconds = grace_seconds
        self.send_timeout = send_timeout
        self._gone_timer = None
        self._closing = {}
        """ socket -> task closing it """

    async def add(self, ws):
        self.clients.add(ws)
        self.stop()

    async def remove(self, ws):
        self.clients.discard(ws)
        if not self.clients and self.on_all_clients_gone is not None:
            # one timer at a time: a tab closed, reopened and closed again counts from the last close
            self.stop()
            self._gone_timer = asyncio.get_running_loop().create_task(self._notify_if_still_empty())

    def stop(self):
        """ Cancel a pending "all tabs closed" notification """
        if self._gone_timer is not None:
            self._gone_timer.cancel()
            self._gone_timer = None

    async def _notify_if_still_empty(self):
        await asyncio.sleep(self.grace_seconds)
        self._gone_timer = None
        if not self.clients:
            self.on_all_clients_gone()

    async def _send(self, ws, event):
        try:
            await asyncio.wait_for(ws.send_json(event), self.send_timeout)
        except Exception as e:
            # a tab that stopped reading (or whose connection broke) must not hold up the others
            log.info("dropping a UI tab from events: %s", e.__class__.__name__)
            self.clients.discard(ws)
            # close it, so the tab notices and reconnects instead of silently missing events; in the background,
            # as a stalled connection may not close quickly either. Once: concurrent broadcasts can both drop it.
            if ws not in self._closing:
                task = asyncio.get_running_loop().create_task(self._close(ws))
                self._closing[ws] = task
                task.add_done_callback(lambda done: self._closing.pop(ws, None))

    async def _close(self, ws):
        try:
            await asyncio.wait_for(ws.close(code=1011), self.send_timeout)
        except Exception as e:
            log.info("closing a dropped UI tab failed: %s", e.__class__.__name__)

    async def broadcast(self, event):
        await asyncio.gather(*(self._send(ws, event) for ws in list(self.clients)))

    async def shutdown(self):
        """ Server stopping: cancel the "all tabs closed" timer and any socket closes still running """
        self.stop()
        tasks = list(self._closing.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


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
                try:
                    events = await asyncio.to_thread(manager.check)
                except Exception:
                    log.exception("checking for the keyboard failed")
                    continue
                for event in events:
                    await hub.broadcast({"type": event})
        task = app.state.poll_task = asyncio.create_task(poll()) if poll_interval else None
        try:
            yield
        finally:
            await hub.shutdown()
            if task:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task

    app = FastAPI(title="Vial", lifespan=lifespan)
    app.state.hub = hub

    def token_ok(value):
        # as bytes: compare_digest refuses str with non-ASCII characters
        return value is not None and secrets.compare_digest(value.encode("utf-8", "replace"), token.encode("utf-8"))

    @app.middleware("http")
    async def security(request: Request, call_next):
        response = await check_request(request, call_next)
        response.headers.update(SECURITY_HEADERS)
        return response

    async def check_request(request, call_next):
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

    @app.exception_handler(RecursionError)
    async def too_deep(request, exc):
        return JSONResponse({"detail": "the request is nested too deeply"}, status_code=422)

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
        except NotConnected:
            log.info("could not re-read the keyboard after a failed write: it is disconnected")
        except Exception as e:
            # DeviceManager.reload has logged the failure already
            log.warning("could not re-read the keyboard after a failed write: %s", e)
        if manager.connected:
            await hub.broadcast({"type": "reloaded"})

    def names_for(kb):
        return names.get(model.uid_of(kb))

    @app.get("/api/health")
    def health():
        return {"app": "vial", "instance": instance_id}

    @app.get("/api/session", response_model=schemas.Session)
    def session():
        status = manager.status()
        return schemas.Session(status="connected" if status.connected else "disconnected",
                               fake=manager.backend.fake, device=status.title, error=status.error)

    @app.get("/api/keyboard", response_model=schemas.KeyboardModel)
    def keyboard():
        return run(lambda kb: model.build(kb, names_for(kb), manager.unlocked))

    @app.post("/api/reload", response_model=schemas.KeyboardModel)
    async def reload():
        def reload_and_build():
            with manager.lock:  # one hold of the lock: the reply shows exactly what was read
                manager.reload()
                return run(lambda kb: model.build(kb, names_for(kb), manager.unlocked))
        # device access waits for the device lock: keep it off the event loop
        result = await asyncio.to_thread(reload_and_build)
        await hub.broadcast({"type": "reloaded"})
        return result

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

    async def read_limited(request, limit):
        """ The request body, refused with 413 as soon as it is known to be larger than limit """
        too_large = HTTPException(413, "the file is too large (at most {} KiB)".format(limit // 1024))
        length = request.headers.get("content-length")
        if length is not None and length.isdigit() and int(length) > limit:
            raise too_large
        data = bytearray()
        async for chunk in request.stream():
            data += chunk
            if len(data) > limit:
                raise too_large
        return bytes(data)

    @app.post("/api/layout-file", response_model=schemas.KeyboardModel)
    async def upload_layout(request: Request):
        data = await read_limited(request, MAX_LAYOUT_FILE)
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
