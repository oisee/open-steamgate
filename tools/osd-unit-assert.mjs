// Keep scalar type provenance alongside open-abap-core's string-only exception
// fields. This hook changes no comparisons or exception text.
const installed = new WeakSet();
const scalarKinds = {Integer: "I", Integer8: "8", Packed: "P", Float: "F",
  DecFloat34: "e", Character: "C", String: "g", Numc: "N"};

function describeScalar(abap, value) {
  try {
    // Generic ANY retains its concrete runtime object. CASTING can allocate
    // temporary values in getPointer(), so leave it on the verbatim fallback.
    while (value instanceof abap.types.FieldSymbol) {
      if (value.casting) return undefined;
      value = value.getPointer();
    }
    const kind = Object.entries(scalarKinds).find(([name]) => value?.constructor === abap.types[name])?.[1];
    if (kind === undefined) return undefined;
    // These scalar readers only read storage; no ABAP objects, RTTI descriptors,
    // caches, anonymous type counters or system fields are created or changed.
    const decimals = kind === "P" ? value.getDecimals() : 0;
    const scalar = kind === "F" || kind === "e" ? value.getRaw()
      : kind === "P" ? value.toFixed(decimals) : value.get();
    return {typeKind: kind, decimals, value: String(scalar)};
  } catch {
    // Unavailable provenance must never cause a numeric guess from text.
    return undefined;
  }
}

export function installUnitAssert(abap) {
  const assertion = abap?.Classes?.CL_ABAP_UNIT_ASSERT;
  if (!assertion || installed.has(assertion)) return;
  installed.add(assertion);
  const original = assertion.assert_equals;
  assertion.assert_equals = async function (input) {
    try {
      return await original.call(this, input);
    } catch (error) {
      if (error?.constructor?.name === "kernel_cx_assert" && !error.assertion &&
          (error.expected?.get?.() !== "" || error.actual?.get?.() !== "")) {
        error.assertion = {method: "ASSERT_EQUALS", message: input?.msg?.get?.()?.trimEnd() ?? "",
          expected: describeScalar(abap, input?.exp), actual: describeScalar(abap, input?.act)};
      }
      throw error;
    }
  };
}
