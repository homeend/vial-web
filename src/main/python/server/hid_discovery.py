# SPDX-License-Identifier: GPL-2.0-or-later
""" Finds Vial keyboards among HID devices. Imports hidapi, so only the real (non-fake) backend uses it. """
import logging
import sys

from hidproxy import hid

log = logging.getLogger(__name__)

VIAL_SERIAL_NUMBER_MAGIC = "vial:f64c2b3c"
RAW_HID_USAGE_PAGE = 0xFF60
RAW_HID_USAGE = 0x61


def is_raw_hid(desc):
    if desc["usage_page"] != RAW_HID_USAGE_PAGE or desc["usage"] != RAW_HID_USAGE:
        return False
    # only Linux needs a permission check; macOS won't let us reopen an open device
    if not sys.platform.startswith("linux"):
        return True
    dev = hid.device()
    try:
        dev.open_path(desc["path"])
    except OSError as e:
        log.warning("cannot open %s: %s (check udev rules)", desc["path"], e)
        return False
    dev.close()
    return True


def find_vial_keyboards():
    """ Device descriptors of connected Vial keyboards' raw HID interfaces """
    return [desc for desc in hid.enumerate()
            if VIAL_SERIAL_NUMBER_MAGIC in (desc.get("serial_number") or "") and is_raw_hid(desc)]
