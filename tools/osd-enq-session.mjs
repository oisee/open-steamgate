// The ABAP session's kernel slot survives generated class loads/warm swaps.
// No host lifecycle callback enters ABAP: resolve pulls context_alive before
// binding. The issued-id ledger distinguishes gone raw ids from foreign ids;
// holder keys carry the instance prefix, including unknown/dead local ids.
import {adtEnqKey, adtEnqPrefix} from "./adt-enq-key.mjs";

export function installEnqSession(abap, {bind, end, contextAlive, Ended}) {
  const prefix = adtEnqPrefix();
  const issued = new Set();
  const text = (v) => String(v?.get?.() ?? v ?? "").trimEnd();
  const str = (v) => new abap.types.String().set(v);
  const bool = (v) => new abap.types.Character(1).set(v ? "X" : "");
  const idOf = (id) => id.startsWith(prefix) ? id.slice(prefix.length) : id;
  const key = (id) => adtEnqKey(prefix, idOf(id));
  const kernel = {
    async bind({iv_id, iv_user}) {
      try {
        bind(key(text(iv_id)), {user: text(iv_user)});
      } catch (e) {
        if (!(e instanceof Ended)) throw e;
        // A protocol exception, catchable by CATCH zcx_osd_adt in ABAP.
        const error = new abap.Classes.ZCX_OSD_ADT();
        await error.constructor_({iv_status: new abap.types.Integer().set(403),
          iv_type: str("ExceptionInvalidRequest"), iv_message: str("the ADT session has ended")});
        throw error;
      }
    },
    async end({iv_id}) { end(key(text(iv_id))); },
    async context_alive({iv_id}) { return bool(contextAlive(key(text(iv_id)))); },
    async owns({iv_id}) {
      const id = text(iv_id);
      return bool(id.startsWith(prefix) || issued.has(id));
    },
    async session_id({iv_id}) { return str(idOf(text(iv_id))); },
    async random({iv_kind}) {
      const kind = text(iv_kind);
      if (kind === "HANDLE") return str(globalThis.crypto.randomUUID());
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(kind === "ID" ? 12 : 18));
      if (kind === "ID") {
        const id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
        issued.add(id);
        return str(id);
      }
      // 18 bytes = 24 base64url characters, without padding.
      return str(btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_"));
    },
  };
  Object.defineProperty(abap.Classes, "KERNEL_ENQ_SESSION", {
    get: () => kernel, set: () => {}, enumerable: true, configurable: true,
  });
}
