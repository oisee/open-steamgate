// Keep statements the report converter cannot classify inside the generated
// ABAP method. The frontend still parses and lowers their original ABAP.
import {join} from "node:path";

export async function convertNativeReport(options, gui) {
  const {convertProgram} = await import(join(gui, "converter", "src", "api.mjs"));
  const saved = [];
  let source = options.source.replace(/\bSELECT\s+[^.\n]*\bGROUP\s+BY\s+[^.\n]*\.\s*ENDSELECT\./gi, (statement) => {
    const marker = 700001 + saved.length;
    saved.push({marker, statement});
    return `IF 1 = ${marker}. ENDIF.`;
  });
  source = source.replace(/\b(?:COMMIT|ROLLBACK)\s+WORK\./gi, (statement) => {
    const marker = 700001 + saved.length;
    saved.push({marker, statement});
    return `IF 1 = ${marker}. ENDIF.`;
  });
  source = source.replace(/\b(?:OPEN|READ|CLOSE|GET)\s+DATASET\b[^.\n]*\.|\bTRANSFER\b[^.\n]*\bTO\b[^.\n]*\./gi, (statement) => {
    const marker = 700001 + saved.length;
    saved.push({marker, statement});
    return `IF 1 = ${marker}. ENDIF.`;
  });
  const converted = await convertProgram({...options, source});
  if (converted.supported !== true || !converted.classSource) return converted;
  let classSource = converted.classSource;
  const selections = [...options.source.matchAll(/^\s*(?:PARAMETERS|SELECT-OPTIONS)\s+(\w+)\b/gim)].map((m) => m[1]);
  for (const {marker, statement} of saved) {
    const placeholder = new RegExp(`IF 1 = ${marker}\\.\\s*ENDIF\\.`);
    if (!placeholder.test(classSource)) throw new Error(`report converter lost statement marker ${marker}`);
    let lowered = statement;
    for (const name of selections) lowered = lowered.replace(new RegExp(`\\b${name}\\b`, "gi"), `mv_${name.toLowerCase()}`);
    classSource = classSource.replace(placeholder, () => lowered);
  }
  return {...converted, classSource};
}
