import type { ServerProfile } from "./models.ts";

export interface SshInvocation {
  executable: string;
  args: string[];
}

function appendAuthenticationArgs(args: string[], profile: ServerProfile): void {
  if (profile.authMode === "key" && profile.privateKeyPath) {
    args.push("-i", profile.privateKeyPath, "-o", "IdentitiesOnly=yes");
  } else if (profile.authMode === "password") {
    args.push(
      "-o", "PreferredAuthentications=password,keyboard-interactive",
      "-o", "PubkeyAuthentication=no",
      "-o", "PasswordAuthentication=yes",
      "-o", "KbdInteractiveAuthentication=yes",
      "-o", "NumberOfPasswordPrompts=1",
    );
  }
}

export function buildSshArgs(profile: ServerProfile, interactive = true): string[] {
  const args = [
    interactive ? "-tt" : "-T",
    "-p",
    String(profile.port),
    "-o",
    "ConnectTimeout=12",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=3",
  ];

  // BatchMode disables every password prompt, including SSH_ASKPASS. Keep it
  // for agent/key preflight requests, but not for explicit password mode.
  if (!interactive && profile.authMode !== "password") args.push("-o", "BatchMode=yes");
  appendAuthenticationArgs(args, profile);

  args.push(`${profile.username}@${profile.host}`);
  return args;
}

export function buildSshInvocation(profile: ServerProfile, remoteCommand?: string): SshInvocation {
  const args = buildSshArgs(profile, remoteCommand === undefined);
  if (remoteCommand !== undefined) args.push(remoteCommand);
  return { executable: "ssh", args };
}

export function buildScpUploadArgs(profile: ServerProfile, localPath: string, remotePath: string): string[] {
  const args = ["-P", String(profile.port), "-o", "StrictHostKeyChecking=yes"];
  appendAuthenticationArgs(args, profile);
  args.push("--", localPath, `${profile.username}@${profile.host}:${remotePath}`);
  return args;
}

export function buildScpDownloadArgs(profile: ServerProfile, remotePath: string, localPath: string): string[] {
  const args = ["-P", String(profile.port), "-o", "StrictHostKeyChecking=yes"];
  appendAuthenticationArgs(args, profile);
  args.push("--", `${profile.username}@${profile.host}:${remotePath}`, localPath);
  return args;
}
