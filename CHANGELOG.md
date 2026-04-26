# Changelog

All notable changes to StructureClaw are documented in this file.

## [1.0.0] - 2026-04-27

### Added

- npm package publication: `npm install -g structureclaw` for instant setup
- Single-process architecture: backend serves frontend static assets via `@fastify/static`
- Frontend static export (`output: 'export'`) for zero-dependency frontend deployment
- Runtime data directory: user data stored in `~/.structureclaw/` (not in package dir)
- Interactive first-run wizard: `sclaw doctor` prompts for LLM configuration
- Dual-mode CLI: works in both source checkout (dev) and installed package (production)
- Thin bin shims with Node.js version validation
- Postinstall script for automatic Prisma client generation
- Packaging script (`prepublishOnly`) for assembling dist/ artifacts
- GitHub Actions workflow for automated npm publishing on release

### Changed

- Root `package.json` restructured for npm publication with hoisted dependencies
- `sclaw start` detects installed-package mode and runs single-process
- Backend config resolves paths to `~/.structureclaw/` in installed mode
- Frontend locale detection moved from SSR to client-side

### Fixed

- Frontend static export compatibility (removed `cookies()` SSR dependency)
