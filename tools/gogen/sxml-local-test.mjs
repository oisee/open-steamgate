// Guard the global class's local XML parser against being dropped from the
// frontend program. This test needs only the locally cloned core sources.
import assert from "node:assert/strict";
import {join} from "node:path";
import {compileProgram} from "./frontend.mjs";
import {home} from "./home.mjs";

const program = compileProgram({
  folders: [join(home, ".local/lars/open-abap-core/src")],
  objects: ["CL_SXML_STRING_READER"],
  tolerant: true,
});
const parser = program.classes.find((c) => c.name === "CL_SXML_STRING_READER:LCL_XML_PARSER");
assert.ok(parser, "CL_SXML_STRING_READER:LCL_XML_PARSER must be in the program");
assert.ok(parser.methods.some((m) => m.name === "NEXT"), "the XML parser's NEXT method must compile");
console.log("sXML local parser present with NEXT");
