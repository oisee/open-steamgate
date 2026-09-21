import {expect} from "chai";
import {connect} from "node:net";
import {
  buildDiagTapeScreen, DIAG_ATOM, DIAG_HEADER_LENGTH, DIAG_ITEM,
  encodeDiagFrame, encodeDiagHeader, encodeDiagItem, encodeDiagLabel, encodeDiagMessage,
} from "../tools/protocols/diag.mjs";
import {createDiagTapeServer} from "../tools/protocols/diag-server.mjs";
import {encodeNIFrame, NIFrameDecoder, NI_PING, NI_PONG} from "../tools/protocols/ni.mjs";

function findAppl4(body, wantedID, wantedSID) {
  let offset = 0;
  const fixed = new Map([[DIAG_ITEM.SES, 16], [DIAG_ITEM.EOM, 0]]);
  while (offset < body.length) {
    const type = body[offset];
    if (type === DIAG_ITEM.APPL || type === DIAG_ITEM.APPL4) {
      const lengthBytes = type === DIAG_ITEM.APPL ? 2 : 4;
      const length = lengthBytes === 2 ? body.readUInt16BE(offset + 3) : body.readUInt32BE(offset + 3);
      const start = offset + 3 + lengthBytes;
      if (type === DIAG_ITEM.APPL4 && body[offset + 1] === wantedID && body[offset + 2] === wantedSID) {
        return body.subarray(start, start + length);
      }
      offset = start + length;
      continue;
    }
    if (type === DIAG_ITEM.XML) {
      const length = body.readUInt32BE(offset + 1);
      offset += 5 + length;
      continue;
    }
    if (!fixed.has(type)) throw new Error(`test parser found unknown item ${type.toString(16)}`);
    offset += 1 + fixed.get(type);
  }
  return null;
}

describe("the built-in MIT DIAG tape stub", () => {
  it("encodes the eight-byte uncompressed DIAG header", () => {
    expect(encodeDiagHeader({comFlag: 0x10, msgInfo: 1}).toString("hex")).to.equal("0010000000010000");
    expect(() => encodeDiagHeader({msgInfo: 256})).to.throw(RangeError);
  });

  it("encodes APPL and APPL4 lengths in network order", () => {
    expect(encodeDiagItem({type: DIAG_ITEM.APPL, id: 9, sid: 2, value: Buffer.from("abc")}).toString("hex"))
      .to.equal("1009020003616263");
    expect(encodeDiagItem({type: DIAG_ITEM.APPL4, id: 9, sid: 2, value: Buffer.from("abc")}).toString("hex"))
      .to.equal("12090200000003616263");
  });

  it("builds frame and label atoms without captured bytes", () => {
    const frame = encodeDiagFrame({row: 1, col: 1, width: 78, height: 22});
    const label = encodeDiagLabel({row: 20, col: 3, text: "R Tape loading error, 0:1"});
    expect(frame.readUInt16BE(0)).to.equal(frame.length);
    expect(frame[4]).to.equal(DIAG_ATOM.FRAME);
    expect(label.readUInt16BE(0)).to.equal(label.length);
    expect(label[4]).to.equal(DIAG_ATOM.LABEL);
    expect(label.subarray(19).toString("latin1")).to.equal("R Tape loading error, 0:1");
    expect(() => encodeDiagLabel({row: 0, col: 0, text: "привет"})).to.throw(RangeError);
  });

  it("builds a complete screen with generated DYNT atoms", () => {
    const message = buildDiagTapeScreen();
    expect(message).to.have.length.greaterThan(DIAG_HEADER_LENGTH);
    expect(message[5]).to.equal(1);
    expect(message[7]).to.equal(0);
    const dynt = findAppl4(message.subarray(DIAG_HEADER_LENGTH), 0x09, 0x02);
    expect(dynt).to.be.instanceOf(Buffer);
    expect(dynt[4]).to.equal(DIAG_ATOM.FRAME);
    const second = dynt.readUInt16BE(0);
    expect(dynt[second + 4]).to.equal(DIAG_ATOM.LABEL);
    expect(dynt.includes(Buffer.from("Tape loading error", "ascii"))).to.equal(true);
  });

  it("answers fragmented client traffic and NI keepalives over TCP", async () => {
    const server = createDiagTapeServer({holdMs: 60_000});
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const socket = connect(server.address().port, "127.0.0.1");
    const decoder = new NIFrameDecoder();
    const received = [];
    socket.on("data", (chunk) => received.push(...decoder.push(chunk)));
    const waitForFrames = (count) => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`timed out waiting for ${count} DIAG responses`)), 2000);
      const poll = () => {
        if (received.length >= count) {
          clearTimeout(timeout);
          resolve();
        } else setTimeout(poll, 5);
      };
      poll();
    });
    try {
      await new Promise((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });
      const hello = Buffer.alloc(215);
      hello.fill(0xff, 0, 4);
      hello[201] = 0x10;
      hello[208] = DIAG_ITEM.APPL;
      hello[209] = 0x04;
      hello[210] = 0x27;
      hello.writeUInt16BE(2, 211);
      hello.write("EN", 213, "ascii");
      const wire = Buffer.concat([encodeNIFrame(NI_PING), encodeNIFrame(hello)]);
      socket.write(wire.subarray(0, 3));
      socket.write(wire.subarray(3));
      await waitForFrames(2);
      expect(received[0].equals(NI_PONG)).to.equal(true);
      expect(received[1].includes(Buffer.from("Tape loading error", "ascii"))).to.equal(true);

      socket.write(encodeNIFrame(encodeDiagMessage({}, [{type: DIAG_ITEM.EOM}])));
      await waitForFrames(3);
      expect(received[2].equals(received[1])).to.equal(true);

      const exit = encodeDiagMessage({}, [
        {type: DIAG_ITEM.APPL, id: 0x0c, sid: 0x04, value: Buffer.from("/i", "ascii")},
        {type: DIAG_ITEM.EOM},
      ]);
      socket.write(encodeNIFrame(exit));
      await waitForFrames(4);
      expect(received[3].toString("hex")).to.equal("000a000000010000");
    } finally {
      socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("rejects a junk hello instead of answering it", async () => {
    const events = [];
    const server = createDiagTapeServer({logger: (...event) => events.push(event), holdMs: 60_000});
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const socket = connect(server.address().port, "127.0.0.1");
    try {
      await new Promise((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });
      socket.write(encodeNIFrame(Buffer.alloc(208)));
      await new Promise((resolve) => socket.once("close", resolve));
      expect(events.some(([name]) => name === "protocol-error")).to.equal(true);
    } finally {
      socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
