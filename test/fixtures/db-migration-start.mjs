import {createServer} from 'node:http';
import {FileSqliteClient} from '../../tools/sqlite-file-client.mjs';
import {DuckDBDatabaseClient} from '../../tools/duckdb-client.mjs';
import {startupDatabase} from '../../tools/osd-db-migrate.mjs';
const [engine, path, version = 'new'] = process.argv.slice(2);
const db = engine === 'sqlite' ? new FileSqliteClient({path}) : new DuckDBDatabaseClient({path});
await db.connect();
process.send?.({connected:true});
if (process.send) await new Promise(resolve=>process.once('message',resolve));
const type = engine === 'sqlite' ? 'NCHAR' : 'VARCHAR';
const ddl = [`CREATE TABLE user_data(id INT PRIMARY KEY, value ${type}(${version === 'old' ? 8 : 16})${version === 'old' ? '' : ', added TEXT'})`,
  'CREATE TABLE tadir(pgmid TEXT, object TEXT, obj_name TEXT, PRIMARY KEY(pgmid,object,obj_name))'];
const insert = [`INSERT INTO "tadir" VALUES ('R3TR','CLAS','Z_PROBE')`];
try {
  const result = await startupDatabase(db, ddl, insert, {reseed:async()=>new Promise(r=>setTimeout(r,100))});
  const server = createServer(async (req,res)=>{
    if(req.url==='/done') {await db.disconnect();res.end('done');server.close();process.disconnect?.();return;}
    const rows=await db.query('SELECT * FROM user_data');
    res.setHeader('content-type','application/json');res.end(JSON.stringify({result,rows}));
  });
  server.listen(0,'127.0.0.1',()=>process.send?.({ready:true,port:server.address().port,result}));
} catch (error) {console.error(error);await db.disconnect();process.exitCode=1;process.disconnect?.();}
