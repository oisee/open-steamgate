import {expect} from "chai";
import {startServer} from "./start.mjs";

// The data browser (backlog G.9, /sap/bc/osd/se16/): pick a table, see its
// rows. What is asserted here is the property that makes it worth having --
// it reads **through the application**, using the same source classes the
// OData services use, rather than around it into the database. A browser
// that went straight to the database would show rows the application cannot
// see, and then "why does the app not show this row" would be unanswerable.
const PORT = process.env.STG_PORT ?? 3030;
const BASE = `http://localhost:${PORT}/sap/bc/osd/se16/`;

describe("the data browser", function () {
  this.timeout(60000);
  let server;
  before(() => {
    server = startServer(true);
  });
  after(() => server?.close());

  it("lists the entities the system can read, and says how it reads them", async () => {
    const page = await (await fetch(BASE)).text();
    expect(page, "the screen").to.contain("Data browser");
    expect(page, "a count rather than a bare list").to.match(/\d+ entities the system can read/);
    expect(page, "and one of them is the demo's own").to.contain("?t=ZC_STG_TRAVEL");
    expect(page, "it says where the rows come from").to.contain("not around the application, through it");
  });

  it("shows a table's rows, with the source class named", async () => {
    const page = await (await fetch(`${BASE}?t=ZC_STG_TRAVEL`)).text();
    // the assertion is about which columns are there, not about the markup:
    // it used to pin `<th>TRAVELID` and went red when the header became a
    // link that sorts by it — a test about one thing, failing about another
    expect(page, "the columns the registry knows, not guessed from row one").to.match(/<th>[^<]*<a[^>]*>TRAVELID</);
    expect(page, "a seeded row").to.contain("Berlin to Copenhagen");
    // naming the class is the honest part: a reader can go and check that
    // this is the same path the OData service takes
    expect(page, "read through").to.match(/read through <b>ZCL_STG_CDS_\w+<\/b>/);
  });

  it("counts what it showed, not where the loop stopped", async () => {
    // `showing` used to be the loop index minus one, which is right only
    // when the limit ended the loop and wrong by one whenever the table
    // simply ran out -- the common case, and the believable wrong number
    const limited = await (await fetch(`${BASE}?t=ZC_STG_TRAVEL&max=3`)).text();
    expect(limited, "the limit stopped it").to.match(/(\d+) row\(s\), showing 3/);
    const whole = await (await fetch(`${BASE}?t=ZC_STG_TRAVEL&max=100`)).text();
    const [, total, shown] = /(\d+) row\(s\), showing (\d+)/.exec(whole) ?? [];
    expect(shown, "no limit, so it showed all of them").to.equal(total);
  });

  // Wave 2: the two things that make it SE16 rather than a listing.
  it("offers a selection per field, and says what a value means", async () => {
    const page = await (await fetch(`${BASE}?t=ZC_STG_TRAVEL`)).text();
    expect(page, "an input per field").to.contain('name="f_travelid"');
    expect(page, "and a column checkbox per field").to.contain('name="c" value="TRAVELID"');
    expect(page, "SE16's own conventions, named on the screen").to.contain("is a range");
  });

  it("filters through the same clause builder an OData $filter goes through", async () => {
    // not a WHERE assembled here: the value becomes a select-option and goes
    // to zcl_stg_request_context=>where_for_option, so `*` means here what it
    // means over the service and the escaping is the one escaper in the system
    const page = await (await fetch(`${BASE}?t=ZC_STG_TRAVEL&f_status=B*`)).text();
    expect(page, "the pattern became a LIKE").to.match(/WHERE <code>STATUS LIKE &#39;B%&#39;<\/code>/);
    const [, , shown] = /(\d+) row\(s\), showing (\d+)/.exec(page) ?? [];
    const all = await (await fetch(`${BASE}?t=ZC_STG_TRAVEL`)).text();
    const [, , every] = /(\d+) row\(s\), showing (\d+)/.exec(all) ?? [];
    expect(Number(shown), "the filter removed rows").to.be.lessThan(Number(every));
  });

  it("a range and an exclusion are the ones SE16 writes", async () => {
    const range = await (await fetch(`${BASE}?t=ZC_STG_TRAVEL&f_travelid=1..2`)).text();
    expect(range).to.match(/WHERE <code>TRAVELID BETWEEN &#39;1&#39; AND &#39;2&#39;<\/code>/);
    const not = await (await fetch(`${BASE}?t=ZC_STG_TRAVEL&f_status=!B`)).text();
    expect(not).to.match(/WHERE <code>NOT \( STATUS = &#39;B&#39; \)<\/code>/);
  });

  it("a quote in a value is escaped by that one escaper, not quoted into the statement", async () => {
    const page = await (await fetch(`${BASE}?t=ZC_STG_TRAVEL&f_status=${encodeURIComponent("a'b")}`)).text();
    expect(page, "doubled, which is what Open SQL wants").to.contain("&#39;&#39;");
    expect(page, "and the page still answered").to.contain("All entities");
  });

  it("shows only the columns asked for, and drops a name the entity does not have", async () => {
    const page = await (await fetch(`${BASE}?t=ZC_STG_TRAVEL&c=TRAVELID,STATUS`)).text();
    // only the row table's headers: the selection form above has its own
    // (Show / Field / Selection), and a regex over the whole page reads both
    const headers = (html) => [...(/<table class="rows">([\s\S]*?)<\/table>/.exec(html)?.[1] ?? "")
      .matchAll(/<th>(?:<a[^>]*>)?([A-Z_0-9]+)/g)].map((m) => m[1]);
    expect(headers(page), "the columns asked for, in the entity's own order")
      .to.deep.equal(["TRAVELID", "STATUS"]);
    // the form fields are read against the entity's own field list, so a
    // name that is not a field is never looked for and cannot reach anything
    const junk = await (await fetch(`${BASE}?t=ZC_STG_TRAVEL&c=TRAVELID,NOT_A_FIELD`)).text();
    expect(headers(junk)).to.deep.equal(["TRAVELID"]);
    expect(junk).to.not.contain("NOT_A_FIELD");
  });

  it("a criterion on a field the entity does not have cannot reach the WHERE", async () => {
    const page = await (await fetch(`${BASE}?t=ZC_STG_TRAVEL&f_not_a_field=${encodeURIComponent("x' OR '1'='1")}`)).text();
    expect(page, "nothing was built from it").to.contain("WHERE <code>(none)</code>");
  });

  it("reads a view entity, which has no SQL view behind it", async () => {
    // B.15: every other view here is DDIC-based, and the modern shape is
    // `define view entity`. The parsing half is pinned in test/cds-cast.mjs;
    // this is the rest of the path — generated, registered, listed, read —
    // which a unit test on the parser cannot reach.
    const list = await (await fetch(BASE)).text();
    expect(list, "the registry knows it").to.contain("?t=ZC_OSD_PORT_VE");
    const page = await (await fetch(`${BASE}?t=ZC_OSD_PORT_VE`)).text();
    const headers = [...(/<table class="rows">([\s\S]*?)<\/table>/.exec(page)?.[1] ?? "")
      .matchAll(/<th>(?:<a[^>]*>)?([A-Z_0-9]+)/g)].map((m) => m[1]);
    expect(headers, "its own columns, in its own order").to.deep.equal(["PORT", "PROTOCOL", "PURPOSE"]);
    expect(page, "read through a generated source class like any other").to.match(/read through <b>ZCL_STG_CDS_\w+<\/b>/);
  });

  it("says a name it does not have is not there, rather than showing nothing", async () => {
    const page = await (await fetch(`${BASE}?t=NOPE_NOT_HERE`)).text();
    expect(page, "named, not silent").to.contain("No entity called");
    expect(page, "and a way back").to.contain('href="?"');
  });

  // Wave 3: the two things that turn a table into something you move around
  // in — sort by clicking a column, and open the one row you are pointing at.
  it("sorts by a column when its header is clicked, and turns round on the second click", async () => {
    const keys = async (q) => {
      const page = await (await fetch(BASE + q)).text();
      return [...page.matchAll(/<td><a href="[^"]*">([^<]*)<\/a><\/td>/g)].map((m) => m[1]);
    };
    const up = await keys("?t=ZC_STG_TRAVEL&s=TRAVELID");
    const down = await keys("?t=ZC_STG_TRAVEL&s=TRAVELID&d=x");
    expect(up.length, "there are rows to sort").to.be.greaterThan(1);
    expect(down, "the same rows, the other way round").to.deep.equal([...up].reverse());
    // and the header says which way, because an order nobody can see is an
    // order nobody trusts
    const page = await (await fetch(`${BASE}?t=ZC_STG_TRAVEL&s=TRAVELID&d=x`)).text();
    expect(page).to.contain("&#9660;");
  });

  it("the header link carries the filter and the columns already chosen", async () => {
    // every link on the page keeps what the person chose and changes one
    // thing; built in one place, because four places drift and the first to
    // drift silently drops a filter somebody typed
    const page = await (await fetch(`${BASE}?t=ZC_STG_TRAVEL&f_status=A&c=TRAVELID,STATUS`)).text();
    const header = /<th><a href="([^"]*)">TRAVELID<\/a>/.exec(page)?.[1] ?? "";
    expect(header, "the filter survives a sort").to.contain("f_status=A");
    expect(header, "and so does the column choice").to.contain("c=TRAVELID,STATUS");
  });

  it("a key cell opens the one row it identifies, through the filter that already exists", async () => {
    // SE16's drill-down, and deliberately not a second way of reading a row:
    // the record a person opens is read by the same path as the list they
    // opened it from, so the two cannot disagree
    const list = await (await fetch(`${BASE}?t=ZC_STG_TRAVEL`)).text();
    const href = /<td><a href="([^"]*)">T0002<\/a>/.exec(list)?.[1];
    expect(href, "the key is a link").to.be.a("string");
    const one = await (await fetch(BASE + href.replace(/^\?/, "?"))).text();
    expect(one, "and it shows exactly that row").to.match(/1 row\(s\), showing 1/);
    expect(one).to.contain("T0002");
  });

  it("a sort column the entity does not have never reaches the ORDER BY", async () => {
    // the same rule as the filter: read against the entity's own fields, so
    // a name that is not one of them is never looked for
    const page = await (await fetch(`${BASE}?t=ZC_STG_TRAVEL&s=NOT_A_FIELD`)).text();
    expect(page, "the page still answered").to.contain("All entities");
    expect(page, "and nothing is marked sorted").to.not.contain("&#9650;");
  });
});
