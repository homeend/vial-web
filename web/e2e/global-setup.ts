// Starts three `vial_web.py --fake --no-browser` servers, each on a free port with its own temporary data dir, and
// stops them afterwards: the default simulated Corne (VIAL_URL), a macropad with encoders, rotated keys, an ISO
// Enter, a decal and a layout option (VIAL_MACROPAD_URL), and the Corne with 8 layers, as the owner's W-CORNE has
// (VIAL_EIGHT_LAYERS_URL). The URLs carry the session token.
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
export const MACROPAD_DEFINITION = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "macropad.vial.json");

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

async function startServer(extraArgs: string[]): Promise<{ url: string; stop: () => Promise<void> }> {
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

export default async function globalSetup(): Promise<() => Promise<void>> {
  const started = await Promise.allSettled([
    startServer([]),
    startServer(["--definition", MACROPAD_DEFINITION]),
    startServer(["--layers", "8"]),
  ]);
  const servers = started.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  const failed = started.find((s) => s.status === "rejected");
  if (failed) {
    // never leave the others running
    await Promise.all(servers.map((s) => s.stop()));
    throw failed.reason;
  }
  const [corne, macropad, eight] = servers;
  process.env.VIAL_URL = corne.url;
  process.env.VIAL_MACROPAD_URL = macropad.url;
  process.env.VIAL_EIGHT_LAYERS_URL = eight.url;
  return async () => {
    await Promise.all(servers.map((s) => s.stop()));
  };
}
