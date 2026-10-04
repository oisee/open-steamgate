#!/usr/bin/env node
import {main} from "../docker/vsix-bare/smoke.mjs";

main().catch(error => {
  console.error(`vsix-bare: ${error.message}`);
  process.exitCode = 1;
});
