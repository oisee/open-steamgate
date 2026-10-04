REPORT zdatabase.
DATA row TYPE zbuffer.
DATA selected TYPE zbuffer.
DATA zeros TYPE x LENGTH 65536.
row-id = 1.
row-payload = zeros.
REPLACE SECTION OFFSET 0 LENGTH 1 OF row-payload WITH 'AB' IN BYTE MODE.
INSERT zbuffer FROM row.
WRITE sy-subrc.
SELECT SINGLE * FROM zbuffer INTO selected WHERE id = 1.
WRITE sy-subrc.
WRITE selected-payload(2).
WRITE xstrlen( selected-payload ).
