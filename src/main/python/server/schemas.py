# SPDX-License-Identifier: GPL-2.0-or-later
""" Shapes of everything the API sends and accepts. The UI's TypeScript types are generated from these. """
from typing import Literal, Optional

from pydantic import BaseModel, Field

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


class SetKeycode(BaseModel):
    code: str


class SetLayoutOptions(BaseModel):
    value: int = Field(ge=0, le=0xFFFFFFFF)


class ParseRequest(BaseModel):
    expression: str = Field(max_length=200)


class TapDanceIn(BaseModel):
    tap: str
    hold: str
    doubleTap: str
    tapHold: str
    tappingTerm: int = Field(ge=0, le=10000)


class ComboIn(BaseModel):
    keys: list[str] = Field(min_length=4, max_length=4)
    output: str


class KeyOverrideIn(BaseModel):
    trigger: str
    replacement: str
    layers: int = Field(ge=0, le=0xFFFF)
    triggerMods: int = Field(ge=0, le=0xFF)
    negativeModMask: int = Field(ge=0, le=0xFF)
    suppressedMods: int = Field(ge=0, le=0xFF)
    options: int = Field(ge=0, le=0xFF)


class AltRepeatKeyIn(BaseModel):
    keycode: str
    altKeycode: str
    allowedMods: int = Field(ge=0, le=0xFF)
    options: int = Field(ge=0, le=0xFF)


class MacroActionIn(BaseModel):
    type: Literal["text", "tap", "down", "up", "delay"]
    text: Optional[str] = None
    keys: list[str] = []
    delay: Optional[int] = Field(default=None, ge=0, le=64000)


class MacrosIn(BaseModel):
    items: list[list[MacroActionIn]]


class SettingIn(BaseModel):
    value: int = Field(ge=0, le=0xFFFFFFFF)


class VialRgbIn(BaseModel):
    mode: Optional[int] = Field(default=None, ge=0, le=0xFFFF)
    speed: Optional[int] = Field(default=None, ge=0, le=255)
    hsv: Optional[list[int]] = Field(default=None, min_length=3, max_length=3)


class RgbLightIn(BaseModel):
    brightness: Optional[int] = Field(default=None, ge=0, le=255)
    effect: Optional[int] = Field(default=None, ge=0, le=255)
    speed: Optional[int] = Field(default=None, ge=0, le=255)
    hue: Optional[int] = Field(default=None, ge=0, le=255)
    saturation: Optional[int] = Field(default=None, ge=0, le=255)


class BacklightIn(BaseModel):
    brightness: Optional[int] = Field(default=None, ge=0, le=255)
    effect: Optional[int] = Field(default=None, ge=0, le=255)


class LightingIn(BaseModel):
    vialrgb: Optional[VialRgbIn] = None
    rgblight: Optional[RgbLightIn] = None
    backlight: Optional[BacklightIn] = None
    save: bool = True


class NameIn(BaseModel):
    name: Optional[str] = Field(default=None, max_length=40)
