# SPDX-License-Identifier: GPL-2.0-or-later
""" Encodes and decodes QMK settings values, driven by qmk_settings.json. Must not import Qt. """
import json
import os
from collections import defaultdict

DEFAULT_DEFINITIONS = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                   "..", "..", "resources", "base", "qmk_settings.json")


class QmkSettingsCodec:

    settings_defs = None
    qsid_fields = None

    @classmethod
    def load(cls, path=None):
        """ Load setting definitions; the default path works when running from source """
        cls.qsid_fields = defaultdict(list)
        with open(path or DEFAULT_DEFINITIONS, "r") as inf:
            cls.settings_defs = json.load(inf)
        for tab in cls.settings_defs["tabs"]:
            for field in tab["fields"]:
                cls.qsid_fields[field["qsid"]].append(field)

    @classmethod
    def fields(cls):
        if cls.qsid_fields is None:
            cls.load()
        return cls.qsid_fields

    @classmethod
    def is_qsid_supported(cls, qsid):
        """ Return whether this qsid is known to the settings definitions """
        return qsid in cls.fields()

    @classmethod
    def qsid_serialize(cls, qsid, data):
        """ Serialize from internal representation into binary that can be sent to the firmware """
        fields = cls.fields()[qsid]
        if fields[0]["type"] == "boolean":
            assert isinstance(data, int)
            return data.to_bytes(fields[0].get("width", 1), byteorder="little")
        elif fields[0]["type"] == "integer":
            assert isinstance(data, int)
            assert len(fields) == 1
            return data.to_bytes(fields[0]["width"], byteorder="little")

    @classmethod
    def qsid_deserialize(cls, qsid, data):
        """ Deserialize from binary received from firmware into internal representation """
        fields = cls.fields()[qsid]
        if fields[0]["type"] == "boolean":
            return int.from_bytes(data[0:fields[0].get("width", 1)], byteorder="little")
        elif fields[0]["type"] == "integer":
            assert len(fields) == 1
            return int.from_bytes(data[0:fields[0]["width"]], byteorder="little")
        else:
            raise RuntimeError("unsupported field")
