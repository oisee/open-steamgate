import {createServer} from "node:http";
import {expect} from "chai";
import {deliverAmcPublication, mountChannels} from "../tools/osd-apc.mjs";
import {AmcBroker, amcChannels, callerProgram, installAmc, parseSamc} from "../tools/osd-amc.mjs";
import {dialogStep} from "../tools/osd-dialog-step.mjs";
import {readFileSync} from "node:fs";

describe("AMC in one Node process", function () {
  this.timeout(30000);

  it("reads SAMC channels and exact send/receive authorisations", () => {
    const xml = readFileSync("src/amc/zstg_amc_test.samc.xml", "utf8");
    const rows = parseSamc(xml, "fixture");
    expect(rows.map((row) => [row.path, row.type, row.scope]))
      .to.deep.equal([["/binary", "BINARY", "C"], ["/denied", "TEXT", "C"],
        ["/pcp", "PCP", "C"], ["/text", "TEXT", "C"]]);
    const broker = new AmcBroker(rows);
    const sender = "ZCL_OSD_AMC_TEST==============CP";
    expect(() => broker.send({app: "ZOSD_AMC_TEST", path: "/denied", program: sender, type: "TEXT", message: "no"}))
      .to.throw("not authorised");
    expect(() => broker.send({app: "ZOSD_AMC_TEST", path: "/missing", program: sender, type: "TEXT", message: "no"}))
      .to.throw("not defined");
    expect(() => broker.subscribe({app: "ZOSD_AMC_TEST", path: "/missing", program: sender, receive: () => {}}))
      .to.throw("not defined");
    expect(() => broker.subscribe({app: "ZOSD_AMC_TEST", path: "/text", program: "ZCL_UNKNOWN===================CP", receive: () => {}}))
      .to.throw("not authorised");
    expect(amcChannels().find((row) => row.path === "/text")).to.include({applicationId: "ZOSD_AMC_TEST"});
    expect(callerProgram("at x (/tmp/zcl_osd_amc_test.clas.testclasses.mjs:1:1)"))
      .to.equal(sender);
  });

  it("reads abapGit SAMC with BOM, TEXT, numbered authorities, and sorted channels", () => {
    for (const [file, app, paths, authorityCount] of [
      ["src/amc/zstg_amc_test.samc.xml", "ZOSD_AMC_TEST", ["/binary", "/denied", "/pcp", "/text"], 7],
      ["docs/probes/abap-daemons/zosd_t_amc.serialized.samc.xml", "ZOSD_T_AMC", ["/pc", "/ps", "/pu"], 5],
    ]) {
      const xml = readFileSync(file, "utf8");
      expect(xml.charCodeAt(0), file).to.equal(0xfeff);
      expect(xml).to.include("<TEXT>");
      expect(xml).to.include("<NR>1</NR>");
      const channels = parseSamc(xml, file);
      expect(channels.map((row) => row.path), file).to.deep.equal(paths);
      expect(channels.every((row) => row.applicationId === app && row.authorities.length === authorityCount), file).to.equal(true);
      expect(channels[0].authorities.map((row) => row.path), file)
        .to.deep.equal(app === "ZOSD_AMC_TEST"
          ? ["/text", "/text", "/text", "/binary", "/binary", "/pcp", "/pcp"]
          : ["/pc", "/pc", "/pc", "/pu", "/ps"]);
      const broker = new AmcBroker(channels);
      const allowed = app === "ZOSD_AMC_TEST" ? "ZCL_OSD_AMC_TEST==============CP" : "ZCL_OSD_T_DMN=================CP";
      expect(() => broker.channel(app, paths[0], "S", allowed), file).not.to.throw();
      if (app === "ZOSD_T_AMC") {
        expect(channels[0].authorities[2]).to.deep.equal({path: "/pc", program: "ZOSD_T_DSUB", activity: "S"});
        expect(() => broker.channel(app, "/pc", "S", "ZOSD_T_DSUB")).not.to.throw();
      } else {
        expect(channels[0].authorities[2]).to.deep.equal({
          path: "/text", program: "ZCL_OSD_AMC_SOCKET============CP", activity: "R",
        });
      }
    }
  });

  it("delivers client and user scopes only to matching subscriptions, system to all", () => {
    const program = "ZCL_OSD_AMC_TEST==============CP";
    const channels = ["C", "U", "S"].map((scope) => ({
      applicationId: "SCOPE", path: `/${scope.toLowerCase()}`, type: "TEXT", scope,
      authorities: [{path: `/${scope.toLowerCase()}`, program, activity: "S"},
        {path: `/${scope.toLowerCase()}`, program, activity: "R"}],
    }));
    const broker = new AmcBroker(channels);
    for (const [scope, expected] of [["C", ["same", "other user"]],
      ["U", ["same"]], ["S", ["same", "other user", "other client"]]]) {
      const received = [];
      for (const [label, client, username] of [["same", "123", "ALICE"],
        ["other user", "123", "BOB"], ["other client", "456", "ALICE"]]) {
        broker.subscribe({app: "SCOPE", path: `/${scope.toLowerCase()}`, program,
          client, username, receive: () => received.push(label)});
      }
      broker.send({app: "SCOPE", path: `/${scope.toLowerCase()}`, program,
        type: "TEXT", message: "one", client: "123", username: "ALICE"});
      expect(received, `${scope} scope`).to.deep.equal(expected);
    }
  });

  it("does not write an AMC PCP frame when the socket closes during serialization", async () => {
    let finish;
    let closed = false;
    const written = [];
    const publication = {type: "PCP", message: {
      if_ac_message_type_pcp$serialize: () => new Promise((resolve) => { finish = resolve; }),
    }};
    const delivery = deliverAmcPublication(publication, () => closed, (frame) => written.push(frame));
    closed = true;
    finish({get: () => "late"});
    await delivery;
    expect(written).to.deep.equal([]);
  });

  it("delivers 1000 ordered ABAP SENDs from an HTTP step to a bound real websocket", async () => {
    const {initializeABAP} = await import("../output/init.mjs");
    const Host = (await import("../output/zcl_apc_host.clas.mjs")).zcl_apc_host;
    const Sender = (await import("../output/zcl_osd_amc_test.clas.mjs")).zcl_osd_amc_test;
    await import("../output/zcl_osd_amc_socket.clas.mjs");
    await initializeABAP();
    const abap = globalThis.abap;
    const server = createServer((req, res) => {
      if (req.url !== "/emit") { res.writeHead(404).end(); return; }
      dialogStep(() => Sender.send_many({iv_count: new abap.types.Integer().set(1000)}))
        .then(() => res.writeHead(204).end())
        .catch((error) => res.writeHead(500).end(String(error?.reason?.get?.() ?? error)));
    });
    mountChannels(server, [{
      path: "/ws-amc", name: "ZOSD_AMC_TEST", handler: "ZCL_OSD_AMC_SOCKET", stateful: false,
    }], {host: Host, log: (line) => { throw new Error(line); }});
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws-amc`);
    const messages = [];
    let wake;
    socket.addEventListener("message", (event) => {
      messages.push(String(event.data));
      wake?.();
    });
    try {
      await new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve, {once: true});
        socket.addEventListener("error", reject, {once: true});
      });
      const response = await fetch(`http://127.0.0.1:${port}/emit`);
      expect(response.status).to.equal(204);
      const until = Date.now() + 10000;
      while (messages.length < 1000 && Date.now() < until) {
        await new Promise((resolve) => {
          wake = resolve;
          setTimeout(resolve, 20);
        });
      }
      expect(messages.length).to.equal(1000);
      expect(messages.map((message) => message.trim()))
        .to.deep.equal(Array.from({length: 1000}, (_, index) => String(index + 1)));
    } finally {
      socket.close();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("dispatches a receiver during WAIT UP TO with a new dialog step", async () => {
    const {initializeABAP} = await import("../output/init.mjs");
    const Sender = (await import("../output/zcl_osd_amc_test.clas.mjs")).zcl_osd_amc_test;
    await initializeABAP();
    const object = new Sender();
    const count = await dialogStep(() => object.wait_up_to());
    expect(count.get()).to.equal(1);
  });

  it("releases an HTTP step during WAIT FOR MESSAGING CHANNELS and wakes on SEND", async () => {
    const {initializeABAP} = await import("../output/init.mjs");
    const Sender = (await import("../output/zcl_osd_amc_test.clas.mjs")).zcl_osd_amc_test;
    await initializeABAP();
    const abap = globalThis.abap;
    const broker = installAmc(abap);
    const order = [];
    const server = createServer((req, res) => {
      const work = req.url === "/wait" ? () => new Sender().wait_for_message()
        : req.url === "/send" ? () => Sender.send_many({iv_count: new abap.types.Integer().set(1)})
          : async () => undefined;
      dialogStep(work).then((result) => {
        order.push(req.url);
        res.writeHead(200).end(String(result?.get?.() ?? "ok"));
      }).catch((error) => res.writeHead(500).end(String(error)));
    });
    mountChannels(server, [], {});
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const waiting = fetch(`${base}/wait`);
      const deadline = Date.now() + 1000;
      while (![...broker.subscribers].some((sub) => sub.active && sub.receiver) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect([...broker.subscribers].some((sub) => sub.active && sub.receiver)).to.equal(true);
      const second = await fetch(`${base}/second`, {signal: AbortSignal.timeout(1500)});
      expect(second.status).to.equal(200);
      expect(order).to.deep.equal(["/second"]);
      const sent = await fetch(`${base}/send`);
      expect(sent.status).to.equal(200);
      const first = await waiting;
      const answer = await first.text();
      expect(first.status, answer).to.equal(200);
      expect(answer).to.equal("1");
      expect(order).to.deep.equal(["/second", "/send", "/wait"]);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
