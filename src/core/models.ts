export type AuthMode = "agent" | "key" | "password";
export type ConnectionStatus = "offline" | "connecting" | "online" | "error";

export interface ServerProfile {
  id: string;
  name: string;
  group: string;
  host: string;
  port: number;
  username: string;
  authMode: AuthMode;
  privateKeyPath?: string;
  /** Persist only the choice. The password itself lives in the OS keychain. */
  rememberPassword?: boolean;
  tags: string[];
  favorite: boolean;
  lastConnectedAt?: string;
}

export interface ServerMetrics {
  cpuPercent: number;
  memoryPercent: number;
  diskPercent: number;
  loadAverage: string;
  uptime: string;
  processes: number;
  updatedAt: string;
}

export interface RemoteFile {
  name: string;
  path: string;
  kind: "file" | "directory" | "link";
  size: number;
  modifiedAt: string;
  permissions: string;
}

export interface ConnectionRuntime {
  profileId: string;
  status: ConnectionStatus;
  message: string;
}

export interface AppPreferences {
  theme: "dark" | "light" | "system";
  language: "zh-CN" | "en";
  terminalFontSize: number;
  confirmBeforeDisconnect: boolean;
}

export interface PersistedState {
  version: 1;
  profiles: ServerProfile[];
  preferences: AppPreferences;
}

export const DEFAULT_PREFERENCES: AppPreferences = {
  theme: "dark",
  language: "zh-CN",
  terminalFontSize: 13,
  confirmBeforeDisconnect: true,
};
