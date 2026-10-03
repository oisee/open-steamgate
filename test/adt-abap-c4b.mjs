import {expect} from 'chai';
import {readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {previewPair} from './helpers/adt-preview.mjs';
import {ObjectStore} from '../tools/osd-store.mjs';
import {COMMANDS, StoreDestination, withSystem} from '../tools/osd-store-destination.mjs';
import {box, answerOf} from './helpers/destination.mjs';
import {dialogStep} from '../tools/osd-dialog-step.mjs';

async function storeCall(command, input, store) {
  const sig={exporting:{IV_COMMAND:box(command),IV_JSON:box(JSON.stringify(input))},importing:{EV_JSON:box(''),EV_ERROR:box('')}};
  await withSystem(()=>undefined, ()=>new StoreDestination({store:{read(){throw new Error('unbound store used');}}}).call('ZOSD_STORE',sig),{store});
  return answerOf(sig);
}

describe('C4b modelled DDIC and CDS preview', function () {
  this.timeout(120000);let pair;
  before(async () => {pair=await previewPair();});
  after(async () => {await pair?.close();});
  for(const name of ['zstg_flightfact','zosd_test_item','%7Astg_demo','unknown']) {
    for(const method of ['GET','HEAD']) it(`${method} ddic metadata ${name}`,async()=> {await pair.diff(method,`/sap/bc/adt/datapreview/ddic/${name}/metadata`);});
  }
  for(const name of ['zc_stg_travel','unknown']) for(const method of ['GET','HEAD']) it(`${method} cds metadata ${name}`,async()=>{await pair.diff(method,`/sap/bc/adt/datapreview/cds/${name}/metadata`);});
  for(const [kind,param,name] of [['ddic','ddicEntityName','zstg_demo'],['cds','ddlSourceName','zc_stg_travel']]) {
    const base=`/sap/bc/adt/datapreview/${kind}?${param}=${name}`;
    for(const body of ['', '  \n\t ', '\u00a0\ufeff', `SELECT * FROM ${name}`, `SELECT mandt travel_id FROM ${name}`, `SELECT COUNT( * ) FROM ${name}`,
      `SELECT * FROM ${name} UP TO 5 ROWS`, `SELECT * FROM ${name} WHERE 1=0`, 'DELETE FROM zstg_demo', 'SELECT broken FROM zstg_demo', 'SELECT FROM']) {
      it(`${kind} POST body ${JSON.stringify(body)}`,async()=>{await pair.diff('POST',base,body);});
    }
    for(const limit of ['', '5','abc','0','5&rowNumber=3']) it(`${kind} rowNumber=${limit}`,async()=>{await pair.diff('POST',base+'&rowNumber='+limit);});
    for(const query of ['', `${param}=unknown`,`${param}=`,`${param}=a&${param}=b`,`${param}=%zz%2B+`]) it(`${kind} bad name ${query}`,async()=>{await pair.diff('POST',`/sap/bc/adt/datapreview/${kind}?${query}`,'DELETE FROM zstg_demo');});
  }
  it('DDIC POST resolves a CDS name without a CDS header', async()=> {
    const result=await pair.diff('POST','/sap/bc/adt/datapreview/ddic?ddicEntityName=zc_stg_travel');expect(result.body).not.to.contain('<dataPreview:cdsEntityName>');
  });
  it('refuses CDS metadata through require when PARSE is unavailable', async () => {
    const index = COMMANDS.indexOf('PARSE'); COMMANDS.splice(index,1);
    try {expect((await pair.request(1,'GET','/sap/bc/adt/datapreview/cds/zc_stg_travel/metadata')).status).to.equal(501);}
    finally {COMMANDS.splice(index,0,'PARSE');}
  });
  it('PARSE DDLS uses the bound store and rejects other kinds',async()=>{
    const answer=await storeCall('PARSE',{kind:'DDLS',name:'ZC_STG_TRAVEL'},pair.shared);
    expect(JSON.parse(answer.EV_JSON).found).to.equal(true);
    for(const kind of ['OUTLINE','BOGUS','']) {const refused=await storeCall('PARSE',{kind},pair.shared);expect(JSON.parse(refused.EV_JSON).error.code).to.equal('NOT_SUPPORTED');expect(refused.EV_ERROR).to.equal(`unknown PARSE kind ${kind}`);}
    const absent=await storeCall('PARSE',{kind:'DDLS',name:'ZUNKNOWN'},pair.shared);expect(JSON.parse(absent.EV_JSON)).to.deep.equal({found:false});
  });
  for(const [method,path,body] of [['GET','/sap/bc/adt/datapreview/ddic/zstg_demo/metadata',''],['POST','/sap/bc/adt/datapreview/ddic?ddicEntityName=zstg_demo',''],
    ['GET','/sap/bc/adt/datapreview/cds/zc_stg_travel/metadata',''],['POST','/sap/bc/adt/datapreview/cds?ddlSourceName=zc_stg_travel','']]) {
    it(`red proof: renderer mutation caught on ${method} ${path}`,async()=>{
      const cls=abap.Classes.ZCL_OSD_ADT_TABLEDATA,original=cls.document;
      cls.document=async(...args)=>{const v=await original.apply(cls,args);v.set(v.get().replace('isHanaAnalyticalView>false','isHanaAnalyticalView>true'));return v;};
      try {let failed=false;try{await pair.diff(method,path,body);}catch{failed=true;}expect(failed).to.equal(true);}finally{cls.document=original;}
    });
  }
});

describe('C4b includes, associations, joins and wide-table READ cost',function(){
  this.timeout(120000);let root,pair,store;
  before(async()=>{
    root=mkdtempSync(join(tmpdir(),'osd-c4-ddic-'));mkdirSync(join(root,'src'));
    writeFileSync(join(root,'abaplint.jsonc'),JSON.stringify({global:{files:'src/**/*.*',skipGeneratedGatewayClasses:true},syntax:{version:'v702'},rules:{}}));
    writeFileSync(join(root,'abap_transpile.json'),JSON.stringify({input_folder:['src']}));
    const put=(file,source)=>writeFileSync(join(root,'src',file),source);
    put('zc4_domain.doma.xml','<abapGit><DD01V><DOMNAME>ZC4_DOMAIN</DOMNAME><DATATYPE>CHAR</DATATYPE><LENG>000001</LENG></DD01V></abapGit>');
    put('zc4_element.dtel.xml','<abapGit><DD04V><ROLLNAME>ZC4_ELEMENT</ROLLNAME><DOMNAME>ZC4_DOMAIN</DOMNAME><DDTEXT>Resolved &amp; description</DDTEXT></DD04V></abapGit>');
    const fields=Array.from({length:120},(_,i)=>`<DD03P><FIELDNAME>F${String(i).padStart(3,'0')}</FIELDNAME><ROLLNAME>ZC4_ELEMENT</ROLLNAME></DD03P>`).join('');
    put('zc4_wide.tabl.xml',`<abapGit><DD02V><TABNAME>ZC4_WIDE</TABNAME><TABCLASS>TRANSP</TABCLASS></DD02V><DD03P_TABLE><DD03P><FIELDNAME>.INCLUDE</FIELDNAME></DD03P>${fields}</DD03P_TABLE></abapGit>`);
    put('zc4_nan.tabl.xml','<abapGit><DD03P_TABLE><DD03P><FIELDNAME>VALUE</FIELDNAME><DATATYPE>CHAR</DATATYPE><LENG>bogus</LENG></DD03P></DD03P_TABLE></abapGit>');
    put('zc4_assoc.ddls.asddls' ,"define view entity ZC4_ASSOC as select from zc4_wide association [0..1] to zc4_wide as _Peer on $projection.FieldZero = _Peer.f000 { key f000 as FieldZero, _Peer }");
    put('zc4_join.ddls.asddls',"define view entity ZC4_JOIN as select from zc4_wide as a inner join zc4_wide as b on a.f000 = b.f000 { key a.f000 as LeftField, b.f001 as RightField }");
    store=new ObjectStore({root,libs:[]});pair=await previewPair({store});
  });
  after(async()=>{await pair?.close();rmSync(root,{recursive:true,force:true});});
  it('skips dot rows and resolves DTEL -> DOMA without sorting',async()=>{
    const result=await pair.diff('GET','/sap/bc/adt/datapreview/ddic/zc4_wide/metadata');expect(result.status,result.body).to.equal(200);
    expect(result.body).not.to.contain('.INCLUDE');expect(result.body).to.contain('Resolved &amp; description');
    expect(result.body.match(/dataPreview:length="1"/g)).to.have.length(120);
  });
  it('retains NaN length text without a numeric conversion dump', async () => {
    const result = await pair.diff('GET','/sap/bc/adt/datapreview/ddic/zc4_nan/metadata');
    expect(result.status,result.body).to.equal(200);expect(result.body).to.contain('dataPreview:length="NaN"');
  });
  for(const name of ['zc4_assoc','zc4_join']) it(`CDS metadata ${name}`,async()=> {
    const result=await pair.diff('GET',`/sap/bc/adt/datapreview/cds/${name}/metadata`);expect(result.status,result.body).to.equal(200);
    if(name==='zc4_assoc')expect(result.body).not.to.contain('_PEER');else expect(result.body).to.contain('dataPreview:length="0"');
  });
  it('measures cached READ cost on 120 resolved fields',async()=>{
    const original=store.read.bind(store);let reads=0;store.read=(...args)=>{reads++;return original(...args);};
    try {
      const start=performance.now();
      const result=await withSystem(()=>undefined,()=>dialogStep(()=>abap.Classes.ZCL_OSD_ADT_PREVIEW.table_fields({iv_name:new abap.types.String().set('ZC4_WIDE')})),{store});
      const elapsed=performance.now()-start;
      expect(result.array()).to.have.length(120);expect(reads).to.equal(3);
      console.log(`C4b wide table: 120 fields, ${reads} READs, ${elapsed.toFixed(2)} ms, ${(elapsed/120).toFixed(3)} ms/field`);
    }finally{store.read=original;}
  });
});
