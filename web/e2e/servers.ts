// Starts a `vial_web.py --fake --no-browser` server (or the Vial executable, see below), on a free port with its own
// temporary data dir, and stops it: the simulated keyboards the tests use (see SERVERS). Each test worker starts its
// own (fixtures.ts), so tests that run at the same time never share a keyboard. The URLs carry the session token.
//
// $E2E_VIAL_CMD runs a built Vial executable instead (dist/Vial.exe, a path relative to the repository or absolute),
// with the same arguments: the whole suite then tests what PyInstaller built. The executable serves the web UI it was
// built with, so it must be rebuilt after the UI changes.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findPython, pythonRoot, repoRoot } from "../scripts/python.mjs";

const STARTUP_MS = 30_000;
const STOP_MS = 5_000;
// Quit to exit: the 2 s shutdown grace, closing the keyboard and Python's exit, on a slow CI machine too
const QUIT_MS = 10_000;
// Each of the two requests that ask the server to quit
const ASK_MS = 5_000;
// After it exits, for the rest of what it printed, before an error quotes it
const CLOSE_MS = 2_000;
// For the test runner's own work around the fixture, on a busy machine
const SPARE_MS = 5_000;
// What Vial prints once it serves a simulated keyboard, the link on the next line. The token must reach the end
// of its line, so output that stops in the middle of the link is never taken for the whole link.
const STARTED = new RegExp(
  String.raw`Vial is running with a simulated keyboard\. Open it at:\r?\n\s*` +
    String.raw`(http://127\.0\.0\.1:\d+/\?token=[\w-]+)\r?\n`,
);
const MACROPAD_DEFINITION = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "macropad.vial.json");

/** The unlock keys are held for 10 polls, about 2 s, instead of the firmware's usual 50 (a firmware setting,
 * VIAL_UNLOCK_COUNTER_MAX): the polls keep the firmware's timing */
const UNLOCK_COUNTER = ["--unlock-counter", "10"];

/** Vial's arguments (vial_web.py's, or the executable's) for each simulated keyboard: the default simulated Corne
 * (VialRGB lighting), a macropad with encoders, rotated keys, an ISO Enter, a decal, a layout option and no lighting,
 * the Corne with 8 layers, as the owner's W-CORNE has, the Corne with 20 layers (more than LT and LM can reach), the
 * Corne with QMK's RGB light and backlight instead of VialRGB, and the Corne with the macropad as the second keyboard,
 * which the test hook PUT /api/simulator/second-keyboard plugs in */
export const SERVERS = {
  corne: [...UNLOCK_COUNTER],
  macropad: ["--definition", MACROPAD_DEFINITION, ...UNLOCK_COUNTER],
  eightLayers: ["--layers", "8", ...UNLOCK_COUNTER],
  twentyLayers: ["--layers", "20", ...UNLOCK_COUNTER],
  qmkLighting: ["--lighting", "qmk_backlight_rgblight", ...UNLOCK_COUNTER],
  twoKeyboards: ["--second-definition", MACROPAD_DEFINITION, ...UNLOCK_COUNTER],
} satisfies Record<string, string[]>;

/** Long enough to start a server and to stop it (asked to quit, waited for, then ended if need be: two attempts to end
 * it where SIGKILL follows SIGTERM), to read the rest of its output for an error, and some time to spare, on a busy
 * machine too */
export const SERVER_FIXTURE_MS = STARTUP_MS + 2 * ASK_MS + QUIT_MS + 2 * STOP_MS + CLOSE_MS + SPARE_MS;

/** What runs Vial: the executable $E2E_VIAL_CMD names, else vial_web.py with the repository's Python */
function vialCommand(): { file: string; args: string[]; cwd: string; name: string; env: NodeJS.ProcessEnv } {
  const executable = process.env.E2E_VIAL_CMD;
  if (executable) {
    const file = resolve(repoRoot, executable);
    // said clearly (by each server that would start), not as an ENOENT
    if (!existsSync(file)) throw new Error(`E2E_VIAL_CMD names ${file}, which doesn't exist`);
    // run from the system's temp folder, outside the repository, as a downloaded executable is: nothing of the
    // repository's is in its working directory. No PYTHON* variables: the frozen executable ignores them.
    return { file, args: [], cwd: tmpdir(), name: executable, env: process.env };
  }
  return {
    file: findPython(),
    args: ["vial_web.py"],
    cwd: pythonRoot,
    name: "vial_web.py",
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  };
}

const hasExited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null;

/** POSIX: the servers running, each in a process group of its own (see startServer), which the terminal's Ctrl+C and
 * hangup don't reach. They are ended with this process when it exits, or when it gets a hangup (the terminal closed).
 * Killed outright (SIGKILL), this process can do nothing, and they outlive it. */
const posixServers = new Set<ChildProcess>();

function killPosixServers(): void {
  for (const server of posixServers) {
    try {
      process.kill(-server.pid!, "SIGKILL");
    } catch {
      // gone already
    }
  }
  posixServers.clear();
}

let endingWithThisProcess = false;

function endServersWithThisProcess(): void {
  if (endingWithThisProcess) return;
  endingWithThisProcess = true;
  process.on("exit", killPosixServers);
  // the hangup still ends this process: with the listener gone, it is raised again for its default action
  process.once("SIGHUP", () => {
    killPosixServers();
    process.kill(process.pid, "SIGHUP");
  });
}

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

/** What came of asking the server to quit: it took the request, it is gone (nothing answers), a request got no answer
 * within ASK_MS, or it answered and said no (`why`: what it answered) */
type Asked = { result: "taken" | "gone" | "unanswered" } | { result: "refused"; why: string };

/** Asks the server to quit as Quit Vial does (POST /api/shutdown, with the session the link gives): it closes the
 * keyboard and exits by itself, and a one-file executable removes the folder it unpacked itself to, which ending it
 * would leave behind. */
async function askToQuit(url: string): Promise<Asked> {
  try {
    const login = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(ASK_MS) });
    await login.body?.cancel();
    const cookie = login.headers.getSetCookie()[0]?.split(";")[0];
    if (!cookie) return { result: "refused", why: `its link answered ${login.status} without a session cookie` };
    const reply = await fetch(new URL("/api/shutdown", url), {
      method: "POST",
      headers: { cookie, origin: new URL(url).origin },
      signal: AbortSignal.timeout(ASK_MS),
    });
    await reply.body?.cancel();
    return reply.status === 204 ? { result: "taken" } : { result: "refused", why: `it answered ${reply.status}` };
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { result: timedOut ? "unanswered" : "gone" };
  }
}

/** Signals the process group the server leads (POSIX); ESRCH means it is gone already */
function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    process.kill(-child.pid!, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") child.kill(signal);
  }
}

/** Ends the server and waits for it, at most a few seconds per attempt. On Windows the venv's python.exe is a
 * launcher that runs the real Python as its child (a one-file executable unpacks itself and runs as its own child
 * too), and there is no gentler stop than terminating, so the whole tree is ended at once. Elsewhere the server
 * runs in its own process group (see startServer), and SIGTERM goes to the group, then SIGKILL if it hasn't exited in
 * time: a one-file executable is a parent with a child, and SIGKILL to the parent alone would orphan the child. */
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
  signalGroup(child, "SIGTERM");
  if (!(await exitWithin(child, STOP_MS))) {
    signalGroup(child, "SIGKILL");
    await exitWithin(child, STOP_MS);
  }
}

function removeDataDir(dataDir: string): void {
  // Windows may hold the files of the stopped server for a moment
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}

/** Resolves once `closed` has (the process's pipes closed: all it printed has been read), or after CLOSE_MS */
function outputRead(closed: Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, CLOSE_MS);
    void closed.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Resolves with the server's link once it serves, or rejects when it exits, fails to start or takes too long.
 * `closed` resolves once its pipes have closed. */
function waitForUrl(
  server: ChildProcess,
  name: string,
  output: { text: string },
  closed: Promise<void>,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${name} did not start within ${STARTUP_MS / 1000} s:\n${output.text}`)),
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
      reject(new Error(`could not run ${name} with ${String(server.spawnfile)}: ${error.message}\n${output.text}`));
    });
    server.on("exit", (code, signal) => {
      clearTimeout(timer);
      // with what it printed last, which may still be on its way
      void outputRead(closed).then(() =>
        reject(new Error(`${name} exited (${signal ?? code}) before serving:\n${output.text}`)));
    });
  });
}

/** A test server: its link, what stops it, its exit code once it exits (by itself: Quit Vial), and what it printed */
export interface TestServer {
  url: string;
  stop: () => Promise<void>;
  exited: Promise<number | null>;
  output: () => string;
}

export async function startServer(extraArgs: string[]): Promise<TestServer> {
  const vial = vialCommand();
  const dataDir = mkdtempSync(join(tmpdir(), "vial-e2e-"));
  let server: ChildProcess | undefined;
  const output = { text: "" };
  try {
    server = spawn(
      vial.file,
      [...vial.args, "--fake", "--no-browser", "--port", "0", "--data-dir", dataDir, ...extraArgs],
      {
        cwd: vial.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: vial.env,
        // POSIX: its own process group, so stopProcess can end the executable's child too (Windows: taskkill /T).
        // That also takes it out of the terminal's process group, which the terminal's Ctrl+C and hangup go to: it is
        // ended with this process instead (posixServers).
        detached: process.platform !== "win32",
      },
    );
    const running = server;
    if (process.platform !== "win32" && running.pid !== undefined) {
      endServersWithThisProcess();
      posixServers.add(running);
      running.once("exit", () => posixServers.delete(running));
    }
    const exited = new Promise<number | null>((resolve) => running.once("exit", (code) => resolve(code)));
    const closed = new Promise<void>((resolve) => running.once("close", () => resolve()));
    const url = await waitForUrl(running, vial.name, output, closed);
    return {
      url,
      stop: async () => {
        // asked to quit first, as Quit Vial does; ended if it can't be asked. Failures are reported only after the
        // server is ended and its data dir removed, so nothing is left behind.
        const asked: Asked = hasExited(running) ? { result: "gone" } : await askToQuit(url);
        const quit = asked.result === "taken" && (await exitWithin(running, QUIT_MS));
        if (!hasExited(running)) await stopProcess(running);
        removeDataDir(dataDir);
        let problem = "";
        if (asked.result === "unanswered") {
          problem = `was asked to quit (POST /api/shutdown) and didn't answer within ${ASK_MS / 1000} s`;
        } else if (asked.result === "refused") {
          problem = `was running and didn't take Quit (POST /api/shutdown): ${asked.why}`;
        } else if (asked.result === "taken" && !quit) {
          problem = `took Quit (POST /api/shutdown) and didn't exit within ${QUIT_MS / 1000} s`;
        } else if (quit && running.exitCode !== 0) {
          problem = `exited with ${running.signalCode ?? running.exitCode} after Quit, not 0`;
        }
        if (problem) {
          await outputRead(closed);
          throw new Error(`${vial.name} ${problem}:\n${output.text}`);
        }
      },
      exited,
      // waitForUrl keeps reading what it prints
      output: () => output.text,
    };
  } catch (error) {
    // never leave a half-started server or its data dir behind
    if (server) await stopProcess(server);
    removeDataDir(dataDir);
    const reason = error instanceof Error ? error.message : String(error);
    const command = [`${vial.name} --fake`, ...extraArgs].join(" ");
    throw new Error(`could not start the test server (${command}): ${reason}`, { cause: error });
  }
}
