// Test transport only: mutations run in the real serving child's dialog step.
process.on("message", async message => {
  if(message?.type !== "a9-sql") return;
  try {
    const {dialogStep} = await import("../../tools/osd-dialog-step.mjs");
    await dialogStep(() => globalThis.abap.context.databaseConnections.DEFAULT.execute(message.sql), "A9 fixture");
    process.send({type:"a9-answer",id:message.id,value:{pid:process.pid}});
  } catch(error) {process.send({type:"a9-answer",id:message.id,error:String(error.message ?? error)});}
});
