const object = '/oo/classes/zcl_osd_adt_uri';
const source = /CLASS zcl_osd_adt_uri DEFINITION/i;
const atom = /application\/(?:atomsvc|atom)\+xml/;
export default [
  ...['/discovery', '/core/discovery'].map((path, i) => ({id: `C${i + 1}-discovery`, point: `C${i + 1}`,
    title: 'Discovery advertises repository and source collections', request: {path},
    expect: {status: 200, contentType: atom, xml: [{xpath: '/app:service/app:workspace/app:collection', regexp: /^[\s\S]*$/}],
      body: /repository\/informationsystem\/search/}})),
  {id: 'C3-head', point: 'C3', title: 'HEAD discovery has no entity', request: {method: 'HEAD', path: '/core/discovery'},
    expect: {status: 200, contentType: atom, bodyBytes: ''}},
  {id: 'C9-systeminformation', point: 'C9', title: 'System identity fields', request: {path: '/core/http/systeminformation'},
    expect: {status: 200, contentType: /application\/(?:json|vnd\.sap\.adt\.core\.http\.systeminformation\.v1\+json)/, json: {systemID: /\S+/, userName: /\S+/, client: /^\d{3}$/, language: /\S+/}}},
  {id: 'C4-nodestructure', point: 'C4', title: 'POST browses our ADT package',
    request: {method: 'POST', path: '/repository/nodestructure', query: {parent_name: '$STG_ADT', parent_type: 'DEVC/K'}},
    expect: {status: 200, xml: [{xpath: '/asx:abap/asx:values/DATA/TREE_CONTENT', regexp: /^[\s\S]*$/}], body: /ZCL_OSD_ADT_URI/}},
  {id: 'C4b-nodestructure-xml-body', point: 'C4b', title: 'POST accepts a real IDE XML body',
    request: {method: 'POST', path: '/repository/nodestructure',
      query: {parent_name: '$STG_ADT', parent_tech_name: '$STG_ADT', parent_type: 'DEVC/K', withShortDescriptions: true},
      headers: {
        'content-type': 'application/vnd.sap.as+xml; charset=UTF-8; dataname=null',
        accept: 'application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.RepositoryObjectTreeContent'
      },
      body: '<?xml version="1.0" encoding="UTF-8" ?><asx:abap version="1.0" xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><TV_NODEKEY>000000</TV_NODEKEY></DATA></asx:values></asx:abap>'},
    expect: {status: 200, xml: [{xpath: '/asx:abap/asx:values/DATA/TREE_CONTENT', regexp: /^[\s\S]*$/}], body: /ZCL_OSD_ADT_URI/}},
  {id: 'C5-search', point: 'C5', title: 'Search points to the matching class',
    request: {path: '/repository/informationsystem/search', query: {query: 'ZCL_OSD_ADT_URI'}},
    expect: {status: 200, xml: [{xpath: '/adtcore:objectReferences/adtcore:objectReference/@adtcore:name', value: 'ZCL_OSD_ADT_URI'}]}},
  {id: 'C6-class-document', point: 'C6', title: 'Class metadata and include links', request: {path: object},
    expect: {status: 200, xml: [{xpath: '/class:abapClass/@adtcore:name', value: 'ZCL_OSD_ADT_URI'}], body: /includes\/testclasses/}},
  ...[undefined, 'active', 'inactive'].map((version, i) => ({id: `R${i + 1}-source-${version ?? 'default'}`, point: `R${i + 1}`,
    title: `Main source ${version ?? 'default'}`, request: {path: object + '/source/main', query: {version}},
    expect: {status: 200, contentType: /text\/plain/, body: source}})),
  ...['testclasses', 'implementations'].map((include, i) => ({id: `R${i + 4}-include-${include}`, point: `R${i + 4}`,
    title: `Class include ${include}`, request: {path: object + '/includes/' + include},
    expect: {status: 200, contentType: /text\/plain/, body: include === 'testclasses' ? /FOR TESTING/i : /^[\s\S]*$/}})),
  {id: 'V1-versions', point: 'V1', title: 'Versions feed carries an active source entry', request: {path: object + '/source/main/versions'},
    expect: {status: 200, contentType: /application\/atom\+xml/, xml: [{xpath: '/atom:feed/atom:title', value: 'Version List of ZCL_OSD_ADT_URI (CLAS)'},
      {xpath: '/atom:feed/atom:entry/atom:id', regexp: /^\d{5}$/}], body: /00000/}},
];
