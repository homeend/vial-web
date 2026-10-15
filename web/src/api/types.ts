// Names for the API's shapes, generated from the server's OpenAPI schema (schema.d.ts)
import type { components } from "./schema";

type Schemas = components["schemas"];

export type KeyboardModel = Schemas["KeyboardModel"];
export type KeyGeometry = Schemas["KeyGeometry"];
export type Layer = Schemas["Layer"];
export type Described = Schemas["Described"];
export type KeyKind = Described["kind"];
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
/** what /api/events sends */
export type ServerEvent = Schemas["Event"]["type"];
