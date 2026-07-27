import type { ServerProfile } from "./models.ts";

export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

const HOST_PATTERN = /^(?=.{1,253}$)(\[[0-9a-fA-F:]+\]|[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]|[a-zA-Z0-9])$/;
const USER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$/;

export function validateProfile(profile: ServerProfile): ValidationResult {
  const errors: Record<string, string> = {};

  if (profile.name.trim().length === 0) errors.name = "请输入服务器名称";
  if (!HOST_PATTERN.test(profile.host.trim())) errors.host = "请输入有效的主机名或 IP 地址";
  if (!Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65535) {
    errors.port = "端口必须在 1 到 65535 之间";
  }
  if (!USER_PATTERN.test(profile.username.trim())) errors.username = "请输入有效的 SSH 用户名";
  if (profile.authMode === "key" && !profile.privateKeyPath?.trim()) {
    errors.privateKeyPath = "密钥认证需要选择私钥文件";
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

export function normalizeProfile(profile: ServerProfile): ServerProfile {
  return {
    ...profile,
    name: profile.name.trim(),
    group: profile.group.trim() || "未分组",
    host: profile.host.trim(),
    username: profile.username.trim(),
    privateKeyPath: profile.privateKeyPath?.trim() || undefined,
    // Password authentication is always persisted in the OS keychain. This
    // flag contains no secret and keeps older profile files compatible.
    rememberPassword: profile.authMode === "password",
    tags: profile.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0),
  };
}

export function createProfileId(name: string, host: string): string {
  const source = `${name}-${host}-${Date.now()}`.toLowerCase();
  return source.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
