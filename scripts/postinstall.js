#!/usr/bin/env node
/**
 * StructureClaw postinstall script.
 * Generates Prisma client for the bundled schema.
 * Non-fatal on failure — user can run `sclaw doctor` to complete setup.
 *
 * Key: npm runs postinstall with cwd = the installing project root
 * (e.g., G:\test-publish\), NOT the package dir.  @prisma/client lives
 * in that project's node_modules, so running `prisma generate` from there
 * writes the generated client into the right node_modules/.prisma/client.
 */
"use strict";

const { execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");

const isWindows = process.platform === "win32";

function main() {
  const rootDir = path.resolve(__dirname, "..");
  const prismaSchema = path.join(rootDir, "backend", "prisma", "schema.prisma");

  // Skip if schema not found (source checkout or partial install)
  if (!existsSync(prismaSchema)) {
    return;
  }

  try {
    // npm runs postinstall scripts from the installing project root,
    // which is where node_modules/@prisma/client lives.
    // init.cwd is set by npm to the project root during install.
    const projectRoot = process.env.INIT_CWD || process.cwd();

    execFileSync("npx", [
      "prisma", "generate",
      `--schema=${prismaSchema}`,
    ], {
      stdio: "pipe",
      cwd: projectRoot,
      timeout: 120000,
      shell: isWindows,
    });
    console.log("[sclaw] Prisma client generated.");
  } catch (err) {
    // Non-fatal: user runs `sclaw doctor` to fully set up
    console.warn("[sclaw] Prisma generate failed (non-fatal). Run `sclaw doctor` to complete setup.");
  }
}

main();
