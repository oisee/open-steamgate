// Pure repository-name policy shared by preflight and creation.
const OBJECT_NAME = /^(\/[A-Z0-9_]{1,10}\/)?[A-Z0-9_]{1,40}$/;
const PACKAGE_NAME = /^(\$|\/[A-Z0-9_]{1,10}\/)?[A-Z0-9_]{1,30}$/;

export function nameProblem(type, name) {
  const upper = String(name ?? "");
  if (upper !== upper.toUpperCase()) return `${type} ${name}: a repository name is upper case`;
  if (type === "SICF" && /^[A-Z0-9_ ]{15}[A-F0-9]{25}$/.test(upper)) return undefined;
  const ok = type === "DEVC" ? PACKAGE_NAME.test(upper) && upper.length <= 30 : OBJECT_NAME.test(upper);
  return ok ? undefined : `${type} "${name}" is not a repository name (A-Z, 0-9, _${type === "DEVC" ? ", a leading $" : ""}, an optional /NAMESPACE/)`;
}

// The folder mapping used by CREATE also constrains package preflight.
export function packageChildName(parent, name) {
  return parent === "$TMP" && name.startsWith("$") && !name.startsWith(parent + "_")
    || name.startsWith(parent + "_") && name.length > parent.length + 1;
}
