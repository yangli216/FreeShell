import {
  App,
  Divider,
  HStack,
  Key,
  Modifier,
  ScrollView,
  SecureField,
  Spacer,
  TextField,
  VStack,
  Window,
  alert,
  alertWithButtons,
  appSetTimer,
  focus,
  onKeyDown,
  openFileDialog,
  saveFileDialog,
  scrollViewScrollTo,
  scrollviewSetChild,
  setCornerRadius,
  stackSetAlignment,
  stackSetDistribution,
  textSetSelectable,
  textSetString,
  textSetWraps,
  textfieldSetBackgroundColor,
  textfieldSetBorderless,
  textfieldSetFontSize,
  textfieldSetOnSubmit,
  textfieldSetString,
  textfieldSetTextColor,
  widgetAddChild,
  widgetClearChildren,
  widgetSetBackgroundColor,
  widgetSetBorderColor,
  widgetSetBorderWidth,
  widgetSetControlSize,
  widgetSetEdgeInsets,
  widgetSetHeight,
  widgetSetHugging,
  widgetSetOnClick,
  widgetSetTooltip,
  widgetSetWidth,
  type Widget,
} from "perry/ui";
import { keychainDelete, keychainGet, keychainSave } from "perry/system";
import type { ConnectionStatus, ServerProfile } from "../core/models.ts";
import { limitTerminalLines, sanitizeTerminalOutput } from "../core/terminal.ts";
import { createProfileId } from "../core/validation.ts";
import { ProfileStore } from "../services/profile-store.ts";
import { SshService, type HostKeyIdentity, type RunningSession } from "../services/ssh-service.ts";
import {
  COLORS,
  actionButton,
  fill,
  inset,
  label,
  listActionButton,
  metricColor,
  mono,
  navButton,
  quickActionButton,
  setTheme,
  surface,
  terminalMono,
} from "./theme.ts";

type ViewName = "dashboard" | "terminal" | "files" | "monitoring" | "settings";

interface FieldControl {
  root: Widget;
  input: Widget;
}

interface PendingHostKeyPrompt {
  attempt: number;
  profileId: string;
  keys: HostKeyIdentity[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function field(placeholder: string, onChange: (value: string) => void): FieldControl {
  const input = TextField(placeholder, onChange);
  textfieldSetBorderless(input, 1);
  textfieldSetFontSize(input, 13);
  widgetSetControlSize(input, 2);
  textfieldSetBackgroundColor(input, 0.94, 0.96, 0.98, 1);
  textfieldSetTextColor(input, ...COLORS.buttonInk);
  widgetSetHeight(input, 22);
  widgetSetHugging(input, 1);

  // AppKit's NSTextField cell does not vertically centre correctly when the
  // field itself is stretched. Keep it at its native height and centre that
  // control inside a padded frame instead.
  const frame = HStack(0, [input]);
  stackSetAlignment(frame, 12);
  widgetSetBackgroundColor(frame, 0.94, 0.96, 0.98, 1);
  widgetSetBorderColor(frame, ...COLORS.border);
  widgetSetBorderWidth(frame, 1);
  widgetSetEdgeInsets(frame, 7, 12, 7, 12);
  setCornerRadius(frame, 8);
  widgetSetHeight(frame, 38);
  widgetSetHugging(frame, 750);
  return { root: frame, input };
}

function secureField(placeholder: string, onChange: (value: string) => void): FieldControl {
  const input = SecureField(placeholder, onChange);
  widgetSetControlSize(input, 2);
  widgetSetHeight(input, 22);
  widgetSetHugging(input, 1);

  // SecureField is a separate Perry native control. Only use generic widget
  // APIs here so the password cannot accidentally become a plain TextField.
  const frame = HStack(0, [input]);
  stackSetAlignment(frame, 12);
  widgetSetBackgroundColor(frame, 0.94, 0.96, 0.98, 1);
  widgetSetBorderColor(frame, ...COLORS.border);
  widgetSetBorderWidth(frame, 1);
  widgetSetEdgeInsets(frame, 7, 12, 7, 12);
  setCornerRadius(frame, 8);
  widgetSetHeight(frame, 38);
  widgetSetHugging(frame, 750);
  return { root: frame, input };
}

function titleBlock(title: string, subtitle: string): Widget {
  return VStack(4, [label(title, 22, COLORS.text, 0.72), label(subtitle, 12, COLORS.muted)]);
}

function hInset(spacing: number, top: number, left: number, bottom: number, right: number, children: Widget[]): Widget {
  return inset(HStack(spacing, children), top, left, bottom, right);
}

function vInset(spacing: number, top: number, left: number, bottom: number, right: number, children: Widget[]): Widget {
  return inset(VStack(spacing, children), top, left, bottom, right);
}

function statusColor(status: ConnectionStatus) {
  if (status === "online") return COLORS.green;
  if (status === "connecting") return COLORS.yellow;
  if (status === "error") return COLORS.red;
  return COLORS.muted;
}

function passwordKey(profileId: string): string {
  return `freeshell.ssh.password.${profileId}`;
}

export class FreeShellApp {
  private readonly store = new ProfileStore();
  private readonly ssh = new SshService();
  private readonly passwords = new Map<string, string>();
  private selectedId = this.store.profiles[0]?.id ?? "";
  private serverFilter = "";
  private session?: RunningSession;
  private status: ConnectionStatus = "offline";
  private statusMessage = "未连接";
  private statusUiDirty = false;
  private serverListDirty = false;
  private pendingConnectedProfileId = "";
  private pendingView: ViewName | "" = "";
  private pendingTheme: "dark" | "light" | "" = "";
  private connectionError = "";
  private connectionAttempt = 0;
  private pendingHostKeyPrompt?: PendingHostKeyPrompt;
  private terminalBuffer = "FreeShell 0.1 · Perry Native\n选择服务器并点击连接以启动 SSH 会话。\n";
  private terminalDraft = "";
  private terminalUiDirty = false;
  private terminalOutput?: Widget;
  private terminalScroll?: Widget;
  private activeTerminalInput?: Widget;
  private readonly commandHistory: string[] = [];
  private commandHistoryIndex = 0;
  private readonly rootHost = HStack(0, []);
  private contentHost: Widget;
  private serverListHost: Widget;
  private statusText?: Widget;

  constructor() {
    setTheme(this.store.preferences.theme);
    this.contentHost = VStack(0, []);
    this.serverListHost = VStack(6, []);
  }

  run(): void {
    widgetSetHugging(this.rootHost, 1);
    stackSetAlignment(this.rootHost, 3);
    stackSetDistribution(this.rootHost, 0);
    this.rebuildShell("dashboard");
    // Perry process callbacks are not guaranteed to run on AppKit's main
    // thread. Flush background session state and deferred navigation here.
    appSetTimer(40, () => this.flushUiUpdates());

    App({
      title: "FreeShell — Remote Operations",
      width: 1380,
      height: 860,
      windowState: "normal",
      body: this.rootHost,
    });
  }

  private rebuildShell(view: ViewName): void {
    widgetClearChildren(this.rootHost);
    this.contentHost = VStack(0, []);
    this.serverListHost = VStack(6, []);
    this.statusText = undefined;
    widgetAddChild(this.rootHost, this.buildNavigation());
    widgetAddChild(this.rootHost, this.buildServerPane());
    widgetAddChild(this.rootHost, this.contentHost);
    fill(this.rootHost, COLORS.app);
    this.renderServerList();
    if (view === "terminal") this.renderTerminal();
    else if (view === "files") this.renderFiles();
    else if (view === "monitoring") this.renderMonitoring();
    else if (view === "settings") this.renderSettings();
    else this.renderDashboard();
  }

  private buildNavigation(): Widget {
    const brandMark = surface(label("FS", 16, COLORS.text, 0.8), COLORS.accentStrong, 10);
    inset(brandMark, 9, 11, 9, 11);
    const brand = HStack(10, [brandMark, VStack(1, [label("FreeShell", 16, COLORS.text, 0.75), label("REMOTE OPS", 9, COLORS.muted, 0.6)])]);

    const navigation = VStack(7, [
      brand,
      label("工作台", 10, COLORS.muted, 0.62),
      navButton("总览", () => this.scheduleView("dashboard"), true),
      navButton("服务器", () => this.scheduleView("dashboard")),
      navButton("终端", () => this.scheduleView("terminal")),
      navButton("文件传输", () => this.scheduleView("files")),
      navButton("性能监控", () => this.scheduleView("monitoring")),
      Spacer(),
      Divider(),
      navButton("偏好设置", () => this.scheduleView("settings")),
      label("Perry Native · v0.1.0", 10, COLORS.muted),
    ]);
    widgetSetWidth(navigation, 205);
    widgetSetHugging(navigation, 750);
    stackSetAlignment(navigation, 7);
    fill(navigation, COLORS.sidebar);
    widgetSetEdgeInsets(navigation, 20, 16, 16, 16);
    return navigation;
  }

  private buildServerPane(): Widget {
    const search = field("搜索服务器…", (value) => {
      this.serverFilter = value.trim().toLowerCase();
      this.renderServerList();
    });
    widgetSetWidth(search.root, 250);
    const add = actionButton("＋ 新建", () => this.openProfileEditor(), true);
    const header = HStack(8, [label("服务器", 15, COLORS.text, 0.7), Spacer(), add]);
    const pane = VStack(12, [header, search.root, this.serverListHost]);
    widgetSetWidth(pane, 280);
    widgetSetHugging(pane, 750);
    stackSetAlignment(pane, 7);
    fill(pane, COLORS.panel);
    widgetSetEdgeInsets(pane, 18, 14, 16, 14);
    widgetSetWidth(this.serverListHost, 250);
    widgetSetHugging(this.serverListHost, 1);
    stackSetAlignment(this.serverListHost, 7);
    stackSetDistribution(this.serverListHost, 0);
    return pane;
  }

  private renderServerList(): void {
    widgetClearChildren(this.serverListHost);
    const visibleProfiles = this.store.profiles.filter((profile) => {
      if (!this.serverFilter) return true;
      return [profile.name, profile.group, profile.host, profile.username, ...profile.tags]
        .some((value) => value.toLowerCase().includes(this.serverFilter));
    });
    if (visibleProfiles.length === 0) {
      widgetAddChild(this.serverListHost, inset(label("没有匹配的服务器", 11, COLORS.muted), 16, 8, 16, 8));
      return;
    }
    for (const profile of visibleProfiles) {
      const selected = profile.id === this.selectedId;
      const marker = selected && this.status === "online" ? "●" : "○";
      const row = listActionButton(
        `${marker}  ${profile.name}`,
        `${profile.username}@${profile.host}:${profile.port}`,
        () => {
          this.selectedId = profile.id;
          this.connectionError = "";
          this.serverListDirty = true;
          this.scheduleView("dashboard");
        },
        selected,
      );
      widgetSetTooltip(row, `${profile.group} · ${profile.tags.join(" · ")}`);
      widgetAddChild(this.serverListHost, row);
    }
    widgetAddChild(this.serverListHost, Spacer());
  }

  private selectedProfile(): ServerProfile | undefined {
    return this.store.find(this.selectedId);
  }

  private passwordFor(profile: ServerProfile): string | undefined {
    if (profile.authMode !== "password") return undefined;
    const cached = this.passwords.get(profile.id);
    if (cached) return cached;
    try {
      const stored = keychainGet(passwordKey(profile.id));
      if (stored) this.passwords.set(profile.id, stored);
      return stored || undefined;
    } catch {
      return undefined;
    }
  }

  private deleteStoredPassword(profileId: string): void {
    try {
      keychainDelete(passwordKey(profileId));
    } catch {
      // Deleting a missing or unavailable credential is intentionally safe.
    }
  }

  private scheduleView(view: ViewName): void {
    this.pendingView = view;
  }

  private flushUiUpdates(): void {
    if (this.pendingTheme) {
      const theme = this.pendingTheme;
      this.pendingTheme = "";
      this.pendingView = "";
      setTheme(theme);
      this.rebuildShell("settings");
      return;
    }
    if (this.statusUiDirty) {
      this.statusUiDirty = false;
      if (this.statusText) textSetString(this.statusText, this.statusMessage);
    }
    if (this.terminalUiDirty) {
      this.terminalUiDirty = false;
      if (this.terminalOutput) {
        const displayText = this.terminalDraft ? `${this.terminalBuffer}${this.terminalDraft}█` : `${this.terminalBuffer}█`;
        textSetString(this.terminalOutput, displayText);
        if (this.terminalScroll) scrollViewScrollTo(this.terminalScroll, 0, 1000000);
      }
    }
    if (this.pendingConnectedProfileId) {
      const profileId = this.pendingConnectedProfileId;
      this.pendingConnectedProfileId = "";
      this.store.markConnected(profileId);
    }
    if (this.serverListDirty) {
      this.serverListDirty = false;
      this.renderServerList();
    }

    const view = this.pendingView;
    this.pendingView = "";
    if (view === "dashboard") this.renderDashboard();
    else if (view === "terminal") {
      this.renderTerminal();
      if (this.activeTerminalInput) focus(this.activeTerminalInput);
    }
    else if (view === "files") this.renderFiles();
    else if (view === "monitoring") this.renderMonitoring();
    else if (view === "settings") this.renderSettings();

    const hostKeyPrompt = this.pendingHostKeyPrompt;
    this.pendingHostKeyPrompt = undefined;
    if (hostKeyPrompt) this.showHostKeyPrompt(hostKeyPrompt);
  }

  private setContent(widget: Widget): void {
    // Clear terminal references before destroying the previous native tree.
    // Background SSH callbacks only mark the buffer dirty and never touch a
    // native widget directly.
    this.terminalOutput = undefined;
    this.terminalScroll = undefined;
    this.activeTerminalInput = undefined;
    widgetClearChildren(this.contentHost);
    widgetAddChild(this.contentHost, widget);
    widgetSetHugging(this.contentHost, 1);
    stackSetAlignment(this.contentHost, 7);
    fill(this.contentHost, COLORS.app);
  }

  private buildTopBar(title: string, subtitle: string, actions: Widget[]): Widget {
    const stateDot = label("●", 11, statusColor(this.status));
    // Never re-parent a native text widget from a view that is about to be
    // destroyed. Perry/AppKit owns child widget lifetimes with their parent.
    const statusText = label(this.statusMessage, 12, COLORS.muted);
    this.statusText = statusText;
    const connection = HStack(6, [stateDot, statusText]);
    const bar = hInset(12, 18, 22, 14, 22, [titleBlock(title, subtitle), Spacer(), connection, ...actions]);
    widgetSetHeight(bar, 72);
    widgetSetHugging(bar, 750);
    stackSetAlignment(bar, 12);
    return bar;
  }

  private renderDashboard(): void {
    const profile = this.selectedProfile();
    if (!profile) {
      this.setContent(vInset(16, 40, 32, 40, 32, [titleBlock("欢迎使用 FreeShell", "创建第一台服务器以开始") , actionButton("新建服务器", () => this.openProfileEditor(), true)]));
      return;
    }

    const connect = actionButton(this.session ? "断开" : "连接", () => this.session ? this.disconnect() : this.connect(), true);
    const edit = actionButton("编辑", () => this.openProfileEditor(profile));
    const header = this.buildTopBar(profile.name, `${profile.group}  /  ${profile.username}@${profile.host}`, [edit, connect]);
    const quickTerminal = quickActionButton("REMOTE SHELL", "SSH 终端", "打开交互式远程 Shell", () => this.scheduleView("terminal"));
    const quickFiles = quickActionButton("FILE WORKSPACE", "SFTP 文件", "上传、下载与浏览目录", () => this.scheduleView("files"));
    const quickMonitor = quickActionButton("SYSTEM HEALTH", "性能监控", "CPU、内存、磁盘与负载", () => this.scheduleView("monitoring"));

    const info = surface(VStack(13, [
      label("连接信息", 14, COLORS.text, 0.68),
      this.infoRow("主机", profile.host),
      this.infoRow("端口", String(profile.port)),
      this.infoRow("用户", profile.username),
      this.infoRow(
        "认证",
        profile.authMode === "agent"
          ? "SSH Agent"
          : profile.authMode === "key"
            ? "私钥"
            : "密码（系统钥匙串）",
      ),
      this.infoRow("标签", profile.tags.join(" · ") || "—"),
    ]));
    inset(info, 18);
    widgetSetWidth(info, 310);
    widgetSetHeight(info, 210);
    widgetSetHugging(info, 750);

    const sessionDescription = label("连接凭据不会写入项目文件；默认使用系统 SSH Agent。", 11, COLORS.muted);
    textSetWraps(sessionDescription, 430);
    const connectionNotice = label(
      this.connectionError ? `连接失败：${this.connectionError}` : "主机状态将在连接后自动更新",
      11,
      this.connectionError ? COLORS.red : COLORS.accent,
    );
    textSetWraps(connectionNotice, 430);
    const recent = surface(VStack(12, [
      label("会话概览", 14, COLORS.text, 0.68),
      label(profile.lastConnectedAt ? `上次连接：${new Date(profile.lastConnectedAt).toLocaleString()}` : "尚未连接过此服务器", 12, COLORS.muted),
      sessionDescription,
      Spacer(),
      connectionNotice,
    ]));
    inset(recent, 18);
    widgetSetWidth(recent, 500);
    widgetSetHeight(recent, 210);
    widgetSetHugging(recent, 750);

    const body = VStack(18, [
      header,
      hInset(14, 6, 22, 0, 22, [quickTerminal, quickFiles, quickMonitor]),
      hInset(14, 0, 22, 20, 22, [info, recent]),
    ]);
    this.setContent(body);
  }

  private infoRow(key: string, value: string): Widget {
    const valueLabel = label(value, 12, COLORS.text);
    textSetSelectable(valueLabel, 1);
    return HStack(12, [label(key, 11, COLORS.muted), Spacer(), valueLabel]);
  }

  private connect(): void {
    const profile = this.selectedProfile();
    if (!profile) return;
    const password = this.passwordFor(profile);
    if (profile.authMode === "password" && !password) {
      const message = "无法从系统钥匙串读取密码，请编辑服务器并重新保存密码。";
      this.status = "error";
      this.statusMessage = message;
      this.connectionError = message;
      this.statusUiDirty = true;
      this.serverListDirty = true;
      this.scheduleView("dashboard");
      return;
    }
    const attempt = ++this.connectionAttempt;
    this.status = "connecting";
    this.statusMessage = "正在验证主机指纹…";
    this.connectionError = "";
    this.statusUiDirty = true;
    this.serverListDirty = true;
    this.terminalBuffer += `\n[FreeShell] 正在连接 ${profile.username}@${profile.host}:${profile.port}…\n`;
    this.scheduleView("dashboard");

    void this.ssh.inspectHostKey(profile).then((inspection) => {
      if (attempt !== this.connectionAttempt) return;
      if (inspection.status === "changed") {
        const fingerprints = inspection.keys.map((key) => `${key.algorithm} ${key.fingerprint}`).join("；");
        this.failConnection(attempt, `警告：服务器主机指纹与 known_hosts 记录不一致，已阻止连接。当前指纹：${fingerprints}`);
        return;
      }
      if (inspection.status === "unknown") {
        this.statusMessage = "等待确认服务器指纹…";
        this.statusUiDirty = true;
        this.pendingHostKeyPrompt = { attempt, profileId: profile.id, keys: inspection.keys };
        return;
      }
      this.continueConnection(profile, password, attempt);
    }).catch((error: unknown) => {
      this.failConnection(attempt, error instanceof Error ? error.message : String(error));
    });
  }

  private showHostKeyPrompt(prompt: PendingHostKeyPrompt): void {
    if (prompt.attempt !== this.connectionAttempt) return;
    const profile = this.store.find(prompt.profileId);
    if (!profile) return;
    const fingerprints = prompt.keys
      .map((key) => `${key.algorithm}  ${key.fingerprint}`)
      .join("\n");
    alertWithButtons(
      "首次连接：确认服务器指纹",
      `服务器：${profile.host}:${profile.port}\n\n${fingerprints}\n\n请通过可信渠道向服务器管理员核对以上指纹。确认后将写入系统 known_hosts；未来如指纹变化，FreeShell 会阻止连接。`,
      ["取消", "信任并连接"],
      (index) => {
        if (prompt.attempt !== this.connectionAttempt) return;
        if (index !== 1) {
          this.connectionAttempt += 1;
          this.status = "offline";
          this.statusMessage = "已取消连接";
          this.connectionError = "未信任服务器主机指纹。";
          this.statusUiDirty = true;
          this.serverListDirty = true;
          this.scheduleView("dashboard");
          return;
        }
        this.status = "connecting";
        this.statusMessage = "正在保存主机指纹…";
        this.statusUiDirty = true;
        void this.ssh.trustHostKey(profile, prompt.keys).then(() => {
          if (prompt.attempt !== this.connectionAttempt) return;
          this.continueConnection(profile, this.passwordFor(profile), prompt.attempt);
        }).catch((error: unknown) => {
          this.failConnection(prompt.attempt, error instanceof Error ? error.message : String(error));
        });
      },
    );
  }

  private continueConnection(profile: ServerProfile, password: string | undefined, attempt: number): void {
    if (attempt !== this.connectionAttempt) return;
    this.status = "connecting";
    this.statusMessage = "正在验证登录凭据…";
    this.statusUiDirty = true;
    // At this point the host key is already pinned. StrictHostKeyChecking=yes
    // prevents SSH_ASKPASS from ever receiving a trust/yes-no prompt.
    void this.ssh.checkConnection(profile, password).then(() => {
      if (attempt !== this.connectionAttempt) return;
      this.session = this.ssh.openTerminal(profile, {
        onOutput: (chunk) => {
          if (attempt !== this.connectionAttempt) return;
          this.terminalBuffer = limitTerminalLines(sanitizeTerminalOutput(this.terminalBuffer + chunk), 1200);
          this.terminalUiDirty = true;
        },
        onStatus: (status, message) => {
          if (attempt !== this.connectionAttempt) return;
          this.status = status;
          this.statusMessage = message;
          this.statusUiDirty = true;
          if (status === "offline" || status === "error") this.session = undefined;
          if (status === "error") {
            this.connectionError = message;
            this.terminalBuffer += `\n[FreeShell] ${message}\n`;
            this.scheduleView("dashboard");
          }
          this.serverListDirty = true;
        },
      }, password);
      this.status = "online";
      this.statusMessage = `已连接 ${profile.host}`;
      this.connectionError = "";
      this.pendingConnectedProfileId = profile.id;
      this.statusUiDirty = true;
      this.serverListDirty = true;
      this.scheduleView("terminal");
    }).catch((error: unknown) => {
      this.failConnection(attempt, error instanceof Error ? error.message : String(error));
    });
  }

  private failConnection(attempt: number, message: string): void {
    if (attempt !== this.connectionAttempt) return;
    this.session = undefined;
    this.status = "error";
    this.statusMessage = message;
    this.connectionError = message;
    this.terminalBuffer += `\n[FreeShell] 连接失败：${message}\n`;
    this.statusUiDirty = true;
    this.serverListDirty = true;
    this.scheduleView("dashboard");
  }

  private disconnect(): void {
    this.connectionAttempt += 1;
    this.session?.close();
    this.session = undefined;
    this.status = "offline";
    this.statusMessage = "未连接";
    this.connectionError = "";
    this.statusUiDirty = true;
    this.terminalBuffer += "\n[FreeShell] 已断开连接。\n";
    this.serverListDirty = true;
    this.scheduleView("dashboard");
  }

  private renderTerminal(): void {
    const profile = this.selectedProfile();
    if (!profile) return this.renderDashboard();
    const initialText = this.terminalDraft ? `${this.terminalBuffer}${this.terminalDraft}█` : `${this.terminalBuffer}█`;
    const output = terminalMono(initialText, 13);
    textSetSelectable(output, 1);
    textSetWraps(output, 810);
    widgetSetWidth(output, 810);

    const outputScroll = ScrollView();
    scrollviewSetChild(outputScroll, output);
    widgetSetHugging(outputScroll, 1);
    widgetSetEdgeInsets(outputScroll, 16, 18, 16, 18);
    widgetSetBackgroundColor(outputScroll, ...COLORS.raised);

    // Terminal interactive input field with proper dimensions for system focus
    const input = TextField("在此输入命令，按 Enter 发送…", (value) => {
      this.terminalDraft = value;
      this.terminalUiDirty = true;
    });
    textfieldSetBorderless(input, 1);
    textfieldSetFontSize(input, 13);
    textfieldSetBackgroundColor(input, ...COLORS.raised);
    textfieldSetTextColor(input, 0.92, 0.95, 0.98, 1);
    widgetSetControlSize(input, 2);
    widgetSetHeight(input, 28);
    widgetSetHugging(input, 1);

    const submitCommand = () => {
      if (!this.session) return;
      const submitted = this.terminalDraft;
      if (submitted.trim()) {
        if (this.commandHistory.at(-1) !== submitted) this.commandHistory.push(submitted);
        if (this.commandHistory.length > 100) this.commandHistory.shift();
      }
      this.commandHistoryIndex = this.commandHistory.length;
      if (submitted.trim() === "q" || submitted.trim() === "quit") {
        // Send raw 'q' and SIGINT for interactive commands like top/htop/less
        this.session.write("q\u0003\n");
      } else {
        this.session.write(`${submitted}\n`);
      }
      this.terminalDraft = "";
      textfieldSetString(input, "");
      this.terminalUiDirty = true;
      focus(input);
    };

    textfieldSetOnSubmit(input, submitCommand);

    const handleKey = (key: number, modifiers: number) => {
      if (key === Key.ArrowUp && this.commandHistory.length > 0) {
        this.commandHistoryIndex = Math.max(0, this.commandHistoryIndex - 1);
        this.terminalDraft = this.commandHistory[this.commandHistoryIndex] ?? "";
        textfieldSetString(input, this.terminalDraft);
        this.terminalUiDirty = true;
      } else if (key === Key.ArrowDown && this.commandHistory.length > 0) {
        this.commandHistoryIndex = Math.min(this.commandHistory.length, this.commandHistoryIndex + 1);
        this.terminalDraft = this.commandHistory[this.commandHistoryIndex] ?? "";
        textfieldSetString(input, this.terminalDraft);
        this.terminalUiDirty = true;
      } else if (key === Key.C && (modifiers & Modifier.Ctrl) !== 0) {
        if (this.session) {
          this.session.write("\u0003");
          this.terminalDraft = "";
          textfieldSetString(input, "");
          this.terminalUiDirty = true;
        }
      }
    };

    onKeyDown(input, handleKey);
    onKeyDown(output, handleKey);

    const focusInput = () => focus(input);
    widgetSetOnClick(outputScroll, focusInput);
    widgetSetOnClick(output, focusInput);

    const sendInterrupt = actionButton("中断 / 退出 (q)", () => {
      if (this.session) {
        this.session.write("q\u0003\n");
        this.terminalDraft = "";
        textfieldSetString(input, "");
        this.terminalUiDirty = true;
      }
    });

    const connect = actionButton(this.session ? "断开" : "连接", () => this.session ? this.disconnect() : this.connect(), true);
    const header = this.buildTopBar("SSH 终端", `${profile.name} · ${profile.host}`, [sendInterrupt, connect]);

    const inputRow = HStack(8, [label("❯", 15, COLORS.green, 0.72), input]);
    widgetSetHeight(inputRow, 40);
    widgetSetHugging(inputRow, 750);
    widgetSetEdgeInsets(inputRow, 4, 16, 8, 16);
    widgetSetBackgroundColor(inputRow, ...COLORS.raised);

    const consoleHost = VStack(0, [outputScroll, inputRow]);
    const console = surface(consoleHost, COLORS.raised, 10);
    widgetSetHugging(console, 1);
    widgetSetOnClick(console, focusInput);

    const body = VStack(10, [header, hInset(0, 0, 22, 18, 22, [console])]);
    this.setContent(body);
    this.terminalOutput = output;
    this.terminalScroll = outputScroll;
    this.activeTerminalInput = input;
    this.terminalUiDirty = true;
    focus(input);
  }

  private renderMonitoring(): void {
    const profile = this.selectedProfile();
    if (!profile) return this.renderDashboard();
    const metricsHost = hInset(12, 8, 22, 8, 22, [
      this.metricCard("CPU", 0, "等待刷新"),
      this.metricCard("内存", 0, "等待刷新"),
      this.metricCard("磁盘 /", 0, "等待刷新"),
    ]);
    const details = surface(VStack(12, [label("系统状态", 14, COLORS.text, 0.68), label("点击刷新以通过独立 SSH 请求采集 Linux 主机指标。", 12, COLORS.muted)]));
    inset(details, 18);

    const refresh = actionButton("刷新指标", async () => {
      widgetClearChildren(metricsHost);
      widgetAddChild(metricsHost, this.metricCard("采集中", 0, "正在读取远程状态…"));
      try {
        const metrics = await this.ssh.fetchMetrics(profile, this.passwordFor(profile));
        widgetClearChildren(metricsHost);
        widgetAddChild(metricsHost, this.metricCard("CPU", metrics.cpuPercent, `${metrics.cpuPercent.toFixed(1)}%`));
        widgetAddChild(metricsHost, this.metricCard("内存", metrics.memoryPercent, `${metrics.memoryPercent.toFixed(1)}%`));
        widgetAddChild(metricsHost, this.metricCard("磁盘 /", metrics.diskPercent, `${metrics.diskPercent.toFixed(1)}%`));
        widgetClearChildren(details);
        widgetAddChild(details, label("系统状态", 14, COLORS.text, 0.68));
        widgetAddChild(details, this.infoRow("负载均值", metrics.loadAverage));
        widgetAddChild(details, this.infoRow("运行时间", metrics.uptime));
        widgetAddChild(details, this.infoRow("进程数量", String(metrics.processes)));
        widgetAddChild(details, this.infoRow("更新时间", new Date(metrics.updatedAt).toLocaleTimeString()));
      } catch (error) {
        alert("采集失败", error instanceof Error ? error.message : String(error));
      }
    }, true);
    const header = this.buildTopBar("性能监控", `${profile.name} · 实时资源概览`, [refresh]);
    this.setContent(VStack(14, [header, metricsHost, hInset(12, 0, 22, 18, 22, [details])]));
  }

  private metricCard(name: string, percent: number, detail: string): Widget {
    const color = metricColor(percent);
    const card = surface(VStack(8, [label(name, 11, COLORS.muted, 0.58), label(detail, 24, color, 0.72), label("● 当前使用率", 10, color)]));
    widgetSetWidth(card, 230);
    widgetSetHeight(card, 105);
    inset(card, 15);
    return card;
  }

  private renderFiles(): void {
    const profile = this.selectedProfile();
    if (!profile) return this.renderDashboard();
    const defaultHome = profile.username === "root" ? "/root" : `/home/${profile.username}`;
    let remotePath = defaultHome;
    let selectedRemoteFile = "";
    const listHost = VStack(4, [label("点击“刷新目录”读取远程文件。", 12, COLORS.muted)]);
    widgetSetHugging(listHost, 1);
    const pathInput = field(remotePath, (value) => { remotePath = value; });
    textfieldSetString(pathInput.input, remotePath);

    const refreshDirectory = async () => {
      widgetClearChildren(listHost);
      widgetAddChild(listHost, label("正在读取…", 12, COLORS.muted));
      try {
        const files = await this.ssh.listDirectory(profile, remotePath, this.passwordFor(profile));
        widgetClearChildren(listHost);

        // Header Row
        const headerName = label("名称", 12, COLORS.muted);
        const headerSize = label("大小", 12, COLORS.muted);
        const headerTime = label("修改时间", 12, COLORS.muted);
        widgetSetWidth(headerSize, 100);
        widgetSetWidth(headerTime, 160);
        const headerRow = HStack(12, [headerName, Spacer(), headerSize, headerTime]);
        widgetSetEdgeInsets(headerRow, 4, 14, 6, 14);
        widgetAddChild(listHost, headerRow);

        let activeSelectedRow: Widget | undefined;

        for (const file of files) {
          const icon = file.kind === "directory" ? "📁" : file.kind === "link" ? "🔗" : "📄";
          const nameLabel = label(`${icon}  ${file.name}`, 13, file.kind === "directory" ? COLORS.text : COLORS.text);
          const sizeText = file.kind === "file" ? formatBytes(file.size) : "—";
          const sizeLabel = label(sizeText, 12, COLORS.muted);
          const timeLabel = label(file.modifiedAt || "—", 12, COLORS.muted);
          widgetSetWidth(sizeLabel, 100);
          widgetSetWidth(timeLabel, 160);

          const rowContent = HStack(12, [nameLabel, Spacer(), sizeLabel, timeLabel]);
          stackSetAlignment(rowContent, 3);

          const row = surface(rowContent, COLORS.buttonSecondary, 6);
          widgetSetHeight(row, 36);
          widgetSetHugging(row, 1);
          widgetSetEdgeInsets(row, 6, 14, 6, 14);

          widgetSetOnClick(row, () => {
            if (file.kind === "directory") {
              remotePath = file.path;
              selectedRemoteFile = "";
              textfieldSetString(pathInput.input, remotePath);
              void refreshDirectory();
            } else {
              selectedRemoteFile = file.path;
              if (activeSelectedRow) {
                widgetSetBackgroundColor(activeSelectedRow, ...COLORS.buttonSecondary);
              }
              activeSelectedRow = row;
              widgetSetBackgroundColor(row, ...COLORS.accent);
            }
          });

          widgetAddChild(listHost, row);
        }
      } catch (error) {
        widgetClearChildren(listHost);
        widgetAddChild(listHost, label(error instanceof Error ? error.message : String(error), 12, COLORS.red));
      }
    };

    const goHome = actionButton("家目录 (~)", () => {
      remotePath = defaultHome;
      textfieldSetString(pathInput.input, remotePath);
      void refreshDirectory();
    });
    const goRoot = actionButton("根目录 (/)", () => {
      remotePath = "/";
      textfieldSetString(pathInput.input, remotePath);
      void refreshDirectory();
    });
    const goUp = actionButton("上一级 (..)", () => {
      const parts = remotePath.split("/").filter(Boolean);
      if (parts.length > 0) parts.pop();
      remotePath = `/${parts.join("/")}`;
      textfieldSetString(pathInput.input, remotePath);
      void refreshDirectory();
    });

    const upload = actionButton("上传", () => openFileDialog((localPath: string) => {
      if (!localPath) return;
      void this.ssh.upload(profile, localPath, remotePath, this.passwordFor(profile)).then(() => refreshDirectory()).catch((error) => alert("上传失败", String(error)));
    }));
    const download = actionButton("下载所选", () => saveFileDialog((localPath: string) => {
      if (!localPath) return;
      if (!selectedRemoteFile) {
        alert("请选择文件", "请先在文件列表中点击一个远程文件，再选择本地保存位置。");
        return;
      }
      void this.ssh.download(profile, selectedRemoteFile, localPath, this.passwordFor(profile))
        .then(() => alert("下载完成", `已保存到 ${localPath}`))
        .catch((error) => alert("下载失败", String(error)));
    }, "download", "bin"));
    const refresh = actionButton("刷新目录", () => { void refreshDirectory(); }, true);
    const header = this.buildTopBar("文件传输", `${profile.name} · SCP/SFTP 工作区`, [upload, download, refresh]);
    const pathBar = hInset(8, 0, 22, 0, 22, [label("路径", 11, COLORS.muted), pathInput.root]);
    const scroll = ScrollView();
    scrollviewSetChild(scroll, listHost);
    widgetSetHugging(scroll, 1);
    const fileSurface = surface(VStack(8, [scroll]));
    widgetSetHugging(fileSurface, 1);
    inset(fileSurface, 14);
    this.setContent(VStack(12, [header, pathBar, hInset(0, 0, 22, 18, 22, [fileSurface])]));
  }

  private renderSettings(): void {
    const prefs = this.store.preferences;
    const switchTheme = actionButton(
      prefs.theme === "light" ? "切换到夜间模式" : "切换到白天模式",
      () => {
        const theme = prefs.theme === "light" ? "dark" : "light";
        this.store.updatePreferences({ theme });
        this.pendingTheme = theme;
      },
      true,
    );
    const card = surface(VStack(14, [
      label("外观与终端", 15, COLORS.text, 0.68),
      this.infoRow("主题", prefs.theme === "dark" ? "深色" : prefs.theme === "light" ? "浅色" : "跟随系统"),
      this.infoRow("语言", prefs.language === "zh-CN" ? "简体中文" : "English"),
      this.infoRow("终端字号", `${prefs.terminalFontSize} pt`),
      Divider(),
      label("FreeShell 使用原生控件，不嵌入 Chromium 或 Electron。", 11, COLORS.muted),
    ]));
    inset(card, 20);
    const header = this.buildTopBar("偏好设置", "跨平台行为与安全选项", [switchTheme]);
    this.setContent(VStack(16, [header, hInset(0, 0, 22, 20, 22, [card])]));
  }

  private openProfileEditor(existing?: ServerProfile): void {
    const draft: ServerProfile = existing ? { ...existing, tags: existing.tags.slice() } : {
      id: "",
      name: "",
      group: "默认",
      host: "",
      port: 22,
      username: "root",
      authMode: "agent",
      tags: [],
      favorite: false,
    };
    let passwordDraft = existing ? this.passwordFor(existing) ?? "" : "";
    const editor = Window(existing ? "编辑服务器" : "新建服务器", 520, 700);
    const name = field("服务器名称", (value) => { draft.name = value; });
    const host = field("主机名或 IP", (value) => { draft.host = value; });
    const port = field("SSH 端口（默认 22）", (value) => { draft.port = Number.parseInt(value, 10) || 0; });
    const user = field("用户名", (value) => { draft.username = value; });
    const group = field("分组", (value) => { draft.group = value; });
    const key = field("私钥路径（仅私钥模式）", (value) => {
      draft.privateKeyPath = value;
      if (value.trim()) {
        draft.authMode = "key";
        textSetString(authSelection, "当前：私钥认证");
      }
    });
    const password = secureField("SSH 密码（由系统安全控件保护）", (value) => {
      passwordDraft = value;
      if (value) {
        draft.authMode = "password";
        draft.rememberPassword = true;
        draft.privateKeyPath = undefined;
        textfieldSetString(key.input, "");
        textSetString(authSelection, "当前：密码认证");
      }
    });
    const authSelection = label(
      draft.authMode === "agent" ? "当前：SSH Agent" : draft.authMode === "key" ? "当前：私钥认证" : "当前：密码认证",
      11,
      COLORS.accent,
    );
    const chooseAgent = actionButton("SSH Agent", () => {
      draft.authMode = "agent";
      draft.privateKeyPath = undefined;
      textfieldSetString(key.input, "");
      textSetString(authSelection, "当前：SSH Agent");
    }, draft.authMode === "agent");
    const chooseKey = actionButton("私钥", () => {
      draft.authMode = "key";
      textSetString(authSelection, "当前：私钥认证");
      focus(key.input);
    }, draft.authMode === "key");
    const choosePassword = actionButton("密码", () => {
      draft.authMode = "password";
      draft.rememberPassword = true;
      draft.privateKeyPath = undefined;
      textfieldSetString(key.input, "");
      textSetString(authSelection, "当前：密码认证");
      focus(password.input);
    }, draft.authMode === "password");
    textfieldSetString(name.input, draft.name);
    textfieldSetString(host.input, draft.host);
    textfieldSetString(port.input, String(draft.port));
    textfieldSetString(user.input, draft.username);
    textfieldSetString(group.input, draft.group);
    textfieldSetString(key.input, draft.privateKeyPath ?? "");
    widgetSetWidth(host.root, 342);
    widgetSetWidth(port.root, 126);
    widgetSetWidth(password.root, 474);
    const save = actionButton("保存服务器", () => {
      try {
        if (draft.authMode === "password" && !passwordDraft) {
          throw new Error("请输入 SSH 密码。密码将永久保存到系统安全钥匙串。");
        }
        if (draft.authMode !== "key") draft.privateKeyPath = undefined;
        draft.rememberPassword = draft.authMode === "password";
        if (!draft.id) draft.id = createProfileId(draft.name, draft.host);
        this.store.saveProfile(draft);
        if (draft.authMode === "password") {
          this.passwords.set(draft.id, passwordDraft);
          keychainSave(passwordKey(draft.id), passwordDraft);
        } else {
          this.passwords.delete(draft.id);
          this.deleteStoredPassword(draft.id);
        }
        this.selectedId = draft.id;
        editor.close();
        this.serverListDirty = true;
        this.scheduleView("dashboard");
      } catch (error) {
        alert("无法保存", error instanceof Error ? error.message : String(error));
      }
    }, true);
    const body = vInset(8, 18, 22, 18, 22, [
      titleBlock(existing ? "编辑服务器" : "添加远程服务器", "支持 SSH Agent、私钥及系统钥匙串密码认证"),
      label("名称", 11, COLORS.muted), name.root,
      label("主机与端口", 11, COLORS.muted), HStack(8, [host.root, port.root]),
      label("用户名", 11, COLORS.muted), user.root,
      label("分组", 11, COLORS.muted), group.root,
      label("认证方式", 11, COLORS.muted), HStack(8, [chooseAgent, chooseKey, choosePassword]), authSelection,
      label("私钥（仅私钥模式）", 11, COLORS.muted), key.root,
      label("密码（永久保存到系统安全钥匙串）", 11, COLORS.muted), password.root,
      Spacer(),
      HStack(8, [Spacer(), actionButton("取消", () => editor.close()), save]),
    ]);
    fill(body, COLORS.app);
    editor.setBody(body);
    editor.show();
  }
}
