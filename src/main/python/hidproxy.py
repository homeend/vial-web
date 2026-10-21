# SPDX-License-Identifier: GPL-2.0-or-later
""" hidapi: its hidraw backend on Linux (the one Vial's udev rule gives access to), its default one elsewhere """
import sys

if sys.platform.startswith("linux"):
    import hidraw as hid
else:
    import hid
