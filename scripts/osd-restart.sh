#!/bin/sh
# Перезапустить OSD, освободив порт, и дождаться, пока он ответит.
#
# По владельцу порта, а не по имени процесса. `pkill -f node` убивает и ту
# оболочку, из которой его позвали, если её командная строка содержит образец —
# это случалось трижды за один вечер. `ss` называет того, кто держит порт, и
# только его.
#
# Ждёт освобождения порта перед стартом: убитый процесс отпускает сокет не
# мгновенно, и новый падает с EADDRINUSE в лог, который никто не читает, —
# после чего "перезапустил" означает "старый всё ещё работает".
#
#   scripts/osd-restart.sh [порт]
set -e
port=${1:-3030}
root=$(cd "$(dirname "$0")/.." && pwd)
log=${OSD_LOG:-/tmp/osd-$port.log}

owner=$(ss -lntpH "sport = :$port" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1)
if [ -n "$owner" ]; then
  echo "порт $port держит pid $owner — останавливаю"
  kill "$owner" 2>/dev/null || true
  i=0
  while ss -lntH "sport = :$port" 2>/dev/null | grep -q ":$port "; do
    i=$((i + 1))
    [ "$i" -gt 20 ] && { echo "порт $port не освободился, kill -9"; kill -9 "$owner" 2>/dev/null; sleep 1; break; }
    sleep 0.5
  done
fi

cd "$root"
STG_PORT=$port setsid nohup node test/run.mjs > "$log" 2>&1 < /dev/null &
echo "запустил, лог $log"

i=0
while [ "$i" -lt 40 ]; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$port/sap/bc/adt/core/discovery" 2>/dev/null || true)
  if [ "$code" = "200" ]; then
    echo "OSD отвечает на $port"
    echo "сборка: $(curl -s "http://localhost:$port/sap/bc/adt/core/http/build" 2>/dev/null)"
    exit 0
  fi
  i=$((i + 1))
  sleep 2
done

echo "не поднялся за 80 секунд, последние строки лога:"
tail -12 "$log"
exit 1
