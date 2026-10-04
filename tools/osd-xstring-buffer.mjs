// Repeated equal-width SECTION writes must not scan/copy the whole xstring.
// Keep the upstream class and conversion rules; promote only large buffers.
import {Buffer} from 'buffer';
const installed = Symbol.for('osd.xstringBuffer');
const minimumBytes = 65536;
export function installXStringBuffer(abap) {
  // Database-only hosts can provide a minimal runtime without byte operations.
  if (!abap?.types?.XString || !abap.statements || !abap.builtin) return;
  const {XString, Integer, Integer8} = abap.types;
  const proto = XString.prototype;
  let state = proto[installed];
  if (!state) {
    const buffers = new WeakMap();
    const original = Object.fromEntries(['get', 'set', 'clear', 'clone', 'getOffset'].map(k => [k, proto[k]]));
    const materialize = (value) => {
      return original.get.call(value);
    };
    proto.get = function() { return materialize(this); };
    proto.set = function(value) {
      // Read an aliased/self source before invalidating the destination.
      const result = original.set.call(this, value);
      buffers.delete(this);
      return result;
    };
    proto.clear = function() { buffers.delete(this); return original.clear.call(this); };
    proto.clone = function() { materialize(this); return original.clone.call(this); };
    const numeric = value => typeof value === 'number' ? value
      : value instanceof Integer || value instanceof Integer8 ? Number(value.get()) : undefined;
    const promote = (value, bytes) => {
      // XString has an own, enumerable value field. Keep that shape so JSON,
      // structuredClone and every direct reader see the same current hex.
      // The setter also fences native mutations (including direct assignment).
      const descriptor = Object.getOwnPropertyDescriptor(value, 'value');
      if ('value' in descriptor) {
        let raw = descriptor.value;
        Object.defineProperty(value, 'value', {
          enumerable: descriptor.enumerable, configurable: descriptor.configurable,
          get() {
            const entry = buffers.get(this);
            return entry ? entry.hex ??= entry.bytes.toString('hex').toUpperCase() : raw;
          },
          set(hex) { buffers.delete(this); raw = hex; },
        });
      }
      const entry = {bytes};
      buffers.set(value, entry);
      return entry;
    };
    proto.getOffset = function(input) {
      const entry = buffers.get(this);
      if (entry && input && (input.offset !== undefined || input.length !== undefined)) {
        const offset = input.offset === undefined ? 0 : numeric(input.offset);
        const length = input.length === undefined ? entry.bytes.length - offset : numeric(input.length);
        if (Number.isSafeInteger(offset) && Number.isSafeInteger(length) && offset >= 0 && length >= 0 && offset + length <= entry.bytes.length)
          return new XString().set(entry.bytes.subarray(offset, offset + length).toString('hex').toUpperCase());
      }
      materialize(this);
      return original.getOffset.call(this, input);
    };
    state = {buffers, numeric, materialize, promote};
    Object.defineProperty(proto, installed, {value: state});
  }
  if (abap.statements[installed]) return;
  const {buffers, numeric, promote} = state;
  const replace = abap.statements.replace;
  abap.statements.replace = function(input) {
    const target = input.target;
    if (target instanceof XString && input.sectionOffset && input.sectionLength
        && input.sectionOffset instanceof Integer && input.sectionLength instanceof Integer
        && !input.of && !input.regex && !input.pcre && !input.replacementCount && !input.replacementLength) {
      const offset = numeric(input.sectionOffset), length = numeric(input.sectionLength);
      const replacement = typeof input.with === 'string' ? input.with : input.with?.get();
      let entry = buffers.get(target);
      const bytes = entry?.bytes.length ?? target.get().length / 2;
      if (bytes >= minimumBytes && Number.isSafeInteger(offset) && Number.isSafeInteger(length)
          && offset >= 0 && length >= 0 && offset + length <= bytes
          && typeof replacement === 'string' && replacement.length === length * 2 && /^[0-9A-F]*$/.test(replacement)) {
        if (!entry) {
          entry = promote(target, Buffer.from(target.get(), 'hex'));
        }
        entry.bytes.set(Buffer.from(replacement, 'hex'), offset);
        entry.hex = undefined;
        abap.builtin.sy.get().subrc.set(0);
        return;
      }
    }
    return replace.call(this, input);
  };
  const xstrlen = abap.builtin.xstrlen;
  // Upstream builtin exports are getter-only; shadow on this ABAP instance.
  if (!xstrlen[installed]) {
    const wrapped = function(input) {
      const entry = buffers.get(input.val);
      return entry ? new Integer().set(entry.bytes.length) : xstrlen(input);
    };
    Object.defineProperty(wrapped, installed, {value: true});
    abap.builtin = Object.create(abap.builtin, {xstrlen: {value: wrapped, enumerable: true}});
  }
  Object.defineProperty(abap.statements, installed, {value: true});
}
