import pytest

from protocol.keyboard_comm import Keyboard
from simulator.corne import make_corne
from simulator.device import SimulatedHidDevice


@pytest.fixture
def corne_keyboard():
    """ (simulated Corne, Keyboard loaded from it). Loading also resets the global keycode tables. """
    virtual = make_corne()
    keyboard = Keyboard(SimulatedHidDevice(virtual))
    keyboard.reload()
    return virtual, keyboard
