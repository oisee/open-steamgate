* The other half of abapGit in a box: the fetch, inside OSD, with no git
* binary in front of it.
*
* Import already knew what to do with a repository once the files were on
* disk; what it did not have was a way to get them. This is that way, and
* it is the git smart HTTP protocol, which is two requests:
*
*   GET  <url>/info/refs?service=git-upload-pack   what branches exist
*   POST <url>/git-upload-pack                     a pack of what we want
*
* Both speak pkt-line, a four hex digit length in front of every line, and
* the answer to the second is a pack file: every object of the commit,
* deflated, with deltas between them.
*
* Reading that pack is the hard half, and it is not ours to write again:
* abapGit already has it, thousands of lines of pack, delta and zlib code
* that this repository transpiles as a library (abap_transpile.json names
* the twenty-seven objects). So the protocol is here and the decoding is
* abapGit's, which is the same division a system makes.
CLASS zcl_osd_git DEFINITION PUBLIC CREATE PUBLIC.

  PUBLIC SECTION.

    TYPES:
      BEGIN OF ty_ref,
        sha1 TYPE string,
        name TYPE string,
      END OF ty_ref .
    TYPES:
      ty_refs_tt TYPE STANDARD TABLE OF ty_ref WITH DEFAULT KEY .
    TYPES:
      BEGIN OF ty_file,
        path     TYPE string,
        filename TYPE string,
        data     TYPE xstring,
      END OF ty_file .
    TYPES:
      ty_files_tt TYPE STANDARD TABLE OF ty_file WITH DEFAULT KEY .
    TYPES:
      BEGIN OF ty_clone,
        url    TYPE string,
        branch TYPE string,
        commit TYPE string,
        files  TYPE ty_files_tt,
      END OF ty_clone .

    " what the remote has: every branch and tag, with the commit it points at
    CLASS-METHODS refs
      IMPORTING
        !iv_url        TYPE string
      RETURNING
        VALUE(rt_refs) TYPE ty_refs_tt
      RAISING
        zcx_abapgit_exception .

    " one branch of a repository as files, the way abapGit's deserialise
    " sees them: path, filename and the bytes
    CLASS-METHODS clone
      IMPORTING
        !iv_url         TYPE string
        !iv_branch      TYPE string OPTIONAL
      RETURNING
        VALUE(rs_clone) TYPE ty_clone
      RAISING
        zcx_abapgit_exception .

    " ---------------------------------------------------------- the pieces
    " public so that each can be checked against a captured answer, with no
    " network in the test

    " a pkt-line stream: 0032want <sha1>\n and the rest
    CLASS-METHODS parse_refs
      IMPORTING
        !iv_data       TYPE xstring
      RETURNING
        VALUE(rt_refs) TYPE ty_refs_tt
      RAISING
        zcx_abapgit_exception .

    " the body of the upload-pack request
    CLASS-METHODS want
      IMPORTING
        !iv_sha1       TYPE string
        !iv_depth      TYPE i DEFAULT 1
      RETURNING
        VALUE(rv_body) TYPE string .

    " the answer carries pkt-lines first, NAK and any shallow ones, and
    " then the pack itself, unframed because no side band was asked for
    CLASS-METHODS pack_of
      IMPORTING
        !iv_data       TYPE xstring
      RETURNING
        VALUE(rv_pack) TYPE xstring
      RAISING
        zcx_abapgit_exception .

    " a commit and the objects around it become the files of a working tree
    CLASS-METHODS files_of
      IMPORTING
        !iv_commit      TYPE string
        !it_objects     TYPE zif_abapgit_definitions=>ty_objects_tt
      RETURNING
        VALUE(rt_files) TYPE ty_files_tt
      RAISING
        zcx_abapgit_exception .

    " the branch a clone takes when the caller names none
    CLASS-METHODS default_branch
      IMPORTING
        !it_refs         TYPE ty_refs_tt
      RETURNING
        VALUE(rv_branch) TYPE string .

  PROTECTED SECTION.
  PRIVATE SECTION.

    CONSTANTS c_service TYPE string VALUE 'git-upload-pack' ##NO_TEXT.

    CLASS-METHODS pkt
      IMPORTING
        !iv_text      TYPE string
      RETURNING
        VALUE(rv_pkt) TYPE string .

    " four ASCII hex digits, which is how long a pkt-line says it is
    CLASS-METHODS hex_to_int
      IMPORTING
        !iv_hex          TYPE xstring
      RETURNING
        VALUE(rv_length) TYPE i .

    CLASS-METHODS int_to_hex
      IMPORTING
        !iv_int       TYPE i
      RETURNING
        VALUE(rv_hex) TYPE string .

    " a ref line ends at the first null byte, and what follows it is the
    " server's capability list, not part of the name
    CLASS-METHODS until_null
      IMPORTING
        !iv_data       TYPE xstring
      RETURNING
        VALUE(rv_data) TYPE xstring .

    CLASS-METHODS get
      IMPORTING
        !iv_url        TYPE string
        !iv_accept     TYPE string OPTIONAL
      RETURNING
        VALUE(rv_data) TYPE xstring
      RAISING
        zcx_abapgit_exception .

    CLASS-METHODS post
      IMPORTING
        !iv_url        TYPE string
        !iv_type       TYPE string
        !iv_body       TYPE string
      RETURNING
        VALUE(rv_data) TYPE xstring
      RAISING
        zcx_abapgit_exception .

    " SEND and RECEIVE with their classic exceptions: an unreachable remote or
    " an error status is an exception with the reason, not a runtime error
    CLASS-METHODS exchange
      IMPORTING
        !ii_client     TYPE REF TO if_http_client
        !iv_url        TYPE string
      RETURNING
        VALUE(rv_data) TYPE xstring
      RAISING
        zcx_abapgit_exception .

    CLASS-METHODS walk
      IMPORTING
        !iv_tree        TYPE string
        !iv_path        TYPE string
        !it_objects     TYPE zif_abapgit_definitions=>ty_objects_tt
      RETURNING
        VALUE(rt_files) TYPE ty_files_tt
      RAISING
        zcx_abapgit_exception .

    CLASS-METHODS object_of
      IMPORTING
        !iv_sha1         TYPE string
        !it_objects      TYPE zif_abapgit_definitions=>ty_objects_tt
      RETURNING
        VALUE(rv_data)   TYPE xstring
      RAISING
        zcx_abapgit_exception .

ENDCLASS.



CLASS zcl_osd_git IMPLEMENTATION.


  METHOD refs.

    DATA lv_data TYPE xstring.

    lv_data = get(
      iv_url    = |{ iv_url }/info/refs?service={ c_service }|
      iv_accept = |application/x-{ c_service }-advertisement| ).

    rt_refs = parse_refs( lv_data ).

  ENDMETHOD.


  METHOD parse_refs.

    DATA lv_offset TYPE i.
    DATA lv_length TYPE i.
    DATA lv_line   TYPE string.
    DATA lv_hex    TYPE xstring.
    DATA lv_sha1   TYPE string.
    DATA lv_name   TYPE string.
    DATA lv_rest   TYPE string.
    DATA ls_ref    LIKE LINE OF rt_refs.

    WHILE lv_offset + 4 <= xstrlen( iv_data ).
      lv_hex = iv_data+lv_offset(4).
      lv_length = hex_to_int( lv_hex ).
      IF lv_length = 0.
*       a flush packet, the sections of the advertisement are separated by it
        lv_offset = lv_offset + 4.
        CONTINUE.
      ENDIF.
      IF lv_length < 4 OR lv_offset + lv_length > xstrlen( iv_data ).
        EXIT.
      ENDIF.

      lv_hex = iv_data+lv_offset(lv_length).
      lv_hex = lv_hex+4.
      lv_line = zcl_abapgit_convert=>xstring_to_string_utf8( until_null( lv_hex ) ).
      lv_offset = lv_offset + lv_length.

*     "# service=git-upload-pack" and the capability line after the first
*     ref are not refs
      IF lv_line CP '#*'.
        CONTINUE.
      ENDIF.
      REPLACE ALL OCCURRENCES OF cl_abap_char_utilities=>newline IN lv_line WITH ''.
      SPLIT lv_line AT cl_abap_char_utilities=>horizontal_tab INTO lv_sha1 lv_rest.
      IF lv_rest IS INITIAL.
        SPLIT lv_line AT ` ` INTO lv_sha1 lv_rest.
      ENDIF.
      IF strlen( lv_sha1 ) <> 40 OR lv_rest IS INITIAL.
        CONTINUE.
      ENDIF.
      SPLIT lv_rest AT cl_abap_char_utilities=>horizontal_tab INTO lv_name lv_rest.

      CLEAR ls_ref.
      ls_ref-sha1 = lv_sha1.
      ls_ref-name = lv_name.
      APPEND ls_ref TO rt_refs.
    ENDWHILE.

  ENDMETHOD.


  METHOD default_branch.

    DATA ls_ref LIKE LINE OF it_refs.

    READ TABLE it_refs INTO ls_ref WITH KEY name = 'refs/heads/main'.
    IF sy-subrc = 0.
      rv_branch = ls_ref-name.
      RETURN.
    ENDIF.
    READ TABLE it_refs INTO ls_ref WITH KEY name = 'refs/heads/master'.
    IF sy-subrc = 0.
      rv_branch = ls_ref-name.
      RETURN.
    ENDIF.
*   whatever branch came first, so a repository with neither still clones
    LOOP AT it_refs INTO ls_ref.
      IF ls_ref-name CP 'refs/heads/*'.
        rv_branch = ls_ref-name.
        RETURN.
      ENDIF.
    ENDLOOP.

  ENDMETHOD.


  METHOD want.

    rv_body = pkt( |want { iv_sha1 }{ cl_abap_char_utilities=>newline }| ).
    IF iv_depth > 0.
      rv_body = rv_body && pkt( |deepen { iv_depth }{ cl_abap_char_utilities=>newline }| ).
    ENDIF.
    rv_body = rv_body && '0000' && pkt( |done{ cl_abap_char_utilities=>newline }| ).

  ENDMETHOD.


  METHOD pkt.

    DATA lv_length TYPE i.
    DATA lv_hex    TYPE string.

    lv_length = strlen( iv_text ) + 4.
    lv_hex = int_to_hex( lv_length ).
    rv_pkt = |{ lv_hex }{ iv_text }|.

  ENDMETHOD.


  METHOD hex_to_int.

    CONSTANTS lc_digits TYPE string VALUE '0123456789abcdef'.

    DATA lv_text  TYPE string.
    DATA lv_char  TYPE c LENGTH 1.
    DATA lv_at    TYPE i.
    DATA lv_index TYPE i.

    lv_text = zcl_abapgit_convert=>xstring_to_string_utf8( iv_hex ).
    TRANSLATE lv_text TO LOWER CASE.

    DO strlen( lv_text ) TIMES.
      lv_at = sy-index - 1.
      lv_char = lv_text+lv_at(1).
      FIND FIRST OCCURRENCE OF lv_char IN lc_digits MATCH OFFSET lv_index.
      IF sy-subrc <> 0.
*       not a length: the pkt-lines are over
        rv_length = -1.
        RETURN.
      ENDIF.
      rv_length = rv_length * 16 + lv_index.
    ENDDO.

  ENDMETHOD.


  METHOD int_to_hex.

    CONSTANTS lc_digits TYPE string VALUE '0123456789abcdef'.

    DATA lv_rest TYPE i.
    DATA lv_at   TYPE i.

    lv_rest = iv_int.
    DO 4 TIMES.
      lv_at = lv_rest MOD 16.
      rv_hex = |{ lc_digits+lv_at(1) }{ rv_hex }|.
      lv_rest = lv_rest DIV 16.
    ENDDO.

  ENDMETHOD.


  METHOD until_null.

    DATA lv_at TYPE i.

    rv_data = iv_data.
    WHILE lv_at < xstrlen( iv_data ).
      IF iv_data+lv_at(1) = '00'.
        IF lv_at = 0.
          CLEAR rv_data.
        ELSE.
          rv_data = iv_data(lv_at).
        ENDIF.
        RETURN.
      ENDIF.
      lv_at = lv_at + 1.
    ENDWHILE.

  ENDMETHOD.


  METHOD pack_of.

    DATA lv_offset TYPE i.
    DATA lv_length TYPE i.
    DATA lv_line   TYPE string.
    DATA lv_hex    TYPE xstring.

    WHILE lv_offset + 4 <= xstrlen( iv_data ).
      lv_hex = iv_data+lv_offset(4).
      IF lv_hex = '5041434B'.
*       "PACK": the pkt-lines are over and the rest is the pack
        rv_pack = iv_data+lv_offset.
        RETURN.
      ENDIF.
      lv_length = hex_to_int( lv_hex ).
      IF lv_length = 0.
        lv_offset = lv_offset + 4.
        CONTINUE.
      ENDIF.
      IF lv_length < 4 OR lv_offset + lv_length > xstrlen( iv_data ).
        EXIT.
      ENDIF.
      lv_offset = lv_offset + lv_length.
    ENDWHILE.

    zcx_abapgit_exception=>raise( 'the answer carries no pack' ).

  ENDMETHOD.


  METHOD object_of.

    FIELD-SYMBOLS <ls_object> LIKE LINE OF it_objects.

    READ TABLE it_objects ASSIGNING <ls_object> WITH KEY sha1 = iv_sha1.
    IF sy-subrc <> 0.
      zcx_abapgit_exception=>raise( |object { iv_sha1 } is not in the pack| ).
    ENDIF.
    rv_data = <ls_object>-data.

  ENDMETHOD.


  METHOD walk.

    DATA lt_nodes TYPE zcl_abapgit_git_pack=>ty_nodes_tt.
    DATA ls_node  LIKE LINE OF lt_nodes.
    DATA ls_file  LIKE LINE OF rt_files.
    DATA lv_sha1  TYPE string.

    lt_nodes = zcl_abapgit_git_pack=>decode_tree( object_of( iv_sha1    = iv_tree
                                                             it_objects = it_objects ) ).

    LOOP AT lt_nodes INTO ls_node.
      lv_sha1 = ls_node-sha1.
      IF ls_node-chmod = zif_abapgit_git_definitions=>c_chmod-dir.
        APPEND LINES OF walk( iv_tree    = lv_sha1
                              iv_path    = |{ iv_path }{ ls_node-name }/|
                              it_objects = it_objects ) TO rt_files.
        CONTINUE.
      ELSEIF ls_node-chmod = zif_abapgit_git_definitions=>c_chmod-submodule.
*       a submodule is a commit of another repository, and there is nothing
*       of it in this pack
        CONTINUE.
      ENDIF.
      CLEAR ls_file.
      ls_file-path = iv_path.
      ls_file-filename = ls_node-name.
      ls_file-data = object_of( iv_sha1    = lv_sha1
                                it_objects = it_objects ).
      APPEND ls_file TO rt_files.
    ENDLOOP.

  ENDMETHOD.


  METHOD files_of.

    DATA ls_commit TYPE zcl_abapgit_git_pack=>ty_commit.

    DATA lv_tree TYPE string.

    ls_commit = zcl_abapgit_git_pack=>decode_commit( object_of( iv_sha1    = iv_commit
                                                                it_objects = it_objects ) ).
    lv_tree = ls_commit-tree.

    rt_files = walk( iv_tree    = lv_tree
                     iv_path    = '/'
                     it_objects = it_objects ).

  ENDMETHOD.


  METHOD clone.

    DATA lt_refs    TYPE ty_refs_tt.
    DATA ls_ref     LIKE LINE OF lt_refs.
    DATA lv_branch  TYPE string.
    DATA lv_data    TYPE xstring.
    DATA lt_objects TYPE zif_abapgit_definitions=>ty_objects_tt.

    lt_refs = refs( iv_url ).

    lv_branch = iv_branch.
    IF lv_branch IS INITIAL.
      lv_branch = default_branch( lt_refs ).
    ELSEIF lv_branch NP 'refs/*'.
      lv_branch = |refs/heads/{ lv_branch }|.
    ENDIF.

    READ TABLE lt_refs INTO ls_ref WITH KEY name = lv_branch.
    IF sy-subrc <> 0.
      zcx_abapgit_exception=>raise( |{ iv_url } has no { lv_branch }| ).
    ENDIF.

    lv_data = post( iv_url  = |{ iv_url }/{ c_service }|
                    iv_type = |application/x-{ c_service }-request|
                    iv_body = want( ls_ref-sha1 ) ).

    lt_objects = zcl_abapgit_git_pack=>decode( pack_of( lv_data ) ).

    rs_clone-url = iv_url.
    rs_clone-branch = lv_branch.
    rs_clone-commit = ls_ref-sha1.
    rs_clone-files = files_of( iv_commit  = ls_ref-sha1
                               it_objects = lt_objects ).

  ENDMETHOD.


  METHOD get.

    DATA li_client TYPE REF TO if_http_client.

    cl_http_client=>create_by_url(
      EXPORTING
        url    = iv_url
      IMPORTING
        client = li_client ).

    li_client->request->set_method( 'GET' ).
    IF iv_accept IS NOT INITIAL.
      li_client->request->set_header_field(
        name  = 'accept'
        value = iv_accept ).
    ENDIF.

    rv_data = exchange( ii_client = li_client
                        iv_url    = iv_url ).

  ENDMETHOD.


  METHOD post.

    DATA li_client TYPE REF TO if_http_client.

    cl_http_client=>create_by_url(
      EXPORTING
        url    = iv_url
      IMPORTING
        client = li_client ).

    li_client->request->set_method( 'POST' ).
    li_client->request->set_content_type( iv_type ).
    li_client->request->set_cdata( iv_body ).

    rv_data = exchange( ii_client = li_client
                        iv_url    = iv_url ).

  ENDMETHOD.


  METHOD exchange.

    DATA lv_message TYPE string.
    DATA lv_code    TYPE i.

    ii_client->send(
      EXCEPTIONS
        http_communication_failure = 1
        http_invalid_state         = 2
        http_processing_failed     = 3
        http_invalid_timeout       = 4
        OTHERS                     = 5 ).
    IF sy-subrc = 0.
      ii_client->receive(
        EXCEPTIONS
          http_communication_failure = 1
          http_invalid_state         = 2
          http_processing_failed     = 3
          OTHERS                     = 4 ).
    ENDIF.
    IF sy-subrc <> 0.
      ii_client->get_last_error( IMPORTING message = lv_message ).
      ii_client->close( ).
      zcx_abapgit_exception=>raise( |{ iv_url } could not be reached: { lv_message }| ).
    ENDIF.

    " get_status rather than the ~status_code field, which the local runtime
    " does not fill (ANOMALY-2026-09-24-httpc-status-code-field)
    ii_client->response->get_status( IMPORTING code = lv_code ).
    IF lv_code >= 400.
      ii_client->close( ).
      zcx_abapgit_exception=>raise( |{ iv_url } answered { lv_code }| ).
    ENDIF.

    rv_data = ii_client->response->get_data( ).
    ii_client->close( ).

  ENDMETHOD.

ENDCLASS.
