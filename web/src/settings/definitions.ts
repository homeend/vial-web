// The QMK settings Vial knows (qmk_settings.json): the same for every keyboard, so read once.
import { api } from "../api/api";
import type { SettingsDefinitions } from "../api/types";

let cached: Promise<SettingsDefinitions> | null = null;

/** The definitions, read from the server the first time; a failed read is tried again next time */
export function settingDefinitions(): Promise<SettingsDefinitions> {
  cached ??= api.settingDefinitions().catch((error: unknown) => {
    cached = null;
    throw error;
  });
  return cached;
}
