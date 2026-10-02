// What a session sees of $TMP and of every package below it
// (docs/adt-facade.md, "$TMP, the local package"): its own objects and
// sub-packages, and under $TMP itself also the local root packages of the
// system, which belong to nobody. Measured on A4H:
// test/fixtures/tmp-package/a4h.json.
const LOCAL_PACKAGE = "$TMP";

// whether a package hangs below $TMP, however deep
function underTmp(store, name) {
  if (typeof store.packages !== "function") return false;
  const byName = new Map(store.packages().map((p) => [p.name, p]));
  let at = byName.get(name)?.parent;
  for (let depth = 0; at !== undefined && depth < 64; depth++) {
    if (at === LOCAL_PACKAGE) return true;
    at = byName.get(at)?.parent;
  }
  return false;
}

export function localView(store, wanted, pkg, options = {}) {
  if (wanted !== LOCAL_PACKAGE) {
    // a package below $TMP is filtered the same way as $TMP: its objects and
    // its sub-packages are its authors' (no user, nothing). A package outside
    // $TMP is the system's and is answered whole.
    if (pkg.parent === undefined || !underTmp(store, wanted)) return pkg;
    const user = String(options.user ?? "").toUpperCase();
    const mine = (author) => user !== "" && author !== undefined && author === user;
    return {...pkg,
      objects: pkg.objects.filter((object) => mine(object.author)),
      subpackages: (pkg.subpackages ?? []).filter((child) => mine(store.authorOf("DEVC", child)))};
  }
  // $TMP is a package of the store now (tools/osd-tmp.mjs): what was created
  // in it, and the packages under it. On a system its tree also shows the
  // user's local packages that hang under nothing (measured on A4H,
  // test/fixtures/tmp-package/a4h.json), and every root package of ours is
  // such a package: local, and above nothing.
  // Which of them, though. Every root under $TMP means the default
  // favourite opens the whole system, substrate included -- seven packages
  // of somebody else's runtime above the one package a person is working
  // in. A real system puts its delivered code in the System Library and
  // keeps $TMP for local objects, so the library roots stay roots and only
  // the rest are shown here.
  //
  // OSD_LOCAL_PACKAGES overrides it with a comma list, for a tree where
  // the line falls somewhere else -- "$ZOSD_TEST" to show exactly one.
  const asked = (process.env.OSD_LOCAL_PACKAGES ?? "").split(",").map((s) => s.trim().toUpperCase()).filter((s) => s !== "");
  const roots = store.rootPackages()
    .filter((node) => node.name !== LOCAL_PACKAGE)
    .filter((node) => (asked.length > 0 ? asked.includes(node.name) : node.library !== true))
    .map((node) => node.name);
  // and of what is in it, the user's: the tree of $TMP on a system is the
  // logged-on user's unless the client names another (A4H). Always: a
  // caller that names no user sees nothing of $TMP's own, and an object or
  // package nobody is recorded as the author of -- a file put there by hand,
  // or a record that could not be read -- is nobody's to see in the tree
  // (it still opens by its URI). An ADT session always has a user: the
  // Basic one, or the system's own name for a logon without one, so an
  // anonymous session sees what was created anonymously and nothing else.
  const user = String(options.user ?? "").toUpperCase();
  const mine = (author) => user !== "" && author !== undefined && author === user;
  const objects = pkg.objects.filter((object) => mine(object.author));
  const owned = (pkg.subpackages ?? []).filter((child) => mine(store.authorOf("DEVC", child)));
  return {...pkg, description: pkg.description ?? "Local objects", objects,
    subpackages: [...new Set([...owned, ...roots])]};
}
