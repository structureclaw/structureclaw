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
    description: "Install a user-local sclaw shim",
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
    name: "db-up",
    usage: "sclaw db-up",
    description: "Start optional local infra via docker compose",
    group: "infra",
  },
  {
    name: "db-down",
    usage: "sclaw db-down",
    description: "Stop optional local infra via docker compose",
    group: "infra",
  },
  {
    name: "db-init",
    usage: "sclaw db-init",
    description: "Sync SQLite schema and seed data",
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
    name: "local-up",
    usage: "sclaw local-up",
    description: "Start the local stack and optional infra",
    group: "lifecycle",
  },
  {
    name: "local-up-uv",
    usage: "sclaw local-up-uv",
    description: "Start the local stack using the uv-managed Python env",
    group: "lifecycle",
  },
  {
    name: "local-up-noinfra",
    usage: "sclaw local-up-noinfra",
    description: "Start the local stack without docker-managed infra",
    group: "lifecycle",
  },
  {
    name: "local-down",
    usage: "sclaw local-down",
    description: "Stop local processes and infra",
    group: "lifecycle",
  },
  {
    name: "local-status",
    usage: "sclaw local-status",
    description: "Show process state and health checks",
    group: "lifecycle",
  },
  {
    name: "health",
    usage: "sclaw health",
    description: "Check service health endpoints",
    group: "lifecycle",
  },
  {
    name: "check-startup",
    usage: "sclaw check-startup",
    description: "Run local startup preflight checks",
    group: "lifecycle",
  },
  {
    name: "doctor",
    usage: "sclaw doctor",
    description: "Run local startup preflight checks",
    group: "lifecycle",
  },
  {
    name: "start",
    usage: "sclaw start",
    description: "Recommended local startup without docker-managed infra",
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
    description: "Stop the recommended local stack profile",
    group: "lifecycle",
  },
  {
    name: "status",
    usage: "sclaw status",
    description: "Show recommended local stack status",
    group: "lifecycle",
  },
  {
    name: "logs",
    usage: "sclaw logs [frontend|backend|all] [--follow]",
    description: "Show runtime logs from .runtime/logs",
    group: "lifecycle",
  },
  {
    name: "backend-regression",
    usage: "sclaw backend-regression",
    description: "Run backend and agent/chat regressions",
    group: "validation",
  },
  {
    name: "analysis-regression",
    usage: "sclaw analysis-regression",
    description: "Run analysis contract and regression checks",
    group: "validation",
  },
  {
    name: "skill",
    usage: "sclaw skill <search|install|enable|disable|uninstall|list> ...",
    description: "Manage external SkillHub skills",
    group: "validation",
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
