import {expect} from "chai";
import {
  DEFAULT_NI_MAX_PAYLOAD, NIError, NIFrameDecoder, NI_PING, NI_PONG,
  encodeNIFrame, niControl,
} from "../tools/protocols/ni.mjs";

const hex = (value) => Buffer.from(value).toString("hex");

describe("the built-in MIT NI framing", () => {
  it("writes the four-byte big-endian payload length", () => {
    expect(hex(encodeNIFrame(Buffer.from("RFC")))).to.equal("00000003524643");
    expect(hex(encodeNIFrame(Buffer.alloc(0)))).to.equal("00000000");
  });

  it("does not alias the caller's payload", () => {
    const payload = Buffer.from("RFC");
    const frame = encodeNIFrame(payload);
    payload.fill(0);
    expect(hex(frame)).to.equal("00000003524643");
  });

  it("decodes fragmented prefixes and coalesced frames in wire order", () => {
    const wire = Buffer.concat([encodeNIFrame(Buffer.from("first")), encodeNIFrame(Buffer.from("second"))]);
    const decoder = new NIFrameDecoder();
    const frames = [];
    for (const byte of wire) frames.push(...decoder.push(Buffer.from([byte])));
    decoder.finish();
    expect(frames.map(String)).to.deep.equal(["first", "second"]);
    expect(decoder.bufferedBytes).to.equal(0);
  });

  it("is length-driven when payload bytes resemble another prefix", () => {
    const payload = Buffer.from("0000000352464300", "hex");
    const decoder = new NIFrameDecoder();
    expect(decoder.push(encodeNIFrame(payload)).map(hex)).to.deep.equal([hex(payload)]);
  });

  it("retains an incomplete frame and reports a truncated stream", () => {
    const decoder = new NIFrameDecoder({maxPayloadLength: 4096});
    expect(decoder.push(Buffer.from("0000000352", "hex"))).to.deep.equal([]);
    expect(decoder.bufferedBytes).to.equal(5);
    expect(() => decoder.finish()).to.throw(NIError).with.property("code", "NI_TRUNCATED_STREAM");
  });

  it("fails closed before accepting a peer-controlled oversized payload", () => {
    const decoder = new NIFrameDecoder({maxPayloadLength: 4});
    expect(() => decoder.push(Buffer.from("00000005", "hex"))).to.throw(NIError).with.property("code", "NI_PAYLOAD_TOO_LARGE");
    expect(() => decoder.push(Buffer.alloc(0))).to.throw(NIError).with.property("code", "NI_PAYLOAD_TOO_LARGE");
    decoder.reset();
    expect(decoder.push(Buffer.from("0000000461626364", "hex")).map(String)).to.deep.equal(["abcd"]);
  });

  it("accepts an empty payload when the configured maximum is zero", () => {
    const decoder = new NIFrameDecoder({maxPayloadLength: 0});
    const frames = decoder.push(Buffer.alloc(4));
    expect(frames).to.have.length(1);
    expect(frames[0]).to.have.length(0);
  });

  it("rejects invalid limits and non-byte inputs", () => {
    expect(() => new NIFrameDecoder({maxPayloadLength: -1})).to.throw(NIError).with.property("code", "NI_INVALID_LIMIT");
    expect(() => new NIFrameDecoder({maxPayloadLength: DEFAULT_NI_MAX_PAYLOAD + 0.5})).to.throw(NIError);
    expect(() => encodeNIFrame("RFC")).to.throw(TypeError);
  });

  it("recognises only exact NI keepalive controls", () => {
    expect(niControl(NI_PING)).to.equal("NI_PING");
    expect(niControl(NI_PONG)).to.equal("NI_PONG");
    expect(niControl(Buffer.from("NI_PING"))).to.equal(null);
    expect(niControl(Buffer.from("NI_PING\0extra"))).to.equal(null);
  });
});
