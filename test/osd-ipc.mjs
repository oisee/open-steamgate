import {expect} from "chai";
import {EventEmitter} from "node:events";
import {onIPCFailure, sendIPC} from "../tools/osd-ipc.mjs";

const channel = send => Object.assign(new EventEmitter(), {connected: true, send});

describe("IPC sends across a lost peer", () => {
  it("reports a synchronous broken pipe once and handles later channel errors", () => {
    const error = Object.assign(new Error("peer exited before disconnect arrived"), {code: "EPIPE"});
    const peer = channel(() => { throw error; });
    const failures = [], replies = [];
    const detach = onIPCFailure(peer, e => failures.push(e));
    sendIPC(peer, {work: "build"}, e => replies.push(e));
    detach();
    expect(() => peer.emit("error", error)).not.to.throw();
    sendIPC(peer, {work: "check"}, e => replies.push(e));
    expect(failures).to.deep.equal([error]);
    expect(replies).to.deep.equal([error, error]);
  });

  it("reports asynchronous send failure and rejects later sends without writing", async () => {
    let writes = 0;
    const error = Object.assign(new Error("pipe closed"), {code: "ERR_IPC_CHANNEL_CLOSED"});
    const peer = channel((message, callback) => { writes++; queueMicrotask(() => callback(error)); return true; });
    const failures = [];
    onIPCFailure(peer, e => failures.push(e));
    expect(await new Promise(resolve => sendIPC(peer, {work: "prime"}, resolve))).to.equal(error);
    expect(await new Promise(resolve => sendIPC(peer, {work: "update"}, resolve))).to.equal(error);
    expect(writes).to.equal(1);
    expect(failures).to.deep.equal([error]);
  });

  it("allows an error reply after serialization fails on a connected channel", () => {
    const peer = channel((message, callback) => { JSON.stringify(message); callback(); return true; });
    const failures = [];
    onIPCFailure(peer, error => failures.push(error));
    const cyclic = {}; cyclic.self = cyclic;
    let bad, replied = false;
    sendIPC(peer, cyclic, error => {
      bad = error;
      sendIPC(peer, {error: error.message}, next => { expect(next).to.equal(undefined); replied = true; });
    });
    expect(bad).to.be.instanceOf(TypeError);
    expect(replied).to.equal(true);
    expect(failures).to.deep.equal([]);
  });
});
