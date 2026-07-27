# FreeShell

FreeShell 是一款以 Perry 编译为原生可执行文件的跨平台远程服务器运维客户端。当前版本提供现代化三栏工作台、服务器配置、SSH 交互会话、Linux 性能指标采集、远程目录浏览与 SCP 上传/下载服务。

## 技术特点

- Perry `perry/ui` 原生控件：macOS 使用 AppKit，Linux 使用 GTK4，Windows 使用 Win32。
- 无 Electron、Chromium 或 WebView 应用外壳。
- 使用系统 OpenSSH，支持 SSH Agent 和私钥认证；FreeShell 不保存明文密码。
- 配置保存在 `~/.freeshell/state.json`，文件权限为 `0600`。
- SSH/SCP 参数通过参数数组传递，不拼接本地 Shell 命令。

## 开发

要求 Node.js 16+、系统 C/Clang 工具链和 OpenSSH 客户端。

```bash
npm install
npm run check
npm test
npm run build
./dist/freeshell
```

`npm run check` 使用 Perry 检查 TypeScript 兼容性；`npm run build` 生成当前平台的原生二进制。

## 当前能力

- 服务器档案：名称、分组、主机、端口、用户、标签、SSH Agent/私钥认证。
- SSH 终端：连接状态、交互命令输入、输出缓冲与安全断开。
- 文件工作区：远程目录浏览、文件大小与时间展示、文件选择、SCP 上传与下载。
- 监控：CPU、内存、根分区、负载、运行时间与进程数。
- UI：深色原生界面、三栏导航、概览卡片、独立服务器编辑窗口、中英文资源。

## 安全边界

首次连接的主机密钥确认和 SSH Agent/密钥权限由系统 OpenSSH 处理。示例服务器仅用于展示，不会自动发起网络连接。生产环境建议继续增加主机指纹管理、系统钥匙串集成、审计日志脱敏及代理跳板配置。
