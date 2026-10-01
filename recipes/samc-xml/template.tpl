<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_SAMC" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <SAMC>
    <HEADER><APPLICATION_ID>{{applicationId}}</APPLICATION_ID><VERSION>{{version}}</VERSION></HEADER>
{{#has_text}}
    <TEXT><APPLICATION_ID>{{applicationId}}</APPLICATION_ID><VERSION>{{version}}</VERSION>{{#has_lang}}<LANG>{{lang}}</LANG>{{/has_lang}}{{#has_description}}<DESCRIPTION>{{description}}</DESCRIPTION>{{/has_description}}</TEXT>
{{/has_text}}
{{#has_channels}}
    <CHANNELS>
{{#channels}}     <AMC_CHANNEL><APPLICATION_ID>{{applicationId}}</APPLICATION_ID><VERSION>{{version}}</VERSION><CHANNEL_ID>{{channelId}}</CHANNEL_ID><SCOPE>{{scope}}</SCOPE><MESSAGE_TYPE_ID>{{messageType}}</MESSAGE_TYPE_ID></AMC_CHANNEL>
{{/channels}}    </CHANNELS>
{{/has_channels}}
{{#has_authorities}}
    <AUTHORITIES>
{{#authorities}}     <AMC_CHNL_AUTH><APPLICATION_ID>{{applicationId}}</APPLICATION_ID><VERSION>{{version}}</VERSION><NR>{{nr}}</NR><CHANNEL_ID>{{channelId}}</CHANNEL_ID><PROGRAM_ID>{{program_id}}</PROGRAM_ID><ACTIVITY>{{activity}}</ACTIVITY></AMC_CHNL_AUTH>
{{/authorities}}    </AUTHORITIES>
{{/has_authorities}}
   </SAMC>
  </asx:values>
 </asx:abap>
</abapGit>
