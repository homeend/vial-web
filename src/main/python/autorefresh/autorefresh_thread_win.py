import time
import pywintypes
import win32gui, win32con, win32api
import win32gui_struct
import winerror

from autorefresh.autorefresh_thread import AutorefreshThread


GUID_DEVINTERFACE_USB_DEVICE = "{A5DCBF10-6530-11D2-901F-00C04FB951ED}"
DEVICE_NOTIFY_ALL_INTERFACE_CLASSES = 4
WINDOW_CLASS_NAME = "VIAL_DEVICE_DETECTION"

g_changed_windows = set()
""" windows that saw a device arrive or go away since their thread last looked; each thread has its own window """


def device_changed(hwnd, msg, wp, lp):
    if wp in [win32con.DBT_DEVICEARRIVAL, win32con.DBT_DEVICEREMOVECOMPLETE]:
        g_changed_windows.add(hwnd)
    # pywin32 needs an int (LRESULT) back: for None it reports a TypeError through sys.excepthook on every message
    return True


def take_device_change(hwnd):
    """ Whether a device arrived or went away since the last call for this window """
    if hwnd in g_changed_windows:
        g_changed_windows.discard(hwnd)
        return True
    return False


def register_window_class():
    """ Registers the hidden window class used for device notifications; safe to call more than once """
    wc = win32gui.WNDCLASS()
    wc.hInstance = win32api.GetModuleHandle(None)
    wc.lpszClassName = WINDOW_CLASS_NAME
    wc.lpfnWndProc = {win32con.WM_DEVICECHANGE: device_changed}
    try:
        win32gui.RegisterClass(wc)
    except pywintypes.error as e:
        if e.winerror != winerror.ERROR_CLASS_ALREADY_EXISTS:
            raise


def create_notification_window():
    """ A hidden message-only window; its messages are handled by the thread that creates it """
    register_window_class()
    return win32gui.CreateWindowEx(0, WINDOW_CLASS_NAME, None, 0, 0, 0, 0, 0, win32con.HWND_MESSAGE, None, None, None)


def destroy_notification_window(hwnd):
    """ Must be called from the thread that created the window """
    win32gui.DestroyWindow(hwnd)
    g_changed_windows.discard(hwnd)


class AutorefreshThreadWin(AutorefreshThread):

    def run(self):
        # code based on:
        # - https://github.com/libsdl-org/SDL/blob/7b3449b89f0625e4603f5d8681e2bac1f51a9386/src/hidapi/SDL_hidapi.c
        # - https://github.com/vmware-archive/salt-windows-install/blob/master/deps/salt/python/App/Lib/site-packages/win32/Demos/win32gui_devicenotify.py
        hwnd = create_notification_window()
        try:
            hdev = win32gui.RegisterDeviceNotification(
                hwnd,
                win32gui_struct.PackDEV_BROADCAST_DEVICEINTERFACE(GUID_DEVINTERFACE_USB_DEVICE),
                win32con.DEVICE_NOTIFY_WINDOW_HANDLE | DEVICE_NOTIFY_ALL_INTERFACE_CLASSES
            )
            try:
                while not self.isInterruptionRequested():
                    for x in range(100):
                        win32gui.PumpWaitingMessages()
                        time.sleep(0.01)
                        if self.isInterruptionRequested():
                            return

                    if take_device_change(hwnd):
                        self.update()
            finally:
                win32gui.UnregisterDeviceNotification(hdev)
        finally:
            destroy_notification_window(hwnd)
