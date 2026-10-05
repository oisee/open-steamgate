import {expect} from "chai";
import {checkReport, metrics, renderReport, checkVspSyntax} from "../tools/adt-lifecycle-report.mjs";
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
describe("ADT lifecycle evidence and slowdown detection",()=>{
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
  expect(checkReport(r,fixture()).errors).to.deep.equal([]);
 });
 it("fails on a sustained injected slowdown and names the operation",()=>{
  const r=fixture(); r.results.filter(x=>x.type==="CLAS" && x.operation==="activate-edit").forEach(x=>x.ms=4500);
  expect(checkReport(r,fixture()).errors.join("\n")).to.contain("Slowdown ABAP-FS/CLAS/activate-edit");
  expect(renderReport(r,fixture())).to.contain("SLOW");
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
 it("refuses mismatched toolchains and unfinished baselines",()=>{
  const base=fixture(); base.identity.vsp="other";
  expect(checkReport(fixture(),base).errors).to.include("Incompatible baseline identity: vsp");
  base.complete=false; expect(checkReport(fixture(),base).errors).to.include("Baseline lifecycle evidence is invalid");
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
