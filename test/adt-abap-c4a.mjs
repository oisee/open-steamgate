import {COMMANDS} from '../tools/osd-store-destination.mjs';
import {previewSQL} from '../tools/adt-preview-sql.mjs';
import {previewPair} from './helpers/adt-preview.mjs';
import {readFileSync} from 'node:fs';
import {harnessEntries, runAll} from '../tools/osd-unit-all.mjs';
import {expect} from 'chai';
import './start.mjs';
import {dialogStep} from '../tools/osd-dialog-step.mjs';


describe('C4a freestyle data preview', function () {
  this.timeout(120000); let pair;
  before(async () => {pair = await previewPair();});
  after(async () => {await pair?.close();});
  const route = '/sap/bc/adt/datapreview/freestyle';
  for(const sql of ['SELECT * FROM zstg_demo', 'SELECT travel_id description FROM zstg_demo UP TO 5 ROWS', 'SELECT COUNT( * ) FROM zstg_demo',
    'SELECT * FROM zstg_demo WHERE 1=0', "SELECT 7 AS n, 1.25 AS real, NULL AS empty, '&<>\"  ' AS special FROM zstg_demo", 'SELECT travel_id AS twin, description AS twin FROM zstg_demo', '', '   ', 'DELETE FROM zstg_demo', 'SELECT broken FROM zstg_demo', 'SELECT FROM']) {
    it(`byte diff query ${JSON.stringify(sql)}`, async () => {await pair.diff('POST', route, sql);});
  }
  for(const limit of ['', '5', 'abc', '0', '5&rowNumber=3']) it(`rowNumber=${limit}`, async () => {await pair.diff('POST', route+'?rowNumber='+limit, 'SELECT * FROM zstg_demo');});
  for(const sql of ['SELECT * FROM zstg_demo', 'SELECT broken FROM zstg_demo', 'DELETE FROM zstg_demo', '']) {
    for(const uri of ['', '&uniqueURI=u%26%22%3C%3E', '&uniqueURI=a&uniqueURI=b', '&uniqueURI=%zz%2B+']) it(`check ${sql} ${uri}`, async () => {await pair.diff('POST', route+'?action=checkSyntax'+uri, sql);});
  }
  it('preserves row and column order past array index 9', async () => {
    const sql = Array.from({length:15}, (_, i) => 'SELECT '+Array.from({length:12}, (_, j) => `${i*100+j} AS c${j}`).join(', ')).join(' UNION ALL ');
    const result = await pair.diff('POST', route, sql);
    expect(result.status).to.equal(200);
  });
  it('action is case sensitive', async () => {await pair.diff('POST', route+'?action=checksyntax', 'SELECT * FROM zstg_demo');});
  it('a refused SELECT keeps the session row', async () => {
    const raw = abap.context.databaseConnections.DEFAULT;
    const before = await raw.select({select: 'SELECT COUNT(*) AS n FROM zosd_adt_sess'});
    const reply = await pair.diff('POST', route, 'SELECT CAST(description AS INTEGER) FROM zstg_demo');
    const after = await raw.select({select: 'SELECT COUNT(*) AS n FROM zosd_adt_sess'});
    expect(after.rows).to.deep.equal(before.rows);
    expect([200,400]).to.include(reply.status);
  });
  it('refuses through require when SYSTEM is unavailable', async () => {
    const index = COMMANDS.indexOf('SYSTEM'); COMMANDS.splice(index,1);
    try {expect((await pair.request(1,'POST',route,'SELECT * FROM zstg_demo')).status).to.equal(501);}
    finally {COMMANDS.splice(index,0,'SYSTEM');}
  });
  it('a failed SYSTEM SELECT preserves a newly pending session row', async () => {
    const raw = abap.context.databaseConnections.DEFAULT;
    const id = 'c4pending0000000000000000';
    await dialogStep(async () => {
      const inserted = await raw.insert({table:'zosd_adt_sess',columns:['mandt','id','username','token','stateful','created','touched'],
        values:["'001'",`'${id}'`,"'TEST'","''","''",'0','0']});
      expect(inserted.subrc).to.equal(0);
      const answer = await previewSQL(raw, 'SQL', {statement:raw.name === 'duckdb'
        ? 'SELECT CAST(description AS INTEGER) FROM zstg_demo' : 'SELECT broken FROM zstg_demo'});
      expect(answer).to.have.property('error');
      expect(await previewSQL(raw, 'SQLCHECK', {statement:'SELECT broken FROM zstg_demo'})).to.have.property('error');
      expect((await raw.select({select:`SELECT id FROM zosd_adt_sess WHERE id='${id}'`})).rows).to.have.length(1);
    });
    try {expect((await raw.select({select:`SELECT id FROM zosd_adt_sess WHERE id='${id}'`})).rows).to.have.length(1);}
    finally {await dialogStep(() => raw.delete({table:'zosd_adt_sess',where:`id='${id}'`}));}
  });
  it('red proof: changing a renderer byte breaks the route diff', async () => {
    const cls = abap.Classes.ZCL_OSD_ADT_TABLEDATA, original = cls.document;
    cls.document = async (...args) => {const v = await original.apply(cls,args);v.set(v.get().replace('\n\n', '\n'));return v;};
    try {let failed = false;try {await pair.diff('POST',route,'SELECT * FROM zstg_demo');} catch {failed = true;}expect(failed).to.equal(true);}
    finally {cls.document = original;}
  });
  it('ABAP Unit: renderer and reused CHECKREPORT/HOST', async () => {
    const entries = harnessEntries(readFileSync('output/index.mjs', 'utf8')).filter(e => ['ZCL_OSD_ADT_TABLEDATA','ZCL_OSD_ADT_CHECKREPORT','ZCL_OSD_ADT_HOST','ZCL_OSD_ADT_FREESTYLE','ZCL_OSD_ADT_DDIC','ZCL_OSD_ADT_PREVIEW'].includes(e.objectName));
    const result = await runAll(entries, file => import('../output/'+file));
    expect(result.failed).to.have.length(0);
  });
});
