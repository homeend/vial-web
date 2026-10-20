# Parity with the Qt app

Every tab, menu and dialog of the Qt app (`src/main/python/main_window.py`, `editor/`, `unlocker.py`,
`about_keyboard.py`) and where it lives in the web UI (`web/src/`), or why it is left out. Phase 5's contract: once
phase 5b is done, the web UI does all of this except what is marked **dropped** or **later**. Checked against the code
on 2026-10-20.

Addresses are the web UI's (`#lighting`); a section the keyboard's firmware doesn't have is left out of the
navigation, as Qt hides the tabs whose `valid()` is false.

## Tabs

| Qt tab | Web UI | Notes |
|---|---|---|
| Keymap (`keymap_editor.py`, keycode tray `tabbed_keycodes.py`) | Keymap, `#keymap` (`keymap/KeymapPage.svelte`, `picker/Picker.svelte`) | Layer tabs, the Inspector, the keycode picker with search and "any keycode". Qt's +/- size buttons: the drawing scales to the window instead. The Overview view is new. A keyboard without lighting isn't offered the picker's Lighting category, nor lighting keys in its search (`picker/offered.ts`, on every page's picker); Qt always offers them. A key that has one still shows it, and "any keycode" still takes one. |
| Layout (`layout_editor.py`) | Layout, `#layout` (`layout/LayoutPage.svelte`) | On/off options as switches, lists of choices as lists; saved at once (`PUT /api/layout-options`; via.c keeps them in its EEPROM). Every drawing of the keyboard follows. |
| Macros (`macro_recorder.py`) | Macros, `#macros` (`behaviours/MacrosPage.svelte`, `MacroEditor.svelte`) | Steps as a chain, recording keys typed in the page (Qt's recorder on Windows and Linux records system-wide; the page records what the browser lets it see, and says so). Memory bar. |
| Macros: Record macro > Append to current, Replace everything | Macros, in the macro editor: "Record, adding to the end" and "Record, replacing the steps" (`behaviours/MacroEditor.svelte`, `recorder.ts`); with no step yet, one button, "Record from keyboard" | Two buttons instead of Qt's menu. Replacing takes the steps away when the recording stops, as Qt does; but nothing recorded replaces nothing (Qt leaves the macro empty then). Until the page's Save, Cancel puts the macro back, as the editor says. |
| Macros: Open Text Editor… (`macro_tab.py`, `textbox_window.py`) | Macros, "Open as text…" in the macro editor (`behaviours/MacroTextDialog.svelte`, `macroText.ts`; `POST /api/macros/parse`) | The same JSON as Qt's, character for character, so text copies between the two. Apply reads it as a `.vil` file's macro is read (as in Qt, a text under 6 characters is no step) and puts the steps in the macro being edited; the page's Save writes them. Where Qt skips a step it can't read or ignores the whole text, the dialog says what is wrong and applies nothing. Copy and Select all (no Paste button: the browser pastes); Save as file… (Ctrl+S) and Load file… (Ctrl+O) save and load a `.vim` file, which Apply then takes. Esc is Cancel. |
| Lighting (`rgb_configurator.py`) | Lighting, `#lighting` (`lighting/LightingPage.svelte`) | VialRGB, QMK RGB light and backlight, only what the keyboard has, as the cards RGB matrix, RGB light and Backlight (Qt's labels: RGB Effect…, Underglow Effect…, Backlight Brightness…); effects by Qt's names. Changes show at once and are kept once saved, as with Qt's Save (`POST /api/lighting/save`). Backlight breathing is the exception, in Qt too: the firmware keeps a change of it at once, with the brightness it runs at, and the page says so. Undo (Qt has none) puts back the lighting saved here last, or what the page showed when it first opened. QMK RGB light's speed isn't shown, as in Qt: no RGB light effect of vial-qmk uses it. |
| Tap Dance (`tap_dance.py`) | Tap dance, `#tap-dance` | |
| Combos (`combos.py`) | Combos, `#combos` | |
| Key Overrides (`key_override.py`) | Key overrides, `#key-overrides` | Option bits follow the firmware (vial.h); Qt's labels of bits 4 and 5 are swapped. |
| Alt Repeat Key (`alt_repeat_key.py`) | Alt-repeat, `#alt-repeat` | |
| QMK Settings (`qmk_settings.py`) | Settings, `#settings` (`settings/SettingsPage.svelte`) | Grouped as Qt's tabs; Save/Undo; Reset to defaults with a confirmation. |
| Matrix tester (`matrix_test.py`) | Matrix tester, `#matrix` (`matrix/MatrixPage.svelte`) | Shown when Qt's would be (Vial protocol 3+, a matrix that fits one reply: `server/device.py has_matrix_tester`). Qt tests whenever its tab shows (it reads the keys every 20 ms); here only after Start testing, which unlocks first (Qt shows an Unlock button). Keys pressed do nothing on the page meanwhile, as Qt grabs the keyboard. The test stops when the window loses the focus or the tab is hidden (Alt+Tab), when the keyboard is unplugged or restarts into its bootloader, and when the page is left; Start testing goes on with what was pressed so far. Reset is Qt's; the switch matrix grid (positions without a key) is new. |
| Firmware updater (`firmware_flasher.py`) | **Later** (phase 7) | The roadmap's optional phase 7. Qt shows it only for keyboards with Vial's own bootloader (`vibl`). Reboot to bootloader (below) is there for flashing with another tool. |

## Above the tabs

| Qt | Web UI | Notes |
|---|---|---|
| Keyboard list and Refresh | The keyboard selector, "Keyboard" in the top bar (`shell/TopBar.svelte`; `GET /api/keyboards`, `POST /api/keyboards/select`) | Shown in place of the keyboard's name only while more than one Vial keyboard is plugged in; with one, nothing changes. Keyboards of the same name are told apart by serial number, else by order. Switching closes the keyboard open and opens the chosen one (`server/device.py DeviceManager.select`), asking first when an editor is open or the Settings page's changes or the lighting aren't saved (`lib/unsaved.ts`). The choice is kept while Vial runs, by the keyboard's serial number (else its USB IDs and name), across a replug: the chosen keyboard unplugged is waited for, and no other is opened instead. Until one is chosen, the first Vial keyboard found is used, as before. Hot-plug is automatic (`DeviceManager.check`, about once a second: the list follows keyboards plugged in or out, "keyboards" event), so Qt's Refresh isn't needed. |
| "No devices detected", the udev hint (Linux only) | The "No keyboard found" page (`App.svelte`), with the udev link | Only on Linux, as in Qt (the session says the server's platform). A keyboard found but unreadable, a failed listing and the chosen keyboard unplugged each have their own page. |

## Menus

| Qt menu item | Web UI | Notes |
|---|---|---|
| File > Load saved layout… (Ctrl+O) | Keyboard page, Load layout… (`about/LayoutFileCard.svelte`) | Shows what changes before anything is written. A file saved from another keyboard is refused (Qt asks whether to load it anyway). |
| File > Save current layout… (Ctrl+S) | Keyboard page, Save layout | Downloads `<keyboard name>.vil`. |
| File > Sideload VIA JSON… | **Dropped** | Roadmap decision 5: VIA-only keyboards aren't supported (the server only finds Vial keyboards). |
| File > Download VIA definitions | **Dropped** | Same decision. |
| File > Load dummy JSON… | **Dropped** | A developer tool; `vial_web.py --fake --definition FILE` simulates a keyboard from its `vial.json` instead. |
| File > Exit (Ctrl+Q) | Ctrl+C in Vial's terminal | Closing the tab leaves Vial running (it prints the link to reopen it). |
| Keyboard layout (QWERTY, AZERTY, …) | Top bar, Keyboard language (`shell/TopBar.svelte`) | Remembered in the browser. |
| Security > Unlock (Ctrl+U) | Top bar, the Locked/Unlocked control; the unlock dialog (`shell/UnlockDialog.svelte`) | A change the firmware refuses while locked starts the unlock too, then is sent again. |
| Security > Lock (Ctrl+L) | Top bar, the Locked/Unlocked control | |
| Security > Reboot to bootloader (Ctrl+B) | Keyboard page, Reboot to bootloader… (`about/BootloaderCard.svelte`) | With a confirmation; unlocks first, as Qt does; then a banner, in the tab that rebooted it, says the keyboard is in its bootloader (other tabs say Keyboard unplugged). A firmware built without the jump says so instead. |
| Theme (System, Light, Dark, Arc, Nord, …) | Top bar, System / Light / Dark | **Dropped**: Qt's other colour themes. |
| About > About *keyboard*… (`about_keyboard.py`) | Keyboard page, About this keyboard (`about/AboutCard.svelte`) | The name, Keyboard ID, protocols, matrix, keys, layers, macro memory, entries and features, with Copy. The USB device as Qt shows it: Manufacturer, Product, VID and PID (four hex digits) and Device (the HID path, cut short with its tooltip), from the keyboard list (`GET /api/keyboards`: what hidapi said when the keyboard was found). |
| About > About Vial… | **Later** (phase 6) | Vial's version comes with the packaging. |

The menus' keyboard shortcuts aren't kept: in a browser, Ctrl+O, Ctrl+S and Ctrl+Q are the browser's.

## Dialogs and messages

| Qt | Web UI | Notes |
|---|---|---|
| Unlocker | Unlock dialog | Same protocol (`DeviceManager.start_unlock`, `poll_unlock`, polled every 200 ms). |
| An unlock left unfinished, found when connecting | Finished first, as Qt does; the page says the keyboard waits to be unlocked | `DeviceManager._connect` |
| Any keycode dialog (`any_keycode_dialog.py`) | The picker's "any keycode" entry (`picker/AnyKeycode.svelte`) | |
| "Unsupported protocol version!" | "A keyboard was found, but couldn't be read", with the protocols | `keyboard_comm.check_protocol_version` |
| "An example keyboard UID was detected" | **Dropped** | A warning for keyboard makers shipping firmware; no user can act on it. |
| "Restart to apply the theme" | Not needed | The web UI changes theme at once. |
