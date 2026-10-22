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
export type KeyboardList = Schemas["KeyboardList"];
export type KeyboardEntry = Schemas["KeyboardEntry"];
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
export type ArrangePreview = Schemas["ArrangePreview"];
export type ArrangeReferences = Schemas["ArrangeReferences"];
export type ArrangedModel = Schemas["ArrangedModel"];
export type LayerMove = Schemas["LayerMove"];
export type UnfinishedArrange = Schemas["UnfinishedArrange"];
export type UnlockState = Schemas["UnlockState"];
export type MatrixPosition = Schemas["MatrixPosition"];
export type MatrixState = Schemas["MatrixState"];
export type Lighting = Schemas["Lighting"];
export type LightingIn = Schemas["LightingIn"];
export type VialRgb = Schemas["VialRgb"];
export type RgbLight = Schemas["RgbLight"];
export type Backlight = Schemas["Backlight"];
/** what /api/events sends */
export type ServerEvent = Schemas["Event"];
// the Learning feature's (docs/learning/lesson-format.md); the lesson set and the layout export come as the server
// read them from their files, and learning/types.ts says their shape (readLessonSet, LayoutExport)
export type FingersIn = Schemas["FingersIn"];
export type LayoutExportReply = Schemas["LayoutExport"];
export type LessonSetSummary = Schemas["LessonSetSummary"];
export type LessonSetImported = Schemas["LessonSetImported"];
export type LessonSetReply = Schemas["LessonSet"];
export type AttemptIn = Schemas["AttemptIn"];
export type LearningSettingsIn = Schemas["LearningSettingsIn"];
