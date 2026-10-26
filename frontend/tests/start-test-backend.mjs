import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// spawn(args) avoids shell quoting of Python paths, including paths with spaces.
const defaultPython = fileURLToPath(
  new URL(
    process.platform === "win32"
      ? "../../.venv/Scripts/python.exe"
      : "../../.venv/bin/python",
    import.meta.url,
  ),
);
const python = process.env.TEST_PYTHON || defaultPython;
const script = fileURLToPath(new URL("./run-test-server.py", import.meta.url));
const child = spawn(python, [script], { stdio: "inherit", env: process.env });

child.on("error", (error) => {
  console.error(
    `Cannot start the isolated test backend with ${python}: ${error.message}`,
  );
  console.error(
    "Create casedesk/.venv and install backend requirements, or set TEST_PYTHON.",
  );
  process.exitCode = 1;
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 0 : 1);
});
