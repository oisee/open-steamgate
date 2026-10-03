// ANOMALY-2026-10-03-rfc-message: the pinned transpiler drops MESSAGE targets.
// Apply to CALL FUNCTION only, using the parsed target and normal traversal.
const installed = Symbol.for('osd.rfcMessage.transpiler');
let said = false;
export function installRfcMessage(CallFunctionTranspiler, Chunk, core) {
  // A host whose modules lack the transpiler class cannot be patched: say so, do not crash.
  const proto = CallFunctionTranspiler?.prototype;
  if (typeof proto?.transpile !== 'function' || !Chunk || !core?.Expressions) {
    if (!said) {
      said = true;
      console.warn('osd: RFC MESSAGE targets are not supplied on this host (its modules lack CallFunctionTranspiler);'
        + ' CALL FUNCTION ... MESSAGE lv_msg will not receive the failure text');
    }
    return false;
  }
  if (proto[installed]) return true;
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
  return true;
}
