/** Convert PTY output into readable plain text for Perry's native Text view. */
export function sanitizeTerminalOutput(value: string): string {
  return value
    // OSC: terminal title and other operating-system commands.
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    // CSI and short ANSI escape sequences used for colour/cursor control.
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1B[@-_]/g, "")
    .replace(/\r(?!\n)/g, "\n");
}

/** Truncate output buffer to prevent UI freeze and memory growth in long sessions. */
export function limitTerminalLines(buffer: string, maxLines = 1000): string {
  const lines = buffer.split("\n");
  if (lines.length <= maxLines) return buffer;
  return lines.slice(-maxLines).join("\n");
}

