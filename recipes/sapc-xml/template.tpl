<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_SAPC" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <SAPC>
    <HEADER>
     <APPLICATION_ID>{{applicationId}}</APPLICATION_ID>
     <VERSION>{{version}}</VERSION>
     <PATH>{{path}}</PATH>
     <CLASS_NAME>{{className}}</CLASS_NAME>
     <APPLICATION_VERSION>{{applicationVersion}}</APPLICATION_VERSION>
{{#has_stateful}}
     <STATEFUL>{{statefulXml}}</STATEFUL>
{{/has_stateful}}
    </HEADER>
{{#has_text}}
    <TEXT>
     <APPLICATION_ID>{{applicationId}}</APPLICATION_ID>
     <VERSION>{{version}}</VERSION>
{{#has_lang}}
     <LANG>{{lang}}</LANG>
{{/has_lang}}
{{#has_description}}
     <DESCRIPTION>{{description}}</DESCRIPTION>
{{/has_description}}
    </TEXT>
{{/has_text}}
   </SAPC>
  </asx:values>
 </asx:abap>
</abapGit>
