// A timer belongs to an APC session. The ABAP library declares the contract;
// this Node host supplies the clock and posts expiries back as dialog steps.
import {currentStepToken, dialogStep, outsideStepContext} from "./osd-dialog-step.mjs";

const sessions = new WeakMap();
const installed = new WeakSet();
const active = new Set();

export function cancelAllApcTimers() {
  for (const session of active) session.cancel();
}

export function installTimerManager(abap) {
  const Timer = abap.Classes.CL_ABAP_TIMER_MANAGER;
  if (Timer === undefined || installed.has(Timer)) return;
  installed.add(Timer);
  const outside = Timer.get_timer_manager;
  Timer.get_timer_manager = async function (input) {
    const session = sessions.get(currentStepToken());
    if (session === undefined || session.closed) return outside.call(this, input);
    return new abap.types.ABAPObject({qualifiedName: "IF_ABAP_TIMER_MANAGER"}).set(session.manager);
  };
}

export function apcTimerSession(abap, deliver, failure) {
  installTimerManager(abap);
  const session = {closed: false, armed: new Map(), manager: new abap.Classes.CL_ABAP_TIMER_MANAGER()};
  active.add(session);
  session.cancel = () => {
    for (const entry of session.armed.values()) clearTimeout(entry.timer);
    session.armed.clear();
  };
  const error = async (textid) => {
    throw await new abap.Classes.CX_ABAP_TIMER_ERROR().constructor_({
      textid,
    });
  };
  session.manager.if_abap_timer_manager$start_timer = async ({i_timer_handler, i_timeout}) => {
    // A closing socket can overtake a pending on_start. There is no session
    // left to receive an error or an expiry, so a late start is a no-op.
    if (session.closed) return;
    const handler = i_timer_handler.get();
    if (session.armed.has(handler)) return error(abap.Classes.CX_ABAP_TIMER_ERROR.timer_already_active);
    const timeout = Math.max(0, Number(i_timeout.get()));
    const entry = {handler};
    session.armed.set(handler, entry);
    entry.timer = setTimeout(() => outsideStepContext(() => {
      if (session.closed || session.armed.get(handler) !== entry) return;
      // The timer callback never runs on the clock's stack. It takes the
      // session mailbox, then the one work process, like an APC message.
      deliver(() => step(async () => {
        if (session.closed || session.armed.get(handler) !== entry) return;
        session.armed.delete(handler);
        await handler.if_abap_timer_handler$on_timeout();
      })).catch(failure);
    }), timeout);
  };
  session.manager.if_abap_timer_manager$stop_timer = async ({i_timer_handler}) => {
    const handler = i_timer_handler.get();
    const entry = session.armed.get(handler);
    if (entry === undefined) return error(abap.Classes.CX_ABAP_TIMER_ERROR.timer_object_not_active);
    clearTimeout(entry.timer);
    session.armed.delete(handler);
  };
  async function step(work) {
    return dialogStep(async () => {
      const token = currentStepToken();
      sessions.set(token, session);
      try {
        return await work();
      } finally {
        sessions.delete(token);
      }
    });
  }
  function close() {
    session.closed = true;
    session.cancel();
    active.delete(session);
  }
  return {step, close, session};
}
