// The line of each key and list item of a YAML file, which js-yaml does not
// keep: the DSL tools (tools/dsl-l2.mjs, tools/dsl-l3.mjs) name file:line in
// every refusal through it.

// A path is the keys and 0-based item indexes joined by "/", as
// `forbid/where` or `examples/1/rows/ZTAB/0/field`. Block mappings and block
// sequences are indexed; a flow collection (`[{a: 1}]`) is one line, so what
// is inside it takes the line of the key that holds it (see `lineOf`).
export function lineIndex(text) {
  const index = new Map();
  const stack = [{indent: -1, path: ""}];
  let scalarIndent = -1;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const indent = raw.length - raw.trimStart().length;
    const content = raw.trim();
    if (scalarIndent >= 0) {
      if (content === "" || indent > scalarIndent) return;
      scalarIndent = -1;
    }
    if (content === "" || content.startsWith("#") || content === "---") return;
    let column = indent;
    let rest = raw.slice(indent);
    while (rest === "-" || rest.startsWith("- ")) {
      while (stack.at(-1).indent > column || (stack.at(-1).indent === column && stack.at(-1).item)) stack.pop();
      const parent = stack.at(-1);
      parent.count = parent.itemIndent === column ? parent.count + 1 : 0;
      parent.itemIndent = column;
      const path = `${parent.path}/${parent.count}`;
      if (!index.has(path)) index.set(path, line);
      stack.push({indent: column, path, item: true});
      const after = rest.slice(1);
      const skip = after.length - after.trimStart().length;
      column += 1 + skip;
      rest = after.trimStart();
    }
    const key = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s"'#{[\]}:,][^:#]*?)\s*:(?:\s|$)/.exec(rest);
    if (!key) return;
    const name = key[1].startsWith('"') || key[1].startsWith("'") ? key[1].slice(1, -1) : key[1].trim();
    while (stack.at(-1).indent >= column) stack.pop();
    const path = `${stack.at(-1).path}/${name}`;
    if (!index.has(path)) index.set(path, line);
    stack.push({indent: column, path});
    if (/^[|>][-+0-9]*\s*(#.*)?$/.test(rest.slice(key[0].length).trim())) scalarIndent = column;
  });
  return index;
}

// the line of a path, or of the nearest enclosing path that has one
export function lineOf(index, path) {
  let current = `/${path}`;
  while (current) {
    if (index.has(current)) return index.get(current);
    current = current.slice(0, current.lastIndexOf("/"));
  }
  return 1;
}
