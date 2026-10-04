import assert from 'node:assert/strict';
import runtime from '@abaplint/runtime';
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
  it('matches the native implementation across boundaries and size-changing writes', () => {
    const execute = buffered => {
      const abap = make(buffered), mem = new abap.types.XString().set('00'.repeat(65536));
      const results = [];
      for (const [offset,length,bytes] of [[65535,1,'AB'], [0,1,'CD'], [4,0,''], [4,2,'123456'], [3,4,'AA'], [2,1,'']]) {
        store(abap,mem,offset,length,bytes);
        results.push([abap.builtin.xstrlen({val:mem}).get(), mem.getOffset({offset:0,length:10}).get(), abap.builtin.sy.get().subrc.get()]);
      }
      results.push(mem.get());
      return results;
    };
    assert.deepEqual(execute(true), execute(false));
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
