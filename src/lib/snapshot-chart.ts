/** Capture the chart preview area to a data-URL PNG (downscaled). */
export async function snapshotChart(el: HTMLElement | null, maxW = 800): Promise<string | null> {
  if (!el) return null;
  // Find the canvas the lightweight-charts library renders into.
  const canvas = el.querySelector("canvas") as HTMLCanvasElement | null;
  if (!canvas) return null;
  try {
    const scale = Math.min(1, maxW / canvas.width);
    const w = Math.round(canvas.width * scale);
    const h = Math.round(canvas.height * scale);
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const ctx = out.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#0a0e17";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(canvas, 0, 0, w, h);
    return out.toDataURL("image/png", 0.85);
  } catch {
    return null;
  }
}
