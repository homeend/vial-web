import sys

import pytest


@pytest.mark.skipif(sys.platform != "win32", reason="Windows device notifications only")
def test_window_class_registration_can_repeat():
    """ Every MainWindow starts an autorefresh thread; registering the class twice must not fail """
    from autorefresh.autorefresh_thread_win import register_window_class

    register_window_class()
    register_window_class()
