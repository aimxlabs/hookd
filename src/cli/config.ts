import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = join(homedir(), ".hookr");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface HookrConfig {
  serverUrl?: string;
  token?: string;
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
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}
