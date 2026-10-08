import {createHash} from "node:crypto";
import {readFileSync, realpathSync} from "node:fs";
import {isAbsolute, relative, resolve} from "node:path";

export function realContainedPath(root, path) {
  const realRoot = realpathSync(root);
  const realPath = realpathSync(resolve(root, path));
  const local = relative(realRoot, realPath);
  if (local === ".." || local.startsWith("../") || isAbsolute(local)) {
    const error = new Error(`file resolves outside snapshot root: ${path}`);
    error.protocolCode = "BAD_REQUEST";
    throw error;
  }
  return {realRoot, realPath, local};
}

export function trackedRead(audit, root, path, encoding) {
  if (audit === undefined) {
    const bytes = readFileSync(resolve(root, path));
    return encoding === undefined ? bytes : bytes.toString(encoding);
  }
  const contained = realContainedPath(root, path);
  const local = relative(contained.realRoot, resolve(root, path));
  const bytes = readFileSync(contained.realPath);
  audit?.record(local, bytes);
  return encoding === undefined ? bytes : bytes.toString(encoding);
}

export class InputAudit {
  constructor() {
    this.inputs = new Map();
  }

  record(path, bytes) {
    this.inputs.set(path, createHash("sha256").update(bytes).digest("hex"));
  }

  verified(root) {
    for (const [path, sha256] of [...this.inputs].sort(([left], [right]) => left.localeCompare(right))) {
      const bytes = readFileSync(realContainedPath(root, path).realPath);
      if (createHash("sha256").update(bytes).digest("hex") !== sha256) {
        const error = new Error(`input hash differs: ${path}`);
        error.protocolCode = "SNAPSHOT_MISMATCH";
        throw error;
      }
    }
    return [...this.inputs].map(([path, sha256]) => ({path, sha256}))
      .sort((left, right) => left.path.localeCompare(right.path));
  }
}
