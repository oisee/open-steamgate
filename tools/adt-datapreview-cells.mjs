// The JS value model is shared by the Node oracle and child SYSTEM SQL.
export const renderCell = (v) => v === null || v === undefined ? "" : typeof v === "object" ? Buffer.from(v).toString("hex").toUpperCase() : String(v);
export function cellType(rows, name) {
  const first = rows.find((r) => r[name] !== null && r[name] !== undefined)?.[name];
  return typeof first === "number" ? "I" : typeof first === "object" && first !== null ? "X" : "C";
}
export function previewCells(answer) {
  return {sql: answer.sql, count: answer.rows.length, columns: answer.columns.map((name) => ({name, upper: name.toUpperCase(), letter: cellType(answer.rows, name), cells: answer.rows.map((r) => renderCell(r[name]))}))};
}
