# Parity with the Qt app

Every tab, menu and dialog of the Qt app (`src/main/python/main_window.py`, `editor/`, `unlocker.py`,
`about_keyboard.py`) and where it lives in the web UI (`web/src/`), or why it is left out. Phase 5's contract: once
phase 5b is done, the web UI does all of this except what is marked **dropped** or **later**. Checked against the code
on 2026-10-19.

Addresses are the web UI's (`#lighting`); a section the keyboard's firmware doesn't have is left out of the
navigation, as Qt hides the tabs whose `valid()` is false.

## Tabs

| Qt tab | Web UI | Notes |
|---|---|---|
| Keymap (`keymap_editor.py`, keycode tray `tabbed_keycodes.py`) | Keymap, `#keymap` (`keymap/KeymapPage.svelte`, `picker/Picker.svelte`) | Layer tabs, the Inspector, the keycode picker with search and "any keycode". Qt's +/- size buttons: the drawing scales to the window instead. The Overview view is new. |
| Layout (`layout_editor.py`) | Layout, `#layout` (`layout/LayoutPage.svelte`) | On/off options as switches, lists of choices as lists; saved at once (`PUT /api/layout-options`; via.c keeps them in its EEPROM). Every drawing of the keyboard follows. |
| Macros (`macro_recorder.py`) | Macros, `#macros` (`behaviours/MacrosPage.svelte`, `MacroEditor.svelte`) | Steps as a chain, recording keys typed in the page (Qt's recorder on Windows and Linux records system-wide; the page records what the browser lets it see, and says so). Memory bar. |
| Lighting (`rgb_configurator.py`) | Lighting, `#lighting` (`lighting/LightingPage.svelte`) | VialRGB, QMK RGB light and backlight, only what the keyboard has; effects by Qt's names. Changes show at once and are kept once saved, as Qt's Save does (`POST /api/lighting/save`). QMK RGB light's speed isn't shown, as in Qt: no RGB light effect of vial-qmk uses it. |
| Tap Dance (`tap_dance.py`) | Tap dance, `#tap-dance` | |
| Combos (`combos.py`) | Combos, `#combos` | |
| Key Overrides (`key_override.py`) | Key overrides, `#key-overrides` | Option bits follow the firmware (vial.h); Qt's labels of bits 4 and 5 are swapped. |
| Alt Repeat Key (`alt_repeat_key.py`) | Alt-repeat, `#alt-repeat` | |
| QMK Settings (`qmk_settings.py`) | Settings, `#settings` (`settings/SettingsPage.svelte`) | Grouped as Qt's tabs; Save/Undo; Reset to defaults with a confirmation. |
| Matrix tester (`matrix_test.py`) | Matrix tester, `#matrix` (`matrix/MatrixPage.svelte`) | Shown when Qt's would be (Vial protocol 3+, a matrix that fits one reply: `server/device.py has_matrix_tester`). Start testing unlocks first, as Qt's Unlock button; keys pressed do nothing on the page meanwhile, as Qt grabs the keyboard. The switch matrix grid (positions without a key) and Reset are there too. |
| Firmware updater (`firmware_flasher.py`) | **Later** (phase 7) | The roadmap's optional phase 7. Qt shows it only for keyboards with Vial's own bootloader (`vibl`). Reboot to bootloader (below) is there for flashing with another tool. |

## Above the tabs

| Qt | Web UI | Notes |
|---|---|---|
| Keyboard list and Refresh | **Dropped for now**: the first Vial keyboard found is used | Hot-plug is automatic (`DeviceManager.check`), so Refresh isn't needed. Choosing among several Vial keyboards plugged in at once isn't built: the owner has one. It would need a keyboard list in the session and a route to pick one. |
| "No devices detected", the Linux udev hint | The "No keyboard found" page (`App.svelte`), with the udev link | |

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
| Security > Reboot to bootloader (Ctrl+B) | Keyboard page, Reboot to bootloader… (`about/BootloaderCard.svelte`) | With a confirmation; unlocks first, as Qt does; then a banner says the keyboard is in its bootloader. A firmware built without the jump (VIAL_INSECURE) says so instead. |
| Theme (System, Light, Dark, Arc, Nord, …) | Top bar, System / Light / Dark | **Dropped**: Qt's other colour themes. |
| About > About *keyboard*… (`about_keyboard.py`) | Keyboard page, About this keyboard (`about/AboutCard.svelte`) | |
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
