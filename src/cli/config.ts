import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { DEFAULT_PORT } from "../shared/constants.js";

const CONFIG_DIR = join(homedir(), ".hookr");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface HookrConfig {
  serverUrl?: string;
  token?: string;
  remoteHost?: string;
  sshKey?: string;
  sshUser?: string;
  remoteDir?: string;
}

export interface RemoteConfig {
  host: string;
  sshKey: string;
  sshUser: string;
  remoteDir: string;
}

export function resolveRemoteConfig(flags: Partial<RemoteConfig>): RemoteConfig | null {
  const config = loadConfig();
  const host = flags.host || process.env.HOOKR_HOST || config.remoteHost;
  if (!host) return null;
  return {
    host,
    sshKey:
      flags.sshKey ||
      process.env.HOOKR_SSH_KEY ||
      config.sshKey ||
      join(homedir(), ".ssh", "hookr-deploy-key.pem"),
    sshUser:
      flags.sshUser || process.env.HOOKR_SSH_USER || config.sshUser || "ubuntu",
    remoteDir:
      flags.remoteDir || process.env.HOOKR_DIR || config.remoteDir || "/opt/hookr",
  };
}

export function loadConfig(): HookrConfig {
  try {
    if (!existsSync(CONFIG_FILE)) return {};
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return {};
  }
}

export function saveConfig(config: HookrConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
  // Ensure permissions even if the file already existed
  chmodSync(CONFIG_FILE, 0o600);
}

/**
 * Resolve the effective server URL from (in priority order):
 *   1. --server flag (explicit CLI option)
 *   2. HOOKR_SERVER environment variable
 *   3. Saved config file (~/.hookr/config.json)
 *   4. Default: http://localhost:4801
 */
export function resolveServerUrl(flagValue?: string): string {
  return (
    flagValue ||
    process.env.HOOKR_SERVER ||
    loadConfig().serverUrl ||
    `http://localhost:${DEFAULT_PORT}`
  );
}

/**
 * Resolve the effective auth token from (in priority order):
 *   1. --token flag (explicit CLI option)
 *   2. HOOKR_TOKEN environment variable
 *   3. Saved config file (~/.hookr/config.json)
 */
export function resolveToken(flagValue?: string): string | undefined {
  return flagValue || process.env.HOOKR_TOKEN || loadConfig().token;
}
