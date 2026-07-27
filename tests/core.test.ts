import test from "node:test";
import assert from "node:assert/strict";
import type { ServerProfile } from "../src/core/models.ts";
import { parseMetrics } from "../src/core/metrics.ts";
import { appendTerminalChunk, limitTerminalLines, sanitizeTerminalOutput } from "../src/core/terminal.ts";
import { buildScpUploadArgs, buildSshArgs, buildSshInvocation } from "../src/core/ssh-command.ts";
import { formatSshError, parseHostKeyLines } from "../src/services/ssh-service.ts";
import { normalizeProfile, validateProfile } from "../src/core/validation.ts";

const baseProfile: ServerProfile = {
  id: "server-1",
  name: "Production",
  group: "prod",
  host: "api.example.com",
  port: 2222,
  username: "deploy",
  authMode: "agent",
  tags: ["api"],
  favorite: true,
};

test("validates a safe SSH Agent profile", () => {
  assert.deepEqual(validateProfile(baseProfile), { valid: true, errors: {} });
});

test("rejects invalid endpoint fields and a missing private key", () => {
  const result = validateProfile({
    ...baseProfile,
    host: "bad host; reboot",
    port: 70000,
    username: "-root",
    authMode: "key",
  });
  assert.equal(result.valid, false);
  assert.deepEqual(Object.keys(result.errors).sort(), ["host", "port", "privateKeyPath", "username"]);
});

test("normalizes user-entered profile text", () => {
  const result = normalizeProfile({ ...baseProfile, name: "  API  ", group: " ", tags: [" prod ", "", " linux"] });
  assert.equal(result.name, "API");
  assert.equal(result.group, "未分组");
  assert.deepEqual(result.tags, ["prod", "linux"]);
});

test("normalizes password profiles to permanent keychain storage", () => {
  const result = normalizeProfile({ ...baseProfile, authMode: "password", rememberPassword: false });
  assert.equal(result.rememberPassword, true);
});

test("builds SSH arguments without invoking a shell", () => {
  const args = buildSshArgs({ ...baseProfile, authMode: "key", privateKeyPath: "/Users/test/.ssh/id_ed25519" }, false);
  assert.deepEqual(args.slice(0, 4), ["-T", "-p", "2222", "-o"]);
  assert.ok(args.includes("BatchMode=yes"));
  assert.ok(args.includes("IdentitiesOnly=yes"));
  assert.ok(args.includes("StrictHostKeyChecking=yes"));
  assert.equal(args.at(-1), "deploy@api.example.com");
});

test("enables password prompts for password authentication preflight", () => {
  const profile = { ...baseProfile, authMode: "password" as const };
  const args = buildSshArgs(profile, false);
  assert.ok(args.includes("PreferredAuthentications=password,keyboard-interactive"));
  assert.ok(args.includes("PubkeyAuthentication=no"));
  assert.ok(args.includes("PasswordAuthentication=yes"));
  assert.ok(!args.includes("BatchMode=yes"));
  assert.deepEqual(validateProfile(profile), { valid: true, errors: {} });
});

test("uses password authentication options for SCP", () => {
  const args = buildScpUploadArgs({ ...baseProfile, authMode: "password" }, "local.txt", "/tmp/");
  assert.ok(args.includes("PreferredAuthentications=password,keyboard-interactive"));
  assert.ok(args.includes("PubkeyAuthentication=no"));
  assert.ok(args.includes("StrictHostKeyChecking=yes"));
});

test("parses scanned SSH host keys into confirmation fingerprints", () => {
  const keys = parseHostKeyLines("# scan comment\n10.0.0.8 ssh-ed25519 AQID\n");
  assert.equal(keys.length, 1);
  assert.equal(keys[0].algorithm, "ED25519");
  assert.equal(keys[0].keyData, "ssh-ed25519 AQID");
  assert.equal(keys[0].fingerprint, "");
});

test("keeps remote commands as one SSH argv item", () => {
  const invocation = buildSshInvocation(baseProfile, "printf '%s' hello");
  assert.equal(invocation.executable, "ssh");
  assert.equal(invocation.args.at(-1), "printf '%s' hello");
});

test("uses scp argv delimiter before user-controlled local path", () => {
  const args = buildScpUploadArgs(baseProfile, "-dangerous-name", "/tmp/");
  assert.equal(args.at(-3), "--");
  assert.equal(args.at(-2), "-dangerous-name");
});

test("parses and clamps remote Linux metrics", () => {
  const now = new Date("2026-07-21T06:00:00.000Z");
  const metrics = parseMetrics("cpu=17.4\nmem=101.2\ndisk=62\nload=0.25, 0.40, 0.31\nuptime=3 days\nprocesses=146\n", now);
  assert.equal(metrics.cpuPercent, 17.4);
  assert.equal(metrics.memoryPercent, 100);
  assert.equal(metrics.diskPercent, 62);
  assert.equal(metrics.loadAverage, "0.25, 0.40, 0.31");
  assert.equal(metrics.processes, 146);
  assert.equal(metrics.updatedAt, now.toISOString());
});

test("removes terminal title and ANSI control sequences from PTY output", () => {
  const raw = "\u001b]0;root@host:~\u0007\u001b[32mroot@host\u001b[0m\rprogress\n";
  assert.equal(sanitizeTerminalOutput(raw), "root@host\nprogress\n");
});

test("parses screen clear sequences to refresh top/htop terminal views", () => {
  const raw = "frame 1 output\n\u001b[2J\u001b[Htop - 09:50:00 up 10 days\nTasks: 120 total";
  assert.equal(sanitizeTerminalOutput(raw), "top - 09:50:00 up 10 days\nTasks: 120 total");
});

test("turns common SSH failures into actionable messages", () => {
  assert.equal(
    formatSshError("ssh: Could not resolve hostname missing.invalid: nodename nor servname provided", 255),
    "无法解析服务器主机名，请检查地址或 DNS 设置。",
  );
  assert.equal(
    formatSshError("deploy@host: Permission denied (publickey).", 255),
    "SSH 认证失败，请检查用户名、密码、SSH Agent 或私钥配置。",
  );
  assert.equal(
    formatSshError("ssh: connect to host 10.0.0.1 port 22: Connection refused", 255),
    "服务器拒绝连接，请确认 SSH 服务已启动且端口填写正确。",
  );
});

test("keeps useful unknown SSH stderr without flooding the UI", () => {
  assert.equal(formatSshError("line one\nline two\nline three\nline four", 255), "line two\nline three\nline four");
  assert.equal(formatSshError("", 7), "SSH 连接失败（退出码 7）。");
});

test("truncates long terminal output buffers to max lines", () => {
  const input = "line1\nline2\nline3\nline4\nline5";
  assert.equal(limitTerminalLines(input, 3), "line3\nline4\nline5");
  assert.equal(limitTerminalLines(input, 10), input);
});

test("configures SSH keepalive parameters for session persistence", () => {
  const args = buildSshArgs(baseProfile, true);
  assert.ok(args.includes("ServerAliveInterval=30"));
  assert.ok(args.includes("ServerAliveCountMax=3"));
});

test("appendTerminalChunk appends normal output incrementally", () => {
  const buffer = "[root@host ~]# ";
  const result = appendTerminalChunk(buffer, "ls\nfile1  file2\n");
  assert.ok(result.includes("[root@host ~]# ls"));
  assert.ok(result.includes("file1  file2"));
});

test("appendTerminalChunk replaces buffer on screen-clear for top/htop", () => {
  const buffer = "old buffer content\nold line 2\n";
  const topFrame = "\x1B[2J\x1B[Htop - 10:00:00 up 5 days\nTasks: 150 total";
  const result = appendTerminalChunk(buffer, topFrame);
  assert.ok(!result.includes("old buffer content"));
  assert.ok(result.includes("top - 10:00:00 up 5 days"));
  assert.ok(result.includes("Tasks: 150 total"));
});
