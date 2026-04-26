#!/usr/bin/env node
/**
 * StructureClaw postinstall script.
 * Runs `prisma generate` for the bundled schema — non-fatal on failure.
 * Inspired by OpenClaw's postinstall pattern.
 */
"use strict";

const { execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const prismaSchema = path.join(rootDir, "backend", "prisma", "schema.prisma");

// Skip if schema not found (source checkout or partial install)
if (!existsSync(prismaSchema)) {
  return;
}

try {
  execFileSync("npx", ["prisma", "generate", `--schema=${prismaSchema}`], {
    stdio: "pipe",
    cwd: rootDir,
    timeout: 60000,
  });
  console.log("[sclaw] Prisma client generated.");
} catch (err) {
  // Non-fatal: user runs `sclaw doctor` to fully set up
  console.warn("[sclaw] Prisma generate failed (non-fatal). Run `sclaw doctor` to complete setup.");
}
