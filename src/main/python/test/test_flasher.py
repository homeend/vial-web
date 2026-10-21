""" protocol/flasher.py against a stand-in bootloader: no HID device is listed or opened """
import contextlib
import datetime
import hashlib
import struct

import pytest

from protocol import flasher
from protocol.flasher import Bootloader, Firmware, FirmwareError, FlashError

UID = bytes.fromhex("0123456789abcdef")
BUILT = 1_700_000_000


def vfw(payload=b"\x11" * 100, uid=UID, signature=b"VIALFW01", built=BUILT, checksum=None):
    """ A .vfw file's bytes """
    digest = hashlib.sha256(payload).digest() if checksum is None else checksum
    return signature + uid + struct.pack("<Q", built) + b"\x00" * 8 + digest + payload


class FakeBootloader:
    """ Stands in for a Vial bootloader opened through hidapi: write() takes the report ID first and answers how many
    bytes it wrote, read() answers what the last command asks for """

    def __init__(self, uid=UID, version=1, busy_writes=0, refuse_after=None):
        self.uid = uid
        self.version = version
        self.busy_writes = busy_writes
        """ writes that fail (-1) before it is ready """
        self.refuse_after = refuse_after
        """ messages taken before it writes nothing (0) """
        self.messages = []
        self.answer = b""
        self.reads = []

    def write(self, data):
        assert data[0] == 0 and len(data) == 65  # report ID, then a whole message
        if self.busy_writes:
            self.busy_writes -= 1
            return -1
        if self.refuse_after is not None and len(self.messages) >= self.refuse_after:
            return 0
        message = data[1:]
        self.messages.append(message)
        if message[:3] == flasher.CMD_VERSION:
            self.answer = bytes([self.version]) + b"\x00" * 7
        elif message[:3] == flasher.CMD_UID:
            self.answer = self.uid
        return len(data)

    def read(self, length, timeout_ms=0):
        self.reads.append(timeout_ms)
        answer, self.answer = self.answer[:length], b""
        return list(answer)

    def commands(self):
        return [m[:3] for m in self.messages if m[:2] == b"VC"]


# ---------- the firmware file ----------

def test_a_firmware_file_is_read():
    firmware = flasher.read_firmware(vfw(b"\x22" * 10))
    assert firmware == Firmware(uid=UID, built=datetime.datetime(2023, 11, 14, 22, 13, 20, tzinfo=datetime.timezone.utc),
                                payload=b"\x22" * 10)


@pytest.mark.parametrize("signature", flasher.FIRMWARE_SIGNATURES)
def test_both_signatures_are_taken(signature):
    assert flasher.read_firmware(vfw(signature=signature)).uid == UID


@pytest.mark.parametrize("data", [b"", b"VIALFW01" + b"\x00" * 10, vfw(signature=b"VIALFW02"), b"\x00" * 200])
def test_what_isnt_a_firmware_file_is_refused(data):
    with pytest.raises(FirmwareError, match="isn't a Vial firmware file"):
        flasher.read_firmware(data)


def test_a_damaged_firmware_is_refused():
    with pytest.raises(FirmwareError, match="damaged"):
        flasher.read_firmware(vfw(checksum=b"\x00" * 32))
    data = bytearray(vfw())
    data[-1] ^= 0xFF
    with pytest.raises(FirmwareError, match="damaged"):
        flasher.read_firmware(bytes(data))


def test_a_file_too_large_is_refused_before_anything_else():
    with pytest.raises(FirmwareError, match="too large"):
        flasher.read_firmware(b"\x00" * (flasher.MAX_FIRMWARE_SIZE + 1))


def test_firmware_for_another_keyboard_is_refused():
    firmware = flasher.read_firmware(vfw())
    flasher.check_firmware_for(firmware, UID)
    with pytest.raises(FirmwareError, match="another keyboard"):
        flasher.check_firmware_for(firmware, b"\x00" * 8)


# ---------- finding the bootloader ----------

def test_bootloaders_are_told_by_their_serial_number():
    assert flasher.is_bootloader({"serial_number": "vibl:d4f8159c"})
    assert not flasher.is_bootloader({"serial_number": "vial:f64c2b3c"})
    assert not flasher.is_bootloader({"serial_number": None})
    assert flasher.bootloader_title({"vendor_id": 0x1234, "product_id": 0xAB}) == "Vial Bootloader [1234:00AB]"


def test_the_bootloader_of_the_keyboard_is_found_by_its_uid():
    devices = {
        "keyboard": FakeBootloader(),  # a keyboard: never opened
        "other": FakeBootloader(uid=b"\x01" * 8),
        "broken": None,
        "ours": FakeBootloader(),
    }
    listed = [{"path": "keyboard", "serial_number": "vial:f64c2b3c"},
              {"path": "other", "serial_number": "vibl:d4f8159c"},
              {"path": "broken", "serial_number": "vibl:d4f8159c"},
              {"path": "ours", "serial_number": "vibl:d4f8159c"}]
    opened = []

    @contextlib.contextmanager
    def open_device(desc):
        opened.append(desc["path"])
        if devices[desc["path"]] is None:
            raise OSError("can't open")
        yield devices[desc["path"]]
    assert flasher.find_bootloader(listed, open_device, UID) == listed[3]
    assert opened == ["other", "broken", "ours"]
    assert devices["ours"].reads == [flasher.UID_TIMEOUT_MS]  # asked, not waited for forever
    assert flasher.find_bootloader(listed[:3], open_device, UID) is None


def test_a_bootloader_that_doesnt_answer_has_no_uid():
    assert flasher.bootloader_uid(FakeBootloader(refuse_after=0)) == b""


# ---------- flashing ----------

def test_flashing_sends_the_payload_in_chunks_then_reboots():
    payload = bytes(range(256)) + b"\xAA" * 10  # not a whole number of chunks
    device = FakeBootloader()
    lines, done = [], []
    flasher.flash(Bootloader(device), flasher.read_firmware(vfw(payload)), log=lines.append, progress=done.append)
    padded = payload + b"\x00" * 54
    assert device.commands() == [flasher.CMD_VERSION, flasher.CMD_UID, flasher.CMD_FLASH, flasher.CMD_REBOOT]
    flash_command = device.messages[2]
    assert flash_command == flasher.pad(flasher.CMD_FLASH + struct.pack("<H", 5))
    assert b"".join(device.messages[3:8]) == padded
    assert done == [1 / 5, 2 / 5, 3 / 5, 4 / 5, 1.0]
    assert lines == ["Firmware built on 2023-11-14 22:13:20 (UTC)", "Bootloader version: 1",
                     "Vial ID: 0123456789abcdef", "Flashing...", "Rebooting...", "Done!"]


def test_restoring_the_layout_starts_the_keyboard_unlocked_once():
    device = FakeBootloader()
    flasher.flash(Bootloader(device), flasher.read_firmware(vfw()), restore_layout=True)
    assert device.commands()[-2:] == [flasher.CMD_INSECURE, flasher.CMD_REBOOT]


@pytest.mark.parametrize("version", [0, 1])
def test_both_bootloader_versions_are_flashed(version):
    device = FakeBootloader(version=version)
    flasher.flash(Bootloader(device), flasher.read_firmware(vfw()))
    assert device.commands()[-1] == flasher.CMD_REBOOT


def test_an_unknown_bootloader_version_is_refused_before_anything_is_written():
    device = FakeBootloader(version=2)
    with pytest.raises(FlashError, match="version 2"):
        flasher.flash(Bootloader(device), flasher.read_firmware(vfw()))
    assert device.commands() == [flasher.CMD_VERSION]


def test_firmware_for_another_keyboard_is_refused_before_anything_is_written():
    device = FakeBootloader(uid=b"\x00" * 8)
    with pytest.raises(FirmwareError, match="another keyboard"):
        flasher.flash(Bootloader(device), flasher.read_firmware(vfw()))
    assert flasher.CMD_FLASH not in device.commands()


def test_a_bootloader_without_a_uid_is_warned_about():
    unset = flasher.UNSET_UID
    device = FakeBootloader(uid=unset)
    lines = []
    flasher.flash(Bootloader(device), flasher.read_firmware(vfw(uid=unset)), log=lines.append)
    assert any(line.startswith("Warning: the bootloader's UID is not set") for line in lines)


def test_a_busy_bootloader_is_sent_the_message_again():
    pauses = []
    device = FakeBootloader(busy_writes=3)
    flasher.flash(Bootloader(device, sleep=pauses.append), flasher.read_firmware(vfw()))
    assert pauses == [flasher.RETRY_PAUSE] * 3
    assert device.commands()[-1] == flasher.CMD_REBOOT


def test_a_bootloader_never_ready_fails_the_command():
    device = FakeBootloader(busy_writes=flasher.SEND_RETRIES)
    with pytest.raises(FlashError, match="didn't take the command"):
        Bootloader(device, sleep=lambda s: None).version()


def test_a_chunk_not_taken_fails_the_flash_and_says_the_firmware_is_incomplete():
    device = FakeBootloader(refuse_after=4)  # version, UID, flash, one chunk
    progress = []
    with pytest.raises(FlashError, match="incomplete"):
        flasher.flash(Bootloader(device), flasher.read_firmware(vfw(b"\x33" * 200)), progress=progress.append)
    assert progress == [1 / 4]
    assert flasher.CMD_REBOOT not in device.commands()


def test_messages_are_whole():
    with pytest.raises(ValueError):
        flasher.pad(b"\x00" * 65)
    with pytest.raises(ValueError):
        Bootloader(FakeBootloader()).send(b"VC")


def test_a_firmware_of_more_chunks_than_the_bootloader_counts_is_refused_before_anything_is_written():
    device = FakeBootloader()
    with pytest.raises(FirmwareError, match="too large for the bootloader"):
        flasher.flash(Bootloader(device), flasher.read_firmware(vfw(b"\x00" * (0x10000 * flasher.MESSAGE_LEN))))
    assert flasher.CMD_FLASH not in device.commands()
