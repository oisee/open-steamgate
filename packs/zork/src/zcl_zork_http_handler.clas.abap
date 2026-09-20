CLASS zcl_zork_http_handler DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC.

  PUBLIC SECTION.
    INTERFACES if_http_extension.

  PRIVATE SECTION.
    METHODS get_html
      RETURNING VALUE(rv_html) TYPE string.
ENDCLASS.

CLASS zcl_zork_http_handler IMPLEMENTATION.

  METHOD if_http_extension~handle_request.
    DATA(lv_path) = server->request->get_header_field( '~path_info' ).
    IF lv_path IS INITIAL.
      lv_path = server->request->get_header_field( '~path' ).
    ENDIF.
    IF lv_path CP '*/speedrun.txt'.
      DATA(lo_loader) = NEW zcl_ork_00_game_loader_smw0( ).
      DATA(lv_script) = lo_loader->zif_ork_00_game_loader~load( 'ZORK-MINI-SPEEDRUN-TXT' ).
      IF lv_script IS INITIAL.
        server->response->set_status( code = 404 reason = 'Replay resource not found' ).
        RETURN.
      ENDIF.
      server->response->set_header_field( name = 'Content-Type' value = 'text/plain; charset=utf-8' ).
      server->response->set_data( lv_script ).
      RETURN.
    ENDIF.
    DATA(lv_html) = get_html( ).

    server->response->set_header_field(
      name  = 'Content-Type'
      value = 'text/html; charset=utf-8' ).

    server->response->set_cdata( lv_html ).
  ENDMETHOD.

  METHOD get_html.
    DATA(lv_n) = cl_abap_char_utilities=>newline.

    rv_html =
      |<!DOCTYPE html>{ lv_n }| &&
      |<html>{ lv_n }| &&
      |<head>{ lv_n }| &&
      |  <title>ZORK on Off-Stack Doppelganger</title>{ lv_n }| &&
      |  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css" />{ lv_n }| &&
      |  <style>{ lv_n }| &&
      |    * \{ box-sizing: border-box; \}{ lv_n }| &&
      |    body \{ background-color: #0a0a0a; display: flex; flex-direction: column; justify-content: center; align-items: center; min-height: 100vh; margin: 0; font-family: 'Courier New', monospace; \}{ lv_n }| &&
      |    h1 \{ color: #00ff00; text-shadow: 0 0 10px #00ff00; margin-bottom: 10px; \}{ lv_n }| &&
      |    #terminal-container \{ border: 2px solid #00ff00; border-radius: 8px; padding: 10px; background: #000; box-shadow: 0 0 20px rgba(0, 255, 0, 0.3); \}{ lv_n }| &&
*     **No fixed size.** xterm renders `cols` x `rows` at whatever the font
*     measures, and the element only clips it: 100 columns of 16px Courier is
*     about 960px, which ran past an 820px box and off the right edge of the
*     frame (backlog E.4). The box is sized by its contents now, so the frame
*     is exactly as wide as the terminal it draws, whatever the font does --
*     the one arrangement that cannot be half a column out.
      |    #terminal-container \{ display: inline-block; \}{ lv_n }| &&
      |    #terminal \{ line-height: 1; \}{ lv_n }| &&
      |    #terminal .xterm-viewport \{ overflow-y: auto; scrollbar-width: thin; scrollbar-color: #176b17 #000; \}{ lv_n }| &&
      |    #status \{ color: #888; margin-top: 10px; font-size: 12px; \}{ lv_n }| &&
      |    #replay-controls \{ margin-top: 12px; color: #aaa; font-size: 13px; text-align: center; \}{ lv_n }| &&
      |    #replay-controls button \{ background: #111; color: #00ff00; border: 1px solid #00ff00; padding: 6px 12px; cursor: pointer; font: inherit; \}{ lv_n }| &&
      |    #replay-controls button:disabled \{ color: #777; border-color: #777; cursor: default; \}{ lv_n }| &&
      |    #replay-progress \{ margin-top: 6px; min-height: 1em; \}{ lv_n }| &&
      |    .connected \{ color: #00ff00 !important; \}{ lv_n }| &&
      |    .disconnected \{ color: #ff4444 !important; \}{ lv_n }| &&
      |  </style>{ lv_n }| &&
      |</head>{ lv_n }| &&
      |<body>{ lv_n }| &&
      |  <h1>ZORK on Off-Stack Doppelganger</h1>{ lv_n }| &&
      |  <div id="terminal-container"><div id="terminal"></div></div>{ lv_n }| &&
      |  <div id="status">Status: <span id="statusText" class="disconnected">Connecting...</span></div>{ lv_n }| &&
      |  <div id="replay-controls">| &&
      |    <button id="replay-speedrun" type="button" disabled>Replay SPEEDRUN</button> | &&
      |    <button id="replay-start" type="button" disabled>Replay short route</button> | &&
      |    <button id="replay-cancel" type="button" disabled>Cancel replay</button>| &&
      |    <div id="replay-progress" role="status" aria-live="polite">Manual play is available when connected.</div>| &&
      |  </div>{ lv_n }| &&
      |  <script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js"></script>{ lv_n }| &&
      |  <script>{ lv_n }| &&
      |    const APC_PATH = "/sap/bc/apc/sap/zapc_zork";{ lv_n }| &&
      |    let socket = null;{ lv_n }| &&
      |    let currentLine = "";{ lv_n }| &&
      |    let responseBuffer = "";{ lv_n }| &&
      |    let pendingResponse = null;{ lv_n }| &&
      |    let replaying = false;{ lv_n }| &&
      |    let replayToken = 0;{ lv_n }| &&
      |    const replaySteps = [| &&
      |      \{ command: 'open mailbox', expect: 'reveals a leaflet' \},| &&
      |      \{ command: 'read leaflet', expect: 'WELCOME TO ZORK' \}| &&
      |    ];{ lv_n }| &&
      |    const term = new Terminal(\{| &&
      |      cursorBlink: true,| &&
      |      fontFamily: '"Courier New", Courier, monospace',| &&
      |      fontSize: 16,| &&
      |      cols: 100,| &&
      |      rows: 30,| &&
      |      theme: \{ background: '#000000', foreground: '#00ff00', cursor: '#00ff00' \}| &&
      |    \});{ lv_n }| &&
      |    term.open(document.getElementById('terminal'));{ lv_n }| &&
      |    function updateStatus(text, connected) \{| &&
      |      document.getElementById('statusText').textContent = text;| &&
      |      document.getElementById('statusText').className = connected ? 'connected' : 'disconnected';| &&
      |    \}{ lv_n }| &&
      |    function setReplayProgress(message) \{| &&
      |      document.getElementById('replay-progress').textContent = message;| &&
      |    \}{ lv_n }| &&
      |    function updateReplayButtons(ready) \{| &&
      |      document.getElementById('replay-start').disabled = !ready \|\| replaying;| &&
      |      document.getElementById('replay-speedrun').disabled = !ready \|\| replaying;| &&
      |      document.getElementById('replay-cancel').disabled = !replaying;| &&
      |    \}{ lv_n }| &&
      |    function rejectPending(error) \{| &&
      |      if (!pendingResponse) return;| &&
      |      const pending = pendingResponse;| &&
      |      pendingResponse = null;| &&
      |      clearTimeout(pending.timer);| &&
      |      pending.reject(error);| &&
      |    \}{ lv_n }| &&
      |    function waitForPrompt() \{| &&
      |      return new Promise((resolve, reject) => \{| &&
      |        const timer = setTimeout(() => \{| &&
      |          pendingResponse = null;| &&
      |          reject(new Error('Timed out waiting for the game prompt'));| &&
      |        \}, 30000);| &&
      |        pendingResponse = \{ resolve, reject, timer \};| &&
      |      \});| &&
      |    \}{ lv_n }| &&
      |    function connect() \{| &&
      |      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';| &&
      |      const wsUrl = protocol + '//' + location.host + APC_PATH;| &&
      |      term.writeln('\\x1b[33mConnecting to Z-Machine...\\x1b[0m');| &&
      |      updateStatus('Connecting...', false);| &&
      |      updateReplayButtons(false);| &&
      |      responseBuffer = '';| &&
      |      const ready = waitForPrompt();| &&
      |      const ws = new WebSocket(wsUrl);| &&
      |      socket = ws;{ lv_n }| &&
      |      ws.onopen = () => \{| &&
      |        if (ws !== socket) return;| &&
      |        term.writeln('\\x1b[32m[CONNECTED]\\x1b[0m\\r\\n');| &&
      |        updateStatus('Connected - Playing ZORK', true);| &&
      |      \};{ lv_n }| &&
      |      ws.onmessage = (e) => \{| &&
      |        if (ws !== socket) return;| &&
      |        responseBuffer += e.data;| &&
      |        const renderedResponse = responseBuffer;| &&
      |        term.write(e.data.replace(/\\r?\\n/g, '\\r\\n'), () => \{| &&
      |        if (ws !== socket) return;| &&
      |        if (/(?:^\|\\n)>\\s*$/.test(renderedResponse)) \{| &&
      |          if (pendingResponse) \{| &&
      |            const pending = pendingResponse;| &&
      |            pendingResponse = null;| &&
      |            clearTimeout(pending.timer);| &&
      |            pending.resolve(renderedResponse);| &&
      |          \}| &&
      |          if (!replaying) updateReplayButtons(true);| &&
      |        \}| &&
      |        if (renderedResponse.includes('*** GAME OVER ***')) rejectPending(new Error('Game ended before the route finished'));| &&
      |        \});| &&
      |      \};{ lv_n }| &&
      |      ws.onclose = () => \{| &&
      |        if (ws !== socket) return;| &&
      |        rejectPending(new Error('The game connection closed'));| &&
      |        term.writeln('\\r\\n\\x1b[31m[DISCONNECTED]\\x1b[0m');| &&
      |        updateStatus('Disconnected', false);| &&
      |        updateReplayButtons(false);| &&
      |        currentLine = '';| &&
      |      \};{ lv_n }| &&
      |      ws.onerror = () => \{| &&
      |        if (ws !== socket) return;| &&
      |        rejectPending(new Error('The game connection failed'));| &&
      |        term.writeln('\\r\\n\\x1b[31m[CONNECTION ERROR]\\x1b[0m');| &&
      |        updateStatus('Error', false);| &&
      |        updateReplayButtons(false);| &&
      |      \};{ lv_n }| &&
      |      return ready;| &&
      |    \}{ lv_n }| &&
      |    function sendCommand(command) \{| &&
      |      if (!socket \|\| socket.readyState !== WebSocket.OPEN) throw new Error('Not connected');| &&
      |      responseBuffer = '';| &&
      |      term.write('\\r\\n');| &&
      |      socket.send(command);| &&
      |      updateReplayButtons(false);| &&
      |    \}{ lv_n }| &&
      |    async function startReplay(mode = 'short') \{| &&
      |      if (replaying) return;| &&
      |      if (!confirm('Replay starts a fresh game and discards your current session. Continue?')) return;| &&
      |      replaying = true;| &&
      |      const token = ++replayToken;| &&
      |      updateReplayButtons(false);| &&
      |      rejectPending(new Error('Session reset for replay'));| &&
      |      if (socket) socket.close();| &&
      |      currentLine = '';| &&
      |      term.clear();| &&
      |      setReplayProgress('Starting a fresh game...');| &&
      |      try \{| &&
      |        let steps = replaySteps;| &&
      |        if (mode === 'speedrun') \{| &&
      |          setReplayProgress('Loading SPEEDRUN from SMW0...');| &&
      |          const resource = await fetch('/sap/bc/zork/speedrun.txt', \{ signal: AbortSignal.timeout(15000) \});| &&
      |          if (!resource.ok) throw new Error('SPEEDRUN resource: HTTP ' + resource.status);| &&
      |          const text = await resource.text();| &&
      |          steps = text.split(String.fromCharCode(10)).map(line => line.trim())| &&
      |            .filter(line => line && !line.startsWith('#')).map(command => (\{command\}));| &&
      |          if (!steps.length) throw new Error('SPEEDRUN is empty');| &&
      |        \}| &&
      |        if (token !== replayToken) return;| &&
      |        await connect();| &&
      |        for (let i = 0; i < steps.length; i++) \{| &&
      |          if (token !== replayToken) return;| &&
      |          const step = steps[i];| &&
      |          setReplayProgress('Step ' + (i + 1) + '/' + steps.length + ': ' + step.command);| &&
      |          term.write(step.command);| &&
      |          const response = waitForPrompt();| &&
      |          try \{ sendCommand(step.command); \}| &&
      |          catch (error) \{ rejectPending(error); \}| &&
      |          const answer = await response;| &&
      |          if (step.expect && !answer.toLowerCase().includes(step.expect.toLowerCase())) \{| &&
      |            throw new Error('Unexpected answer to ' + step.command);| &&
      |          \}| &&
      |        \}| &&
      |        if (token !== replayToken) return;| &&
      |        setReplayProgress('Replay complete: ' + steps.length + (mode === 'short' ? ' commands verified.' : ' commands replayed (SPEEDRUN, not a victory assertion).') + ' Continue playing manually.');| &&
      |      \} catch (error) \{| &&
      |        if (token === replayToken) setReplayProgress('Replay stopped: ' + error.message);| &&
      |      \} finally \{| &&
      |        if (token === replayToken) \{| &&
      |          replaying = false;| &&
      |          updateReplayButtons(socket && socket.readyState === WebSocket.OPEN);| &&
      |        \}| &&
      |      \}| &&
      |    \}{ lv_n }| &&
      |    document.getElementById('replay-start').addEventListener('click', () => startReplay('short'));| &&
      |    document.getElementById('replay-speedrun').addEventListener('click', () => startReplay('speedrun'));| &&
      |    document.getElementById('replay-cancel').addEventListener('click', () => \{| &&
      |      if (!replaying) return;| &&
      |      replayToken++;| &&
      |      replaying = false;| &&
      |      rejectPending(new Error('Replay cancelled'));| &&
      |      if (socket) socket.close();| &&
      |      currentLine = '';| &&
      |      term.clear();| &&
      |      setReplayProgress('Replay cancelled. Starting a fresh game for manual play.');| &&
      |      connect().catch((error) => setReplayProgress('Reconnect failed: ' + error.message));| &&
      |    \});{ lv_n }| &&
      |    term.onData(data => \{| &&
      |      if (replaying \|\| !socket \|\| socket.readyState !== WebSocket.OPEN) return;| &&
      |      const code = data.charCodeAt(0);{ lv_n }| &&
      |      if (code === 13) \{| &&
      |        sendCommand(currentLine);| &&
      |        currentLine = "";| &&
      |      \} else if (code === 127 \|\| code === 8) \{| &&
      |        if (currentLine.length > 0) \{| &&
      |          currentLine = currentLine.slice(0, -1);| &&
      |          term.write('\\b \\b');| &&
      |        \}| &&
      |      \} else if (code >= 32) \{| &&
      |        currentLine += data;| &&
      |        term.write(data);| &&
      |      \}| &&
      |    \});{ lv_n }| &&
      |    connect().catch((error) => setReplayProgress('Connection failed: ' + error.message));{ lv_n }| &&
      |  </script>{ lv_n }| &&
      |</body>{ lv_n }| &&
      |</html>|.
  ENDMETHOD.

ENDCLASS.
