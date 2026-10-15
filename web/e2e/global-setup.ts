// Starts two `vial_web.py --fake --no-browser` servers, each on a free port with its own temporary data dir, and
// stops them afterwards: the default simulated Corne (VIAL_URL) and a macropad with encoders, rotated keys, an ISO
// Enter, a decal and a layout option (VIAL_MACROPAD_URL). The URLs carry the session token.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findPython, pythonRoot } from "../scripts/python.mjs";

const STARTUP_MS = 30_000;
const URL_LINE = /http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/;
export const MACROPAD_DEFINITION = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "macropad.vial.json");

async function startServer(extraArgs: string[]): Promise<{ url: string; stop: () => Promise<void> }> {
  const dataDir = mkdtempSync(join(tmpdir(), "vial-e2e-"));
  const server = spawn(
    findPython(),
    ["vial_web.py", "--fake", "--no-browser", "--port", "0", "--data-dir", dataDir, ...extraArgs],
    { cwd: pythonRoot, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PYTHONUNBUFFERED: "1" } },
  );

  let output = "";
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`vial_web.py did not start in time:\n${output}`)), STARTUP_MS);
    const read = (chunk: Buffer) => {
      output += chunk.toString();
      const found = URL_LINE.exec(output);
      if (found) {
        clearTimeout(timer);
        resolve(found[0]);
      }
    };
    server.stdout.on("data", read);
    server.stderr.on("data", read);
    server.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`vial_web.py exited (${code}) before serving:\n${output}`));
    });
  });

  return {
    url,
    stop: async () => {
      server.kill();
      await new Promise((resolve) => (server.exitCode === null ? server.once("exit", resolve) : resolve(null)));
      // Windows may hold the files of the stopped server for a moment
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    },
  };
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const corne = await startServer([]);
  const macropad = await startServer(["--definition", MACROPAD_DEFINITION]).catch(async (error: unknown) => {
    await corne.stop();
    throw error;
  });
  process.env.VIAL_URL = corne.url;
  process.env.VIAL_MACROPAD_URL = macropad.url;
  return async () => {
    await Promise.all([corne.stop(), macropad.stop()]);
  };
}
