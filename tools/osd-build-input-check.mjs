// Path normalization and race checks shared by cold compilation.
import {statSync} from "node:fs";
import {resolve, relative} from "node:path";

// a path spelled one way: absolute, forward slashes
export function normalPath(file) {
  return resolve(file).split("\\").join("/");
}

// what changes with any write to a file, a write of the same bytes included
export function stampOf(file) {
  try {
    const st = statSync(file, {bigint: true});
    return `${st.size}:${st.mtimeNs}:${st.ctimeNs}:${st.ino}`;
  } catch {
    return "absent";
  }
}

export function changedError(root, files) {
  const names = [...new Set(files.map((f) => relative(root, f)))];
  const error = new Error(`the tree changed while it was built: ${names.slice(0, 5).join(", ")}`);
  error.code = "CHANGED";
  return error;
}
