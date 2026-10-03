// Synchronous alert seam: flat DDIC, durable receipts, receiver-owned budget.
import {readFileSync} from 'node:fs';
import {renderRecipe} from './dsl-abap.mjs';
export function remoteVariant(value, {kind, vname, vkey, line, fail}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const wrapped = Object.keys(value).join() === 'remote';
  if (kind !== 'sink' || (!wrapped && vname !== 'remote')) fail(line(vkey), 'remote is a sink variant: {remote: {function, destination, group}}');
  const spec = wrapped ? value.remote : value;
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) fail(line(vkey), 'remote needs function, destination and group');
  for (const k of Object.keys(spec)) if (!['function','destination','group'].includes(k)) fail(line(`${vkey}/${wrapped ? "remote/" : ""}${k}`), `unknown remote key ${k}`);
  for (const k of ['function','group']) if (typeof spec[k] !== 'string' || !/^Z[A-Z0-9_]{0,29}$/i.test(spec[k])) fail(line(`${vkey}/${wrapped ? "remote/" : ""}${k}`), `${k} is a Z name of at most 30 characters`);
  if (typeof spec.destination !== 'string' || !/^(remote\.destination|[A-Za-z0-9_]{1,40})$/.test(spec.destination)) fail(line(`${vkey}/${wrapped ? "remote/" : ""}destination`), 'destination is remote.destination or a literal destination name');
  return {...spec, function: spec.function.toUpperCase(), function_lower: spec.function.toLowerCase(), group: spec.group.toLowerCase(), setting: spec.destination === 'remote.destination'};
}
const field = (name, type, length, key=false, decimals=0) => ({name: name.toUpperCase(), type, length, key, decimals});
export function compileRemote(model, {line, fail, columnsOf}) {
  const variants = model.sink.variants.filter((v)=>v.remote);
  if (!variants.length) return;
  if (variants.length !== 1) fail(model.sink.set_line, 'one remote alert variant per set');
  const v = variants[0], at = v.set_line;
  if (!model.governor || !model.resilience || !model.snapshot_inputs?.length) fail(at, 'remote alerts require governor, resilience and a run input snapshot');
  if (!model.sink.variants.some((v)=>v.is_log)) fail(at, 'remote receiver requires the generated log variant');
  const prefix = `zl3_${model.set}`;
  const r = {...v.remote, class: v.class, variant: v.name, iface: model.sink.iface, runner: model.class,
    set: model.set, "set@type": model["set@type"], ports_class: model.ports_class, exception: model.exception, source: model.source, conf: `zcl_l3_${model.set}_conf`,
    header: `${prefix}_rhead`, row: `${prefix}_rrow`, rows: `${prefix}_rrows`, receipt: `${prefix}_rcpt`, link: `${prefix}_rlink`,
    '@id': v['@id'], set_line: at};
  for (const n of [r.header,r.row,r.rows,r.receipt,r.link]) if (n.length > 30) fail(at, `remote DDIC name ${n} exceeds 30 characters`);
  r.fields = columnsOf(model.sink.table, 'ports/alerts').fields.filter((f)=>f.FIELDNAME !== 'MANDT').map((f)=>{
    // The log's text is deep. The wire carries a bounded CHAR, checked before conversion.
    if (f.DATATYPE === 'STRG' && f.FIELDNAME === 'ALERT_TEXT') return field(f.FIELDNAME,'CHAR',1024);
    if (!['CHAR','NUMC','DATS','TIMS','INT1','INT2','INT4','DEC','CURR','QUAN'].includes(f.DATATYPE)) fail(at, `remote field ${f.FIELDNAME} is not RFC-able (${f.DATATYPE})`);
    return field(f.FIELDNAME,f.DATATYPE,Number(f.LENG),false,Number(f.DECIMALS??0));
  });
  model.remote = r;
}
export function remoteOverlay(model, text) {
  if (!model.remote) return text;
  text = text.replace('             status TYPE c LENGTH 12,', '             status TYPE c LENGTH 16,');
  text = text.replace('  PRIVATE SECTION.\n', readFileSync('recipes/l3-remote/public.tpl','utf8') + '  PRIVATE SECTION.\n');
  text = text.replace('  METHOD release.\n', '  METHOD release.\n' + readFileSync('recipes/l3-remote/release.tpl','utf8'));
  const heal = '    heal( EXPORTING iv_run = ls_lock-run_id';
  text = text.replace(heal, readFileSync('recipes/l3-remote/resume.tpl','utf8') + heal);
  text = text.replace('    DATA ls_group TYPE {{iface}}=>ty_group.', '    DATA ls_group TYPE {{iface}}=>ty_group.\n    DATA lt_remote_report TYPE tt_doctor.');
  const anchor = '    ls_group-pile_no = iv_pile.\n';
  if (!text.includes(anchor)) throw new Error('remote overlay needs piled write group');
  text = text.replace(anchor, anchor + readFileSync('recipes/l3-remote/send.tpl','utf8'));
  const counts = '    FIELD-SYMBOLS <ls_rule> TYPE ty_rule.\n    LOOP AT ct_rules ASSIGNING <ls_rule>.';
  if (!text.includes(counts)) throw new Error('remote overlay needs governor count anchor');
  text = text.replace(counts, '    FIELD-SYMBOLS <ls_rule> TYPE ty_rule.\n' + readFileSync('recipes/l3-remote/counts.tpl','utf8') + '    LOOP AT ct_rules ASSIGNING <ls_rule>.');
  // A receiving pile owns no detecting date lock (NONE shares that same table).
  const marker = '    SELECT SINGLE status FROM zosd_l3_run INTO lv_reason\n      WHERE set_name = c_set AND check_date = ls_pile-check_date AND run_id = iv_run.\n';
  if (!text.includes(marker)) throw new Error('remote overlay needs release lock anchor');
  text = text.replace(marker, marker + `{{#remote}}\n    IF sy-subrc <> 0.\n      SELECT SINGLE remote_run FROM {{link}} INTO lv_reason WHERE set_name = c_set AND remote_run = iv_run.\n      IF sy-subrc = 0.\n        lv_reason = 'HELD'.\n      ENDIF.\n    ENDIF.\n{{/remote}}\n`);
  return text.replace(/ENDCLASS\.\s*$/,  readFileSync('recipes/l3-remote/receive.tpl','utf8') + 'ENDCLASS.\n');
}
function ddic(name, fields, table=false) {
  const int = {CHAR:'C',NUMC:'N',DATS:'D',TIMS:'T',INT4:'X',INT2:'s',INT1:'b',DEC:'P',CURR:'P',QUAN:'P'};
  const entry = (f)=>`    <DD03P>\n     <FIELDNAME>${f.name}</FIELDNAME>${f.key ? '\n     <KEYFLAG>X</KEYFLAG><NOTNULL>X</NOTNULL>' : ''}\n     <ADMINFIELD>0</ADMINFIELD><INTTYPE>${int[f.type]}</INTTYPE>\n     <DATATYPE>${f.type}</DATATYPE><LENG>${String(f.length).padStart(6,'0')}</LENG>\n     <INTLEN>${String(['CHAR','NUMC','DATS','TIMS'].includes(f.type)?f.length*2:f.type==='INT4'?4:f.type==='INT2'?2:f.type==='INT1'?1:8).padStart(6,'0')}</INTLEN>\n     <DECIMALS>${String(f.decimals).padStart(6,'0')}</DECIMALS>\n    </DD03P>`;
  return `<?xml version="1.0" encoding="utf-8"?>\n<abapGit version="v1.0.0" serializer="LCL_OBJECT_TABL" serializer_version="v1.0.0">\n <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values>\n  <DD02V><TABNAME>${name.toUpperCase()}</TABNAME><DDLANGUAGE>E</DDLANGUAGE><TABCLASS>${table?'TRANSP':'INTTAB'}</TABCLASS>\n   <DDTEXT>Generated L3 remote alert contract</DDTEXT><EXCLASS>1</EXCLASS>${table?'<CONTFLAG>A</CONTFLAG>':''}</DD02V>\n${table?`  <DD09L><TABNAME>${name.toUpperCase()}</TABNAME><TABKAT>0</TABKAT><TABART>APPL1</TABART><BUFALLOW>N</BUFALLOW></DD09L>\n`:''}  <DD03P_TABLE>\n${fields.map(entry).join('\n')}\n  </DD03P_TABLE>\n </asx:values></asx:abap>\n</abapGit>\n`;
}
export async function renderRemote(model, {classXml}) {
  const r = model.remote, files = {};
  const heads = [field('set_name','CHAR',16),field('run_id','CHAR',32),field('rule_name','CHAR',60),field('model_hash','CHAR',71),field('run_mode','CHAR',1),
    field('check_date','DATS',8),field('pile_no','INT4',10),field('attempt','INT4',10),field('stage_no','INT4',10),field('rule_no','INT4',10),
    field('snap_id','CHAR',32),field('content_hash','CHAR',64),field('row_count','INT4',10),field('key_offset','INT4',10),field('key_length','INT4',10),
    field('rule_class','CHAR',30),field('rule_file','CHAR',128),field('rule_line','INT4',10)];
  const receipt = [field('set_name','CHAR',16,true),field('run_id','CHAR',32,true),field('rule_name','CHAR',60,true),field('pile_no','INT4',10,true),field('attempt','INT4',10),
    field('remote_run','CHAR',32),field('status','CHAR',16),field('alerts','INT4',10),field('closed','INT4',10),field('open_alerts','INT4',10),field('budget_alerts','INT4',10)];
  files[`${r.header}.tabl.xml`] = ddic(r.header,heads);
  files[`${r.row}.tabl.xml`] = ddic(r.row,r.fields);
  files[`${r.receipt}.tabl.xml`] = ddic(r.receipt,receipt,true);
  files[`${r.link}.tabl.xml`] = ddic(r.link,[field('set_name','CHAR',16,true),field('run_id','CHAR',32,true),field('remote_run','CHAR',32)],true);
  files[`${r.rows}.ttyp.xml`] = `<?xml version="1.0" encoding="utf-8"?>\n<abapGit version="v1.0.0" serializer="LCL_OBJECT_TTYP" serializer_version="v1.0.0">\n <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values>\n  <DD40V><TYPENAME>${r.rows.toUpperCase()}</TYPENAME><DDLANGUAGE>E</DDLANGUAGE><ROWTYPE>${r.row.toUpperCase()}</ROWTYPE>\n   <ROWKIND>S</ROWKIND><DATATYPE>STRU</DATATYPE><ACCESSMODE>T</ACCESSMODE><KEYDEF>D</KEYDEF><KEYKIND>N</KEYKIND><DDTEXT>Flat alert payload</DDTEXT></DD40V>\n </asx:values></asx:abap>\n</abapGit>\n`;
  const param = (tag,name,type)=>`<${tag}><PARAMETER>${name}</PARAMETER><TYP>${type.toUpperCase()}</TYP></${tag}>`;
  files[`${r.group}.fugr.xml`] = `<?xml version="1.0" encoding="utf-8"?>\n<abapGit version="v1.0.0" serializer="LCL_OBJECT_FUGR" serializer_version="v1.0.0">\n <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values>\n  <AREAT>Generated L3 remote alert receiver</AREAT>\n  <INCLUDES><SOBJ_NAME>SAPL${r.group.toUpperCase()}</SOBJ_NAME><SOBJ_NAME>L${r.group.toUpperCase()}TOP</SOBJ_NAME></INCLUDES>\n  <FUNCTIONS><item><FUNCNAME>${r.function}</FUNCNAME><REMOTE_CALL>R</REMOTE_CALL><SHORT_TEXT>Receive alert pile</SHORT_TEXT>\n   <IMPORT>\n    ${param('RSIMP','IS_HEADER',r.header)}\n    ${param('RSIMP','IT_ROWS',r.rows)}\n   </IMPORT>\n   <EXPORT>${param('RSEXP','ES_RESULT',r.receipt)}</EXPORT>\n   <EXCEPTION><RSEXC><EXCEPTION>SNAPSHOT_MISMATCH</EXCEPTION></RSEXC></EXCEPTION>\n  </item></FUNCTIONS>\n </asx:values></asx:abap>\n</abapGit>\n`;
  files[`${r.group}.fugr.sapl${r.group}.abap`] = `INCLUDE l${r.group}top.\n`;
  files[`${r.group}.fugr.l${r.group}top.abap`] = `FUNCTION-POOL ${r.group}.\n`;
  // abapGit refuses a function group whose main program or TOP include has no
  // attributes file ("File not found: <group>.fugr.sapl<group>.xml", A4H 2026-10-03);
  // the main program is a function pool (SUBC F), the TOP an include (SUBC I).
  const progdir = (name,subc)=>`<?xml version="1.0" encoding="utf-8"?>\n<abapGit version="v1.0.0" serializer="LCL_OBJECT_PROG" serializer_version="v1.0.0">\n <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">\n  <asx:values>\n   <PROGDIR><NAME>${name.toUpperCase()}</NAME><SUBC>${subc}</SUBC><FIXPT>X</FIXPT><UCCHECK>X</UCCHECK></PROGDIR>\n  </asx:values>\n </asx:abap>\n</abapGit>\n`;
  files[`${r.group}.fugr.sapl${r.group}.xml`] = progdir(`sapl${r.group}`,'F');
  files[`${r.group}.fugr.l${r.group}top.xml`] = progdir(`l${r.group}top`,'I');
  for (const [name,tpl] of [[`${r.class}.clas.abap`,'client'],[`${r.group}.fugr.${r.function.toLowerCase()}.abap`,'module']]) {
    const rendered = await renderRecipe({...model, ...r},`recipes/l3-remote/${tpl}.tpl`,{profile:'abap'});
    const error = rendered.findings.find((f)=>f.severity==='E');
    if (error) throw new Error(`remote ${name}:${error.line}: ${error.text}`);
    files[name] = rendered.text;
    files[name.replace(/\.abap$/,'.trace.json')] = JSON.stringify({source:model.source,recipe:`recipes/l3-remote/${tpl}.tpl`,lines:rendered.trace},null,2)+'\n';
  }
  files[`${r.class}.clas.xml`] = classXml(model,r.class,'Remote alert sink');
  return files;
}
