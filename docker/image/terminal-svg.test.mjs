import {test} from 'node:test';
import assert from 'node:assert/strict';
import {terminalSvg} from './terminal-svg.mjs';

test('escapes screen text and preserves SAP-TUI colours', () => {
  const svg = terminalSvg('\x1b[38;5;196m<&');
  assert.match(svg, /fill="rgb\(255,0,0\)"/);
  assert.match(svg, />&lt;<\/text>/);
  assert.match(svg, />&amp;<\/text>/);
});
test('clear to end of line removes stale cells', () => {
  const svg = terminalSvg('ABC\rX\x1b[K');
  assert.match(svg, />X<\/text>/);
  assert.doesNotMatch(svg, />[ABC]<\/text>/);
});
test('clear and home discard the previous screen', () => {
  const svg = terminalSvg('old\x1b[2J\x1b[Hnew');
  assert.match(svg, /width="27" height="18"/);
  assert.doesNotMatch(svg, />[old]<\/text>/);
});
