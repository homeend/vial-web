// Starts a `vial_web.py --fake --no-browser` server, on a free port with its own temporary data dir, and stops it:
// the simulated keyboards the tests use (see SERVERS). Each test worker starts its own (fixtures.ts), so tests that run
// at the same time never share a keyboard. The URLs carry the session token.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findPython, pythonRoot } from "../scripts/python.mjs";

const STARTUP_MS = 30_000;
const STOP_MS = 5_000;
// What vial_web.py prints once it serves a simulated keyboard, the link on the next line. The token must reach the end
// of its line, so output that stops in the middle of the link is never taken for the whole link.
const STARTED = /Vial is running with a simulated keyboard\. Open it at:\r?\n\s*(http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+)\r?\n/;
const MACROPAD_DEFINITION = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "macropad.vial.json");

/** The unlock keys are held for 10 polls, about 2 s, instead of the firmware's usual 50 (a firmware setting,
 * VIAL_UNLOCK_COUNTER_MAX): the polls keep the firmware's timing */
const UNLOCK_COUNTER = ["--unlock-counter", "10"];

/** vial_web.py's arguments for each simulated keyboard: the default simulated Corne (VialRGB lighting), a macropad
 * with encoders, rotated keys, an ISO Enter, a decal, a layout option and no lighting, the Corne with 8 layers, as the
 * owner's W-CORNE has, the Corne with QMK's RGB light and backlight instead of VialRGB, and the Corne with the macropad
 * as the second keyboard, which the test hook PUT /api/simulator/second-keyboard plugs in */
export const SERVERS = {
  corne: [...UNLOCK_COUNTER],
  macropad: ["--definition", MACROPAD_DEFINITION, ...UNLOCK_COUNTER],
  eightLayers: ["--layers", "8", ...UNLOCK_COUNTER],
  qmkLighting: ["--lighting", "qmk_backlight_rgblight", ...UNLOCK_COUNTER],
  twoKeyboards: ["--second-definition", MACROPAD_DEFINITION, ...UNLOCK_COUNTER],
} satisfies Record<string, string[]>;

/** Long enough to start a server, on a busy machine too */
export const SERVER_FIXTURE_MS = STARTUP_MS + 2 * STOP_MS;

const hasExited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null;

/** Resolves true once the process has exited, or false after `ms` */
function exitWithin(child: ChildProcess, ms: number): Promise<boolean> {
  if (hasExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(hasExited(child));
    }, ms);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

/** Stops the server and waits for it, at most a few seconds per attempt. On Windows the venv's python.exe is a
 * launcher that runs the real Python as its child, and there is no gentler stop than terminating, so the whole tree
 * is ended at once. Elsewhere SIGTERM, then SIGKILL if it hasn't exited in time. */
async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || hasExited(child)) return; // never started, or already gone
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      child.kill(); // taskkill failed, e.g. the process exited just now: at least end the launcher
    }
    await exitWithin(child, STOP_MS);
    return;
  }
  child.kill("SIGTERM");
  if (!(await exitWithin(child, STOP_MS))) {
    child.kill("SIGKILL");
    await exitWithin(child, STOP_MS);
  }
}

function removeDataDir(dataDir: string): void {
  // Windows may hold the files of the stopped server for a moment
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}

/** Resolves with the server's link once it serves, or rejects when it exits, fails to start or takes too long */
function waitForUrl(server: ChildProcess, output: { text: string }): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`vial_web.py did not start within ${STARTUP_MS / 1000} s:\n${output.text}`)),
      STARTUP_MS,
    );
    const read = (chunk: Buffer) => {
      output.text += chunk.toString();
      const found = STARTED.exec(output.text);
      if (found) {
        clearTimeout(timer);
        resolve(found[1]);
      }
    };
    server.stdout?.on("data", read);
    server.stderr?.on("data", read);
    server.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`could not run vial_web.py with ${String(server.spawnfile)}: ${error.message}\n${output.text}`));
    });
    server.on("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`vial_web.py exited (${signal ?? code}) before serving:\n${output.text}`));
    });
  });
}

export async function startServer(extraArgs: string[]): Promise<{ url: string; stop: () => Promise<void> }> {
  const dataDir = mkdtempSync(join(tmpdir(), "vial-e2e-"));
  let server: ChildProcess | undefined;
  const output = { text: "" };
  try {
    server = spawn(
      findPython(),
      ["vial_web.py", "--fake", "--no-browser", "--port", "0", "--data-dir", dataDir, ...extraArgs],
      { cwd: pythonRoot, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PYTHONUNBUFFERED: "1" } },
    );
    const url = await waitForUrl(server, output);
    const running = server;
    return {
      url,
      stop: async () => {
        await stopProcess(running);
        removeDataDir(dataDir);
      },
    };
  } catch (error) {
    // never leave a half-started server or its data dir behind
    if (server) await stopProcess(server);
    removeDataDir(dataDir);
    const reason = error instanceof Error ? error.message : String(error);
    const command = ["vial_web.py --fake", ...extraArgs].join(" ");
    throw new Error(`could not start the test server (${command}): ${reason}`, { cause: error });
  }
}
