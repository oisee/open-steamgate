import assert from 'node:assert/strict';
import runtime from '@abaplint/runtime';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {installXStringBuffer} from '../tools/osd-xstring-buffer.mjs';

const make = (buffered) => {
  const abap = new runtime.ABAP();
  if (buffered) installXStringBuffer(abap);
  globalThis.abap = abap;
  return abap;
};
const store = (abap, target, offset, length, bytes) => abap.statements.replace({target,
  sectionOffset: abap.IntegerFactory.get(offset), sectionLength: abap.IntegerFactory.get(length),
  with: new abap.types.XString().set(bytes)});

describe('large xstring SECTION writes', () => {
  it('keeps slices, clones, assignments and materialized snapshots independent', () => {
    const abap = make(true);
    const mem = new abap.types.XString({qualifiedName:'MEM'}).set('00'.repeat(65536));
    store(abap, mem, 0, 4, '12345678');
    const slice = mem.getOffset({offset:0, length:4});
    const clone = mem.clone();
    const copy = new abap.types.XString().set(mem);
    const snapshot = mem.get();
    store(abap, mem, 1, 3, mem.getOffset({offset:0, length:3}).get());
    assert.equal(mem.getOffset({offset:0, length:4}).get(), '12123456');
    assert.equal(slice.get(), '12345678');
    assert.equal(clone.getOffset({offset:0, length:4}).get(), '12345678');
    assert.equal(clone.getQualifiedName(), 'MEM');
    assert.equal(copy.getOffset({offset:0, length:4}).get(), '12345678');
    assert.equal(snapshot.slice(0,8), '12345678');
    mem.set(mem);
    assert.equal(mem.getOffset({offset:0, length:4}).get(), '12123456');
    mem.set('aBc'); // upstream upper-case hex prefix conversion
    assert.equal(mem.get(), '');
    mem.clear();
    assert.equal(abap.builtin.xstrlen({val:mem}).get(), 0);
  });
  it('matches native operands, ABAP byte operations, conversions and RAWSTRING SQL in separate processes', function() {
    this.timeout(60000);
    const execute = mode => {
      const run = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/xstring-buffer/child.mjs',import.meta.url)),mode],
        {encoding:'utf8', timeout:30000, maxBuffer:2e6});
      assert.equal(run.error,undefined,String(run.error));
      assert.equal(run.status,0,run.stderr);
      return JSON.parse(run.stdout);
    };
    assert.deepEqual(execute('buffered'),execute('native'));
  });
  it('flushes every backing-field reader and invalidates direct writes', () => {
    const abap = make(true), mem = new abap.types.XString().set('00'.repeat(65536));
    for (const read of [m => JSON.parse(JSON.stringify(m)).value,
      m => structuredClone(m).value, m => m.value, m => m.valueOf().value,
      m => m.get(), m => m.clone().value]) {
      store(abap,mem,0,1,'AB');
      assert.equal(read(mem).slice(0,4),'AB00');
      store(abap,mem,0,1,'CD');
      assert.equal(read(mem).slice(0,4),'CD00');
    }
    assert.equal(Object.getOwnPropertyDescriptor(mem,'value').enumerable,true);
    mem.value = '1234';
    assert.equal(mem.get(),'1234');
    assert.equal(abap.builtin.xstrlen({val:mem}).get(),2);
    mem.set('00'.repeat(65536));
    store(abap,mem,0,1,'EF'); // promote the same instance again
    assert.equal(mem.value.slice(0,4),'EF00');
  });
  it('preserves range exceptions and ordinary search replacement after promotion', () => {
    const abap = make(true), mem = new abap.types.XString().set('00'.repeat(65536));
    store(abap,mem,0,1,'AB');
    for (const input of [{offset:-1,length:1},{offset:65536,length:1},{offset:0,length:-1}])
      assert.throws(() => mem.getOffset(input), /CX_SY_RANGE_OUT_OF_BOUNDS/);
    assert.throws(() => store(abap,mem,65536,1,'CD'), /CX_SY_RANGE_OUT_OF_BOUNDS/);
    abap.statements.replace({target:mem,of:new abap.types.XString().set('AB'),with:new abap.types.XString().set('CD')});
    assert.equal(mem.getOffset({offset:0,length:1}).get(), 'CD');
    assert.equal(abap.builtin.sy.get().subrc.get(), 0);
  });
  it('does not materialize the whole buffer for repeated small writes, reads or lengths', () => {
    const native = make(false), untreated = new native.types.XString().set('00'.repeat(1024*1024));
    untreated.get = () => { throw new Error('full-buffer read'); };
    assert.throws(() => store(native,untreated,0,4,'12345678'), /full-buffer read/);
    const abap = make(true), mem = new abap.types.XString().set('00'.repeat(1024*1024));
    store(abap,mem,0,4,'12345678');
    // A full read on the hot path would restore the O(buffer-size) work.
    mem.get = () => { throw new Error('full-buffer read'); };
    Object.defineProperty(mem,'value',{get() { throw new Error('backing-field read'); }});
    for(let i=0;i<1000;i++) {
      store(abap,mem,i,4,'12345678');
      assert.equal(mem.getOffset({offset:i,length:4}).get(),'12345678');
      assert.equal(abap.builtin.xstrlen({val:mem}).get(),1024*1024);
    }
  });
  it('installs once per host and handles another ABAP instance', () => {
    for(let i=0;i<2;i++) {
      const abap = make(true);
      const replace = abap.statements.replace;
      installXStringBuffer(abap);
      assert.equal(abap.statements.replace,replace);
      const mem = new abap.types.XString().set('00'.repeat(65536));
      store(abap,mem,1,1,'AB');
      assert.equal(abap.builtin.xstrlen({val:mem}).get(),65536);
      assert.equal(mem.getOffset({offset:1,length:1}).get(),'AB');
    }
  });
});
