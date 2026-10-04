// Private IPC compiler tool; osd-host dispatches it in checkout, VSIX and binary.
import {WarmCompiler} from "./osd-warm.mjs";
import {warmOverlay} from "./osd-warm-overlay.mjs";
import {runsAs} from "./osd-main.mjs";
import {join} from "node:path";

export function main() {
  let inactive = [];
  let folder;
  const root = process.env.OSD_ROOT ?? process.cwd();
  const compiler = new WarmCompiler({root,
    log: text => process.send({type: "log", text}),
    inactiveSources: activating => inactive.filter(entry => !activating.has(entry.key)),
    keyOf: file => inactive.find(entry => entry.files.some(f => join(f.file) === join(file)))?.key,
    overlay: activating => warmOverlay(root, folder,
      inactive.map(entry => ({key: entry.key, files: entry.files.map(f => f.file)})), activating),
  });
  const state = () => ({primed: compiler.primed, hash: compiler.hash, files: compiler.files?.size ?? 0,
    digests: [...(compiler.digests ?? [])], unverified: [...compiler.unverified],
    readers: compiler.primed ? [...compiler.reg.getObjects()].map(o => {
      const type = o.getType(), name = o.getName();
      return [`${type} ${name}`, compiler.readersOf(type, name)];
    }) : [],
  });
  let queue = Promise.resolve();
  process.on("message", message => {
    queue = queue.then(async () => {
      inactive = message.inactive;
      folder = message.folder;
      try {
        if (!["prime", "build"].includes(message.method)) throw new Error("unknown compiler operation");
        const result = await compiler[message.method](new Set(message.activating));
        process.send({id: message.id, result, state: state()});
      } catch (e) {
        const error = {message: e.message, code: e.code, check: e.check, issues: e.issues, output: e.output};
        process.send({id: message.id, error, state: state()});
      }
    }).catch(() => process.exit(1));
  });
  process.on("disconnect", () => { compiler.drop(); process.exit(0); });
}

if (runsAs("osd-warm-worker.mjs")) main();
