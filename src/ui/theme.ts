import {
  Button,
  Text,
  buttonSetBordered,
  buttonSetContentTintColor,
  buttonSetTextColor,
  setCornerRadius,
  textSetColor,
  textSetFontFamily,
  textSetFontSize,
  textSetFontWeight,
  widgetSetBackgroundColor,
  widgetSetBorderColor,
  widgetSetBorderWidth,
  widgetSetControlSize,
  widgetSetEdgeInsets,
  widgetSetHeight,
  widgetSetHugging,
  widgetSetTooltip,
  widgetSetWidth,
  type Widget,
} from "perry/ui";

export type Color = readonly [number, number, number, number];

const DARK_COLORS = {
  app: [0.05, 0.07, 0.10, 1] as Color,
  sidebar: [0.07, 0.09, 0.13, 1] as Color,
  panel: [0.09, 0.11, 0.16, 1] as Color,
  raised: [0.04, 0.05, 0.08, 1] as Color,
  border: [0.16, 0.20, 0.28, 1] as Color,
  text: [0.94, 0.96, 0.98, 1] as Color,
  muted: [0.55, 0.62, 0.72, 1] as Color,
  navText: [0.78, 0.84, 0.92, 1] as Color,
  accent: [0.18, 0.58, 0.92, 1] as Color,
  accentStrong: [0.12, 0.48, 0.82, 1] as Color,
  buttonSecondary: [0.14, 0.18, 0.25, 1] as Color,
  buttonNav: [0.10, 0.13, 0.19, 1] as Color,
  buttonInk: [0.94, 0.96, 0.98, 1] as Color,
  green: [0.22, 0.82, 0.56, 1] as Color,
  yellow: [0.98, 0.72, 0.28, 1] as Color,
  red: [0.96, 0.35, 0.42, 1] as Color,
};

const LIGHT_COLORS: typeof DARK_COLORS = {
  app: [0.95, 0.96, 0.98, 1],
  sidebar: [0.91, 0.93, 0.96, 1],
  panel: [1.0, 1.0, 1.0, 1],
  raised: [0.05, 0.07, 0.10, 1],
  border: [0.84, 0.87, 0.92, 1],
  text: [0.10, 0.14, 0.20, 1],
  muted: [0.45, 0.52, 0.60, 1],
  navText: [0.18, 0.24, 0.32, 1],
  accent: [0.14, 0.52, 0.88, 1],
  accentStrong: [0.08, 0.42, 0.78, 1],
  buttonSecondary: [0.90, 0.93, 0.96, 1],
  buttonNav: [0.92, 0.94, 0.96, 1],
  buttonInk: [0.10, 0.14, 0.20, 1],
  green: [0.08, 0.58, 0.36, 1],
  yellow: [0.78, 0.46, 0.08, 1],
  red: [0.80, 0.18, 0.25, 1],
};

export const COLORS = { ...DARK_COLORS };

export function setTheme(theme: "dark" | "light" | "system"): void {
  // Perry does not currently expose the host appearance on every target.
  // Keep `system` backward-compatible with the original dark theme while
  // providing explicit, deterministic day/night modes.
  Object.assign(COLORS, theme === "light" ? LIGHT_COLORS : DARK_COLORS);
}

function applyBackground(widget: Widget, color: Color): void {
  widgetSetBackgroundColor(widget, color[0], color[1], color[2], color[3]);
}

export function fill(widget: Widget, color: Color): Widget {
  applyBackground(widget, color);
  // AppKit stack containers need a backing layer before their fill is visible.
  setCornerRadius(widget, 0);
  return widget;
}

export function surface(widget: Widget, color: Color = COLORS.panel, radius = 12): Widget {
  applyBackground(widget, color);
  setCornerRadius(widget, radius);
  widgetSetBorderColor(widget, ...COLORS.border);
  widgetSetBorderWidth(widget, 1);
  return widget;
}

export function inset(widget: Widget, top: number, left = top, bottom = top, right = left): Widget {
  widgetSetEdgeInsets(widget, top, left, bottom, right);
  return widget;
}

export function label(
  content: string,
  size = 13,
  color: Color = COLORS.text,
  weight = 0.45,
): Widget {
  const widget = Text(content);
  textSetFontSize(widget, size);
  const nativeWeight = weight <= 1 ? Math.round(weight * 1000) : Math.round(weight);
  textSetFontWeight(widget, size, nativeWeight);
  textSetColor(widget, color[0], color[1], color[2], color[3]);
  return widget;
}

export function mono(content: string, size = 13): Widget {
  const widget = label(content, size, COLORS.text, 0.45);
  textSetFontFamily(widget, "monospace");
  return widget;
}

export function terminalMono(content: string, size = 13): Widget {
  const widget = label(content, size, [0.92, 0.95, 0.98, 1] as Color, 0.45);
  textSetFontFamily(widget, "monospace");
  return widget;
}

export function actionButton(title: string, onPress: () => void, primary = false): Widget {
  // Keep interaction on Perry's dedicated native Button path. Generic
  // widget click handlers can abort when a callback replaces the view tree.
  const button = Button(title, onPress);
  buttonSetBordered(button, 0);
  applyBackground(button, primary ? COLORS.accent : COLORS.buttonSecondary);
  setCornerRadius(button, 8);
  widgetSetEdgeInsets(button, 8, 12, 8, 12);
  const minimumWidth = Math.max(76, Math.min(160, 30 + title.length * 14));
  widgetSetWidth(button, minimumWidth);
  widgetSetHeight(button, 34);
  widgetSetHugging(button, 750);
  widgetSetControlSize(button, 2);
  const ink = primary ? ([1, 1, 1, 1] as Color) : COLORS.buttonInk;
  buttonSetContentTintColor(button, ...ink);
  buttonSetTextColor(button, ...ink);
  widgetSetTooltip(button, title);
  return button;
}

export function navButton(title: string, onPress: () => void, active = false): Widget {
  const button = Button(title, onPress);
  buttonSetBordered(button, 0);
  applyBackground(button, active ? COLORS.accent : COLORS.buttonNav);
  setCornerRadius(button, 8);
  widgetSetEdgeInsets(button, 8, 12, 8, 12);
  widgetSetWidth(button, 165);
  widgetSetHeight(button, 36);
  widgetSetHugging(button, 750);
  widgetSetControlSize(button, 2);
  const ink = active ? ([1, 1, 1, 1] as Color) : COLORS.buttonInk;
  buttonSetContentTintColor(button, ...ink);
  buttonSetTextColor(button, ...ink);
  widgetSetTooltip(button, title);
  return button;
}

export function quickActionButton(category: string, title: string, subtitle: string, onPress: () => void): Widget {
  const button = Button(`${category}\n${title}\n${subtitle}`, onPress);
  buttonSetBordered(button, 0);
  applyBackground(button, COLORS.buttonSecondary);
  setCornerRadius(button, 12);
  widgetSetBorderColor(button, ...COLORS.border);
  widgetSetBorderWidth(button, 1);
  widgetSetEdgeInsets(button, 14, 16, 14, 16);
  widgetSetWidth(button, 245);
  widgetSetHeight(button, 110);
  widgetSetHugging(button, 750);
  widgetSetControlSize(button, 2);
  buttonSetContentTintColor(button, ...COLORS.buttonInk);
  buttonSetTextColor(button, ...COLORS.buttonInk);
  widgetSetTooltip(button, `${title} · ${subtitle}`);
  return button;
}

export function listActionButton(
  title: string,
  subtitle: string,
  onPress: () => void,
  selected = false,
  width = 248,
  height = 56,
): Widget {
  const button = Button(subtitle ? `${title}\n${subtitle}` : title, onPress);
  buttonSetBordered(button, 0);
  applyBackground(button, selected ? COLORS.accent : COLORS.buttonSecondary);
  setCornerRadius(button, 9);
  widgetSetBorderColor(button, ...COLORS.border);
  widgetSetBorderWidth(button, 1);
  widgetSetEdgeInsets(button, 7, 10, 7, 10);
  widgetSetWidth(button, width);
  widgetSetHeight(button, height);
  widgetSetHugging(button, 750);
  widgetSetControlSize(button, 2);
  const ink = selected ? ([1, 1, 1, 1] as Color) : COLORS.buttonInk;
  buttonSetContentTintColor(button, ...ink);
  buttonSetTextColor(button, ...ink);
  widgetSetTooltip(button, subtitle ? `${title} · ${subtitle}` : title);
  return button;
}

export function metricColor(percent: number): Color {
  if (percent >= 85) return COLORS.red;
  if (percent >= 65) return COLORS.yellow;
  return COLORS.green;
}
