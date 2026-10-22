# SPDX-License-Identifier: GPL-2.0-or-later
""" Vial's tray icon on Linux as a StatusNotifierItem: the D-Bus protocol every current panel takes (KDE Plasma, GNOME
with its AppIndicator extension, XFCE, Cinnamon, MATE, Budgie, LXQt, Waybar...), on X11 and Wayland alike, with a
menu (com.canonical.dbusmenu, drawn by the panel) and notifications (org.freedesktop.Notifications). Pure Python
over the session bus (dbus-fast), so it works inside the one-file executable, where pystray's menu-capable backends
(GTK, AppIndicator: the system's PyGObject) can't.

Icon mirrors the part of pystray's Icon that tray.py uses -- run(setup), stop(), visible, notify(), the HAS_* flags
-- so tray.run() drives either the same way: the icon's loop (asyncio, here) owns the thread run() is called in, and
setup(icon) runs in a thread of its own once the icon is on the bus.

The protocol: the item is a bus name (org.kde.StatusNotifierItem-<pid>-1) with the item at /StatusNotifierItem and
its menu at /MenuBar, registered with the panel's org.kde.StatusNotifierWatcher; the panel reads the item's
properties (the icon as pixmaps, the title, the status), calls Activate on a click and reads the menu's layout
(GetLayout) to draw it, sending Event(id, "clicked") for a chosen entry. A watcher that comes back (the panel
restarted) gets the item registered again.
"""
import asyncio
import logging
import os
import sys
import threading

log = logging.getLogger(__name__)

try:
    from dbus_fast import DBusError, Variant
    from dbus_fast.service import PropertyAccess, ServiceInterface, dbus_method, dbus_property, dbus_signal
except Exception as e:  # not installed (Windows, macOS: dbus-fast is a Linux requirement), or unusable here
    AVAILABLE, UNAVAILABLE_REASON = False, "{}: {}".format(e.__class__.__name__, e)
else:
    AVAILABLE, UNAVAILABLE_REASON = True, None

WATCHER = "org.kde.StatusNotifierWatcher"
WATCHER_PATH = "/StatusNotifierWatcher"
ITEM = "org.kde.StatusNotifierItem"
ITEM_PATH = "/StatusNotifierItem"
MENU = "com.canonical.dbusmenu"
MENU_PATH = "/MenuBar"
NOTIFICATIONS = "org.freedesktop.Notifications"
NOTIFICATIONS_PATH = "/org/freedesktop/Notifications"
BUS_NAME = "org.kde.StatusNotifierItem-{pid}-1"
""" the item's bus name, as libappindicator names its """
PIXMAP_SIZES = (16, 22, 24, 32, 48, 64)
""" the icon is offered at these sizes; the panel picks the nearest to its own """
PROBE_TIMEOUT = 5.0
""" seconds make() gives the session bus to say whether there is a StatusNotifier host """
SETUP_THREAD_TIMEOUT = 5.0
""" seconds stop() waits for setup() to return, as pystray does """
ROOT = 0
""" the menu's root item id (dbusmenu) """
ACTIVE, PASSIVE = "Active", "Passive"
""" the item's Status: shown, or hidden (Passive: the panel may hide it) """
CLICKED = "clicked"
""" the dbusmenu event for a chosen entry """


class Item:
    """ An entry of the icon's menu: label, action() when chosen; the default one is what a click on the icon does """

    def __init__(self, label, action, default=False):
        self.label, self.action, self.default = label, action, default


def pixmaps(image, sizes=PIXMAP_SIZES):
    """ The icon's image (PIL) as StatusNotifierItem pixmaps: [(width, height, ARGB32 bytes in network order)], one
    for each of sizes """
    from PIL import Image
    rgba = image.convert("RGBA")
    out = []
    for size in sizes:
        raw = rgba.resize((size, size), Image.Resampling.LANCZOS).tobytes("raw", "RGBA")
        argb = bytearray(len(raw))
        argb[0::4], argb[1::4], argb[2::4], argb[3::4] = raw[3::4], raw[0::4], raw[1::4], raw[2::4]
        out.append((size, size, bytes(argb)))
    return out


def image_data(image):
    """ The icon's image (PIL) as a notification's image-data hint: (width, height, row stride, has alpha, bits per
    sample, channels, RGBA bytes) """
    rgba = image.convert("RGBA")
    width, height = rgba.size
    return (width, height, width * 4, True, 8, 4, rgba.tobytes("raw", "RGBA"))


if AVAILABLE:
    class StatusNotifierItem(ServiceInterface):
        """ org.kde.StatusNotifierItem at ITEM_PATH: what the panel reads and calls """

        def __init__(self, icon):
            super().__init__(ITEM)
            self.icon = icon

        @dbus_property(access=PropertyAccess.READ)
        def Category(self) -> "s":
            return "ApplicationStatus"

        @dbus_property(access=PropertyAccess.READ)
        def Id(self) -> "s":
            return self.icon.name

        @dbus_property(access=PropertyAccess.READ)
        def Title(self) -> "s":
            return self.icon.title

        @dbus_property(access=PropertyAccess.READ)
        def Status(self) -> "s":
            return self.icon.status

        @dbus_property(access=PropertyAccess.READ)
        def WindowId(self) -> "i":
            return 0

        @dbus_property(access=PropertyAccess.READ)
        def IconName(self) -> "s":
            return ""

        @dbus_property(access=PropertyAccess.READ)
        def IconPixmap(self) -> "a(iiay)":
            return [list(pixmap) for pixmap in self.icon.pixmaps]

        @dbus_property(access=PropertyAccess.READ)
        def OverlayIconName(self) -> "s":
            return ""

        @dbus_property(access=PropertyAccess.READ)
        def OverlayIconPixmap(self) -> "a(iiay)":
            return []

        @dbus_property(access=PropertyAccess.READ)
        def AttentionIconName(self) -> "s":
            return ""

        @dbus_property(access=PropertyAccess.READ)
        def AttentionIconPixmap(self) -> "a(iiay)":
            return []

        @dbus_property(access=PropertyAccess.READ)
        def AttentionMovieName(self) -> "s":
            return ""

        @dbus_property(access=PropertyAccess.READ)
        def ToolTip(self) -> "(sa(iiay)ss)":
            return ["", [], self.icon.title, ""]

        @dbus_property(access=PropertyAccess.READ)
        def ItemIsMenu(self) -> "b":
            return False  # a click activates (opens Vial); the menu is on the right button

        @dbus_property(access=PropertyAccess.READ)
        def Menu(self) -> "o":
            return MENU_PATH

        @dbus_method()
        def ContextMenu(self, x: "i", y: "i"):
            pass  # the panel draws the menu itself, from MENU_PATH

        @dbus_method()
        def Activate(self, x: "i", y: "i"):
            self.icon.activated()

        @dbus_method()
        def SecondaryActivate(self, x: "i", y: "i"):
            self.icon.activated()

        @dbus_method()
        def Scroll(self, delta: "i", orientation: "s"):
            pass

        @dbus_method()
        def ProvideXdgActivationToken(self, token: "s"):
            pass

        @dbus_signal()
        def NewTitle(self):
            pass

        @dbus_signal()
        def NewIcon(self):
            pass

        @dbus_signal()
        def NewAttentionIcon(self):
            pass

        @dbus_signal()
        def NewOverlayIcon(self):
            pass

        @dbus_signal()
        def NewToolTip(self):
            pass

        @dbus_signal()
        def NewStatus(self, status) -> "s":
            return status

    class DBusMenu(ServiceInterface):
        """ com.canonical.dbusmenu at MENU_PATH: the menu's layout for the panel to draw, and its events """

        def __init__(self, icon):
            super().__init__(MENU)
            self.icon = icon

        @dbus_property(access=PropertyAccess.READ)
        def Version(self) -> "u":
            return 3

        @dbus_property(access=PropertyAccess.READ)
        def TextDirection(self) -> "s":
            return "ltr"

        @dbus_property(access=PropertyAccess.READ)
        def Status(self) -> "s":
            return "normal"

        @dbus_property(access=PropertyAccess.READ)
        def IconThemePath(self) -> "as":
            return []

        @dbus_method()
        def GetLayout(self, parent: "i", depth: "i", names: "as") -> "u(ia{sv}av)":
            layout = self.icon.layout(parent, depth, names)
            if layout is None:
                raise DBusError("com.canonical.dbusmenu.Error.UnknownItem", "no menu item {}".format(parent))
            return self.icon.revision, layout

        @dbus_method()
        def GetGroupProperties(self, ids: "ai", names: "as") -> "a(ia{sv})":
            return [[i, self.icon.properties(i, names)] for i in ids if i in self.icon.ids]

        @dbus_method()
        def GetProperty(self, id: "i", name: "s") -> "v":
            found = self.icon.properties(id, [name]) if id in self.icon.ids else {}
            if name not in found:
                raise DBusError("com.canonical.dbusmenu.Error.UnknownProperty", "no {} on item {}".format(name, id))
            return found[name]

        @dbus_method()
        def Event(self, id: "i", event: "s", data: "v", timestamp: "u"):
            self.icon.event(id, event)

        @dbus_method()
        def EventGroup(self, events: "a(isvu)") -> "ai":
            return [id for id, event, data, timestamp in events if not self.icon.event(id, event)]

        @dbus_method()
        def AboutToShow(self, id: "i") -> "b":
            return False  # the layout never changes

        @dbus_method()
        def AboutToShowGroup(self, ids: "ai") -> "aiai":
            return [], []

        @dbus_signal()
        def ItemsPropertiesUpdated(self, updated, removed) -> "a(ia{sv})a(ias)":
            return updated, removed

        @dbus_signal()
        def LayoutUpdated(self, revision, parent) -> "ui":
            return revision, parent

        @dbus_signal()
        def ItemActivationRequested(self, id, timestamp) -> "iu":
            return id, timestamp


class Icon:
    """ The tray icon: name (the item's Id), image (PIL, square), title (the tooltip), items ([Item], the menu, the
    default one being what a click does). Shown by run(), which blocks; see the module's docstring. """

    HAS_DEFAULT_ACTION = True
    HAS_MENU = True
    HAS_NOTIFICATION = True

    def __init__(self, name, image, title, items):
        self.name, self.title, self.items = name, title, list(items)
        self.image = image
        self.pixmaps = pixmaps(image)
        self.ids = {i + 1: item for i, item in enumerate(self.items)}  # the menu's item ids: 1..n (0 is the root)
        self.revision = 1
        self._visible = False
        self.loop = None
        self.bus = None
        self.bus_name = None
        self.item = None
        self.menu = None
        self.stopped = None
        self.registered = 0
        """ how many times the item was registered with a watcher (once, plus once per watcher that came back) """
        self.notification_id = 0
        self._setup_thread = None

    # -- what the panel reads (pure, testable without a bus) --

    @property
    def status(self):
        return ACTIVE if self._visible else PASSIVE

    def properties(self, id, names=()):
        """ The menu item's dbusmenu properties, as {name: Variant}: all of them, or those in names """
        if id == ROOT:
            found = {"children-display": Variant("s", "submenu")}
        else:
            found = {"type": Variant("s", "standard"), "label": Variant("s", self.ids[id].label),
                     "enabled": Variant("b", True), "visible": Variant("b", True)}
        return {name: value for name, value in found.items() if not names or name in names}

    def layout(self, parent=ROOT, depth=-1, names=()):
        """ The menu's dbusmenu layout from parent: (id, properties, [children as variants]), children to depth
        (-1: all), or None for an id that isn't a menu item """
        if parent != ROOT and parent not in self.ids:
            return None
        children = []
        if parent == ROOT and depth != 0:
            children = [Variant("(ia{sv}av)", [id, self.properties(id, names), []]) for id in self.ids]
        return [parent, self.properties(parent, names), children]

    def event(self, id, event):
        """ A dbusmenu event from the panel: a chosen entry runs its action. False for an id that isn't an item """
        if id not in self.ids:
            return False
        if event == CLICKED:
            self._act(self.ids[id])
        return True

    def activated(self):
        """ A click on the icon: the default item's action """
        for item in self.items:
            if item.default:
                self._act(item)
                return

    def _act(self, item):
        try:
            item.action()
        except Exception:
            log.exception("the tray icon's %s failed", item.label)

    # -- pystray's Icon, the part tray.py uses --

    @property
    def visible(self):
        return self._visible

    @visible.setter
    def visible(self, value):
        value = bool(value)
        if self._visible == value:
            return
        self._visible = value
        loop = self.loop
        if loop is not None and not loop.is_closed() and self.item is not None:
            try:
                loop.call_soon_threadsafe(self._status_changed)
            except RuntimeError:  # the loop is gone
                pass

    def _status_changed(self):
        self.item.NewStatus(self.status)
        self.item.emit_properties_changed({"Status": self.status})

    def run(self, setup=None):
        """ Put the icon on the bus and serve the panel until stop(); setup(icon) runs in a thread once the icon is
        on the bus. Raises what connecting or registering raised (nothing has run then). """
        asyncio.run(self._run(setup))

    async def _run(self, setup):
        from dbus_fast.aio import MessageBus
        self.loop = asyncio.get_running_loop()
        self.stopped = asyncio.Event()
        self.bus = await MessageBus().connect()
        try:
            self.item, self.menu = StatusNotifierItem(self), DBusMenu(self)
            self.bus.export(ITEM_PATH, self.item)
            self.bus.export(MENU_PATH, self.menu)
            wanted = BUS_NAME.format(pid=os.getpid())
            from dbus_fast import RequestNameReply
            reply = await self.bus.request_name(wanted)
            self.bus_name = wanted if reply == RequestNameReply.PRIMARY_OWNER else self.bus.unique_name
            await self._register()
            await self._watch_the_watcher()
            self._start_setup(setup)
            await self.stopped.wait()
        finally:
            self.bus.disconnect()  # the panel sees the name go and takes the icon down
            self.loop = None

    async def _register(self):
        introspection = await self.bus.introspect(WATCHER, WATCHER_PATH)
        watcher = self.bus.get_proxy_object(WATCHER, WATCHER_PATH, introspection).get_interface(WATCHER)
        await watcher.call_register_status_notifier_item(self.bus_name)
        self.registered += 1
        log.info("tray icon registered with the StatusNotifier watcher as %s", self.bus_name)

    async def _watch_the_watcher(self):
        """ A watcher that comes back (the panel restarted) is told about the item again """
        introspection = await self.bus.introspect("org.freedesktop.DBus", "/org/freedesktop/DBus")
        dbus = self.bus.get_proxy_object("org.freedesktop.DBus", "/org/freedesktop/DBus", introspection)

        def owner_changed(name, old_owner, new_owner):
            if name == WATCHER and new_owner and self.loop is not None:
                self.loop.create_task(self._register_again())
        dbus.get_interface("org.freedesktop.DBus").on_name_owner_changed(owner_changed)

    async def _register_again(self):
        try:
            await self._register()
        except Exception as e:
            log.warning("the tray icon could not register with the StatusNotifier watcher again: %s", e)

    def _start_setup(self, setup):
        def setup_handler():
            if setup is not None:
                setup(self)
            else:
                self.visible = True
        self._setup_thread = threading.Thread(target=setup_handler, name="tray setup")
        self._setup_thread.start()

    def stop(self):
        """ Leave the bus (the icon goes) and let run() return; nothing when not running """
        loop, stopped = self.loop, self.stopped
        if loop is None or stopped is None:
            return
        try:
            loop.call_soon_threadsafe(stopped.set)
        except RuntimeError:  # the loop is closed already
            return
        thread = self._setup_thread
        if thread is not None and thread.ident != threading.current_thread().ident:
            thread.join(SETUP_THREAD_TIMEOUT)
            if thread.is_alive():
                log.warning("the tray icon's setup did not finish within %s seconds of stopping", SETUP_THREAD_TIMEOUT)

    def notify(self, message, title=None):
        """ A desktop notification (org.freedesktop.Notifications) from the icon, with its image; from any thread.
        Failures are logged, never raised. """
        loop = self.loop
        if loop is None or loop.is_closed():
            raise RuntimeError("the tray icon is not running")
        asyncio.run_coroutine_threadsafe(self._notify(message, title or self.title), loop)

    async def _notify(self, message, title):
        try:
            introspection = await self.bus.introspect(NOTIFICATIONS, NOTIFICATIONS_PATH)
            proxy = self.bus.get_proxy_object(NOTIFICATIONS, NOTIFICATIONS_PATH, introspection)
            hints = {"image-data": Variant("(iiibiiay)", list(image_data(self.image)))}
            self.notification_id = await proxy.get_interface(NOTIFICATIONS).call_notify(
                self.title, self.notification_id, "", title, message, [], hints, -1)
        except Exception as e:
            log.warning("the tray icon could not show a notification: %s", e)


async def _probe():
    """ Raises with why when the session bus has no StatusNotifier host to show the icon """
    from dbus_fast.aio import MessageBus
    bus = await MessageBus().connect()
    try:
        introspection = await bus.introspect(WATCHER, WATCHER_PATH)
        watcher = bus.get_proxy_object(WATCHER, WATCHER_PATH, introspection).get_interface(WATCHER)
        if not await watcher.get_is_status_notifier_host_registered():
            raise RuntimeError("the StatusNotifier watcher has no host (no panel takes the icon)")
    finally:
        bus.disconnect()


def make(name, image, title, items):
    """ (Icon, None) when this session's panel takes StatusNotifier icons, else (None, why not); the icon is shown
    by run(). Linux only. """
    if not sys.platform.startswith("linux"):
        return None, "not Linux"
    if not AVAILABLE:
        return None, UNAVAILABLE_REASON
    try:
        asyncio.run(asyncio.wait_for(_probe(), PROBE_TIMEOUT))
    except Exception as e:
        return None, "{}: {}".format(e.__class__.__name__, e) if str(e) else e.__class__.__name__
    return Icon(name, image, title, items), None
