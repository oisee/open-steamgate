import {expect} from "chai";
import {acceptKey, frame, unframe, ProtocolError} from "../tools/osd-apc.mjs";
import {randomBytes} from "node:crypto";

// The websocket half of a push channel. The framing is written out here
// rather than taken from a package, so it is tested rather than trusted.
describe("tools/osd-apc: frames, and the handshake that starts them", () => {

  // RFC 6455 §1.3's own example. It exists so a server cannot answer a
  // handshake by accident, which makes it the one value worth pinning.
  it("the accept key is the one the standard's example gives", () => {
    expect(acceptKey("dGhlIHNhbXBsZSBub25jZQ==")).to.equal("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
  });

  // A client frame, out of a server one: set the mask bit, insert the key,
  // and mask the payload alone. The header is two, four or ten bytes
  // depending on the length, and an earlier version of this helper assumed
  // two — so it masked the length bytes of a long frame and the reader
  // rightly refused what came out. The helper was wrong, not the reader.
  const mask = (buffer) => {
    const length = buffer[1] & 0x7f;
    const header = length < 126 ? 2 : (length === 126 ? 4 : 10);
    const key = randomBytes(4);
    const body = Buffer.from(buffer.subarray(header));
    for (let i = 0; i < body.length; i = i + 1) {
      body[i] = body[i] ^ key[i % 4];
    }
    const head = Buffer.from(buffer.subarray(0, header));
    head[1] = head[1] | 0x80;
    return Buffer.concat([head, key, body]);
  };

  it("a frame written and read back is the text that went in", () => {
    const text = "the quick brown fox";
    expect(unframe(mask(frame(text))).payload.toString()).to.equal(text);
  });

  // the three length encodings, because a client only has to understand the
  // shortest one that fits and a server that always writes the longest is
  // still wrong when it writes the wrong one
  for (const size of [1, 125, 126, 200, 65535, 65536, 70000]) {
    it(`a payload of ${size} bytes survives the round trip`, () => {
      const text = "x".repeat(size);
      expect(unframe(mask(frame(text))).payload.toString()).to.equal(text);
    });
  }

  it("unmasking is its own inverse, so the payload is not the masked bytes", () => {
    const masked = mask(frame("secret"));
    expect(masked.includes(Buffer.from("secret"))).to.equal(false);
    expect(unframe(masked).payload.toString()).to.equal("secret");
  });

  // a socket delivers bytes, not messages: half a frame must be waited for
  // rather than guessed at
  it("half a frame is not a frame, and says so by returning nothing", () => {
    const whole = mask(frame("hello world"));
    expect(unframe(whole.subarray(0, whole.length - 3))).to.equal(undefined);
    expect(unframe(whole).payload.toString()).to.equal("hello world");
  });

  it("two frames in one chunk are read one at a time, with the rest kept", () => {
    const both = Buffer.concat([mask(frame("one")), mask(frame("two"))]);
    const first = unframe(both);
    expect(first.payload.toString()).to.equal("one");
    expect(unframe(first.rest).payload.toString()).to.equal("two");
  });

  it("a server frame is never masked, which is what a client requires", () => {
    expect((frame("x")[1] & 0x80)).to.equal(0);
  });

  it("the opcode survives, so a close is not read as text", () => {
    expect(unframe(mask(frame("bye", 0x8))).opcode).to.equal(0x8);
  });

  // refusing is the point: a length this host cannot address would otherwise
  // be truncated into a frame boundary somewhere else in the stream
  it("a frame longer than this host can carry is refused, not truncated", () => {
    const head = Buffer.alloc(10);
    head[0] = 0x81;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 2);
    expect(() => unframe(head)).to.throw(ProtocolError);
  });
});
