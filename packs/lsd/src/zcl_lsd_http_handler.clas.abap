CLASS zcl_lsd_http_handler DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  " The player page: a SAP GUI terminal drawn in JavaScript, fed by the
  " recorded screens the push channel ZAPC_LSD hands out. The page speaks no
  " DIAG; it paints rows of styled runs on a canvas, in the xterm 256-colour
  " palette the recording's styles use, and paces itself by each frame's
  " recorded time. An audio object, when the pack carries one, plays along.
  PUBLIC SECTION.
    INTERFACES if_http_extension.
  PRIVATE SECTION.
    METHODS page RETURNING VALUE(rv_html) TYPE string.
    "! An SMW0 object as bytes, the way the demo serves its audio.
    METHODS media
      IMPORTING iv_name        TYPE wwwdatatab-objid
      EXPORTING ev_data        TYPE xstring
                ev_size        TYPE i.
ENDCLASS.

CLASS zcl_lsd_http_handler IMPLEMENTATION.

  METHOD if_http_extension~handle_request.
    DATA: lv_data TYPE xstring, lv_size TYPE i.
    DATA(lv_query) = server->request->get_header_field( '~query_string' ).
    IF lv_query CS 'audio'.
      media( EXPORTING iv_name = 'ZLSD-MUSIC' IMPORTING ev_data = lv_data ev_size = lv_size ).
      IF lv_data IS INITIAL.
        server->response->set_status( code = 404 reason = 'no music in this pack' ).
        RETURN.
      ENDIF.
      server->response->set_header_field( name = 'Content-Type' value = 'audio/mp4' ).
      server->response->set_header_field( name = 'Content-Length' value = CONV string( lv_size ) ).
      server->response->set_data( lv_data ).
      RETURN.
    ENDIF.
    server->response->set_header_field( name = 'Content-Type' value = 'text/html; charset=utf-8' ).
    server->response->set_cdata( page( ) ).
  ENDMETHOD.

  METHOD media.
    DATA: lt_mime   TYPE w3mimetabtype,
          ls_key    TYPE wwwdatatab,
          lt_params TYPE STANDARD TABLE OF wwwparams.
    ls_key-relid = 'MI'.
    ls_key-objid = iv_name.
    SELECT * FROM wwwparams INTO TABLE lt_params WHERE relid = ls_key-relid AND objid = ls_key-objid.
    IF sy-subrc <> 0.
      RETURN.
    ENDIF.
    READ TABLE lt_params INTO DATA(ls_param) WITH KEY name = 'filesize'.
    IF sy-subrc = 0.
      ev_size = ls_param-value.
    ENDIF.
    CALL FUNCTION 'WWWDATA_IMPORT'
      EXPORTING
        key    = ls_key
      TABLES
        mime   = lt_mime
      EXCEPTIONS
        OTHERS = 1.
    IF sy-subrc <> 0.
      RETURN.
    ENDIF.
    CALL FUNCTION 'SCMS_BINARY_TO_XSTRING'
      EXPORTING
        input_length = ev_size
      IMPORTING
        buffer       = ev_data
      TABLES
        binary_tab   = lt_mime.
  ENDMETHOD.

  METHOD page.
    rv_html =
`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>SAP LSD - a light-show as SAP GUI screens</title>` &&
`<style>body{background:#000;color:#0f0;font-family:'Courier New',monospace;margin:0;padding:16px;text-align:center}` &&
`h1{color:#0f0;text-shadow:0 0 10px #0f0;font-size:24px;margin:8px 0}` &&
`#status{color:#f0f;margin:6px 0}canvas{border:2px solid #0f0;box-shadow:0 0 20px #0f0;background:#000;max-width:100%}` &&
`button{background:#000;color:#0f0;border:1px solid #0f0;padding:8px 20px;font:16px 'Courier New',monospace;cursor:pointer;margin:8px}` &&
`button:hover{background:#0c0;color:#000}a{color:#0ff}</style></head><body>` &&
`<h1>SAP LSD - LIGHT-SHOW DISPATCHER</h1>` &&
`<div id="status">Connecting...</div>` &&
`<div><button id="play">&#9654; PLAY</button></div>` &&
`<canvas id="screen" width="1080" height="648"></canvas>` &&
`<audio id="audio" src="?audio" preload="auto" loop></audio>` &&
`<div id="info">a demoscene show played to SAP GUI over DIAG, recorded screen by screen with sap-tui and replayed here over an ABAP push channel</div>` &&
`<script>` &&
`var APC='/sap/bc/apc/sap/zapc_lsd';` &&
`var canvas=document.getElementById('screen'),ctx=canvas.getContext('2d'),statusEl=document.getElementById('status');` &&
`var rows=36,cols=120,cw=9,ch=18,styles=[],frames=[],grid=[],total=0,got=0,ws=null,playing=false,frameAt=0,t0=0;` &&
`var base=['#000000','#cd0000','#00cd00','#cdcd00','#0000ee','#cd00cd','#00cdcd','#e5e5e5','#7f7f7f','#ff0000','#00ff00','#ffff00','#5c5cff','#ff00ff','#00ffff','#ffffff'];` &&
`function colour(n){if(n<16)return base[n];if(n<232){n-=16;var l=[0,95,135,175,215,255];return 'rgb('+l[Math.floor(n/36)]+','+l[Math.floor(n/6)%6]+','+l[n%6]+')';}var g=8+10*(n-232);return 'rgb('+g+','+g+','+g+')';}` &&
`function drawRow(r){var runs=grid[r];if(!runs)return;var x=0,y=r*ch;for(var i=0;i<runs.length;i++){var text=runs[i][0],st=styles[runs[i][1]]||[0,0,0,0];` &&
`var fg=colour(st[1]),bg=st[2]?colour(st[2]):'#000';if(st[3]&4){var tmp=fg;fg=bg;bg=tmp;}` &&
`ctx.fillStyle=bg;ctx.fillRect(x,y,text.length*cw,ch);ctx.fillStyle=fg;ctx.font=(st[3]&1?'bold ':'')+'15px "Courier New",monospace';ctx.textBaseline='top';` &&
`for(var k=0;k<text.length;k++){var c=text.charAt(k);if(c!==' ')ctx.fillText(c,x+k*cw,y+1);}` &&
`if(st[3]&2){ctx.fillRect(x,y+ch-2,text.length*cw,1);}x+=text.length*cw;}}` &&
`function apply(frame){for(var r in frame.r){grid[+r]=frame.r[r];drawRow(+r);}}` &&
`function line(text){var o;try{o=JSON.parse(text);}catch(e){return;}` &&
`if(o.v){rows=o.rows;cols=o.cols;canvas.width=cols*cw;canvas.height=rows*ch;ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);return;}` &&
`if(o.s){for(var i=0;i<o.s.length;i++)styles[o.s[i][0]]=o.s[i];return;}` &&
`if(o.t!==undefined)frames.push(o);}` &&
`function ask(){if(got>=total)return;var to=Math.min(total,got+200);ws.send(JSON.stringify({cmd:'lines',from:got,to:to}));}` &&
`function tick(){if(!playing)return;var now=performance.now()-t0;while(frameAt<frames.length&&frames[frameAt].t<=now){apply(frames[frameAt]);frameAt++;}` &&
`if(frameAt>=frames.length&&got>=total){frameAt=0;t0=performance.now();var a=document.getElementById('audio');if(a){a.currentTime=0;}}` &&
`statusEl.textContent='Playing  frame '+frameAt+' / '+frames.length+'  ('+(now/1000).toFixed(1)+' s)';requestAnimationFrame(tick);}` &&
`function connect(){ws=new WebSocket((location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+APC);` &&
`ws.onopen=function(){statusEl.textContent='Connected, loading the show...';};` &&
`ws.onmessage=function(e){var text=String(e.data);var o=null;if(text.charAt(0)==='{'&&text.indexOf('"type":"show"')>=0){try{o=JSON.parse(text);}catch(x){}}` &&
`if(o&&o.type==='show'){total=o.lines;got=0;ask();return;}` &&
`var parts=text.split(String.fromCharCode(10));for(var i=0;i<parts.length;i++){if(parts[i])line(parts[i]);}got+=parts.length;` &&
`statusEl.textContent='Loaded '+got+' / '+total+' lines, '+frames.length+' screens';if(got<total)ask();else statusEl.textContent='Ready: '+frames.length+' screens, press PLAY';};` &&
`ws.onclose=function(){statusEl.textContent='Disconnected';};ws.onerror=function(){statusEl.textContent='Disconnected';};}` &&
`document.getElementById('play').onclick=function(){if(playing){playing=false;this.innerHTML='&#9654; PLAY';var a=document.getElementById('audio');if(a)a.pause();return;}` &&
`playing=true;this.innerHTML='&#10074;&#10074; PAUSE';t0=performance.now()-(frameAt<frames.length?frames[frameAt].t:0);var a=document.getElementById('audio');if(a){a.play().catch(function(){});}tick();};` &&
`connect();</script></body></html>`.
  ENDMETHOD.

ENDCLASS.
