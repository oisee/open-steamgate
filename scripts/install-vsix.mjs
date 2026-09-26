// Build and install the packaged VS Code extension in one command.
import {execFileSync} from "node:child_process";
import {buildVsix} from "./build-vsix.mjs";

const {out} = await buildVsix();
execFileSync("code", ["--install-extension", out, "--force"], {stdio: "inherit"});
