import {expect} from 'chai';
import {mkdtempSync, rmSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fork} from 'node:child_process';
import {FileSqliteClient} from '../tools/sqlite-file-client.mjs';
import {DuckDBDatabaseClient} from '../tools/duckdb-client.mjs';
import {startupDatabase} from '../tools/osd-db-migrate.mjs';
import {tableDDL, classifyTable, catalog} from '../tools/osd-db-schema.mjs';
import {databaseDescriptor} from '../tools/osd-database-identity.mjs';
import {databaseFacts} from '../tools/osd-status.mjs';
import {fingerprintOf} from '../tools/osd-persist.mjs';
import {HanaDatabaseClient} from '../tools/hana-client.mjs';
const insert = [`INSERT INTO "tadir" VALUES ('R3TR','CLAS','Z_PROBE')`];
function child(engine,path) {
  const worker=fork(resolve('test/fixtures/db-migration-start.mjs'),[engine,path],{silent:true});
  const exited=new Promise(resolve=>worker.once('exit',resolve));
  let stderr='', readyResolve, connectedResolve;
  const ready=new Promise((r,j)=>{readyResolve=r;worker.once('exit',code=>j(new Error(`worker exited ${code}: ${stderr}`)));});
  const connected=new Promise(r=>connectedResolve=r);
  worker.stderr.on('data',chunk=>stderr+=chunk);
  worker.on('message',message=>{if(message.connected)connectedResolve();if(message.ready)readyResolve(message);});
  // Observe an early failure while waiting for the connection.
  ready.catch(()=>{});
  return {worker,ready,connected,go:()=>worker.send('go'),stop:async()=>{if(worker.exitCode===null&&worker.signalCode===null)worker.kill();await exited;}};
}
for (const engine of ['sqlite','duckdb']) describe(`${engine} per-table startup migration`, function() {
  this.timeout(40000);let dir,db;
  const type=engine==='sqlite'?'NCHAR':'VARCHAR';
  const ddl=(columns='')=>[`CREATE TABLE user_data(id INT PRIMARY KEY, value ${type}(8)${columns})`,
    'CREATE TABLE tadir(pgmid TEXT, object TEXT, obj_name TEXT, PRIMARY KEY(pgmid,object,obj_name))'];
  beforeEach(async()=>{dir=mkdtempSync(join(tmpdir(),'osd-table-migrate-'));db=engine==='sqlite'?new FileSqliteClient({path:join(dir,'db.sqlite')}):new DuckDBDatabaseClient({path:join(dir,'db.duckdb')});await db.connect();});
  afterEach(async()=>{await db.disconnect();rmSync(dir,{recursive:true,force:true});});
  it('adds tables/nullable/defaulted columns and keeps business rows',async()=>{
    await startupDatabase(db,ddl(),insert);await db.execute("INSERT INTO user_data VALUES(1,'keep')");
    const wanted=[...ddl(", extra TEXT, count INT NOT NULL DEFAULT 7"),'CREATE TABLE new_data(id INT)'];
    const result=await startupDatabase(db,wanted,insert,{seed:["INSERT INTO new_data VALUES(2)"]});
    expect(result.aside).to.deep.equal([]);expect(result.created).to.deep.equal(['new_data']);
    expect(await db.query('SELECT value,count FROM user_data')).to.deep.equal([{value:'keep',count:7}]);
    expect(await db.query('SELECT * FROM new_data')).to.deep.equal([{id:2}]);
  });
  it('widens the ADT handle key without losing handles or other rows',async()=>{
    const before=[...ddl(),`CREATE TABLE zosd_adt_shdl(id INT, handle ${type}(36), PRIMARY KEY(id,handle))`];
    await startupDatabase(db,before,insert);await db.execute("INSERT INTO zosd_adt_shdl VALUES(1,'opaque')");
    const result=await startupDatabase(db,before.map(s=>s.replace('(36)','(40)')),insert);
    expect(result.aside).to.deep.equal([]);expect(await db.query('SELECT handle FROM zosd_adt_shdl')).to.deep.equal([{handle:'opaque'}]);
  });
  it('widens a table while preserving dependent views and business rows',async()=>{
    await startupDatabase(db,ddl(),insert);await db.execute("INSERT INTO user_data VALUES(1,'keep')");
    await db.execute('CREATE VIEW user_view AS SELECT * FROM user_data');
    await db.execute('CREATE VIEW nested_view AS SELECT * FROM user_view');
    const result=await startupDatabase(db,ddl().map(s=>s.replace('(8)','(16)')),insert);
    expect(result.aside).to.deep.equal([]);
    expect(await db.query('SELECT value FROM nested_view')).to.deep.equal([{value:'keep'}]);
    await db.execute("INSERT INTO user_data VALUES(2,'longer than eight')");
    expect(await db.query('SELECT value FROM user_view WHERE id=2')).to.deep.equal([{value:'longer than eight'}]);
  });
  if(engine==='sqlite') it('retains table/view triggers, indexes and foreign keys when widening',async()=>{
    await startupDatabase(db,ddl(),insert);
    await db.execute('PRAGMA foreign_keys=ON');
    await db.execute('CREATE TABLE child_data(id INT REFERENCES user_data(id) ON DELETE CASCADE)');
    await db.execute('CREATE TABLE audit_data(value TEXT)');
    await db.execute('CREATE VIEW user_view AS SELECT * FROM user_data');
    await db.execute('CREATE INDEX user_index ON user_data(value)');
    await db.execute('CREATE TRIGGER user_trigger AFTER INSERT ON user_data BEGIN INSERT INTO audit_data VALUES(new.value); END');
    await db.execute('CREATE TRIGGER view_trigger INSTEAD OF INSERT ON user_view BEGIN INSERT INTO user_data VALUES(new.id,new.value); END');
    await db.execute("INSERT INTO user_data VALUES(1,'keep')");await db.execute('INSERT INTO child_data VALUES(1)');
    await startupDatabase(db,ddl().map(s=>s.replace('(8)','(16)')),insert);
    expect(await db.query('PRAGMA foreign_keys')).to.deep.equal([{foreign_keys:1}]);
    expect(await db.query('SELECT * FROM child_data')).to.deep.equal([{id:1}]);
    expect(await db.query('PRAGMA foreign_key_check')).to.deep.equal([]);
    await db.execute("INSERT INTO user_view VALUES(2,'longer than eight')");
    expect(await db.query('SELECT value FROM audit_data')).to.deep.equal([{value:'keep'},{value:'longer than eight'}]);
    expect((await db.query("SELECT name FROM sqlite_master WHERE name='user_index'"))).to.have.length(1);
  });
  if(engine==='sqlite') it('rolls back a widening and restores dependencies/settings on foreign key failure',async()=>{
    await startupDatabase(db,ddl(),insert);
    await db.execute('PRAGMA foreign_keys=ON');
    await db.execute('CREATE TABLE child_data(id INT REFERENCES user_data(id))');
    await db.execute('CREATE VIEW user_view AS SELECT * FROM user_data');
    await db.execute('CREATE TRIGGER view_trigger INSTEAD OF INSERT ON user_view BEGIN INSERT INTO user_data VALUES(new.id,new.value); END');
    const stamp=(await db.query('SELECT fingerprint FROM osd_schema'))[0].fingerprint;
    let error;try {await startupDatabase(db,ddl().map(s=>s.replace('(8)','(16)')),insert,{reseed:async()=>db.execute('INSERT INTO child_data VALUES(9)')});}catch(e){error=e;}
    expect(error?.message).to.include('foreign_key_check');
    expect(await db.query('PRAGMA foreign_keys')).to.deep.equal([{foreign_keys:1}]);
    expect(await db.query('SELECT * FROM child_data')).to.deep.equal([]);
    expect((await db.query('SELECT fingerprint FROM osd_schema'))[0].fingerprint).to.equal(stamp);
    expect((await db.query("PRAGMA table_info('user_data')")).find(c=>c.name==='value').type).to.equal('NCHAR(8)');
    await db.execute("INSERT INTO user_view VALUES(1,'keep')");
    expect(await db.query('SELECT value FROM user_view')).to.deep.equal([{value:'keep'}]);
  });
  if(engine==='sqlite') it('restores a user trigger on a generation-owned view after widening',async()=>{
    const schema=[...ddl(),'CREATE VIEW generated_view AS SELECT * FROM user_data'];
    await startupDatabase(db,schema,insert);
    await db.execute('CREATE TRIGGER view_trigger INSTEAD OF INSERT ON generated_view BEGIN INSERT INTO user_data VALUES(new.id,new.value); END');
    await startupDatabase(db,schema.map(s=>s.replace('(8)','(16)')),insert);
    await db.execute("INSERT INTO generated_view VALUES(1,'longer than eight')");
    expect(await db.query('SELECT value FROM generated_view')).to.deep.equal([{value:'longer than eight'}]);
  });
  if(engine==='sqlite') it('rolls back a generated-row refresh that orphans a child with unchanged DDL',async()=>{
    const schema=['CREATE TABLE tadir(id INT PRIMARY KEY)'];
    await startupDatabase(db,schema,['INSERT INTO tadir VALUES(1)']);
    await db.execute('PRAGMA foreign_keys=ON');
    await db.execute('CREATE TABLE child_data(id INT REFERENCES tadir(id))');
    await db.execute('INSERT INTO child_data VALUES(1)');
    const boot=await db.query('SELECT fingerprint FROM osd_schema_boot');
    let error;try{await startupDatabase(db,schema,['INSERT INTO tadir VALUES(2)']);}catch(e){error=e;}
    expect(error?.message).to.include('foreign_key_check');
    expect(await db.query('SELECT * FROM tadir')).to.deep.equal([{id:1}]);
    expect(await db.query('SELECT * FROM child_data')).to.deep.equal([{id:1}]);
    expect(await db.query('SELECT fingerprint FROM osd_schema_boot')).to.deep.equal(boot);
    expect(await db.query('PRAGMA foreign_keys')).to.deep.equal([{foreign_keys:1}]);
    expect(await db.query('PRAGMA foreign_key_check')).to.deep.equal([]);
  });
  for(const change of ['narrow','type','drop','key']) it(`preserves only the incompatible data table (${change}) and reports it across restarts`,async()=>{
    await startupDatabase(db,ddl(),insert);await db.execute("INSERT INTO user_data VALUES(1,'keep')");
    const column=change==='narrow'?`${type}(4)`:change==='type'?'INT':`${type}(8)`;
    const table=change==='drop'?'CREATE TABLE user_data(id INT PRIMARY KEY)':change==='key'?`CREATE TABLE user_data(id INT, value ${column}, PRIMARY KEY(id,value))`:`CREATE TABLE user_data(id INT PRIMARY KEY,value ${column})`;
    const logs=[];const result=await startupDatabase(db,[table,ddl()[1]],insert,{log:s=>logs.push(s)});
    expect(result.aside).to.have.length(1);const backup=result.aside[0].backup;
    expect(await db.query(`SELECT value FROM "${backup}"`)).to.deep.equal([{value:'keep'}]);
    expect(await db.query('SELECT * FROM tadir')).to.have.length(1);
    expect(logs.join()).to.include('user_data').and.include(backup);
    expect(databaseDescriptor(db).schemaDrift[0]).to.include({table:'user_data',backup});
    expect(databaseFacts({client:db}).some(row=>row.name==='user_data'&&row.value===backup)).to.equal(true);
    await startupDatabase(db,[table,ddl()[1]],insert);
    expect(db.schemaDrift).to.have.length(1);expect(readdirSync(dir).some(name=>name.endsWith('.drift'))).to.equal(false);
  });
  it('regenerates incompatible generated metadata, keeping data tables',async()=>{
    await startupDatabase(db,ddl(),insert);await db.execute("INSERT INTO user_data VALUES(1,'keep')");
    const wanted=[ddl()[0],'CREATE TABLE tadir(pgmid TEXT, object TEXT, obj_name TEXT, extra TEXT, PRIMARY KEY(pgmid,obj_name))'];
    const result=await startupDatabase(db,wanted,insert.map(s=>s.replace("VALUES (","(pgmid,object,obj_name) VALUES (")));
    expect(result.rebuilt).to.deep.equal(['tadir']);expect(result.aside).to.deep.equal([]);
    expect(await db.query('SELECT value FROM user_data')).to.deep.equal([{value:'keep'}]);
  });
  it('rolls migration, refresh, backups and stamp back together on failure',async()=>{
    await startupDatabase(db,ddl(),insert);await db.execute("INSERT INTO user_data VALUES(1,'keep')");
    const before=(await db.query('SELECT fingerprint FROM osd_schema'))[0].fingerprint;
    let error;try {await startupDatabase(db,ddl().map(s=>s.replace(`${type}(8)`,'INT')),insert,{reseed:async()=>{throw new Error('failed refresh');}});}catch(e){error=e;}
    expect(error?.message).to.equal('failed refresh');expect((await db.query('SELECT fingerprint FROM osd_schema'))[0].fingerprint).to.equal(before);
    expect(await db.query('SELECT value FROM user_data')).to.deep.equal([{value:'keep'}]);
    expect(await db.query('SELECT * FROM osd_schema_drift')).to.deep.equal([]);
  });
  it('startup releases the LUW so subsequent writes can roll back',async()=>{
    await startupDatabase(db,ddl(),insert);
    expect(db.inTransaction).to.equal(false);
    await db.insert({table:'user_data',columns:['id','value'],values:['1',"'pending'"]});
    expect(db.inTransaction).to.equal(true);await db.rollback();
    expect(await db.query('SELECT * FROM user_data')).to.deep.equal([]);
  });
  it('strict mode refuses only an incompatible data change and preserves the stamp',async()=>{
    await startupDatabase(db,ddl(),insert);await db.execute("INSERT INTO user_data VALUES(1,'keep')");
    const before=(await db.query('SELECT fingerprint FROM osd_schema'))[0].fingerprint;
    let error;try{await startupDatabase(db,ddl().map(s=>s.replace(`${type}(8)`,'INT')),insert,{strict:true});}catch(e){error=e;}
    expect(error?.code).to.equal('SCHEMA_DRIFT');expect(error.message).to.include('user_data');
    expect((await db.query('SELECT fingerprint FROM osd_schema'))[0].fingerprint).to.equal(before);
    expect(await db.query('SELECT value FROM user_data')).to.deep.equal([{value:'keep'}]);
    expect((await startupDatabase(db,ddl(', extra TEXT'),insert,{strict:true})).aside).to.deep.equal([]);
  });
  it('migrates an old catalog with a source identity without moving unrelated tables',async()=>{
    await db.execute(ddl());await db.execute("INSERT INTO user_data VALUES(1,'keep')");
    await db.execute('CREATE TABLE zosd_job_source_instance(id TEXT PRIMARY KEY)');
    await db.execute("INSERT INTO zosd_job_source_instance VALUES('0123456789abcdef0123456789abcdef')");
    await db.execute('CREATE TABLE unrelated(id INT)');await db.execute('INSERT INTO unrelated VALUES(9)');
    const result=await startupDatabase(db,ddl(', extra TEXT'),insert);
    expect(result.aside).to.deep.equal([]);expect(await db.query('SELECT * FROM unrelated')).to.deep.equal([{id:9}]);
  });
  it('refuses an unstamped foreign tadir without dropping or changing anything',async()=>{
    await db.execute('CREATE TABLE tadir(customer_order TEXT)');
    await db.execute("INSERT INTO tadir VALUES('customer row')");
    const calls=[],execute=db.execute.bind(db);db.execute=async sql=>{calls.push(...[sql].flat());return execute(sql);};
    let error;try{await startupDatabase(db,ddl(),insert);}catch(e){error=e;}
    expect(error?.code).to.equal('DATABASE_NOT_OWNED');expect(error.message).to.include('Existing data left intact');
    expect(calls.some(sql=>/^(DROP|ALTER|CREATE|INSERT|DELETE|UPDATE)\b/i.test(sql))).to.equal(false);
    expect(await db.query('SELECT * FROM tadir')).to.deep.equal([{customer_order:'customer row'}]);
    expect((await catalog({query:sql=>db.query(sql)},engine)).filter(t=>t.type==='table').map(t=>t.name)).to.deep.equal(['tadir']);
  });
  it('an empty stamp or source identity does not authorize rebuilding foreign tables',async()=>{
    await db.execute('CREATE TABLE tadir(customer_order TEXT)');await db.execute("INSERT INTO tadir VALUES('keep')");
    await db.execute('CREATE TABLE osd_schema(fingerprint TEXT)');
    await db.execute('CREATE TABLE zosd_job_source_instance(id TEXT)');
    let error;try{await startupDatabase(db,ddl(),insert);}catch(e){error=e;}
    expect(error?.code).to.equal('DATABASE_NOT_OWNED');
    expect(await db.query('SELECT * FROM tadir')).to.deep.equal([{customer_order:'keep'}]);
  });
  it('refuses unstamped customer tables outside the default schema',async()=>{
    if(engine==='sqlite')await db.execute(`ATTACH DATABASE '${join(dir,'customer.sqlite')}' AS customer`);
    else await db.execute('CREATE SCHEMA customer');
    await db.execute('CREATE TABLE customer.tadir(customer_order TEXT)');
    await db.execute("INSERT INTO customer.tadir VALUES('keep')");
    let error;try{await startupDatabase(db,ddl(),insert);}catch(e){error=e;}
    expect(error?.code).to.equal('DATABASE_NOT_OWNED');
    expect(error.message).to.include(db.path).and.include('no OSD schema stamp or identity')
      .and.include('Keep the old').and.include('start fresh').and.include('copy');
    expect(await db.query('SELECT * FROM customer.tadir')).to.deep.equal([{customer_order:'keep'}]);
    const mainTables=engine==='sqlite'?await db.query("SELECT name FROM main.sqlite_master WHERE type='table'"):
      await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='main'");
    expect(mainTables).to.deep.equal([]);
  });
  it('adds and drops generation indexes without dropping rows',async()=>{
    await startupDatabase(db,[...ddl(),'CREATE INDEX osd_probe ON user_data(value)'],insert);
    await db.execute("INSERT INTO user_data VALUES(1,'keep')");
    await startupDatabase(db,ddl(),insert);
    const access={query:sql=>db.query(sql)};
    expect((await catalog(access,engine)).some(row=>row.type==='index'&&row.name==='osd_probe')).to.equal(false);
    expect(await db.query('SELECT value FROM user_data')).to.deep.equal([{value:'keep'}]);
  });
  it('does no migration or refresh work for identical stamps',async()=>{
    await startupDatabase(db,ddl(),insert);
    const result=await startupDatabase(db,ddl(),insert,{reseed:()=>{throw new Error('should not refresh');}});
    expect(result).to.deep.equal({migrated:false,created:[],rebuilt:[],aside:[],changed:[]});
    expect(db.inTransaction).to.equal(false);
  });
  it('two processes migrate once, both serve, and a stale reader sees the new stamp',async()=>{
    await startupDatabase(db,ddl(),insert);await db.execute("INSERT INTO user_data VALUES(1,'keep')");
    const path=db.path;await db.disconnect();
    const a=child(engine,path),b=child(engine,path);
    try {
      await Promise.all([a.connected,b.connected]);
      // A is connected to the old schema before B migrates. Delay A's
      // startup until B has committed, exercising the stale-read interleaving.
      b.go();const second=await b.ready;a.go();const first=await a.ready;
      expect([first,second].filter(r=>r.result.migrated)).to.have.length(1);
      for(const started of [first,second]) {
        const reply=await (await fetch(`http://127.0.0.1:${started.port}/`)).json();
        expect(reply.rows[0].value).to.equal('keep');expect(reply.result.aside).to.deep.equal([]);
        await fetch(`http://127.0.0.1:${started.port}/done`);
      }
      await db.connect();
      // Simultaneous starts from a different old stamp.
      await db.execute(`UPDATE osd_schema SET fingerprint='old'`);await db.disconnect();
      const c=child(engine,path),d=child(engine,path);
      try {
        await Promise.all([c.connected,d.connected]);c.go();d.go();
        const started=await Promise.all([c.ready,d.ready]);expect(started.filter(r=>r.result.migrated)).to.have.length(1);
        for(const peer of started) {const response=await fetch(`http://127.0.0.1:${peer.port}/`);expect(response.status).to.equal(200);await fetch(`http://127.0.0.1:${peer.port}/done`);}
      }finally {await Promise.all([c.stop(),d.stop()]);}
      expect(readdirSync(dir).some(name=>name.endsWith('.drift'))).to.equal(false);
    }finally {await Promise.all([a.stop(),b.stop()]);await db.connect();}
  });
});
describe('DuckDB startup waits for an active application LUW',function(){
  this.timeout(20000);
  it('waits for another connection to commit before taking the catalog snapshot',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'osd-duckdb-luw-migrate-'));
    const path=join(dir,'db.duckdb');
    const a=new DuckDBDatabaseClient({path}),b=new DuckDBDatabaseClient({path});
    try {
      await a.connect();await b.connect();
      const ddl=['CREATE TABLE user_data(id INT PRIMARY KEY,value TEXT)'];
      await startupDatabase(a,ddl,[]);
      await a.write({sql:"INSERT INTO user_data VALUES(1,'committed before migration')"});
      let complete=false;const migration=startupDatabase(b,[ddl[0].replace('value TEXT','value TEXT, extra TEXT')],[]).then(result=>{complete=true;return result;});
      await new Promise(r=>setTimeout(r,50));expect(complete).to.equal(false);
      await a.commit();expect((await migration).aside).to.deep.equal([]);
      expect(await b.query('SELECT value FROM user_data')).to.deep.equal([{value:'committed before migration'}]);
    }finally{await a.disconnect();await b.disconnect();rmSync(dir,{recursive:true,force:true});}
  });
});
describe('PostgreSQL classification and startup advisory lock',()=>{
  it('recognizes character widening and incompatible primary key changes',()=>{
    const old=tableDDL('CREATE TABLE data(id INT,value NCHAR(36),PRIMARY KEY(id,value))','postgres');
    expect(classifyTable(old,tableDDL(old.sql.replace('(36)','(40)'),'postgres')).kind).to.equal('compatible');
    expect(classifyTable(old,tableDDL(old.sql.replace('PRIMARY KEY(id,value)','PRIMARY KEY(id)'),'postgres')).kind).to.equal('incompatible');
  });
  it('reads stamps only after acquiring the lock on the transaction session',async()=>{
    const calls=[];const ddl=['CREATE TABLE data(id INT)'];const insert=[];const boot=fingerprintOf([ddl,insert,[]]);
    const db={name:'postgres',beginTransaction:async()=>calls.push('begin'),query:async sql=>{
      calls.push(sql);
      if(sql.includes('pg_advisory'))return {rows:[]};
      if(sql.includes('information_schema.tables'))return {rows:[{}]};
      if(sql.includes('osd_schema_drift'))return {rows:[]};
      return {rows:[{fingerprint:sql.includes('osd_schema_boot')?boot:fingerprintOf(ddl)}]};
    },commit:async()=>calls.push('commit'),rollback:async()=>calls.push('rollback')};
    await startupDatabase(db,ddl,insert);
    expect(calls[0]).to.equal('begin');expect(calls[1]).to.include('pg_advisory_xact_lock');expect(calls.at(-1)).to.equal('commit');
  });
});

describe('PostgreSQL migration transaction (catalog/session fixture)',()=>{
  function fixture({fail=false,foreign=false}={}) {
    const calls=[];
    const db={name:'postgres',beginTransaction:async()=>calls.push('BEGIN'),commit:async()=>calls.push('COMMIT'),rollback:async()=>calls.push('ROLLBACK'),
      execute:async sql=>{for(const statement of [sql].flat()){calls.push(statement);if(fail&&statement.startsWith('INSERT INTO "tadir"'))throw new Error('refresh failed');}},
      query:async sql=>{
        calls.push(sql);
        if(sql.includes('pg_advisory'))return {rows:[]};
        if(sql.includes('information_schema.tables')&&!sql.includes('JOIN'))return {rows:!foreign&&sql.includes("table_name='osd_schema'")?[{table_name:'osd_schema'}]:[]};
        if(sql.includes('SELECT c.relname AS name'))return {rows:[{name:'tadir',type:'table'}]};
        if(sql==='SELECT fingerprint FROM osd_schema LIMIT 1')return {rows:[{fingerprint:'old'}]};
        if(sql.includes('information_schema.columns'))return {rows:foreign?[{table_name:'tadir',column_name:'customer_order',data_type:'text',is_nullable:'YES'}]:[
          {table_name:'user_data',column_name:'id',data_type:'integer',is_nullable:'NO'},
          {table_name:'user_data',column_name:'value',data_type:'character',character_maximum_length:36,is_nullable:'YES'},
          {table_name:'tadir',column_name:'obj_name',data_type:'text',is_nullable:'NO'}]};
        if(sql.includes('information_schema.table_constraints'))return {rows:[{table_name:'user_data',column_name:'id'},{table_name:'tadir',column_name:'obj_name'}]};
        if(sql.startsWith('SELECT indexname FROM pg_indexes'))return {rows:[{indexname:'user_data_pkey'}]};
        return {rows:[]};
      }};
    return {db,calls};
  }
  const ddl=['CREATE TABLE user_data(id INT, value NCHAR(40), extra TEXT, PRIMARY KEY(id))', 'CREATE TABLE tadir(obj_name TEXT, PRIMARY KEY(obj_name))'];
  const insert=[`INSERT INTO "tadir" VALUES ('Z_PROBE')`];
  it('refuses an occupied unstamped catalogue before assuming ownership of tadir',async()=>{
    const {db,calls}=fixture({foreign:true});let error;
    try{await startupDatabase(db,ddl,insert);}catch(e){error=e;}
    expect(error?.code).to.equal('DATABASE_NOT_OWNED');expect(calls.at(-1)).to.equal('ROLLBACK');
    expect(calls.some(sql=>/^(DROP|ALTER|CREATE|INSERT|DELETE|UPDATE)\b/i.test(sql))).to.equal(false);
    expect(calls.findIndex(sql=>sql.includes('SELECT c.relname AS name'))).to.be.greaterThan(calls.indexOf('SELECT pg_advisory_xact_lock(1869833316, 1)'));
  });
  it('checks customer relations outside search_path before any schema write',async()=>{
    const {db,calls}=fixture({foreign:true}),query=db.query;
    db.query=async sql=>{
      if(sql.includes('SELECT c.relname AS name')) {
        expect(sql).to.include('JOIN pg_namespace').and.include("'pg_catalog','information_schema'");
        expect(sql).not.to.match(/ns\.nspname\s*=|current_schema|search_path/);
        calls.push(sql);return {rows:[{name:'tadir',type:'table',schema:'customer'}]};
      }
      return query(sql);
    };
    let error;try{await startupDatabase(db,ddl,insert);}catch(e){error=e;}
    expect(error?.code).to.equal('DATABASE_NOT_OWNED');expect(calls.at(-1)).to.equal('ROLLBACK');
    expect(calls.some(sql=>/^(DROP|ALTER|CREATE|INSERT|DELETE|UPDATE)\b/i.test(sql))).to.equal(false);
  });
  it('widens/adds in place and refreshes generated rows before restamping and committing',async()=>{
    const {db,calls}=fixture();const result=await startupDatabase(db,ddl,insert);
    expect(result.aside).to.deep.equal([]);
    expect(calls).to.include('ALTER TABLE "user_data" ALTER COLUMN "value" TYPE NCHAR(40)');
    expect(calls).to.include('ALTER TABLE "user_data" ADD COLUMN extra TEXT');
    expect(calls.indexOf('DELETE FROM "tadir"')).to.be.greaterThan(calls.indexOf('SELECT pg_advisory_xact_lock(1869833316, 1)'));
    expect(calls.findIndex(s=>s.startsWith('UPDATE osd_schema SET'))).to.be.greaterThan(calls.indexOf(insert[0]));
    expect(calls.at(-1)).to.equal('COMMIT');
  });
  it('renames only an incompatible table and its primary index before recreating it',async()=>{
    const {db,calls}=fixture();const result=await startupDatabase(db,ddl.map(s=>s.replace('(40)','(8)')),insert,{log:()=>{}});
    expect(result.aside).to.have.length(1);expect(result.aside[0].table).to.equal('user_data');
    expect(calls.some(s=>s.startsWith('ALTER INDEX "user_data_pkey" RENAME TO'))).to.equal(true);
    expect(calls.some(s=>s.startsWith('ALTER TABLE "user_data" RENAME TO "user_data__drift_'))).to.equal(true);
    expect(calls.at(-1)).to.equal('COMMIT');
  });
  it('rolls back a refresh failure without writing the new stamp',async()=>{
    const {db,calls}=fixture({fail:true});let error;
    try{await startupDatabase(db,ddl,insert);}catch(e){error=e;}
    expect(error?.message).to.equal('refresh failed');expect(calls.at(-1)).to.equal('ROLLBACK');
    expect(calls.some(s=>s.startsWith('UPDATE osd_schema SET'))).to.equal(false);
  });
});

describe('HANA startup ownership (catalogue fixture, no server)',()=>{
  it('refuses foreign tadir before setup can seed or rebuild it',async()=>{
    const db=new HanaDatabaseClient({password:'mock'}),calls=[];
    db.query=async sql=>{calls.push(sql);return [{name:'TADIR',type:'table'}];};
    db.execute=async sql=>calls.push(sql);
    let error;try{await db.hasSchema();}catch(e){error=e;}
    expect(error?.code).to.equal('DATABASE_NOT_OWNED');expect(db.inTransaction).to.equal(true);
    expect(calls.every(sql=>sql.startsWith('SELECT'))).to.equal(true);
  });
  for(const marker of ['stamp','legacy identity']) it(`recognizes ${marker} before reusing a HANA schema`,async()=>{
    const db=new HanaDatabaseClient({password:'mock'});
    db.query=async sql=>sql.includes('SYS.TABLES')?[{name:marker==='stamp'?'OSD_SCHEMA':'ZSTG_DEMO',type:'table'}]:[{fingerprint:'previous-ddic'}];
    expect(await db.hasSchema()).to.equal(true);
  });
});
