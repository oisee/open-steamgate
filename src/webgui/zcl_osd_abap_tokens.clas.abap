CLASS zcl_osd_abap_tokens DEFINITION PUBLIC FINAL CREATE PUBLIC.
* The tokens of an ABAP source, for a screen that colours it (ZCL_OSD_EDIT).
*
* **A word list, not the grammar.** The colouring used to be a call to the
* host (STORE TOKENS), which swapped the text into the abaplint registry,
* parsed the system and called a leaf a keyword when the grammar had matched
* it as one. That was exact, it cost a cold parse of seven seconds on the
* first display, it existed only where the host had a parser, and it could
* not travel to a system. This scanner is plain ABAP: the same rows on every
* host and on a system, at the price of being approximate. A word is a
* keyword when it is in the list below, whatever the statement, so `VALUE`
* is coloured as a keyword in a method called `value` too (host-tools review
* 2026-09-25, S1; accepted by Alice).
*
* **No regular expressions**, on purpose: abapGit's own highlighter runs on
* FIND ALL OCCURRENCES OF REGEX ... RESULTS, which the Go backend refuses,
* so it would colour on Node and not compile on OSGo. This reads characters:
* `*` in column 1 and `"` to the end of the line are comments, '...' and
* `...` are strings (a doubled delimiter is the delimiter), |...| is a
* string template whose { } parts are code again, ##name is a pragma,
* . , : ( ) [ ] are punctuation, and everything else that is a word is a
* keyword or a name. Operators and blanks are not tokens; the screen writes
* whatever lies between two tokens as it is, so the text always comes out
* whole.
*
* The keyword list is abapGit's (ZCL_ABAPGIT_SYNTAX_ABAP=>INIT_KEYWORDS,
* https://github.com/abapGit/abapGit, src/syntax/), taken unchanged:
*
*   The MIT License (MIT)
*   Copyright (c) 2014 abapGit Contributors
*   Permission is hereby granted, free of charge, to any person obtaining a
*   copy of this software and associated documentation files (the
*   "Software"), to deal in the Software without restriction, including
*   without limitation the rights to use, copy, modify, merge, publish,
*   distribute, sublicense, and/or sell copies of the Software, and to
*   permit persons to whom the Software is furnished to do so, subject to
*   the following conditions: The above copyright notice and this
*   permission notice shall be included in all copies or substantial
*   portions of the Software.
*   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
*   OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
*   MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
*   IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
*   CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
*   TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
*   SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
  PUBLIC SECTION.
    TYPES tt_token TYPE STANDARD TABLE OF zosd_token_s WITH DEFAULT KEY.

*   one row per token: LINE and COL from 1, LEN in characters, KIND one of
*   keyword name comment string pragma punct -- the rows STORE TOKENS gave.
*   Lines are split at the newline, the way the screen splits them.
    CLASS-METHODS scan
      IMPORTING
        iv_source       TYPE string
      RETURNING
        VALUE(rt_token) TYPE tt_token.

    CLASS-METHODS is_keyword
      IMPORTING
        iv_word       TYPE string
      RETURNING
        VALUE(rv_yes) TYPE abap_bool.

  PROTECTED SECTION.
  PRIVATE SECTION.
*   what may start a word, and what may continue one; `-` continues a word
*   (CLASS-METHODS, ls_row-field) but not before `>`, which ends it (lo->m)
    CONSTANTS c_start TYPE string VALUE 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_!%$'.
    CONSTANTS c_word  TYPE string VALUE 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_%$/~-'.
    CONSTANTS c_alpha TYPE string VALUE 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_'.
    CONSTANTS c_punct TYPE string VALUE '.,:()[]'.

    CLASS-DATA gt_keyword TYPE SORTED TABLE OF string WITH UNIQUE KEY table_line.

    CLASS-METHODS init_keywords.

    CLASS-METHODS add
      IMPORTING
        iv_line  TYPE i
        iv_off   TYPE i
        iv_len   TYPE i
        iv_kind  TYPE string
      CHANGING
        ct_token TYPE tt_token.

*   the position after a quoted literal that starts at iv_off: the
*   delimiter doubled is the delimiter itself; unterminated runs to the end
    CLASS-METHODS literal_end
      IMPORTING
        iv_line       TYPE string
        iv_off        TYPE i
        iv_quote      TYPE string
      RETURNING
        VALUE(rv_end) TYPE i.

    CLASS-METHODS is_in
      IMPORTING
        iv_char       TYPE string
        iv_set        TYPE string
      RETURNING
        VALUE(rv_yes) TYPE abap_bool.
ENDCLASS.

CLASS zcl_osd_abap_tokens IMPLEMENTATION.

  METHOD scan.
    DATA lt_lines TYPE string_table.
    DATA lv_line  TYPE string.
    DATA lv_no    TYPE i.
    DATA lv_len   TYPE i.
    DATA lv_pos   TYPE i.
    DATA lv_from  TYPE i.
    DATA lv_end   TYPE i.
    DATA lv_c     TYPE string.
    DATA lv_next  TYPE string.
    DATA lv_kind  TYPE string.
    DATA lv_open  TYPE abap_bool.
*   Even: code. Odd: inside the text of a string template. `|` in code and
*   `{` in a template go one deeper, `}` in code and `|` in a template one
*   back, so a template inside an embedded expression needs nothing more.
    DATA lv_depth TYPE i.

    SPLIT iv_source AT cl_abap_char_utilities=>newline INTO TABLE lt_lines.

    LOOP AT lt_lines INTO lv_line.
      lv_no = sy-tabix.
      lv_len = strlen( lv_line ).
      lv_pos = 0.

      IF lv_len > 0 AND lv_depth = 0.
        IF lv_line+0(1) = '*'.
          add( EXPORTING iv_line = lv_no iv_off = 0 iv_len = lv_len iv_kind = `comment`
               CHANGING ct_token = rt_token ).
          CONTINUE.
        ENDIF.
      ENDIF.

      WHILE lv_pos < lv_len.
        lv_c = lv_line+lv_pos(1).
        CLEAR lv_next.
        IF lv_pos + 1 < lv_len.
          lv_next = substring( val = lv_line off = lv_pos + 1 len = 1 ).
        ENDIF.

        IF lv_depth MOD 2 = 1.
*         the text of a template, up to `{`, the closing `|` or the end of
*         the line; a template that was just opened starts at its bar
          lv_from = lv_pos.
          IF lv_open = abap_true.
            lv_from = lv_pos - 1.
            lv_open = abap_false.
          ENDIF.
          lv_end = lv_pos.
          WHILE lv_end < lv_len.
            lv_c = lv_line+lv_end(1).
            IF lv_c = '\'.
              lv_end = lv_end + 2.
              CONTINUE.
            ENDIF.
            IF lv_c = '{' OR lv_c = '|'.
              EXIT.
            ENDIF.
            lv_end = lv_end + 1.
          ENDWHILE.
          IF lv_end > lv_len.
            lv_end = lv_len.
          ENDIF.
          IF lv_end = lv_len.
*           a template's text does not continue on the next line
            add( EXPORTING iv_line = lv_no iv_off = lv_from iv_len = lv_end - lv_from iv_kind = `string`
                 CHANGING ct_token = rt_token ).
            lv_depth = lv_depth - 1.
          ELSEIF lv_line+lv_end(1) = '|'.
            lv_end = lv_end + 1.
            add( EXPORTING iv_line = lv_no iv_off = lv_from iv_len = lv_end - lv_from iv_kind = `string`
                 CHANGING ct_token = rt_token ).
            lv_depth = lv_depth - 1.
          ELSE.
            add( EXPORTING iv_line = lv_no iv_off = lv_from iv_len = lv_end - lv_from iv_kind = `string`
                 CHANGING ct_token = rt_token ).
            add( EXPORTING iv_line = lv_no iv_off = lv_end iv_len = 1 iv_kind = `punct`
                 CHANGING ct_token = rt_token ).
            lv_end = lv_end + 1.
            lv_depth = lv_depth + 1.
          ENDIF.
          lv_pos = lv_end.
        ELSEIF lv_c = '"'.
          add( EXPORTING iv_line = lv_no iv_off = lv_pos iv_len = lv_len - lv_pos iv_kind = `comment`
               CHANGING ct_token = rt_token ).
          lv_pos = lv_len.
        ELSEIF lv_c = `'` OR lv_c = '`'.
          lv_end = literal_end( iv_line = lv_line iv_off = lv_pos iv_quote = lv_c ).
          add( EXPORTING iv_line = lv_no iv_off = lv_pos iv_len = lv_end - lv_pos iv_kind = `string`
               CHANGING ct_token = rt_token ).
          lv_pos = lv_end.
        ELSEIF lv_c = '|'.
*         into a template; its text, bar included, is the next round's
          lv_depth = lv_depth + 1.
          lv_open = abap_true.
          lv_pos = lv_pos + 1.
          IF lv_pos = lv_len.
            add( EXPORTING iv_line = lv_no iv_off = lv_pos - 1 iv_len = 1 iv_kind = `string`
                 CHANGING ct_token = rt_token ).
            lv_open = abap_false.
          ENDIF.
        ELSEIF lv_c = '}' AND lv_depth > 0.
*         the end of an embedded expression: back into the template's text
          add( EXPORTING iv_line = lv_no iv_off = lv_pos iv_len = 1 iv_kind = `punct`
               CHANGING ct_token = rt_token ).
          lv_depth = lv_depth - 1.
          lv_pos = lv_pos + 1.
        ELSEIF lv_c = '#' AND lv_next = '#'.
          lv_end = lv_pos + 2.
          WHILE lv_end < lv_len.
            lv_c = lv_line+lv_end(1).
            IF is_in( iv_char = lv_c iv_set = c_word ) = abap_false.
              EXIT.
            ENDIF.
            lv_end = lv_end + 1.
          ENDWHILE.
          add( EXPORTING iv_line = lv_no iv_off = lv_pos iv_len = lv_end - lv_pos iv_kind = `pragma`
               CHANGING ct_token = rt_token ).
          lv_pos = lv_end.
        ELSEIF is_in( iv_char = lv_c iv_set = c_punct ) = abap_true.
          add( EXPORTING iv_line = lv_no iv_off = lv_pos iv_len = 1 iv_kind = `punct`
               CHANGING ct_token = rt_token ).
          lv_pos = lv_pos + 1.
        ELSEIF lv_c = '<' AND is_in( iv_char = lv_next iv_set = c_alpha ) = abap_true.
*         a field symbol, <name>, is a name with its brackets
          lv_end = lv_pos + 1.
          WHILE lv_end < lv_len.
            lv_c = lv_line+lv_end(1).
            IF is_in( iv_char = lv_c iv_set = c_word ) = abap_false.
              EXIT.
            ENDIF.
            lv_end = lv_end + 1.
          ENDWHILE.
          IF lv_end < lv_len.
            IF lv_line+lv_end(1) = '>'.
              lv_end = lv_end + 1.
            ENDIF.
          ENDIF.
          add( EXPORTING iv_line = lv_no iv_off = lv_pos iv_len = lv_end - lv_pos iv_kind = `name`
               CHANGING ct_token = rt_token ).
          lv_pos = lv_end.
        ELSEIF is_in( iv_char = lv_c iv_set = c_start ) = abap_true
            OR ( lv_c = '/' AND is_in( iv_char = lv_next iv_set = c_alpha ) = abap_true ).
          lv_end = lv_pos + 1.
          WHILE lv_end < lv_len.
            lv_c = lv_line+lv_end(1).
            IF is_in( iv_char = lv_c iv_set = c_word ) = abap_false.
              EXIT.
            ENDIF.
*           `-` then `>` is the reference operator, not part of the word
            IF lv_c = '-' AND lv_end + 1 < lv_len.
              lv_next = substring( val = lv_line off = lv_end + 1 len = 1 ).
              IF lv_next = '>'.
                EXIT.
              ENDIF.
            ENDIF.
            lv_end = lv_end + 1.
          ENDWHILE.
          IF is_keyword( substring( val = lv_line off = lv_pos len = lv_end - lv_pos ) ) = abap_true.
            lv_kind = `keyword`.
          ELSE.
            lv_kind = `name`.
          ENDIF.
          add( EXPORTING iv_line = lv_no iv_off = lv_pos iv_len = lv_end - lv_pos iv_kind = lv_kind
               CHANGING ct_token = rt_token ).
          lv_pos = lv_end.
        ELSE.
*         a blank, an operator, or a character that starts nothing: not a
*         token, and written as it is
          lv_pos = lv_pos + 1.
        ENDIF.
      ENDWHILE.

*     a template's text ends with its line; an embedded expression may not
      IF lv_depth MOD 2 = 1.
        lv_depth = lv_depth - 1.
      ENDIF.
      lv_open = abap_false.
    ENDLOOP.
  ENDMETHOD.

  METHOD literal_end.
    DATA lv_len TYPE i.
    DATA lv_c   TYPE string.

    lv_len = strlen( iv_line ).
    rv_end = iv_off + 1.
    WHILE rv_end < lv_len.
      lv_c = iv_line+rv_end(1).
      rv_end = rv_end + 1.
      IF lv_c = iv_quote.
        IF rv_end < lv_len.
          lv_c = iv_line+rv_end(1).
          IF lv_c = iv_quote.
            rv_end = rv_end + 1.
            CONTINUE.
          ENDIF.
        ENDIF.
        RETURN.
      ENDIF.
    ENDWHILE.
  ENDMETHOD.

  METHOD add.
    DATA ls_token TYPE zosd_token_s.

    IF iv_len <= 0.
      RETURN.
    ENDIF.
    ls_token-line = iv_line.
    ls_token-col = iv_off + 1.
    ls_token-len = iv_len.
    ls_token-kind = iv_kind.
    APPEND ls_token TO ct_token.
  ENDMETHOD.

  METHOD is_in.
    IF iv_char IS INITIAL.
      RETURN.
    ENDIF.
    IF find( val = iv_set sub = iv_char ) >= 0.
      rv_yes = abap_true.
    ENDIF.
  ENDMETHOD.

  METHOD is_keyword.
    DATA lv_word TYPE string.

    IF gt_keyword IS INITIAL.
      init_keywords( ).
    ENDIF.
    lv_word = iv_word.
    TRANSLATE lv_word TO UPPER CASE.
    READ TABLE gt_keyword WITH TABLE KEY table_line = lv_word TRANSPORTING NO FIELDS.
    IF sy-subrc = 0.
      rv_yes = abap_true.
    ENDIF.
  ENDMETHOD.

  METHOD init_keywords.
*   abapGit's list, unchanged (see the licence at the top of this class)
    DATA lv_keywords TYPE string.
    DATA lt_keywords TYPE STANDARD TABLE OF string WITH DEFAULT KEY.
    DATA lv_keyword  TYPE string.

    lv_keywords =
      '&&|?TO|ABAP-SOURCE|ABBREVIATED|ABS|ABSTRACT|ACCEPT|ACCEPTING' &&
      '|ACCORDING|ACOS|ACTIVATION|ACTUAL|ADD|ADD-CORRESPONDING|ADJACENT|AFTER|ALIAS' &&
      '|ALIASES|ALIGN|ALL|ALLOCATE|ALPHA|ANALYSIS|ANALYZER|AND|ANY|APPEND|APPENDAGE' &&
      '|APPENDING|APPLICATION|ARCHIVE|AREA|ARITHMETIC|AS|ASCENDING|ASIN|ASPECT|ASSERT' &&
      '|ASSIGN|ASSIGNED|ASSIGNING|ASSOCIATION|ASYNCHRONOUS|AT|ATAN|ATTRIBUTES|AUTHORITY' &&
      '|AUTHORITY-CHECK|AVG|BACK|BACKGROUND|BACKUP|BACKWARD|BADI|BASE|BEFORE|BEGIN' &&
      '|BETWEEN|BIG|BINARY|BIT|BIT-AND|BIT-NOT|BIT-OR|BIT-XOR|BLACK|BLANK' &&
      '|BLANKS|BLOB|BLOCK|BLOCKS|BLUE|BOUND|BOUNDARIES|BOUNDS|BOXED|BREAK-POINT|BT' &&
      '|BUFFER|BY|BYPASSING|BYTE|BYTE-CA|BYTE-CN|BYTE-CO|BYTE-CS|BYTE-NA|BYTE-NS' &&
      '|BYTE-ORDER|C|CA|CALL|CALLING|CASE|CAST|CASTING|CATCH|CEIL|CENTER|CENTERED' &&
      '|CHAIN|CHAIN-INPUT|CHAIN-REQUEST|CHANGE|CHANGING|CHANNELS|CHARACTER|CHARLEN' &&
      '|CHAR-TO-HEX|CHECK|CHECKBOX|CI_|CIRCULAR|CLASS|CLASS-CODING|CLASS-DATA' &&
      '|CLASS-EVENTS|CLASS-METHODS|CLASS-POOL|CLEANUP|CLEAR|CLIENT|CLOB|CLOCK|CLOSE' &&
      '|CN|CO|COALESCE|CODE|CODING|COL_BACKGROUND|COL_GROUP|COL_HEADING|COL_KEY' &&
      '|COL_NEGATIVE|COL_NORMAL|COL_POSITIVE|COL_TOTAL|COLLECT|COLOR|COLUMN|COLUMNS' &&
      '|COMMENT|COMMENTS|COMMIT|COMMON|COMMUNICATION|COMPARING|COMPONENT|COMPONENTS' &&
      '|COMPRESSION|COMPUTE|CONCAT|CONCATENATE|COND|CONDENSE|CONDITION|CONNECT' &&
      '|CONNECTION|CONSTANTS|CONTEXT|CONTEXTS|CONTINUE|CONTROL|CONTROLS|CONV|CONVERSION' &&
      '|CONVERT|COPIES|COPY|CORRESPONDING|COS|COSH|COUNT|COUNTRY|COVER|CP|CPI|CREATE' &&
      '|CREATING|CRITICAL|CS|CURRENCY|CURRENCY_CONVERSION|CURRENT|CURSOR|CURSOR-SELECTION' &&
      '|CUSTOMER|CUSTOMER-FUNCTION|DANGEROUS|DATA|DATABASE|DATAINFO|DATASET|DATE' &&
      '|DAYLIGHT|DBMAXLEN|DD/MM/YY|DD/MM/YYYY|DDMMYY|DEALLOCATE|DECIMAL_SHIFT|DECIMALS' &&
      '|DECLARATIONS|DEEP|DEFAULT|DEFERRED|DEFINE|DEFINING|DEFINITION|DELETE|DELETING' &&
      '|DEMAND|DEPARTMENT|DESCENDING|DESCRIBE|DESTINATION|DETAIL|DIALOG|DIRECTORY' &&
      '|DISCONNECT|DISPLAY|DISPLAY-MODE|DISTANCE|DISTINCT|DIV|DIVIDE|DIVIDE-CORRESPONDING' &&
      '|DIVISION|DO|DUMMY|DUPLICATE|DUPLICATES|DURATION|DURING|DYNAMIC|DYNPRO' &&
      '|EDIT|EDITOR-CALL|ELSE|ELSEIF|EMPTY|ENABLED|ENABLING|ENCODING|END|ENDAT|ENDCASE' &&
      '|ENDCATCH|ENDCHAIN|ENDCLASS|ENDDO|ENDENHANCEMENT|END-ENHANCEMENT-SECTION' &&
      '|ENDEXEC|ENDFORM|ENDFUNCTION|ENDIAN|ENDIF|ENDING|ENDINTERFACE' &&
      '|END-LINES|ENDLOOP|ENDMETHOD|ENDMODULE|END-OF-DEFINITION|END-OF-FILE' &&
      '|END-OF-PAGE|END-OF-SELECTION|ENDON|ENDPROVIDE|ENDSELECT|ENDTRY|ENDWHILE' &&
      '|ENGINEERING|ENHANCEMENT|ENHANCEMENT-POINT|ENHANCEMENTS|ENHANCEMENT-SECTION' &&
      '|ENTRIES|ENTRY|ENVIRONMENT|EQ|EQUIV|ERRORMESSAGE|ERRORS|ESCAPE|ESCAPING' &&
      '|EVENT|EVENTS|EXACT|EXCEPT|EXCEPTION|EXCEPTIONS|EXCEPTION-TABLE|EXCLUDE|EXCLUDING' &&
      '|EXEC|EXECUTE|EXISTS|EXIT|EXIT-COMMAND|EXP|EXPAND|EXPANDING|EXPIRATION|EXPLICIT' &&
      '|EXPONENT|EXPORT|EXPORTING|EXTEND|EXTENDED|EXTENSION|EXTRACT|FAIL|FETCH|FIELD' &&
      '|FIELD-GROUPS|FIELDS|FIELD-SYMBOL|FIELD-SYMBOLS|FILE|FILTER|FILTERS|FILTER-TABLE' &&
      '|FINAL|FIND|FIRST|FIRST-LINE|FIXED-POINT|FKEQ|FKGE|FLOOR|FLUSH|FONT|FOR|FORM' &&
      '|FORMAT|FORWARD|FOUND|FRAC|FRAME|FRAMES|FREE|FRIENDS|FROM|FUNCTION|FUNCTIONALITY' &&
      '|FUNCTION-POOL|FURTHER|GAPS|GE|GENERATE|GET|GIVING|GKEQ|GKGE|GLOBAL|GRANT' &&
      '|GREEN|GROUP|GROUPS|GT|HANDLE|HANDLER|HARMLESS|HASHED|HAVING|HDB|HEADER|HEADERS' &&
      '|HEADING|HEAD-LINES|HELP-ID|HELP-REQUEST|HIDE|HIGH|HINT|HOLD|HOTSPOT|I|ICON|ID' &&
      '|IDENTIFICATION|IDENTIFIER|IDS|IF|IGNORE|IGNORING|IMMEDIATELY|IMPLEMENTATION' &&
      '|IMPLEMENTATIONS|IMPLEMENTED|IMPLICIT|IMPORT|IMPORTING|IN|INACTIVE|INCL|INCLUDE' &&
      '|INCLUDES|INCLUDING|INCREMENT|INDEX|INDEX-LINE|INFOTYPES|INHERITING|INIT|INITIAL' &&
      '|INITIALIZATION|INNER|INOUT|INPUT|INSERT|INSTANCES|INTENSIFIED|INTERFACE' &&
      '|INTERFACE-POOL|INTERFACES|INTERNAL|INTERVALS|INTO|INVERSE|INVERTED-DATE|IS' &&
      '|ISO|JOB|JOIN|KEEP|KEEPING|KERNEL|KEY|KEYS|KEYWORDS|KIND' &&
      '|LANGUAGE|LAST|LATE|LAYOUT|LE|LEADING|LEAVE|LEFT|LEFT-JUSTIFIED|LEFTPLUS' &&
      '|LEFTSPACE|LEGACY|LENGTH|LET|LEVEL|LEVELS|LIKE|LINE|LINE-COUNT|LINEFEED' &&
      '|LINES|LINE-SELECTION|LINE-SIZE|LIST|LISTBOX|LIST-PROCESSING|LITTLE|LLANG' &&
      '|LOAD|LOAD-OF-PROGRAM|LOB|LOCAL|LOCALE|LOCATOR|LOG|LOG10|LOGFILE|LOGICAL' &&
      '|LOG-POINT|LONG|LOOP|LOW|LOWER|LPAD|LPI|LT|M|MAIL|MAIN|MAJOR-ID|MAPPING|MARGIN' &&
      '|MARK|MASK|MATCH|MATCHCODE|MAX|MAXIMUM|MEDIUM|MEMBERS|MEMORY|MESH|MESSAGE' &&
      '|MESSAGE-ID|MESSAGES|MESSAGING|METHOD|METHODS|MIN|MINIMUM|MINOR-ID|MM/DD/YY' &&
      '|MM/DD/YYYY|MMDDYY|MOD|MODE|MODIF|MODIFIER|MODIFY|MODULE|MOVE|MOVE-CORRESPONDING' &&
      '|MULTIPLY|MULTIPLY-CORRESPONDING|NA|NAME|NAMETAB|NATIVE|NB|NE|NESTED|NESTING' &&
      '|NEW|NEW-LINE|NEW-PAGE|NEW-SECTION|NEXT|NO|NODE|NODES|NO-DISPLAY' &&
      '|NO-EXTENSION|NO-GAP|NO-GAPS|NO-GROUPING|NO-HEADING|NON-UNICODE|NON-UNIQUE' &&
      '|NO-SCROLLING|NO-SIGN|NOT|NO-TITLE|NO-TOPOFPAGE|NO-ZERO|NP|NS|NULL|NUMBER' &&
      '|NUMOFCHAR|O|OBJECT|OBJECTS|OBLIGATORY|OCCURRENCE|OCCURRENCES|OCCURS|OF|OFF' &&
      '|OFFSET|OLE|ON|ONLY|OPEN|OPTION|OPTIONAL|OPTIONS|OR|ORDER|OTHER|OTHERS|OUT' &&
      '|OUTER|OUTPUT|OUTPUT-LENGTH|OVERFLOW|OVERLAY|PACK|PACKAGE|PAD|PADDING|PAGE' &&
      '|PAGES|PARAMETER|PARAMETERS|PARAMETER-TABLE|PART|PARTIALLY|PATTERN|PERCENTAGE' &&
      '|PERFORM|PERFORMING|PERSON|PF1|PF2|PF3|PF4|PF5|PF6|PF7|PF8|PF9|PF10|PF11|PF12' &&
      '|PF13|PF14|PF15|PF-STATUS|PINK|PLACES|POOL|POS_HIGH|POS_LOW' &&
      '|POSITION|PRAGMAS|PRECOMPILED|PREFERRED|PRESERVING|PRIMARY|PRINT|PRINT-CONTROL' &&
      '|PRIORITY|PRIVATE|PROCEDURE|PROCESS|PROGRAM|PROPERTY|PROTECTED|PROVIDE|PUBLIC' &&
      '|PUSHBUTTON|PUT|QUEUE-ONLY|QUICKINFO|RADIOBUTTON|RAISE|RAISING|RANGE|RANGES' &&
      '|RAW|READ|READER|READ-ONLY|RECEIVE|RECEIVED|RECEIVER|RECEIVING|RED|REDEFINITION' &&
      '|REDUCE|REDUCED|REF|REFERENCE|REFRESH|REGEX|REJECT|REMOTE|RENAMING|REPLACE' &&
      '|REPLACEMENT|REPLACING|REPORT|REQUEST|REQUESTED|RESERVE|RESET|RESOLUTION' &&
      '|RESPECTING|RESPONSIBLE|RESULT|RESULTS|RESUMABLE|RESUME|RETRY|RETURN|RETURNCODE' &&
      '|RETURNING|RIGHT|RIGHT-JUSTIFIED|RIGHTPLUS|RIGHTSPACE|RISK|RMC_COMMUNICATION_FAILURE' &&
      '|RMC_INVALID_STATUS|RMC_SYSTEM_FAILURE|ROLE|ROLLBACK|ROUND|ROWS|RUN|SAP' &&
      '|SAP-SPOOL|SAVING|SCALE_PRESERVING|SCALE_PRESERVING_SCIENTIFIC|SCAN|SCIENTIFIC' &&
      '|SCIENTIFIC_WITH_LEADING_ZERO|SCREEN|SCROLL|SCROLL-BOUNDARY|SCROLLING|SEARCH' &&
      '|SECONDARY|SECONDS|SECTION|SELECT|SELECTION|SELECTIONS|SELECTION-SCREEN|SELECTION-SET' &&
      '|SELECTION-SETS|SELECTION-TABLE|SELECT-OPTIONS|SEND|SEPARATE|SEPARATED|SET' &&
      '|SHARED|SHIFT|SHORT|SHORTDUMP-ID|SIGN|SIGN_AS_POSTFIX|SIMPLE|SIN|SINGLE|SINH|SIZE' &&
      '|SKIP|SKIPPING|SMART|SOME|SORT|SORTABLE|SORTED|SOURCE|SPACE|SPECIFIED|SPLIT|SPOOL' &&
      '|SPOTS|SQL|SQLSCRIPT|SQRT|STABLE|STAMP|STANDARD|STARTING|START-OF-SELECTION|STATE' &&
      '|STATEMENT|STATEMENTS|STATIC|STATICS|STATUSINFO|STEP-LOOP|STOP|STRLEN|STRUCTURE' &&
      '|STRUCTURES|STYLE|SUBKEY|SUBMATCHES|SUBMIT|SUBROUTINE|SUBSCREEN|SUBSTRING|SUBTRACT' &&
      '|SUBTRACT-CORRESPONDING|SUFFIX|SUM|SUMMARY|SUMMING|SUPPLIED|SUPPLY|SUPPRESS|SWITCH' &&
      '|SWITCHSTATES|SYMBOL|SYNCPOINTS|SYNTAX|SYNTAX-CHECK|SYNTAX-TRACE' &&
      '|SYSTEM-CALL|SYSTEM-EXCEPTIONS|SYSTEM-EXIT|TAB|TABBED|TABLE|TABLES|TABLEVIEW|TABSTRIP' &&
      '|TAN|TANH|TARGET|TASK|TASKS|TEST|TESTING|TEXT|TEXTPOOL|THEN|THROW|TIME|TIMES|TIMESTAMP' &&
      '|TIMEZONE|TITLE|TITLEBAR|TITLE-LINES|TO|TOKENIZATION|TOKENS|TOP-LINES|TOP-OF-PAGE' &&
      '|TRACE-FILE|TRACE-TABLE|TRAILING|TRANSACTION|TRANSFER|TRANSFORMATION|TRANSLATE' &&
      '|TRANSPORTING|TRMAC|TRUNC|TRUNCATE|TRUNCATION|TRY|TYPE|TYPE-POOL|TYPE-POOLS|TYPES' &&
      '|ULINE|UNASSIGN|UNDER|UNICODE|UNION|UNIQUE|UNIT|UNIT_CONVERSION|UNIX|UNPACK|UNTIL' &&
      '|UNWIND|UP|UPDATE|UPPER|USER|USER-COMMAND|USING|UTF-8|VALID|VALUE|VALUE-REQUEST|VALUES' &&
      '|VARY|VARYING|VERIFICATION-MESSAGE|VERSION|VIA|VIEW|VISIBLE|WAIT|WARNING|WHEN|WHENEVER' &&
      '|WHERE|WHILE|WIDTH|WINDOW|WINDOWS|WITH|WITH-HEADING|WITHOUT|WITH-TITLE|WORD|WORK' &&
      '|WRITE|WRITER|X|XML|XSD|XSTRLEN|YELLOW|YES|YYMMDD|Z|ZERO|ZONE' &&
      '|BINTOHEX|CHAR|CLNT|CONCAT_WITH_SPACE|CURR|DATS|DATS_ADD_DAYS|DATS_ADD_MONTHS' &&
      '|DATS_DAYS_BETWEEN|DATS_IS_VALID|DEC|END-OF-EDITING|END-TEST-INJECTION|END-TEST-SEAM' &&
      '|ENDWITH|ENUM|HEXTOBIN|INSTANCE|INSTR|LANG|LTRIM|NUMC|PUSH' &&
      '|QUAN|RETURNS|RPAD|RTRIM|SSTRING|START-OF-EDITING|TEST-INJECTION|TEST-SEAM|TIMS' &&
      '|TIMS_IS_VALID|TSTMP_ADD_SECONDS|TSTMP_CURRENT_UTCTIMESTAMP|TSTMP_IS_VALID' &&
      '|TSTMP_SECONDS_BETWEEN|B|D|DECFLOAT16|DECFLOAT34|F|INT8|N|P|S|STRING|T|UTCLONG|XSTRING' &&
      '|ABAP_BOOL|ACCP|CUKY|DF16_DEC|DF16_RAW|DF34_DEC|DF34_RAW|FLTP' &&
      '|INT1|INT2|INT4|LCHR|LRAW|RAWSTRING|DF16_SCL|DF34_SCL' &&
      '|PREC|VARC|CLIKE|CSEQUENCE|DECFLOAT|NUMERIC|XSEQUENCE|ME|SYST|SY' &&
      '|BIT-SET|BOOLC|BOOLX|CHAR_OFF|CMAX|CMIN|CONCAT_LINES_OF|CONTAINS|CONTAINS_ANY_NOT_OF' &&
      '|CONTAINS_ANY_OF|COUNT_ANY_NOT_OF|COUNT_ANY_OF|FIND_ANY_NOT_OF|FIND_ANY_OF|FIND_END' &&
      '|FROM_MIXED|IPOW|LINE_EXISTS|LINE_INDEX|MATCHES|NMAX|NMIN|REPEAT|RESCALE|REVERSE' &&
      '|SEGMENT|SHIFT_LEFT|SHIFT_RIGHT|SUBSTRING_AFTER|SUBSTRING_BEFORE|SUBSTRING_FROM|SUBSTRING_TO' &&
      '|TO_LOWER|TO_MIXED|TO_UPPER|UTCLONG_ADD|UTCLONG_CURRENT|UTCLONG_DIFF|XSDBOOL'.

    SPLIT lv_keywords AT '|' INTO TABLE lt_keywords.
*   one by one into the sorted table: a word the list has twice is refused
*   by the unique key rather than dumping, and the Go backend compiles an
*   INSERT where it would not compile SORT + DELETE ADJACENT + a move
    LOOP AT lt_keywords INTO lv_keyword.
      INSERT lv_keyword INTO TABLE gt_keyword.
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.
