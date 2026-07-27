import { spawn } from "child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { RemoteFile, ServerProfile } from "../core/models.ts";
import { METRICS_COMMAND, parseMetrics } from "../core/metrics.ts";
import {
  buildScpDownloadArgs,
  buildScpUploadArgs,
  buildSshInvocation,
} from "../core/ssh-command.ts";

export interface RunningSession {
  write(data: string): void;
  resize(columns: number, rows: number): void;
  close(): void;
}

export interface SessionCallbacks {
  onOutput(chunk: string): void;
  onStatus(status: "online" | "offline" | "error", message: string): void;
}

export interface HostKeyIdentity {
  algorithm: string;
  fingerprint: string;
  line: string;
  keyData: string;
}

export type HostKeyInspection =
  | { status: "trusted"; keys: HostKeyIdentity[] }
  | { status: "unknown"; keys: HostKeyIdentity[] }
  | { status: "changed"; keys: HostKeyIdentity[] };

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const ASKPASS_DIRECTORY = join(homedir(), ".freeshell");
const ASKPASS_PATH = join(ASKPASS_DIRECTORY, "ssh-askpass.sh");
const SSH_DIRECTORY = join(homedir(), ".ssh");
const KNOWN_HOSTS_PATH = join(SSH_DIRECTORY, "known_hosts");

function scanHost(profile: ServerProfile): string {
  return profile.host.startsWith("[") && profile.host.endsWith("]")
    ? profile.host.slice(1, -1)
    : profile.host;
}

function knownHostToken(profile: ServerProfile): string {
  const host = scanHost(profile);
  return profile.port === 22 ? host : `[${host}]:${profile.port}`;
}

function algorithmName(value: string): string {
  if (value === "ssh-ed25519") return "ED25519";
  if (value.startsWith("ecdsa-")) return "ECDSA";
  if (value.startsWith("ssh-rsa") || value.startsWith("rsa-")) return "RSA";
  return value;
}

export function parseHostKeyLines(output: string): HostKeyIdentity[] {
  const keys: HostKeyIdentity[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;
    const algorithm = parts[1];
    const keyData = parts[2];
    keys.push({ algorithm: algorithmName(algorithm), fingerprint: "", line, keyData: `${algorithm} ${keyData}` });
  }
  return keys;
}

function sameHostKeySet(left: HostKeyIdentity[], right: HostKeyIdentity[]): boolean {
  const leftKeys = left.map((key) => key.keyData).sort();
  const rightKeys = right.map((key) => key.keyData).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index]);
}

function passwordEnvironment(profile: ServerProfile, password?: string): NodeJS.ProcessEnv | undefined {
  if (profile.authMode !== "password") return undefined;
  if (!password) throw new Error("密码认证需要重新输入 SSH 密码（密码只保留在本次运行内）。");
  if (process.platform === "win32") {
    throw new Error("当前密码认证需要 macOS 或 Linux 系统 OpenSSH 的 SSH_ASKPASS 支持。");
  }

  mkdirSync(ASKPASS_DIRECTORY, { recursive: true, mode: 0o700 });
  // The helper itself contains no credential. Only the spawned SSH process
  // receives the password in its private environment, and the app never
  // mutates process.env or writes the password to disk.
  writeFileSync(ASKPASS_PATH, "#!/bin/sh\nprintf '%s\\n' \"$FREESHELL_SSH_PASSWORD\"\n");
  chmodSync(ASKPASS_PATH, 0o700);
  return {
    ...process.env,
    DISPLAY: process.env.DISPLAY || ":0",
    SSH_ASKPASS: ASKPASS_PATH,
    SSH_ASKPASS_REQUIRE: "force",
    FREESHELL_SSH_PASSWORD: password,
  };
}

function runProcess(
  executable: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
  timeoutMs = 20000,
  input?: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"], env });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let exitFallback: ReturnType<typeof setTimeout> | undefined;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`SSH 连接在 ${Math.round(timeoutMs / 1000)} 秒内没有完成，请检查认证方式、网络或服务器登录策略。`));
    }, timeoutMs);
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (exitFallback) clearTimeout(exitFallback);
      resolve({ stdout, stderr, code: code ?? 1 });
    };
    child.stdout?.on("data", (chunk: unknown) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk: unknown) => { stderr += String(chunk); });
    child.on("error", (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    // Perry's native child-process backend may emit exit without a later
    // close event. Prefer close so pipes can drain, then fall back shortly.
    child.on("exit", (code: number | null) => {
      exitFallback = setTimeout(() => finish(code), 50);
    });
    child.on("close", finish);
    if (input !== undefined) child.stdin?.end(input);
  });
}

export function formatSshError(stderr: string, code: number): string {
  const detail = stderr.trim();
  const normalized = detail.toLowerCase();

  if (normalized.includes("could not resolve hostname") || normalized.includes("name or service not known")) {
    return "无法解析服务器主机名，请检查地址或 DNS 设置。";
  }
  if (normalized.includes("operation timed out") || normalized.includes("connection timed out")) {
    return "连接服务器超时，请检查地址、端口、防火墙或网络连接。";
  }
  if (normalized.includes("connection refused")) {
    return "服务器拒绝连接，请确认 SSH 服务已启动且端口填写正确。";
  }
  if (normalized.includes("no route to host") || normalized.includes("network is unreachable")) {
    return "网络无法到达服务器，请检查本机网络、VPN 或服务器路由。";
  }
  if (normalized.includes("permission denied")) {
    return "SSH 认证失败，请检查用户名、密码、SSH Agent 或私钥配置。";
  }
  if (normalized.includes("host key verification failed")) {
    return "主机密钥校验失败，请检查 known_hosts 中的服务器指纹。";
  }
  if (detail) return detail.split(/\r?\n/).slice(-3).join("\n");
  return `SSH 连接失败（退出码 ${code}）。`;
}

export class SshService {
  private async scanHostKeys(profile: ServerProfile): Promise<HostKeyIdentity[]> {
    const result = await runProcess(
      "ssh-keyscan",
      ["-T", "8", "-p", String(profile.port), scanHost(profile)],
      undefined,
      10000,
    );
    const keys = parseHostKeyLines(result.stdout);
    if (keys.length === 0) {
      throw new Error(result.stderr.trim() || "无法读取服务器 SSH 主机指纹，请检查地址、端口或网络。 ");
    }
    for (const key of keys) {
      const fingerprint = await runProcess("ssh-keygen", ["-lf", "-"], undefined, 5000, `${key.line}\n`);
      const match = fingerprint.stdout.match(/\b(SHA256:[A-Za-z0-9+/]+={0,2})\b/);
      if (fingerprint.code !== 0 || !match) {
        throw new Error("无法计算服务器 SSH 主机指纹。请确认系统已安装 OpenSSH ssh-keygen。");
      }
      key.fingerprint = match[1].replace(/=+$/, "");
    }
    return keys;
  }

  async inspectHostKey(profile: ServerProfile): Promise<HostKeyInspection> {
    const keys = await this.scanHostKeys(profile);
    if (!existsSync(KNOWN_HOSTS_PATH)) return { status: "unknown", keys };

    const lookup = await runProcess(
      "ssh-keygen",
      ["-F", knownHostToken(profile), "-f", KNOWN_HOSTS_PATH],
      undefined,
      5000,
    );
    const storedKeys = parseHostKeyLines(lookup.stdout);
    if (storedKeys.length === 0) return { status: "unknown", keys };
    const stored = new Set(storedKeys.map((key) => key.keyData));
    if (keys.some((key) => stored.has(key.keyData))) return { status: "trusted", keys };
    return { status: "changed", keys };
  }

  async trustHostKey(profile: ServerProfile, expectedKeys: HostKeyIdentity[]): Promise<void> {
    const currentKeys = await this.scanHostKeys(profile);
    if (!sameHostKeySet(currentKeys, expectedKeys)) {
      throw new Error("服务器指纹在确认过程中发生变化，已阻止连接。请联系服务器管理员核验。");
    }
    mkdirSync(SSH_DIRECTORY, { recursive: true, mode: 0o700 });
    let prefix = "";
    if (existsSync(KNOWN_HOSTS_PATH)) {
      const current = readFileSync(KNOWN_HOSTS_PATH, "utf8");
      if (current.length > 0 && !current.endsWith("\n")) prefix = "\n";
    }
    appendFileSync(KNOWN_HOSTS_PATH, `${prefix}${currentKeys.map((key) => key.line).join("\n")}\n`);
    chmodSync(KNOWN_HOSTS_PATH, 0o600);
  }

  async checkConnection(profile: ServerProfile, password?: string): Promise<void> {
    const invocation = buildSshInvocation(profile, "true");
    const result = await runProcess(invocation.executable, invocation.args, passwordEnvironment(profile, password));
    if (result.code !== 0) throw new Error(formatSshError(result.stderr, result.code));
  }

  openTerminal(profile: ServerProfile, callbacks: SessionCallbacks, password?: string): RunningSession {
    const invocation = buildSshInvocation(profile);
    const child = spawn(invocation.executable, invocation.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: passwordEnvironment(profile, password),
    });
    let closed = false;
    let stderr = "";
    let reportedExit = false;

    child.stdout?.on("data", (chunk: unknown) => {
      callbacks.onStatus("online", `已连接 ${profile.host}`);
      callbacks.onOutput(String(chunk));
    });
    child.stderr?.on("data", (chunk: unknown) => {
      const text = String(chunk);
      stderr += text;
      callbacks.onOutput(text);
    });
    child.on("error", (error: Error) => {
      callbacks.onStatus("error", error.message);
      callbacks.onOutput(`\r\n[FreeShell] ${error.message}\r\n`);
    });
    const reportExit = (code: number | null) => {
      if (reportedExit) return;
      reportedExit = true;
      closed = true;
      const exitCode = code ?? 1;
      callbacks.onStatus(
        exitCode === 0 ? "offline" : "error",
        exitCode === 0 ? "SSH 会话已结束" : formatSshError(stderr, exitCode),
      );
    };
    child.on("exit", reportExit);
    child.on("close", reportExit);

    return {
      write(data: string) {
        if (!closed) child.stdin?.write(data);
      },
      resize(columns: number, rows: number) {
        if (!closed && process.platform !== "win32") child.kill("SIGWINCH");
        void columns;
        void rows;
      },
      close() {
        if (closed) return;
        closed = true;
        child.stdin?.end("exit\n");
        child.kill("SIGTERM");
      },
    };
  }

  async fetchMetrics(profile: ServerProfile, password?: string) {
    const invocation = buildSshInvocation(profile, METRICS_COMMAND);
    const result = await runProcess(invocation.executable, invocation.args, passwordEnvironment(profile, password));
    if (result.code !== 0) throw new Error(result.stderr.trim() || `SSH exited with ${result.code}`);
    return parseMetrics(result.stdout);
  }

  async listDirectory(profile: ServerProfile, remotePath: string, password?: string): Promise<RemoteFile[]> {
    const quoted = shellQuote(remotePath);
    // Use POSIX-compatible ls -lA instead of GNU find -printf for broader compatibility
    // (Alpine, BusyBox, minimal containers, macOS remote hosts, etc.)
    const command = `if [ ! -d ${quoted} ]; then echo "DIRECTORY_NOT_FOUND" >&2; exit 2; fi; ls -lA --time-style=long-iso ${quoted} 2>/dev/null || ls -lA ${quoted}`;
    const invocation = buildSshInvocation(profile, command);
    const result = await runProcess(invocation.executable, invocation.args, passwordEnvironment(profile, password));
    if (result.code !== 0) {
      const err = result.stderr.trim();
      if (err.includes("DIRECTORY_NOT_FOUND") || err.includes("No such file")) {
        throw new Error(`远程目录 "${remotePath}" 不存在，请检查路径。`);
      }
      if (err.includes("Permission denied")) {
        throw new Error(`无法读取远程目录 "${remotePath}"：权限不足。`);
      }
      throw new Error(err || `无法读取远程目录 "${remotePath}"`);
    }

    const base = remotePath.endsWith("/") ? remotePath.slice(0, -1) : remotePath;
    return result.stdout.split(/\r?\n/).filter((line) => {
      // Skip empty lines, "total N" header, and lines that are too short
      if (!line.trim()) return false;
      if (/^total\s+\d+/.test(line.trim())) return false;
      return true;
    }).map((line) => {
      // ls -lA format: permissions links owner group size date time name
      // e.g.: drwxr-xr-x 2 root root 4096 2025-07-20 10:30 dirname
      // or:   -rw-r--r-- 1 root root 1234 Jul 20 10:30 filename
      const parts = line.trim().split(/\s+/);
      if (parts.length < 8) return null;

      const permissions = parts[0];
      const firstChar = permissions.charAt(0);
      const fileKind: RemoteFile["kind"] = firstChar === "d" ? "directory" : firstChar === "l" ? "link" : "file";
      const size = Number.parseInt(parts[4], 10) || 0;

      // Date+time: could be "2025-07-20 10:30" (long-iso) or "Jul 20 10:30" / "Jul 20  2024"
      let modifiedAt: string;
      let nameStartIndex: number;
      if (/^\d{4}-\d{2}-\d{2}$/.test(parts[5])) {
        // long-iso format: date time name...
        modifiedAt = `${parts[5]} ${parts[6]}`;
        nameStartIndex = 7;
      } else {
        // classic format: Mon DD HH:MM or Mon DD YYYY
        modifiedAt = `${parts[5]} ${parts[6]} ${parts[7]}`;
        nameStartIndex = 8;
      }

      let name = parts.slice(nameStartIndex).join(" ");
      // For symlinks, remove " -> target" suffix
      if (fileKind === "link") {
        const arrowIndex = name.indexOf(" -> ");
        if (arrowIndex !== -1) name = name.substring(0, arrowIndex);
      }

      if (!name) return null;

      return {
        name,
        path: `${base}/${name}`,
        kind: fileKind,
        size,
        modifiedAt,
        permissions,
      };
    }).filter((entry): entry is RemoteFile => entry !== null)
      .sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1);
  }

  async upload(profile: ServerProfile, localPath: string, remotePath: string, password?: string): Promise<void> {
    const result = await runProcess("scp", buildScpUploadArgs(profile, localPath, remotePath), passwordEnvironment(profile, password));
    if (result.code !== 0) throw new Error(result.stderr.trim() || "上传失败");
  }

  async download(profile: ServerProfile, remotePath: string, localPath: string, password?: string): Promise<void> {
    const result = await runProcess("scp", buildScpDownloadArgs(profile, remotePath, localPath), passwordEnvironment(profile, password));
    if (result.code !== 0) throw new Error(result.stderr.trim() || "下载失败");
  }

  async createDirectory(profile: ServerProfile, remotePath: string, password?: string): Promise<void> {
    const quoted = shellQuote(remotePath);
    const invocation = buildSshInvocation(profile, `mkdir -p ${quoted}`);
    const result = await runProcess(invocation.executable, invocation.args, passwordEnvironment(profile, password));
    if (result.code !== 0) throw new Error(result.stderr.trim() || "创建远程目录失败");
  }

  async createFile(profile: ServerProfile, remotePath: string, password?: string): Promise<void> {
    const quoted = shellQuote(remotePath);
    const invocation = buildSshInvocation(profile, `touch ${quoted}`);
    const result = await runProcess(invocation.executable, invocation.args, passwordEnvironment(profile, password));
    if (result.code !== 0) throw new Error(result.stderr.trim() || "创建远程文件失败");
  }

  async readFileContent(profile: ServerProfile, remotePath: string, password?: string): Promise<string> {
    const quoted = shellQuote(remotePath);
    const invocation = buildSshInvocation(profile, `cat ${quoted}`);
    const result = await runProcess(invocation.executable, invocation.args, passwordEnvironment(profile, password));
    if (result.code !== 0) throw new Error(result.stderr.trim() || "读取远程文件失败");
    return result.stdout;
  }
}

