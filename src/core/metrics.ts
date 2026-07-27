import type { ServerMetrics } from "./models.ts";

export const METRICS_COMMAND = [
  "cpu=$(LC_ALL=C top -bn1 2>/dev/null | awk '/Cpu\\(s\\)/ {print 100-$8; exit}')",
  "mem=$(LC_ALL=C free 2>/dev/null | awk '/Mem:/ {printf \"%.1f\", $3/$2*100}')",
  "disk=$(LC_ALL=C df -P / 2>/dev/null | awk 'NR==2 {gsub(/%/,\"\",$5); print $5}')",
  "load=$(LC_ALL=C uptime 2>/dev/null | sed 's/.*load average[s]*: //')",
  "up=$(LC_ALL=C uptime -p 2>/dev/null | sed 's/^up //')",
  "procs=$(ps -e 2>/dev/null | wc -l | tr -d ' ')",
  "printf 'cpu=%s\\nmem=%s\\ndisk=%s\\nload=%s\\nuptime=%s\\nprocesses=%s\\n' \"$cpu\" \"$mem\" \"$disk\" \"$load\" \"$up\" \"$procs\"",
].join("; ");

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function parseMetrics(output: string, now = new Date()): ServerMetrics {
  const values: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator > 0) values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }

  return {
    cpuPercent: clampPercent(Number.parseFloat(values.cpu ?? "0")),
    memoryPercent: clampPercent(Number.parseFloat(values.mem ?? "0")),
    diskPercent: clampPercent(Number.parseFloat(values.disk ?? "0")),
    loadAverage: values.load || "—",
    uptime: values.uptime || "—",
    processes: Math.max(0, Number.parseInt(values.processes ?? "0", 10) || 0),
    updatedAt: now.toISOString(),
  };
}
