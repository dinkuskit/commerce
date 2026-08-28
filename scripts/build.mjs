import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
await rm(join(root, "dist"), { force: true, recursive: true });

const executable = process.platform === "win32" ? "tsc.cmd" : "tsc";
const child = spawn(executable, ["-p", join(root, "tsconfig.json")], {
  cwd: root,
  stdio: "inherit",
});

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (signal) reject(new Error(`TypeScript build stopped by ${signal}`));
    else resolve(code ?? 1);
  });
});

if (exitCode !== 0) process.exitCode = exitCode;
