(function () {
  'use strict';
  var service = localStorage.getItem('cartoonWatchService') || '';
  var stateKey = 'cartoonWatchTVState';
  var frameKey = 'cartoonWatchEpisodeFrames';
  var active = null;
  var serial = 0;
  var priorFocus = null;
  var mediaKeys = { 415: 'play', 19: 'pause', 413: 'stop', 417: 'forward', 412: 'rewind', 10252: 'toggle', 179: 'toggle' };
  var root = document.createElement('section');
  root.id = 'cw-tv-player'; root.hidden = true; root.setAttribute('aria-label', 'Video player');
  root.innerHTML = '<video id="cw-tv-video" controls playsinline tabindex="0"></video><div id="cw-tv-controls"><button data-command="back">Back to catalog</button><button data-command="toggle">Play / pause</button><button data-command="rewind">Back 10 seconds</button><button data-command="forward">Forward 10 seconds</button><button data-command="intro" hidden>Skip intro</button><button data-command="captions">Captions</button><button data-command="retry">Retry</button></div><div id="cw-tv-status" role="status"></div>';
  document.body.appendChild(root);
  var video = document.getElementById('cw-tv-video');
  video.crossOrigin = 'anonymous';
  var controls = document.getElementById('cw-tv-controls');
  var status = document.getElementById('cw-tv-status');
  var introButton = controls.querySelector('[data-command="intro"]');
  var nativePlayer = window.webapis && webapis.avplay;
  var nativeSurface = document.createElement('object');
  nativeSurface.id = 'cw-tv-native'; if (nativePlayer) nativeSurface.type = 'application/avplayer'; nativeSurface.hidden = true; nativeSurface.tabIndex = 0; root.insertBefore(nativeSurface, video);
  var captions = document.createElement('div'); captions.id = 'cw-tv-captions'; root.appendChild(captions);
  var setup = document.createElement('section');
  setup.id = 'cw-tv-setup'; setup.hidden = true; setup.setAttribute('role', 'dialog'); setup.setAttribute('aria-modal', 'true');
  setup.innerHTML = '<div><h1>Connect Cartoon Watch</h1><p>Keep the companion service running on a computer on the same network. Enter its address shown at startup.</p><label for="cw-tv-service">Companion address</label><input id="cw-tv-service" type="url" placeholder="http://computer.local:8765" autocomplete="off" spellcheck="false"><p id="cw-tv-connection" role="status"></p><div class="actions"><button id="cw-tv-connect">Connect</button><button id="cw-tv-cancel">Cancel</button></div></div>';
  document.body.appendChild(setup);
  var address = document.getElementById('cw-tv-service');
  var connection = document.getElementById('cw-tv-connection');
  var connectionButton = document.createElement('button');
  connectionButton.id = 'cw-tv-connection-button'; connectionButton.type = 'button'; connectionButton.className = 'button ghost'; connectionButton.textContent = 'Connection';
  document.querySelector('.topbar').appendChild(connectionButton);

  function validService(value) {
    try {
      var url = new URL(value.trim());
      if (!/^https?:$/.test(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) return '';
      return url.href.replace(/\/+$/, '');
    } catch (_) { return ''; }
  }
  function state() {
    try { return JSON.parse(localStorage.getItem(stateKey) || 'null') || { favorites: [], history: [], settings: { provider: 'wco', adBlock: true } }; }
    catch (_) { return { favorites: [], history: [], settings: { provider: 'wco', adBlock: true } }; }
  }
  function frames() {
    try { var raw = localStorage.getItem(frameKey) || '[]'; if (raw.length > 1048576) return []; var list = JSON.parse(raw); return Array.isArray(list) ? list.filter(function (item) { return item && typeof item.url === 'string' && item.url.length < 2048 && typeof item.image === 'string' && /^data:image\/jpeg;base64,[a-zA-Z0-9+/=]+$/.test(item.image) && item.image.length < 65536; }).slice(0, 64) : []; }
    catch (_) { return []; }
  }
  function saveFrames(list) {
    var raw; while (list.length > 64 || (raw = JSON.stringify(list)).length > 1048576) list.pop();
    while (true) { try { localStorage.setItem(frameKey, raw); return; } catch (_) { if (!list.length) { try { localStorage.removeItem(frameKey); } catch (ignored) {} return; } list.pop(); raw = JSON.stringify(list); } }
  }
  function forgetFrame(url) { saveFrames(frames().filter(function (item) { return item.url !== url; })); if (active) active.frameSaved = false; }
  function captureFrame() {
    if (!active || active.native || !active.media || root.hidden || video.readyState < 2 || !video.videoWidth || !video.videoHeight || !video.played.length || !isFinite(video.currentTime) || active.payload.kind === 'series' || active.payload.kind === 'movie') return;
    if (active.frameSaved && Math.abs(active.framePosition - video.currentTime) < .01) return;
    try {
      var canvas = document.createElement('canvas'); canvas.width = 192; canvas.height = 108; var context = canvas.getContext('2d');
      var scale = Math.min(192 / video.videoWidth, 108 / video.videoHeight), width = video.videoWidth * scale, height = video.videoHeight * scale;
      context.fillStyle = '#000'; context.fillRect(0, 0, 192, 108); context.drawImage(video, (192 - width) / 2, (108 - height) / 2, width, height);
      var image = canvas.toDataURL('image/jpeg', .55); if (image.length > 65536) return;
      var list = frames().filter(function (item) { return item.url !== active.payload.url; }); list.unshift({ url: active.payload.url, image: image, position: video.currentTime, updatedAt: Date.now() }); saveFrames(list); active.frameSaved = true; active.framePosition = video.currentTime;
    } catch (_) {}
  }
  function artwork(payload) {
    var saved = frames(), found = [], pending = [];
    (Array.isArray(payload.items) ? payload.items : []).slice(0, 12).forEach(function (item) {
      var frame = item.kind !== 'series' && item.kind !== 'movie' && saved.find(function (entry) { return entry.url === item.url; });
      if (frame) found.push({ url: item.url, image: frame.image, resumeFrame: true, imageSource: 'Resume frame', imageSourceUrl: '', imageAttribution: 'Saved from your last paused position' });
      else { var value = Object.assign({}, item); if (/^data:/.test(value.image || '')) value.image = ''; pending.push(value); }
    });
    if (!pending.length) return Promise.resolve({ items: found, pending: [], retryAfter: 1000 });
    return call('/api/artwork', { items: pending }).then(function (result) { return { items: found.concat((result.items || []).map(function (item) { return Object.assign({ resumeFrame: false }, item); })), pending: result.pending || [], retryAfter: result.retryAfter || 1000 }; });
  }
  function callback(id, value) { if (window.onNativeResult) window.onNativeResult(id, JSON.stringify(value)); }
  function call(path, payload) {
    return new Promise(function (resolve, reject) {
      if (!service) { reject(new Error('Connect the companion service using Connection.')); return; }
      var xhr = new XMLHttpRequest();
      xhr.open(payload ? 'POST' : 'GET', service + path, true);
      xhr.timeout = payload ? 90000 : 20000;
      if (payload) xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.onload = function () {
        var data;
        try { data = JSON.parse(xhr.responseText); } catch (_) { reject(new Error('The companion returned an unreadable response.')); return; }
        if (xhr.status < 200 || xhr.status >= 300 || data.error) reject(new Error(data.error || 'The companion could not complete this request.'));
        else resolve(data);
      };
      xhr.onerror = xhr.ontimeout = function () { reject(new Error('The companion is unavailable. Check its address, computer, and network connection.')); };
      xhr.send(payload ? JSON.stringify(payload) : null);
    });
  }
  function streamURL(value) {
    try { var url = new URL(value, service); return url.origin === new URL(service).origin && /^https?:$/.test(url.protocol) ? url.href : ''; }
    catch (_) { return ''; }
  }
  function showSetup() {
    priorFocus = document.activeElement; setup.hidden = false; address.value = service; connection.textContent = ''; address.focus();
    document.getElementById('cw-tv-cancel').disabled = !service;
  }
  function closeSetup() { if (!service) return; setup.hidden = true; if (priorFocus && document.contains(priorFocus)) priorFocus.focus(); }
  function position() { return active && active.native ? active.time || 0 : video.currentTime; }
  function duration() { return active && active.native ? active.duration || NaN : video.duration; }
  function paused() { return active && active.native ? active.paused : video.paused; }
  function setPosition(value) {
    var total = duration(); if (!isFinite(total)) return;
    value = Math.max(0, Math.min(Math.max(0, total - .1), value));
    if (active && active.native) {
      try { nativePlayer.seekTo(Math.round(value * 1000), function () { if (active && active.native) { active.time = value; tick(); } }, function () { status.textContent = 'This stream could not seek to that position.'; }); }
      catch (_) { status.textContent = 'This stream cannot seek yet.'; }
    } else video.currentTime = value;
  }
  function stopPlayback() {
    if (active && active.native) { try { nativePlayer.stop(); nativePlayer.close(); } catch (_) {} }
    video.pause(); video.removeAttribute('src'); video.load(); nativeSurface.hidden = true; video.hidden = false; document.body.classList.remove('cw-native-playing'); captions.textContent = ''; introButton.hidden = true;
  }
  function saveProgress() {
    if (!active || !isFinite(duration()) || !isFinite(position())) return;
    var entry = Object.assign({}, active.payload, { currentTime: position(), position: position(), duration: duration(), watchedAt: Date.now() });
    if (/^data:/.test(entry.image || '')) entry.image = ''; delete entry.resumeFrame;
    var saved = state(); saved.history = (saved.history || []).filter(function (item) { return item.url !== entry.url; }); saved.history.unshift(entry); saved.history = saved.history.slice(0, 80);
    localStorage.setItem(stateKey, JSON.stringify(saved));
    if (window.onPlaybackProgress) window.onPlaybackProgress(entry);
  }
  function mediaSession() {
    if (!navigator.mediaSession || !active) return;
    try {
      if (!active.mediaSessionReady) {
        if (window.MediaMetadata) navigator.mediaSession.metadata = new MediaMetadata({ title: active.payload.title || 'Cartoon Watch', artist: 'Cartoon Watch', album: active.payload.seriesTitle || '' });
        var actions = { play: function () { command('play'); }, pause: function () { command('pause'); }, stop: function () { command('stop'); }, seekbackward: function (event) { seek(-(event.seekOffset || 10)); }, seekforward: function (event) { seek(event.seekOffset || 10); }, seekto: function (event) { if (isFinite(event.seekTime)) setPosition(event.seekTime); } };
        Object.keys(actions).forEach(function (name) { try { navigator.mediaSession.setActionHandler(name, actions[name]); } catch (_) {} }); active.mediaSessionReady = true;
      }
      navigator.mediaSession.playbackState = paused() ? 'paused' : 'playing';
      if (navigator.mediaSession.setPositionState && isFinite(duration()) && duration() > 0 && (!active.positionAt || Date.now() - active.positionAt > 1000)) { navigator.mediaSession.setPositionState({ duration: duration(), playbackRate: 1, position: Math.max(0, Math.min(position(), duration())) }); active.positionAt = Date.now(); }
    } catch (_) {}
  }
  function closePlayer() {
    captureFrame(); serial++; saveProgress(); stopPlayback(); root.hidden = true; active = null;
    if (navigator.mediaSession) { try { navigator.mediaSession.playbackState = 'none'; navigator.mediaSession.metadata = null; } catch (_) {} }
    if (priorFocus && document.contains(priorFocus)) priorFocus.focus();
    if (window.refreshState) window.refreshState();
  }
  function captionCycle() {
    if (active.native) {
      var choices = active.captionTracks || []; active.captionIndex = (active.captionIndex + 2) % (choices.length + 1) - 1; captions.textContent = '';
      try { nativePlayer.setSilentSubtitle(true); } catch (_) {}
      if (!choices.length) { status.textContent = 'This player has not supplied captions.'; return; }
      if (active.captionIndex < 0) { status.textContent = 'Captions off'; return; }
      var choice = choices[active.captionIndex]; status.textContent = choice.label || 'Captions on';
      if (choice.nativeIndex !== undefined) { try { nativePlayer.setSelectTrack('TEXT', choice.nativeIndex); nativePlayer.setSilentSubtitle(false); } catch (_) { status.textContent = 'This caption track is unavailable.'; } }
      else if (!choice.cues && !choice.loading) loadCaptions(choice);
      tick(); return;
    }
    var tracks = video.textTracks, selected = -1;
    for (var i = 0; i < tracks.length; i++) { if (tracks[i].mode === 'showing') selected = i; tracks[i].mode = 'disabled'; }
    if (!tracks.length) { status.textContent = 'This player has not supplied captions.'; return; }
    selected++;
    if (selected < tracks.length) { tracks[selected].mode = 'showing'; status.textContent = tracks[selected].label || tracks[selected].language || 'Captions on'; }
    else status.textContent = 'Captions off';
  }
  function loadCaptions(choice) {
    var xhr = new XMLHttpRequest(); choice.loading = true; xhr.open('GET', choice.url, true); xhr.timeout = 15000;
    xhr.onload = function () {
      choice.loading = false;
      if (xhr.status !== 200 || xhr.responseText.length > 5000000) { status.textContent = 'This caption track is unavailable.'; return; }
      function seconds(value) { var fields = value.replace(',', '.').split(':').map(Number), total = 0; fields.forEach(function (part) { total = total * 60 + part; }); return total; }
      choice.cues = []; var plain = document.createElement('div');
      xhr.responseText.replace(/\r/g, '').split(/\n\s*\n/).forEach(function (block) {
        var lines = block.split('\n'), index = lines.findIndex(function (line) { return line.indexOf('-->') >= 0; }); if (index < 0) return;
        var times = lines[index].match(/((?:\d+:)?\d{2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d+:)?\d{2}:\d{2}[.,]\d{3})/); if (!times) return;
        plain.innerHTML = lines.slice(index + 1).join('\n').replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, '').replace(/<[^>]*>/g, '');
        choice.cues.push({ start: seconds(times[1]), end: seconds(times[2]), text: plain.textContent.trim() });
      }); choice.cues.sort(function (a, b) { return a.start - b.start; }); tick();
    };
    xhr.onerror = xhr.ontimeout = function () { choice.loading = false; status.textContent = 'This caption track could not load.'; }; xhr.send();
  }
  function tick() {
    if (!active) return;
    introButton.hidden = !introAvailable();
    if (active.native) {
      var track = (active.captionTracks || [])[active.captionIndex], cues = track && track.cues, text = '';
      if (cues && cues.length) { var low = 0, high = cues.length - 1, time = position(); while (low <= high) { var mid = (low + high) >> 1; if (cues[mid].start <= time) low = mid + 1; else high = mid - 1; } if (high >= 0 && time < cues[high].end) text = cues[high].text; }
      captions.textContent = text;
    }
    if (!active.savedAt || Date.now() - active.savedAt > 9000) { active.savedAt = Date.now(); saveProgress(); } mediaSession();
  }
  function seek(delta) { setPosition(position() + delta); }
  function introAvailable() { var range = active && active.media && active.media.intro; return Array.isArray(range) && range.length === 2 && isFinite(range[0]) && isFinite(range[1]) && range[0] >= 0 && range[1] > range[0] && position() >= range[0] && position() < range[1] && isFinite(duration()) && range[1] <= duration(); }
  function command(name) {
    if (!active) return;
    if (name === 'back' || name === 'stop') { closePlayer(); return; }
    if (name === 'retry') { startPlayer(active.payload).catch(function (error) { status.textContent = error.message; }); return; }
    if (name === 'captions') { captionCycle(); return; }
    if (name === 'intro') { if (introAvailable()) setPosition(active.media.intro[1]); return; }
    if (name === 'forward' || name === 'rewind') { seek(name === 'forward' ? 10 : -10); return; }
    if (active.native) {
      if (!active.ready) return;
      try { if (name === 'pause' || (name === 'toggle' && !paused())) { if (!paused()) nativePlayer.pause(); active.paused = true; saveProgress(); } else { nativePlayer.play(); active.paused = false; status.textContent = ''; } mediaSession(); }
      catch (_) { status.textContent = 'This playback command is unavailable. Choose Retry.'; } return;
    }
    if (name === 'pause' || (name === 'toggle' && !video.paused)) video.pause();
    else { var playing = video.play(); if (playing && playing.catch) playing.catch(function () { status.textContent = 'Press Play to start this video.'; }); }
  }
  function startPlayer(payload) {
    var attempt = ++serial;
    if (root.hidden) priorFocus = document.activeElement; captureFrame(); saveProgress(); stopPlayback(); active = { payload: payload, media: null }; forgetFrame(payload.url); root.hidden = false; status.textContent = 'Starting episode…'; controls.hidden = false;
    controls.querySelector('[data-command="toggle"]').focus();
    var outbound = Object.assign({}, payload); delete outbound.image; delete outbound.resumeFrame;
    return call('/api/play', outbound).then(function (media) {
      if (attempt !== serial) return { ok: true, cancelled: true };
      var url = streamURL(media.streamUrl);
      if (!url) throw new Error('The companion returned an invalid playback address.');
      active.media = media;
      if (nativePlayer && media.format === 'hls') {
        active.native = true; active.time = 0; active.paused = true; active.captionIndex = -1; active.captionTracks = (Array.isArray(media.subtitles) ? media.subtitles : []).map(function (track) { return { url: streamURL(track.url), label: track.label || track.language || 'Subtitles' }; }).filter(function (track) { return track.url; });
        nativeSurface.hidden = false; video.hidden = true; document.body.classList.add('cw-native-playing');
        try {
          nativePlayer.open(url); nativePlayer.setListener({
            oncurrentplaytime: function (time) { if (attempt === serial && active) { active.time = time / 1000; tick(); } },
            onbufferingstart: function () { if (attempt === serial) status.textContent = 'Buffering…'; },
            onbufferingcomplete: function () { if (attempt === serial) status.textContent = ''; },
            onstreamcompleted: function () { if (attempt === serial && active) { active.time = active.duration; saveProgress(); active.paused = true; try { nativePlayer.stop(); } catch (_) {} active.ready = false; status.textContent = 'Episode finished. Return to the catalog or choose Retry.'; mediaSession(); } },
            onerror: function () { if (attempt === serial) status.textContent = 'Playback could not start. Choose Retry or return to the catalog.'; }
          }); nativePlayer.setDisplayRect(0, 0, 1920, 1080); nativePlayer.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX'); nativePlayer.setSilentSubtitle(true);
          nativePlayer.prepareAsync(function () {
            if (attempt !== serial || !active) return;
            active.ready = true; active.duration = nativePlayer.getDuration() / 1000; command('play');
            try { nativePlayer.getTotalTrackInfo().forEach(function (track) { if (track.type === 'TEXT') active.captionTracks.push({ nativeIndex: track.index, label: 'Stream captions ' + (track.index + 1) }); }); } catch (_) {}
            var resume = Number(payload.resumeSeconds) || 0; if (resume > 0 && resume < duration() - 2) setPosition(resume); tick();
          }, function () { if (attempt === serial) status.textContent = 'Playback could not start. Choose Retry or return to the catalog.'; });
        } catch (_) { status.textContent = 'The TV could not open this stream. Choose Retry or return to the catalog.'; }
        return { ok: true };
      }
      Array.prototype.forEach.call(video.querySelectorAll('track'), function (track) { track.remove(); });
      (Array.isArray(media.subtitles) ? media.subtitles : []).forEach(function (subtitle) {
        var source = streamURL(subtitle.url); if (!source) return;
        var track = document.createElement('track'); track.kind = 'subtitles'; track.src = source; track.label = subtitle.label || subtitle.language || 'Subtitles'; track.srclang = subtitle.language || ''; video.appendChild(track);
      });
      video.src = url; video.load(); mediaSession();
      return { ok: true };
    }).catch(function (error) { if (attempt === serial) status.textContent = error.message; throw error; });
  }
  video.addEventListener('loadedmetadata', function () {
    if (!active) return;
    var resume = Number(active.payload.resumeSeconds) || 0;
    if (resume > 0 && isFinite(video.duration) && resume < video.duration - 2) video.currentTime = resume;
    command('play');
  });
  video.addEventListener('playing', function () { if (active) forgetFrame(active.payload.url); status.textContent = ''; mediaSession(); });
  video.addEventListener('pause', function () { captureFrame(); saveProgress(); mediaSession(); });
  video.addEventListener('timeupdate', tick);
  video.addEventListener('ended', saveProgress);
  video.addEventListener('error', function () { if (active && active.media) status.textContent = 'Playback could not start. Choose Retry or return to the catalog.'; });
  controls.addEventListener('click', function (event) { var button = event.target.closest('button'); if (button) command(button.getAttribute('data-command')); });
  connectionButton.onclick = showSetup;
  document.getElementById('cw-tv-cancel').onclick = closeSetup;
  document.getElementById('cw-tv-connect').onclick = function () {
    var candidate = validService(address.value); if (!candidate) { connection.textContent = 'Enter an http or https companion address without a password or query.'; return; }
    var old = service; service = candidate; connection.textContent = 'Connecting…';
    call('/health').then(function (result) { if (!result.ok) throw new Error('This address is not a ready Cartoon Watch companion.'); localStorage.setItem('cartoonWatchService', service); location.reload(); }).catch(function (error) { service = old; connection.textContent = error.message; });
  };
  window.CartoonWatch = { request: function (action, raw, id) {
    var payload;
    try { payload = JSON.parse(raw || '{}'); } catch (_) { callback(id, { error: 'Unreadable app request.' }); return; }
    if (action === 'getState') { callback(id, state()); return; }
    if (action === 'ready') { callback(id, { ok: true }); return; }
    if (action === 'saveState') { if (Array.isArray(payload.history) && !payload.history.length) { try { localStorage.removeItem(frameKey); } catch (_) {} } localStorage.setItem(stateKey, JSON.stringify(payload)); callback(id, { ok: true }); return; }
    if (action === 'clearHistory') { var clean = state(); clean.history = []; localStorage.setItem(stateKey, JSON.stringify(clean)); try { localStorage.removeItem(frameKey); } catch (_) {} callback(id, { ok: true }); return; }
    if (action === 'settings') { var saved = state(); saved.settings = Object.assign({}, saved.settings, payload); localStorage.setItem(stateKey, JSON.stringify(saved)); callback(id, { ok: true }); return; }
    if (action === 'exit') { platformExit(); callback(id, { ok: true }); return; }
    if (action === 'openSource') { callback(id, { error: 'The companion automatically tries fallback players. Return to the WCO catalog to choose a title.' }); return; }
    var task;
    if (action === 'catalog' || action === 'home' || action === 'search') {
      var query = '?q=' + encodeURIComponent(payload.query || '') + '&category=' + encodeURIComponent(payload.category || 'all') + '&sort=' + encodeURIComponent(payload.sort || 'az') + '&offset=' + Math.max(0, Number(payload.offset) || 0) + '&limit=' + Math.max(1, Math.min(120, Number(payload.limit) || 60));
      task = call('/api/catalog' + query);
    } else if (action === 'details') task = call('/api/details?url=' + encodeURIComponent(payload.url || ''));
    else if (action === 'artwork') task = artwork(payload);
    else if (action === 'play') task = startPlayer(payload);
    else task = Promise.reject(new Error('This action is unavailable.'));
    task.then(function (result) { callback(id, result); }).catch(function (error) { callback(id, { error: error.message }); if (!service) showSetup(); });
  } };
  function platformExit() {
    try { if (window.tizen && tizen.application) { tizen.application.getCurrentApplication().exit(); return; } } catch (_) {}
    if (window.PalmSystem) window.close();
  }
  function consume(event) { event.preventDefault(); event.stopImmediatePropagation(); }
  function cycle(scope, delta) {
    var buttons = Array.prototype.filter.call(scope.querySelectorAll('button,input'), function (node) { return !node.disabled && !node.hidden && node.getBoundingClientRect().width; });
    if (!buttons.length) return;
    var current = buttons.indexOf(document.activeElement); buttons[(Math.max(0, current) + delta + buttons.length) % buttons.length].focus();
  }
  window.addEventListener('keydown', function (event) {
    var key = event.keyCode || event.which, back = key === 461 || key === 10009 || key === 27 || key === 8;
    if (!setup.hidden) {
      if (key === 13 && document.activeElement === address) { document.getElementById('cw-tv-connect').click(); consume(event); }
      else if (key === 40 && document.activeElement === address) { document.getElementById('cw-tv-connect').focus(); consume(event); }
      else if (back && (key !== 8 || document.activeElement !== address)) { closeSetup(); consume(event); }
      else if (key >= 37 && key <= 40 && document.activeElement !== address) { cycle(setup, key === 37 || key === 38 ? -1 : 1); consume(event); }
      else if (key === 13 && document.activeElement !== address) { document.activeElement.click(); consume(event); }
      event.stopImmediatePropagation(); return;
    }
    if (!root.hidden) {
      consume(event);
      if (back) { closePlayer(); return; }
      if (mediaKeys[key]) { command(mediaKeys[key]); return; }
      if (key === 38) { controls.hidden = false; controls.querySelector('[data-command="toggle"]').focus(); return; }
      if (key === 40) { controls.hidden = true; (active && active.native ? nativeSurface : video).focus(); return; }
      if (key === 37 || key === 39) { if (controls.contains(document.activeElement) && !controls.hidden) cycle(controls, key === 37 ? -1 : 1); else seek(key === 37 ? -10 : 10); return; }
      if (key === 13 || key === 32) { if (controls.contains(document.activeElement) && !controls.hidden) document.activeElement.click(); else command('toggle'); }
      return;
    }
    if (back) { consume(event); if (!window.handleBack || !window.handleBack()) platformExit(); }
  }, true);
  document.addEventListener('visibilitychange', function () { if (document.hidden && !root.hidden) command('pause'); });
  try {
    if (window.tizen && tizen.tvinputdevice) tizen.tvinputdevice.getSupportedKeys().forEach(function (key) { if (/^Media(Play|Pause|PlayPause|Stop|Rewind|FastForward)$/.test(key.name)) { tizen.tvinputdevice.registerKey(key.name); var names = { MediaPlay: 'play', MediaPause: 'pause', MediaPlayPause: 'toggle', MediaStop: 'stop', MediaRewind: 'rewind', MediaFastForward: 'forward' }; mediaKeys[key.code] = names[key.name]; } });
  } catch (_) {}
  function voiceItems() {
    if (!root.hidden || !setup.hidden) return [];
    var detail = document.getElementById('detail'), scope = detail && !detail.hidden ? detail : document.getElementById('content');
    return Array.prototype.filter.call(scope.querySelectorAll('.card,.episode'), function (node) { var rect = node.getBoundingClientRect(); return rect.width && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth; });
  }
  function voiceTitle(node) { var label = node.querySelector('.card-title,.episode-label'); return (label ? label.textContent : node.textContent).trim(); }
  function voiceCommand(name) { if (!active || root.hidden) return false; command(name); return true; }
  try {
    var voice = window.webapis && webapis.voiceinteraction;
    if (voice && voice.setCallback) {
      var callbacks = {
        onupdatestate: function () { return !root.hidden ? 'Player' : !setup.hidden ? 'Setting' : 'List'; },
        onplay: function () { return voiceCommand('play'); }, onpause: function () { return voiceCommand('pause'); },
        onfastforward: function () { return voiceCommand('forward'); }, onrewind: function () { return voiceCommand('rewind'); },
        onrestart: function () { if (!active) return false; setPosition(0); return true; },
        onskipforward: function (seconds) { if (!active || !isFinite(seconds)) return false; seek(Math.abs(seconds)); return true; },
        onskipbackward: function (seconds) { if (!active || !isFinite(seconds)) return false; seek(-Math.abs(seconds)); return true; },
        onsetplayposition: function (seconds) { if (!active || !isFinite(seconds)) return false; setPosition(seconds); return true; },
        onselection: function (index) {
          if (!root.hidden || !setup.hidden) return false;
          var items = voiceItems(), selected = index === 0 ? document.activeElement.closest('.card,.episode,button') : items[index === -1 ? items.length - 1 : index - 1];
          if (!selected) return false; selected.focus(); selected.click(); return true;
        },
        onchangeappstate: function (next) {
          var route = { Home: 'home', Search: 'search', Setting: 'settings' }[next]; if (!route) return false;
          if (!root.hidden) closePlayer(); document.querySelector('[data-route="' + route + '"]').click(); return true;
        }
      };
      if (voice.buildVoiceInteractionContentContextItem && voice.buildVoiceInteractionContentContextResponse) {
        callbacks.onrequestcontentcontext = function () { return voice.buildVoiceInteractionContentContextResponse(voiceItems().map(function (node) { var rect = node.getBoundingClientRect(), title = voiceTitle(node); return voice.buildVoiceInteractionContentContextItem(Math.round(rect.left), Math.round(rect.top), title, [title], node === document.activeElement); })); };
        callbacks.ontitleselection = function (title) { if (!root.hidden || !setup.hidden) return false; var item = voiceItems().find(function (node) { return voiceTitle(node).toLowerCase() === title.trim().toLowerCase(); }); if (!item) return false; item.focus(); item.click(); return true; };
      }
      voice.setCallback(callbacks); voice.listen();
    }
  } catch (_) {}
  if (!service) setTimeout(showSetup, 0);
})();
