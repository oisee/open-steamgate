# yieldsleep

The `ENQUEUE_*` `_WAIT` path needs the same yield as `WAIT UP TO`: commit the
database LUW, let another dialog step use the process's single work process,
then take it back before the lock call continues. A unit-run `Session` does not
own `abap.WorkProcess`; its sleep must leave that mutex untouched.
