CLASS zcl_lsd_http_handler DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  " The player page: a SAP GUI terminal drawn in JavaScript, fed by the
  " recorded screens the push channel ZAPC_LSD hands out. The page speaks no
  " DIAG; it takes the gzip of the recording from the channel in base64
  " chunks, inflates it with the browser's own DecompressionStream, paints
  " rows of styled runs on a canvas in the xterm 256-colour palette the
  " recording's styles use, and paces itself by each frame's recorded time.
  " It starts by itself once the show is in, because a light-show that waits
  " to be asked is a screenshot; the music needs a gesture, so when the
  " browser refuses to play it the show runs on and the first click or key
  " brings the sound in at the right second. The toolbar keeps Play and Stop,
  " which is how the show is replayed. When the recording runs out before the
  " music does, the finale is played again from where it begins rather than
  " the show restarting at the logon screen.
  PUBLIC SECTION.
    INTERFACES if_http_extension.
  PRIVATE SECTION.
    METHODS page RETURNING VALUE(rv_html) TYPE string.
ENDCLASS.

CLASS zcl_lsd_http_handler IMPLEMENTATION.

  METHOD if_http_extension~handle_request.
    DATA: lv_data TYPE xstring, lv_size TYPE i.
    DATA(lv_query) = server->request->get_header_field( '~query_string' ).
    IF lv_query CS 'audio'.
      zcl_lsd_media=>load( EXPORTING iv_name = 'ZLSD-MUSIC' IMPORTING ev_data = lv_data ev_size = lv_size ).
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

  METHOD page.
    rv_html =
`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>LSD - a light-show as SAP GUI screens</title>` &&
`<style>body{background:#dfe6ee;color:#1f2d3d;font-family:"72","Segoe UI",Arial,sans-serif;margin:0;padding:24px 16px}` &&
`.win{max-width:1100px;margin:0 auto;border:1px solid #7f93ab;border-radius:6px;box-shadow:0 8px 24px rgba(20,40,70,.28);background:#f4f7fb;overflow:hidden}` &&
`.title{background:linear-gradient(#5d8ac0,#2f5f94);color:#fff;font-weight:bold;font-size:14px;padding:6px 12px;letter-spacing:.3px}` &&
`.title span{float:right;font-weight:normal;opacity:.85}` &&
`.menu{background:#eef2f7;border-bottom:1px solid #c5d0dd;padding:3px 10px;font-size:13px;color:#2b3b4d}.menu b{margin-right:16px;font-weight:normal}` &&
`.tools{background:linear-gradient(#f9fbfd,#e4eaf1);border-bottom:1px solid #c5d0dd;padding:6px 10px;display:flex;align-items:center;gap:12px}` &&
`button{background:linear-gradient(#ffffff,#dfe6ee);color:#1f2d3d;border:1px solid #8ea3bc;border-radius:3px;padding:4px 14px;font:13px "72","Segoe UI",Arial,sans-serif;cursor:pointer}` &&
`button:hover{background:linear-gradient(#ffffff,#cfdae7)}button:active{background:#cfdae7}` &&
`#status{font-size:13px;color:#2b3b4d}` &&
`.screen{background:#eef2f6;padding:0;line-height:0;text-align:center}canvas{max-width:100%;display:inline-block}` &&
`.bar{background:#eef2f7;border-top:1px solid #c5d0dd;padding:4px 10px;font-size:12px;color:#4a5a6d;display:flex;justify-content:space-between}` &&
`.foot{max-width:1100px;margin:10px auto 0;font-size:11px;color:#77869a;text-align:center}.foot a{color:#5a7fa8;text-decoration:none}.foot a:hover{text-decoration:underline}</style></head><body>` &&
`<div class="win">` &&
`<div class="title">LSD - Light-Show Dispatcher <span>ZAPC_LSD</span></div>` &&
`<div class="menu"><b>Show</b><b>Screen</b><b>Help</b></div>` &&
`<div class="tools"><button id="play">&#9654; Play</button><span id="status">Connecting...</span></div>` &&
`<div class="screen"><canvas id="screen" width="1080" height="648"></canvas></div>` &&
`<audio id="audio" src="?audio" preload="auto"></audio>` &&
`<div class="bar"><span id="left">a demoscene show played to SAP GUI over DIAG, recorded screen by screen with sap-tui</span><span>replayed over an ABAP push channel</span></div>` &&
`</div>` &&
`<div class="foot"><a href="https://github.com/oisee/sap-lsd">sap-lsd</a> &middot; <a href="https://github.com/oisee/open-steamgate">open-steamgate</a> &middot; <a href="https://www.youtube.com/watch?v=Pszxxj-OUAk">sap-lsd in a real SAP GUI (video)</a></div>` &&
`<script>` &&
`var APC='/sap/bc/apc/sap/zapc_lsd';` &&
`var CHUNK=65536;` &&
`var FINALE=111000;` &&
`var canvas=document.getElementById('screen'),ctx=canvas.getContext('2d'),statusEl=document.getElementById('status'),playBtn=document.getElementById('play'),audio=document.getElementById('audio');` &&
`var rows=36,cols=120,cw=9,ch=18,styles=[],frames=[],grid=[],ws=null;` &&
`var total=0,got=0,parts=[],playing=false,frameAt=0,t0=0,finaleAt=0,finaleGrid=null,soundWanted=false;` &&
`var showAt=0;` &&
`var BG='#eef2f6',FG='#1f2d3d';` &&
`var base=['#000000','#cd0000','#00cd00','#cdcd00','#0000ee','#cd00cd','#00cdcd','#e5e5e5','#7f7f7f','#ff0000','#00ff00','#ffff00','#5c5cff','#ff00ff','#00ffff','#ffffff'];` &&
`function colour(n){if(n<16)return base[n];if(n<232){n-=16;var l=[0,95,135,175,215,255];return 'rgb('+l[Math.floor(n/36)]+','+l[Math.floor(n/6)%6]+','+l[n%6]+')';}var g=8+10*(n-232);return 'rgb('+g+','+g+','+g+')';}` &&
`function drawRow(r){var runs=grid[r];if(!runs)return;var x=0,y=r*ch;for(var i=0;i<runs.length;i++){var text=runs[i][0],st=styles[runs[i][1]]||[0,0,0,0];` &&
`var fg=st[1]?colour(st[1]):FG,bg=st[2]?colour(st[2]):BG;if(st[3]&4){var tmp=fg;fg=bg;bg=tmp;}` &&
`ctx.fillStyle=bg;ctx.fillRect(x,y,text.length*cw,ch);ctx.fillStyle=fg;ctx.font=(st[3]&1?'bold ':'')+'15px "DejaVu Sans Mono","Noto Sans Mono","Segoe UI Symbol","Courier New",monospace';ctx.textBaseline='top';` &&
`for(var k=0;k<text.length;k++){var c=text.charAt(k);if(c!==' ')ctx.fillText(c,x+k*cw,y+1);}` &&
`if(st[3]&2){ctx.fillRect(x,y+ch-2,text.length*cw,1);}x+=text.length*cw;}}` &&
`function clearScreen(){ctx.fillStyle=BG;ctx.fillRect(0,0,canvas.width,canvas.height);}` &&
`function repaint(){clearScreen();for(var r=0;r<rows;r++)drawRow(r);}` &&
`function apply(frame){for(var r in frame.r){grid[+r]=frame.r[r];drawRow(+r);}}` &&
`function line(text){var o;try{o=JSON.parse(text);}catch(e){return;}` &&
`if(o.v){rows=o.rows;cols=o.cols;canvas.width=cols*cw;canvas.height=rows*ch;clearScreen();return;}` &&
`if(o.s){for(var i=0;i<o.s.length;i++)styles[o.s[i][0]]=o.s[i];return;}` &&
`if(o.t!==undefined)frames.push(o);}` &&
`function clock(ms){var s=Math.max(0,Math.floor(ms/1000));var m=Math.floor(s/60);s=s%60;return m+':'+(s<10?'0':'')+s;}` &&
`function prepare(){var g=[];finaleAt=0;` &&
`for(var i=0;i<frames.length;i++){if(frames[i].t>=FINALE){finaleAt=i;break;}for(var r in frames[i].r)g[+r]=frames[i].r[r];}` &&
`finaleGrid=g.slice();}` &&
`function musicOn(){return !!(audio&&!audio.paused&&audio.duration);}` &&
`function musicPlaying(){return musicOn()&&audio.currentTime<audio.duration-0.3;}` &&
`function seek(ms){showAt=ms;t0=performance.now()-ms;}` &&
`function showTime(){showAt=performance.now()-t0;return showAt;}` &&
`function say(){var span=musicOn()?'  /  '+clock(audio.duration*1000):'';` &&
`var hint=soundWanted?'  -  click anywhere for the music':'';` &&
`statusEl.textContent='Playing  '+clock(showAt)+span+'  -  screen '+frameAt+' / '+frames.length+hint;}` &&
`function tick(){if(!playing)return;` &&
`var now=showTime();` &&
`while(frameAt<frames.length&&frames[frameAt].t<=now){apply(frames[frameAt]);frameAt++;}` &&
`if(frameAt>=frames.length){` &&
`if(musicPlaying()&&finaleGrid){grid=finaleGrid.slice();frameAt=finaleAt;seek(frames[finaleAt].t);repaint();}` &&
`else{stop(true);return;}}` &&
`say();requestAnimationFrame(tick);}` &&
`function startAudio(){if(!audio)return;audio.currentTime=showAt/1000;var p=audio.play();` &&
`if(p&&p.catch)p.catch(function(){soundWanted=true;});else soundWanted=false;}` &&
`function start(){if(!frames.length)return;` &&
`if(frameAt>=frames.length){frameAt=0;}` &&
`if(frameAt===0){grid=[];clearScreen();}` &&
`playing=true;playBtn.innerHTML='&#9632; Stop';seek(frames[frameAt].t);startAudio();tick();}` &&
`function stop(atEnd){playing=false;playBtn.innerHTML='&#9654; Play';` &&
`if(audio){audio.pause();if(!atEnd)audio.currentTime=0;}` &&
`if(atEnd){statusEl.textContent='The show is over  -  press PLAY to replay';}` &&
`else{frameAt=0;grid=[];clearScreen();seek(0);statusEl.textContent='Stopped  -  press PLAY to replay';}}` &&
`function inflate(){var all=new Uint8Array(got),off=0;` &&
`for(var i=0;i<parts.length;i++){all.set(parts[i],off);off+=parts[i].length;}` &&
`parts=[];` &&
`if(typeof DecompressionStream==='undefined'){statusEl.textContent='this browser cannot inflate the show (DecompressionStream)';return;}` &&
`var ds=new DecompressionStream('gzip');` &&
`new Response(new Blob([all]).stream().pipeThrough(ds)).text().then(function(text){` &&
`var ls=text.split(String.fromCharCode(10));` &&
`for(var i=0;i<ls.length;i++){if(ls[i])line(ls[i]);}` &&
`prepare();start();}).catch(function(e){statusEl.textContent='the show did not inflate: '+e;});}` &&
`function askBytes(){var to=Math.min(total,got+CHUNK);ws.send(JSON.stringify({cmd:'bytes',from:got,to:to}));}` &&
`function connect(){ws=new WebSocket((location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+APC);` &&
`ws.onopen=function(){statusEl.textContent='Connected, loading the show...';};` &&
`ws.onmessage=function(e){var text=String(e.data);` &&
`if(text.charAt(0)==='{'&&text.indexOf('"type":"show"')>=0){var o=JSON.parse(text);total=o.bytes;got=0;parts=[];askBytes();return;}` &&
`var bin=atob(text),u=new Uint8Array(bin.length);` &&
`for(var i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);` &&
`parts.push(u);got+=u.length;` &&
`statusEl.textContent='Loading the show  '+Math.round(100*got/total)+'%';` &&
`if(got<total&&u.length>0)askBytes();else inflate();};` &&
`ws.onclose=function(){if(!frames.length)statusEl.textContent='Disconnected';};` &&
`ws.onerror=function(){if(!frames.length)statusEl.textContent='Disconnected';};}` &&
`playBtn.onclick=function(){if(playing)stop(false);else start();};` &&
`if(audio){audio.onended=function(){if(playing)stop(true);};}` &&
`document.addEventListener('pointerdown',function(){if(!soundWanted)return;startAudio();});` &&
`document.addEventListener('keydown',function(){if(!soundWanted)return;startAudio();});` &&
`connect();` &&
`</script></body></html>`.
  ENDMETHOD.

ENDCLASS.
