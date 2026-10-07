// Keep the operands' RTTI alongside open-abap-core's string-only exception
// fields. This hook changes no comparisons or exception text.
const installed = new WeakSet();

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
        const system = abap.builtin.sy.clone();
        const describe = async value => {
          try {
            // Generic ANY and field symbols retain the concrete operand type.
            while (value instanceof abap.types.FieldSymbol) value = value.getPointer();
            const type = (await abap.Classes.CL_ABAP_TYPEDESCR.describe_by_data({p_data: value})).get();
            const kind = type.type_kind.get();
            const scalar = ["F", "e"].includes(kind) ? value.getRaw()
              : kind === "P" && value.toFixed ? value.toFixed(type.decimals.get()) : value.get();
            return {typeKind: type.type_kind.get(), decimals: type.decimals.get(),
              ...(typeof scalar === "string" || typeof scalar === "number" || typeof scalar === "bigint"
                ? {value: String(scalar)} : {})};
          } catch {
            // Unavailable RTTI must never cause a numeric guess from text.
            return undefined;
          }
        };
        error.assertion = {method: "ASSERT_EQUALS", message: input?.msg?.get?.()?.trimEnd() ?? "",
          expected: await describe(input?.exp), actual: await describe(input?.act)};
        abap.builtin.sy.set(system);
      }
      throw error;
    }
  };
}
