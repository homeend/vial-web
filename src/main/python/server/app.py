# SPDX-License-Identifier: GPL-2.0-or-later
""" The local web server: security checks, API routes, live events and the built UI. """
import asyncio
import contextlib
import json
import logging
import os
import secrets
import sys
import urllib.parse
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.openapi.utils import get_openapi
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.requests import HTTPConnection

from protocol.qmk_settings_codec import QmkSettingsCodec
from server import device, edits, languages, model, schemas
from server.describe import keyboard_language, parse
from server.device import KeyboardChanged, NotConnected, KeyboardLocked, KeyboardRefused, UnknownKeyboard

log = logging.getLogger(__name__)

MAX_LAYOUT_FILE = 1024 * 1024
""" largest .vil upload, in bytes """
UNLOCK_POLL_INTERVAL = 0.2
""" seconds between two readings of the unlock countdown, as Qt's unlocker """
MATRIX_POLL_INTERVAL = 0.05
""" seconds from one reading of the switch matrix to the next while a tab watches it: 20 a second (Qt's tester reads
it every 20 ms, and the unlock state as well each time) """
MATRIX_POLL_GAP = 0.02
""" seconds the keyboard is left alone at least after each reading of the matrix, however long that took: other
requests (edits, the unlock countdown) take the device lock in between """
MATRIX_FAILURE_PAUSE = 0.5
""" seconds the keyboard is left alone after a reading of the matrix that failed, before the next one """
KEYBOARD_HEADER = "x-vial-keyboard"
""" the keyboard a change is meant for (see create_app's keyboard_meant) """
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


class MatrixWatcher:
    """ Reads the switch matrix every `interval` seconds while at least one tab watches it, and sends each tab what is
    held whenever that changes (a tab that starts watching gets the last reading at once). One task reads it, and stops
    when no tab watches any more. After each reading the keyboard is left alone for at least `gap` seconds, so that
    other requests get the device lock between two readings; after a reading that failed, for `failure_pause` seconds.
    `send(ws, event)` sends to one tab; a tab it drops is no longer watching. `on_start()`, awaited when the task starts,
    before its first reading, reads what the readings depend on (the unlock state). """

    def __init__(self, manager, send, interval, gap, failure_pause=MATRIX_FAILURE_PAUSE, on_start=None,
                 sleep=asyncio.sleep):
        self.manager = manager
        self.send = send
        self.interval = interval
        self.gap = gap
        self.failure_pause = failure_pause
        self.on_start = on_start
        self.sleep = sleep
        self.watchers = set()
        self.task = None
        self.last = None
        """ the last reading sent (schemas.MatrixState), while the task runs """
        self.stopping = False
        self.failing = False
        """ the last reading failed: the next failure isn't logged again """

    async def watch(self, ws):
        """ The tab starts watching (again: nothing changes); nothing once the server is stopping """
        if ws in self.watchers or self.stopping:
            return
        self.watchers.add(ws)
        if self.last is not None:
            await self._send_to([ws], self.last)
        if self.task is None:
            self.task = asyncio.get_running_loop().create_task(self._read())

    def unwatch(self, ws):
        """ The tab stops watching, or has gone; the task stops before its next reading once none watches """
        self.watchers.discard(ws)

    def drop(self):
        """ The keyboard read was closed (another one was chosen): no tab watches it any more, and a reading on its way
        reaches none. A tab watches the keyboard open now once it asks again. """
        self.watchers.clear()
        self.last = None

    async def shutdown(self):
        """ The server is stopping: cancel the task, and start none from now on """
        self.stopping = True
        self.watchers.clear()
        self.last = None
        task, self.task = self.task, None
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    def _reading(self):
        """ One reading, as the tabs get it, or None when it failed (run in a worker thread: the device lock may be
        held for a while) """
        try:
            reading = self.manager.poll_matrix()
        except NotConnected:
            return schemas.MatrixState(state="disconnected", pressed=[])
        except Exception as e:
            # the keyboard didn't answer this time: the tabs keep what they have
            if not self.failing:
                log.warning("reading the switch matrix failed: %s", e)
            self.failing = True
            return None
        self.failing = False
        return schemas.MatrixState(state=reading.state,
                                   pressed=[schemas.MatrixPosition(row=r, col=c) for r, c in reading.pressed])

    async def _read(self):
        device.meant_for.set(None)  # started by a request maybe: the readings are meant for whichever keyboard is open
        me = asyncio.current_task()
        loop = asyncio.get_running_loop()
        try:
            if self.on_start is not None:
                await self.on_start()
            while self.watchers and self.task is me and not self.stopping:
                started = loop.time()
                state = await asyncio.to_thread(self._reading)
                if state is not None and state != self.last and self.task is me:
                    self.last = state
                    await self._send_to(list(self.watchers), state)
                # a failure may come at once, again and again (a handle that stopped working), each checking whether
                # the keyboard is still plugged in (an HID enumeration): not 20 times a second
                await self.sleep(self.failure_pause if state is None
                                 else max(self.interval - (loop.time() - started), self.gap))
        finally:
            if self.task is me:
                self.task = None
                self.last = None

    async def _send_to(self, tabs, state):
        event = {"type": "matrix", "matrix": state.model_dump()}
        await asyncio.gather(*(self.send(ws, event) for ws in tabs))


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
        device.meant_for.set(None)  # started by a request: what it reads is for whichever keyboard is open
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
               poll_interval=1.0, close_grace=3.0, instance_id=None, unlock_interval=UNLOCK_POLL_INTERVAL,
               matrix_interval=MATRIX_POLL_INTERVAL, matrix_gap=MATRIX_POLL_GAP):
    """
    manager: DeviceManager; names: NamesStore; token: session secret; port: the port the server listens on
    static_dir: built UI (web/dist) or None for a placeholder page
    on_all_clients_gone: called once the last UI tab has been closed for close_grace seconds
    poll_interval: seconds between hot-plug checks (0: none); unlock_interval: between readings of an unlock countdown
    matrix_interval, matrix_gap: the matrix tester's readings (MatrixWatcher)
    """
    allowed_hosts = {"127.0.0.1:{}".format(port), "localhost:{}".format(port)}
    allowed_origins = {"http://" + h for h in allowed_hosts}
    hub = EventHub(on_all_clients_gone, close_grace)
    instance_id = instance_id or secrets.token_hex(8)
    cookie = cookie_name(port)

    keyboards_told = [manager.changes]
    """ manager.changes when the tabs were last told the keyboards changed """

    async def broadcast_events(events, progress=False):
        """ Send the device manager's events to every tab, an "unlock" one with the unlock state. progress: send the
        unlock state even if it didn't change (a new reading of the countdown). An unlock to follow is followed. Then
        a "keyboards" event if the list of keyboards, the one chosen or open, or the error changed since the last. """
        # read in a thread: the device lock may be held for a while
        state = await asyncio.to_thread(manager.unlock_state)
        unlock = {"type": "unlock", "unlock": unlock_model(state).model_dump()}
        for event in events:
            await hub.broadcast(unlock if event == "unlock" else {"type": event})
        if progress and "unlock" not in events:
            await hub.broadcast(unlock)
        if state.state == "unlocking":
            follower.start()
        if manager.changes != keyboards_told[0]:
            keyboards_told[0] = manager.changes
            await hub.broadcast({"type": "keyboards"})

    follower = UnlockFollower(manager, broadcast_events, unlock_interval)

    async def send_to_watcher(ws, event):
        await hub._send(ws, event)
        if ws not in hub.clients:  # dropped: it no longer watches either
            matrix.unwatch(ws)

    async def read_unlock_state():
        """ Before the matrix tester's first reading: the keyboard may have been locked behind the server's back (by
        another app), and would then show nothing held. Read, it is "locked" (and every tab is told). """
        try:
            await asyncio.to_thread(manager.read_unlocked)
        except Exception as e:  # no keyboard, or it didn't answer: the readings say so
            log.info("reading the unlock state for the matrix tester failed: %s", e)
        await broadcast_events(await asyncio.to_thread(manager.take_events))

    matrix = MatrixWatcher(manager, send_to_watcher, matrix_interval, matrix_gap, on_start=read_unlock_state)

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
            await matrix.shutdown()
            await hub.shutdown()

    async def keyboard_meant(connection: HTTPConnection):
        """ The keyboard a page means its request for: the X-Vial-Keyboard header (KeyboardEntry.id, percent-encoded),
        which a page sends with each change. DeviceManager refuses a change meant for another keyboard than the one
        open (409): another tab switched keyboards meanwhile. Without the header, any keyboard; a read (GET) is never
        refused. """
        wanted = connection.headers.get(KEYBOARD_HEADER)
        change = connection.scope.get("method") not in (None, "GET", "HEAD")
        device.meant_for.set(urllib.parse.unquote(wanted) if wanted and change else None)

    app = FastAPI(title="Vial", lifespan=lifespan, dependencies=[Depends(keyboard_meant)])
    app.state.hub = hub
    app.state.manager = manager
    app.state.unlock_follower = follower
    app.state.matrix = matrix

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

    @app.exception_handler(KeyboardChanged)
    async def changed(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=409)

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
            error_kind, open_id = manager.error_kind, manager.open_id
        return schemas.Session(status="connected" if status.connected else "disconnected",
                               fake=manager.backend.fake, device=status.title, error=status.error, errorKind=error_kind,
                               keyboard=open_id, platform=sys.platform, unlock=unlock)

    def keyboard_list():
        listed = manager.keyboard_list()
        return schemas.KeyboardList(
            keyboards=[schemas.KeyboardEntry(id=e.info.id, name=e.info.name, manufacturer=e.info.manufacturer,
                                             vendorId=e.info.vendor_id, productId=e.info.product_id,
                                             serial=e.info.serial, path=e.info.path,
                                             open=e.info.id == listed.open, plugged=e.plugged)
                       for e in listed.entries],
            chosen=listed.chosen)

    @app.get("/api/keyboards", response_model=schemas.KeyboardList)
    def keyboards():
        """ The Vial keyboards plugged in (as the hot-plug poll last found them, about once a second), and the chosen
        one while it is unplugged """
        return keyboard_list()

    @app.post("/api/keyboards/select", response_model=schemas.KeyboardList)
    async def select_keyboard(body: schemas.SelectKeyboard):
        """ Use this keyboard from now on, while the server runs. The one open is closed, and whatever waited on it
        stops (an unlock being followed, the matrix tester); the chosen one is opened, and read ("connected"), or the
        session says why it couldn't be. The chosen keyboard unplugged is opened again once it is plugged back in; no
        other is opened meanwhile. 404 when no keyboard of that id is plugged in (and it wasn't the chosen one). """
        try:
            switched = await asyncio.to_thread(manager.select, body.id)
        except UnknownKeyboard as e:
            raise HTTPException(404, str(e))
        if switched or not manager.connected:
            matrix.drop()
        await broadcast_events(await asyncio.to_thread(manager.take_events))
        return await asyncio.to_thread(keyboard_list)

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

    @app.post("/api/macros/parse", response_model=list[schemas.MacroAction])
    def parse_macro_text(body: schemas.MacroTextIn, lang: Lang = languages.DEFAULT):
        """ A macro as Qt's text editor has it (JSON: [["text", "hi"], ["tap", "KC_ENTER"], ["delay", 50]...]) read
        as steps for this keyboard, checked as a save checks them; 422 says what is wrong. Nothing is written: the
        page puts the steps in the macro being edited, and saves them with PUT /api/macros. """
        return read(lambda kb: edits.parse_macro_text(kb, body.text), lang)

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

    @app.post("/api/bootloader", response_model=schemas.Session)
    async def reboot_to_bootloader():
        """ Restart the keyboard into its bootloader (to flash it): it stops working as a keyboard and leaves Vial until
        it is flashed or plugged in again. Refused (423) while it is locked. Returns the session, without it. """
        try:
            await asyncio.to_thread(manager.reboot_to_bootloader)
        finally:
            await broadcast_events(await asyncio.to_thread(manager.take_events))
        return await asyncio.to_thread(session)

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
                await on_message(ws, await ws.receive_text())
        except WebSocketDisconnect:
            pass
        finally:
            matrix.unwatch(ws)
            await hub.remove(ws)

    async def on_message(ws, text):
        """ What a tab asks for: {"type": "matrix", "watch": true} (or false) to get the keys held, or not. Anything
        else is ignored. """
        try:
            message = json.loads(text)
        except (ValueError, RecursionError):
            return
        if isinstance(message, dict) and message.get("type") == "matrix" and isinstance(message.get("watch"), bool):
            if message["watch"]:
                await matrix.watch(ws)
            else:
                matrix.unwatch(ws)

    if manager.backend.fake:
        # for UI tests: unplug and replug the simulated keyboard. Never exists for real keyboards.
        @app.put("/api/simulator/connection", include_in_schema=False)
        def set_simulator_connection(body: schemas.SimulatorConnection):
            with manager.lock:
                manager.backend.set_connected(body.connected)
            return {"connected": body.connected}

        # for UI tests: plug a second simulated keyboard in, or unplug it. Never exists for real keyboards.
        @app.put("/api/simulator/second-keyboard", include_in_schema=False)
        def set_simulator_second_keyboard(body: schemas.SimulatorSecondKeyboard):
            with manager.lock:
                manager.backend.set_second_connected(body.connected, unreadable=body.unreadable)
            return {"connected": body.connected}

        # for UI tests: a key of the simulated keyboard's matrix is pressed or let go (the matrix tester shows it). Never
        # exists for real keyboards.
        @app.put("/api/simulator/matrix", include_in_schema=False)
        def set_simulator_press(body: schemas.SimulatorPress):
            with manager.lock:
                virtual = manager.backend.virtual
                if virtual is None:  # nothing has looked for the keyboard yet
                    raise NotConnected("no simulated keyboard yet")
                (virtual.press if body.pressed else virtual.release)(body.row, body.col)
                return {"pressed": sorted(virtual.pressed)}

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
