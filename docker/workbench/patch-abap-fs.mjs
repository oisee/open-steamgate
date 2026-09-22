import {readFileSync, writeFileSync} from 'node:fs';

const file = process.argv[2];
if (file === undefined) throw new Error('usage: node patch-abap-fs.mjs <extension.js>');

let bundle = readFileSync(file, 'utf8');
const replacements = [
  [
    'i="undefined"==typeof navigator,s=',
    'i=!0,s=',
    'Node navigator feature probe',
  ],
  [
    'x=(e,t,n)=>{const r=A(t);n.range=t.range,r.passed?',
    'x=(e,t,n)=>{const r=A(t);n.range=t.range,e.enqueued(n),e.started(n),r.passed?',
    'ABAP Unit method start state',
  ],
  [
    'return w(o,s),i.passed||e.failed(o,i.messages),t.testmethods.forEach((t=>{const n=b(r,o,t);o.children.add(n),x(e,t,n)})),o',
    'return e.enqueued(o),e.started(o),w(o,s),t.testmethods.forEach((t=>{const n=b(r,o,t);o.children.add(n),x(e,t,n)})),i.passed&&t.testmethods.every((e=>A(e).passed))?e.passed(o):e.failed(o,i.messages),o',
    'ABAP Unit class terminal state',
  ],
  [
    'for(const o of t)T(e,o,n,r);w(n,o)}',
    'for(const o of t)T(e,o,n,r);w(n,o),t.every((e=>C(e).passed&&e.testmethods.every((e=>A(e).passed))))?e.passed(n):e.failed(n,[])}',
    'ABAP Unit object terminal state',
  ],
  [
    'const n={...g,...t,password:"",name:e,valid:!0};',
    'const n={...g,...t,password:globalThis.process?.env?.OSD_ADT_BOOTSTRAP_PASSWORD||"",name:e,valid:!0};',
    'opt-in workbench bootstrap password',
  ],
  [
    'n.password=await this.getPassword(e,n.username)',
    'n.password||(n.password=await this.getPassword(e,n.username))',
    'preserve opt-in workbench bootstrap password',
  ],
];

for (const [before, after, label] of replacements) {
  const occurrences = bundle.split(before).length - 1;
  if (occurrences !== 1) {
    throw new Error(`${label}: expected one pinned input fragment, found ${occurrences}`);
  }
  bundle = bundle.replace(before, after);
}

writeFileSync(file, bundle);
