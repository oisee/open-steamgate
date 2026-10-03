// Test-only transport to the serving child's real SYSTEM DUMP answer.
// No dump formatting or persistence is implemented here.
import {box} from "./destination.mjs";

process.on("message", async message => {
  if (message?.type !== "c5-dump") return;
  try {
    const sig = {exporting: {iv_command: box("SYSTEM"), iv_type: box("DUMP"), iv_json: box(message.json)},
      importing: {ev_json: box(""), ev_error: box("")}};
    await globalThis.abap.context.RFCDestinations.STORE.localSystem.call("ZOSD_STORE", sig);
    if (sig.importing.ev_error.get()) throw new Error(sig.importing.ev_error.get());
    process.send({type: "c5-dump-answer", id: message.id, value: JSON.parse(sig.importing.ev_json.get())});
  } catch (error) {
    process.send({type: "c5-dump-answer", id: message.id, error: String(error.message ?? error)});
  }
});
