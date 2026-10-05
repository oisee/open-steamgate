// A check borrows the compiler's active view. It never promotes saved source.
import {captureView} from "./osd-store-compile-view.mjs";
import {warmOperation} from "./osd-store-warm.mjs";
import {resolve} from "node:path";

export async function warmCheck(store, object) {
  if (!["CLAS", "INTF", "PROG", "INCL"].includes(object.type)) return undefined;
  const warm = store.warm?.();
  if (!warm?.on || !warm.compiler?.primed || warm.disabled || warm.closed) return undefined;
  try {
    const saved = store.read(object.type, object.name, object.include ?? "main");
    const source = object.source ?? saved.source;
    const view = await captureView(store);
    // Ordinary Check reads saved dependencies. Borrowing an active registry
    // is equivalent only when every other source still has its active bytes.
    const target = resolve(store.root, saved.file);
    if (view.inactive.some(entry => entry.files.some(file => file.before !== file.after && resolve(store.root, file.file) !== target))) return undefined;
    const result = await warmOperation(store, () => warm.compiler.check({...object, source}, view));
    if (warm.compiler.recycleDue) warm.primeDue = true;
    return result;
  } catch (error) {
    if (!["NOT_WARM", "NOT_FOUND", "NOT_SUPPORTED", "CHANGED", "INPUT_CHANGED", "WARM_UNAVAILABLE", "CLOSED", "BUSY"].includes(error.code)) throw error;
    return undefined;
  }
}
