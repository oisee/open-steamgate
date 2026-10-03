// A job step's selection values cross an RFC boundary and two databases.
// Validate before accepting them and again when reading committed rows.
const MAX_FIELDS = 20;
const MAX_RANGES_PER_FIELD = 20;
const MAX_VALUE_LENGTH = 255;

export function jobInput(input) {
  if (!Array.isArray(input) || input.length > MAX_FIELDS) throw new TypeError("Job input must contain at most 20 fields");
  const seen = new Set();
  return input.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new TypeError("Invalid job input field");
    const keys = Object.keys(row);
    const normalized = keys.map((key) => key.toUpperCase()).sort().join(",");
    if (!["NAME,VALUE", "NAME,RANGES,VALUE"].includes(normalized)) {
      throw new TypeError("Invalid job input field");
    }
    const name = row[keys.find((key) => key.toUpperCase() === "NAME")];
    const value = row[keys.find((key) => key.toUpperCase() === "VALUE")];
    if (typeof name !== "string" || !/^[A-Z_][A-Z0-9_]{0,7}$/.test(name) ||
        typeof value !== "string" || value.length > MAX_VALUE_LENGTH) throw new TypeError("Invalid job input name or value (max 255 characters)");
    const upper = name.toUpperCase();
    if (seen.has(upper)) throw new TypeError(`Duplicate job input field ${upper}`);
    seen.add(upper);
    const rawRanges = row[keys.find((key) => key.toUpperCase() === "RANGES")];
    if (rawRanges === undefined) return {name: upper, value}; // pre-range steps
    if (!Array.isArray(rawRanges) || rawRanges.length > MAX_RANGES_PER_FIELD) throw new TypeError("Job input ranges must contain at most 20 rows");
    // an empty `WITH sel IN <empty table>` is one row of sign '#' and blanks (src/jobs/zcl_osd_submit_ranges.clas.abap,
    // for_submit; a string field holds its option without the trailing blanks): it keeps an empty IN distinct from a scalar
    // WITH = '', and the report's runner takes it out before the screen is built
    const sentinel = (range) => range && typeof range === "object" && !Array.isArray(range)
      && Object.keys(range).map((key) => key.toUpperCase()).sort().join(",") === "HIGH,LOW,OPTION,SIGN"
      && ["SIGN", "OPTION", "LOW", "HIGH"].every((key) => {
        const value = range[Object.keys(range).find((name) => name.toUpperCase() === key)];
        return key === "SIGN" ? value === "#" : typeof value === "string" && value.trim() === "";
      });
    if (rawRanges.length === 1 && sentinel(rawRanges[0])) return {name: upper, value, ranges: [{sign: "#", option: "  ", low: "", high: ""}]};
    const ranges = rawRanges.map((range) => {
      if (!range || typeof range !== "object" || Array.isArray(range) ||
          Object.keys(range).map((key) => key.toUpperCase()).sort().join(",") !== "HIGH,LOW,OPTION,SIGN") {
        throw new TypeError("Invalid job input range");
      }
      const field = (key) => range[Object.keys(range).find((name) => name.toUpperCase() === key)];
      const [sign, option, low, high] = [field("SIGN"), field("OPTION"), field("LOW"), field("HIGH")];
      if (!["I", "E"].includes(sign) || !["EQ", "NE", "GT", "GE", "LT", "LE", "BT", "NB", "CP", "NP"].includes(option) ||
          typeof low !== "string" || low.length > MAX_VALUE_LENGTH || typeof high !== "string" || high.length > MAX_VALUE_LENGTH) {
        throw new TypeError("Invalid job input range sign, option, low or high (max 255 characters)");
      }
      return {sign, option, low, high};
    });
    return {name: upper, value, ranges};
  });
}

// The raw cap admits every validated field and range even if each string
// character expands to a six-character JSON escape. It rejects abuse before
// parsing; field and range validation supplies the tighter structural bound.
const MAX_ESCAPED_VALUE = MAX_VALUE_LENGTH * 6;
// Include punctuation and key names with slack for either JSON key case.
export const JOB_INPUT_JSON_MAX = 2 + MAX_FIELDS *
  (MAX_ESCAPED_VALUE + 8 + 64 + MAX_RANGES_PER_FIELD * (2 * MAX_ESCAPED_VALUE + 128));

export function jobInputJson(json) {
  if (json === "" || json === null || json === undefined) return [];
  if (typeof json !== "string" || json.length > JOB_INPUT_JSON_MAX) throw new TypeError("Job input payload too large");
  try { return jobInput(JSON.parse(json)); }
  catch (error) {
    if (error instanceof SyntaxError) throw new TypeError("Invalid job input JSON", {cause: error});
    throw error;
  }
}
