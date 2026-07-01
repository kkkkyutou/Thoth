#!/usr/bin/env bash

_thoth_dev_home_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_thoth_dev_home_repo_root="$(cd "$_thoth_dev_home_script_dir/.." && pwd)"

default_dev_thoth_root() {
  printf "%s\n" "${THOTH_DEV_ROOT:-$_thoth_dev_home_repo_root/.dev/thoth-runtime}"
}

resolve_dev_daemon_endpoint() {
  case "${THOTH_LISTEN:-127.0.0.1:6688}" in
    tcp://*) printf "%s\n" "${THOTH_LISTEN#tcp://}" ;;
    *) printf "%s\n" "${THOTH_LISTEN:-127.0.0.1:6688}" ;;
  esac
}

configure_dev_thoth_home() {
  local dev_root
  dev_root="$(default_dev_thoth_root)"
  local thoth_home_was_set="${THOTH_HOME+x}"

  export THOTH_HOME="${THOTH_HOME:-$dev_root/home}"
  export THOTH_LISTEN="${THOTH_LISTEN:-127.0.0.1:6688}"
  export THOTH_RELAY_ENDPOINT="${THOTH_RELAY_ENDPOINT:-relay.test.thoth.seeles.ai:443}"
  export THOTH_RELAY_PUBLIC_ENDPOINT="${THOTH_RELAY_PUBLIC_ENDPOINT:-$THOTH_RELAY_ENDPOINT}"
  export THOTH_RELAY_USE_TLS="${THOTH_RELAY_USE_TLS:-true}"
  export THOTH_RELAY_PUBLIC_USE_TLS="${THOTH_RELAY_PUBLIC_USE_TLS:-true}"
  export THOTH_CORS_ORIGINS="${THOTH_CORS_ORIGINS:-http://127.0.0.1:8082,http://localhost:8082,http://10.9.0.167:8082,http://10.9.0.2:8148,http://180.76.242.105:8148}"

  mkdir -p "$THOTH_HOME" "$dev_root/user-data"

  if [[ -n "$thoth_home_was_set" && "$THOTH_HOME" != "$dev_root/"* ]]; then
    return 0
  fi

  THOTH_DEV_CONFIG_PATH="$THOTH_HOME/config.json" \
  THOTH_DEV_LISTEN="$THOTH_LISTEN" \
  THOTH_DEV_CORS_ORIGINS="$THOTH_CORS_ORIGINS" \
  THOTH_DEV_RELAY_ENDPOINT="$THOTH_RELAY_ENDPOINT" \
  THOTH_DEV_RELAY_PUBLIC_ENDPOINT="$THOTH_RELAY_PUBLIC_ENDPOINT" \
  THOTH_DEV_RELAY_USE_TLS="$THOTH_RELAY_USE_TLS" \
  THOTH_DEV_RELAY_PUBLIC_USE_TLS="$THOTH_RELAY_PUBLIC_USE_TLS" \
    node <<'NODE'
const fs = require("node:fs");

const configPath = process.env.THOTH_DEV_CONFIG_PATH;
if (!configPath) process.exit(0);

let config = {};
try {
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  }
} catch {
  config = {};
}

const allowedOrigins = (process.env.THOTH_DEV_CORS_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

config.daemon = config.daemon && typeof config.daemon === "object" ? config.daemon : {};
config.daemon.listen = process.env.THOTH_DEV_LISTEN ?? "127.0.0.1:6688";
config.daemon.cors = config.daemon.cors && typeof config.daemon.cors === "object" ? config.daemon.cors : {};
config.daemon.cors.allowedOrigins = allowedOrigins;
config.daemon.relay =
  config.daemon.relay && typeof config.daemon.relay === "object" ? config.daemon.relay : {};
config.daemon.relay.endpoint = process.env.THOTH_DEV_RELAY_ENDPOINT ?? "relay.test.thoth.seeles.ai:443";
config.daemon.relay.publicEndpoint =
  process.env.THOTH_DEV_RELAY_PUBLIC_ENDPOINT ?? config.daemon.relay.endpoint;
config.daemon.relay.useTls = process.env.THOTH_DEV_RELAY_USE_TLS !== "false";
config.daemon.relay.publicUseTls = process.env.THOTH_DEV_RELAY_PUBLIC_USE_TLS !== "false";

fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
NODE
}
