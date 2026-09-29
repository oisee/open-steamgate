// The runtime's getTime statement is the ABAP clock. Patch that one instance,
// not Date: host deadlines, WAIT, process age and network timeouts stay real.
// open-abap-core CL_SYSTEM_UUID.random calls its class CRYPTO.randomUUID.
export async function withAbapCase(abap, uuidClass, spec, work) {
  const clock = spec.clock === undefined ? undefined : new Date(spec.clock);
  if (clock && (!Number.isFinite(clock.getTime()) || clock.toISOString() !== spec.clock)) {
    throw new Error("invalid @osd.clock: " + spec.clock);
  }
  const values = spec.uuid ?? [];
  if (!uuidClass && values.length) throw new Error("CL_SYSTEM_UUID is absent from generation");
  for (const value of values) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      throw new Error("invalid @osd.uuid: " + value);
    }
  }
  const originalTime = abap.statements.getTime;
  const originalCrypto = uuidClass?.CRYPTO;
  let used = 0;
  if (clock) {
    abap.statements.getTime = (options = {}) => {
      const sy = options.sy ?? abap.builtin.sy;
      const date = clock.toISOString().slice(0, 10).replaceAll("-", "");
      const time = clock.toISOString().slice(11, 19).replaceAll(":", "");
      sy.get().datum.set(date);
      sy.get().datlo.set(date);
      sy.get().uzeit.set(time);
      sy.get().timlo.set(time);
      options.field?.set(time);
      if (options.stamp) {
        options.stamp.set(date + time);
        if (options.stamp.getDecimals?.() === 7) {
          options.stamp.set(options.stamp.get() + Number.parseFloat("0." +
            String(clock.getUTCMilliseconds()).padStart(3, "0") + "0000"));
        }
      }
    };
    abap.statements.getTime({sy: abap.builtin.sy});
  }
  if (uuidClass) {
    uuidClass.CRYPTO = {randomUUID() {
      if (used >= values.length) throw new Error("@osd.uuid sequence exhausted");
      const value = values[used++];
      spec.onUuidUsed?.(used);
      return value;
    }};
  }
  try {
    const result = await work();
    if (used !== values.length) throw new Error("@osd.uuid sequence has " + (values.length - used) + " unused value(s)");
    return result;
  } finally {
    abap.statements.getTime = originalTime;
    if (uuidClass) uuidClass.CRYPTO = originalCrypto;
    originalTime({sy: abap.builtin.sy});
  }
}
