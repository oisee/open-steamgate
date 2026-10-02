// The kernel slot survives generated class loads and warm swaps.
// Lifecycle callbacks never enter ABAP; resolve pulls context_alive.
import {adtEnqOwner} from "./adt-enq-key.mjs";

export function installEnqSession(abap, {bind, end, revive, contextAlive, Ended}) {
  const text = (v) => String(v?.get?.() ?? v ?? "").trimEnd();
  const str = (v) => new abap.types.String().set(v);
  const bool = (v) => new abap.types.Character(1).set(v ? "X" : "");
  const kernel = {
    async bind({iv_id, iv_user}) {
      try {
        bind(adtEnqOwner.key(text(iv_id)), {user: text(iv_user)});
        return bool(true);
      } catch (e) {
        if (!(e instanceof Ended)) throw e;
        return bool(false); // ABAP cleans the row and raises its named factory.
      }
    },
    async end({iv_id}) { end(adtEnqOwner.key(text(iv_id))); },
    async revive({iv_id}) { revive(adtEnqOwner.key(text(iv_id))); },
    async context_alive({iv_id}) { return bool(contextAlive(adtEnqOwner.key(text(iv_id)))); },
    async owns({iv_id}) { return bool(adtEnqOwner.owns(text(iv_id))); },
    async session_id({iv_id}) { return str(adtEnqOwner.idOf(text(iv_id))); },
  };
  Object.defineProperty(abap.Classes, "ZCL_OSD_ENQ_KERNEL", {
    get: () => kernel, set: () => {}, enumerable: true, configurable: true,
  });
}
