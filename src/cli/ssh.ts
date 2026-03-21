import { spawn, type SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";
import type { RemoteConfig } from "./config.js";

/** Build the base SSH args array (options + user@host). */
function sshArgs(remote: RemoteConfig): string[] {
  const args = ["-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10"];
  if (existsSync(remote.sshKey)) {
    args.push("-i", remote.sshKey);
  }
  args.push(`${remote.sshUser}@${remote.host}`);
  return args;
}

/** Build the base SCP args array (options only, no paths). */
function scpArgs(remote: RemoteConfig): string[] {
  const args = ["-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10"];
  if (existsSync(remote.sshKey)) {
    args.push("-i", remote.sshKey);
  }
  return args;
}

/** Execute a command on the remote server via SSH. Returns exit code. */
export function sshExec(
  remote: RemoteConfig,
  command: string,
  options?: { stdio?: SpawnOptions["stdio"] },
): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ssh", [...sshArgs(remote), command], {
      stdio: options?.stdio ?? "inherit",
    });
    proc.on("error", reject);
    proc.on("close", (code) => resolve(code ?? 1));
  });
}

/** Execute a command and capture stdout/stderr as strings. */
export function sshCapture(
  remote: RemoteConfig,
  command: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ssh", [...sshArgs(remote), command], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout!.on("data", (d: Buffer) => (stdout += d));
    proc.stderr!.on("data", (d: Buffer) => (stderr += d));
    proc.on("error", reject);
    proc.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/** Run docker compose on the remote server. */
export function compose(
  remote: RemoteConfig,
  args: string,
  options?: { stdio?: SpawnOptions["stdio"] },
): Promise<number> {
  return sshExec(
    remote,
    `cd ${remote.remoteDir} && sudo docker compose ${args}`,
    options,
  );
}

/** SCP a file from remote to local. Returns exit code. */
export function scpDownload(
  remote: RemoteConfig,
  remotePath: string,
  localPath: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "scp",
      [
        ...scpArgs(remote),
        `${remote.sshUser}@${remote.host}:${remotePath}`,
        localPath,
      ],
      { stdio: "inherit" },
    );
    proc.on("error", reject);
    proc.on("close", (code) => resolve(code ?? 1));
  });
}

/** SCP a file from local to remote. Returns exit code. */
export function scpUpload(
  remote: RemoteConfig,
  localPath: string,
  remotePath: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "scp",
      [
        ...scpArgs(remote),
        localPath,
        `${remote.sshUser}@${remote.host}:${remotePath}`,
      ],
      { stdio: "inherit" },
    );
    proc.on("error", reject);
    proc.on("close", (code) => resolve(code ?? 1));
  });
}

/** Open an interactive SSH session (inherits full stdio). */
export function sshInteractive(remote: RemoteConfig): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ssh", sshArgs(remote), { stdio: "inherit" });
    proc.on("error", reject);
    proc.on("close", (code) => resolve(code ?? 1));
  });
}
