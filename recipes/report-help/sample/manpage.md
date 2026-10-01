# NAME

zreportdemo - ABAP report

# SYNOPSIS

`zreportdemo [report options] [--] [positionals]`

# OPTIONS

--name, --p-name
: CHAR(12), obligatory, default 'world'; Your name

--loud, --p-loud
: CHAR(1), flag

--s-tag
: CHAR(12), default 'alpha' TO 'omega' SIGN E OPTION NE

--s-when
: DATS, default sy-datum TO sy-datum

--in, --p-in
: CHAR(1), radio DIR, takes a value: --in=<value>, default 'X'

--out, --p-out
: CHAR(1), radio DIR, takes a value: --out=<value>

--date, --p-date
: DATS, default sy-datum

--const, --p-const
: CHAR(4), default gc_def

--plain, --p-plain
: CHAR(1)

--dot, --p-dot
: CHAR(2)

--len, --p-len
: CHAR(10)

DIR
: Radio group: --in, --out

# EXIT STATUS

Exit status is supplied by the host.
