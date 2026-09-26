import {requireSupportedNode} from "./osd-node-version.mjs";

try {
  requireSupportedNode(process.versions.node, "osd-node-check: ");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
