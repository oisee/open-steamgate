// B6 acceptance instrument: full repository, 20 warm wire medians.
import {expect} from 'chai';
import './start.mjs';
import {ObjectStore} from '../tools/osd-store.mjs';
import {performance} from 'node:perf_hooks';
export const median = (values) => [...values].sort((a,b) => a-b)[Math.floor(values.length/2)];
describe('B6 ajson volume cost', function () {
  this.timeout(120000);
  it('measures the full repo package/object JSON parse cost', async () => {
    const store = new ObjectStore({root:process.cwd()});
    const packages = store.packages().map((p) => ({name:p.name,parent:p.parent,description:p.description,library:p.library,subpackages:p.subpackages, objects:store.package(p.name).objects}));
    const json = JSON.stringify(packages);
    const times = [];
    for (let i=0;i<21;i++) {
      const start = performance.now();
      await abap.Classes.ZCL_AJSON.parse({iv_json:new abap.types.String().set(json)});
      if(i) times.push(performance.now()-start);
    }
    const ms = median(times);
    console.log(`B6 COST ${packages.length} packages, ${packages.reduce((n,p)=>n+p.objects.length,0)} objects, ${Buffer.byteLength(json)} bytes; ajson parse median ${ms.toFixed(2)} ms; 19 parses ${(19*ms).toFixed(2)} ms`);
    expect(times).to.have.length(20);
  });
});

describe('B6 full repository wire cost', function () {
  this.timeout(120000);
  it('measures Node and ABAP search and VFS medians of 20', async () => {
    const {default:express}=await import('express');
    const {adtRouter}=await import('../tools/adt-facade.mjs');
    const {abapRunner}=await import('../tools/adt-abap-front.mjs');
    const {dialogStep}=await import('../tools/osd-dialog-step.mjs');
    const store=new ObjectStore({root:process.cwd()});
    const sides=[];
    try {
      for(const ported of [false,true]) {
        const app=express(); app.set('etag',false); app.use(express.raw({type:'*/*'}));
        let served;
        app.use(adtRouter({store,data:{},watch:false,logMisses:false,...(ported?{
          abap:abapRunner({handler:abap.Classes.ZCL_OSD_ADT_HANDLER,step:dialogStep}),
          abapServed:(by)=>{served=by;}
        }:{})}).router);
        const server=await new Promise((resolve)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
        const url=`http://127.0.0.1:${server.address().port}`;
        sides.push(server);
        const warm=await fetch(url+'/sap/bc/adt/b6/warmup',{headers:{'x-csrf-token':'fetch'}}); await warm.arrayBuffer();
        const headers={cookie:warm.headers.getSetCookie().map((c)=>c.split(';')[0]).join('; '),'x-csrf-token':warm.headers.get('x-csrf-token')};
        for(const [name,path,method,body] of [['search','search?query=ZCL*&maxResults=100','GET',undefined],['vfs','virtualfolders/contents','POST','<vfs:facet>group</vfs:facet>']]) {
          const times=[];
          for(let i=0;i<21;i++) {
            const start=performance.now();
            const res=await fetch(url+'/sap/bc/adt/repository/informationsystem/'+path,{method,headers,...(body===undefined?{}:{body})});
            await res.arrayBuffer();
            expect(res.status).to.equal(200);
            if(ported) expect(served).to.equal('ABAP');
            if(i) times.push(performance.now()-start);
          }
          const ms=median(times);
          console.log(`B6 WIRE ${ported?'ABAP':'Node'} ${name} median ${ms.toFixed(2)} ms`);
          if(ported && name==='search') expect(ms, 'B6 search must stay below 10 ms').to.be.lessThan(10);
        }
      }
    } finally {
      for(const server of sides) await new Promise((resolve)=>server.close(resolve));
    }
  });
});
