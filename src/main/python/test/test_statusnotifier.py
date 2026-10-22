""" statusnotifier: Vial's tray icon on Linux as a StatusNotifierItem over D-Bus.

The pure parts (pixmaps, the menu's layout and events) are tested wherever dbus-fast imports; the bus tests run on
Linux only, each against a dbus-daemon of its own with a panel standing in: the StatusNotifier watcher (with a host)
and the notification service, both faked with dbus-fast too, as the icon's counterparts. """
import asyncio
import logging
import os
import shutil
import subprocess
import sys
import threading
import time

import pytest

import statusnotifier
import tray
from statusnotifier import (ACTIVE, ITEM, ITEM_PATH, MENU, MENU_PATH, NOTIFICATIONS, NOTIFICATIONS_PATH, PASSIVE,
                            PIXMAP_SIZES, ROOT, WATCHER, WATCHER_PATH, Item)

pytestmark = pytest.mark.skipif(not statusnotifier.AVAILABLE, reason="dbus-fast can't be used here")

needs_a_bus = pytest.mark.skipif(not sys.platform.startswith("linux") or shutil.which("dbus-daemon") is None,
                                 reason="the bus tests need Linux and dbus-daemon")


def labels(layout):
    """ the labels of a dbusmenu layout's children """
    return [child.value[1]["label"].value for child in layout[2]]


def an_icon(opened=None, quit_used=None):
    opened, quit_used = [] if opened is None else opened, [] if quit_used is None else quit_used
    return statusnotifier.Icon("vial", tray.image(), "Vial (simulated keyboard)",
                               [Item(tray.OPEN, lambda: opened.append(True), default=True),
                                Item(tray.QUIT, lambda: quit_used.append(True))])


# -- the pure parts --

def test_pixmaps_are_the_image_at_each_size_as_argb32_in_network_order():
    maps = statusnotifier.pixmaps(tray.image(), (16, 64))
    assert [(w, h, len(data)) for w, h, data in maps] == [(16, 16, 16 * 16 * 4), (64, 64, 64 * 64 * 4)]
    width, height, data = maps[1]
    assert tuple(data[0:4])[0] == 0  # the corner: rounded off, transparent (alpha first)
    edge = (32 * width + 1) * 4  # the square's left edge, half way down: the background, opaque
    assert tuple(data[edge:edge + 4]) == (255, *tray.IMAGE_BACKGROUND[:3])
    centre = (32 * width + 32) * 4  # the logo's blue
    assert data[centre] == 255 and data[centre + 3] > data[centre + 1] + 50


def test_the_icon_offers_every_pixmap_size():
    assert [(w, h) for w, h, data in an_icon().pixmaps] == [(size, size) for size in PIXMAP_SIZES]


def test_image_data_is_the_image_as_rgba_rows():
    image = tray.image()
    width, height, stride, has_alpha, bits, channels, data = statusnotifier.image_data(image)
    assert (width, height, stride, has_alpha, bits, channels) == (image.width, image.height, image.width * 4, True, 8, 4)
    assert len(data) == image.width * image.height * 4


def test_the_menus_layout_is_the_items_under_the_root():
    icon = an_icon()
    layout = icon.layout()
    assert layout[0] == ROOT and layout[1]["children-display"].value == "submenu"
    assert labels(layout) == [tray.OPEN, tray.QUIT]
    first = layout[2][0].value
    assert first[0] == 1 and first[2] == []
    assert {name: variant.value for name, variant in first[1].items()} == {
        "type": "standard", "label": tray.OPEN, "enabled": True, "visible": True}
    assert icon.layout(ROOT, 0) == [ROOT, icon.properties(ROOT), []]  # depth 0: the root alone
    assert icon.layout(2) == [2, icon.properties(2), []]
    assert icon.layout(9) is None
    assert list(icon.properties(1, ["label", "no-such"])) == ["label"]


def test_a_chosen_entry_runs_its_action_and_other_events_do_not():
    opened, quit_used = [], []
    icon = an_icon(opened, quit_used)
    assert icon.event(2, "clicked")
    assert icon.event(1, "hovered") and icon.event(1, "opened")
    assert not icon.event(9, "clicked")
    assert (opened, quit_used) == ([], [True])


def test_a_click_on_the_icon_runs_the_default_entry():
    opened, quit_used = [], []
    an_icon(opened, quit_used).activated()
    assert (opened, quit_used) == ([True], [])


def test_an_action_that_fails_is_logged_not_raised(caplog):
    def fail():
        raise RuntimeError("no browser")
    icon = statusnotifier.Icon("vial", tray.image(), "Vial", [Item(tray.OPEN, fail, default=True)])
    with caplog.at_level(logging.ERROR):
        icon.activated()
    assert "the tray icon's Open Vial failed" in caplog.text


def test_the_status_follows_visible():
    icon = an_icon()
    assert icon.status == PASSIVE and not icon.visible
    icon.visible = True  # not running: nothing to tell
    assert icon.status == ACTIVE
    icon.visible = False
    assert icon.status == PASSIVE


def test_stop_and_notify_do_nothing_or_say_so_when_the_icon_is_not_running():
    icon = an_icon()
    icon.stop()
    with pytest.raises(RuntimeError):
        icon.notify("hello")


def test_make_is_for_linux(monkeypatch):
    monkeypatch.setattr(sys, "platform", "win32")
    assert statusnotifier.make("vial", tray.image(), "Vial", []) == (None, "not Linux")


# -- on the bus --

@pytest.fixture
def session_bus(monkeypatch):
    """ a dbus-daemon of this test's own, as the session bus """
    daemon = subprocess.Popen(["dbus-daemon", "--session", "--nofork", "--print-address"], stdout=subprocess.PIPE,
                              text=True)
    try:
        address = daemon.stdout.readline().strip()
        assert address, "dbus-daemon printed no address"
        monkeypatch.setenv("DBUS_SESSION_BUS_ADDRESS", address)
        yield address
    finally:
        daemon.terminate()
        daemon.wait(5)


class Panel:
    """ A panel standing in, on the session bus in a thread of its own: the StatusNotifier watcher (with a host,
    unless hosted is False) and the notification service. Records registrations and notifications; do() runs a
    coroutine, given the bus, on the panel's loop. """

    def __init__(self, hosted=True):
        self.hosted = hosted
        self.registered, self.notifications = [], []
        self.loop = self.bus = self.stopped = None
        self.ready = threading.Event()
        self.thread = threading.Thread(target=lambda: asyncio.run(self._main()), name="panel", daemon=True)
        self.thread.start()
        assert self.ready.wait(10), "the panel didn't get on the bus"

    async def _main(self):
        from dbus_fast.aio import MessageBus
        from dbus_fast.service import PropertyAccess, ServiceInterface, dbus_method, dbus_property, dbus_signal
        panel = self

        class Watcher(ServiceInterface):
            def __init__(self):
                super().__init__(WATCHER)

            @dbus_method()
            def RegisterStatusNotifierItem(self, service: "s"):
                panel.registered.append(service)
                self.StatusNotifierItemRegistered(service)

            @dbus_method()
            def RegisterStatusNotifierHost(self, service: "s"):
                pass

            @dbus_property(access=PropertyAccess.READ)
            def RegisteredStatusNotifierItems(self) -> "as":
                return list(panel.registered)

            @dbus_property(access=PropertyAccess.READ)
            def IsStatusNotifierHostRegistered(self) -> "b":
                return panel.hosted

            @dbus_property(access=PropertyAccess.READ)
            def ProtocolVersion(self) -> "i":
                return 0

            @dbus_signal()
            def StatusNotifierItemRegistered(self, service) -> "s":
                return service

        class Notifications(ServiceInterface):
            def __init__(self):
                super().__init__(NOTIFICATIONS)

            @dbus_method()
            def Notify(self, app_name: "s", replaces_id: "u", app_icon: "s", summary: "s", body: "s", actions: "as",
                       hints: "a{sv}", expire_timeout: "i") -> "u":
                panel.notifications.append((app_name, replaces_id, summary, body,
                                            {name: value.value for name, value in hints.items()}))
                return 7

        self.loop = asyncio.get_running_loop()
        self.stopped = asyncio.Event()
        self.bus = await MessageBus().connect()
        try:
            self.bus.export(WATCHER_PATH, Watcher())
            await self.bus.request_name(WATCHER)
            self.bus.export(NOTIFICATIONS_PATH, Notifications())
            await self.bus.request_name(NOTIFICATIONS)
            self.ready.set()
            await self.stopped.wait()
        finally:
            self.bus.disconnect()

    def do(self, coroutine_function, timeout=10):
        return asyncio.run_coroutine_threadsafe(coroutine_function(self.bus), self.loop).result(timeout)

    def close(self):
        self.loop.call_soon_threadsafe(self.stopped.set)
        self.thread.join(10)

    # -- what a panel does with an item --

    async def _interface(self, bus, bus_name, path, interface):
        introspection = await bus.introspect(bus_name, path)
        return bus.get_proxy_object(bus_name, path, introspection).get_interface(interface)

    def item_properties(self, bus_name):
        async def read(bus):
            item = await self._interface(bus, bus_name, ITEM_PATH, ITEM)
            return {"Id": await item.get_id(), "Title": await item.get_title(), "Status": await item.get_status(),
                    "Menu": await item.get_menu(), "ItemIsMenu": await item.get_item_is_menu(),
                    "ToolTip": await item.get_tool_tip(), "Category": await item.get_category(),
                    "IconPixmap": [(w, h, len(data)) for w, h, data in await item.get_icon_pixmap()]}
        return self.do(read)

    def layout(self, bus_name):
        async def read(bus):
            menu = await self._interface(bus, bus_name, MENU_PATH, MENU)
            return await menu.call_get_layout(ROOT, -1, [])
        return self.do(read)

    def choose(self, bus_name, id):
        from dbus_fast import Variant

        async def click(bus):
            menu = await self._interface(bus, bus_name, MENU_PATH, MENU)
            await menu.call_event(id, "clicked", Variant("i", 0), 0)
        self.do(click)

    def click(self, bus_name):
        async def activate(bus):
            item = await self._interface(bus, bus_name, ITEM_PATH, ITEM)
            await item.call_activate(0, 0)
        self.do(activate)

    def has_owner(self, bus_name):
        async def ask(bus):
            dbus = await self._interface(bus, "org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus")
            return await dbus.call_name_has_owner(bus_name)
        return self.do(ask)

    def restart_the_watcher(self):
        async def again(bus):
            await bus.release_name(WATCHER)
            await bus.request_name(WATCHER)
        self.do(again)


@pytest.fixture
def panel(session_bus):
    panel = Panel()
    yield panel
    panel.close()


class Running:
    """ An icon made by statusnotifier.make, running (icon.run in a thread, as tray.run would in the main one) with
    a setup that shows it and waits for stop() to be asked """

    def __init__(self):
        self.opened, self.quit_used = [], []
        self.icon, problem = statusnotifier.make("vial", tray.image(), "Vial (simulated keyboard)",
                                                 [Item(tray.OPEN, lambda: self.opened.append(True), default=True),
                                                  Item(tray.QUIT, lambda: self.quit_used.append(True))])
        assert self.icon is not None, problem
        self.shown, self.leave = threading.Event(), threading.Event()
        self.thread = threading.Thread(target=self.icon.run, kwargs={"setup": self._setup}, name="icon loop")
        self.thread.start()
        assert self.shown.wait(10), "the icon didn't get on the bus"

    def _setup(self, icon):
        icon.visible = True
        self.shown.set()
        self.leave.wait(10)
        icon.stop()

    def stop(self):
        self.leave.set()
        self.thread.join(10)
        assert not self.thread.is_alive()


def soon(condition, timeout=5.0):
    """ True once condition() holds, within timeout seconds """
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if condition():
            return True
        time.sleep(0.02)
    return condition()


@needs_a_bus
def test_the_icon_registers_with_the_watcher_and_the_panel_reads_it(panel):
    running = Running()
    try:
        icon = running.icon
        assert icon.bus_name == "org.kde.StatusNotifierItem-{}-1".format(os.getpid())
        assert panel.registered == [icon.bus_name] and icon.registered == 1
        found = panel.item_properties(icon.bus_name)
        assert found["Id"] == "vial" and found["Title"] == "Vial (simulated keyboard)"
        assert found["Status"] == ACTIVE and found["Category"] == "ApplicationStatus"
        assert found["Menu"] == MENU_PATH and found["ItemIsMenu"] is False
        assert found["ToolTip"][2] == "Vial (simulated keyboard)"
        assert found["IconPixmap"] == [(size, size, size * size * 4) for size in PIXMAP_SIZES]
    finally:
        running.stop()
    assert not panel.has_owner(icon.bus_name)  # the icon left the bus: the panel takes it down


@needs_a_bus
def test_the_panel_draws_the_menu_from_the_layout_and_a_chosen_entry_acts(panel):
    running = Running()
    try:
        revision, layout = panel.layout(running.icon.bus_name)
        assert revision == 1 and labels(layout) == [tray.OPEN, tray.QUIT]
        panel.choose(running.icon.bus_name, 2)
        assert soon(lambda: running.quit_used == [True])
        assert running.opened == []
    finally:
        running.stop()


@needs_a_bus
def test_a_click_on_the_icon_opens_vial(panel):
    running = Running()
    try:
        panel.click(running.icon.bus_name)
        assert soon(lambda: running.opened == [True])
        assert running.quit_used == []
    finally:
        running.stop()


@needs_a_bus
def test_hidden_the_icon_is_passive_and_a_notification_carries_the_image(panel):
    running = Running()
    try:
        icon = running.icon
        icon.visible = False
        assert soon(lambda: panel.item_properties(icon.bus_name)["Status"] == PASSIVE)
        icon.visible = True
        assert soon(lambda: panel.item_properties(icon.bus_name)["Status"] == ACTIVE)
        icon.notify(tray.STILL_RUNNING)
        assert soon(lambda: len(panel.notifications) == 1)
        app_name, replaces_id, summary, body, hints = panel.notifications[0]
        assert (app_name, replaces_id, summary, body) == (icon.title, 0, icon.title, tray.STILL_RUNNING)
        width, height, stride, has_alpha, bits, channels, data = hints["image-data"]
        assert (width, height, has_alpha, channels) == (tray.IMAGE_SIDE, tray.IMAGE_SIDE, True, 4)
        assert icon.notification_id == 7  # the next one replaces it
    finally:
        running.stop()


@needs_a_bus
def test_a_watcher_that_comes_back_gets_the_item_again(panel):
    running = Running()
    try:
        panel.restart_the_watcher()
        assert soon(lambda: running.icon.registered == 2)
        assert panel.registered == [running.icon.bus_name] * 2
    finally:
        running.stop()


@needs_a_bus
def test_without_a_watcher_or_a_host_there_is_no_icon(session_bus):
    icon, problem = statusnotifier.make("vial", tray.image(), "Vial", [])
    assert icon is None and WATCHER in problem  # ServiceUnknown: no watcher on this bus
    panel = Panel(hosted=False)
    try:
        icon, problem = statusnotifier.make("vial", tray.image(), "Vial", [])
        assert icon is None and "no host" in problem
    finally:
        panel.close()


@needs_a_bus
def test_without_a_session_bus_there_is_no_icon(monkeypatch):
    monkeypatch.setenv("DBUS_SESSION_BUS_ADDRESS", "unix:path=/nonexistent/vial-test-bus")
    icon, problem = statusnotifier.make("vial", tray.image(), "Vial", [])
    assert icon is None and problem
