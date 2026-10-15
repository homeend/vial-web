// The Python that runs Vial's server code: $VIAL_PYTHON, else the repository's virtual environment.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const pythonRoot = join(repoRoot, "src", "main", "python");

export function findPython() {
  if (process.env.VIAL_PYTHON) return process.env.VIAL_PYTHON;
  const candidates = [".venv", "venv"].flatMap((dir) => [
    join(repoRoot, dir, "Scripts", "python.exe"),
    join(repoRoot, dir, "bin", "python"),
  ]);
  const found = candidates.find((path) => existsSync(path));
  if (!found) {
    throw new Error(
      "no Python found: create the repository's .venv (see README) or set VIAL_PYTHON",
    );
  }
  return found;
}
