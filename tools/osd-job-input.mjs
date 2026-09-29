// A job step's selection values cross an RFC boundary and two databases.
// Validate before accepting them and again when reading committed rows.
export function jobInput(input) {
  if (!Array.isArray(input) || input.length > 20) throw new TypeError("Job input must contain at most 20 fields");
  const seen = new Set();
  return input.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new TypeError("Invalid job input field");
    const keys = Object.keys(row);
    const normalized = keys.map((key) => key.toUpperCase()).sort().join(",");
    if (!["NAME,VALUE", "NAME,RANGES,VALUE"].includes(normalized) ||
        (normalized === "NAME,RANGES,VALUE" &&
          (!Array.isArray(row[keys.find((key) => key.toUpperCase() === "RANGES")]) ||
            row[keys.find((key) => key.toUpperCase() === "RANGES")].length !== 0))) {
      throw new TypeError("Invalid job input field");
    }
    const name = row[keys.find((key) => key.toUpperCase() === "NAME")];
    const value = row[keys.find((key) => key.toUpperCase() === "VALUE")];
    if (typeof name !== "string" || !/^[A-Z_][A-Z0-9_]{0,7}$/.test(name) ||
        typeof value !== "string" || value.length > 255) throw new TypeError("Invalid job input name or value (max 255 characters)");
    const upper = name.toUpperCase();
    if (seen.has(upper)) throw new TypeError(`Duplicate job input field ${upper}`);
    seen.add(upper);
    return {name: upper, value};
  });
}

// The raw bound must admit every input jobInput( ) accepts: 20 fields, each a
// name of at most 8 characters and a value of at most 255 characters that
// JSON may escape as \uXXXX (6 characters each), plus the object syntax.
// A tighter raw cap rejected valid input (20 values of control characters
// serialize to 31,131 characters); this one only stops abuse before parsing.
export const JOB_INPUT_JSON_MAX = 20 * (255 * 6 + 8 + 64) + 2;

export function jobInputJson(json) {
  if (json === "" || json === null || json === undefined) return [];
  if (typeof json !== "string" || json.length > JOB_INPUT_JSON_MAX) throw new TypeError("Job input payload too large");
  try { return jobInput(JSON.parse(json)); }
  catch (error) {
    if (error instanceof SyntaxError) throw new TypeError("Invalid job input JSON", {cause: error});
    throw error;
  }
}
