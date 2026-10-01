REPORT zosd_sub_sem.

DATA gv_text TYPE c LENGTH 8.
PARAMETERS p_empty TYPE c LENGTH 4.
PARAMETERS p_char TYPE c LENGTH 3 DEFAULT 'mixed'.
PARAMETERS p_lower TYPE c LENGTH 5 LOWER CASE DEFAULT 'AbCdEf'.
PARAMETERS p_num TYPE i DEFAULT 4.
PARAMETERS p_str TYPE string DEFAULT 'mixed'.
PARAMETERS p_date TYPE d DEFAULT sy-datum.
PARAMETERS r_one RADIOBUTTON GROUP rad.
PARAMETERS r_two RADIOBUTTON GROUP rad.
PARAMETERS r_three RADIOBUTTON GROUP oth.
PARAMETERS r_four RADIOBUTTON GROUP oth DEFAULT 'X'.
SELECT-OPTIONS s_text FOR gv_text DEFAULT 'a' TO 'z' OPTION nb SIGN e.
SELECT-OPTIONS s_lower FOR gv_text LOWER CASE DEFAULT 'lower'.

START-OF-SELECTION.
  WRITE: / 'EMPTY', p_empty.
  WRITE: / 'CHAR', p_char.
  WRITE: / 'LOWER', p_lower.
  WRITE: / 'NUM', p_num.
  WRITE: / 'DATE', p_date.
  WRITE: / 'RADIO', r_one, r_two.
  WRITE: / 'RADIO2', r_three, r_four.
  WRITE: / 'HEADER', s_text-low.
  LOOP AT s_text.
    WRITE: / 'TEXT', s_text-sign, s_text-option, s_text-low, s_text-high.
  ENDLOOP.
  LOOP AT s_lower.
    WRITE: / 'LCASE', s_lower-sign, s_lower-option, s_lower-low.
  ENDLOOP.
  WRITE: / 'STR', p_str.
