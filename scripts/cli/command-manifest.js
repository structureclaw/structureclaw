const COMMANDS = [
  {
    name: "help",
    usage: "sclaw help",
    description: "Show CLI help",
    aliases: ["-h", "--help"],
    group: "core",
  },
  {
    name: "version",
    usage: "sclaw version",
    description: "Show CLI version",
    aliases: ["-v", "--version"],
    group: "core",
  },
  {
    name: "install",
    usage: "sclaw install",
    description: "Install backend and frontend npm dependencies",
    group: "dev",
  },
  {
    name: "install-cli",
    usage: "sclaw install-cli [--force]",
    description: "Install a user-local CLI shim",
    aliases: ["self-install"],
    group: "core",
  },
  {
    name: "ensure-uv",
    usage: "sclaw ensure-uv",
    description: "Install or verify uv",
    group: "dev",
  },
  {
    name: "setup-analysis-python",
    usage: "sclaw setup-analysis-python",
    description: "Create backend/.venv with analysis dependencies",
    group: "dev",
  },
  {
    name: "mirror-status",
    usage: "sclaw mirror-status",
    description: "Show current mirror configuration and value sources",
    group: "dev",
  },
  {
    name: "dev-backend",
    usage: "sclaw dev-backend",
    description: "Run backend in the foreground",
    group: "dev",
  },
  {
    name: "dev-frontend",
    usage: "sclaw dev-frontend",
    description: "Run frontend in the foreground",
    group: "dev",
  },
  {
    name: "build",
    usage: "sclaw build",
    description: "Build backend and frontend",
    group: "dev",
  },
  {
    name: "convert-batch",
    usage:
      "sclaw convert-batch --input-dir <dir> --output-dir <dir> --report <file> --target-format <name> [--source-format <name> --target-schema-version <version> --allow-failures]",
    description: "Batch-convert structure model JSON files with a report",
    group: "dev",
  },
  {
    name: "db-up",
    usage: "sclaw db-up",
    description: "No-op: local stack no longer requires optional infra",
    group: "infra",
  },
  {
    name: "db-down",
    usage: "sclaw db-down",
    description: "No-op: local stack no longer manages optional infra",
    group: "infra",
  },
  {
    name: "db-init",
    usage: "sclaw db-init",
    description: "Sync SQLite schema and seed data",
    group: "infra",
  },
  {
    name: "db-import-postgres",
    usage: "sclaw db-import-postgres [--source <url> --target <file:url> --force --no-backup]",
    description: "Import a PostgreSQL dataset into SQLite",
    group: "infra",
  },
  {
    name: "db-auto-migrate-legacy-postgres",
    usage: "sclaw db-auto-migrate-legacy-postgres",
    description: "Auto-migrate a local legacy PostgreSQL .env to SQLite",
    group: "infra",
  },
  {
    name: "docker-up",
    usage: "sclaw docker-up",
    description: "Start the full docker compose stack",
    aliases: ["up"],
    group: "infra",
  },
  {
    name: "docker-down",
    usage: "sclaw docker-down",
    description: "Stop the full docker compose stack",
    group: "infra",
  },
  {
    name: "docker-install",
    usage:
      "sclaw docker-install [--non-interactive --llm-base-url <url> --llm-api-key <key> --llm-model <name> --skip-api-test]",
    description: "Configure .env and bootstrap the Docker onboarding stack",
    aliases: ["install-docker"],
    group: "infra",
  },
  {
    name: "docker-start",
    usage: "sclaw docker-start",
    description: "Start or resume the docker stack in detached mode",
    group: "infra",
  },
  {
    name: "docker-stop",
    usage: "sclaw docker-stop",
    description: "Stop the docker stack without removing containers",
    group: "infra",
  },
  {
    name: "docker-status",
    usage: "sclaw docker-status",
    description: "Show docker compose status and health checks",
    group: "infra",
  },
  {
    name: "docker-logs",
    usage: "sclaw docker-logs [backend|frontend|all] [--follow]",
    description: "Show docker compose logs",
    group: "infra",
  },
  {
    name: "local-up",
    usage: "sclaw local-up",
    description: "Start the local stack from source (alias: local-up-uv)",
    aliases: ["local-up-uv"],
    group: "lifecycle",
  },
  {
    name: "health",
    usage: "sclaw health",
    description: "Check service health endpoints",
    group: "lifecycle",
  },
  {
    name: "doctor",
    usage: "sclaw doctor",
    description: "Run local startup preflight checks (alias: check-startup)",
    aliases: ["check-startup"],
    group: "lifecycle",
  },
  {
    name: "start",
    usage: "sclaw start",
    description: "Recommended local startup without docker-managed infra (alias: local-up-noinfra)",
    aliases: ["local-up-noinfra"],
    group: "lifecycle",
  },
  {
    name: "restart",
    usage: "sclaw restart",
    description: "Restart the recommended local stack profile",
    group: "lifecycle",
  },
  {
    name: "stop",
    usage: "sclaw stop",
    description: "Stop the recommended local stack profile (alias: local-down)",
    aliases: ["local-down"],
    group: "lifecycle",
  },
  {
    name: "status",
    usage: "sclaw status",
    description: "Show recommended local stack status (alias: local-status)",
    aliases: ["local-status"],
    group: "lifecycle",
  },
  {
    name: "logs",
    usage: "sclaw logs [frontend|backend|all] [--follow]",
    description: "Show runtime logs from .runtime/logs",
    group: "lifecycle",
  },
  {
    name: "skill",
    usage: "sclaw skill <search|install|enable|disable|uninstall|list> ...",
    description: "Manage external SkillHub skills",
    group: "skillhub",
  },
];

const COMMAND_NAMES = new Set(COMMANDS.map((command) => command.name));
const ALIAS_TO_COMMAND = new Map();
for (const command of COMMANDS) {
  for (const alias of command.aliases || []) {
    ALIAS_TO_COMMAND.set(alias, command.name);
  }
}

module.exports = {
  ALIAS_TO_COMMAND,
  COMMAND_NAMES,
  COMMANDS,
};
