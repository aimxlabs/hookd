import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { DEFAULT_PORT } from "../shared/constants.js";

const CONFIG_DIR = join(homedir(), ".hookd");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface HookdConfig {
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

/** Extract hostname from a URL, returning undefined for localhost or parse failures. */
function hostnameFromUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const h = new URL(url).hostname;
    return h && h !== "localhost" && h !== "127.0.0.1" ? h : undefined;
  } catch {
    return undefined;
  }
}

export function resolveRemoteConfig(
  flags: Partial<RemoteConfig>,
): RemoteConfig | null {
  const config = loadConfig();
  // Fall back to extracting hostname from serverUrl so users who already
  // ran `hookd setup` or `hookd login` get `hookd manage` for free.
  const host =
    flags.host ||
    process.env.HOOKD_HOST ||
    config.remoteHost ||
    hostnameFromUrl(process.env.HOOKD_SERVER) ||
    hostnameFromUrl(config.serverUrl);
  if (!host) return null;
  return {
    host,
    sshKey:
      flags.sshKey ||
      process.env.HOOKD_SSH_KEY ||
      config.sshKey ||
      join(homedir(), ".ssh", "hookd-deploy-key.pem"),
    sshUser:
      flags.sshUser || process.env.HOOKD_SSH_USER || config.sshUser || "ubuntu",
    remoteDir:
      flags.remoteDir ||
      process.env.HOOKD_DIR ||
      config.remoteDir ||
      "/opt/hookd",
  };
}

export function loadConfig(): HookdConfig {
  try {
    if (!existsSync(CONFIG_FILE)) return {};
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return {};
  }
}

export function saveConfig(config: HookdConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
  // Ensure permissions even if the file already existed
  chmodSync(CONFIG_FILE, 0o600);
}

/**
 * Resolve the effective server URL from (in priority order):
 *   1. --server flag (explicit CLI option)
 *   2. HOOKD_SERVER environment variable
 *   3. Saved config file (~/.hookd/config.json)
 *   4. Default: http://localhost:4801
 */
export function resolveServerUrl(flagValue?: string): string {
  return (
    flagValue ||
    process.env.HOOKD_SERVER ||
    loadConfig().serverUrl ||
    `http://localhost:${DEFAULT_PORT}`
  );
}

/**
 * Resolve the effective auth token from (in priority order):
 *   1. --token flag (explicit CLI option)
 *   2. HOOKD_TOKEN environment variable
 *   3. Saved config file (~/.hookd/config.json)
 */
export function resolveToken(flagValue?: string): string | undefined {
  return flagValue || process.env.HOOKD_TOKEN || loadConfig().token;
}
