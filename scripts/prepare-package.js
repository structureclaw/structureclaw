#!/usr/bin/env node
/**
 * StructureClaw packaging script.
 * Runs during `prepublishOnly` to assemble dist/ from built artifacts.
 */
"use strict";

const { execSync } = require("node:child_process");
const { existsSync, mkdirSync, cpSync, rmSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");

function run(cmd, label) {
  console.log(`[sclaw] ${label}...`);
  try {
    execSync(cmd, { stdio: "inherit", cwd: rootDir, timeout: 300000 });
    console.log(`[sclaw] ${label} done.`);
  } catch (err) {
    console.error(`[sclaw] ${label} failed.`);
    process.exit(1);
  }
}

// Step 1: Build backend if needed
const backendDist = path.join(rootDir, "backend", "dist", "index.js");
if (!existsSync(backendDist)) {
  run("npm run build --prefix backend", "Building backend");
}
if (!existsSync(backendDist)) {
  console.error("[sclaw] backend/dist/index.js not found after build.");
  process.exit(1);
}

// Step 2: Build frontend if needed
const frontendOut = path.join(rootDir, "frontend", "out", "index.html");
if (!existsSync(frontendOut)) {
  // Ensure NEXT_PUBLIC_API_URL is empty so api-base.ts uses same-origin ('') in production
  delete process.env.NEXT_PUBLIC_API_URL;
  run("npm run build --prefix frontend", "Building frontend");
}
if (!existsSync(frontendOut)) {
  console.error("[sclaw] frontend/out/index.html not found after build.");
  process.exit(1);
}

// Step 3: Clean and recreate dist/
if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true });
}
mkdirSync(distDir, { recursive: true });

// Step 4: Copy built artifacts into dist/
console.log("[sclaw] Assembling dist/...");

// Backend compiled JS
const distBackend = path.join(distDir, "backend");
cpSync(path.join(rootDir, "backend", "dist"), distBackend, { recursive: true });

// Write package.json with "type": "module" so Node.js treats dist/backend/*.js as ESM
const backendPackageJson = JSON.stringify({ type: "module" }, null, 2) + "\n";
writeFileSync(path.join(distBackend, "package.json"), backendPackageJson, "utf8");
console.log("[sclaw] Wrote dist/backend/package.json (type: module)");

// Frontend static export
const distFrontend = path.join(distDir, "frontend");
cpSync(path.join(rootDir, "frontend", "out"), distFrontend, { recursive: true });

// Step 5: Validate
const checks = [
  path.join(distBackend, "index.js"),
  path.join(distFrontend, "index.html"),
  path.join(rootDir, "backend", "prisma", "schema.prisma"),
  path.join(rootDir, "bin", "sclaw.js"),
];

let valid = true;
for (const file of checks) {
  if (!existsSync(file)) {
    console.error(`[sclaw] Missing: ${path.relative(rootDir, file)}`);
    valid = false;
  }
}

if (!valid) {
  console.error("[sclaw] Package validation failed.");
  process.exit(1);
}

console.log("[sclaw] Package ready for publishing.");
