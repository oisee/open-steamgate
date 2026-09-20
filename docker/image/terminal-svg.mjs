// Snapshot SAP-TUI's ANSI grid as SVG. The raw ANSI is also retained; this
// renderer handles the 256-colour SGR and line clears emitted by SAP-TUI.
const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const base = ["#000000", "#800000", "#008000", "#808000", "#000080", "#800080", "#008080", "#c0c0c0", "#808080", "#ff0000", "#00ff00", "#ffff00", "#0000ff", "#ff00ff", "#00ffff", "#ffffff"];
function colour(n) {
  if (n < 16) return base[n];
  if (n >= 232) { const c = 8 + (n - 232) * 10; return `rgb(${c},${c},${c})`; }
  n -= 16;
  const levels = [0, 95, 135, 175, 215, 255];
  return `rgb(${levels[Math.floor(n / 36)]},${levels[Math.floor(n / 6) % 6]},${levels[n % 6]})`;
}
export function terminalSvg(ansi) {
  let row = 0, col = 0, fg = "#d8dee9", bg = "#111827", bold = false, reverse = false;
  const cells = new Map();
  for (const token of ansi.matchAll(/\x1b\[([0-9;?]*)([A-Za-z])|([^\x1b]+)/g)) {
    if (token[3] !== undefined) {
      for (const ch of token[3]) {
        if (ch === "\n") { row++; col = 0; }
        else if (ch === "\r") col = 0;
        else if (ch >= " ") {
          cells.set(`${row}:${col}`, {row, col, ch, fg: reverse ? bg : fg, bg: reverse ? fg : bg, bold});
          col++;
        }
      }
      continue;
    }
    const nums = token[1].split(";").map(Number);
    if (token[2] === "H") { row = (nums[0] || 1) - 1; col = (nums[1] || 1) - 1; }
    if (token[2] === "J" && nums[0] === 2) cells.clear();
    if (token[2] === "K") {
      for (const [key, cell] of cells) {
        if (cell.row === row && (nums[0] === 2 || (nums[0] === 1 ? cell.col <= col : cell.col >= col))) cells.delete(key);
      }
    }
    if (token[2] !== "m") continue;
    for (let i = 0; i < nums.length; i++) {
      const n = nums[i];
      if (n === 0) { fg = "#d8dee9"; bg = "#111827"; bold = false; reverse = false; }
      if (n === 1) bold = true;
      if (n === 7) reverse = true;
      if (n === 22) bold = false;
      if (n === 27) reverse = false;
      if ((n === 38 || n === 48) && nums[i + 1] === 5) {
        const value = colour(nums[i + 2]);
        if (n === 38) fg = value; else bg = value;
        i += 2;
      }
    }
  }
  const grid = [...cells.values()];
  const width = (Math.max(0, ...grid.map(c => c.col)) + 1) * 9;
  const height = (Math.max(0, ...grid.map(c => c.row)) + 1) * 18;
  const parts = grid.map(c => `<rect x="${c.col * 9}" y="${c.row * 18}" width="9" height="18" fill="${c.bg}"/>`);
  for (const c of grid) {
    if (c.ch !== " ") parts.push(`<text x="${c.col * 9}" y="${c.row * 18 + 14}" fill="${c.fg}"${c.bold ? ' font-weight="bold"' : ""}>${escape(c.ch)}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#111827"/><g font-family="monospace" font-size="15">${parts.join("")}</g></svg>\n`;
}
