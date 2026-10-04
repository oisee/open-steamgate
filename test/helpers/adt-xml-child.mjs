// Read the real serving child's complete enqueue table for rejection digests.
process.on("message",async message => {
  if(message?.type !== "adt-xml-state") return;
  try {
    const {locks} = await import("../../tools/osd-enq.mjs");
    const {dialogStep} = await import("../../tools/osd-dialog-step.mjs");
    const state = await dialogStep(async () => {
      const xref = {}, db = globalThis.abap.context.databaseConnections.DEFAULT;
      for (const table of ["cross","wbcrossgt","wbcrossgtx","d010inc","zosd_adt_sess","zosd_adt_shdl"])
        xref[table] = (await db.select({select:`SELECT * FROM ${table}`})).rows;
      return {enq:locks().read(),contexts:[...locks().sessions],sequence:locks().seq,xref};
    },"XML acceptance snapshot");
    process.send({type:"adt-xml-state-answer",id:message.id,state});
  } catch(error) {process.send({type:"adt-xml-state-answer",id:message.id,error:String(error.message ?? error)});}
});
