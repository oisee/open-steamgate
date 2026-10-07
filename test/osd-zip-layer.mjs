import {execFileSync} from 'node:child_process';
import {expect} from 'chai';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {orphanedOverlays, reportOrphanedOverlays} from '../tools/osd-orphan-overlays.mjs';
import {archiveFiles} from '../tools/osd-source-zip.mjs';
import {userLayersOf} from '../tools/osd-source-layers.mjs';
import {ObjectStore} from '../tools/osd-store.mjs';
import {objectOf as deployObject} from '../tools/osd-deploy-manifest.mjs';
import {objectOf as importObject} from '../tools/osd-import.mjs';
import {objectOf, layers as scanLayers, excludePatterns} from '../tools/osd-inputs.mjs';
import {zipInProcess, layout} from '../tools/osd-abapgit-zip.mjs';
import {icfRows} from '../tools/osd-icf-rows.mjs';
import {services, channels} from '../tools/osd-icf.mjs';
import {nodes} from '../tools/osd-nodes.mjs';
import {build, inputsOf, hashOf} from '../tools/osd-build.mjs';
import {chunkAbap, filePrefix} from '../tools/osd-prove-inplace.mjs';
const source = value => `CLASS zcl_zip_demo DEFINITION PUBLIC. PUBLIC SECTION. CLASS-METHODS run RETURNING VALUE(rv) TYPE string. ENDCLASS.
CLASS zcl_zip_demo IMPLEMENTATION. METHOD run. rv = '${value}'. ENDMETHOD. ENDCLASS.\n`;
const xml = '<abapGit><asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DEVC><DEVCLASS>$ZDEMO</DEVCLASS><CTEXT>fixture</CTEXT></DEVC></asx:values></asx:abap></abapGit>';
describe('immutable abapGit ZIP source layers', function () {
  this.timeout(120000);
  let scratch, root, repo, archive, prior;
  const write = (file, content) => {mkdirSync(join(repo, file, '..'), {recursive:true}); writeFileSync(join(repo, file), content);};
  beforeEach(() => {
    prior = {...process.env}; delete process.env.OSD_PACKS; delete process.env.OSD_LAYERS;
    scratch = mkdtempSync(join(tmpdir(), 'zip-layer-')); root = join(scratch, 'system'); repo = join(scratch, 'repo'); archive = join(scratch, 'fixture.zip');
    mkdirSync(root); mkdirSync(repo); mkdirSync(join(root,'src'));
    writeFileSync(join(root,'abap_transpile.json'), JSON.stringify({input_folder:['src'],libs:[],output_folder:'output',options:{ignoreSyntaxCheck:false,addCommonJS:true}}));
    writeFileSync(join(root,'abaplint.jsonc'), readFileSync('abaplint.jsonc'));
    symlinkSync(resolve('node_modules'), join(root,'node_modules'));
    write('.abapgit.xml','<STARTING_FOLDER>/src/</STARTING_FOLDER><FOLDER_LOGIC>FULL</FOLDER_LOGIC>');
    write('src/package.devc.xml',xml); write('src/zcl_zip_demo.clas.abap',source('base'));
    write('src/zcl_zip_demo.clas.xml','<abapGit><asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><VSEOCLASS><CLSNAME>ZCL_ZIP_DEMO</CLSNAME><LANGU>E</LANGU><STATE>1</STATE></VSEOCLASS></asx:values></asx:abap></abapGit>');
    write('src/zcl_zip_demo.clas.locals_def.abap','* full object\n');
  });
  afterEach(() => {process.env = prior; rmSync(scratch,{recursive:true,force:true});});
  const zip = () => {writeFileSync(archive,zipInProcess(repo)); process.env.OSD_LAYERS=archive; return userLayersOf(root);};
  it('keeps full SICF identities, including spaces, beside the handler-less APC node', () => {
    const a = 'zsame'.padEnd(15)+'a'.repeat(25), b = 'zsame'.padEnd(15)+'b'.repeat(25);
    write(`src/${a}.sicf.xml`,'<URL>/sap/bc/zsame/</URL><ICF_NAME>ZSAME</ICF_NAME><ICFHANDLER>ZCL_ZIP_DEMO</ICFHANDLER>');
    write(`src/${b}.sicf.xml`,'<URL>/sap/bc/apc/sap/zsame/</URL><ICF_NAME>ZSAME</ICF_NAME>');
    write('src/zsame.sapc.xml','<PATH>/sap/bc/apc/sap/zsame</PATH><APPLICATION_ID>ZSAME</APPLICATION_ID><CLASS_NAME>ZCL_ZIP_DEMO</CLASS_NAME>');
    write('src/zamc.samc.xml','<APPLICATION_ID>ZAMC</APPLICATION_ID>');
    const layers=zip(), store=new ObjectStore({root,libs:[]});
    expect(store.list('SICF').map(o=>o.name)).to.deep.equal([a.toUpperCase(),b.toUpperCase()]);
    expect(store.list('SAPC')).to.have.length(1); expect(store.list('SAMC')).to.have.length(1);
    expect(importObject(`${a}.sicf.xml`)).to.deep.equal({type:'SICF',name:a.toUpperCase()});
    expect(objectOf(`${b}.sicf.xml`)).to.equal('SICF '+b.toUpperCase());
    expect(deployObject(`${b}.sicf.xml`).key).to.equal('SICF '+b.toUpperCase());
    expect(filePrefix('SICF '+b.toUpperCase())).to.equal(b+'.sicf.');
    expect(chunkAbap('$ZDEMO', 'SICF '+b.toUpperCase(), b+'.sicf.xml', 0, 10)).to.include(`ls_file-filename = '${b}.sicf.xml'`);
    const paths=layers.map(l=>l.path), rows=icfRows(root,{roots:paths});
    expect(rows.ICFSERVICE).to.have.length(2); expect(rows.ZOSD_ICF_APC).to.have.length(1);
    expect(rows.ICFSERVICE.map(r=>r.ICFPARGUID).sort()).to.deep.equal(['A'.repeat(25),'B'.repeat(25)]);
    expect(services(root,{roots:paths}).filter(s=>s.handler)).to.have.length(1);
    expect(channels(root,{roots:paths})).to.have.length(1);
    expect(nodes(root,{roots:paths,proxies:false}).filter(n=>n.path.includes('zsame'))).to.have.length(3);
    const stack=scanLayers(root,{input_folder:paths});
    expect(stack.duplicates).to.deep.equal([]);
    const hidden=`${layers[0].path}/${a}.sicf.xml`;
    expect(new RegExp(excludePatterns([hidden])[0]).test(hidden)).to.equal(true);
  });
  it('exports two padded SICF names without collapsing their spaces or merging nodes', () => {
    const a = 'zsame'.padEnd(15)+'a'.repeat(25), b = 'zsame'.padEnd(15)+'b'.repeat(25);
    write(`src/${a}.sicf.xml`,'<URL>/sap/bc/zsame/</URL><ICF_NAME>ZSAME</ICF_NAME>');
    write(`src/${b}.sicf.xml`,'<URL>/sap/bc/apc/sap/zsame/</URL><ICF_NAME>ZSAME</ICF_NAME>');
    const out=join(scratch,'export'); mkdirSync(out);
    layout(join(repo,'src'),out,'fixture',undefined,{name:'fixture',objects:[
      'CLAS ZCL_ZIP_DEMO', `SICF ${a.toUpperCase()}`, `SICF ${b.toUpperCase()}`]});
    const exported=archiveFiles(zipInProcess(out));
    expect(exported.has(`src/${a}.sicf.xml`)).to.equal(true);
    expect(exported.has(`src/${b}.sicf.xml`)).to.equal(true);
  });
  it('copies the complete object to the overlay and preserves active source through cold activation', async () => {
    const layers=zip(); await build({root,generators:false});
    const store=new ObjectStore({root,libs:[],build:{generators:false}});
    expect(store.find('CLAS','ZCL_ZIP_DEMO').package).to.equal('$ZDEMO');
    const base=join(root,layers[0].path,'zcl_zip_demo.clas.abap');
    expect(store.read('CLAS','ZCL_ZIP_DEMO','main','active').source).to.equal(source('base'));
    const saved=store.write('CLAS','ZCL_ZIP_DEMO',source('overlay'));
    expect(saved.root).to.equal(layers[1].path); expect(readFileSync(base,'utf8')).to.equal(source('base'));
    expect(existsSync(join(root,layers[1].path,'zcl_zip_demo.clas.xml'))).to.equal(true);
    expect(existsSync(join(root,layers[1].path,'zcl_zip_demo.clas.locals_def.abap'))).to.equal(true);
    expect(store.read('CLAS','ZCL_ZIP_DEMO','main','active').source).to.equal(source('base'));
    const activation=store.activate('CLAS','ZCL_ZIP_DEMO'); expect(activation.active,JSON.stringify(activation)).to.equal(true);
    const result=await store.publish({activate:[{type:'CLAS',name:'ZCL_ZIP_DEMO'}]});
    expect(result.ok).to.equal(true); expect(store.completeActivation(activation)).to.equal(true);
    expect(store.read('CLAS','ZCL_ZIP_DEMO','main','active').source).to.equal(source('overlay'));
    const created=store.create('CLAS','ZCL_ZIP_NEW',{package:'$ZDEMO'}); expect(created.root).to.equal(layers[1].path);
    expect(new ObjectStore({root,libs:[]}).find('CLAS','ZCL_ZIP_NEW').package).to.equal('$ZDEMO');
    const implicit=store.write('CLAS','ZCL_ZIP_IMPLICIT',source('new').replaceAll('zcl_zip_demo','zcl_zip_implicit'));
    expect(implicit.root).to.equal(layers[1].path); expect(implicit.package).to.equal('$ZDEMO');
  });
  it('warns once for edited old revisions by root package, lists them for doctor and never carries edits', () => {
    const first = zip(), store = new ObjectStore({root, libs: []});
    store.write('CLAS', 'ZCL_ZIP_DEMO', source('old edit'));
    // Legacy overlays did not have revision metadata.
    rmSync(join(root,'local/overlays',first[0].archiveId+'.meta.txt'));
    write('src/zcl_zip_demo.clas.abap', source('new base'));
    archive = join(scratch, 'fixture-v2.zip'); const second = zip();
    const said = []; reportOrphanedOverlays(root, line => said.push(line));
    expect(said).to.have.length(1);
    expect(said[0]).to.include(first[0].archiveId).and.include(first[1].path).and.include('1 changed objects').and.include('manually diffing/reapplying');
    expect(orphanedOverlays(root)).to.have.length(1);
    const doctor = execFileSync(process.execPath, ['bin/osd.mjs', 'doctor'], {env: {...process.env, OSD_ROOT: root}, encoding: 'utf8'});
    expect(doctor).to.include('orphaned overlay').and.include(first[0].archiveId).and.include(first[1].path);
    expect(orphanedOverlays(root)[0]).to.include({count: 1, sameLayer: true, key: '$ZDEMO'});
    expect(new ObjectStore({root,libs:[]}).read('CLAS','ZCL_ZIP_DEMO').source).to.equal(source('new base'));
    expect(existsSync(join(root, second[1].path, 'zcl_zip_demo.clas.abap'))).to.equal(false);
    process.env.OSD_LAYERS = join(scratch, 'fixture.zip'); userLayersOf(root);
    expect(orphanedOverlays(root)).to.deep.equal([]);
  });

  it('reuses identical bytes and changes identity for different ZIP bytes, even just a comment', () => {
    const first=zip(), hash=hashOf(root,inputsOf(root));
    expect(userLayersOf(root)).to.deep.equal(first); expect(hashOf(root,inputsOf(root))).to.equal(hash);
    const bytes=readFileSync(archive), extra=Buffer.from('comment'); bytes.writeUInt16LE(extra.length,bytes.length-2);
    writeFileSync(archive,Buffer.concat([bytes,extra]));
    expect(userLayersOf(root)[0].archiveId).not.to.equal(first[0].archiveId);
    expect(hashOf(root,inputsOf(root))).not.to.equal(hash);
  });
  for (const logic of ['FULL','PREFIX']) it(`honors STARTING_FOLDER and ${logic} package mapping for folders`, () => {
    write('.abapgit.xml',`<STARTING_FOLDER>/code/</STARTING_FOLDER><FOLDER_LOGIC>${logic}</FOLDER_LOGIC>`);
    write('code/package.devc.xml',xml); write('code/child/zcl_zip_demo.clas.abap',source('child'));
    process.env.OSD_LAYERS=repo;
    const store=new ObjectStore({root,libs:[],build:{generators:false}});
    expect(store.find('CLAS','ZCL_ZIP_DEMO').package).to.equal(logic==='FULL'?'CHILD':'$ZDEMO_CHILD');
  });
  it('rejects traversal, absolute paths, backslashes, symlinks and corrupted entries before publication', () => {
    write('src/zsafe.prog.abap','REPORT zsafe.');
    const bytes=zipInProcess(repo);
    const change=(name,to)=>{const b=Buffer.from(bytes); const before=Buffer.from(name), after=Buffer.from(to); expect(before.length).to.equal(after.length); let at=0; while((at=b.indexOf(before,at))>=0){after.copy(b,at);at+=after.length;} return b;};
    for(const path of ['../zzsafe.prog.abap','/xx/zsafe.prog.abap','src\\zsafe.prog.abap']) {
      const normal='src/zsafe.prog.abap';
      expect(()=>archiveFiles(change(normal,path))).to.throw(/path/);
    }
    const link=Buffer.from(bytes); let at=0;
    while((at=link.indexOf(Buffer.from([0x50,0x4b,1,2]),at))>=0){link.writeUInt32LE(0xa1ff0000,at+38);at+=4;}
    expect(()=>archiveFiles(link)).to.throw(/non-regular/);
    const corrupt=Buffer.from(bytes); corrupt[40]^=1;
    expect(()=>archiveFiles(corrupt)).to.throw();
  });
});
