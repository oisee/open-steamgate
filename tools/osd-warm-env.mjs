// A compiler needs host dispatch, source selection and OS paths, never logon,
// database or bridge credentials. Keep arbitrary inherited secrets out too.
const allowed = new Set([
  "PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT",
  "HOME", "USERPROFILE", "LOCALAPPDATA", "XDG_DATA_HOME", "TMPDIR", "TMP", "TEMP",
  "LANG", "LC_ALL", "TZ", "CI", "NODE_OPTIONS",
  "OSD_SELF", "OSD_PACKS", "OSD_LAYERS", "OSD_WEB_PACKS", "OSD_DIR_LINK",
]);
export function compilerEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => allowed.has(key) || /^OSD_LIB_[A-Z0-9_]+$/.test(key)));
}
