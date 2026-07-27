/** Convert PTY output into readable plain text for Perry's native Text view.
 * Supports screen clear & cursor reset sequences for live commands like top, htop, and watch.
 */
export function sanitizeTerminalOutput(value: string): string {
  // Check if output contains a full-screen clear / home cursor sequence (e.g. top / htop refresh)
  // \x1B[2J = clear screen, \x1B[3J = clear scrollback, \x1B[H or \x1B[1;1H or \x1B[f = cursor home
  const clearRegex = /(?:\x1B\[2J|\x1B\[3J|\x1B\[H|\x1B\[1;1H|\x1B\[f)/g;

  // Split by screen clear markers; the last chunk represents the latest refreshed frame
  let text = value;
  const matches = [...text.matchAll(clearRegex)];
  if (matches.length > 0) {
    const lastMatch = matches.at(-1)!;
    const lastIndex = (lastMatch.index ?? 0) + lastMatch[0].length;
    text = text.slice(lastIndex);
  }

  return text
    // OSC: terminal title and other operating-system commands.
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    // CSI and short ANSI escape sequences used for color/cursor control.
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

