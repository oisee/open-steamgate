import {expect} from "chai";
import {createServer as createHttpServer} from "node:http";
import {connect} from "node:net";
import {
  decodeAdtRequest,
  decodeRfcLogon,
  decodeRfcFieldChain,
  encodeAdtCutResponse,
  encodeAdtHttpResponse,
  encodeRfcFieldChain,
  encodeUtf16le,
  parseAdtHttpRequest,
  wrapRfcResponse,
  unscrambleRfcPassword,
} from "../tools/protocols/rfc.mjs";
import {createRfcAdtServer} from "../tools/protocols/rfc-server.mjs";
import {encodeNIFrame, NIFrameDecoder} from "../tools/protocols/ni.mjs";
import {bxmlPayload, decodeBxml, encodeAdtBxmlResponse, encodeBxml, parseAdtBxmlRequest} from "../tools/protocols/bxml.mjs";
import {fieldInfoResponse} from "../tools/protocols/rfc-metadata.mjs";
import {closeProtocols, listenProtocols} from "../tools/protocols/server.mjs";

function cutRequest(xml, functionName = "SADT_REST_RFC_ENDPOINT") {
  const fields = [
    {tag: 0x000b, value: Buffer.from([0, 6, 0x37, 0, 0x35, 0])},
    {tag: 0x0102, value: encodeUtf16le(functionName)},
    {tag: 0x0512},
    {tag: 0x0205, value: encodeUtf16le("RESPONSE")},
    {tag: 0x3c02},
    {tag: 0x3c05, value: Buffer.from(xml)},
    {tag: 0x3c02},
    {tag: 0xffff},
  ];
  const chain = encodeRfcFieldChain(0x0502, fields);
  const total = 4 + chain.length + 10;
  const trailer = Buffer.alloc(10);
  trailer.writeUInt16BE(0xffff, 0);
  trailer.writeUInt16BE(total - 8, 4);
  trailer.writeUInt16BE(0x8500, 8);
  return Buffer.concat([Buffer.from([5, 2, 0, 0]), chain, trailer]);
}

function eclipseRequest(xml, functionName = "SADT_REST_RFC_ENDPOINT") {
  const fields = [
    {tag: 0x0101, value: Buffer.from([4, 2, 1, 5, 4, 1, 0, 2])},
    {tag: 0x0103, value: Buffer.from("00000e0b", "hex")},
    {tag: 0x0102, value: Buffer.from(functionName, "utf16le").swap16()},
    {tag: 0x0512},
    {tag: 0x0205, value: Buffer.from("RESPONSE", "utf16le").swap16()},
    {tag: 0x3c02},
    {tag: 0x3c05, value: Buffer.from(xml)},
    {tag: 0x3c02},
    {tag: 0xffff},
  ];
  const encoded = encodeRfcFieldChain(0, fields).subarray(2);
  const total = encoded.length + 10;
  const trailer = Buffer.alloc(10);
  trailer.writeUInt16BE(0xffff, 0);
  trailer.writeUInt16BE(total - 8, 4);
  trailer.writeUInt16BE(0x8500, 8);
  return Buffer.concat([encoded, trailer]);
}

function eclipseCompactRequest(document) {
  const fields = [
    {tag: 0x0101, value: Buffer.from([4, 2, 1, 5, 4, 1, 0, 2])},
    {tag: 0x0102, value: Buffer.from("SADT_REST_RFC_ENDPOINT", "utf16le").swap16()},
    {tag: 0x0512}, {tag: 0x0205, value: Buffer.from("RESPONSE", "utf16le").swap16()},
    {tag: 0x4000, value: Buffer.from([1, 0])}, {tag: 0x4001, value: document}, {tag: 0x4004}, {tag: 0xffff},
  ];
  const encoded = encodeRfcFieldChain(0, fields).subarray(2);
  const trailer = Buffer.alloc(10);
  trailer.writeUInt16BE(0xffff, 0); trailer.writeUInt16BE(encoded.length + 2, 4); trailer.writeUInt16BE(0x8500, 8);
  return Buffer.concat([encoded, trailer]);
}

function requestXml(path = "/sap/bc/adt/core/http/build", method = "GET") {
  return `<REQUEST><REQUEST_LINE><METHOD>${method}</METHOD><URI>${path}</URI><VERSION>HTTP/1.1</VERSION></REQUEST_LINE><HEADER_FIELDS><item><NAME>Accept</NAME><VALUE>*/*</VALUE></item><item><NAME>Authorization</NAME><VALUE>Bearer caller-token</VALUE></item></HEADER_FIELDS><MESSAGE_BODY></MESSAGE_BODY></REQUEST>`;
}

function appc(fn, length = 80) {
  const frame = Buffer.alloc(length);
  frame[0] = 6;
  frame[1] = fn;
  frame.writeUInt16BE(8, 26);
  frame[30] = 5;
  frame[31] = 0x0c;
  frame.write("00000001", 40, "ascii");
  return frame;
}

function dataRecord(cut) {
  const header = appc(0xcb);
  header.writeUInt16BE(7, 4);
  return Buffer.concat([header, cut]);
}

function logonPacket(passwordField = "150000008981dc9b914e", flavor = "probe") {
  const fields = [
    ...(flavor === "jco" ? [{tag: 0x0100, value: Buffer.from([1])}] : []),
    {tag: 0x0101}, {tag: 0x0103, value: Buffer.from("00000e09", "hex")},
    {tag: 0x0106, value: Buffer.from("04010003000a0200000023", "hex")}, {tag: 0x0337},
    {tag: 0x0514, value: Buffer.alloc(16, 7)}, {tag: 0x0114, value: Buffer.from("001")},
    {tag: 0x0111, value: Buffer.from("DEVELOPER")}, {tag: 0x0117, value: Buffer.from(passwordField, "hex")},
    {tag: 0x0115, value: Buffer.from("E")}, {tag: 0x0501, value: Buffer.from([1])},
    {tag: 0x0007, value: Buffer.from("127.0.0.1")}, {tag: 0x0018, value: Buffer.from("::1")},
    {tag: 0x0011, value: Buffer.from("E")}, {tag: 0x0012, value: Buffer.from("754")},
    {tag: 0x0013, value: Buffer.from("754")}, {tag: 0x0008, value: Buffer.from("test-host")},
    {tag: 0x0006, value: Buffer.from("TEST")}, {tag: 0x0130, value: Buffer.from("TEST")},
    {tag: 0x0502}, {tag: 0x000b, value: Buffer.from("754")}, {tag: 0x0102, value: Buffer.from("RFCPING")}, {tag: 0xffff},
  ];
  const selector = flavor === "jco" ? "0102" : "0301";
  const prefix = Buffer.from(`d9c6c3f0f0f0f0f0f0f0f0f001010008${selector}`, "hex");
  const chain = encodeRfcFieldChain(0x0101, fields);
  const trailer = Buffer.alloc(10);
  trailer.writeUInt16BE(0xffff, 0);
  trailer.writeUInt16BE(prefix.length + chain.length + 2, 4);
  trailer.writeUInt32BE(0x8500, 6);
  return Buffer.concat([prefix, chain, trailer]);
}

function responseXml(frame) {
  const cut = frame.subarray(80);
  expect(cut.subarray(0, 4).toString("hex")).to.equal("05000000");
  const chain = decodeRfcFieldChain(cut.subarray(4), 0x0500);
  return Buffer.concat(chain.fields.filter((field) => field.tag === 0x3c05).map((field) => field.value)).toString();
}

describe("the built-in MIT RFC-to-ADT bridge", () => {
  it("starts DIAG and RFC together without an external sidecar", async () => {
    const servers = await listenProtocols({INSTANCE: "11", STG_DIAG_PORT: "0", STG_RFC_PORT: "0", STG_PORT: "3030"});
    expect(servers.diag.address().port).to.be.greaterThan(0);
    expect(servers.rfc.address().port).to.be.greaterThan(0);
    const held = connect(servers.diag.address().port, "127.0.0.1");
    await new Promise((resolve, reject) => held.once("connect", resolve).once("error", reject));
    const heldClosed = new Promise((resolve) => held.once("close", resolve));
    await closeProtocols(servers, {graceMs: 10});
    await heldClosed;
    expect(held.destroyed).to.equal(true);
  });

  it("closes SADT DDIC metadata over IHTTPNVP_TAB when ALL_TYPES is requested", () => {
    const cut = fieldInfoResponse({
      requestedOutputs: ["DDOBJTYPE"],
      imports: new Map([
        ["TABNAME", encodeUtf16le("SADT_REST_REQUEST", 30)],
        ["ALL_TYPES", encodeUtf16le("X", 1)],
      ]),
      tables: [{name: "DFIES_TAB", id: Buffer.from([0, 0, 0, 2]), rowLength: 1338, rows: []}],
      eclipse: true,
      sessionGUID: Buffer.alloc(16, 7),
    });
    const chain = decodeRfcFieldChain(cut.subarray(4), 0x0500);
    const outputs = chain.fields.filter((field) => field.tag === 0x0205).map((field) => field.value.toString("utf16le"));
    const xml = Buffer.concat(chain.fields.filter((field) => field.tag === 0x3c05).map((field) => field.value)).toString();
    expect(outputs).to.deep.equal(["DDOBJTYPE", "LINES_DESCR"]);
    expect(xml).to.include("<TYPENAME>IHTTPNVP</TYPENAME><TYPEKIND>STRU</TYPEKIND>");
    expect(xml).to.include("<TYPENAME>IHTTPNVP_TAB</TYPENAME><TYPEKIND>TTYP</TYPEKIND>");
    expect(xml).to.include("<ROLLNAME>IHTTPNVP</ROLLNAME>");
    expect(xml).to.include("<AUTHORID>TKN</AUTHORID>");
    expect(chain.fields.filter((field) => field.tag === 0x0303)).to.have.length(6);
  });

  it("decodes the bounded classic xRFC request profile", () => {
    const decoded = decodeAdtRequest(cutRequest(requestXml("/sap/bc/adt/discovery")));
    expect(decoded.functionName).to.equal("SADT_REST_RFC_ENDPOINT");
    expect(parseAdtHttpRequest(decoded.xml)).to.deep.include({method: "GET", url: "/sap/bc/adt/discovery"});
    const eclipse = decodeAdtRequest(eclipseRequest(requestXml("/sap/bc/adt/discovery")));
    expect(eclipse).to.include({functionName: "SADT_REST_RFC_ENDPOINT", eclipse: true});
    expect(parseAdtHttpRequest(eclipse.xml)).to.deep.include({method: "GET", url: "/sap/bc/adt/discovery"});
  });

  it("decodes and writes Eclipse compact BXML without treating bodies as text", () => {
    const leaf = (name, text) => ({name, text});
    const document = encodeBxml({name: "REQUEST", children: [
      {name: "REQUEST_LINE", children: [leaf("METHOD", "POST"), leaf("URI", "/sap/bc/adt/test"), leaf("VERSION", "HTTP/1.1")]},
      {name: "HEADER_FIELDS", children: [{name: "IHTTPNVP", children: [leaf("NAME", "Content-Type"), leaf("VALUE", "application/octet-stream")]}]},
      {name: "MESSAGE_BODY", body: Buffer.from([0, 0xff, 1])},
    ]});
    const call = decodeAdtRequest(eclipseCompactRequest(document));
    const request = parseAdtBxmlRequest(call.compact);
    expect(request).to.deep.include({method: "POST", url: "/sap/bc/adt/test", version: "HTTP/1.1"});
    expect(request.body.equals(Buffer.from([0, 0xff, 1]))).to.equal(true);
    const response = bxmlPayload(decodeBxml(encodeAdtBxmlResponse({status: 200, reason: "OK", body: Buffer.from([0xfe, 0])})));
    expect(response.name).to.equal("RESPONSE");
    expect(response.children.find((node) => node.name === "MESSAGE_BODY").body.equals(Buffer.from([0xfe, 0]))).to.equal(true);
  });

  it("keeps RFC logon bytes binary until their declared fields are decoded", () => {
    const logon = decodeRfcLogon(logonPacket());
    expect(logon).to.include({client: "001", user: "DEVELOPER", language: "E"});
    expect(logon.passwordField.toString("hex")).to.equal("150000008981dc9b914e");
    expect(unscrambleRfcPassword(logon.passwordField)).to.equal("secret");
    expect(decodeRfcLogon(logonPacket(undefined, "jco"))).to.include({client: "001", user: "DEVELOPER", language: "E"});
  });

  it("rejects tunneled authority escapes and header injection", () => {
    expect(() => parseAdtHttpRequest(requestXml("//outside.test/adt"))).to.throw("request line");
    const bad = requestXml().replace("*/*", "ok&#10;Injected: yes");
    expect(() => parseAdtHttpRequest(bad)).to.throw("header");
  });

  it("fails startup when either authentication boundary is incomplete", () => {
    expect(() => createRfcAdtServer({backend: "http://127.0.0.1:3030", port: 0, rfcAuthMode: "static"}))
      .to.throw("STG_RFC_USER and STG_RFC_PASSWORD");
    expect(() => createRfcAdtServer({backend: "http://127.0.0.1:3030", port: 0, backendPassword: "orphan"}))
      .to.throw("STG_ADT_USER");
  });

  it("encodes a classic response and its gateway APPC envelope", () => {
    const xml = encodeAdtHttpResponse({status: 200, reason: "OK", headers: [["Content-Type", "text/plain"]], body: Buffer.from("hello")});
    const cut = encodeAdtCutResponse(xml);
    const request = appc(0xcb);
    request.writeUInt16BE(23, 4);
    request.writeUInt16BE(9, 78);
    const record = wrapRfcResponse(cut, request);
    expect(record.subarray(40, 48).toString()).to.equal("00000001");
    expect(record.readUInt16BE(4)).to.equal(23);
    expect(record.readUInt16BE(78)).to.equal(9);
    expect(responseXml(record)).to.equal(xml);
  });

  it("rejects a wrong RFC password before contacting the ADT backend", async () => {
    let backendRequests = 0;
    const backend = createHttpServer((_request, response) => {
      backendRequests++;
      response.end();
    });
    await new Promise((resolve, reject) => backend.once("error", reject).listen(0, "127.0.0.1", resolve));
    let reportFailure;
    const rejected = new Promise((resolve) => { reportFailure = resolve; });
    const bridge = createRfcAdtServer({
      backend: `http://127.0.0.1:${backend.address().port}`,
      rfcAuthMode: "static", rfcUser: "DEVELOPER", rfcPassword: "secret", rfcClient: "001",
      host: "127.0.0.1", port: 0, timeoutMs: 2000,
      log: (event) => { if (event.error) reportFailure(event.error); },
    });
    await bridge.listen();
    const socket = connect(bridge.server.address().port, "127.0.0.1");
    socket.on("error", () => {});
    try {
      await new Promise((resolve, reject) => socket.once("connect", resolve).once("error", reject));
      const gateway = Buffer.alloc(64);
      const init = appc(0x01, 453);
      init.writeUInt16BE(3, 76);
      for (const frame of [gateway, init, appc(0x0f, 224), appc(0x05), dataRecord(logonPacket("150000008981dc9b914f"))]) {
        socket.write(encodeNIFrame(frame));
      }
      expect(await rejected).to.equal("RFC authentication failed");
      expect(backendRequests).to.equal(0);
    } finally {
      socket.destroy();
      await Promise.all([
        new Promise((resolve) => bridge.server.close(resolve)),
        new Promise((resolve) => backend.close(resolve)),
      ]);
    }
  });

  it("forwards two calls and keeps backend cookies per RFC connection", async () => {
    let calls = 0;
    let probes = 0;
    const backend = createHttpServer((request, response) => {
      expect(request.headers.authorization).to.equal(`Basic ${Buffer.from("BACKEND:secret").toString("base64")}`);
      expect(new URL(request.url, "http://backend").searchParams.get("sap-client")).to.equal("777");
      expect(new URL(request.url, "http://backend").searchParams.get("sap-language")).to.equal("DE");
      if (request.url.startsWith("/sap/bc/adt/core/discovery")) {
        probes++;
        expect(request.headers["x-csrf-token"]).to.equal("fetch");
        response.setHeader("Set-Cookie", "bridge-cookie=present; Path=/; HttpOnly");
        response.setHeader("X-CSRF-Token", `token-${probes}`);
        response.end();
        return;
      }
      calls++;
      expect(request.headers.cookie).to.equal("bridge-cookie=present");
      if (calls === 1) {
        expect(request.headers["x-csrf-token"]).to.equal("token-1");
        response.statusCode = 403;
        response.setHeader("X-CSRF-Token", "Required");
        response.end("stale");
        return;
      }
      expect(request.headers["x-csrf-token"]).to.equal(calls === 2 ? "token-2" : "token-rotated");
      if (calls === 2) response.setHeader("X-CSRF-Token", "token-rotated");
      response.setHeader("Content-Type", "text/plain");
      response.end(`answer-${calls - 1}`);
    });
    await new Promise((resolve, reject) => backend.once("error", reject).listen(0, "127.0.0.1", resolve));
    const bridge = createRfcAdtServer({
      backend: `http://127.0.0.1:${backend.address().port}`,
      backendUser: "BACKEND", backendPassword: "secret", backendClient: "777", backendLanguage: "DE",
      rfcAuthMode: "static", rfcUser: "DEVELOPER", rfcPassword: "secret", rfcClient: "001",
      host: "127.0.0.1", port: 0, timeoutMs: 2000,
    });
    await bridge.listen();
    const socket = connect(bridge.server.address().port, "127.0.0.1");
    const decoder = new NIFrameDecoder();
    const received = [];
    socket.on("data", (chunk) => received.push(...decoder.push(chunk)));
    const waitFor = (count) => new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error(`timed out waiting for ${count} RFC frames`)), 2000);
      const poll = () => received.length >= count ? (clearTimeout(deadline), resolve()) : setTimeout(poll, 5);
      poll();
    });
    try {
      await new Promise((resolve, reject) => socket.once("connect", resolve).once("error", reject));
      const gateway = Buffer.alloc(64);
      const init = appc(0x01, 453);
      init.writeUInt16BE(3, 76);
      const partner = appc(0x0f, 224);
      const allocate = appc(0x05);
      const logon = dataRecord(logonPacket());
      for (const frame of [gateway, init, partner, allocate, logon]) socket.write(encodeNIFrame(frame));
      await waitFor(4);
      expect(received.map((frame) => frame.length)).to.deep.equal([64, 80, 80, 746]);
      const capabilityMarker = Buffer.from([0x01, 0x06, 0x00, 0x0b]);
      const capabilityAt = received[3].indexOf(capabilityMarker);
      expect(received[3].subarray(capabilityAt + 4, capabilityAt + 15).toString("hex")).to.equal("0401000301030200000023");

      socket.write(encodeNIFrame(dataRecord(cutRequest(requestXml("/first", "POST")))));
      await waitFor(5);
      expect(responseXml(received[4])).to.include("YW5zd2VyLTE=");

      socket.write(encodeNIFrame(dataRecord(cutRequest(requestXml("/second", "POST")))));
      await waitFor(6);
      expect(responseXml(received[5])).to.include("YW5zd2VyLTI=");
      expect(calls).to.equal(3);
      expect(probes).to.equal(2);
    } finally {
      socket.destroy();
      await Promise.all([
        new Promise((resolve) => bridge.server.close(resolve)),
        new Promise((resolve) => backend.close(resolve)),
      ]);
    }
  });
});
