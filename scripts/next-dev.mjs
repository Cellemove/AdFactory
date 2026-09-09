import { spawn } from "node:child_process";
import { createRequire } from "node:module";

// Next dev and Next build must not share a dist directory while running at the
// same time. A production build replaces the React Client Manifest in `.next`,
// which otherwise leaves the live dev compiler referencing missing factories.
const require = createRequire(import.meta.url);
const nextCli = require.resolve("next/dist/bin/next");
const child = spawn(process.execPath, [nextCli, "dev", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_DIST_DIR: process.env.NEXT_DIST_DIR?.trim() || ".next-dev",
  },
});

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
