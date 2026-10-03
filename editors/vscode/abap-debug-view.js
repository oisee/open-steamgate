"use strict";

// These helpers are serialized into both generators, never captured as closures.
function inspection() {
  const data = (object, key) => {
    if ((typeof object !== "object" && typeof object !== "function") || object === null) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  };
  const constructor = (value) => data(Object.getPrototypeOf(value), "constructor");
  const kind = (value) => {
    if (!value || typeof value !== "object") return undefined;
    const prototype = Object.getPrototypeOf(value);
    const ctor = data(prototype, "constructor");
    if (typeof ctor !== "function" || data(ctor, "prototype") !== prototype) return undefined;
    if (data(ctor, "INTERNAL_TYPE") === "CLAS") return typeof data(ctor, "INTERNAL_NAME") === "string" ? "class" : undefined;
    const name = data(ctor, "name");
    const field = name === "FieldSymbol" || name === "DataReference" ? "pointer" : "value";
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || !("value" in descriptor)) return undefined;
    // Reject accessor-backed and instance-method lookalikes. Classification never
    // calls a method, including on objects bearing a runtime constructor name.
    for (const key of ["get", "getPointer", "getQualifiedName", "getArrayLength", "constructor"]) {
      const own = Object.getOwnPropertyDescriptor(value, key);
      if (own && (!("value" in own) || key === "constructor")) return undefined;
      const method = Object.getOwnPropertyDescriptor(prototype, key);
      if (method && !("value" in method)) return undefined;
    }
    const raw = descriptor.value;
    if (["Character", "Hex", "Packed"].includes(name) && !Number.isInteger(data(value, "length"))) return undefined;
    if (["Character", "String", "Date", "Time", "Hex", "XString"].includes(name)) return typeof raw === "string" ? name : undefined;
    if (["Integer", "Float"].includes(name)) return typeof raw === "number" ? name : undefined;
    if (["Integer8", "Packed"].includes(name)) return typeof raw === "bigint" ? name : undefined;
    if (["Structure", "Table", "HashedTable", "ABAPObject", "FieldSymbol", "DataReference"].includes(name)) return name;
    return undefined;
  };
  const target = (reference) => {
    const pointer = data(reference, "pointer");
    if (pointer === undefined || kind(reference) !== "FieldSymbol" || data(reference, "casting") !== true) return pointer;
    const type = data(reference, "type");
    const declared = kind(type);
    const actual = kind(pointer);
    if (declared === "Date" && actual === "Date") return pointer;
    const raw = data(pointer, "value");
    let converted;
    if (declared === "Hex") {
      if (actual === "Float") {
        // Build IEEE-754 bits arithmetically: DataView.setFloat64 is rejected
        // by V8's throwOnSideEffect even when writing a fresh local buffer.
        const magnitude = Math.abs(raw);
        let exponent = 0;
        let fraction = 0n;
        if (!Number.isFinite(magnitude)) {
          exponent = 2047;
          fraction = Number.isNaN(magnitude) ? 1n << 51n : 0n;
        } else if (magnitude >= 2 ** -1022) {
          let power = Math.min(1023, Math.floor(Math.log2(magnitude)));
          if (magnitude < 2 ** power) power--;
          exponent = power + 1023;
          fraction = BigInt((magnitude / 2 ** power - 1) * 2 ** 52);
        } else if (magnitude !== 0) {
          fraction = BigInt(magnitude / 2 ** -1074);
        }
        let bits = (raw < 0 || Object.is(raw, -0) ? 1n << 63n : 0n) | BigInt(exponent) << 52n | fraction;
        converted = "";
        for (let i = 0; i < 8; i++) {
          converted += (bits & 255n).toString(16).padStart(2, "0");
          bits >>= 8n;
        }
        converted = converted.toUpperCase();
      } else if (typeof raw === "string") {
        converted = "";
        // CASTING is little-endian UTF-16 in this runtime. Limit conversion work
        // before formatting; preserve the declared type and the stored pointer.
        for (let i = 0; i < Math.min(raw.length, 65); i++) {
          const unit = raw.charCodeAt(i);
          converted += (unit & 255).toString(16).padStart(2, "0") + (unit >> 8).toString(16).padStart(2, "0");
        }
        converted = converted.toUpperCase();
      }
    } else if (["Character", "String"].includes(declared) && ["Hex", "XString"].includes(actual)) {
      converted = "";
      for (let i = 0; i + 3 < Math.min(raw.length, 1028); i += 4) {
        converted += String.fromCharCode(parseInt(raw.slice(i, i + 2), 16) + 256 * parseInt(raw.slice(i + 2, i + 4), 16));
      }
    }
    if (converted === undefined) return undefined;
    const view = Object.create(Object.getPrototypeOf(type), {
      value: {value: converted, enumerable: true},
      length: {value: data(type, "length"), enumerable: true},
    });
    return view;
  };
  return {data, kind, constructor, target};
}

function abapDebugDescription(defaultValue, helpers) {
  "use strict";
  try {
    const {data, kind, constructor, target: referenceTarget} = helpers;
    // Avoid RegExp operations: V8 rejects their shared match-state mutation in
    // js-debug's side-effect-free child previews.
    const preview = (value) => value.slice(0, 256) + (value.length > 256 ? "…" : "");
    const quote = (value) => "'" + value.split("'").join("''").split("\r").join("\\r").split("\n").join("\\n").split("\t").join("\\t") + "'";
    const trimChar = (value) => {
      let end = value.length;
      while (end > 0 && value[end - 1] === " ") end--;
      return value.slice(0, end);
    };
    const describe = (value, seen = []) => {
      const name = kind(value);
      const raw = data(value, "value");
      if (name === "FieldSymbol" || name === "DataReference") {
        if (seen.includes(value) || seen.length >= 8) return "-> … (reference cycle/limit)";
        const target = referenceTarget(value);
        if (target === undefined && data(value, "pointer") !== undefined) return "-> (CASTING preview unavailable)";
        if (target === undefined) return name === "FieldSymbol" ? "-> unassigned (field symbol)" : "-> initial (data reference)";
        const text = describe(target, [...seen, value]);
        return text === undefined ? "-> (" + (name === "FieldSymbol" ? "field symbol" : "data reference") + ")" : "-> " + text;
      }
      switch (name) {
        case "Character": return quote(raw.length > 256 ? preview(raw) : trimChar(raw)) + " (c" + data(value, "length") + ")";
        case "String": return quote(preview(raw)) + " (string)";
        case "Integer": return raw + " (i)";
        case "Integer8": return raw.toString() + " (int8)";
        case "Packed": {
          const decimals = data(value, "decimals");
          if (!Number.isInteger(decimals) || decimals < 0 || decimals > 100) return undefined;
          const negative = raw < 0n;
          const digits = (negative ? -raw : raw).toString().padStart(decimals + 1, "0");
          return (negative ? "-" : "") + (decimals ? digits.slice(0, -decimals) + "." + digits.slice(-decimals) : digits) + " (p" + data(value, "length") + "," + decimals + ")";
        }
        case "Float": {
          const parts = raw.toExponential(16).split("e");
          return parts[0] + "E" + parts[1][0] + parts[1].slice(1).padStart(2, "0") + " (f)";
        }
        case "Date": return raw.slice(0, 4) + "-" + raw.slice(4, 6) + "-" + raw.slice(6, 8) + " (d)";
        case "Time": return raw.slice(0, 2) + ":" + raw.slice(2, 4) + ":" + raw.slice(4, 6) + " (t)";
        case "XString": return preview(raw).toUpperCase() + " (xstring)";
        case "Hex": return preview(raw).toUpperCase() + " (x" + data(value, "length") + ")";
        case "Structure": return "{…} (structure)";
        case "Table": return "[" + data(raw, "length") + " rows] (" + (data(data(data(value, "options"), "primaryKey"), "type") === "SORTED" ? "sorted" : "standard") + " table)";
        case "HashedTable": return "[rows not enumerated] (hashed table)";
        case "ABAPObject": return raw === undefined ? "initial (object)" : (kind(raw) === "class" ? data(constructor(raw), "INTERNAL_NAME") : typeof data(value, "qualifiedName") === "string" ? data(value, "qualifiedName") : "object") + " (object)";
        case "class": return data(constructor(value), "INTERNAL_NAME") + " (object)";
        default: return undefined;
      }
    };
    const description = describe(this);
    return description === undefined ? defaultValue : description;
  } catch {
    return defaultValue;
  }
}

function abapDebugProperties(helpers) {
  "use strict";
  try {
    const {data, kind, target: referenceTarget} = helpers;
    const name = kind(this);
    if (name === undefined) return this;
    if (name === "Structure") return data(this, "value");
    if (name === "FieldSymbol" || name === "DataReference") {
      const target = referenceTarget(this);
      return target === undefined ? {} : {"->": target};
    }
    if (name === "Table" || name === "HashedTable") {
      const result = Object.create(null);
      const rows = data(this, "value");
      if (name === "HashedTable") {
        // The installed runtime stores rows in an object, with neither a maintained
        // count nor a bounded iterator. Even for-in can enumerate all keys in V8.
        result["…rows"] = "Row preview unavailable without bounded runtime iteration";
      } else {
        const length = data(rows, "length");
        const count = Math.min(length, 100);
        for (let index = 0; index < count; index++) result[index + 1] = data(rows, index);
        if (length > count) result["…more"] = (length - count) + " more rows (first 100 shown)";
      }
      if (data(this, "header") !== undefined) result.header = data(this, "header");
      return result;
    }
    if (name === "ABAPObject" || name === "class") {
      const object = name === "ABAPObject" ? data(this, "value") : this;
      const result = Object.create(null);
      const copy = (source) => {
        for (let cursor = source; cursor && cursor !== Object.prototype; cursor = Object.getPrototypeOf(cursor)) {
          for (const key of Object.keys(cursor)) {
            if (["me", "INTERNAL_ID", "FRIENDS_ACCESS_INSTANCE", "SUPER"].includes(key) || Object.prototype.hasOwnProperty.call(result, key)) continue;
            const value = data(cursor, key);
            if (kind(value)) result[key] = value;
          }
        }
      };
      copy(object);
      copy(data(object, "FRIENDS_ACCESS_INSTANCE"));
      return result;
    }
    return {};
  } catch {
    return this;
  }
}

const customDescriptionGenerator = `function (defaultValue) { "use strict"; return (${abapDebugDescription}).call(this, defaultValue, (${inspection})()); }`;
const customPropertiesGenerator = `function () { "use strict"; return (${abapDebugProperties}).call(this, (${inspection})()); }`;
module.exports = {customDescriptionGenerator, customPropertiesGenerator};
