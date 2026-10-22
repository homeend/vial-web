# SPDX-License-Identifier: GPL-2.0-or-later
""" Shapes of everything the API sends and accepts. The UI's TypeScript types are generated from these. """
from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt

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


class MatrixState(BaseModel):
    """ Which keys of the switch matrix are held, read about 20 times a second while a tab asks for it """
    state: Literal["testing", "locked", "unsupported", "disconnected"]
    """ testing: `pressed` is what is held now; locked: Vial firmware shows nothing until the keyboard is unlocked;
    unsupported: this keyboard can't tell (KeyboardModel.matrixTester); disconnected: no keyboard """
    pressed: list[MatrixPosition]


class Event(BaseModel):
    """ What /api/events sends: the keyboard was plugged in, unplugged, read again, or its unlock state changed; the
    keyboards plugged in, the one chosen or open, or why none could be read (Session.error) changed ("keyboards":
    GET /api/keyboards and /api/session tell how); to a tab that asked for it ({"type": "matrix", "watch": true}), the
    keys held, at every change; and Vial is stopping, as Quit Vial was used in a tab ("stopped": the last event) """
    type: Literal["connected", "disconnected", "reloaded", "unlock", "matrix", "keyboards", "stopped"]
    unlock: Optional[UnlockState] = None
    """ with "unlock": the new state; sent at every change, and with each reading of the countdown """
    matrix: Optional[MatrixState] = None
    """ with "matrix": the keys held now """


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


class ArrangedModel(KeyboardModel):
    """ The keyboard's model after an arrange, Finish or Put back (POST /api/layers/arrange, /finish, /put-back): a
    KeyboardModel with what the write left """
    layoutVersion: int
    """ the keyboard's layout version now (Session.layoutVersion): what an Undo of this arrange sends as
    ArrangeIn.expect """
    kept: int
    """ keys, encoder directions, entries and macros left as they are because they were changed since the arrange
    stopped (Finish, Put back); 0 for an arrange """


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
    """ what the file has that this keyboard doesn't, and is left out (as the Qt app did): "layers 4 to 7" """
    needsUnlock: bool
    """ writing it needs an unlocked keyboard (it changes the macros, or puts QK_BOOT somewhere) """


class LayerMove(BaseModel):
    """ A layer that an arrange moves: from position `layer` to position `to` """
    layer: int
    to: int


class ArrangeReferences(BaseModel):
    """ By place: the keycodes whose layer number an arrange changes """
    keymap: int
    encoders: int
    tapDance: int
    combos: int
    keyOverrides: int
    altRepeatKeys: int
    macros: int


class ArrangePreview(BaseModel):
    """ What arranging the layers in an order would change; nothing is written to find out """
    moves: list[LayerMove]
    """ the layers that move, by their position now """
    keys: int
    """ keymap keys and encoder directions rewritten """
    references: ArrangeReferences
    keyOverrides: int
    """ key overrides whose "active on layers" changes """
    triLayer: Optional[list[Optional[int]]] = None
    """ a tri-layer key (FN_MO13, FN_MO23) is set and layers 1 to 3 change: they use layers 1, 2 and 3 by number,
    which then hold the layers that are now at these positions (null for one the keyboard doesn't have: a keyboard with
    fewer than 4 layers) """
    savedDefault: list[LayerMove]
    """ the layers that a PDF key (anywhere a keycode can be) points at and that move, as in `moves`. A warning, like
    triLayer: PDF(n) saves layer n in the keyboard as the layer it starts on, which Vial can't read or write, so one
    saved before still names the old position until a PDF key is pressed again. Protocol 6 only (protocol 5 firmware
    has no PDF) """
    problems: list[str]
    """ why the order can't be written (a layer number that doesn't fit where it must go), each "where: what", e.g.
    "layer 2, row 0, column 4: ...", "tap dance 3, hold: ...", "key override 1, replacement: ...", "alt-repeat key 0,
    alt keycode: ..."; none: it can """
    writes: int
    """ the writes it takes: one per key, encoder direction and entry, and one for the macros """
    needsUnlock: bool
    """ writing it needs an unlocked keyboard (it moves QK_BOOT, or changes the macros) """
    layoutVersion: int
    """ the keyboard's layout version this preview was made from (Session.layoutVersion) """


class UnfinishedArrange(BaseModel):
    """ Arranging the layers stopped partway (a write failed): the keyboard may hold part of the new order, until
    POST /api/layers/arrange/finish or /put-back succeeds """
    order: list[int]
    """ the order being written (ArrangeIn.order) """
    done: int
    """ the writes the last attempt did before it stopped """
    total: int
    """ the writes it had to do """
    namesOnly: bool
    """ every write went through (done == total; 0 of 0 after a Finish that only had the names left): the layers are
    arranged, and only the layer names couldn't be saved (the 507 of POST /api/layers/arrange or /finish). Finish
    saves them, writing nothing else; Put back writes the layers back. Only while the keyboard holds the new order:
    once it doesn't (a layout file loaded that holds the old one, say), false, with done and total still the stop's
    own, and Finish writes the new order again, then the names. """


class Session(BaseModel):
    status: Literal["connected", "disconnected"]
    fake: bool
    device: Optional[str] = None
    error: Optional[str] = None
    """ why no keyboard could be opened """
    errorKind: Optional[Literal["list", "read"]] = None
    """ what `error` is about: looking for keyboards failed ("list"), or a keyboard found couldn't be read ("read") """
    keyboard: Optional[str] = None
    """ the id of the keyboard open (KeyboardEntry.id), if one is """
    platform: str
    """ the server's operating system, as Python's sys.platform names it: "win32", "linux", "darwin"... """
    unlock: UnlockState
    """ a keyboard that is unlocking while not connected waits for an unlock started earlier, before it is read """
    arrange: Optional[UnfinishedArrange] = None
    """ arranging the layers of the keyboard loaded stopped partway, and hasn't been finished or put back """
    layoutVersion: Optional[int] = None
    """ the layout version of the keyboard loaded (none loaded: null): a number, 0 when Vial starts, counted up each
    time its layers' order or its whole layout is written, even partly: an arrange, Finish, Put back, a layout file
    loaded (POST /api/layout-file). Edits of keys, macros and the like leave it. Kept in memory only. """


class KeyboardEntry(BaseModel):
    """ A Vial keyboard plugged in, or the chosen one while it is unplugged """
    id: str
    """ what tells it apart from the others, the same after a replug (opaque: its USB serial number when it has one of
    its own, else its USB IDs and name, and which of the keyboards alike it is) """
    name: str
    """ what it is called: its USB product name, else its manufacturer's, else "Vial keyboard" """
    product: str
    """ its USB product name ("" if it gives none) """
    manufacturer: str
    """ its USB manufacturer name ("" if it gives none) """
    vendorId: int
    productId: int
    serial: Optional[str] = None
    """ its USB serial number, without the part every Vial keyboard has; None when that is all it has """
    path: str
    """ its HID device path (as Qt's About keyboard shows it): what the system calls the interface it was opened
    through """
    open: bool
    """ it is the keyboard open (the one the other routes use) """
    plugged: bool


class KeyboardList(BaseModel):
    keyboards: list[KeyboardEntry]
    chosen: Optional[str] = None
    """ the id of the keyboard chosen (POST /api/keyboards/select), kept while the server runs; None: none was, and
    the first one found is opened """


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


# ---------- learning (docs/learning/lesson-format.md) ----------

Hand = Literal["left", "right"]
Finger = Literal["index", "middle", "ring", "pinky", "thumb"]
Reach = Literal["rest", "up", "down", "inner", "outer"]
KeyRow = Literal["number", "top", "home", "bottom", "thumb"]


class FingerKey(BaseModel):
    """ Which finger types a key, and from where (lesson-rules.md section 2) """
    hand: Hand
    finger: Finger
    row: KeyRow
    reach: Reach
    home: bool
    """ a resting key: the finger rests on it """


class Fingers(BaseModel):
    """ The app's finger proposal for the keyboard open, with the user's corrections on top """
    format: str
    keys: dict[str, FingerKey]
    """ by key id ("r1c4": matrix row 1, column 4) """
    home: list[str]
    """ the resting keys' ids """
    proposal: bool
    """ nothing is saved: this is the app's proposal alone """


class ExportKeyboard(BaseModel):
    name: str
    uid: str


class LayoutExport(BaseModel):
    """ The layout export the lesson generator reads (lesson-format.md section 2); layers, shiftKeys and keys are as
    the format describes them """
    format: str
    keyboard: ExportKeyboard
    hash: str
    """ "sha256:…" over the character map: what a lesson set is valid for """
    exportedAt: str
    language: str
    """ the keyboard language the characters are of (KeyboardLanguage.id) """
    layers: list[dict]
    shiftKeys: list[dict]
    keys: list[dict]


class LessonSetSummary(BaseModel):
    """ A lesson set file of the keyboard open (learning/<uid>/sets/<id>.json) """
    id: str
    title: str
    """ the file name when the file can't be read """
    language: str
    lessons: int
    layoutHash: Optional[str] = None
    """ the hash of the layout export it was made from """
    outOfDate: bool
    """ its layoutHash isn't the keyboard's now: a character moved since (it still opens) """
    error: Optional[str] = None
    """ the first thing wrong with the file, when it isn't a lesson set the app can open """


class LessonSetImported(LessonSetSummary):
    warnings: list[str]
    """ what the checker would rather have otherwise (the set was saved all the same) """


class LessonSet(BaseModel):
    """ A lesson set, as its file has it (lesson-format.md section 3); fields the format doesn't require are kept """
    model_config = ConfigDict(extra="allow")
    format: str
    id: str
    title: str
    language: str
    layout: dict
    lessons: list[dict]


class Attempt(BaseModel):
    """ An exercise typed to the end """
    at: str
    chars: int
    errors: int
    accuracy: float
    """ 100 × (chars − errors) / chars, one decimal """
    wpm: float
    """ chars / 5 / minutes, one decimal """
    seconds: float


class ExerciseProgress(BaseModel):
    done: bool
    best: Optional[Attempt] = None
    """ the attempt with the highest accuracy, then the highest WPM """
    attempts: list[Attempt]
    """ the last 50 """


class Progress(BaseModel):
    """ The progress on one lesson set (lesson-format.md section 4) """
    format: str
    lessonSet: str
    layoutHash: Optional[str] = None
    exercises: dict[str, ExerciseProgress]


class LearningSettings(BaseModel):
    passAccuracy: int
    """ the accuracy, in percent, that passes an exercise """
    targetWpm: int
    """ the speed that earns a star """
    pictureInWords: bool
    """ show the keyboard picture in word exercises too """


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
MACRO_TEXT_MAX = 16 * MACRO_BUFFER_MAX
""" the longest macro text taken: room for a whole macro memory of keys written out by name """

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


class MacroTextIn(Request):
    """ A macro as Qt's text editor has it (POST /api/macros/parse) """
    text: str = Field(max_length=MACRO_TEXT_MAX)


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


class SimulatorSecondKeyboard(Request):
    """ Fake mode only: whether the second simulated keyboard is plugged in; unreadable: plugged in with firmware this
    Vial can't read (a newer Vial protocol), which is listed but fails to load """
    connected: bool
    unreadable: bool = False


class SimulatorPress(Request):
    """ Fake mode only: a key of the simulated keyboard's matrix is pressed, or let go """
    row: Byte
    col: Byte
    pressed: bool


class SimulatorUnlock(Request):
    """ Fake mode only: the user holds the simulated keyboard's unlock keys (or lets go of them), or it is locked """
    keysHeld: Optional[bool] = None
    locked: Optional[bool] = None
    """ true: lock it, as plugging it in again would """


class SimulatorFailWrite(Request):
    """ Fake mode only: the `after`th write from now to the simulated keyboard fails (1: the next one); null: none does.
    unplug: the keyboard drops off the bus at that write (plugged back in with SimulatorConnection), else it stays
    plugged in and its connection stops working (the server opens it again, as after a USB reset) """
    after: Optional[StrictInt] = Field(default=None, ge=1, le=100_000)
    unplug: bool = False


class ArrangeIn(Request):
    order: list[Byte] = Field(min_length=1, max_length=256)
    """ for each new position, the layer that goes there: [0, 3, 1, 2] puts layer 3 at position 1. Every layer once,
    layer 0 first. """
    expect: Optional[StrictInt] = Field(default=None, ge=0)
    """ POST /api/layers/arrange: the layout version the order was made for (ArrangePreview.layoutVersion,
    ArrangedModel.layoutVersion, Session.layoutVersion); another one is refused with 409 and code "layoutChanged".
    Null or left out: any. The preview ignores it. """


class SelectKeyboard(Request):
    id: str = Field(max_length=1000)
    """ KeyboardEntry.id of the keyboard to use """


class NameIn(Request):
    name: Optional[str] = Field(default=None, max_length=40)


LEARNING_KEYS_MAX = 1000
""" more keys than any keyboard has """


class FingerFix(Request):
    """ The user's say on one key """
    finger: Finger
    reach: Reach


class FingersIn(Request):
    """ The user's finger corrections (PUT /api/learning/fingers): replaces what was saved """
    keys: dict[str, FingerFix] = Field(max_length=LEARNING_KEYS_MAX)
    """ by key id; keys the keyboard doesn't have are ignored """
    home: list[Annotated[str, Field(max_length=20)]] = Field(max_length=LEARNING_KEYS_MAX)
    """ the resting keys' ids: these and no others """


class AttemptIn(Request):
    """ An exercise typed to the end (PUT /api/learning/progress/{set}/{exercise}); accuracy and WPM are computed by
    the server """
    at: str = Field(max_length=40)
    """ when, as the page tells it (ISO 8601) """
    chars: int = Field(ge=1, le=1_000_000)
    errors: int = Field(ge=0, le=1_000_000)
    """ wrong characters typed (a corrected mistake still counts one) """
    seconds: float = Field(gt=0, le=86_400)


class LearningSettingsIn(Request):
    passAccuracy: StrictInt = Field(ge=50, le=100)
    targetWpm: StrictInt = Field(ge=1, le=300)
    pictureInWords: StrictBool
