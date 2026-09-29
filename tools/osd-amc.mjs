// Local AMC broker. SEND publishes outside the database LUW; receiver calls
// are scheduled separately when their session is in a WAIT.
import {readFileSync, readdirSync, statSync} from "node:fs";
import {basename, join} from "node:path";
import {generatorFoldersOf, winningByLayer} from "./osd-packs.mjs";
import {currentStepToken, dialogStep, outsideStepContext, registerWaitPump} from "./osd-dialog-step.mjs";

const tag = (xml, name) => new RegExp(`<${name}>([^<]*)</${name}>`, "i").exec(xml)?.[1]?.trim();
const rows = (xml, name) => [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "gi"))].map((m) => m[1]);
const keyOf = (app, path) => `${String(app).trim().toUpperCase()}|${String(path).trim().toLowerCase()}`;

export function parseSamc(xml, source) {
  const app = tag(xml, "APPLICATION_ID");
  if (!app) return [];
  const authorities = rows(xml, "AMC_CHNL_AUTH").map((row) => ({
    path: tag(row, "CHANNEL_ID")?.toLowerCase(),
    program: tag(row, "PROGRAM_ID")?.toUpperCase(),
    activity: tag(row, "ACTIVITY"),
  }));
  return rows(xml, "AMC_CHANNEL").map((row) => ({
    applicationId: app.toUpperCase(),
    path: tag(row, "CHANNEL_ID")?.toLowerCase(),
    type: tag(row, "MESSAGE_TYPE_ID")?.toUpperCase(),
    scope: tag(row, "SCOPE"),
    authorities,
    source,
  })).filter((row) => row.path && row.type);
}

function walk(dir, out) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    const file = join(dir, entry);
    let stat;
    try { stat = statSync(file); } catch { continue; }
    if (stat.isDirectory()) walk(file, out);
    else if (entry.toLowerCase().endsWith(".samc.xml")) out.push(file);
  }
}

export function amcChannels(root = process.cwd(), roots = generatorFoldersOf(root)) {
  const files = winningByLayer(roots, (dir) => {
    const found = [];
    walk(join(root, dir), found);
    return found;
  }, (file) => basename(file).toUpperCase());
  const definitions = files.flatMap((file) => parseSamc(readFileSync(file, "utf8"), file));
  return [...new Map(definitions.map((row) => [keyOf(row.applicationId, row.path), row])).values()];
}

export class AmcBroker {
  constructor(channels) {
    this.channels = new Map(channels.map((row) => [keyOf(row.applicationId, row.path), row]));
    this.subscribers = new Set();
  }

  channel(app, path, activity, program) {
    const row = this.channels.get(keyOf(app, path));
    if (!row) throw new Error(`AMC channel ${app} ${path} is not defined.`);
    const authorised = row.authorities.some((one) => one.path === row.path
      && one.activity === activity && one.program === program?.toUpperCase());
    if (!authorised) throw new Error(`AMC ${activity === "S" ? "send" : "receive"} is not authorised for ${program ?? "unknown program"}.`);
    return row;
  }

  subscribe({app, path, program, session, receive, extension = ""}) {
    const channel = this.channel(app, path, "R", program);
    const subscription = {channel, session, receive, extension, pending: [], active: true};
    this.subscribers.add(subscription);
    return {
      subscription,
      close: () => { subscription.active = false; this.subscribers.delete(subscription); },
    };
  }

  send({app, path, program, session, type, message, suppressEcho = false, extension = "", client, username}) {
    const channel = this.channel(app, path, "S", program);
    if (channel.type !== type) throw new Error(`AMC channel ${path} expects ${channel.type}, got ${type}.`);
    const publication = {type, message, client, username};
    for (const sub of this.subscribers) {
      if (!sub.active || sub.channel !== channel || sub.extension !== extension) continue;
      if (suppressEcho && sub.session === session) continue;
      if (sub.receive) sub.receive(publication);
      else sub.pending.push(publication);
    }
  }
}

let broker;
export function installAmc(abap, root = process.cwd()) {
  const Manager = abap.Classes.CL_AMC_CHANNEL_MANAGER;
  if (!Manager || Manager.osdAmcInstalled) return broker;
  broker = new AmcBroker(amcChannels(root));
  Manager.osdAmcInstalled = true;
  registerWaitPump((session) => drainAmcSession(abap, session));
  if (abap.Classes.KERNEL_PUSH_CHANNELS) {
    abap.Classes.KERNEL_PUSH_CHANNELS.wait = async ({seconds, cond}) =>
      abap.statements.wait({seconds, cond});
  }
  const Producer = abap.Classes.ZCL_AMC_PRODUCER;
  const Consumer = abap.Classes.ZCL_AMC_CONSUMER;
  const props = new WeakMap();
  const value = (x) => x?.get?.() ?? x;
  const program = () => {
    const repid = String(abap.builtin.sy.get().repid.get()).trim().toUpperCase();
    return repid && repid !== "OPEN_ABAP_TODO" ? repid : undefined;
  };
  const error = async (reason) => {
    throw await new abap.Classes.CX_AMC_ERROR().constructor_({iv_reason: new abap.types.String().set(reason)});
  };
  const wrap = async (work) => {
    try { return await work(); } catch (e) { return error(e.message); }
  };
  Manager.create_message_producer = async (input) => wrap(() => {
    if (Number(value(input.i_communication_type) ?? 2) === 1) throw new Error("Communication type 1 is not supported.");
    const object = new Producer();
    props.set(object, {app: value(input.i_application_id), path: value(input.i_channel_id),
      extension: value(input.i_channel_extension_id) ?? "", suppressEcho: value(input.i_suppress_echo) === "X",
      session: currentStepToken(), program: program()});
    return new abap.types.ABAPObject({qualifiedName: "IF_AMC_MESSAGE_PRODUCER"}).set(object);
  });
  Manager.create_message_consumer = async (input) => wrap(() => {
    const object = new Consumer();
    props.set(object, {app: value(input.i_application_id), path: value(input.i_channel_id),
      extension: value(input.i_channel_extension_id) ?? "", session: currentStepToken(), program: program()});
    return new abap.types.ABAPObject({qualifiedName: "IF_AMC_MESSAGE_CONSUMER"}).set(object);
  });
  Manager.get_consumer_session_id = async () => new abap.types.String().set(String(currentStepToken()?.id ?? ""));
  for (const type of ["text", "binary", "pcp"]) {
    Producer.prototype[`if_amc_message_producer_${type}$send`] = async function ({i_message}) { return wrap(() => {
      const details = props.get(this);
      broker.send({...details, type: type.toUpperCase(), message: value(i_message),
        client: abap.builtin.sy.get().mandt.get(), username: abap.builtin.sy.get().uname.get()});
    }); };
  }
  Consumer.prototype.if_amc_message_consumer$start_message_delivery = async function ({i_receiver}) {
    return wrap(() => {
      const details = props.get(this);
      this.osdSubscription?.close();
      const receiver = value(i_receiver);
      this.osdSubscription = broker.subscribe({...details, receive: undefined});
      this.osdSubscription.subscription.receiver = receiver;
    });
  };
  Consumer.prototype.if_amc_message_consumer$stop_message_delivery = async function () {
    this.osdSubscription?.close();
    this.osdSubscription = undefined;
  };
  return broker;
}

export async function drainAmcSession(abap, session) {
  if (!broker) return false;
  let delivered = false;
  for (const sub of broker.subscribers) {
    if (sub.session !== session || !sub.active || !sub.receiver) continue;
    while (sub.pending.length) {
      const publication = sub.pending.shift();
      const receiver = sub.receiver;
      if (!receiver) break;
      delivered = true;
      await outsideStepContext(() => dialogStep(async () => {
        const Context = abap.Classes.ZCL_AMC_MESSAGE_CONTEXT;
        const context = new Context();
        await context.constructor_({iv_client: new abap.types.Character(3).set(publication.client),
          iv_username: new abap.types.Character(12).set(publication.username)});
        await receiver[`if_amc_message_receiver_${publication.type.toLowerCase()}$receive`]({
          i_message: publication.message,
          i_context: new abap.types.ABAPObject({qualifiedName: "IF_AMC_MESSAGE_CONTEXT"}).set(context),
        });
      }));
    }
  }
  return delivered;
}
