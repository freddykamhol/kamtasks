export type GanttTaskColor = {
  uiBorder: string;
  uiFill: string;
  uiActive: string;
  exportBorder: string;
  exportFill: string;
};

export function getStableTaskColor(taskId: string): GanttTaskColor {
  let hash = 0;

  for (let index = 0; index < taskId.length; index += 1) {
    hash = (hash * 31 + taskId.charCodeAt(index)) >>> 0;
  }

  const hue = hash % 360;
  const saturation = 72 + (hash % 12);
  const lightness = 60 + ((hash >> 3) % 8);
  const borderLightness = Math.min(lightness + 12, 82);

  const border = `hsla(${hue}, ${saturation}%, ${borderLightness}%, 0.95)`;
  const fill = `hsla(${hue}, ${saturation}%, ${lightness}%, 0.22)`;
  const activeGlow = `hsla(${hue}, ${Math.min(saturation + 4, 92)}%, ${Math.min(lightness + 6, 78)}%, 0.24)`;
  const activeRing = `hsla(${hue}, ${Math.min(saturation + 2, 90)}%, ${Math.min(borderLightness, 84)}%, 0.18)`;

  return {
    uiBorder: border,
    uiFill: fill,
    uiActive: `0 0 0 1px ${activeRing}, 0 0 24px ${activeGlow}`,
    exportBorder: border,
    exportFill: fill,
  };
}
