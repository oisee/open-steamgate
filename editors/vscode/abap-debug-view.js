"use strict";

// Serialized into js-debug's function sources: keep this function self-contained.
// No imports, debuggee globals, mutations, or runtime instanceof dependencies.
function abapDebugDescription(defaultValue) {
  "use strict";
  try {
    // RegExp operations update V8's shared match state and are rejected by
    // js-debug's side-effect-free child previews. Use string operations only.
    const quote = (value) => "'" + value.split("'").join("''").split("\r").join("\\r").split("\n").join("\\n").split("\t").join("\\t") + "'";
    const trimChar = (value) => {
      let end = value.length;
      while (end > 0 && value[end - 1] === " ") end--;
      return value.slice(0, end);
    };
    const kind = (value) => value && typeof value.getQualifiedName === "function" &&
      (typeof value.get === "function" || typeof value.getPointer === "function" || typeof value.getArrayLength === "function") ? value.constructor?.name :
      value && value.constructor?.name === "DataReference" && typeof value.getPointer === "function" ? "DataReference" : undefined;
    const describe = (value, seen = []) => {
      const name = kind(value);
      if (name === "FieldSymbol" || name === "DataReference") {
        if (seen.includes(value) || seen.length >= 8) return "-> … (reference cycle/limit)";
        const target = value.getPointer();
        if (target === undefined) return name === "FieldSymbol" ? "-> unassigned (field symbol)" : "-> initial (data reference)";
        const text = describe(target, [...seen, value]);
        return text === undefined ? "-> (" + (name === "FieldSymbol" ? "field symbol" : "data reference") + ")" : "-> " + text;
      }
      switch (name) {
        case "Character": return quote(trimChar(value.get())) + " (c" + value.getLength() + ")";
        case "String": return quote(value.get()) + " (string)";
        case "Integer": return value.get() + " (i)";
        case "Integer8": return value.get().toString() + " (int8)";
        case "Packed": return value.toFixed(value.getDecimals()) + " (p" + value.getLength() + "," + value.getDecimals() + ")";
        case "Float": return value.get() + " (f)";
        case "Date": return value.get().slice(0, 4) + "-" + value.get().slice(4, 6) + "-" + value.get().slice(6, 8) + " (d)";
        case "Time": return value.get().slice(0, 2) + ":" + value.get().slice(2, 4) + ":" + value.get().slice(4, 6) + " (t)";
        case "XString": return value.get().toUpperCase() + " (xstring)";
        case "Hex": return value.get().toUpperCase() + " (x" + value.getLength() + ")";
        case "Structure": return "{…} (structure)";
        case "Table":
        case "HashedTable": {
          const type = name === "HashedTable" ? "hashed" : value.getOptions()?.primaryKey?.type === "SORTED" ? "sorted" : "standard";
          return "[" + value.getArrayLength() + " rows] (" + type + " table)";
        }
        case "ABAPObject": {
          const object = value.get();
          return object === undefined ? "initial (object)" : (object.constructor?.INTERNAL_NAME || value.getQualifiedName() || object.constructor?.name || "object") + " (object)";
        }
        default:
          if (value?.constructor?.INTERNAL_TYPE === "CLAS") return value.constructor.INTERNAL_NAME + " (object)";
          return undefined;
      }
    };
    const description = describe(this);
    return description === undefined ? defaultValue : description;
  } catch {
    return defaultValue;
  }
}

// descriptionSource is inserted at build time, not a closure in the debuggee.
function propertiesBody(descriptionSource) {
  return `function () {
  "use strict";
  try {
    const kind = (value) => value && typeof value.getQualifiedName === "function" &&
      (typeof value.get === "function" || typeof value.getPointer === "function" || typeof value.getArrayLength === "function") ? value.constructor?.name :
      value && value.constructor?.name === "DataReference" && typeof value.getPointer === "function" ? "DataReference" : undefined;
    if ((${descriptionSource}).call(this, undefined) === undefined) return this;
    const name = kind(this);
    if (name === "Structure") return this.get();
    if (name === "FieldSymbol" || name === "DataReference") {
      const target = this.getPointer();
      return target === undefined ? {} : {"->": target};
    }
    if (name === "Table" || name === "HashedTable") {
      const result = Object.create(null);
      // HashedTable.array() copies every row. Read its backing store lazily instead.
      const rows = this.value;
      let count = 0;
      for (const key in rows) {
        if (!Object.prototype.hasOwnProperty.call(rows, key)) continue;
        result[++count] = rows[key];
        if (count === 100) break;
      }
      const remaining = this.getArrayLength() - count;
      if (remaining > 0) result["…more"] = remaining + " more rows (first 100 shown)";
      if (this.header !== undefined) result["header"] = this.header;
      return result;
    }
    if (name === "ABAPObject" || this?.constructor?.INTERNAL_TYPE === "CLAS") {
      const object = name === "ABAPObject" ? this.get() : this;
      const result = Object.create(null);
      if (!object) return result;
      // FRIENDS_ACCESS_INSTANCE exposes private ABAP attributes, including inherited
      // ones. Copy data descriptors only; never invoke application getters/methods.
      const copy = (source) => {
        for (let cursor = source; cursor && cursor !== Object.prototype; cursor = Object.getPrototypeOf(cursor)) {
          for (const key of Object.keys(cursor)) {
            if (["me", "INTERNAL_ID", "FRIENDS_ACCESS_INSTANCE", "SUPER"].includes(key) || Object.prototype.hasOwnProperty.call(result, key)) continue;
            const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
            if (descriptor && "value" in descriptor && kind(descriptor.value)) result[key] = descriptor.value;
          }
        }
      };
      copy(object);
      copy(object.FRIENDS_ACCESS_INSTANCE);
      return result;
    }
    return {}; // Scalars expand without runtime implementation fields.
  } catch {
    return this;
  }
}
`;
}

const customDescriptionGenerator = abapDebugDescription.toString();
const customPropertiesGenerator = propertiesBody(customDescriptionGenerator);
module.exports = {customDescriptionGenerator, customPropertiesGenerator};
