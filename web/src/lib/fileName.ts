/** A keyboard's name as a file name: each run of characters file systems refuse (control characters and
 * < > : " / \ | ? *) becomes one "_", dots, spaces and underscores at the ends go, it is cut to 100 characters,
 * and "keyboard" stands when nothing is left */
export function safeFileName(name: string): string {
  const safe = name.replace(/[\u0000-\u001f<>:"/\\|?*]+/g, "_").replace(/^[\s._]+|[\s._]+$/g, "");
  return safe.slice(0, 100) || "keyboard";
}
