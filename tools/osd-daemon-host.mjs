// Clean-room subset of the measured daemon contract used by the L3 watcher.
// One mailbox per instance; callbacks are separate, committing dialog steps.
import {dialogStep, outsideStepContext} from './osd-dialog-step.mjs';
import {daemonContext as active, inDaemon} from './osd-daemon-context.mjs';
export {inDaemon};
const hosts = new WeakMap();
const wall = {now: () => Date.now(), setTimer: (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; }, clearTimer: clearTimeout};
const value = (x) => x?.get?.() ?? x;
const string = (abap, x) => new abap.types.String().set(x);
const ref = (abap, x) => new abap.types.ABAPObject().set(x);
function program() {
  for (const line of new Error().stack.split('\n')) {
    const m = /([a-z][a-z0-9_]+)\.clas\.mjs/i.exec(line);
    if (m && !/^cl_abap_daemon|^cl_abap_timer/.test(m[1])) return m[1].toUpperCase();
  }
  return 'HOST';
}
export function daemonHost(abap) { return hosts.get(abap); }
export function installDaemons(abap) {
  const Manager = abap.Classes.CL_ABAP_DAEMON_CLIENT_MANAGER;
  if (!Manager) return;
  if (hosts.has(abap)) return hosts.get(abap);
  for (const method of ["submit", "submit_via_job"]) {
    const cls = abap.Classes.ZCL_OSD_BATCH_REPORT;
    if (!cls?.[method] || cls[method].osdDaemonGuard) continue;
    const original = cls[method];
    const guarded = async function (...args) {
      if (inDaemon()) throw new Error("DAEMON_ILLEGAL_STATEMENT: SUBMIT");
      return original.apply(this, args);
    };
    guarded.osdDaemonGuard = true;cls[method] = guarded;
  }
  const instances = new Map();
  let clock = wall;
  const host = {instances, errors: [], setClock(c) { const prev = clock; clock = c; return () => { clock = prev; }; },
    async idle() { for (;;) { const tasks = [...instances.values()].map((r) => r.queue); await Promise.all(tasks); if ([...instances.values()].every((r) => tasks.includes(r.queue))) break; } },
    async close() { for (const row of instances.values()) stop(row); await host.idle(); }};
  hosts.set(abap, host);
  const exception = async () => { throw await new abap.Classes.CX_ABAP_DAEMON_ERROR().constructor_(); };
  function info(row) {
    const template = Manager.METHODS.GET_DAEMON_INFO.parameters.R_INFO_TABLE.type();
    const result = template.getRowType().clone();
    const f = result.get();
    f.name.set(row.name); f.instance_id.set(row.id); f.creator_client.set(row.client); f.creator_user.set(row.user);
    f.used_dest.set(row.destination); f.application_server.set(row.server);
    f.creation_time.set(new Date(row.started).toISOString().replace(/[^0-9]/g, '').slice(0,14));
    return result;
  }
  function clearTimers(row) { for (const handle of row.timers.values()) clock.clearTimer(handle); row.timers.clear(); }
  function enqueue(row, callback, args = {}) {
    if (callback !== 'on_stop') row.pending++;
    row.queue = row.queue.then(() => outsideStepContext(() => dialogStep(() => active.run(row, async () => {
      if (!instances.has(row.id)) return;
      if (callback === 'on_stop' && row.pending > 0) {enqueue(row, 'on_stop', args);return;}
      if (callback !== 'on_stop') row.pending--;
      const sy = abap.builtin.sy.get(), priorUser = sy.uname.clone(), priorClient = sy.mandt.clone();
      sy.uname.set(row.user);sy.mandt.set(row.client);
      try {await row.object[`if_abap_daemon_extension$${callback}`]({i_context: ref(abap, row.context), ...args});} finally {sy.uname.set(priorUser);sy.mandt.set(priorClient);}
      if (callback === 'on_stop') { clearTimers(row); instances.delete(row.id); }
    })))).catch(async (error) => {
      host.errors.push(error);
      clearTimers(row);
      row.object = await new abap.Classes[row.className]().constructor_();
      if (callback !== 'on_error') enqueue(row, 'on_error', {i_code: new abap.types.Integer().set(103), i_reason: string(abap, error.message ?? 'dump')});
    });
    return row.queue;
  }
  function stop(row, message) { if (!row.stopping) { row.stopping = true; enqueue(row, 'on_stop', {i_message: message}); } }
  Manager.start = async (input) => {
    const className = String(value(input.i_class_name) ?? '').trim().toUpperCase();
    const daemonId = String(value(input.i_daemon_id) ?? '').trim().toUpperCase();
    // No daemon-ID-to-class registry exists in OSG yet; never guess a class.
    if (!className) return exception();
    input.e_instance_id?.clear();
    if (!abap.Classes[className]) return exception();
    const id = globalThis.crypto.randomUUID(); // Web Crypto: in Node and in a service worker alike
    const row = {id, daemonId, destination: String(value(input.i_destination) ?? 'NONE'),
      priority: Number(value(input.i_priority) ?? 1), server: 'OSG', name: value(input.i_name).trim(), className, creator: program(),
      client: abap.builtin.sy.get().mandt.get(), user: abap.builtin.sy.get().uname.get(), started: clock.now(),
      object: await new abap.Classes[className]().constructor_(), pending: 0, queue: Promise.resolve(), timers: new Map()};
    const param = input.i_parameter ?? ref(abap, await new abap.Classes.CL_AC_MESSAGE_TYPE_PCP().constructor_());
    row.context = {
      if_abap_daemon_context$get_instance_id: async () => string(abap, id),
      if_abap_daemon_context$get_start_parameter: async () => param,
      if_abap_daemon_context$stop: async (i = {}) => stop(row, i.i_parameter),
      if_abap_daemon_context_base$get_start_parameter: async () => param,
    };
    const setup = new abap.types.Integer();
    await row.object.if_abap_daemon_extension$on_accept({i_context_base: ref(abap, row.context), e_setup_mode: setup});
    input.e_setup_mode?.set(setup);
    if (setup.get() !== 1) return;
    input.e_instance_id?.set(id);
    instances.set(id, row);
    enqueue(row, 'on_start');
  };
  function owned(row) { return row && row.creator === program() && row.client === abap.builtin.sy.get().mandt.get() && row.user === abap.builtin.sy.get().uname.get(); }
  Manager.get_daemon_info = async (input = {}) => {
    const result = Manager.METHODS.GET_DAEMON_INFO.parameters.R_INFO_TABLE.type();
    const className = String(value(input.i_class_name) ?? '').trim().toUpperCase();
    const daemonId = String(value(input.i_daemon_id) ?? '').trim().toUpperCase();
    if (!className && !daemonId) return exception();
    for (const row of instances.values()) {
      if (owned(row) && (!className || row.className === className) && (!daemonId || row.daemonId === daemonId)) result.append(info(row));
    }
    return result;
  };
  Manager.attach = async (input) => {
    const row = instances.get(value(input.i_instance_id).trim());
    if (!owned(row)) return exception();
    return ref(abap, {if_abap_daemon_handle$send: async (i = {}) => {
      if (!instances.has(row.id)) return exception();
      enqueue(row, 'on_message', {i_message: i.i_message});
    }});
  };
  Manager.stop = async (input) => {
    const row = instances.get(value(input.i_instance_id).trim());
    if (!owned(row)) return exception();
    stop(row, input.i_parameter);
  };
  const timer = {if_abap_timer_manager$start_timer: async ({i_timer_handler, i_timeout}) => {
    const row = active.getStore(), handler = value(i_timer_handler);
    if (!row || row.timers.has(handler)) throw await new abap.Classes.CX_ABAP_TIMER_ERROR().constructor_();
    const handle = clock.setTimer(() => {
      row.timers.delete(handler);
      row.queue = row.queue.then(() => outsideStepContext(() => dialogStep(() => active.run(row, async () => {
        const sy=abap.builtin.sy.get(), user=sy.uname.clone(), client=sy.mandt.clone();
        sy.uname.set(row.user);sy.mandt.set(row.client);
        try{return await handler.if_abap_timer_handler$on_timeout();}finally{sy.uname.set(user);sy.mandt.set(client);}
      }))))
        .catch(async (e) => { host.errors.push(e); clearTimers(row); row.object = await new abap.Classes[row.className]().constructor_(); enqueue(row, 'on_error', {i_code: new abap.types.Integer().set(103), i_reason: string(abap, e.message ?? 'dump')}); });
      return row.queue;
    }, Number(value(i_timeout)));
    row.timers.set(handler, handle);
  }, if_abap_timer_manager$stop_timer: async ({i_timer_handler}) => {
    const row = active.getStore(), handler = value(i_timer_handler);
    if (row) { clock.clearTimer(row.timers.get(handler)); row.timers.delete(handler); }
  }};
  // inside a daemon callback the daemon's manager; anywhere else whatever was there before (an APC
  // session's, or the session_type_not_supported refusal a system gives outside such a session)
  const Timer = abap.Classes.CL_ABAP_TIMER_MANAGER, before = Timer.get_timer_manager;
  Timer.get_timer_manager = async function (input) {
    return active.getStore() ? ref(abap, timer) : before.call(this, input);
  };
  return host;
}
