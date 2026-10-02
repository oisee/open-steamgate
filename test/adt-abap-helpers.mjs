// Slice 0a: call the generated ABAP helpers against the Node contracts.
import {expect} from "chai";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import "./start.mjs";
import {TYPES} from "../tools/osd-store-types.mjs";
import {ADT_TYPE, TREE_FOLDER, TREE_CATEGORY, TREE_TYPE_LABEL, TREE_CATEGORY_LABEL, objectFromUri, objectReferencesIn} from "../tools/adt-documents.mjs";
import {entityTag, normalizedTag} from "../tools/adt-entity.mjs";
import {Sessions} from "../tools/adt-session.mjs";
import {ObjectStore} from "../tools/osd-store.mjs";

const text = (v) => new abap.types.String().set(v);
const plain = (s) => Object.fromEntries(Object.entries(s.get()).map(([k,v]) =>
  [k, ["source", "found", "ok", "nan"].includes(k) ? (v.get() === "X" ? "X" : "") : (v.getRaw?.() ?? v.get())]));
const api = (name) => abap.Classes[`ZCL_OSD_ADT_${name}`];
const bool = (v) => v === "X";
const number = (s) => { const v = plain(s); return bool(v.nan) ? NaN : v.infinity ? v.infinity * Infinity : v.value; };
async function exported(klass, method, input) {
  const ev_value = text(""), ev_found = new abap.types.Character(1);
  await api(klass)[method]({...Object.fromEntries(Object.entries(input).map(([k,v]) => [k,text(v)])), ev_value, ev_found});
  return {value: ev_value.get(), found: bool(ev_found.get())};
}
const facade = readFileSync(new URL("../tools/adt-facade.mjs", import.meta.url), "utf8");
const labels = Function("return " + facade.match(/const LABELS = (\{[\s\S]*?\n  \});/)[1])();

describe("ADT ABAP shared helpers: Node parity", function () {
  this.timeout(120000);
  it("document fixtures and their ABAP Unit expectations were generated from Node", () => {
    execFileSync(process.execPath, ["tools/adt-helper-fixtures.mjs", "--check"], {stdio: "pipe"});
  });
  it("ALL is the complete ordered TYPES and ADT_TYPE catalog, including tree labels", async () => {
    const actual = (await api("TYPES").all()).array().map(plain);
    const expected = Object.entries(TYPES).map(([type, row]) => {
      const [label, plural, category] = labels[type];
      const tree_category = TREE_CATEGORY[type] ?? "other";
      return {type, collection: row.adt, source: row.source ? "X" : "", adt_type: ADT_TYPE[type], label, plural, category,
        tree_folder: TREE_FOLDER[type]?.[0] ?? "", tree_label: TREE_FOLDER[type]?.[1] ?? TREE_TYPE_LABEL[type] ?? "",
        tree_category, tree_category_label: TREE_CATEGORY_LABEL[tree_category]};
    });
    expect(actual).to.deep.equal(expected);
    for (const [type, adt] of Object.entries(ADT_TYPE)) expect((await api("TYPES").adt_type({iv_type: text(type)})).get()).to.equal(adt);
    expect((await api("TYPES").sources()).array().map(plain)).to.deep.equal(expected.filter((r) => r.source === "X"));
    expect((await api("TYPES").lockable()).array().map(plain)).to.deep.equal([...expected.filter((r) => r.source === "X"), expected.find((r) => r.type === "DEVC")]);
    for (const r of expected) expect((await api("TYPES").type_of_collection({iv_collection: text(r.collection)})).get()).to.equal(r.type);
  });
  it("URI components agree with encode/decodeURIComponent, failures never raise", async () => {
    for (const value of ["", "/DEMO/CL_A", "a b+c", "éЖ😀", "!~*'()_-.", "a\0z", "%", "[]@"])
      expect((await api("URI").encode_component({iv_text: text(value)})).get(), value).to.equal(encodeURIComponent(value));
    for (const value of ["a+b", "%2fDEMO%2fCL_A", "%C3%A9", "%F0%9F%98%80", "%", "%zz", "%FF", "%C0%AF", "%ED%A0%80"]) {
      const ev_text = text(""), ev_ok = new abap.types.Character(1);
      await api("URI").decode_component({iv_text: text(value), ev_text, ev_ok});
      let expected, ok = true;
      try { expected = decodeURIComponent(value); } catch { ok = false; }
      expect(bool(ev_ok.get()), value).to.equal(ok);
      if (ok) expect(ev_text.get(), value).to.equal(expected);
    }
  });
  it("QUERY keeps absent and empty distinct and joins repeated scalar values like qs", async () => {
    const qs = (await import("qs")).default;
    for (const raw of ["", "a", "a=", "a=one+two&a=&a=%zz", "a=%20&a=%C3%A9", "%61=x&a=%&a=%FF", "A=x&a=y"]) {
      const reference = qs.parse(raw);
      for (const name of ["a", "A", "absent"]) {
        const actual = await exported("URI", "query", {iv_query: raw, iv_name: name});
        expect(actual, raw).to.deep.equal({found: Object.hasOwn(reference,name), value: String(reference[name] ?? "")});
      }
    }
  });
  it("objectFromUri and reference scans preserve case, suffix and failure behavior", async () => {
    const collections = Object.entries(TYPES).map(([k,v]) => [k,v.adt]);
    const uris = ["/sap/bc/adt/oo/classes/zcl_a/source/main?x#y", "/sap/bc/adt/packages/%24demo", "/SAP/bc/adt/oo/classes/zcl_a", "/sap/bc/adt/oo/classes/", "/sap/bc/adt/oo/classes/a/includes/main", "/sap/bc/adt/oo/classes/%zz"];
    for (const uri of uris) {
      const actual = plain(await api("TYPES").object_from_uri({iv_uri: text(uri)}));
      let expected;
      try { expected = objectFromUri(uri, collections); } catch { expect(actual.ok).to.equal(""); continue; }
      expect(actual.ok).to.equal("X");
      expect(bool(actual.found)).to.equal(expected !== undefined);
      if (expected) expect({type:actual.type,name:actual.name}).to.deep.equal(expected);
    }
    const xml = uris.slice(0,-1).map((uri) => `adtcore:uri="${uri}"`).join(" ");
    expect((await api("SCAN").references({iv_xml:text(xml)})).array().map((s) => {const {type,name}=plain(s);return {type,name};})).to.deep.equal(objectReferencesIn(xml,collections));
  });
  it("entity tags hash UTF-8 and If-Match normalization never splits commas", async () => {
    for (const body of ["", "abc", "éЖ😀", "a\r\nb\0"]) expect((await api("ENTITY").tag({iv_body:text(body)})).get()).to.equal(entityTag(body));
    for (const tag of [" W/\"a\" ", '"a", "b"', "W/W/a", '""a""', "*", "\ta b\n"])
      expect((await api("ENTITY").normalized({iv_tag:text(tag)})).get()).to.equal(normalizedTag(tag));
  });
  it("JSON quoting matches JSON.stringify for every C0 control and raw Unicode", async () => {
    for (const value of ["", '"\\/éЖ😀', ...Array.from({length:32},(_,i)=>String.fromCharCode(i)), "\u2028\u2029"])
      expect((await api("JSON").quote({iv_text:text(value)})).get()).to.equal(JSON.stringify(value));
  });
  it("NUMBER and JS_INT follow Number and parseInt, including radix and NaN", async () => {
    for (const value of ["", " \t\n", "0", "-0", "1.5", ".25", "1.", "1e2", "-2e-2", "0x10", "0b11", "0o17", "-0x1", "0x", "0b2", "2x", "NaN", "Infinity", "-Infinity", "1e309", "1e-400", "1_000", "\uFEFF1\u00a0", "\u0085"]) {
      const actual = number(await api("JS").number({iv_text:text(value)}));
      const expected = Number(value);
      expect(Number.isNaN(actual),value).to.equal(Number.isNaN(expected));
      if (!Number.isNaN(expected)) expect(actual,value).to.equal(expected);
    }
    for (const value of ["", "123abc", " +12.8", "-0x10zz", "0b11", "0x", "Infinity", "-12e2", "077", "z!", "\uFEFF12\u00a0"]) for (const radix of [0,2,8,10,16,36,1,37]) {
      const actual = number(await api("JS").js_int({iv_text:text(value),iv_radix:new abap.types.Integer().set(radix)}));
      const expected = parseInt(value,radix);
      expect(Number.isNaN(actual),`${value}/${radix}`).to.equal(Number.isNaN(expected));
      if (!Number.isNaN(expected)) expect(actual,`${value}/${radix}`).to.equal(expected);
    }
  });
  it("GLOB treats only star as special, with literal punctuation and case", async () => {
    for (const pattern of ["", "*", "**", "Z*X", "Z+X", "Z?X", "[*]", "a.*b", "a*b*c"]) for (const value of ["", "ZCL_X", "Z+X", "Z?X", "[x]", "a..b", "axbyc", "zcl_x"]) {
      const regex = new RegExp("^"+pattern.split("*").map((p)=>p.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join(".*")+"$");
      expect(bool((await api("JS").glob({iv_pattern:text(pattern),iv_text:text(value)})).get()),`${pattern}/${value}`).to.equal(regex.test(value));
    }
  });
  it("COLLATE keys match V8 localeCompare over repository names and ASCII variants", async () => {
    const names = [...new Set([...new ObjectStore({libs:[]}).list().map((r)=>r.name), "zcl_a", "ZCL_A", "ZCL_a", "Zcl_A", "ZCL_A0", "$DEMO", "/DEMO/CL_A", "Z_A", "Z-A", "Z.A", "Z#A", "Z1", "Z10", "Z2", ...Array.from({length:95}, (_,i) => "Z" + String.fromCharCode(i + 32) + "A")])];
    const keyed = [];
    for (const name of names) keyed.push({name,key:(await api("JS").collate({iv_text:text(name)})).get()});
    expect(keyed.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0).map((r)=>r.name)).to.deep.equal([...names].sort((a,b)=>a.localeCompare(b)));
  });
  it("XML ATTRIBUTE, BLOCKS and FIRST_TAG_VALUE match the Node patterns", async () => {
    const samples = ['<x adtcore:name=""/>', '<x notadtcore:name="no" adtcore:name="ok"/>', '<x other:adtcore:name="raw&amp;"/>', '<pack:superPackageExtra adtcore:name="no"/><pack:superPackage adtcore:name="yes"/>', '<x adtcore:name = "no"/>', "<x adtcore:name='no'/>"];
    for (const xml of samples) for (const element of [undefined,"pack:superPackage"]) {
      const scope = element === undefined ? xml : new RegExp(`<${element}\\b[^>]*>`).exec(xml)?.[0] ?? "";
      const value = /\badtcore:name="([^"]*)"/.exec(scope)?.[1];
      expect(await exported("SCAN","attribute",{iv_xml:xml,iv_name:"adtcore:name",...(element?{iv_element:element}:{})})).to.deep.equal({found:value!==undefined,value:value??""});
    }
    for (const xml of ['<x a="1">first\nline</x><x>second</x>','<xExtra>no</xExtra><x/>tail<x>yes</x>','<x>unclosed','<x></x>', '<x><y></y></x><x>yes</x>']) {
      const expected = [...xml.matchAll(/<x\b([^>]*)>([\s\S]*?)<\/x>/g)].map((m)=>({attributes:m[1],content:m[2]}));
      expect((await api("SCAN").blocks({iv_xml:text(xml),iv_element:text("x")})).array().map(plain)).to.deep.equal(expected);
      const value = /<x>([^<]*)<\/x>/.exec(xml)?.[1];
      expect(await exported("SCAN","first_tag_value",{iv_xml:xml,iv_tag:"x"})).to.deep.equal({found:value!==undefined,value:value??""});
    }
  });
  it("the shared Basic user helper follows Sessions.user and configurable defaults", async () => {
    for (const value of ["", "Bearer x", "Basic ZGVtbzpwYXNz", "bAsIc OnBhc3M=", "Basic !!!", "Basic /w==", "Basic ZGVtbw", "Basic  ZGVtbzpwYXNz"]) {
      const expected = Sessions.user({headers:{authorization:value}});
      expect((await api("USER").from_basic({iv_header:text(value),iv_default:text("OSD")})).get(),value).to.equal(expected);
    }
    expect((await api("USER").from_basic({iv_header:text(""),iv_default:text("OTHER")})).get()).to.equal("OTHER");
  });
});
