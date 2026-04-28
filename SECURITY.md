# Security Policy

StructureClaw is an AI-assisted structural engineering workspace. Security reports are taken seriously, especially when they affect local execution, uploaded engineering data, credentials, or generated artifacts.

## Supported Versions

Security fixes target the active 1.0 line. Reports should reference the released version or commit SHA being tested.

## Reporting A Vulnerability

Please do not open a public issue for sensitive reports. Send the maintainers a private report through GitHub Security Advisories, or contact the project maintainers through the repository owner channels if advisories are unavailable.

Include:

- affected version or commit SHA
- operating system and runtime mode (`npm` or source checkout)
- reproduction steps
- impact assessment
- any relevant logs with secrets removed

## Secrets And Local Data

- Never include live API keys, license files, database dumps, or private model data in a report attachment.
- Redact `LLM_API_KEY`, local commercial-engine license data, and proprietary engineering inputs.
- Runtime data normally lives under `~/.structureclaw/` unless `SCLAW_DATA_DIR` overrides it.

## Scope

In scope:

- credential leakage
- arbitrary command execution beyond documented shell-tool policy
- unsafe file access outside the configured workspace/runtime directory
- uploaded file handling issues
- analysis runtime behavior that can corrupt user data or execute unexpected code

Out of scope:

- inaccurate engineering recommendations without a security boundary impact
- missing support for a commercial engine version
- local authorization failures in PKPM/YJK that require vendor licensing support
