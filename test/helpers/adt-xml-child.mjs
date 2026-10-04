// Read the real serving child's complete enqueue table for rejection digests.
process.on("message",async message => {
  if(message?.type !== "adt-xml-state") return;
  try {
    const {locks} = await import("../../tools/osd-enq.mjs");
    const {dialogStep} = await import("../../tools/osd-dialog-step.mjs");
    const state = await dialogStep(() => locks().read(),"XML acceptance snapshot");
    process.send({type:"adt-xml-state-answer",id:message.id,state});
  } catch(error) {process.send({type:"adt-xml-state-answer",id:message.id,error:String(error.message ?? error)});}
});
