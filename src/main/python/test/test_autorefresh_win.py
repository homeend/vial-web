import os
import sys
import time

import pytest

windows_only = pytest.mark.skipif(sys.platform != "win32", reason="Windows device notifications only")

DBT_DEVNODES_CHANGED = 0x0007


@pytest.fixture
def excepthook_calls(monkeypatch):
    """ What reaches sys.excepthook: pywin32 reports errors raised in a window procedure there """
    calls = []
    monkeypatch.setattr(sys, "excepthook", lambda *exc: calls.append(exc))
    return calls


def notification_windows():
    """ This process's hidden device-notification windows """
    import win32con
    import win32gui
    import win32process
    from autorefresh.autorefresh_thread_win import WINDOW_CLASS_NAME

    found, hwnd = [], 0
    while True:
        try:
            hwnd = win32gui.FindWindowEx(win32con.HWND_MESSAGE, hwnd, WINDOW_CLASS_NAME, None)
        except win32gui.error:
            break
        if not hwnd:
            break
        if win32process.GetWindowThreadProcessId(hwnd)[1] == os.getpid():
            found.append(hwnd)
    return found


@windows_only
def test_window_class_registration_can_repeat():
    """ Every MainWindow starts an autorefresh thread; registering the class twice must not fail """
    from autorefresh.autorefresh_thread_win import register_window_class

    register_window_class()
    register_window_class()


@windows_only
def test_device_change_is_handled_without_an_error(excepthook_calls):
    """ pywin32 needs an int back from a window procedure. Returning None made it report
    "TypeError: WPARAM is simple, so must be an int object (got NoneType)" through sys.excepthook on every device
    change, and pytest-qt pinned that on whichever test happened to be running """
    import win32con
    import win32gui
    from autorefresh.autorefresh_thread_win import WINDOW_CLASS_NAME, register_window_class

    register_window_class()
    hwnd = win32gui.CreateWindowEx(0, WINDOW_CLASS_NAME, None, 0, 0, 0, 0, 0, win32con.HWND_MESSAGE, None, None,
                                   None)
    try:
        for event in (win32con.DBT_DEVICEARRIVAL, win32con.DBT_DEVICEREMOVECOMPLETE, DBT_DEVNODES_CHANGED):
            win32gui.SendMessage(hwnd, win32con.WM_DEVICECHANGE, event, 0)
    finally:
        win32gui.DestroyWindow(hwnd)
    assert excepthook_calls == []


@windows_only
def test_device_changes_are_tracked_per_window(excepthook_calls):
    """ A change seen by one autorefresh thread's window must not be used up by another thread """
    import win32con
    import win32gui
    from autorefresh import autorefresh_thread_win as arw

    first, second = arw.create_notification_window(), arw.create_notification_window()
    try:
        assert not arw.take_device_change(first)
        win32gui.SendMessage(first, win32con.WM_DEVICECHANGE, DBT_DEVNODES_CHANGED, 0)
        assert not arw.take_device_change(first)  # not an arrival or a removal
        win32gui.SendMessage(first, win32con.WM_DEVICECHANGE, win32con.DBT_DEVICEARRIVAL, 0)
        assert not arw.take_device_change(second)
        assert arw.take_device_change(first)
        assert not arw.take_device_change(first)  # reported once
    finally:
        arw.destroy_notification_window(first)
        arw.destroy_notification_window(second)
    assert excepthook_calls == []


@windows_only
def test_thread_stops_and_removes_its_window(qapp):
    """ Tests stop the thread of every MainWindow they create; a thread left running receives device changes
    during later tests """
    from autorefresh.autorefresh_thread_win import AutorefreshThreadWin

    before = set(notification_windows())
    thread = AutorefreshThreadWin()
    thread.start()
    deadline = time.monotonic() + 5
    while set(notification_windows()) == before and time.monotonic() < deadline:
        time.sleep(0.01)
    assert set(notification_windows()) != before
    thread.stop()
    assert thread.isFinished()
    assert set(notification_windows()) == before
