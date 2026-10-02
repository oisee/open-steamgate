// Optional Sessions adapter. Persistent rows are authoritative; views are
// request snapshots. Every lookup at use runs under the work-process lock.
// withSystem needs AsyncLocalStorage, so this adapter runs on Node and Bun,
// not the browser preview.
import {Sessions, parseCookies, refuseToken, FETCH} from "./adt-session.mjs";
import {claimAdtSessions} from "./adt-enq-key.mjs";
import {EnqOwners} from "./adt-enq.mjs";
import {dialogStep, currentStepToken} from "./osd-dialog-step.mjs";
import {withSystem} from "./osd-store-destination.mjs";

const API = "zif_osd_adt_session$";
const UNSAFE = new Set(["POST", "PUT", "DELETE", "PATCH", "MERGE"]);
const value = (v) => String(v.get()).trimEnd();
const plain = (row) => Object.fromEntries(Object.entries(row.get()).map(([k, v]) => [k, value(v)]));
const args = (input) => Object.fromEntries(Object.entries(input).map(([k, v]) =>
  [k, new globalThis.abap.types.String().set(v)]));
function fields(input) {
  const a = globalThis.abap;
  const row = new a.types.Structure({name: new a.types.String(), value: new a.types.String()});
  const table = a.types.TableFactory.construct(row);
  for (const [name, value] of Object.entries(input)) {
    const line = row.clone();
    line.get().name.set(name);
    line.get().value.set(String(value ?? ""));
    table.append(line);
  }
  return table;
}

export class AbapSessions {
  constructor(options = {}) {
    claimAdtSessions("abap");
    this.owners = new EnqOwners();
    this.step = options.step ?? dialogStep;
    this.ttlMs = options.ttlMs ?? 30 * 60 * 1000;
    // userName is the user of a session opened without a Basic header, Node's
    // ANONYMOUS; the system id and the client name the session cookie
    this.identity = {systemID: "OSD", client: "001", userName: "OSD", ...options.identity};
  }

  static user(req) { return Sessions.user(req); }

  #run(work) {
    const execute = async () => {
      // Read the class slot each time so warm loads keep working.
      const a = globalThis.abap;
      const obj = await new a.Classes.ZCL_OSD_ADT_SESSION().constructor_({
        iv_ttl_seconds: new a.types.Integer().set(Math.ceil(this.ttlMs / 1000)),
      });
      return withSystem((kind) => kind === "IDENTITY" ? this.identity : undefined, () => work(obj));
    };
    return currentStepToken() === undefined ? this.step(execute, "ADT ABAP sessions") : execute();
  }

  #call(obj, method, input) { return obj[API + method](args(input)); }

  async #view(obj, id) {
    const row = plain(await obj.peek(args({iv_id: id})));
    if (!row.id) return undefined;
    const locks = new Map((await obj.handles(args({iv_id: id}))).array().map((line) => {
      const r = plain(line);
      return [r.handle, {handle: r.handle, type: r.objtype, name: r.objname}];
    }));
    return {id: row.id, user: row.username, token: row.token, stateful: row.stateful === "X", locks};
  }

  get(id) {
    return this.#run(async (obj) => (await this.#call(obj, "alive", {iv_id: id ?? ""})).get() === "X"
      ? this.#view(obj, id) : undefined);
  }

  /** the lock server ended the session's ENQ context: its handles go */
  contextEnded(id) {
    return this.#run((obj) => this.#call(obj, "enq_context_ended", {iv_id: id}));
  }

  open(user) {
    return this.#run(async (obj) => {
      const session = await obj[API + "resolve"]({it_cookies: fields({}),
        it_headers: fields({authorization: `Basic ${Buffer.from(`${user}:x`).toString("base64")}`})});
      return this.#view(obj, value(session.get().id));
    });
  }

  end(id) { return this.#run((obj) => this.#call(obj, "end", {iv_id: id})); }

  async #holder(obj, type, name) {
    const owner = this.owners.holder(type, name);
    if (owner === undefined) return undefined;
    const key = owner.mine ? this.owners.key(owner.id) : "foreign-holder";
    if ((await this.#call(obj, "alive", {iv_id: key})).get() !== "X") return undefined;
    const session = owner.mine ? await this.#view(obj, owner.id)
      : {id: owner.id, user: owner.user ?? "", locks: new Map()};
    if (session === undefined) return undefined;
    const handle = [...session.locks.values()].find((lock) =>
      lock.type.toUpperCase() === String(type).toUpperCase() && lock.name.toUpperCase() === String(name).toUpperCase())?.handle;
    return {session, handle};
  }

  holderOf(type, name) { return this.#run((obj) => this.#holder(obj, type, name)); }

  holds(session, handle, type, name) {
    return this.#run(async (obj) => {
      if ((await this.#call(obj, "holds", {iv_id: session.id, iv_handle: handle, iv_type: type, iv_name: name})).get() !== "X") return false;
      const holder = await this.#holder(obj, type, name);
      return holder?.session.id === session.id && holder.handle === handle;
    });
  }

  async #adopt(obj, session, type, name) {
    if ((await this.#call(obj, "alive", {iv_id: session.id})).get() !== "X") throw new Error("ADT session ended");
    const handle = value(await this.#call(obj, "adopt_handle", {iv_id: session.id, iv_type: type, iv_name: name}));
    session.locks.set(handle, {handle, type, name});
    return handle;
  }

  adopt(session, type, name) { return this.#run((obj) => this.#adopt(obj, session, type, name)); }

  lock(session, type, name) {
    return this.#run(async (obj) => {
      const holder = await this.#holder(obj, type, name);
      if (holder !== undefined && holder.session.id !== session.id) return {heldBy: holder.session};
      if ((await this.#call(obj, "alive", {iv_id: session.id})).get() !== "X") throw new Error("ADT session ended");
      const taken = this.owners.take(session, type, name);
      if (taken.heldBy !== undefined) return taken;
      return {handle: await this.#adopt(obj, session, type, name)};
    });
  }

  async #forget(obj, session, handle) {
    const type = new globalThis.abap.types.String(), name = new globalThis.abap.types.String();
    await obj[API + "release_handle"]({...args({iv_id: session.id, iv_handle: handle}), ev_type: type, ev_name: name});
    session.locks.delete(handle);
    return type.get() ? {handle, type: type.get(), name: name.get()} : undefined;
  }

  forget(session, handle) { return this.#run((obj) => this.#forget(obj, session, handle)); }

  unlock(session, handle) {
    return this.#run(async (obj) => {
      const lock = await this.#forget(obj, session, handle);
      if (lock !== undefined) this.owners.drop(session, lock.type, lock.name);
    });
  }

  release(type, name) {
    return this.#run(async (obj) => {
      const holder = await this.#holder(obj, type, name);
      if (holder === undefined || holder.session.id === undefined) return;
      if (holder.handle !== undefined) await this.#forget(obj, holder.session, holder.handle);
      this.owners.drop(holder.session, type, name);
    });
  }

  /** The work, run in one step with the proof that the session's handle
   *  still holds the object: a route's last check before it writes, with
   *  nothing able to run between the check and the write (a logoff, an
   *  UNLOCK, an expiry would otherwise fit in the gap). Answers false, and
   *  runs nothing, when the handle no longer holds. */
  whileHeld(session, handle, type, name, work) {
    return this.#run(async (obj) => {
      if ((await this.#call(obj, "holds", {iv_id: session.id, iv_handle: handle, iv_type: type, iv_name: name})).get() !== "X") return false;
      const holder = await this.#holder(obj, type, name);
      if (holder?.session.id !== session.id || holder.handle !== handle) return false;
      await work();
      return true;
    });
  }

  // {ended} when the caller's session is gone by the time the delete runs:
  // its logoff can run between the front's verdict and this step, and a
  // session that is gone holds nothing and may delete nothing
  deleteObject(session, type, name, store) {
    return this.#run(async (obj) => {
      if ((await this.#call(obj, "alive", {iv_id: session.id})).get() !== "X") return {ended: true};
      const holder = await this.#holder(obj, type, store.find(type, name)?.name ?? name);
      if (holder !== undefined && holder.session.id !== session.id) return {holder};
      const gone = store.delete(type, name);
      if (holder !== undefined && holder.handle !== undefined) {
        await this.#forget(obj, holder.session, holder.handle);
        this.owners.drop(holder.session, gone.type, gone.name);
      }
      return {gone};
    });
  }

  /** The ZIF_OSD_ADT_SESSION of one request of the ABAP front
   *  (tools/adt-abap-front.mjs), made inside its step: ZCL_OSD_ADT_HANDLER
   *  resolves it, and the RESOLVE it calls also sets req.adt -- the session
   *  as the Node routes and the host's SYSTEM answers read it -- before the
   *  router runs. One object per request, so nothing of one request's
   *  session reaches another's. */
  async sessionFor(req) {
    const a = globalThis.abap;
    const obj = await new a.Classes.ZCL_OSD_ADT_SESSION().constructor_({
      iv_ttl_seconds: new a.types.Integer().set(Math.ceil(this.ttlMs / 1000)),
    });
    const resolve = obj[API + "resolve"].bind(obj);
    obj[API + "resolve"] = async (input) => {
      // the sessions' identity, as every other call of this adapter has it
      const resolved = await withSystem((kind) => kind === "IDENTITY" ? this.identity : undefined, () => resolve(input));
      const session = await this.#view(obj, value(resolved.get().id));
      req.adt = {session, sessions: this,
        fetching: String(req.headers["x-csrf-token"] ?? "").toLowerCase() === FETCH};
      return resolved;
    };
    return obj;
  }

  middleware() {
    return (req, res, next) => {
      this.#run(async (obj) => {
        let resolved;
        try {
          resolved = await obj[API + "resolve"]({it_cookies: fields(parseCookies(req.headers.cookie)), it_headers: fields(req.headers)});
        } catch (e) {
          if (e instanceof globalThis.abap.Classes.ZCX_OSD_ADT &&
              e.type_id.get() === globalThis.abap.Classes.ZCX_OSD_ADT.c_session_ended.get()) {
            refuseToken(res); // catch inside the step: row deletion must commit
            return false;
          }
          throw e;
        }
        for (const cookie of (await obj[API + "cookies"]({is_session: resolved})).array()) res.append("Set-Cookie", cookie.get());
        const session = await this.#view(obj, value(resolved.get().id));
        res.setHeader("x-csrf-token", session.token);
        const wanted = String(req.headers["x-csrf-token"] ?? "");
        if (UNSAFE.has(req.method.toUpperCase()) &&
            (await this.#call(obj, "token_valid", {iv_id: session.id, iv_token: wanted})).get() !== "X") {
          refuseToken(res);
          return false;
        }
        req.adt = {session, sessions: this, fetching: wanted.toLowerCase() === FETCH};
        return true;
      }).then((passed) => { if (passed) next(); }, next);
    };
  }
}
