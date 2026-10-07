import {expect} from "chai";
import {checkReport, metrics, renderReport, checkVspSyntax, timingReference, TIMING_RULE} from "../tools/adt-lifecycle-report.mjs";
import {readFileSync, mkdtempSync, writeFileSync, rmSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createRequire} from "node:module";
function fixture() {
 const results=[];
 const add=(client,type,operation,sample)=>results.push({client,type,operation,sample,status:"PASS",ms:2000});
 for(const client of ["ABAP-FS","VSP"]) for(const type of ["DEVC","CLAS","INTF","PROG","INCL","DDLS"]) {
  const ops=type==="DEVC"?["create","delete+confirmed-404"]:client==="ABAP-FS"?["create","write-initial","delete+confirmed-404"]:["create+write+activate","check-explicit","activate-explicit","readback-vsp","delete+confirmed-404"];
  ops.forEach(op=>add(client,type,op));
  if(client==="ABAP-FS") add(client,type,"validate");
  if(type!=="DEVC") for(const op of client==="ABAP-FS"?["edit","check","activate-edit","readback-active"]:["edit+check+activate"]) for(let i=0;i<3;i++) add(client,type,op,i);
 }
 add("ABAP-FS","ALL5","activate-initial");
 return {schema:1,complete:true,repeats:3,identity:{recipe:1,sdk:"8.4.3",vsp:"pin",runtime:"pin",node:"22",platform:"linux",arch:"x64"},results};
}
function realFixture(number) {
 const data = JSON.parse(readFileSync(new URL(`./fixtures/adt-lifecycle-timing/${number}.json`, import.meta.url), "utf8"));
 const complete = timed => {
  const report = fixture();
  report.results = [...report.results.filter(row => row.sample === undefined), ...timed.results];
  return report;
 };
 return {current: complete(data.current), baseline: complete(data.baseline)};
}
function slowOperation(report, factor, type = "CLAS", operation = "activate-edit") {
 report.results.filter(row => row.type === type && row.operation === operation).forEach(row => row.ms *= factor);
 return report;
}
function cli(report, history, rawHistory) {
 const dir = mkdtempSync(join(tmpdir(), "lifecycle-report-"));
 try {
  const current = join(dir, "report.json"), baselines = join(dir, "baselines.json"), summary = join(dir, "summary.md");
  writeFileSync(current, JSON.stringify(report));
  writeFileSync(baselines, rawHistory ?? JSON.stringify(history));
  const run = spawnSync(process.execPath, ["tools/adt-lifecycle-report.mjs", current, baselines, summary], {encoding: "utf8"});
  return {...run, summary: readFileSync(summary, "utf8")};
 } finally { rmSync(dir, {recursive: true, force: true}); }
}
describe("ADT lifecycle evidence and timing advisory",()=>{
 it("rejects syntax errors inside a successful VSP MCP response",()=>{
  const response = diagnostics => ({content:[{type:"text",text:JSON.stringify(diagnostics)}]});
  expect(()=>checkVspSyntax(response([{severity:"E",text:"Syntax error"}]))).to.throw("VSP syntax errors");
  expect(()=>checkVspSyntax(response([]))).not.to.throw();
  expect(()=>checkVspSyntax(response(null))).not.to.throw();
  expect(()=>checkVspSyntax(response({}))).to.throw("Invalid VSP syntax diagnostics");
 });
 it("accepts complete functional evidence and matching baseline",()=>{
  const r=fixture(); expect(checkReport(r,r).errors).to.deep.equal([]);
 });
 it("uses median so a single slow runner sample is tolerated",()=>{
  const r=fixture(); r.results.find(x=>x.operation==="activate-edit").ms=50000;
  expect(checkReport(r,fixture()).timing.status).to.equal("QUIET");
 });
 it("warns without failing on a sustained slowdown and names the operation",()=>{
  const r=slowOperation(fixture(), 2);
  const verdict=checkReport(r,fixture());
  expect(verdict.errors).to.deep.equal([]);
  expect(verdict.warnings.join("\n")).to.contain("ABAP-FS/CLAS/activate-edit: 4000 ms");
  const run=cli(r, {reports:[fixture()]});
  expect(run.status).to.equal(0);
  expect(run.stdout).to.contain("::warning title=ADT lifecycle timing::");
  expect(run.summary).to.contain("### ADT lifecycle: PASS").and.contain("Timing advisory: ⚠️ WARN").and.contain("2.000x");
 });
 for (const number of [635,633,636]) {
  it(`keeps real run #${number} quiet against its printed main baseline`,()=>{
   const {current,baseline}=realFixture(number);
   const verdict=checkReport(current,[baseline]);
   expect(verdict.errors).to.deep.equal([]);
   expect(verdict.warnings).to.deep.equal([]);
   expect(verdict.timing.status).to.equal("QUIET");
   expect(verdict.comparisons).to.have.length(25);
  });
 }
 it("keeps a uniformly 1.6x slower real run quiet",()=>{
  const {current}=realFixture(635), slower=structuredClone(current);
  slower.results.forEach(row=>row.ms*=1.6);
  const verdict=checkReport(slower, [current]);
  expect(verdict.errors).to.deep.equal([]);
  expect(verdict.timing.status).to.equal("QUIET");
  for(const comparison of verdict.comparisons) expect(comparison.ratio).to.be.closeTo(1,1e-12);
 });
 it("warns on a 2x operation slowdown in an otherwise unchanged real run",()=>{
  const {current}=realFixture(636);
  expect(checkReport(slowOperation(structuredClone(current),2), [current]).timing.status).to.equal("WARN");
 });
 it("requires two operations strictly above 1.3x or one at least 2x",()=>{
  expect(TIMING_RULE).to.deep.equal({baselines:5,margin:1.3,several:2,large:2});
  const r=slowOperation(fixture(),1.3);
  slowOperation(r,1.3,"INTF");
  expect(checkReport(r,fixture()).timing.status).to.equal("QUIET");
  const single=slowOperation(fixture(),1.5);
  expect(checkReport(single,fixture()).timing.status).to.equal("QUIET");
  slowOperation(single,1.5,"INTF");
  expect(checkReport(single,fixture()).timing.status).to.equal("WARN");
  expect(checkReport(slowOperation(fixture(),1.999),fixture()).timing.status).to.equal("QUIET");
 });
 it("takes the median of per-run normalized metrics across five main runs",()=>{
  const {current}=realFixture(635);
  const history=[0.8,1,1.2,1.6,2].map((scale,i)=>{
   const r=structuredClone(current);
   r.results.forEach(row=>row.ms*=scale);
   return slowOperation(r,[0.8,1,1.2,1.4,20][i]);
  });
  // A sixth (older) outlier must not join the five-run reference.
  history.push(slowOperation(structuredClone(current),100));
  const verdict=checkReport(current,history);
  expect(verdict.timing.baselines).to.have.length(5);
  const operation=verdict.comparisons.find(row=>row.key==="ABAP-FS/CLAS/activate-edit");
  expect(operation.baselineCount).to.equal(5);
  expect(operation.ratio).to.be.closeTo(1/1.2,1e-12);
 });
 it("uses exactly the four CLAS/INTF edit/readback control medians",()=>{
  const {current}=realFixture(636);
  expect(timingReference(current)).to.equal(60.5); // median of 92,29,92,20
  slowOperation(current,100,"PROG","readback-active");
  expect(timingReference(current)).to.equal(60.5);
 });
 it("keeps zero controls pending and never creates nonfinite ratios",()=>{
  const r=fixture();
  r.results.filter(row=>row.type==="CLAS" && row.operation==="edit").forEach(row=>row.ms=0);
  expect(checkReport(r,fixture()).timing.status).to.equal("PENDING");
  expect(checkReport(fixture(),r).timing.status).to.equal("PENDING");
 });
 it("fails on missing cleanup evidence",()=>{
  const r=fixture(); r.results=r.results.filter(x=>!(x.type==="CLAS" && x.operation==="delete+confirmed-404"));
  expect(checkReport(r).errors.join("\n")).to.contain("delete+confirmed-404");
 });
 it("does not hide failed validation or active readback",()=>{
  for(const operation of ["validate","readback-active"]) {
   const r=fixture(); r.results.find(x=>x.operation===operation).status="FAIL";
   expect(checkReport(r).errors.length).to.be.greaterThan(0);
  }
 });
 it("allows only the three observed missing preflights and reports them",()=>{
  const r=fixture(); r.results.find(x=>x.type==="PROG" && x.operation==="validate").status="MISSING";
  expect(checkReport(r).errors).to.deep.equal([]); expect(renderReport(r)).to.contain("1 MISSING");
  r.results.find(x=>x.type==="CLAS" && x.operation==="validate").status="MISSING";
  expect(checkReport(r).errors.length).to.be.greaterThan(0);
 });
 it("excludes incompatible or unfinished history without failing current evidence",()=>{
  const base=fixture(); base.identity.vsp="other";
  const mismatch=checkReport(fixture(),base);
  expect(mismatch.errors).to.deep.equal([]);
  expect(mismatch.timing.notes).to.include("Incompatible baseline identity: vsp");
  base.complete=false;
  const partial=checkReport(fixture(),[base,fixture()]);
  expect(partial.errors).to.deep.equal([]);
  expect(partial.timing.notes).to.include("Baseline lifecycle evidence is invalid");
  expect(partial.timing.baselines).to.have.length(1);
 });
 it("still exits nonzero for a failed active readback with advisory timing",()=>{
  const r=slowOperation(fixture(),2);
  r.results.find(row=>row.operation==="readback-active").status="FAIL";
  const run=cli(r,{reports:[fixture()]});
  expect(run.status).to.equal(1);
  expect(run.summary).to.contain("### ADT lifecycle: FAIL").and.contain("readback-active");
 });
 it("keeps unreadable timing history advisory in the actual CLI",()=>{
  const run=cli(fixture(),null,"{broken json");
  expect(run.status).to.equal(0);
  expect(run.summary).to.contain("comparison pending").and.contain("Unreadable timing history");
 });
 it("skips malformed history shapes without changing the functional result",()=>{
  for(const history of [{reports:{}},[null,{results:{}},"broken"],{reports:null}]) {
   const verdict=checkReport(fixture(),history);
   expect(verdict.errors).to.deep.equal([]);
   expect(verdict.timing.status).to.equal("PENDING");
   expect(verdict.timing.notes).to.have.length.greaterThan(0);
  }
 });
 it("requires distinct repeated samples",()=>{
  const r=fixture(); r.results.find(x=>x.sample===1).sample=0;
  expect(checkReport(r).errors.length).to.be.greaterThan(0);
 });
 it("labels missing baselines as pending and preserves raw samples",()=>{
  const r=fixture(); expect(renderReport(r)).to.contain("comparison pending");
  expect(metrics(r)["ABAP-FS/CLAS/activate-edit"].samples).to.deep.equal([2000,2000,2000]);
 });
});


describe("CI lifecycle timing history collection",()=>{
 const require=createRequire(import.meta.url);
 const workflow=require("js-yaml").load(readFileSync(".github/workflows/tests.yml","utf8"));
 const script=workflow.jobs["adt-lifecycle"].steps.find(step=>step.name==="Collect up to five compatible green main timing runs").with.script;
 const execute=async (apiFailure=false,artifactFailure)=>{
  const {current}=realFixture(635), writes=new Map(), calls=[];
  const fs={readFileSync:()=>JSON.stringify(current),writeFileSync:(file,data)=>writes.set(file,data)};
  const cp={spawnSync:(_command,args)=>{
   const data=writes.get(args[1]).toString();
   return {status:data==="unreadable zip"?1:0,stdout:data};
  }};
  const actions={
   listWorkflowRuns:async args=>{
    expect(args).to.include({branch:"main",event:"push",status:"success",per_page:100});
    if(apiFailure) throw Error("history API unavailable");
    return {data:{workflow_runs:[90,10,9,8,7,6,5,4,3,2,1].map(id=>({id,head_sha:`commit-${id}`}))}};
   },
   listWorkflowRunArtifacts(){},
   downloadArtifact:async ({artifact_id:id})=>{
    if(id===82) {
     if(artifactFailure) return {data:Buffer.from(artifactFailure)};
     throw Error("artifact expired during download");
    }
    const report=structuredClone(current);
    if(Math.floor(id/10)===7) report.identity.sdk="other";
    if(Math.floor(id/10)===6) report.complete=false;
    report.identity.commit=`artifact-${id}`;
    return {data:Buffer.from(JSON.stringify(report))};
   },
  };
  const github={rest:{actions},paginate:async (_method,{run_id:id})=>{
   calls.push(id);
   if(id===10) return [];
   if(id===9) return [{id:91,name:"adt-lifecycle-attempt-1",expired:true}];
   const artifact=attempt=>({id:id*10+attempt,name:`adt-lifecycle-attempt-${attempt}`,expired:false});
   return [artifact(1),artifact(2)];
  }};
  await new (Object.getPrototypeOf(async function(){}).constructor)("require","github","context","core","process",script)(
   name=>name==="node:fs"?fs:name==="node:child_process"?cp:require(name),github,
   {repo:{owner:"fixture",repo:"fixture"},runId:90},{info(){}},
   {cwd:()=>process.cwd(),env:{RUNNER_TEMP:"/tmp"}});
  return {history:JSON.parse(writes.get(".local/adt-lifecycle/baselines.json")),calls};
 };
 it("collects five distinct usable runs despite unavailable artifacts and invalid history",async()=>{
  const {history,calls}=await execute();
  expect(history.reports.map(report=>report.identity.commit)).to.deep.equal(["artifact-81","artifact-52","artifact-42","artifact-32","artifact-22"]);
  expect(calls).not.to.include(90).and.not.to.include(1);
  expect(history.notes.join("\n")).to.contain("artifact expired during download").and.contain("Incompatible baseline identity").and.contain("evidence is invalid");
 });
 for(const data of ["unreadable zip","{invalid json"]) {
  it(`falls back from a corrupt artifact: ${data}`,async()=>{
   const {history}=await execute(false,data);
   expect(history.reports[0].identity.commit).to.equal("artifact-81");
   expect(history.reports).to.have.length(5);
   expect(history.notes).to.have.length.greaterThan(0);
  });
 }
 it("retains an explicit pending explanation when the history API is unavailable",async()=>{
  const {history}=await execute(true);
  expect(history.reports).to.deep.equal([]);
  expect(history.notes).to.deep.equal(["Main timing history unavailable: history API unavailable"]);
  expect(checkReport(fixture(),history).errors).to.deep.equal([]);
  expect(renderReport(fixture(),history)).to.contain("comparison pending").and.contain("history API unavailable");
 });
});
