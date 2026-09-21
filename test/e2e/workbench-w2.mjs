import fs from 'node:fs';
import { chromium } from '../../node_modules/playwright/index.mjs';

const workbenchUrl = process.env.OSD_WORKBENCH_URL ?? 'http://127.0.0.1:8088';
const runtimeUrl = process.env.OSD_RUNTIME_URL ?? 'http://127.0.0.1:3030';
const passwordFile = process.env.OSD_IDE_PASSWORD_FILE ??
  new URL('../../docker/workbench/ide-password.example', import.meta.url);
const password = fs.readFileSync(passwordFile, 'utf8').trim();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
const fixture = `${process.cwd()}/src/icf/zcl_stg_icf_demo.clas.abap`;
let originalSource;
let restoreRequired = false;

async function command(label) {
  await page.keyboard.press('Control+Shift+P');
  const input = page.locator('.quick-input-widget input');
  await input.waitFor({ state: 'visible', timeout: 15_000 });
  await input.fill(`>${label}`);
  await page.waitForTimeout(700);
  const item = page.locator('.quick-input-list .monaco-list-row').filter({ hasText: label }).first();
  await item.waitFor({ state: 'visible', timeout: 10_000 });
  await item.click();
}

async function replaceEditorText(from, to) {
  await page.getByRole('tab', { name: 'ZCL_STG_ICF_DEMO.clas.abap' }).click();
  const line = page.locator('.monaco-editor .view-line').filter({ hasText: from }).first();
  await line.scrollIntoViewIfNeeded();
  await line.click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Shift+End');
  await page.keyboard.insertText(to);
  await page.keyboard.press('Control+s');
}

async function getJson(path) {
  const response = await fetch(`${runtimeUrl}${path}`);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

async function waitForFileText(path, needle, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (fs.readFileSync(path, 'utf8').includes(needle)) return;
    await page.waitForTimeout(250);
  }
  throw new Error(`${path} did not contain ${needle}`);
}

async function waitForMarker(marker, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await getJson('/sap/bc/zstg_icf_demo/w2').catch(() => undefined);
    if (value?.marker === marker) return value;
    await page.waitForTimeout(500);
  }
  throw new Error(`runtime marker did not become ${marker}`);
}

async function activateFixture() {
  const base = `${runtimeUrl}/sap/bc/adt`;
  const authorization = `Basic ${Buffer.from('developer:any').toString('base64')}`;
  const graph = await fetch(`${base}/compatibility/graph`, {
    headers: {authorization, 'x-csrf-token': 'fetch', 'x-sap-adt-sessiontype': 'stateful'}
  });
  const token = graph.headers.get('x-csrf-token');
  const cookie = graph.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const body = '<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">' +
    '<adtcore:objectReference adtcore:uri="/sap/bc/adt/oo/classes/zcl_stg_icf_demo"/>' +
    '</adtcore:objectReferences>';
  const response = await fetch(`${base}/activation?method=activate`, {
    method: 'POST',
    headers: {
      authorization,
      'x-csrf-token': token,
      'x-sap-adt-sessiontype': 'stateful',
      cookie,
      'content-type': 'application/xml'
    },
    body
  });
  if (!response.ok) throw new Error(`cleanup activation failed: HTTP ${response.status}`);
}

try {
  await page.goto(workbenchUrl, { waitUntil: 'domcontentloaded' });
  const passwordInput = page.locator('input[name="password"]');
  if (await passwordInput.isVisible().catch(() => false)) {
    await passwordInput.fill(password);
    await page.locator('input[type="submit"]').click();
  }
  await page.waitForSelector('.monaco-workbench', { timeout: 60_000 });

  await page.waitForTimeout(2_000);
  const buttons = await page.getByRole('button').allTextContents();
  fs.writeFileSync('/tmp/osd-w2-before-command.txt', JSON.stringify({ buttons, body: (await page.locator('body').innerText()).slice(0, 8000) }, null, 2));
  const restricted = page.getByText('Restricted Mode', { exact: true }).first();
  if (await restricted.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Manage', exact: true }).first().click();
    await page.waitForTimeout(1_000);
    fs.writeFileSync('/tmp/osd-w2-trust-dialog.txt', JSON.stringify({ buttons: await page.getByRole('button').allTextContents(), body: (await page.locator('body').innerText()).slice(0, 8000) }, null, 2));
    const trustWorkspace = page.getByRole('button', { name: 'Trust', exact: true });
    await trustWorkspace.waitFor({ state: 'visible', timeout: 10_000 });
    await trustWorkspace.click();
    await page.waitForTimeout(1_000);
    await page.keyboard.press("Control+W");
    await page.keyboard.press("Escape");
  }
  await page.waitForTimeout(15_000);

  const localRoot = page.getByRole('treeitem', { name: 'open-steamgate', exact: true });
  if (await localRoot.isVisible().catch(() => false)) {
    await localRoot.click();
    await page.keyboard.press('ArrowLeft');
  }

  let root = page.getByRole('treeitem', { name: 'OSD(ABAP)' });
  // Passwords are intentionally not persisted by abap-fs. Connect explicitly
  // on every browser run instead of trusting a stale, expanded workspace
  // root whose decoration may not yet expose its connection error.
  {
    if (await root.isVisible().catch(() => false) && await root.getAttribute('aria-expanded') === 'true') {
      await root.click();
      await page.keyboard.press('ArrowLeft');
    }
    await command('ABAP FS: Connect to an ABAP system');
    await page.waitForTimeout(1_000);
    const quick = page.locator('.quick-input-widget');
    fs.writeFileSync('/tmp/osd-w2-state.txt', await quick.textContent().catch(() => 'no quick input'));
    if (await quick.isVisible().catch(() => false)) {
      await quick.locator('input').fill('any');
      await page.keyboard.press('Enter');
    }
    if (await localRoot.isVisible().catch(() => false)) {
      await localRoot.click();
      await page.keyboard.press('ArrowLeft');
    }
    root = page.getByRole('treeitem', { name: 'OSD(ABAP)' });
    await root.waitFor({ state: 'visible', timeout: 20_000 });
  }
  fs.writeFileSync('/tmp/osd-w2-after-connect.txt', JSON.stringify({
    treeitems: await page.getByRole('treeitem').evaluateAll(items => items.map(item => item.getAttribute('aria-label'))),
    body: (await page.locator('body').innerText()).slice(0, 10_000)
  }, null, 2));

  await root.waitFor({ state: 'visible', timeout: 45_000 });
  const currentLocalRoot = page.getByRole('treeitem', { name: 'open-steamgate', exact: true });
  if (await currentLocalRoot.isVisible().catch(() => false) && await currentLocalRoot.getAttribute('aria-expanded') === 'true') {
    await currentLocalRoot.click();
    await page.keyboard.press('ArrowLeft');
    root = page.getByRole('treeitem', { name: 'OSD(ABAP)' });
    await root.waitFor({ state: 'visible', timeout: 10_000 });
  }
  fs.writeFileSync('/tmp/osd-w2-root.txt', JSON.stringify({
    label: await root.getAttribute('aria-label'),
    expanded: await root.getAttribute('aria-expanded'),
    html: (await root.evaluate(element => element.outerHTML)).slice(0, 4000)
  }, null, 2));
  if (await root.getAttribute('aria-expanded') !== 'true') {
    await root.click();
    await page.keyboard.press('ArrowRight');
  }
  await page.waitForTimeout(1_000);
  const rootPrompt = page.locator('.quick-input-widget');
  if (await rootPrompt.isVisible().catch(() => false) && /password/i.test(await rootPrompt.innerText())) {
    await rootPrompt.locator('input').fill('any');
    await page.keyboard.press('Enter');
    await root.click();
    await page.keyboard.press('ArrowRight');
  }
  const tmp = page.getByRole('treeitem', { name: '$TMP', exact: true });
  await tmp.waitFor({ state: 'visible', timeout: 45_000 });
  await tmp.scrollIntoViewIfNeeded();
  await tmp.click();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(4_000);
  const stg = page.getByRole('treeitem', { name: '$STG', exact: true });
  await stg.waitFor({ state: 'visible', timeout: 30_000 });
  await stg.click();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(3_000);
  const stgIcf = page.getByRole('treeitem', { name: '$STG_ICF', exact: true });
  await stgIcf.waitFor({ state: 'visible', timeout: 30_000 });
  await stgIcf.click();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(3_000);
  const classFile = page.getByRole('treeitem', { name: 'ZCL_STG_ICF_DEMO.clas.abap', exact: true });
  await classFile.waitFor({ state: 'visible', timeout: 30_000 });
  await page.keyboard.press('Escape');
  await page.mouse.move(1200, 900);
  await page.waitForTimeout(1_000);
  await classFile.scrollIntoViewIfNeeded();
  await classFile.locator('.label-name').dblclick();
  await page.getByRole('tab', { name: 'ZCL_STG_ICF_DEMO.clas.abap' }).waitFor({
    state: 'visible',
    timeout: 30_000
  });
  await page.waitForTimeout(3_000);

  originalSource = fs.readFileSync(fixture, 'utf8');
  const before = await getJson('/sap/bc/adt/core/http/build');
  const initialRuntime = await waitForMarker('W2-OLD');

  restoreRequired = true;
  await replaceEditorText("rv_marker = 'W2-OLD'.", 'rv_marker = .');
  await waitForFileText(fixture, 'rv_marker = .');
  const runtimeWhileInvalid = await waitForMarker('W2-OLD');
  const beforeFailedActivation = await getJson('/sap/bc/adt/core/http/build');
  await page.keyboard.press('Alt+Shift+F3');
  await page.waitForTimeout(5_000);
  await page.keyboard.press('Control+Shift+m');
  const activationProblem = page.getByText(/Statement does not exist.*rv_marker/i).first();
  await activationProblem.waitFor({ state: 'visible', timeout: 30_000 });
  const activationProblemText = await activationProblem.innerText();
  const afterFailedActivation = await getJson('/sap/bc/adt/core/http/build');
  if (afterFailedActivation.generation !== beforeFailedActivation.generation ||
      afterFailedActivation.system.serving !== beforeFailedActivation.system.serving) {
    throw new Error('failed activation changed the active/serving generation');
  }
  await waitForMarker('W2-OLD');

  await replaceEditorText('rv_marker = .', "rv_marker = 'W2-NEW'.");
  await waitForFileText(fixture, "rv_marker = 'W2-NEW'.");
  await page.keyboard.press('Alt+Shift+F3');
  await page.getByText(/activated successfully/i).waitFor({ state: 'visible', timeout: 90_000 });
  const activatedRuntime = await waitForMarker('W2-NEW');
  const activated = await getJson('/sap/bc/adt/core/http/build');
  if (activated.system.serving === before.system.serving) {
    throw new Error('successful activation did not publish a new serving generation');
  }

  await page.keyboard.press('Control+Shift+F11');
  // VS Code 1.97's Testing view does not expose these rows as ARIA
  // treeitems (the Explorer does), so select the Testing-specific label.
  const unitRoot = page.getByText(/CLAS\/I ZCL_STG_ICF_DEMO\.main/i).first();
  await unitRoot.waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForTimeout(1_000);
  const testingText = await page.locator('body').innerText();
  if (!/CLAS\/I ZCL_STG_ICF_DEMO\.main/i.test(testingText) || !/\d+\/2/.test(testingText)) {
    throw new Error('ABAP Unit did not publish its two-item result into Testing');
  }

  await page.keyboard.press('Control+Shift+g');
  await page.waitForTimeout(2_000);
  const gitText = await page.locator('body').innerText();
  if (!/SOURCE CONTROL[\s\S]*ZCL_STG_ICF_DEMO\.clas\.abap/i.test(gitText)) {
    throw new Error('Source Control did not show the ADT-written class');
  }

  await page.getByRole('tab', { name: 'ZCL_STG_ICF_DEMO.clas.abap' }).click();
  await replaceEditorText("rv_marker = 'W2-NEW'.", "rv_marker = 'W2-OLD'.");
  await waitForFileText(fixture, "rv_marker = 'W2-OLD'.");
  await page.keyboard.press('Alt+Shift+F3');
  await waitForMarker('W2-OLD');
  if (fs.readFileSync(fixture, 'utf8') !== originalSource) {
    throw new Error('W2 fixture was not restored byte-for-byte');
  }
  restoreRequired = false;

  const restored = await getJson('/sap/bc/adt/core/http/build');
  await page.keyboard.press('Control+Shift+e');
  root = page.getByRole('treeitem', { name: 'OSD(ABAP)' });
  await root.waitFor({ state: 'visible', timeout: 20_000 });
  await root.click({ button: 'right' });
  const refreshFilesystem = page.getByRole('menuitem', { name: /Refresh ABAP filesystem/i });
  await refreshFilesystem.waitFor({ state: 'visible', timeout: 10_000 });
  await refreshFilesystem.click();
  fs.writeFileSync('/tmp/osd-w2-refresh.txt', JSON.stringify({ refreshVisible: true, invoked: true }, null, 2));

  console.log(JSON.stringify({
    before: {
      generation: before.generation,
      serving: before.system.serving,
      marker: initialRuntime.marker
    },
    invalid: {
      generation: afterFailedActivation.generation,
      serving: afterFailedActivation.system.serving,
      marker: runtimeWhileInvalid.marker,
      problem: activationProblemText
    },
    activated: {
      generation: activated.generation,
      serving: activated.system.serving,
      marker: activatedRuntime.marker
    },
    unitSummaryVisible: /CLAS\/I ZCL_STG_ICF_DEMO\.main/i.test(testingText) && /\d+\/2/.test(testingText),
    gitVisible: /zcl_stg_icf_demo\.clas\.abap/i.test(gitText),
    refreshInvoked: true,
    restored: {
      generation: restored.generation,
      serving: restored.system.serving,
      marker: 'W2-OLD'
    }
  }, null, 2));
} catch (error) {
  console.error(error);
  fs.writeFileSync('/tmp/osd-w2-error.txt', `${error?.stack ?? error}\n`);
  fs.writeFileSync('/tmp/osd-w2-error-body.txt', await page.locator('body').innerText().catch(() => ''));
  await page.screenshot({ path: '/tmp/osd-w2-failure.png', fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  if (restoreRequired && originalSource !== undefined) {
    try {
      fs.writeFileSync(fixture, originalSource);
      await activateFixture();
      await waitForMarker('W2-OLD');
    } catch (cleanupError) {
      process.exitCode = 1;
      console.error('W2 cleanup failed', cleanupError);
      fs.appendFileSync('/tmp/osd-w2-error.txt', `W2 cleanup failed: ${cleanupError?.stack ?? cleanupError}\n`);
    }
  }
  await context.close();
  await browser.close();
}
