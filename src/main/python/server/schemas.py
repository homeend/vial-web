# SPDX-License-Identifier: GPL-2.0-or-later
""" Shapes of everything the API sends and accepts. The UI's TypeScript types are generated from these. """
from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field

# ---------- responses ----------


KeyKind = Literal["basic", "modifier", "mod-tap", "layer-tap", "layer", "one-shot-mod", "tap-dance", "macro",
                  "transparent", "none", "mouse", "media", "lighting", "other"]


LayerAction = Literal["while held", "toggle", "switch to", "hold, or tap to toggle", "one-shot", "default",
                      "default (saved)", "while held, with modifiers"]


class Legend(BaseModel):
    """ What a key cap shows, each on one line """
    main: str
    shifted: Optional[str] = None
    """ the character typed with Shift, when the key cap shows it (e.g. "!" on the 1 key) """
    altGr: Optional[str] = None
    """ the character typed with AltGr in the chosen keyboard language, e.g. "ą" on Polish A """


class Described(BaseModel):
    """ A keycode as the UI shows it """
    code: str
    value: int = Field(ge=0, le=0xFFFF)
    """ the keycode as the keyboard stores it (16 bits): a macro step takes more bytes for one of 256 or more """
    kind: KeyKind
    tap: str
    """ what a tap does, in a few words, e.g. "1", "Caps Lock", "Ctrl+C", "TD 0" """
    legend: Legend
    hold: Optional[str] = None
    """ what holding does, when it differs from a tap: "Shift" (mod-tap), "layer 2" (layer-tap) """
    layer: Optional[int] = None
    layerAction: Optional[LayerAction] = None
    """ for keys that use a layer: what they do with it """
    triLayer: Optional[int] = None
    """ for FN_MO13 and FN_MO23 (Vial's tri-layer keys): the layer that is on while both are held, as well as their
    own layer (1 or 2) """
    index: Optional[int] = None
    """ the tap dance or macro a key runs """
    description: Optional[str] = None
    """ what the keycode does, when its name doesn't say it all """
    tapCode: Optional[str] = None
    """ the keycode the key types when tapped, if a hold action can be added or changed: the tapped key of a
    layer-tap or mod-tap (KC_NO for a hold-only one), or a named basic keycode itself, e.g. "KC_A" """


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


class SettingField(BaseModel):
    """ One field of the QMK settings form, as qmk_settings.json defines it. Several boolean fields can share a qsid:
    each is one bit of its value. """
    type: Literal["boolean", "integer"]
    title: str
    qsid: int
    bit: Optional[int] = None
    """ boolean: the bit of the value it is (0 when not given) """
    width: Optional[int] = None
    """ bytes the value takes on the keyboard (1 when not given) """
    min: Optional[int] = None
    """ integer: the smallest value """
    max: Optional[int] = None
    """ integer: the largest value """


class SettingsTab(BaseModel):
    """ A group of QMK settings: Qt's tab """
    name: str
    fields: list[SettingField]


class SettingsDefinitions(BaseModel):
    tabs: list[SettingsTab]


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


class LayoutOptionsValue(BaseModel):
    value: int


class Named(BaseModel):
    """ The name a layer, tap dance or macro is shown with: the user's, or the one given when it has none """
    kind: Literal["layers", "tapDance", "macros"]
    index: int
    name: str
    customName: bool


class MatrixPosition(BaseModel):
    row: int
    col: int


class UnlockState(BaseModel):
    """ Whether the keyboard is unlocked, and how far an unlock has got """
    state: Literal["locked", "unlocking", "cancelled", "unlocked"]
    """ unlocking: the keyboard waits for its unlock keys to be held, and Vial follows its countdown; cancelled: Vial
    stopped following, but the keyboard keeps waiting (it can't be called off) and takes no changes until it is unlocked
    or plugged in again """
    keys: list[MatrixPosition]
    """ the keys to hold, while unlocking or cancelled """
    remaining: int
    """ the keyboard's countdown: how many more polls it wants every key held for (0 before the first poll) """
    total: int
    """ where the countdown started: the highest it was seen at """


class Event(BaseModel):
    """ What /api/events sends: the keyboard was plugged in, unplugged, read again, or its unlock state changed """
    type: Literal["connected", "disconnected", "reloaded", "unlock"]
    unlock: Optional[UnlockState] = None
    """ with "unlock": the new state; sent at every change, and with each reading of the countdown """


class LayoutOptions(BaseModel):
    value: int
    labels: list[Union[str, list[str]]]
    """ one entry per option, as in vial.json: a name (an on/off option), or [name, choice 0, choice 1, ...] """


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
    matrixTester: bool
    """ the keyboard tells which of its keys are held (Vial protocol 3 and later, and a matrix small enough) """


class KeyChange(BaseModel):
    layer: int
    row: int
    col: int
    before: Described
    after: Described


class EncoderChange(BaseModel):
    layer: int
    encoder: int
    direction: int
    before: Described
    after: Described


class LayoutOptionsChange(BaseModel):
    before: int
    after: int


class TapDanceChange(BaseModel):
    before: TapDance
    after: TapDance


class ComboChange(BaseModel):
    before: Combo
    after: Combo


class KeyOverrideChange(BaseModel):
    before: KeyOverride
    after: KeyOverride


class AltRepeatKeyChange(BaseModel):
    before: AltRepeatKey
    after: AltRepeatKey


class MacroChange(BaseModel):
    before: Macro
    after: Macro


class SettingChange(BaseModel):
    qsid: int
    before: int
    after: int


class LayoutFilePreview(BaseModel):
    """ What loading a .vil file would change on the keyboard; nothing is written to find out. Each list holds only
    what differs from what the keyboard holds now. """
    uid: Optional[str] = None
    """ the keyboard the file was saved from, as KeyboardModel.uid; None when the file doesn't say """
    keys: list[KeyChange]
    encoders: list[EncoderChange]
    layoutOptions: Optional[LayoutOptionsChange] = None
    tapDance: list[TapDanceChange]
    combos: list[ComboChange]
    keyOverrides: list[KeyOverrideChange]
    altRepeatKeys: list[AltRepeatKeyChange]
    macros: list[MacroChange]
    settings: list[SettingChange]
    ignored: list[str]
    """ what the file has that this keyboard doesn't, and is left out (as the Qt app does): "layers 4 to 7" """
    needsUnlock: bool
    """ writing it needs an unlocked keyboard (it changes the macros, or puts QK_BOOT somewhere) """


class Session(BaseModel):
    status: Literal["connected", "disconnected"]
    fake: bool
    device: Optional[str] = None
    error: Optional[str] = None
    unlock: UnlockState
    """ a keyboard that is unlocking while not connected waits for an unlock started earlier, before it is read """


class CatalogueKeycode(Described):
    aliases: list[str] = []
    """ other names of the keycode, e.g. KC_ESC for KC_ESCAPE """


class KeycodeCategory(BaseModel):
    """ A group of the keycode picker """
    name: str
    keycodes: list[CatalogueKeycode]
    templates: list[str]
    """ keycodes that wrap another one, e.g. "LT1(kc)" or "LSFT(kc)" """


class KeyboardLanguage(BaseModel):
    id: str
    name: str


class Names(BaseModel):
    layers: dict[str, str]
    tapDance: dict[str, str]
    macros: dict[str, str]


# ---------- requests ----------

KEYCODE_MAX_LENGTH = 200

# Limits for new values. A value equal to what the keyboard already holds is accepted even beyond them (firmware
# defaults and other tools can leave such values), so these are checked in edits.py, not by the request models.
MACRO_DELAY_MAX = 64000
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
    """ A change the keyboard shows at once and forgets when it is unplugged, as Qt's Lighting tab makes it: POST
    /api/lighting/save keeps it. Backlight breathing (backlight.effect) is kept at once: the firmware writes it, with
    the backlight level it runs at, when it changes. At least one section; a section with no fields is skipped. """
    vialrgb: Optional[VialRgbIn] = None
    rgblight: Optional[RgbLightIn] = None
    backlight: Optional[BacklightIn] = None


class SimulatorConnection(Request):
    """ Fake mode only: whether the simulated keyboard is plugged in """
    connected: bool


class SimulatorUnlock(Request):
    """ Fake mode only: the user holds the simulated keyboard's unlock keys (or lets go of them), or it is locked """
    keysHeld: Optional[bool] = None
    locked: Optional[bool] = None
    """ true: lock it, as plugging it in again would """


class NameIn(Request):
    name: Optional[str] = Field(default=None, max_length=40)
