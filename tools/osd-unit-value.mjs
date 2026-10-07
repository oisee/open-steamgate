// SAP Unit comparison canon, measured per ABAP type. Unknown types keep
// the runtime's text; a leading minus in a string is never a numeric sign.
export function unitValueText(text, type) {
  if (typeof text !== "string") return text;
  const value = type?.value ?? text;
  switch (type?.typeKind) {
    case "I":
    case "8":
      return /^-\d+$/.test(value) ? `${value.slice(1)}-` : value;
    case "P": {
      if (!Number.isInteger(type.decimals) || type.decimals < 0 || !/^-?\d+(?:\.\d+)?$/.test(value)) return text;
      const negative = value.startsWith("-");
      const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
      // Use decimal text rather than Number so formatting cannot lose digits.
      if (fraction.length > type.decimals) return text;
      return ` ${whole}${type.decimals ? "." + fraction.padEnd(type.decimals, "0") : ""}${negative ? "-" : " "}`;
    }
    case "F": {
      const number = Number(value);
      if (!Number.isFinite(number)) return text;
      return number.toExponential(16).replace(/e([+-])(\d+)$/, (_, sign, exponent) => `E${sign}${exponent.padStart(2, "0")}`);
    }
    case "e":
      // The runtime's decimal float scalar already has its shortest form.
      return value;
    case "C":
      return text.replace(/ +$/, "");
    case "g":
    case "N":
      return text;
    default:
      return text;
  }
}
