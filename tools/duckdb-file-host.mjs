// DuckDB permits one writer PROCESS per file. A local writer owns the native
// instance; runtimes use independent connections over a private Unix socket.
// The startup advisory mutex covers all statements of the migration. It is
// released on disconnect as well as normal commit/rollback.
import {createServer, createConnection} from 'node:net';
import {mkdirSync, rmSync, chmodSync, realpathSync, rmdirSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve, join, dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {toolCommand} from './osd-host.mjs';
const pause = ms => new Promise(r => setTimeout(r, ms));
const writers = new Map();
function rememberWriter(file, child) {
  const peers = writers.get(file) ?? new Set(); writers.set(file, peers); peers.add(child);
  child.once('exit', () => {peers.delete(child); if (!peers.size) writers.delete(file);});
}
async function waitForWriters(file) {
  await Promise.all([...writers.get(file) ?? []].map(child => new Promise((resolve, reject) => {
    if (child.exitCode !== null || child.signalCode !== null) {resolve();return;}
    child.ref();
    const done = () => {clearTimeout(timer);child.unref();resolve();};
    const timer = setTimeout(() => {child.removeListener('exit', done);child.unref();reject(new Error('DuckDB file writer did not exit after disconnect'));}, 30000);
    child.once('exit', done);
  })));
}
const encode = value => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? {$osd_bigint:String(item)} : item);
const decode = value => JSON.parse(value, (_key, item) => item && typeof item === 'object' && Object.keys(item).length===1 && typeof item.$osd_bigint==='string' ? BigInt(item.$osd_bigint) : item);
function socketPath(path) {
  const hash = createHash('sha256').update(path).digest('hex').slice(0, 20);
  const dir = join('/tmp', `osd-duckdb-${process.getuid?.() ?? 'user'}`); mkdirSync(dir, {recursive: true, mode: 0o700});
  return join(dir, `${hash}.sock`);
}
function dial(path) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    socket.once('error', reject); socket.once('connect', () => {socket.removeListener('error', reject); resolve(socket);});
  });
}
export async function connectFile(client) {
  const file = resolve(client.path);
  // Resolve parent symlinks even when the database has not been created yet.
  const {dirname, basename} = await import('node:path');
  mkdirSync(dirname(file), {recursive: true});
  const canonical = existsSync(file) ? realpathSync(file) : join(realpathSync(dirname(file)), basename(file));
  const path = socketPath(canonical);
  let socket;
  try {socket = await dial(path);} catch {
    const [command, ...args] = toolCommand(fileURLToPath(new URL('./duckdb-file-host.mjs', import.meta.url)), [canonical, path]);
    const child = spawn(command, args, {stdio: ['ignore','ignore','pipe'], detached: true}); child.unref();
    rememberWriter(canonical, child);
    let diagnostics='';child.stderr.on('data',chunk=>{diagnostics=(diagnostics+chunk).slice(-2000);});child.stderr.unref?.();
    let failure;
    child.on('error', error => { failure = error; });
    child.on('exit',code=>{if(code)failure=new Error(`DuckDB file writer: ${diagnostics.trim() || 'failed to open file'}`);});
    const until = Date.now() + 30000;
    while (!socket && Date.now() < until) {
      if (failure) throw failure;
      await pause(25);
      try {socket = await dial(path);} catch { /* the winning writer is opening the file */ }
    }
    if (!socket) throw new Error('DuckDB file writer did not start; another application may hold the file lock');
  }
  let id = 0, buffer = ''; const pending = new Map();
  socket.setEncoding('utf8');
  socket.on('data', chunk => {
    buffer += chunk; let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const answer = decode(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1);
      const request = pending.get(answer.id); pending.delete(answer.id);
      if (answer.error) request?.reject(Object.assign(new Error(answer.error.message), {code: answer.error.code}));
      else request?.resolve(answer.value);
    }
  });
  const fail = error => {for (const request of pending.values()) request.reject(error); pending.clear();};
  socket.on('error', fail); socket.on('close', () => fail(new Error('DuckDB file writer connection closed')));
  const request = (method, args = []) => new Promise((resolve, reject) => {
    if (socket.destroyed || socket.writableEnded) {reject(new Error('DuckDB file connection is closed'));return;}
    const number = ++id; pending.set(number, {resolve, reject});
    socket.write(encode({id: number, method, args}) + '\n');
  });
  // Keep native/cursor handles on the writer. Public methods transport only
  // plain row objects; openCursor uses the existing materialized-row seam.
  const methods = ['query','execute','selectOne','checkSelect','native','hasSchema','missingTables',
    'beginTransaction','commit','rollback','modifying','insert','update','delete','write','select',
    'defineRelation','dropRelation','startupLock','startupUnlock'];
  const opens = new Set(['beginTransaction','modifying','insert','update','delete','write']);
  for (const method of methods) client[method] = async (...args) => {
    const value = await request(method, args);
    if (opens.has(method)) client.inTransaction=true;
    if (method==='commit' || method==='rollback') client.inTransaction=false;
    if (method==='execute' && typeof args[0]==='string') {
      if (/^BEGIN /i.test(args[0])) client.inTransaction=true;
      if (/^(?:COMMIT|ROLLBACK)\s*;?$/i.test(args[0])) client.inTransaction=false;
    }
    return value;
  };
  client.openCursor = async options => {
    const {rows} = await client.select(options); let offset = 0;
    return {fetchNextCursor: async size => {const batch=rows.slice(offset,offset+size); offset+=size; return {rows:batch};}, closeCursor: async () => {}};
  };
  client.disconnect = async () => {
    if (!client.connected) return;
    let closing;
    try {closing = (await request('disconnect'))?.closed;}
    finally {
      const closed = socket.destroyed ? Promise.resolve() : new Promise(resolve => socket.once('close', resolve));
      socket.end(); client.connected=false;client.inTransaction=false;await closed;
    }
    // Only the last peer closes the native writer. Await processes this host
    // spawned, including losing startup candidates, before returning cleanup.
    if (closing) await waitForWriters(canonical);
  };
  client.connected = true;
}
export async function main(args = process.argv.slice(2)) {
  const [file, path] = args;
  const {DuckDBInstance} = await import('@duckdb/node-api');
  const {DuckDBDatabaseClient} = await import('./duckdb-client.mjs');
  let instance;
  try { instance = await DuckDBInstance.create(file); }
  catch(error) {if (/Could not set lock|Conflicting lock/i.test(error.message)) return; throw error;} // A winning writer's socket will appear shortly.
  rmSync(path, {force: true});
  let owner, waiters = [], peers = 0, idle;
  const sessions = new Map();
  const wake = () => {const pending=waiters;waiters=[];pending.forEach(r=>r());};
  const acquire = async peer => {
    while (!peer.destroyed && ((owner && owner !== peer) ||
      [...sessions].some(([socket, db]) => socket !== peer && (db.busy || db.inTransaction)))) {
      await new Promise(r => waiters.push(r));
    }
    if (!peer.destroyed) owner = peer;
  };
  const release = peer => {if(owner===peer){owner=undefined;wake();}};
  const shutdown = () => {clearTimeout(idle);server.close();instance.closeSync();rmSync(path,{force:true});try{rmdirSync(dirname(path));}catch{/* other file writers use the directory */}};
  const server = createServer(socket => {
    clearTimeout(idle); peers++;
    const db = new DuckDBDatabaseClient({direct: true, path: file});
    sessions.set(socket,db);
    const ready = instance.connect().then(c => {db.connection=c;db.connected=true;});
    let buffer='', chain=ready, closed=false, counted=true;
    const allowed = new Set(['query','execute','selectOne','checkSelect','native','hasSchema','missingTables',
      'beginTransaction','commit','rollback','modifying','insert','update','delete','write','select','defineRelation','dropRelation']);
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      buffer+=chunk;let newline;
      while((newline=buffer.indexOf('\n'))>=0) {
        let request;try {request=decode(buffer.slice(0,newline));} catch {socket.destroy();return;}
        buffer=buffer.slice(newline+1);
        chain=chain.then(async()=>{
          try {
            let value;
            if(request.method==='startupLock') await acquire(socket);
            else if(request.method==='startupUnlock') release(socket);
            else if(request.method==='disconnect') {
              await db.commit();release(socket);db.connection?.closeSync();db.connection=undefined;sessions.delete(socket);wake();
              if(counted){counted=false;if(--peers===0){value={closed:true};shutdown();}}
            }
            else {
              if(!allowed.has(request.method)) throw new Error('Unknown DuckDB writer operation');
              // Every statement waits behind an active startup migration.
              while(owner && owner!==socket && !closed) await new Promise(r=>waiters.push(r));
              if(closed) return;
              db.busy=true;
              try {
              // A raw startup BEGIN must also make commit/rollback effective.
              if(request.method==='execute' && typeof request.args[0]==='string' && /^BEGIN /i.test(request.args[0])) {
                await db.beginTransaction();
              } else if(request.method==='execute' && /^(?:COMMIT|ROLLBACK)\s*;?$/i.test(request.args[0])) {
                if (/^COMMIT/i.test(request.args[0])) await db.commit(); else await db.rollback();
              } else value=await db[request.method](...request.args);
              } finally {db.busy=false;wake();}
            }
            if(!socket.destroyed) socket.write(encode({id:request.id,value})+'\n');
          } catch(error) {if(!socket.destroyed)socket.write(encode({id:request.id,error:{message:error.message,code:error.code}})+'\n');}
        });
      }
    });
    socket.on('error',()=>{});
    socket.on('close',()=>{
      closed=true;wake();
      chain.finally(async()=>{await db.rollback().catch(()=>{});db.connection?.closeSync();sessions.delete(socket);release(socket);wake();
        if(counted){counted=false;if(--peers===0)shutdown();}});
    });
  });
  mkdirSync(dirname(path), {recursive:true,mode:0o700});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(path,resolve);});
  chmodSync(path,0o600);
  idle=setTimeout(shutdown,30000);
}
if (process.argv[1]?.endsWith('duckdb-file-host.mjs')) await main();
