import {packAt} from "../../tools/osd-packs.mjs";
import {join} from "node:path";

/** The image contains only packs explicitly selected at build time. */
export function imagePacks(root, value = "") {
  if (value === "") return [];
  const names = value.split(",").map((name) => name.trim());
  if (names.some((name) => !/^[a-z0-9][a-z0-9-]*$/.test(name))) {
    throw new Error(`Invalid OSD_IMAGE_PACKS: ${value}`);
  }
  if (new Set(names).size !== names.length) throw new Error(`Duplicate OSD_IMAGE_PACKS: ${value}`);
  return names.map((name) => {
    const pack = packAt(root, join(root, "packs", name));
    if (pack?.name !== name) throw new Error(`Unknown OSD_IMAGE_PACKS pack: ${name}`);
    return pack;
  });
}
