import {expect} from "chai";
import {createRequire} from "node:module";
const {killTree} = createRequire(import.meta.url)("../editors/vscode/process-tree.js");

describe("launcher shutdown kills a CPU-bound compiler's process tree", () => {
  it("signals the dedicated process group on POSIX, including escalation", async () => {
    const sent = [];
    for (const signal of ["SIGTERM", "SIGKILL"]) {
      await killTree({pid: 123, kill() { throw new Error("only the root was killed"); }}, signal,
        {platform: "linux", kill: (...args) => sent.push(args)});
    }
    expect(sent).to.deep.equal([[-123, "SIGTERM"], [-123, "SIGKILL"]]);
  });
  it("waits for taskkill /T /F on Windows (mocked)", async () => {
    let complete, command;
    let stopped = false;
    const stopping = killTree({pid: 123}, "SIGTERM", {platform: "win32",
      taskkill: (...args) => { command = args.slice(0, 3); complete = args[3]; }}).then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).to.equal(false);
    expect(command).to.deep.equal(["taskkill", ["/PID", "123", "/T", "/F"], {windowsHide: true}]);
    complete();
    await stopping;
    expect(stopped).to.equal(true);
  });
});
