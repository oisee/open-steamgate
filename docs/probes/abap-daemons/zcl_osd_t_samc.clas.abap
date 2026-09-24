CLASS zcl_osd_t_samc DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    CLASS-METHODS xml RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS install IMPORTING iv_package TYPE devclass RETURNING VALUE(rv) TYPE string.
    CLASS-METHODS remove IMPORTING iv_package TYPE devclass RETURNING VALUE(rv) TYPE string.
  PRIVATE SECTION.
    CLASS-METHODS handler IMPORTING iv_package TYPE devclass
                          RETURNING VALUE(ri) TYPE REF TO zif_abapgit_object
                          RAISING zcx_abapgit_exception.
    CLASS-METHODS log_text IMPORTING ii_log TYPE REF TO zif_abapgit_log RETURNING VALUE(rv) TYPE string.
ENDCLASS.



CLASS zcl_osd_t_samc IMPLEMENTATION.

  METHOD xml.
    DATA lt TYPE string_table.
    APPEND `<?xml version="1.0" encoding="utf-8"?>` TO lt.
    APPEND `<abapGit version="v1.0.0" serializer="LCL_OBJECT_SAMC" serializer_version="v1.0.0">` TO lt.
    APPEND ` <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">` TO lt.
    APPEND `  <asx:values>` TO lt.
    APPEND `   <SAMC>` TO lt.
    APPEND `    <HEADER><APPLICATION_ID>ZOSD_T_AMC</APPLICATION_ID><VERSION>A</VERSION></HEADER>` TO lt.
    APPEND `    <TEXT><APPLICATION_ID>ZOSD_T_AMC</APPLICATION_ID><VERSION>A</VERSION><LANG>E</LANG><DESCRIPTION>OSD AMC probe (throwaway)</DESCRIPTION></TEXT>` TO lt.
    APPEND `    <CHANNELS>` TO lt.
    APPEND `     <AMC_CHANNEL><APPLICATION_ID>ZOSD_T_AMC</APPLICATION_ID><VERSION>A</VERSION><CHANNEL_ID>/pc</CHANNEL_ID><SCOPE>C</SCOPE><MESSAGE_TYPE_ID>PCP</MESSAGE_TYPE_ID></AMC_CHANNEL>` TO lt.
    APPEND `     <AMC_CHANNEL><APPLICATION_ID>ZOSD_T_AMC</APPLICATION_ID><VERSION>A</VERSION><CHANNEL_ID>/pu</CHANNEL_ID><SCOPE>U</SCOPE><MESSAGE_TYPE_ID>PCP</MESSAGE_TYPE_ID></AMC_CHANNEL>` TO lt.
    APPEND `     <AMC_CHANNEL><APPLICATION_ID>ZOSD_T_AMC</APPLICATION_ID><VERSION>A</VERSION><CHANNEL_ID>/ps</CHANNEL_ID><SCOPE>S</SCOPE><MESSAGE_TYPE_ID>PCP</MESSAGE_TYPE_ID></AMC_CHANNEL>` TO lt.
    APPEND `    </CHANNELS>` TO lt.
    APPEND `    <AUTHORITIES>` TO lt.
    APPEND `     <AMC_CHNL_AUTH><APPLICATION_ID>ZOSD_T_AMC</APPLICATION_ID><VERSION>A</VERSION><NR>1</NR><CHANNEL_ID>/pc</CHANNEL_ID><PROGRAM_ID>ZCL_OSD_T_DMN=================CP</PROGRAM_ID><ACTIVITY>S</ACTIVITY></AMC_CHNL_AUTH>` TO lt.
    APPEND `     <AMC_CHNL_AUTH><APPLICATION_ID>ZOSD_T_AMC</APPLICATION_ID><VERSION>A</VERSION><NR>2</NR><CHANNEL_ID>/pc</CHANNEL_ID><PROGRAM_ID>ZCL_OSD_T_DMN=================CP</PROGRAM_ID><ACTIVITY>R</ACTIVITY></AMC_CHNL_AUTH>` TO lt.
    APPEND `     <AMC_CHNL_AUTH><APPLICATION_ID>ZOSD_T_AMC</APPLICATION_ID><VERSION>A</VERSION><NR>3</NR><CHANNEL_ID>/pc</CHANNEL_ID><PROGRAM_ID>ZCL_OSD_T_DDRV================CP</PROGRAM_ID><ACTIVITY>S</ACTIVITY></AMC_CHNL_AUTH>` TO lt.
    APPEND `     <AMC_CHNL_AUTH><APPLICATION_ID>ZOSD_T_AMC</APPLICATION_ID><VERSION>A</VERSION><NR>4</NR><CHANNEL_ID>/pc</CHANNEL_ID><PROGRAM_ID>ZCL_OSD_T_DDRV================CP</PROGRAM_ID><ACTIVITY>R</ACTIVITY></AMC_CHNL_AUTH>` TO lt.
    APPEND `     <AMC_CHNL_AUTH><APPLICATION_ID>ZOSD_T_AMC</APPLICATION_ID><VERSION>A</VERSION><NR>5</NR><CHANNEL_ID>/pu</CHANNEL_ID><PROGRAM_ID>ZCL_OSD_T_DMN=================CP</PROGRAM_ID><ACTIVITY>S</ACTIVITY></AMC_CHNL_AUTH>` TO lt.
    APPEND `     <AMC_CHNL_AUTH><APPLICATION_ID>ZOSD_T_AMC</APPLICATION_ID><VERSION>A</VERSION><NR>6</NR><CHANNEL_ID>/pu</CHANNEL_ID><PROGRAM_ID>ZCL_OSD_T_DMN=================CP</PROGRAM_ID><ACTIVITY>R</ACTIVITY></AMC_CHNL_AUTH>` TO lt.
    APPEND `     <AMC_CHNL_AUTH><APPLICATION_ID>ZOSD_T_AMC</APPLICATION_ID><VERSION>A</VERSION><NR>7</NR><CHANNEL_ID>/pu</CHANNEL_ID><PROGRAM_ID>ZCL_OSD_T_DDRV================CP</PROGRAM_ID><ACTIVITY>S</ACTIVITY></AMC_CHNL_AUTH>` TO lt.
    APPEND `     <AMC_CHNL_AUTH><APPLICATION_ID>ZOSD_T_AMC</APPLICATION_ID><VERSION>A</VERSION><NR>8</NR><CHANNEL_ID>/pu</CHANNEL_ID><PROGRAM_ID>ZCL_OSD_T_DDRV================CP</PROGRAM_ID><ACTIVITY>R</ACTIVITY></AMC_CHNL_AUTH>` TO lt.
    APPEND `     <AMC_CHNL_AUTH><APPLICATION_ID>ZOSD_T_AMC</APPLICATION_ID><VERSION>A</VERSION><NR>9</NR><CHANNEL_ID>/ps</CHANNEL_ID><PROGRAM_ID>ZCL_OSD_T_DMN=================CP</PROGRAM_ID><ACTIVITY>S</ACTIVITY></AMC_CHNL_AUTH>` TO lt.
    APPEND `     <AMC_CHNL_AUTH><APPLICATION_ID>ZOSD_T_AMC</APPLICATION_ID><VERSION>A</VERSION><NR>10</NR><CHANNEL_ID>/ps</CHANNEL_ID><PROGRAM_ID>ZCL_OSD_T_DMN=================CP</PROGRAM_ID><ACTIVITY>R</ACTIVITY></AMC_CHNL_AUTH>` TO lt.
    APPEND `     <AMC_CHNL_AUTH><APPLICATION_ID>ZOSD_T_AMC</APPLICATION_ID><VERSION>A</VERSION><NR>11</NR><CHANNEL_ID>/ps</CHANNEL_ID><PROGRAM_ID>ZCL_OSD_T_DDRV================CP</PROGRAM_ID><ACTIVITY>S</ACTIVITY></AMC_CHNL_AUTH>` TO lt.
    APPEND `     <AMC_CHNL_AUTH><APPLICATION_ID>ZOSD_T_AMC</APPLICATION_ID><VERSION>A</VERSION><NR>12</NR><CHANNEL_ID>/ps</CHANNEL_ID><PROGRAM_ID>ZCL_OSD_T_DDRV================CP</PROGRAM_ID><ACTIVITY>R</ACTIVITY></AMC_CHNL_AUTH>` TO lt.
    APPEND `    </AUTHORITIES>` TO lt.
    APPEND `   </SAMC>` TO lt.
    APPEND `  </asx:values>` TO lt.
    APPEND ` </asx:abap>` TO lt.
    APPEND `</abapGit>` TO lt.
    rv = concat_lines_of( table = lt sep = cl_abap_char_utilities=>newline ).
  ENDMETHOD.

  METHOD handler.
    DATA(ls_item) = VALUE zif_abapgit_definitions=>ty_item( obj_type = 'SAMC' obj_name = 'ZOSD_T_AMC' devclass = iv_package ).
    ri = NEW zcl_abapgit_object_samc( is_item = ls_item iv_language = 'E' ).
  ENDMETHOD.

  METHOD log_text.
    LOOP AT ii_log->get_messages( ) INTO DATA(ls_m).
      rv = |{ rv }[{ ls_m-type }] { ls_m-text } |.
    ENDLOOP.
  ENDMETHOD.

  METHOD install.
    DATA(li_log) = CAST zif_abapgit_log( NEW zcl_abapgit_log( ) ).
    TRY.
        DATA(li_obj) = handler( iv_package ).
        DATA(li_xml) = CAST zif_abapgit_xml_input( NEW zcl_abapgit_xml_input( iv_xml = xml( ) iv_filename = 'zosd_t_amc.samc.xml' ) ).
        li_obj->deserialize( iv_package = iv_package io_xml = li_xml iv_step = zif_abapgit_object=>gc_step_id-abap
                             ii_log = li_log iv_transport = space ).
        rv = |deserialized; exists={ li_obj->exists( ) } active={ li_obj->is_active( ) } log={ log_text( li_log ) }|.
      CATCH cx_root INTO DATA(lx).
        rv = |{ cl_abap_classdescr=>get_class_name( lx ) }: { lx->get_text( ) } log={ log_text( li_log ) }|.
    ENDTRY.
  ENDMETHOD.

  METHOD remove.
    TRY.
        DATA(li_obj) = handler( iv_package ).
        li_obj->delete( iv_package = iv_package iv_transport = space ).
        rv = |deleted; exists={ li_obj->exists( ) }|.
      CATCH cx_root INTO DATA(lx).
        rv = |{ cl_abap_classdescr=>get_class_name( lx ) }: { lx->get_text( ) }|.
    ENDTRY.
  ENDMETHOD.

ENDCLASS.
