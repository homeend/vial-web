# SPDX-License-Identifier: GPL-2.0-or-later
""" Shapes of everything the API sends and accepts. The UI's TypeScript types are generated from these. """
from typing import Annotated, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

# ---------- responses ----------


class Described(BaseModel):
    code: str
    kind: str
    tap: str
    hold: Optional[str] = None
    layer: Optional[int] = None
    index: Optional[int] = None
    tooltip: Optional[str] = None


class KeyGeometry(BaseModel):
    """ One physical key (or encoder direction) in keyboard units; rotation in degrees around (rx, ry) """
    row: Optional[int] = None
    col: Optional[int] = None
    encoder: Optional[int] = None
    direction: Optional[int] = None
    x: float
    y: float
    w: float
    h: float
    x2: float = 0
    y2: float = 0
    w2: float = 1
    h2: float = 1
    r: float = 0
    rx: float = 0
    ry: float = 0
    layoutIndex: int = -1
    layoutOption: int = -1
    decal: bool = False


class Layer(BaseModel):
    index: int
    name: str
    customName: bool
    keys: list[Described]
    """ aligned with KeyboardModel.keys """
    encoders: list[Described]
    """ aligned with KeyboardModel.encoders """


class TapDance(BaseModel):
    index: int
    name: str
    customName: bool
    tap: Described
    hold: Described
    doubleTap: Described
    tapHold: Described
    tappingTerm: int


class Combo(BaseModel):
    index: int
    keys: list[Described]
    output: Described


class KeyOverride(BaseModel):
    index: int
    trigger: Described
    replacement: Described
    layers: int
    triggerMods: int
    negativeModMask: int
    suppressedMods: int
    options: int
    enabled: bool


class AltRepeatKey(BaseModel):
    index: int
    keycode: Described
    altKeycode: Described
    allowedMods: int
    options: int
    enabled: bool


class MacroAction(BaseModel):
    type: Literal["text", "tap", "down", "up", "delay"]
    text: Optional[str] = None
    keys: list[Described] = []
    delay: Optional[int] = None


class Macro(BaseModel):
    index: int
    name: str
    customName: bool
    actions: list[MacroAction]


class Macros(BaseModel):
    count: int
    memory: int
    used: int
    items: list[Macro]


class QmkSetting(BaseModel):
    qsid: int
    value: int


class VialRgb(BaseModel):
    mode: int
    speed: int
    hsv: list[int]
    maxBrightness: int
    supportedEffects: list[int]


class RgbLight(BaseModel):
    brightness: int
    effect: int
    speed: int
    hue: int
    saturation: int


class Backlight(BaseModel):
    brightness: int
    effect: int


class Lighting(BaseModel):
    vialrgb: Optional[VialRgb] = None
    rgblight: Optional[RgbLight] = None
    backlight: Optional[Backlight] = None


class LayoutOptions(BaseModel):
    value: int
    labels: list


class KeyboardModel(BaseModel):
    name: str
    uid: str
    viaProtocol: int
    vialProtocol: int
    rows: int
    cols: int
    keys: list[KeyGeometry]
    encoders: list[KeyGeometry]
    layoutOptions: Optional[LayoutOptions] = None
    layers: list[Layer]
    tapDance: list[TapDance]
    combos: list[Combo]
    keyOverrides: list[KeyOverride]
    altRepeatKeys: list[AltRepeatKey]
    macros: Macros
    settings: list[QmkSetting]
    lighting: Lighting
    features: list[str]
    unlocked: bool


class Session(BaseModel):
    status: Literal["connected", "disconnected"]
    fake: bool
    device: Optional[str] = None
    error: Optional[str] = None


class Names(BaseModel):
    layers: dict[str, str]
    tapDance: dict[str, str]
    macros: dict[str, str]


# ---------- requests ----------

KEYCODE_MAX_LENGTH = 200

# Limits for new values. A value equal to what the keyboard already holds is accepted even beyond them (firmware
# defaults and other tools can leave such values), so these are checked in edits.py, not by the request models.
MACRO_TEXT_MAX = 255
""" characters in one macro text step """
MACRO_DELAY_MAX = 64000
MACRO_KEYS_MAX = 32
""" keys in one macro tap / down / up step """
MACRO_STEPS_MAX = 256
TAPPING_TERM_MAX = 10000

# What the request models accept: bounded by what the keyboard can store at all
MACRO_BUFFER_MAX = 0xFFFF
""" the macro buffer size is a 16-bit number """
MACRO_DELAY_LIMIT = 254 + 254 * 255
""" the longest delay the macro format can encode """
MACROS_MAX = 256

KeycodeStr = Annotated[str, Field(max_length=KEYCODE_MAX_LENGTH)]
Byte = Annotated[int, Field(ge=0, le=255)]


class Request(BaseModel):
    """ Base of request bodies: unknown fields are an error, not silently dropped """
    model_config = ConfigDict(extra="forbid")


class SetKeycode(Request):
    code: KeycodeStr


class SetLayoutOptions(Request):
    value: int = Field(ge=0, le=0xFFFFFFFF)


class ParseRequest(Request):
    expression: KeycodeStr


class TapDanceIn(Request):
    tap: KeycodeStr
    hold: KeycodeStr
    doubleTap: KeycodeStr
    tapHold: KeycodeStr
    tappingTerm: int = Field(ge=0, le=0xFFFF)


class ComboIn(Request):
    keys: list[KeycodeStr] = Field(min_length=4, max_length=4)
    output: KeycodeStr


class KeyOverrideIn(Request):
    trigger: KeycodeStr
    replacement: KeycodeStr
    layers: int = Field(ge=0, le=0xFFFF)
    triggerMods: Byte
    negativeModMask: Byte
    suppressedMods: Byte
    options: Byte


class AltRepeatKeyIn(Request):
    keycode: KeycodeStr
    altKeycode: KeycodeStr
    allowedMods: Byte
    options: Byte


class MacroActionIn(Request):
    type: Literal["text", "tap", "down", "up", "delay"]
    text: Optional[str] = Field(default=None, max_length=MACRO_BUFFER_MAX)
    keys: list[KeycodeStr] = Field(default=[], max_length=MACRO_BUFFER_MAX // 2)
    delay: Optional[int] = Field(default=None, ge=0, le=MACRO_DELAY_LIMIT)


class MacrosIn(Request):
    items: list[Annotated[list[MacroActionIn], Field(max_length=MACRO_BUFFER_MAX)]] = Field(max_length=MACROS_MAX)


class SettingIn(Request):
    value: int = Field(ge=0, le=0xFFFFFFFF)


class VialRgbIn(Request):
    mode: Optional[int] = Field(default=None, ge=0, le=0xFFFF)
    speed: Optional[Byte] = None
    hsv: Optional[list[Byte]] = Field(default=None, min_length=3, max_length=3)


class RgbLightIn(Request):
    brightness: Optional[Byte] = None
    effect: Optional[Byte] = None
    speed: Optional[Byte] = None
    hue: Optional[Byte] = None
    saturation: Optional[Byte] = None


class BacklightIn(Request):
    brightness: Optional[Byte] = None
    effect: Optional[Byte] = None


class LightingIn(Request):
    vialrgb: Optional[VialRgbIn] = None
    rgblight: Optional[RgbLightIn] = None
    backlight: Optional[BacklightIn] = None
    save: bool = True


class NameIn(Request):
    name: Optional[str] = Field(default=None, max_length=40)
