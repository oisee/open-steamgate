// what a create writes, per type: the abapGit header and a source skeleton
// (the client's first save replaces the skeleton). Header fields are the
// ones abapGit serializes for a fresh object of the kind.
const abapGitHeader = (serializer, inner) => `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="${serializer}" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
${inner}
  </asx:values>
 </asx:abap>
</abapGit>
`;
const xmlText = (text) => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const textPool = (text) => text === "" ? "" : `
   <TPOOL>
    <item>
     <ID>R</ID>
     <ENTRY>${xmlText(text)}</ENTRY>
     <LENGTH>${String(text).length}</LENGTH>
    </item>
   </TPOOL>`;
export const CREATABLE = {
  CLAS: (name, text, source) => ({
    ".clas.abap": source ?? `CLASS ${name.toLowerCase()} DEFINITION PUBLIC CREATE PUBLIC.\n  PUBLIC SECTION.\nENDCLASS.\n\nCLASS ${name.toLowerCase()} IMPLEMENTATION.\nENDCLASS.\n`,
    ".clas.xml": abapGitHeader("LCL_OBJECT_CLAS", `   <VSEOCLASS>
    <CLSNAME>${name}</CLSNAME>
    <LANGU>E</LANGU>
    <DESCRIPT>${xmlText(text)}</DESCRIPT>
    <STATE>1</STATE>
    <CLSCCINCL>X</CLSCCINCL>
    <FIXPT>X</FIXPT>
    <UNICODE>X</UNICODE>
   </VSEOCLASS>`),
  }),
  INTF: (name, text, source) => ({
    ".intf.abap": source ?? `INTERFACE ${name.toLowerCase()} PUBLIC.\nENDINTERFACE.\n`,
    ".intf.xml": abapGitHeader("LCL_OBJECT_INTF", `   <VSEOINTERF>
    <CLSNAME>${name}</CLSNAME>
    <LANGU>E</LANGU>
    <DESCRIPT>${xmlText(text)}</DESCRIPT>
    <EXPOSURE>2</EXPOSURE>
    <STATE>1</STATE>
    <UNICODE>X</UNICODE>
   </VSEOINTERF>`),
  }),
  PROG: (name, text, source) => ({
    ".prog.abap": source ?? `REPORT ${name.toLowerCase()}.\n`,
    ".prog.xml": abapGitHeader("LCL_OBJECT_PROG", `   <PROGDIR>
    <NAME>${name}</NAME>
    <DBAPL>S</DBAPL>
    <SUBC>1</SUBC>
    <FIXPT>X</FIXPT>
    <LDBNAME>D$S</LDBNAME>
    <UCCHECK>X</UCCHECK>
   </PROGDIR>${textPool(text)}`),
  }),
  INCL: (name, text, source) => ({
    ".prog.abap": source ?? `*&---------------------------------------------------------------------*\n*& Include ${name}\n*&---------------------------------------------------------------------*\n`,
    ".prog.xml": abapGitHeader("LCL_OBJECT_PROG", `   <PROGDIR>
    <NAME>${name}</NAME>
    <SUBC>I</SUBC>
    <APPL>S</APPL>
    <FIXPT>X</FIXPT>
    <UCCHECK>X</UCCHECK>
   </PROGDIR>${textPool(text)}`),
  }),
  DDLS: (name, text, source) => ({
    ".ddls.asddls": source ?? `@EndUserText.label: '${String(text).replaceAll("'", "''")}'\ndefine view entity ${name} as select from zosd_test_item\n{\n  key item_id\n}\n`,
    ".ddls.xml": abapGitHeader("LCL_OBJECT_DDLS", `   <DDLS>
    <DDLNAME>${name}</DDLNAME>
    <DDLANGUAGE>E</DDLANGUAGE>
    <DDTEXT>${xmlText(text)}</DDTEXT>
   </DDLS>`),
  }),
  DEVC: (name, text) => ({
    "package.devc.xml": abapGitHeader("LCL_OBJECT_DEVC", `   <DEVC>
    <CTEXT>${xmlText(text)}</CTEXT>
   </DEVC>`),
  }),
};
