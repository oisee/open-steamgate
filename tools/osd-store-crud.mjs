// CREATE/DELETE for ABAP STORE callers. Filesystem mutations share the
// ObjectStore source lock; repository ownership shares ADT's ENQ object.

const refuse = (code, message) => Object.assign(new Error(message), {code});
export async function storeCrud(store, command, {type, name, json, source, repositoryUser, repositoryGuard}) {
  let input;
  try { input = JSON.parse(json || '{}'); }
  catch { throw refuse('INVALID_NAME', `${command} needs an IV_JSON object`); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw refuse('INVALID_NAME', `${command} needs an IV_JSON object`);
  }
  const a = globalThis.abap;
  if (repositoryUser === undefined && (a?.__osdEnq !== true || !a.DDIC?.ZOSD_ADT_LOCK)) {
    throw refuse('NOT_SUPPORTED', `${command} needs the runtime repository lock context`);
  }
  const {repositoryCaller, repositorySessionGuard, withRepositoryLock} = await import('./osd-enq-host.mjs');
  const user = repositoryUser ?? repositoryCaller();
  const guard = repositoryGuard ?? (repositoryUser === undefined ? repositorySessionGuard() : undefined);
  if (!user) throw refuse('NOT_SUPPORTED', `${command} needs a caller identity`);
  if (source !== undefined && /@KERNEL/i.test(source)) {
    throw refuse('NOT_SUPPORTED', 'CREATE source containing @KERNEL is not supported');
  }
  const {withSourceMutation} = await import('./osd-store-source-lock.mjs');
  const mutation = () => {
    if (guard && !guard()) throw refuse('CONFLICT', 'repository caller context ended');
    if (command === 'CREATE') {
      if (input.package !== undefined && typeof input.package !== 'string'
        || input.description !== undefined && typeof input.description !== 'string') {
        throw refuse('INVALID_NAME', 'CREATE package and description must be strings');
      }
      return store.create(type, name, {package: input.package ?? '$TMP',
        description: input.description ?? '', source, author: user});
    }
    return store.delete(type, name);
  };
  const mutate = () => store.root === undefined ? mutation() : withSourceMutation(store, mutation);
  // The IPC caller already holds its own runtime's ENQ lock until this
  // parent mutation returns. This value is an internal binding, not IV_JSON.
  if (repositoryUser !== undefined) return mutate();
  return withRepositoryLock(type, name, mutate);
}
