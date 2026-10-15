import ast

import simpleeval
import operator

from keycodes.keycodes import KEYCODES_SPECIAL, KEYCODES_BASIC, KEYCODES_SHIFTED, KEYCODES_ISO, KEYCODES_BACKLIGHT, \
    KEYCODES_MEDIA, KEYCODES_USER, Keycode

r = Keycode.resolve


def LCTL(kc): return (r("QK_LCTL") | (kc))
def LSFT(kc): return (r("QK_LSFT") | (kc))
def LALT(kc): return (r("QK_LALT") | (kc))
def LGUI(kc): return (r("QK_LGUI") | (kc))
def RCTL(kc): return (r("QK_RCTL") | (kc))
def RSFT(kc): return (r("QK_RSFT") | (kc))
def RALT(kc): return (r("QK_RALT") | (kc))
def RGUI(kc): return (r("QK_RGUI") | (kc))
def C_S(kc): return (r("QK_LCTL") | r("QK_LSFT") | (kc))
def HYPR(kc): return (r("QK_LCTL") | r("QK_LSFT") | r("QK_LALT") | r("QK_LGUI") | (kc))
def MEH(kc): return (r("QK_LCTL") | r("QK_LSFT") | r("QK_LALT") | (kc))
def LCAG(kc): return (r("QK_LCTL") | r("QK_LALT") | r("QK_LGUI") | (kc))
def SGUI(kc): return (r("QK_LGUI") | r("QK_LSFT") | (kc))
def LCA(kc): return (r("QK_LCTL") | r("QK_LALT") | (kc))
def LSA(kc): return (r("QK_LSFT") | r("QK_LALT") | (kc))
def LAG(kc): return (r("QK_LALT") | r("QK_LGUI") | (kc))
def RSA(kc): return (r("QK_RSFT") | r("QK_RALT") | (kc))
def RCS(kc): return (r("QK_RCTL") | r("QK_RSFT") | (kc))
def LCG(kc): return (r("QK_LCTL") | r("QK_LGUI") | (kc))
def RCG(kc): return (r("QK_RCTL") | r("QK_RGUI") | (kc))

class OutOfRange(ValueError):
    """ An argument that doesn't fit in its keycode: QMK's macros would quietly cut it short, making another keycode """


def layer_count(name):
    """ How many layers the layer keycode `name` can point at, in the keycode protocol in use. LT and LM keep the
    layer in 4 bits; the others in 5 bits in protocol 6 and 8 in protocol 5, except protocol 5's TO, whose layer has
    4 bits next to ON_PRESS. """
    if name in ("LT", "LM"):
        return 16
    if Keycode.protocol == 6:
        return 32
    return 16 if name == "TO" else 256


def check_layer(name, layer):
    count = layer_count(name)
    if not 0 <= layer < count:
        raise OutOfRange("{} works with layers 0–{}".format(name, count - 1))
    return layer


def _basic(name, kc):
    if not 0 <= kc <= 0xFF:
        raise OutOfRange("{} taps a basic keycode, without modifiers".format(name))
    return kc


def _mods(name, mod, mask=0x1F):
    """ mask: 0x1F for all eight modifiers, 0xF for the left-hand ones only (protocol 5's LM) """
    if not 0 <= mod <= mask:
        raise OutOfRange("{} holds modifiers, MOD_LCTL to {}".format(name, "MOD_RGUI" if mask & 0x10 else "MOD_LGUI"))
    return mod


def LT(layer, kc): return (r("QK_LAYER_TAP") | (check_layer("LT", layer) << 8) | _basic("LT", kc))
def TO(layer):
    on_press = 0 if Keycode.protocol == 6 else r("ON_PRESS") << 0x4  # protocol 6's TO has no ON_PRESS bits
    return (r("QK_TO") | on_press | check_layer("TO", layer))
def MO(layer): return (r("QK_MOMENTARY") | check_layer("MO", layer))
def DF(layer): return (r("QK_DEF_LAYER") | check_layer("DF", layer))
def TG(layer): return (r("QK_TOGGLE_LAYER") | check_layer("TG", layer))
def OSL(layer): return (r("QK_ONE_SHOT_LAYER") | check_layer("OSL", layer))
def LM(layer, mod):
    return (r("QK_LAYER_MOD") | (check_layer("LM", layer) << r("QMK_LM_SHIFT")) | _mods("LM", mod, r("QMK_LM_MASK")))
def OSM(mod): return (r("QK_ONE_SHOT_MOD") | _mods("OSM", mod))
def TT(layer): return (r("QK_LAYER_TAP_TOGGLE") | check_layer("TT", layer))
def MT(mod, kc): return (r("QK_MOD_TAP") | (_mods("MT", mod) << 8) | _basic("MT", kc))
def TD(n):
    if not 0 <= n <= 0xFF:
        raise OutOfRange("TD works with tap dances 0–255")
    return (r("QK_TAP_DANCE") | n)


def LCTL_T(kc): return MT(r("MOD_LCTL"), kc)
def RCTL_T(kc): return MT(r("MOD_RCTL"), kc)
def LSFT_T(kc): return MT(r("MOD_LSFT"), kc)
def RSFT_T(kc): return MT(r("MOD_RSFT"), kc)
def LALT_T(kc): return MT(r("MOD_LALT"), kc)
def RALT_T(kc): return MT(r("MOD_RALT"), kc)
def LGUI_T(kc): return MT(r("MOD_LGUI"), kc)
def RGUI_T(kc): return MT(r("MOD_RGUI"), kc)
def C_S_T(kc): return MT(r("MOD_LCTL") | r("MOD_LSFT"), kc)
def MEH_T(kc): return MT(r("MOD_LCTL") | r("MOD_LSFT") | r("MOD_LALT"), kc)
def LCAG_T(kc): return MT(r("MOD_LCTL") | r("MOD_LALT") | r("MOD_LGUI"), kc)
def RCAG_T(kc): return MT(r("MOD_RCTL") | r("MOD_RALT") | r("MOD_RGUI"), kc)
def HYPR_T(kc): return MT(r("MOD_LCTL") | r("MOD_LSFT") | r("MOD_LALT") | r("MOD_LGUI"), kc)
def SGUI_T(kc): return MT(r("MOD_LGUI") | r("MOD_LSFT"), kc)
def LCA_T(kc): return MT(r("MOD_LCTL") | r("MOD_LALT"), kc)
def LSA_T(kc): return MT(r("MOD_LSFT") | r("MOD_LALT"), kc)
def LAG_T(kc): return MT(r("MOD_LALT") | r("MOD_LGUI"), kc)
def RSA_T(kc): return MT(r("MOD_RSFT") | r("MOD_RALT"), kc)
def RCS_T(kc): return MT(r("MOD_RCTL") | r("MOD_RSFT"), kc)
def LCG_T(kc): return MT(r("MOD_LCTL") | r("MOD_LGUI"), kc)
def RCG_T(kc): return MT(r("MOD_RCTL") | r("MOD_RGUI"), kc)


functions = {
    "LCTL": LCTL, "LSFT": LSFT, "LALT": LALT, "LGUI": LGUI, "LOPT": LALT, "LCMD": LGUI, "LWIN": LGUI,
    "RCTL": RCTL, "RSFT": RSFT, "RALT": RALT, "RGUI": RGUI, "ALGR": RALT, "ROPT": RALT, "RCMD": RGUI, "RWIN": RGUI,
    "HYPR": HYPR, "MEH": MEH, "LCAG": LCAG, "SGUI": SGUI, "SCMD": SGUI, "SWIN": SGUI, "LSG": SGUI,
    "C_S": C_S,
    "LCA": LCA, "LSA": LSA, "LAG": LAG, "RSA": RSA, "RCS": RCS, "SAGR": RSA,
    "C": LCTL, "S": LSFT, "A": LALT, "G": LGUI,
    "LT": LT, "TO": TO, "MO": MO, "DF": DF, "TG": TG, "OSL": OSL, "LM": LM, "OSM": OSM, "TT": TT, "MT": MT,
    "LCTL_T": LCTL_T, "RCTL_T": RCTL_T, "CTL_T": LCTL_T,
    "LSFT_T": LSFT_T, "RSFT_T": RSFT_T, "SFT_T": LSFT_T,
    "LALT_T": LALT_T, "RALT_T": RALT_T, "LOPT_T": LALT_T, "ROPT_T": RALT_T, "ALGR_T": RALT_T, "ALT_T": LALT_T, "OPT_T": LALT_T,
    "LGUI_T": LGUI_T, "RGUI_T": RGUI_T, "LCMD_T": LGUI_T, "LWIN_T": LGUI_T, "RCMD_T": RGUI_T, "RWIN_T": RGUI_T,
    "GUI_T": LGUI_T, "CMD_T": LGUI_T, "WIN_T": LGUI_T,
    "C_S_T": C_S_T, "MEH_T": MEH_T,
    "LCAG_T": LCAG_T, "RCAG_T": RCAG_T, "HYPR_T": HYPR_T, "SGUI_T": SGUI_T, "SCMD_T": SGUI_T, "SWIN_T": SGUI_T,
    "LSG_T": SGUI_T,
    "LCA_T": LCA_T, "LSA_T": LSA_T, "LAG_T": LAG_T, "RSA_T": RSA_T, "RCS_T": RCS_T, "SAGR_T": RSA_T, "ALL_T": HYPR_T,
    "TD": TD,
    "LCG": LCG, "RCG": RCG, "LCG_T": LCG_T, "RCG_T": RCG_T,
}

for x in range(16):
    functions["LT{}".format(x)] = lambda kc, layer=x: LT(layer, kc)


class AnyKeycode:

    def __init__(self):
        self.ops = simpleeval.DEFAULT_OPERATORS.copy()
        self.ops.update({
            ast.BitOr: operator.or_,
            ast.BitXor: operator.xor,
            ast.BitAnd: operator.and_,
        })
        self.names = dict()
        self.prepare_names()

    def prepare_names(self):
        for kc in KEYCODES_SPECIAL + KEYCODES_BASIC + KEYCODES_SHIFTED + KEYCODES_ISO + KEYCODES_BACKLIGHT + \
                  KEYCODES_MEDIA + KEYCODES_USER:
            for qmk_id in kc.alias:
                self.names[qmk_id] = Keycode.resolve(kc.qmk_id)
        macros = dict()
        for s in ["MOD_LCTL", "MOD_LSFT", "MOD_LALT", "MOD_LGUI", "MOD_RCTL", "MOD_RSFT", "MOD_RALT", "MOD_RGUI",
                  "MOD_MEH", "MOD_HYPR"]:
            macros[s] = Keycode.resolve(s)
        self.names.update(macros)

    def decode(self, s):
        return simpleeval.simple_eval(s, names=self.names, functions=functions, operators=self.ops)
