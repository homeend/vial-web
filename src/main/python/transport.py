# SPDX-License-Identifier: GPL-2.0-or-later
""" Raw packet exchange with a Vial keyboard. Must not import Qt or hidapi. """
import time

MSG_LEN = 32


def hid_send(dev, msg, retries=1):
    if len(msg) > MSG_LEN:
        raise RuntimeError("message must be at most {} bytes".format(MSG_LEN))
    msg += b"\x00" * (MSG_LEN - len(msg))

    data = b""
    first = True

    while retries > 0:
        retries -= 1
        if not first:
            time.sleep(0.5)
        first = False
        try:
            # add 00 at start for hidapi report id
            if dev.write(b"\x00" + msg) != MSG_LEN + 1:
                continue

            data = bytes(dev.read(MSG_LEN, timeout_ms=500))
            if not data:
                continue
        except OSError:
            continue
        break

    if not data:
        raise RuntimeError("failed to communicate with the device")
    return data


def chunks(data, sz):
    for i in range(0, len(data), sz):
        yield data[i:i+sz]
