# SPDX-License-Identifier: GPL-2.0-or-later
""" A stand-in for a hidapi device object, answered by a VirtualKeyboard instead of USB. """
from transport import MSG_LEN


class SimulatedHidDevice:

    def __init__(self, keyboard):
        self.keyboard = keyboard
        self.reply = None
        self.closed = False

    def open_path(self, path):
        self.closed = False

    def write(self, data):
        data = bytes(data)
        # hidapi writes are prefixed with a 0 report id
        if len(data) != MSG_LEN + 1 or data[0] != 0:
            raise ValueError("expected a {}-byte report starting with 0, got {}".format(MSG_LEN + 1, data.hex()))
        reply = self.keyboard.process(data[1:])
        if len(reply) > MSG_LEN:
            raise ValueError("simulator reply longer than {} bytes".format(MSG_LEN))
        self.reply = reply + b"\x00" * (MSG_LEN - len(reply))
        return len(data)

    def read(self, length, timeout_ms=0):
        reply, self.reply = self.reply, None
        if reply is None:
            return []
        return list(reply[:length])

    def close(self):
        self.closed = True
