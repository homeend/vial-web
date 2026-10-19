# SPDX-License-Identifier: GPL-2.0-or-later
""" The local web server: security checks, API routes, live events and the built UI. """
import asyncio
import contextlib
import logging
import os
import secrets
import urllib.parse
from typing import Annotated, Literal

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.openapi.utils import get_openapi
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

from protocol.qmk_settings_codec import QmkSettingsCodec
from server import edits, languages, model, schemas
from server.describe import keyboard_language, parse
from server.device import NotConnected, KeyboardLocked, KeyboardRefused

log = logging.getLogger(__name__)

MAX_LAYOUT_FILE = 1024 * 1024
""" largest .vil upload, in bytes """
UNLOCK_POLL_INTERVAL = 0.2
""" seconds between two readings of the unlock countdown, as Qt's unlocker """
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
<script>
// an open events connection is how Vial knows this tab is open, and tells in its terminal once all are closed
(function connect() {
  new WebSocket("ws://" + location.host + "/api/events").onclose = function () { setTimeout(connect, 2000); };
})();
</script>
</body></html>"""

NEED_TOKEN_PAGE = """<!doctype html>
<html><head><meta charset="utf-8"><title>Vial</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem">
<h1>Open Vial from its link</h1>
<p>For security, open the link Vial printed in its terminal window (it ends with <code>?token=...</code>).</p>
</body></html>"""


Lang = Annotated[str, Query(description="keyboard language the keys are labelled in, from /api/keyboard-languages")]


def content_disposition(filename):
    """ An attachment's header: the name as typed (RFC 5987, UTF-8), and an ASCII one for older clients """
    ascii_name = "".join(c if " " <= c <= "~" and c not in '"\\' else "_" for c in filename)
    return "attachment; filename=\"{}\"; filename*=UTF-8''{}".format(ascii_name, urllib.parse.quote(filename))


def cookie_name(port):
    """ The session cookie's name. Cookies don't keep ports apart, so two servers on 127.0.0.1 would overwrite each
    other's cookie under one name. """
    return "vial_session_{}".format(port)


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


def unlock_model(state):
    """ device.UnlockState -> schemas.UnlockState """
    return schemas.UnlockState(state=state.state, keys=[schemas.MatrixPosition(row=r, col=c) for r, c in state.keys],
                               remaining=state.remaining, total=state.total)


class UnlockFollower:
    """ Reads the countdown of the keyboard's unlock as Qt's unlocker does, every `interval` seconds until the unlock
    ends, and sends the events it brings with broadcast_events(events, progress). One task does that at a time.

    The task stops by itself before its next reading once it is no longer the one following (release(), a cancel) or
    the unlock is no longer followed (manager.poll_unlock then sends nothing): events it has taken are always sent
    first. Only shutdown() cancels it outright. """

    def __init__(self, manager, broadcast_events, interval):
        self.manager = manager
        self.broadcast_events = broadcast_events
        self.interval = interval
        self.task = None
        """ the task following the unlock, while there is one """
        self.stopping = False
        """ the server is stopping: nothing is followed any more """

    def start(self):
        """ Follow the unlock, unless that is being done already or the server is stopping """
        if self.task is None and not self.stopping:
            self.task = asyncio.get_running_loop().create_task(self._follow())

    def release(self):
        """ Stop following: the task ends before its next reading, after sending what it has read already """
        self.task = None

    async def shutdown(self):
        """ The server is stopping: cancel the task, and start none from now on """
        self.stopping = True
        task, self.task = self.task, None
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    async def _follow(self):
        me = asyncio.current_task()
        try:
            while True:
                await asyncio.sleep(self.interval)
                if self.task is not me or self.stopping:
                    return
                try:
                    state = await asyncio.to_thread(self.manager.poll_unlock)
                except NotConnected:
                    state = None
                except Exception:
                    log.exception("reading the unlock countdown failed")
                    state = await asyncio.to_thread(self.manager.cancel_unlock)
                events = await asyncio.to_thread(self.manager.take_events)
                done = state is None or state.state != "unlocking"
                if done and self.task is me:
                    self.task = None  # an unlock started from here on is followed anew
                await self.broadcast_events(events, progress=state is not None)
                if done:
                    return
        finally:
            if self.task is me:
                self.task = None


def create_app(manager, names, token, port, static_dir=None, on_all_clients_gone=None,
               poll_interval=1.0, close_grace=3.0, instance_id=None, unlock_interval=UNLOCK_POLL_INTERVAL):
    """
    manager: DeviceManager; names: NamesStore; token: session secret; port: the port the server listens on
    static_dir: built UI (web/dist) or None for a placeholder page
    on_all_clients_gone: called once the last UI tab has been closed for close_grace seconds
    poll_interval: seconds between hot-plug checks (0: none); unlock_interval: between readings of an unlock countdown
    """
    allowed_hosts = {"127.0.0.1:{}".format(port), "localhost:{}".format(port)}
    allowed_origins = {"http://" + h for h in allowed_hosts}
    hub = EventHub(on_all_clients_gone, close_grace)
    instance_id = instance_id or secrets.token_hex(8)
    cookie = cookie_name(port)

    async def broadcast_events(events, progress=False):
        """ Send the device manager's events to every tab, an "unlock" one with the unlock state. progress: send the
        unlock state even if it didn't change (a new reading of the countdown). An unlock to follow is followed. """
        # read in a thread: the device lock may be held for a while
        state = await asyncio.to_thread(manager.unlock_state)
        unlock = {"type": "unlock", "unlock": unlock_model(state).model_dump()}
        for event in events:
            await hub.broadcast(unlock if event == "unlock" else {"type": event})
        if progress and "unlock" not in events:
            await hub.broadcast(unlock)
        if state.state == "unlocking":
            follower.start()

    follower = UnlockFollower(manager, broadcast_events, unlock_interval)

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
                await broadcast_events(events)
        task = app.state.poll_task = asyncio.create_task(poll()) if poll_interval else None
        # a keyboard found waiting for an unlock started earlier: that is finished first
        if (await asyncio.to_thread(manager.unlock_state)).state == "unlocking":
            follower.start()
        try:
            yield
        finally:
            # the hot-plug poll first, as it starts following an unlock it sees; then nothing is followed any more
            follower.stopping = True
            if task:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
            await follower.shutdown()
            await hub.shutdown()

    app = FastAPI(title="Vial", lifespan=lifespan)
    app.state.hub = hub
    app.state.manager = manager
    app.state.unlock_follower = follower

    def openapi():
        # WebSocket messages have no place in OpenAPI's paths: the event shape is added as a component, so the UI's
        # types are generated for it too
        if app.openapi_schema is None:
            schema = get_openapi(title=app.title, version=app.version, routes=app.routes)
            components = schema.setdefault("components", {}).setdefault("schemas", {})
            event = schemas.Event.model_json_schema(ref_template="#/components/schemas/{model}")
            # the models it is made of are components like any other (the routes use them too)
            for name, definition in event.pop("$defs", {}).items():
                components.setdefault(name, definition)
            components["Event"] = event
            app.openapi_schema = schema
        return app.openapi_schema
    app.openapi = openapi

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
            response.set_cookie(cookie, token, httponly=True, samesite="strict", path="/")
            return response
        if not token_ok(request.cookies.get(cookie)):
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

    @app.exception_handler(KeyboardRefused)
    async def refused(request, exc):
        # it answered, and can't take the change: the page shows the message (a 502 would read "didn't respond")
        log.warning("%s", exc)
        return JSONResponse({"detail": str(exc)}, status_code=422)

    @app.exception_handler(RuntimeError)
    async def device_error(request, exc):
        log.exception("keyboard error")
        return JSONResponse({"detail": "the keyboard didn't respond: {}".format(exc)}, status_code=502)

    @app.exception_handler(Exception)
    async def unexpected_error(request, exc):
        # Starlette answers this one outside every middleware (and raises exc again afterwards, for the server to
        # log): the security headers are added here
        log.error("unexpected error in %s %s", request.method, request.url.path, exc_info=exc)
        return JSONResponse({"detail": "unexpected error, see vial.log"}, status_code=500, headers=SECURITY_HEADERS)

    def run(fn, lang=languages.DEFAULT):
        """ fn(keyboard) under the device lock; keycodes it describes are labelled in the keyboard language lang """
        with keyboard_language(languages.overrides(lang)):
            return manager.run(fn)

    def read(fn, lang=languages.DEFAULT):
        """ run(), for what only reads what was loaded: it works while the keyboard waits for its unlock keys too """
        with keyboard_language(languages.overrides(lang)):
            return manager.read(fn)

    def offline(fn, lang=languages.DEFAULT):
        """ fn() for what needs no keyboard (the keycode tables are those of the last keyboard read, or the
        defaults before the first): under the device lock, as a keyboard being read rebuilds those tables """
        with manager.lock, keyboard_language(languages.overrides(lang)):
            return fn()

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
        # fake: a second launch only attaches to an instance of its own mode (see vial_web.FAKE_SUBDIR)
        return {"app": "vial", "instance": instance_id, "fake": manager.backend.fake}

    @app.get("/api/session", response_model=schemas.Session)
    def session():
        with manager.lock:  # read together
            status = manager.status()
            unlock = unlock_model(manager.unlock_state())
        return schemas.Session(status="connected" if status.connected else "disconnected",
                               fake=manager.backend.fake, device=status.title, error=status.error, unlock=unlock)

    @app.get("/api/keyboard-languages", response_model=list[schemas.KeyboardLanguage])
    def keyboard_languages():
        return languages.catalogue()

    @app.get("/api/keyboard", response_model=schemas.KeyboardModel)
    def keyboard(lang: Lang = languages.DEFAULT):
        return read(lambda kb: model.build(kb, names_for(kb), manager.unlocked), lang)

    @app.post("/api/reload", response_model=schemas.KeyboardModel)
    async def reload(lang: Lang = languages.DEFAULT):
        languages.overrides(lang)  # an unknown language is refused before reading the keyboard

        def reload_and_build():
            with manager.lock:  # one hold of the lock: the reply shows exactly what was read
                manager.reload()
                return run(lambda kb: model.build(kb, names_for(kb), manager.unlocked), lang)
        # device access waits for the device lock: keep it off the event loop
        result = await asyncio.to_thread(reload_and_build)
        await hub.broadcast({"type": "reloaded"})
        return result

    @app.put("/api/keymap/{layer}/{row}/{col}", response_model=schemas.Described)
    def set_key(layer: int, row: int, col: int, body: schemas.SetKeycode, lang: Lang = languages.DEFAULT):
        return run(lambda kb: edits.set_key(kb, layer, row, col, body.code), lang)

    @app.put("/api/encoders/{layer}/{index}/{direction}", response_model=schemas.Described)
    def set_encoder(layer: int, index: int, direction: int, body: schemas.SetKeycode,
                    lang: Lang = languages.DEFAULT):
        return run(lambda kb: edits.set_encoder(kb, layer, index, direction, body.code), lang)

    @app.put("/api/layout-options", response_model=schemas.LayoutOptionsValue)
    def set_layout_options(body: schemas.SetLayoutOptions):
        return schemas.LayoutOptionsValue(value=run(lambda kb: edits.set_layout_options(kb, body.value)))

    @app.get("/api/keycodes", response_model=list[schemas.KeycodeCategory])
    def keycodes(lang: Lang = languages.DEFAULT):
        return offline(model.keycode_catalogue, lang)

    @app.post("/api/keycodes/parse", response_model=schemas.Described)
    def parse_keycode(body: schemas.ParseRequest, lang: Lang = languages.DEFAULT):
        return offline(lambda: schemas.Described(**parse(body.expression)), lang)

    @app.put("/api/tap-dance/{index}", response_model=schemas.TapDance)
    def set_tap_dance(index: int, body: schemas.TapDanceIn, lang: Lang = languages.DEFAULT):
        return run(lambda kb: edits.set_tap_dance(kb, index, body, names_for(kb)), lang)

    @app.put("/api/combos/{index}", response_model=schemas.Combo)
    def set_combo(index: int, body: schemas.ComboIn, lang: Lang = languages.DEFAULT):
        return run(lambda kb: edits.set_combo(kb, index, body), lang)

    @app.put("/api/key-overrides/{index}", response_model=schemas.KeyOverride)
    def set_key_override(index: int, body: schemas.KeyOverrideIn, lang: Lang = languages.DEFAULT):
        return run(lambda kb: edits.set_key_override(kb, index, body), lang)

    @app.put("/api/alt-repeat/{index}", response_model=schemas.AltRepeatKey)
    def set_alt_repeat_key(index: int, body: schemas.AltRepeatKeyIn, lang: Lang = languages.DEFAULT):
        return run(lambda kb: edits.set_alt_repeat_key(kb, index, body), lang)

    @app.put("/api/macros", response_model=schemas.Macros)
    def set_macros(body: schemas.MacrosIn, lang: Lang = languages.DEFAULT):
        return run(lambda kb: edits.set_macros(kb, body, names_for(kb)), lang)

    @app.get("/api/qmk-settings/definitions", response_model=schemas.SettingsDefinitions)
    def setting_definitions():
        """ Every QMK setting Vial knows, grouped as qmk_settings.json has them; the keyboard's model lists those it
        has (KeyboardModel.settings) """
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

    @app.post("/api/lighting/save", response_model=schemas.Lighting)
    def save_lighting():
        """ Keep the lighting the keyboard shows now when it is unplugged (changes are only shown until then, but for
        backlight breathing, which the firmware keeps at once with the backlight level it runs at). The reply is
        read back from the keyboard. """
        return run(edits.save_lighting)

    @app.get("/api/names", response_model=schemas.Names)
    def get_names():
        return read(lambda kb: names_for(kb))

    @app.put("/api/names/{kind}/{index}", response_model=schemas.Named)
    def set_name(kind: Literal["layers", "tapDance", "macros"], index: int, body: schemas.NameIn,
                 lang: Lang = languages.DEFAULT):
        def do(kb):
            edits.check_name(kb, kind, index)
            stored = names.set(model.uid_of(kb), kind, index, body.name)
            return model.display_name(kb, stored, kind, index)
        return read(do, lang)

    @app.get("/api/layout-file")
    def download_layout():
        data, name = read(lambda kb: (kb.save_layout(), model.layout_file_name(kb)))
        return Response(data, media_type="application/json",
                        headers={"Content-Disposition": content_disposition(name)})

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
    async def upload_layout(request: Request, lang: Lang = languages.DEFAULT):
        languages.overrides(lang)  # an unknown language is refused before anything is written
        data = await read_limited(request, MAX_LAYOUT_FILE)
        writing = []

        def restore(kb):
            apply = edits.prepare_layout_file(kb, data)  # checks the whole file; nothing is written if it fails
            writing.append(True)
            apply()
            return model.build(kb, names_for(kb), manager.unlocked)

        try:
            result = await asyncio.to_thread(run, restore, lang)
        except Exception:
            if writing:
                # part of the file may have been written: re-read the keyboard and make the UI do the same
                await resync()
            raise
        await hub.broadcast({"type": "reloaded"})
        return result

    @app.post("/api/layout-file/preview", response_model=schemas.LayoutFilePreview)
    async def preview_layout(request: Request, lang: Lang = languages.DEFAULT):
        """ What POST /api/layout-file would change with this file, checked the same way; nothing is written """
        languages.overrides(lang)
        data = await read_limited(request, MAX_LAYOUT_FILE)
        return await asyncio.to_thread(read, lambda kb: edits.preview_layout_file(kb, data, names_for(kb)), lang)

    @app.post("/api/unlock/start", response_model=schemas.UnlockState)
    async def start_unlock():
        """ Start unlocking the keyboard: the user then holds its unlock keys until the countdown ends, which "unlock"
        events follow. An unlocked keyboard stays as it is. """
        state = await asyncio.to_thread(manager.start_unlock)
        await broadcast_events(await asyncio.to_thread(manager.take_events))
        return unlock_model(state)

    @app.post("/api/unlock/cancel", response_model=schemas.UnlockState)
    async def cancel_unlock():
        """ Stop following an unlock. The keyboard keeps waiting for its unlock keys (it can't be called off) and takes
        no changes until it is unlocked or plugged in again. """
        state = await asyncio.to_thread(manager.cancel_unlock)
        # what is being read still reaches the tabs: the follower stops by itself
        follower.release()
        await broadcast_events(await asyncio.to_thread(manager.take_events))
        return unlock_model(state)

    @app.post("/api/lock", response_model=schemas.UnlockState)
    async def lock_keyboard():
        """ Lock the keyboard again """
        state = await asyncio.to_thread(manager.lock_keyboard)
        await broadcast_events(await asyncio.to_thread(manager.take_events))
        return unlock_model(state)

    @app.websocket("/api/events")
    async def events(ws: WebSocket):
        if ws.headers.get("host") not in allowed_hosts or \
                ws.headers.get("origin") not in allowed_origins or not token_ok(ws.cookies.get(cookie)):
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

    if manager.backend.fake:
        # for UI tests: unplug and replug the simulated keyboard. Never exists for real keyboards.
        @app.put("/api/simulator/connection", include_in_schema=False)
        def set_simulator_connection(body: schemas.SimulatorConnection):
            with manager.lock:
                manager.backend.set_connected(body.connected)
            return {"connected": body.connected}

        # for UI tests: the user holds the simulated keyboard's unlock keys, or lets go of them; or it is locked, as
        # plugging it in again would. Never exists for real keyboards.
        @app.put("/api/simulator/unlock", include_in_schema=False)
        async def set_simulator_unlock(body: schemas.SimulatorUnlock):
            def change():
                with manager.lock:
                    virtual = manager.backend.virtual
                    if virtual is None:  # nothing has looked for the keyboard yet
                        raise NotConnected("no simulated keyboard yet")
                    if body.keysHeld is not None:
                        virtual.hold_unlock_keys(body.keysHeld)
                    if body.locked:
                        virtual.unlocked = False
                        manager.read_unlocked()
                    return manager.unlock_state()
            state = await asyncio.to_thread(change)
            await broadcast_events(await asyncio.to_thread(manager.take_events))
            return unlock_model(state)

    if static_dir and os.path.isdir(static_dir):
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="ui")
    else:
        @app.get("/", response_class=HTMLResponse, include_in_schema=False)
        def placeholder():
            return PLACEHOLDER_PAGE

    return app
