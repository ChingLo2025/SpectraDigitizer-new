export function toCsv(points: Array<{ X: number; Y: number }>): string {
  const lines: string[] = ["X,Y"];
  for (const p of points) {
    const x = Number.isFinite(p.X) ? p.X : NaN;
    const y = Number.isFinite(p.Y) ? p.Y : NaN;
    // 你要更短/更長小數都可以改這行
    lines.push(`${x},${y}`);
  }
  return lines.join("\n");
}

export function downloadText(filename: string, content: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}
