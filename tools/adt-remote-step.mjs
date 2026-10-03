// A recycle can close the child's IPC/socket before its exit event arrives.
// Wait for that process to exit before ensure() may spawn its replacement.
const departed = async (child) => {
  if (child && child.exitCode === null && child.signalCode === null) {
    await new Promise(resolve => child.once("exit", resolve));
  }
};
export async function remoteStep(runtime, input, door = "/osd/adt-step") {
  if (runtime.child?.connected === false) await departed(runtime.child);
  await runtime.ensure();
  const child = runtime.child;
  const ask = () => fetch(`${runtime.url}${door}`, {
    method: "POST", headers: {"content-type": "application/json", "x-osd-adt-step-key": runtime.adtStepKey}, body: JSON.stringify(input),
  });
  try { return await ask(); }
  catch (error) {
    // Refused connections have executed nothing. Safe reads may also retry
    // a disconnected socket; other writes keep an uncertain result visible.
    const safe = ["GET", "HEAD"].includes(input.view?.method);
    const refused = error.cause?.code === "ECONNREFUSED";
    if ((!safe && !refused) || child === undefined) throw error;
    if (child.connected && child.exitCode === null && child.signalCode === null) {
      // Socket failure can precede the process-channel notification too.
      await new Promise(resolve => {
        const done = () => { clearTimeout(timer); child.off("disconnect", done); child.off("exit", done); resolve(); };
        const timer = setTimeout(done, 1000);
        child.once("disconnect", done);
        child.once("exit", done);
      });
    }
    if (child.connected && child.exitCode === null && child.signalCode === null) throw error;
    await departed(child);
    await runtime.ensure();
    return ask();
  }
}

export async function stepJSON(response) {
  if (response.status === 413) throw Object.assign(new Error("ADT request body too large"), {status: 413});
  if (!/^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? "")) {
    throw new Error(`ADT step returned ${response.status} without JSON`);
  }
  return response.json();
}
