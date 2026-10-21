# SPDX-License-Identifier: GPL-2.0-or-later
""" Flashing Vial firmware (.vfw files) through the Vial bootloader ("vibl"): finding the bootloader, checking a firmware
file, and the bootloader's protocol. The logic of the Qt app's firmware updater, without its window, for the web UI of
phase 7; nothing calls it yet.

Must not import Qt or hidapi: the caller lists the HID devices and opens them (a raw HID device, as hidapi's
hid.device() opened on a path, or a stand-in in tests).

A firmware file: "VIALFW00" or "VIALFW01", the keyboard's UID (8 bytes), the build time (8 bytes, little-endian seconds
since 1970, UTC), 8 bytes unused, the SHA-256 of the payload (32 bytes), then the payload.

The bootloader takes 64-byte messages: "VC" and a command byte (CMD_*), padded with zeros; then, for CMD_FLASH, the
payload in 64-byte chunks.
"""
import datetime
import hashlib
import struct
import time
from dataclasses import dataclass

from transport import chunks

VIBL_SERIAL_NUMBER_MAGIC = "vibl:d4f8159c"
""" in the USB serial number of every Vial bootloader """
MESSAGE_LEN = 64
""" the bootloader's messages are this long, the firmware's chunks too """
FIRMWARE_SIGNATURES = (b"VIALFW00", b"VIALFW01")
HEADER_LEN = 64
MAX_FIRMWARE_SIZE = 10 * 1024 * 1024
""" larger than any keyboard's flash: most likely the wrong file """
UNSET_UID = b"\xFF" * 8
""" the UID of a bootloader that was never given one """
SUPPORTED_VERSIONS = (0, 1)
""" bootloader protocol versions this flasher speaks """
SEND_RETRIES = 200
RETRY_PAUSE = 0.01
""" seconds between two tries of a message the bootloader didn't take yet """
UID_TIMEOUT_MS = 500
""" how long a device found is given to say its UID """

CMD_VERSION = b"VC\x00"
CMD_UID = b"VC\x01"
CMD_FLASH = b"VC\x02"
""" followed by the number of chunks (2 bytes, little-endian) """
CMD_REBOOT = b"VC\x03"
CMD_INSECURE = b"VC\x04"
""" the keyboard starts unlocked once, so that the layout saved before flashing can be written back """


class FirmwareError(ValueError):
    """ The firmware file can't be flashed (on this keyboard) """


class FlashError(RuntimeError):
    """ The bootloader didn't take a message, or answered something this flasher can't work with """


@dataclass(frozen=True)
class Firmware:
    uid: bytes
    """ the UID of the keyboard it was built for """
    built: datetime.datetime
    """ when it was built, in UTC """
    payload: bytes


def read_firmware(data):
    """ The firmware in a .vfw file's bytes; FirmwareError when it isn't one, or is damaged """
    if len(data) > MAX_FIRMWARE_SIZE:
        raise FirmwareError("the firmware is too large ({} bytes, at most {}): check that it is the right file".format(
            len(data), MAX_FIRMWARE_SIZE))
    if len(data) < HEADER_LEN or data[0:8] not in FIRMWARE_SIGNATURES:
        raise FirmwareError("this isn't a Vial firmware file (.vfw)")
    expected, payload = data[32:64], data[HEADER_LEN:]
    actual = hashlib.sha256(payload).digest()
    if actual != expected:
        raise FirmwareError("the firmware is damaged: its checksum is {}, it should be {}".format(
            actual.hex(), expected.hex()))
    built = datetime.datetime.fromtimestamp(struct.unpack("<Q", data[16:24])[0], datetime.timezone.utc)
    return Firmware(uid=data[8:16], built=built, payload=payload)


def check_firmware_for(firmware, uid):
    """ FirmwareError unless the firmware was built for the keyboard (or bootloader) of this UID """
    if firmware.uid != uid:
        raise FirmwareError("the firmware was built for another keyboard: its UID is {}, the keyboard's is {}".format(
            firmware.uid.hex(), uid.hex()))


def pad(message):
    """ A message as the bootloader takes it: padded with zeros to MESSAGE_LEN bytes """
    if len(message) > MESSAGE_LEN:
        raise ValueError("a bootloader message is at most {} bytes".format(MESSAGE_LEN))
    return message + b"\x00" * (MESSAGE_LEN - len(message))


def is_bootloader(desc):
    """ Whether a HID device (as hidapi lists it) is a Vial bootloader """
    return VIBL_SERIAL_NUMBER_MAGIC in (desc.get("serial_number") or "")


def bootloader_title(desc):
    return "Vial Bootloader [{:04X}:{:04X}]".format(desc["vendor_id"], desc["product_id"])


class Bootloader:
    """ A Vial bootloader, open: dev is a raw HID device (write() takes a report ID first, read() answers bytes) """

    def __init__(self, dev, sleep=time.sleep):
        self.dev = dev
        self.sleep = sleep

    def send(self, message, retries=SEND_RETRIES):
        """ Send one 64-byte message, tried again while the bootloader isn't ready (a write fails); whether it was
        written whole """
        if len(message) != MESSAGE_LEN:
            raise ValueError("a bootloader message is {} bytes, not {}".format(MESSAGE_LEN, len(message)))
        for _ in range(retries):
            written = self.dev.write(b"\x00" + message)  # report ID 0 first
            if written == len(message) + 1:
                return True
            if written >= 0:
                return False
            self.sleep(RETRY_PAUSE)
        return False

    def command(self, command, argument=b""):
        """ Send a command; FlashError when the bootloader doesn't take it """
        if not self.send(pad(command + argument)):
            raise FlashError("the bootloader didn't take the command {}".format(command[2]))

    def recv(self, length, timeout_ms=0):
        """ The bootloader's answer (0: wait for it) """
        return bytes(self.dev.read(length, timeout_ms=timeout_ms))

    def version(self):
        self.command(CMD_VERSION)
        answer = self.recv(8)
        if not answer:
            raise FlashError("the bootloader didn't say its version")
        return answer[0]

    def uid(self, timeout_ms=0):
        self.command(CMD_UID)
        return self.recv(8, timeout_ms)


def bootloader_uid(dev):
    """ The UID of a bootloader just found and opened (b"" when it doesn't say in time), as the Qt app asked each one
    it found while it waited for the keyboard to come back as a bootloader """
    try:
        return Bootloader(dev).uid(UID_TIMEOUT_MS)
    except (OSError, FlashError):
        return b""


def find_bootloader(devices, open_device, uid):
    """ The first of the HID devices listed (hidapi's descriptors) that is a Vial bootloader of this UID, or None.
    open_device(desc) opens one (a context manager giving the raw device): each bootloader is asked for its UID. """
    for desc in devices:
        if not is_bootloader(desc):
            continue
        try:
            with open_device(desc) as dev:
                if bootloader_uid(dev) == uid:
                    return desc
        except OSError:
            continue
    return None


def flash(bootloader, firmware, restore_layout=False, log=lambda line: None, progress=lambda done: None):
    """ Flash the firmware (read_firmware()) through the bootloader (Bootloader), then reboot the keyboard into it.

    restore_layout: the keyboard starts unlocked once (CMD_INSECURE), so that a layout saved before flashing can be
    written back. log(line) tells what is done, progress(fraction) how much of the payload is sent. FirmwareError when
    the firmware is for another keyboard; FlashError when the bootloader can't flash it: nothing is written before
    every check has passed.
    """
    log("Firmware built on {} (UTC)".format(firmware.built.strftime("%Y-%m-%d %H:%M:%S")))
    version = bootloader.version()
    log("Bootloader version: {}".format(version))
    if version not in SUPPORTED_VERSIONS:
        raise FlashError("the bootloader's version {} isn't supported".format(version))
    uid = bootloader.uid()
    log("Vial ID: {}".format(uid.hex()))
    if uid == UNSET_UID:
        log("Warning: the bootloader's UID is not set: set it before releasing production firmware")
    check_firmware_for(firmware, uid)

    payload = firmware.payload + b"\x00" * (-len(firmware.payload) % MESSAGE_LEN)
    if len(payload) // MESSAGE_LEN > 0xFFFF:
        raise FirmwareError("the firmware is too large for the bootloader ({} bytes)".format(len(payload)))
    log("Flashing...")
    bootloader.command(CMD_FLASH, struct.pack("<H", len(payload) // MESSAGE_LEN))
    sent = 0
    for chunk in chunks(payload, MESSAGE_LEN):
        if not bootloader.send(chunk):
            raise FlashError("sending the firmware failed: the keyboard's firmware is now incomplete, flash it again")
        sent += len(chunk)
        progress(sent / len(payload))

    log("Rebooting...")
    if restore_layout:
        bootloader.command(CMD_INSECURE)
    bootloader.command(CMD_REBOOT)
    log("Done!")
