// The file system OPEN DATASET reads and writes (X0, docs/dataset.md).
//
// The transpiler's runtime owns the ABAP side of the DATASET statements --
// text lines, the byte layout of each mode, ACTUAL LENGTH, sy-subrc, the
// exceptions -- and asks `abap.context.dataset` for bytes only. This module
// is that host, twice:
//
//   sandboxDatasetHost  the disk, behind roots: nothing is readable or
//                       writable unless a root says so, every name is
//                       resolved inside a root with its symlinks followed,
//                       and a name that leaves every root is refused
//   memoryDatasetHost   a map of names to bytes, for the browser preview
//                       and for tests; no node:fs anywhere near it
//
// A refusal is what a system answers when a file cannot be opened: sy-subrc
// 8 and a MESSAGE (measured on A4H for a missing file). A system's own
// authority check (S_DATASET) raises CX_SY_FILE_AUTHORITY instead, and that
// was not measurable there -- the probe user has every authority -- so the
// sandbox uses the shape that was measured (ANORMALIES, dataset-authority).

const WRITE_MODES = new Set(["OUTPUT", "APPENDING", "UPDATE"]);

/** roots from a list: OSD_DATASET_READ / OSD_DATASET_WRITE, separated by the
 *  platform's path delimiter, blanks and empties dropped */
export function rootsOf(value, delimiter = ":") {
  return String(value ?? "").split(delimiter).map((r) => r.trim()).filter((r) => r !== "");
}

/**
 * The disk behind roots. `read` and `write` are lists of directories; a
 * write root is readable too. A relative name resolves against `home`
 * (default: the first write root, else the first read root), the way a
 * system resolves it against its own directory. `audit(entry)` is called
 * for every OPEN and DELETE, allowed or not.
 */
export function sandboxDatasetHost({read = [], write = [], home, audit} = {}) {
  let fs;
  let path;
  let resolvedRoots;
  const load = async () => {
    if (fs === undefined) {
      fs = await import("node:fs/promises");
      path = await import("node:path");
    }
    if (resolvedRoots === undefined) {
      // a root is compared by its real path, so a root that is itself a
      // symlink still contains what it points at
      const real = async (r) => {
        try {
          return await fs.realpath(path.resolve(r));
        } catch {
          return undefined;
        }
      };
      resolvedRoots = {
        read: (await Promise.all([...read, ...write].map(real))).filter(Boolean),
        write: (await Promise.all(write.map(real))).filter(Boolean),
      };
    }
    return resolvedRoots;
  };
  const note = (entry) => {
    try {
      audit?.({at: new Date().toISOString(), ...entry});
    } catch {
      // an audit sink that fails does not decide whether a file opens
    }
  };

  /** the real path a name stands for, when it lies inside one of `roots` */
  const place = async (name, roots) => {
    if (roots.length === 0) {
      return {refused: "no dataset root allows this (OSD_DATASET_READ / OSD_DATASET_WRITE)"};
    }
    if (name.includes("\0")) {
      return {refused: "a NUL in the name"};
    }
    const base = home ?? write[0] ?? read[0];
    const wanted = path.resolve(base ?? ".", name);
    // Follow what exists: the file itself when it is there, else its
    // directory. A symlink that points out of the root is then outside it.
    let real;
    try {
      real = await fs.realpath(wanted);
    } catch {
      try {
        real = path.join(await fs.realpath(path.dirname(wanted)), path.basename(wanted));
      } catch {
        return {missing: true, real: wanted};
      }
    }
    const inside = roots.some((root) => real === root || real.startsWith(root.endsWith(path.sep) ? root : root + path.sep));
    return inside ? {real} : {refused: `${name} is outside the dataset roots`};
  };

  return {
    async open(name, mode) {
      const roots = await load();
      const writing = WRITE_MODES.has(mode);
      const where = await place(name, writing ? roots.write : roots.read);
      if (where.refused !== undefined) {
        note({op: "OPEN", name, mode, allowed: false, why: where.refused});
        return {message: `Permission denied: ${where.refused}`};
      }
      if (where.missing === true) {
        note({op: "OPEN", name, mode, allowed: false, why: "no such directory"});
        return {message: "No such file or directory"};
      }
      let handle;
      try {
        const flags = mode === "INPUT" ? "r" : mode === "OUTPUT" ? "w" : mode === "APPENDING" ? "a+" : "r+";
        handle = await fs.open(where.real, flags);
        // opened by its real path: a symlink swapped in after the check is
        // not followed a second time
        if ((await handle.stat()).isDirectory()) {
          // a directory opens on a system too (FOR INPUT IN BINARY MODE is 0
          // there, measured), and then reads nothing
          await handle.close();
          handle = undefined;
        }
      } catch (error) {
        note({op: "OPEN", name, mode, allowed: false, why: error.code ?? String(error)});
        return {message: error.code === "ENOENT" ? "No such file or directory" : `${error.code ?? "error"}: ${error.message}`};
      }
      note({op: "OPEN", name, mode, allowed: true, path: where.real});
      if (handle === undefined) {
        return emptyHandle();
      }
      return {
        async read(position, length) {
          const buffer = new Uint8Array(length);
          const {bytesRead} = await handle.read(buffer, 0, length, position);
          return buffer.subarray(0, bytesRead);
        },
        async write(position, bytes) {
          // APPENDING opens with "a+", where the OS puts every write at the
          // end whatever the position says, which is what APPENDING means
          await handle.write(bytes, 0, bytes.length, position);
        },
        async size() {
          return (await handle.stat()).size;
        },
        async close() {
          await handle.close();
        },
      };
    },

    async delete(name) {
      const roots = await load();
      const where = await place(name, roots.write);
      if (where.refused !== undefined || where.missing === true) {
        note({op: "DELETE", name, allowed: false, why: where.refused ?? "no such directory"});
        return false;
      }
      try {
        await fs.unlink(where.real);
        note({op: "DELETE", name, allowed: true, path: where.real});
        return true;
      } catch (error) {
        note({op: "DELETE", name, allowed: false, why: error.code ?? String(error)});
        return false;
      }
    },
  };
}

function emptyHandle() {
  return {
    async read() { return new Uint8Array(0); },
    async write() {},
    async size() { return 0; },
    async close() {},
  };
}

/** a map of names to bytes; `files` is shared, so a test can seed and inspect it */
export function memoryDatasetHost(files = new Map()) {
  return {
    files,
    async open(name, mode) {
      if (!files.has(name)) {
        if (mode === "INPUT") {
          return {message: "No such file or directory"};
        }
        files.set(name, new Uint8Array(0));
      }
      if (mode === "OUTPUT") {
        files.set(name, new Uint8Array(0));
      }
      return {
        async read(position, length) {
          return files.get(name).slice(position, position + length);
        },
        async write(position, bytes) {
          const now = files.get(name) ?? new Uint8Array(0);
          const at = mode === "APPENDING" ? now.length : position;
          const out = new Uint8Array(Math.max(now.length, at + bytes.length));
          out.set(now, 0);
          out.set(bytes, at);
          files.set(name, out);
        },
        async size() {
          return (files.get(name) ?? new Uint8Array(0)).length;
        },
        async close() {},
      };
    },
    async delete(name) {
      return files.delete(name);
    },
  };
}

/**
 * Installs the host the environment asks for: the sandbox over
 * OSD_DATASET_READ / OSD_DATASET_WRITE (OSD_DATASET_HOME for relative
 * names, OSD_DATASET_AUDIT for an ndjson log of every OPEN and DELETE).
 * With neither root set, a sandbox that refuses everything: deny by
 * default, and a program that tries learns so from sy-subrc 8 and its
 * MESSAGE rather than from "not supported".
 */
export async function installDataset(abap, env = globalThis.process?.env ?? {}) {
  const {delimiter} = await import("node:path");
  let audit;
  if (env.OSD_DATASET_AUDIT) {
    const {appendFileSync} = await import("node:fs");
    audit = (entry) => appendFileSync(env.OSD_DATASET_AUDIT, JSON.stringify(entry) + "\n");
  }
  abap.context.dataset = sandboxDatasetHost({
    read: rootsOf(env.OSD_DATASET_READ, delimiter),
    write: rootsOf(env.OSD_DATASET_WRITE, delimiter),
    home: env.OSD_DATASET_HOME || undefined,
    audit,
  });
  abap.context.datasets ??= {};
  return abap.context.dataset;
}
