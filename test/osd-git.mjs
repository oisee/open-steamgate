import {expect} from "chai";
import {createHash} from "node:crypto";
import {createServer} from "node:http";
import {deflateSync, inflateRawSync} from "node:zlib";
import {Git} from "../tools/osd-git.mjs";

// The fetch, inside OSD. A git server of forty lines stands in for GitHub,
// so the whole path is exercised with no network: the advertisement, the
// upload-pack request, abapGit's pack decoding and the tree walk that
// turns objects back into files.
//
// The pack is built here the way git builds one, because a fixture of a
// real pack would be a black box: if the decoding broke, a fixture could
// not say which byte was wrong, and a pack written by these forty lines
// can be changed until it does.
describe("tools/osd-git: a clone, with no git binary in the path", function () {
  this.timeout(180000);

  const TREE = [
    {mode: "100644", name: ".abapgit.xml", body: "<?xml version=\"1.0\"?>\n<abapGit>\n <STARTING_FOLDER>/src/</STARTING_FOLDER>\n</abapGit>\n"},
    {mode: "100644", name: "README.md", body: "# a repository that never existed\n"},
    {mode: "40000", name: "src", entries: [
      {mode: "100644", name: "zcl_only.clas.abap", body: "CLASS zcl_only DEFINITION PUBLIC.\nENDCLASS.\nCLASS zcl_only IMPLEMENTATION.\nENDCLASS.\n"},
    ]},
  ];

  let server;
  let url;
  let head;

  // ------------------------------------------------------------ the plumbing

  const objects = [];

  function store(type, body) {
    const header = Buffer.from(`${type} ${body.length}\0`);
    const sha1 = createHash("sha1").update(Buffer.concat([header, body])).digest("hex");
    objects.push({type, body, sha1});
    return sha1;
  }

  function tree(entries) {
    const parts = [];
    // git wants a tree sorted by name, with a directory sorting as if it
    // ended in a slash
    const sorted = [...entries].sort((a, b) => (a.name + (a.entries ? "/" : "")).localeCompare(b.name + (b.entries ? "/" : "")));
    for (const entry of sorted) {
      const sha1 = entry.entries === undefined
        ? store("blob", Buffer.from(entry.body))
        : tree(entry.entries);
      parts.push(Buffer.concat([Buffer.from(`${entry.mode} ${entry.name}\0`), Buffer.from(sha1, "hex")]));
    }
    return store("tree", Buffer.concat(parts));
  }

  function header(type, size) {
    const kinds = {commit: 1, tree: 2, blob: 3};
    const out = [(kinds[type] << 4) | (size & 0x0f)];
    size >>= 4;
    while (size > 0) {
      out[out.length - 1] |= 0x80;
      out.push(size & 0x7f);
      size >>= 7;
    }
    return Buffer.from(out);
  }

  function pack() {
    const parts = [Buffer.from("PACK"), int32(2), int32(objects.length)];
    for (const object of objects) {
      parts.push(header(object.type, object.body.length), deflateSync(object.body));
    }
    const body = Buffer.concat(parts);
    return Buffer.concat([body, createHash("sha1").update(body).digest()]);
  }

  function int32(value) {
    const out = Buffer.alloc(4);
    out.writeUInt32BE(value);
    return out;
  }

  function pkt(text) {
    return Buffer.from(`${(text.length + 4).toString(16).padStart(4, "0")}${text}`);
  }

  before(async () => {
    const root = tree(TREE);
    head = store("commit", Buffer.from(
      `tree ${root}\n` +
      "author Nobody <nobody@example.invalid> 1757700000 +0000\n" +
      "committer Nobody <nobody@example.invalid> 1757700000 +0000\n" +
      "\nthe only commit\n"));
    const body = pack();

    server = createServer((request, response) => {
      if (request.url.startsWith("/repo/info/refs")) {
        response.writeHead(200, {"content-type": "application/x-git-upload-pack-advertisement"});
        response.end(Buffer.concat([
          pkt("# service=git-upload-pack\n"),
          Buffer.from("0000"),
          pkt(`${head} HEAD\0symref=HEAD:refs/heads/main object-format=sha1\n`),
          pkt(`${head} refs/heads/main\n`),
          pkt(`${head} refs/tags/v1\n`),
          Buffer.from("0000"),
        ]));
        return;
      }
      if (request.url === "/repo/git-upload-pack") {
        const chunks = [];
        request.on("data", (chunk) => chunks.push(chunk));
        request.on("end", () => {
          const asked = Buffer.concat(chunks).toString();
          expect(asked, "the client asks for the commit it saw").to.contain(`want ${head}`);
          response.writeHead(200, {"content-type": "application/x-git-upload-pack-result"});
          response.end(Buffer.concat([pkt("NAK\n"), body]));
        });
        return;
      }
      response.writeHead(404);
      response.end();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${server.address().port}/repo`;
  });

  after(() => {
    server?.close();
  });

  // ---------------------------------------------------------------- the tests

  it("reads what the remote advertises, HEAD and branches and tags", async () => {
    const refs = await new Git().refs(url);
    expect(refs.map((r) => r.name)).to.deep.equal(["HEAD", "refs/heads/main", "refs/tags/v1"]);
    // the capabilities ride on the first line after a null byte and are
    // not part of the name
    expect(refs[0].sha1).to.equal(head);
    for (const ref of refs) {
      expect(ref.sha1, ref.name).to.equal(head);
    }
  });

  it("clones a branch into files, which is what the importer reads", async () => {
    const clone = await new Git().clone(url);
    expect(clone).to.include({url, branch: "refs/heads/main", commit: head});

    const names = clone.files.map((f) => `${f.path}${f.filename}`).sort();
    expect(names).to.deep.equal(["/.abapgit.xml", "/README.md", "/src/zcl_only.clas.abap"]);

    // the bytes came back, through deflate and abapGit's pack reader
    const source = clone.files.find((f) => f.filename === "zcl_only.clas.abap");
    expect(source.data.toString()).to.contain("CLASS zcl_only DEFINITION PUBLIC.");
    const readme = clone.files.find((f) => f.filename === "README.md");
    expect(readme.data.toString()).to.equal("# a repository that never existed\n");
  });

  it("a branch that is not there is refused by name", async () => {
    let failed;
    try {
      await new Git().clone(url, {branch: "nope"});
    } catch (error) {
      failed = error;
    }
    expect(failed, "a missing branch has to be an error").to.not.equal(undefined);
    // the text comes off an ABAP exception through get_text, and osd-git
    // does that so a caller has something to print
    expect(failed.code).to.equal("GIT_FAILED");
    expect(failed.message).to.contain("refs/heads/nope");
  });

  it("a remote that answers 404 is refused with its status, not read as refs", async () => {
    // the status comes from get_status: the ~status_code field the class
    // read before is empty on this runtime (ANOMALY-2026-09-24-httpc-status-code-field),
    // so an error answer went on to be parsed as an advertisement
    let failed;
    try {
      await new Git().refs(url.replace(/\/repo$/, "/norepo"));
    } catch (error) {
      failed = error;
    }
    expect(failed, "a 404 has to be an error").to.not.equal(undefined);
    expect(failed.code).to.equal("GIT_FAILED");
    expect(failed.message).to.contain("answered 404");
  });

  it("inflate is the platform's, and says how much of the input it ate", async () => {
    // zcl_abapgit_zlib is ours: abapGit's pack code asks it for the raw
    // bytes and for how far the stream ran, and the second answer is what
    // moves the reader on to the next object
    const abap = globalThis.abap;
    const raw = Buffer.from("a line, and then the same line again, and again, and again\n");
    const compressed = deflateSync(raw);
    // the caller strips the two byte zlib header before asking
    const stream = Buffer.concat([compressed.subarray(2), Buffer.from("trailing bytes")]);

    const answer = await abap.Classes["ZCL_ABAPGIT_ZLIB"].decompress({
      iv_compressed: new abap.types.XString().set(stream.toString("hex").toUpperCase()),
    });
    expect(Buffer.from(answer.get().raw.get(), "hex").toString()).to.equal(raw.toString());
    // how far the deflate stream ran: the two byte header is already off,
    // and the four byte checksum after it is not part of the stream, so
    // the reader lands exactly on the checksum, which is where abapGit
    // looks for it
    expect(answer.get().compressed_len.get()).to.equal(compressed.length - 6);
    // and the same bytes through Node directly, so the test says what it
    // is comparing against
    expect(inflateRawSync(stream).toString()).to.equal(raw.toString());
  });

  it("a stream that is not deflate comes back as a length of nothing", async () => {
    const abap = globalThis.abap;
    const answer = await abap.Classes["ZCL_ABAPGIT_ZLIB"].decompress({
      iv_compressed: new abap.types.XString().set("DEADBEEF"),
    });
    expect(answer.get().compressed_len.get()).to.equal(0);
  });
});
