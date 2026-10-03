// ANOMALY-2026-10-03-rfc-message: the pinned transpiler drops MESSAGE targets.
// Apply to CALL FUNCTION only, using the parsed target and normal traversal.
const installed = Symbol.for('osd.rfcMessage.transpiler');
export function installRfcMessage(CallFunctionTranspiler, Chunk, core) {
  const proto = CallFunctionTranspiler.prototype;
  if (proto[installed]) return;
  const original = proto.transpile;
  proto.transpile = function(node, traversal) {
    const chunk = original.call(this, node, traversal);
    let code = chunk.getCode();
    for (const exception of node.findAllExpressions(core.Expressions.ParameterException)) {
      const name = exception.getFirstToken().getStr().toUpperCase();
      const target = exception.findExpressionAfterToken('MESSAGE');
      if (!target || !['SYSTEM_FAILURE','COMMUNICATION_FAILURE'].includes(name)) continue;
      const assignment = `${traversal.traverse(target).getCode()}.set(e.message ?? "");`;
      const anchor = `case "${name}": abap.builtin.sy.get().subrc.set(`;
      if (code.includes(anchor)) code = code.replace(anchor, `case "${name}": ${assignment} abap.builtin.sy.get().subrc.set(`);
    }
    return code === chunk.getCode() ? chunk : new Chunk().append(code, node, traversal);
  };
  proto[installed] = true;
}
