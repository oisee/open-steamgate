// Each invocation owns an unpatched runtime prototype before optional installation.
import assert from 'node:assert/strict';
import {join, resolve} from 'node:path';
import {libraryPath} from '../../../tools/osd-lib-path.mjs';
import {readFileSync} from 'node:fs';
import {Transpiler} from '@abaplint/transpiler';
import runtime from '@abaplint/runtime';
import {SQLiteDatabaseClient} from '../../../tools/sqlite-heap-client.mjs';
import {installXStringBuffer} from '../../../tools/osd-xstring-buffer.mjs';
const buffered = process.argv[2] === 'buffered';
globalThis.abap = new runtime.ABAP({console:new runtime.MemoryConsole()});
assert.equal(Object.getOwnPropertySymbols(abap.types.XString.prototype).includes(Symbol.for('osd.xstringBuffer')), false);
if (buffered) installXStringBuffer(abap);
const results = [];
const store = (mem, offset, length, bytes) => abap.statements.replace({target:mem,
  sectionOffset:offset, sectionLength:length, with:new abap.types.XString().set(bytes)});
const integer = n => abap.IntegerFactory.get(n);
const mem = new abap.types.XString().set('00'.repeat(65536));
for (const [offset,length,bytes] of [[65535,1,'AB'],[0,1,'CD'],[4,0,''],[4,2,'123456'],[3,4,'AA'],[2,1,'']]) {
  store(mem,integer(offset),integer(length),bytes);
  results.push([abap.builtin.xstrlen({val:mem}).get(), mem.getOffset({offset:0,length:10}).get(), abap.builtin.sy.get().subrc.get()]);
}
results.push(mem.get());
store(mem,integer(0),integer(1),'AB');
results.push(JSON.stringify(mem), structuredClone(mem), mem.value, mem.valueOf().value, mem.toString());
// Native SECTION adds .get() operands without coercing bigint: mixed types
// throw TypeError, and two int8 operands reach a number/bigint multiplication.
const int8 = n => new abap.types.Integer8().set(n);
const operands = [[int8(0),int8(1)],[int8(0),integer(1)],[integer(0),int8(1)],
  [new abap.types.String().set('0'),integer(1)], [0,integer(1)]];
for (const [offset,length] of operands) {
  try { store(mem,offset,length,'AA'); results.push(['value',mem.get()]); }
  catch (error) { results.push([error.name,error.message]); }
}
for (const input of [{offset:-1,length:1},{offset:65536,length:1},{offset:0,length:-1},
  {offset:int8(1),length:int8(1)}, {offset:integer(0),length:integer(0)}]) {
  try { results.push(['slice',mem.getOffset(input).get()]); }
  catch (error) { results.push([error.name,error.message]); }
}
try { store(mem,integer(65536),integer(1),'AA'); }
catch (error) { results.push([error.name,error.message]); }
const source = readFileSync(new URL('./semantics.abap',import.meta.url),'utf8');
const output = await new Transpiler({ignoreSyntaxCheck:true}).runRaw([{filename:'zbuffer.prog.abap',contents:source}]);
const code = output.objects.map(o => o.chunk.getCode()).join('\n');
await new (Object.getPrototypeOf(async function(){}).constructor)(code)();
results.push(abap.console.get());
assert.equal(abap.console.get(), '41004100430044004200420042001310720046004600CD');
for (const statement of ['WRITE bytes+65536(1).', "REPLACE SECTION OFFSET 65536 LENGTH 1 OF bytes WITH 'AA' IN BYTE MODE."]) {
  const fragment = await new Transpiler({ignoreSyntaxCheck:true}).runRaw([{filename:'zrange.prog.abap',
    contents:`REPORT zrange. DATA bytes TYPE xstring. DATA zeros TYPE x LENGTH 65536. bytes = zeros.
    REPLACE SECTION OFFSET 0 LENGTH 1 OF bytes WITH 'AB' IN BYTE MODE. ${statement}`}]);
  try { await new (Object.getPrototypeOf(async function(){}).constructor)(fragment.objects[0].chunk.getCode())(); results.push('no exception'); }
  catch (error) {
    assert.match(error.message,/CX_SY_RANGE_OUT_OF_BOUNDS/);
    results.push([error.name,error.message]);
    continue;
  }
  assert.fail('out-of-range ABAP must throw');
}
// Parse the real core conversion classes and their DDIC/type-pool contracts.
// The ABAP type pool supplies compile-time types; unrelated RTTI descriptors
// are not needed at execution. Constants used here are emitted inline.
const core = libraryPath(resolve(import.meta.dirname,'../../..'),'open-abap-core');
const paths = ['src/abap/abap.type.abap','src/ddic/_deprecated/dtel/char1.dtel.xml',
  'src/conv/cl_abap_conv_in_ce.clas.abap','src/conv/cl_abap_conv_out_ce.clas.abap'];
const files = paths.map(path => ({filename:path.split('/').at(-1),contents:readFileSync(join(core,path),'utf8')}));
files.push({filename:'zconversions.prog.abap',contents:readFileSync(new URL('./conversions.abap',import.meta.url),'utf8')});
const conversions = await new Transpiler({ignoreSyntaxCheck:true,unknownTypes:'runtimeError'}).runRaw(files);
abap.console.clear();
for (const object of conversions.objects.filter(o => o.filename !== 'abap.type.mjs')) {
  // All dependencies are evaluated in this child, without generated disk modules.
  await new (Object.getPrototypeOf(async function(){}).constructor)(object.chunk.getCode().replace(/^import .*$/mg,''))();
}
assert.equal(abap.console.get(),'A41B42');
results.push(abap.console.get());
const databaseFiles = ['zbuffer.tabl.xml','database.abap'].map(name => ({
  filename:name === 'database.abap' ? 'zdatabase.prog.abap' : name,
  contents:readFileSync(new URL(name,import.meta.url),'utf8')}));
const database = await new Transpiler({ignoreSyntaxCheck:true}).runRaw(databaseFiles);
const db = new SQLiteDatabaseClient();
abap.context.databaseConnections.DEFAULT = db;
await db.connect();
try {
  await db.execute('CREATE TABLE zbuffer (id INTEGER PRIMARY KEY, payload TEXT)');
  abap.console.clear();
  for (const object of database.objects) {
    await new (Object.getPrototypeOf(async function(){}).constructor)(object.chunk.getCode().replace(/^import .*$/mg,''))();
  }
  assert.equal(abap.console.get(),'00AB0065536');
  results.push(abap.console.get());
} finally { await db.disconnect(); }
console.log(JSON.stringify(results));
