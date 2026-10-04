"use strict";
const {execFile} = require("node:child_process");

// Launcher children lead a process group on POSIX. Windows requires the
// operating system's tree kill: an IPC disconnect cannot interrupt a
// CPU-bound compiler. Dependencies are injectable for platform tests.
function killTree(child, signal, {platform = process.platform, kill = process.kill, taskkill = execFile} = {}) {
  if (platform === "win32") {
    return new Promise((resolve) => {
      taskkill("taskkill", ["/PID", String(child.pid), "/T", "/F"], {windowsHide: true}, () => resolve());
    });
  }
  try { kill(-child.pid, signal); }
  catch (error) {
    if (error.code !== "ESRCH") throw error;
    // Older callers may hand over a child without a dedicated group.
    child.kill(signal);
  }
  return Promise.resolve();
}
module.exports = {killTree};
