// Names for the API's shapes, generated from the server's OpenAPI schema (schema.d.ts)
import type { components } from "./schema";

type Schemas = components["schemas"];

export type KeyboardModel = Schemas["KeyboardModel"];
export type KeyGeometry = Schemas["KeyGeometry"];
export type Layer = Schemas["Layer"];
export type Described = Schemas["Described"];
export type KeyKind = Described["kind"];
/** what a layer key does with its layer: "while held", "toggle", ... */
export type LayerAction = NonNullable<Described["layerAction"]>;
export type LayoutOptions = Schemas["LayoutOptions"];
export type KeycodeCategory = Schemas["KeycodeCategory"];
export type CatalogueKeycode = Schemas["CatalogueKeycode"];
export type KeyboardLanguage = Schemas["KeyboardLanguage"];
export type Session = Schemas["Session"];
export type Names = Schemas["Names"];
export type TapDance = Schemas["TapDance"];
export type TapDanceIn = Schemas["TapDanceIn"];
export type Legend = Schemas["Legend"];
export type Named = Schemas["Named"];
export type Combo = Schemas["Combo"];
export type ComboIn = Schemas["ComboIn"];
export type Macro = Schemas["Macro"];
export type Macros = Schemas["Macros"];
export type MacroAction = Schemas["MacroAction"];
export type MacroActionIn = Schemas["MacroActionIn"];
export type KeyOverride = Schemas["KeyOverride"];
export type KeyOverrideIn = Schemas["KeyOverrideIn"];
export type AltRepeatKey = Schemas["AltRepeatKey"];
export type AltRepeatKeyIn = Schemas["AltRepeatKeyIn"];
export type QmkSetting = Schemas["QmkSetting"];
export type SettingField = Schemas["SettingField"];
export type SettingsTab = Schemas["SettingsTab"];
export type SettingsDefinitions = Schemas["SettingsDefinitions"];
export type LayoutFilePreview = Schemas["LayoutFilePreview"];
export type UnlockState = Schemas["UnlockState"];
export type MatrixPosition = Schemas["MatrixPosition"];
/** what /api/events sends */
export type ServerEvent = Schemas["Event"];
