import sys

import server.hid_discovery as discovery


class FakeHidDevice:
    opened = []

    def open_path(self, path):
        FakeHidDevice.opened.append(path)

    def close(self):
        pass


class FakeHid:
    """ Stands in for hidapi so no real device is ever enumerated """

    def __init__(self, devices):
        self.devices = devices

    def enumerate(self):
        return self.devices

    @staticmethod
    def device():
        return FakeHidDevice()


def desc(path, serial, usage_page=0xFF60, usage=0x61):
    return {"path": path, "serial_number": serial, "usage_page": usage_page, "usage": usage,
            "manufacturer_string": "Test", "product_string": "Board", "vendor_id": 1, "product_id": 2}


def test_finds_only_vial_raw_hid_interfaces(monkeypatch):
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setattr(discovery, "hid", FakeHid([
        desc(b"vial-raw", "vial:f64c2b3c"),
        desc(b"vial-keyboard-interface", "vial:f64c2b3c", usage_page=0x0001, usage=0x06),
        desc(b"other", "ABC123"),
        desc(b"no-serial", None),
    ]))
    assert [d["path"] for d in discovery.find_vial_keyboards()] == [b"vial-raw"]


def test_linux_checks_the_device_can_be_opened(monkeypatch):
    monkeypatch.setattr(sys, "platform", "linux")
    FakeHidDevice.opened = []
    monkeypatch.setattr(discovery, "hid", FakeHid([desc(b"/dev/hidraw3", "vial:f64c2b3c")]))
    assert len(discovery.find_vial_keyboards()) == 1
    assert FakeHidDevice.opened == [b"/dev/hidraw3"]
