CLASS zcl_stg_segw_repo DEFINITION PUBLIC CREATE PUBLIC.
* A SEGW project as an abapGit repository, from the tables: .abapgit.xml,
* the package, the project tree (the export), the service and model
* registration (IWSV, IWMO, as stg-compile writes them) and the generated
* classes with their XML. What abapGit pulls into a system to have the
* project there, classes created and activated by abapGit, not by us.
  PUBLIC SECTION.
    CLASS-METHODS files
      IMPORTING
        iv_project      TYPE string
      RETURNING
        VALUE(rt_files) TYPE zcl_stg_segw_gen=>tt_file
      RAISING
        /iwbep/cx_mgw_busi_exception.

* the same as one zip, base64 (a browser turns it into a download)
    CLASS-METHODS zip
      IMPORTING
        iv_project       TYPE string
      RETURNING
        VALUE(rv_base64) TYPE string
      RAISING
        /iwbep/cx_mgw_busi_exception.

    CLASS-METHODS iwsv_xml
      IMPORTING
        is_model      TYPE zcl_stg_segw_gen=>ty_model
      RETURNING
        VALUE(rv_xml) TYPE string.

    CLASS-METHODS iwmo_xml
      IMPORTING
        is_model      TYPE zcl_stg_segw_gen=>ty_model
      RETURNING
        VALUE(rv_xml) TYPE string.

  PRIVATE SECTION.
* abapGit names a versioned file by the technical name padded, then the
* four-character version -- and the padding is PER OBJECT TYPE:
*   IWSV padded to 35 (key 39), IWMO and IWVB padded to 32 (key 36).
* It was 34 for both here and in tools/stg-compile.mjs, and the two agreed,
* so the test holding them byte-identical passed for months: it compares the
* implementations with each other and never with a system. Measured by
* exporting a real SEGW package from A4H with abapGit (S_APS_ODATA_GBT_NTE)
* and reading the names it wrote, three of each type.
    CLASS-METHODS versioned_file
      IMPORTING
        iv_name        TYPE string
        iv_ext         TYPE string
      RETURNING
        VALUE(rv_name) TYPE string.

    CLASS-METHODS bom
      RETURNING
        VALUE(rv_bom) TYPE string.
ENDCLASS.

CLASS zcl_stg_segw_repo IMPLEMENTATION.

  METHOD bom.
    rv_bom = zcl_stg_segw_gen=>bom( ).
  ENDMETHOD.

  METHOD versioned_file.
    DATA lv_width TYPE i.

    CASE iv_ext.
      WHEN '.iwsv.xml'.
        lv_width = 35.
      WHEN '.iwmo.xml' OR '.iwvb.xml'.
        lv_width = 32.
      WHEN OTHERS.
*       a width guessed is a name that is almost right, which is a different
*       name; say so instead
        ASSERT 1 = 'no key width known for this extension'.
    ENDCASE.

    rv_name = to_lower( iv_name ).
    IF strlen( rv_name ) < lv_width.
      rv_name = rv_name && repeat( val = ` ` occ = lv_width - strlen( rv_name ) ).
    ENDIF.
    rv_name = rv_name && '0001' && iv_ext.
  ENDMETHOD.

  METHOD iwsv_xml.
    rv_xml = bom( )
      && |<?xml version="1.0" encoding="utf-8"?>\n|
      && |<abapGit version="v1.0.0" serializer="LCL_OBJECT_IWSV" serializer_version="v1.0.0">\n|
      && | <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">\n|
      && |  <asx:values>\n|
      && |   <_-IWBEP_-I_MGW_SRG>\n|
      && |    <_-IWBEP_-I_MGW_SRG>\n|
      && |     <GROUP_TECH_NAME>{ is_model-service }</GROUP_TECH_NAME>\n|
      && |     <GROUP_VERSION>0001</GROUP_VERSION>\n|
      && |     <MODEL_TECH_NAME>{ is_model-model }</MODEL_TECH_NAME>\n|
      && |     <MODEL_VERSION>0001</MODEL_VERSION>\n|
      && |    </_-IWBEP_-I_MGW_SRG>\n|
      && |   </_-IWBEP_-I_MGW_SRG>\n|
      && |   <_-IWBEP_-I_MGW_SRH>\n|
      && |    <_-IWBEP_-I_MGW_SRH>\n|
      && |     <TECHNICAL_NAME>{ is_model-service }</TECHNICAL_NAME>\n|
      && |     <VERSION>0001</VERSION>\n|
      && |     <EXTERNAL_NAME>{ is_model-service }</EXTERNAL_NAME>\n|
      && |     <CLASS_NAME>{ is_model-dpc_ext }</CLASS_NAME>\n|
      && |     <IS_SAP_SERVICE>-</IS_SAP_SERVICE>\n|
      && |    </_-IWBEP_-I_MGW_SRH>\n|
      && |   </_-IWBEP_-I_MGW_SRH>\n|
      && |   <_-IWBEP_-I_MGW_SRT>\n|
      && |    <_-IWBEP_-I_MGW_SRT>\n|
      && |     <TECHNICAL_NAME>{ is_model-service }</TECHNICAL_NAME>\n|
      && |     <VERSION>0001</VERSION>\n|
      && |     <LANGUAGE>E</LANGUAGE>\n|
      && |     <DESCRIPTION>{ zcl_stg_segw_export=>escape( is_model-description ) }</DESCRIPTION>\n|
      && |    </_-IWBEP_-I_MGW_SRT>\n|
      && |   </_-IWBEP_-I_MGW_SRT>\n|
      && |  </asx:values>\n|
      && | </asx:abap>\n|
      && |</abapGit>\n|.
  ENDMETHOD.

  METHOD iwmo_xml.
    rv_xml = bom( )
      && |<?xml version="1.0" encoding="utf-8"?>\n|
      && |<abapGit version="v1.0.0" serializer="LCL_OBJECT_IWMO" serializer_version="v1.0.0">\n|
      && | <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">\n|
      && |  <asx:values>\n|
      && |   <_-IWBEP_-I_MGW_OHD>\n|
      && |    <_-IWBEP_-I_MGW_OHD>\n|
      && |     <TECHNICAL_NAME>{ is_model-model }</TECHNICAL_NAME>\n|
      && |     <VERSION>0001</VERSION>\n|
      && |     <CLASS_NAME>{ is_model-mpc_ext }</CLASS_NAME>\n|
      && |    </_-IWBEP_-I_MGW_OHD>\n|
      && |   </_-IWBEP_-I_MGW_OHD>\n|
      && |   <_-IWBEP_-I_MGW_OHT>\n|
      && |    <_-IWBEP_-I_MGW_OHT>\n|
      && |     <TECHNICAL_NAME>{ is_model-model }</TECHNICAL_NAME>\n|
      && |     <VERSION>0001</VERSION>\n|
      && |     <LANGUAGE>E</LANGUAGE>\n|
      && |     <DESCRIPTION>{ zcl_stg_segw_export=>escape( is_model-description ) }</DESCRIPTION>\n|
      && |    </_-IWBEP_-I_MGW_OHT>\n|
      && |   </_-IWBEP_-I_MGW_OHT>\n|
      && |  </asx:values>\n|
      && | </asx:abap>\n|
      && |</abapGit>\n|.
  ENDMETHOD.

  METHOD files.
    DATA ls_model TYPE zcl_stg_segw_gen=>ty_model.
    DATA ls_file  TYPE zcl_stg_segw_gen=>ty_file.
    DATA lt_gen   TYPE zcl_stg_segw_gen=>tt_file.

    ls_model = zcl_stg_segw_gen=>build_model( iv_project ).

    ls_file-name    = '.abapgit.xml'.
    ls_file-content = bom( )
      && |<?xml version="1.0" encoding="utf-8"?>\n|
      && |<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">\n|
      && | <asx:values>\n|
      && |  <DATA>\n|
      && |   <MASTER_LANGUAGE>E</MASTER_LANGUAGE>\n|
      && |   <STARTING_FOLDER>/src/</STARTING_FOLDER>\n|
      && |   <FOLDER_LOGIC>PREFIX</FOLDER_LOGIC>\n|
      && |  </DATA>\n|
      && | </asx:values>\n|
      && |</asx:abap>\n|.
    APPEND ls_file TO rt_files.

    ls_file-name    = 'src/package.devc.xml'.
    ls_file-content = bom( )
      && |<?xml version="1.0" encoding="utf-8"?>\n|
      && |<abapGit version="v1.0.0" serializer="LCL_OBJECT_DEVC" serializer_version="v1.0.0">\n|
      && | <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">\n|
      && |  <asx:values>\n|
      && |   <DEVC>\n|
      && |    <CTEXT>{ zcl_stg_segw_export=>escape( ls_model-description ) }</CTEXT>\n|
      && |   </DEVC>\n|
      && |  </asx:values>\n|
      && | </asx:abap>\n|
      && |</abapGit>\n|.
    APPEND ls_file TO rt_files.

    ls_file-name    = 'src/' && zcl_stg_segw_gen=>file_name( iv_class = ls_model-project iv_ext = '.iwpr.xml' ).
    ls_file-content = zcl_stg_segw_export=>export( iv_project ).
    APPEND ls_file TO rt_files.

    IF ls_model-service IS NOT INITIAL.
      ls_file-name    = 'src/' && versioned_file( iv_name = ls_model-service iv_ext = '.iwsv.xml' ).
      ls_file-content = iwsv_xml( ls_model ).
      APPEND ls_file TO rt_files.
    ENDIF.
    IF ls_model-model IS NOT INITIAL.
      ls_file-name    = 'src/' && versioned_file( iv_name = ls_model-model iv_ext = '.iwmo.xml' ).
      ls_file-content = iwmo_xml( ls_model ).
      APPEND ls_file TO rt_files.
    ENDIF.

    IF ls_model-mpc IS NOT INITIAL.
      lt_gen = zcl_stg_segw_gen=>generate( iv_project ).
      LOOP AT lt_gen INTO ls_file.
        ls_file-name = 'src/' && ls_file-name.
        APPEND ls_file TO rt_files.
      ENDLOOP.
    ENDIF.
  ENDMETHOD.

  METHOD zip.
    DATA lt_files TYPE zcl_stg_segw_gen=>tt_file.
    DATA ls_file  TYPE zcl_stg_segw_gen=>ty_file.
    DATA lo_zip   TYPE REF TO cl_abap_zip.
    DATA lv_bytes TYPE xstring.

    lt_files = files( iv_project ).
    CREATE OBJECT lo_zip.
    LOOP AT lt_files INTO ls_file.
      lo_zip->add( name    = ls_file-name
                   content = cl_abap_codepage=>convert_to( ls_file-content ) ).
    ENDLOOP.
    lv_bytes = lo_zip->save( ).
    rv_base64 = cl_http_utility=>encode_x_base64( lv_bytes ).
  ENDMETHOD.

ENDCLASS.
