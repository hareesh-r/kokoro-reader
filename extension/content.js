/* Kokoro Reader content script: panel UI, document text, playback and word highlighting. */
(function () {
  'use strict';
  if (window.__krLoaded) return;
  window.__krLoaded = true;
  var KR = window.KR;
  var isDocs = location.hostname === 'docs.google.com' && /^\/document\//.test(location.pathname);
  function LOG(t, d) { if (window.KRLOG) KRLOG.add(t, d); }
  if (window.KRLOG) KRLOG.version = '0.4.0';

  var DEFAULTS = { voice: 'af_heart+af_sarah', server: 'http://localhost:8880', rate: 1, autoscroll: true, autostart: true, onpage: true, showtext: false, theme: 'orange', sentTheme: 'match', mode: null, mini: false, pos: null, miniPos: null };
  var THEMES = {
    blue:   { name: 'Blue',   word: '#7fb2ff', ring: '#2f6fe4', sent: '#d6e6ff' },
    pink:   { name: 'Pink',   word: '#ff9ccb', ring: '#e0409a', sent: '#ffdcee' },
    red:    { name: 'Red',    word: '#ff8f8f', ring: '#d9363e', sent: '#ffd9d9' },
    orange: { name: 'Orange', word: '#ff8a3d', ring: '#D35400', sent: '#ffe3c4' },
    green:  { name: 'Green',  word: '#7fdc9a', ring: '#1f9d55', sent: '#d3f5dd' },
    purple: { name: 'Purple', word: '#c4a1ff', ring: '#7c3aed', sent: '#e8dcff' }
  };
  function hexRGB(h) { h = h.replace('#', ''); return [0, 2, 4].map(function (i) { return parseInt(h.substr(i, 2), 16); }); }
  function dim(h, f) { return 'rgb(' + hexRGB(h).map(function (v) { return Math.round(v * f); }).join(',') + ')'; }
  function parseRGB(c) {
    var m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return null;
    var a = m[1].split(',').map(parseFloat); return { r: a[0], g: a[1], b: a[2], a: a.length > 3 ? a[3] : 1 };
  }
  /* Is the Google Doc itself shown in dark mode? Reads the page background; falls back to the system setting. */
  function docsDark() {
    try { if (window.KRO && KRO.docDark) { var v = KRO.docDark(); if (v !== null) return v; } } catch (e) {}
    try {
      var sels = ['.kix-page-paginated', '.kix-page', '.kix-appview-editor'];
      for (var i = 0; i < sels.length; i++) {
        var e = document.querySelector(sels[i]); if (!e) continue;
        var c = parseRGB(getComputedStyle(e).backgroundColor);
        if (c && c.a > 0.5) return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) < 110;
      }
    } catch (e) {}
    return !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function isDark() { return S.mode ? S.mode === 'dark' : docsDark(); }
  function currentTheme() {
    var t = THEMES[S.theme] || THEMES.orange;
    var sk = S.sentTheme === 'off' ? null : (THEMES[S.sentTheme] || t);
    if (docsDark()) {
      /* dark page: boxes are added to the page (screen blend), so use dim versions of the colour to keep light text readable */
      return { word: dim(t.ring, 0.72), ring: t.ring, sent: sk ? dim(sk.ring, 0.3) : null, dark: true };
    }
    return { word: t.word, ring: t.ring, sent: sk ? sk.sent : null, dark: false };
  }
  var S = Object.assign({}, DEFAULTS);
  var settingsLoaded = false, ovStatus = 'searching';

  var host = null, root = null, el = {};
  var M = null, spans = [];
  var cur = { chunk: -1, word: -1, seg: -1, times: null };
  var cache = new Map();
  var token = 0, playing = false, finished = false, busy = false, raf = 0, lastUserScroll = 0;
  var audio = new Audio();
  audio.preservesPitch = true;

  var CSS = '\
:host{all:initial}\
[hidden]{display:none!important}\
*{box-sizing:border-box}\
.panel{--ring:#D35400;--sent:#ffe3c4;width:410px;height:min(660px,calc(100vh - 96px));display:flex;flex-direction:column;background:#fffaf5;color:#2b211c;border:1px solid #f0d9c8;border-radius:14px;box-shadow:0 14px 44px rgba(0,0,0,.24);font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;overflow:hidden}\
.panel.min,.panel.notext{height:auto}\
.panel.notext .text{display:none}\
.panel.min .text,.panel.min .settings,.panel.min .paste{display:none}\
.hd{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #f0d9c8}\
.ttl{flex:1;min-width:0}\
.ttl b{display:block;font-size:14px;color:var(--ring)}\
.ttl span{display:block;font-size:12px;color:#8a7468;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\
button{font:inherit;cursor:pointer;border:1px solid #ecd2bf;background:#fff;color:inherit;border-radius:8px;padding:5px 9px}\
button:hover{background:#fff1e6}\
.ib{width:34px;height:34px;border-radius:50%;padding:0;display:inline-flex;align-items:center;justify-content:center;font-size:15px}\
.ib svg{display:block;transition:transform .2s ease;pointer-events:none}\
.panel.min #min svg{transform:rotate(180deg)}\
#gear.on{background:var(--ring);border-color:var(--ring);color:#fff}\
#gear.on svg{transform:rotate(60deg)}\
.ib#min,.ib#close,.ib#gear{width:38px;height:38px}\
.play{width:46px;height:46px;border-radius:50%;background:var(--ring);border-color:var(--ring);color:#fff;font-size:18px;padding:0}\
.play:hover{filter:brightness(.88)}\
.ctl{display:flex;align-items:center;gap:8px;padding:10px 12px 4px}\
.ctl .sp{flex:1}\
select,input[type=text]{font:inherit;padding:5px 7px;border:1px solid #ecd2bf;border-radius:8px;background:#fff;color:inherit}\
input[type=range]{width:calc(100% - 24px);margin:6px 12px 0;accent-color:var(--ring)}\
.info{padding:2px 14px 8px;font-size:12px;color:#8a7468;min-height:22px}\
.info.err{color:#C0392B}\
.sw{display:flex;gap:8px;align-items:center;flex-wrap:wrap}\
.sw{padding:3px 4px}\
.sw button{width:22px;height:22px;border-radius:50%;padding:0;border:0}\
.sw button.on{box-shadow:0 0 0 2px #fff,0 0 0 4px var(--ring)}\
.sw button.off{background:#fff;font-size:13px;line-height:1;color:#8a7468;border:1px solid #ecd2bf}\
.sw button.off.on{border:1px solid #ecd2bf}\
.vrow{display:flex;gap:8px;align-items:center;padding:2px 12px 6px}\
.vrow select{flex:1;min-width:0}\
.vrow .vl{font-size:12px;color:#8a7468}\
.blend{padding:0 12px 6px}\
.blend input{width:100%}\
.settings{padding:8px 12px;border-top:1px solid #f0d9c8;border-bottom:1px solid #f0d9c8;display:grid;gap:7px;font-size:13px;background:#fff6ee}\
.settings label{display:grid;grid-template-columns:70px 1fr;align-items:center;gap:8px}\
.settings .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}\
.settings .chk{display:flex;gap:6px;align-items:center}\
.text{flex:1;overflow:auto;padding:12px 16px 40px;font-size:15.5px;line-height:1.75;user-select:text}\
.text p{margin:0 0 .85em}\
.w{border-radius:4px;cursor:pointer}\
.w:hover{background:var(--sent)}\
.w.cs{background:var(--sent)}\
.w.cw{background:var(--ring);color:#fff;box-shadow:0 0 0 2px var(--ring)}\
.paste{padding:10px 12px;display:grid;gap:8px}\
.paste textarea{width:100%;min-height:110px;font:inherit;padding:8px;border:1px solid #ecd2bf;border-radius:8px;background:#fff;color:inherit}\
.hd{cursor:grab}.hd button,.hd select{cursor:pointer}\
.hd .ib{width:36px;height:36px}\
.mini{--ring:#D35400;display:flex;align-items:center;gap:6px;padding:5px 6px 5px 5px;background:#fffaf5;color:#2b211c;border:1px solid #f0d9c8;border-radius:32px;box-shadow:0 8px 26px rgba(0,0,0,.28);cursor:grab;touch-action:none;user-select:none;font:14px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}\
.mini .mp{width:40px;height:40px;border-radius:50%;background:var(--ring);border-color:var(--ring);color:#fff;font-size:16px;padding:0}\
.mini .me{width:32px;height:32px;border-radius:50%;padding:0;display:inline-flex;align-items:center;justify-content:center}\
.mini svg{display:block;pointer-events:none}\
\
:where(.dark) .sw button.on{box-shadow:0 0 0 2px #201a17,0 0 0 4px var(--ring)}\
:where(.dark) .sw button.off{background:#2e2622}\
:where(.dark) .vrow .vl{color:#b7a69c}\
:where(.dark) .w.cs,:where(.dark) .w:hover{filter:brightness(.55) saturate(1.2)}\
.panel.dark{background:#201a17;color:#f3ebe6;border-color:#3b312c}\
:where(.dark) .hd{border-color:#3b312c}:where(.dark) .settings{background:#28211d;border-color:#3b312c}\
:where(.dark) button,:where(.dark) select,:where(.dark) input[type=text],:where(.dark) .paste textarea{background:#2e2622;border-color:#4a3d36;color:#f3ebe6}\
:where(.dark) button:hover{background:#3a2f29}\
:where(.dark) .ttl span,:where(.dark) .info{color:#b7a69c}\
.mini.dark{background:#201a17;border-color:#3b312c}\
#mode svg.sun{display:none}\
.dark #mode svg.sun{display:block}.dark #mode svg.moon{display:none}\
}';

  var HTML = '\
<div class="panel" id="panel">\
 <div class="hd"><div class="ttl"><b>Kokoro Reader v0.4.0</b><span id="doctitle"></span></div>\
  <button class="ib" id="mode" title="Switch theme"><svg class="sun" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg><svg class="moon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></button><button class="ib" id="shrink" title="Shrink to a small button"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/></svg></button><button class="ib" id="min" title="Collapse panel"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9l7 7 7-7"/></svg></button><button class="ib" id="close" title="Close"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>\
 <div class="ctl">\
  <button class="ib" id="prev" title="Previous sentence"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6 5h2.5v14H6zM20 5v14L9.5 12z"/></svg></button>\
  <button class="play" id="play" title="Play / pause (Alt+Shift+P)">▶</button>\
  <button class="ib" id="next" title="Next sentence"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M15.5 5H18v14h-2.5zM4 5v14l10.5-7z"/></svg></button>\
  <span class="sp"></span>\
  <select id="rate" title="Speed"></select>\
  <button class="ib" id="gear" title="Settings"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></button>\
 </div>\
 <input type="range" id="prog" min="0" max="0" value="0">\
 <div class="vrow"><span class="vl">Voice</span><select id="voicesel" title="Voice"></select><button id="vprev" title="Hear this voice">Preview</button></div>\
 <div class="blend" id="blendrow" hidden><input type="text" id="voice" spellcheck="false" placeholder="af_heart+af_sarah (voices joined with +)"></div>\
 <div class="info" id="info">Ready</div>\
 <div class="settings" id="settings" hidden>\
  <label>Highlight <span class="sw" id="swtheme"></span></label>\
  <label>Sentence <span class="sw" id="swsent"></span></label>\
  <label>Server <input type="text" id="server" spellcheck="false"></label>\
  <div class="row"><span class="chk"><input type="checkbox" id="autoscroll"><label style="display:inline">Auto-scroll</label></span>\
   <span class="chk"><input type="checkbox" id="autostart"><label style="display:inline">Start when opened</label></span></div>\
  <div class="row"><span class="chk"><input type="checkbox" id="onpage"><label style="display:inline">Highlight on the page</label></span>\
   <span class="chk"><input type="checkbox" id="showtext"><label style="display:inline">Show text in panel</label></span></div>\
  <div class="row"><button id="reload">Reload document text</button><button id="check">Check server</button><button id="diag">Check page match</button><button id="dbg">Copy debug report</button></div>\
 </div>\
 <div class="paste" id="paste" hidden><div id="pastemsg" class="info err"></div>\
  <textarea id="pastebox" placeholder="Paste the text you want read here"></textarea><button id="pastego">Read this text</button></div>\
 <div class="text" id="text"></div>\
</div>\
<div class="mini" id="mini" hidden><button class="mp" id="mplay" title="Play / pause">▶</button><button class="me" id="mexp" title="Open Kokoro Reader"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg></button></div>';

  /* ---------- helpers ---------- */
  function bg(msg) {
    return new Promise(function (resolve, reject) {
      try {
        chrome.runtime.sendMessage(msg, function (r) {
          var err = chrome.runtime.lastError;
          if (err) return reject(new Error(err.message));
          if (!r) return reject(new Error('No response from the extension background'));
          if (r.error) return reject(new Error(r.error));
          resolve(r);
        });
      } catch (e) { reject(e); }
    });
  }
  function b64ToBlob(b64, type) {
    var bin = atob(b64), n = bin.length, u = new Uint8Array(n);
    for (var i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
    var mime = !type ? 'audio/mpeg' : (type.indexOf('/') > 0 ? type : 'audio/' + (type === 'mp3' ? 'mpeg' : type));
    return new Blob([u], { type: mime });
  }
  function audioDuration(url) {
    return new Promise(function (res) {
      var a = new Audio(), done = false;
      function fin(v) { if (!done) { done = true; res(v); } }
      a.preload = 'metadata';
      a.onloadedmetadata = function () { fin(isFinite(a.duration) ? a.duration : null); };
      a.onerror = function () { fin(null); };
      setTimeout(function () { fin(null); }, 2500);
      a.src = url;
    });
  }
  function loadSettings() {
    return new Promise(function (res) {
      try {
        chrome.storage.local.get(DEFAULTS, function (v) { S = Object.assign({}, DEFAULTS, v || {}); settingsLoaded = true; res(); });
      } catch (e) { res(); }
    });
  }
  function saveSettings() { try { chrome.storage.local.set(S); } catch (e) {} }

  /* ---------- panel ---------- */
  function buildPanel() {
    host = document.createElement('div');
    host.id = 'kokoro-reader-host';
    host.style.cssText = 'all:initial;position:fixed;top:64px;right:16px;z-index:2147483646;';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>' + CSS + '</style>' + HTML;
    document.documentElement.appendChild(host);
    ['panel', 'mini', 'mplay', 'mexp', 'mode', 'shrink', 'doctitle', 'min', 'close', 'prev', 'play', 'next', 'rate', 'gear', 'prog', 'info', 'settings', 'voice', 'voicesel', 'vprev', 'blendrow', 'swtheme', 'swsent',
      'server', 'autoscroll', 'autostart', 'onpage', 'showtext', 'reload', 'check', 'diag', 'dbg', 'paste', 'pastemsg', 'pastebox', 'pastego', 'text'].forEach(function (id) {
      el[id] = root.getElementById(id);
    });
    [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3].forEach(function (r) {
      var o = document.createElement('option'); o.value = String(r); o.textContent = String(r) + 'x'; el.rate.appendChild(o);
    });
    ['keydown', 'keyup', 'keypress'].forEach(function (t) { host.addEventListener(t, function (e) { e.stopPropagation(); }); });
    host.addEventListener('keydown', onPanelKey);

    el.close.onclick = closePanel;
    el.min.onclick = function () { var m = el.panel.classList.toggle('min'); el.min.title = m ? 'Expand panel' : 'Collapse panel'; };
    el.play.onclick = toggle;
    el.mplay.onclick = toggle;
    el.mode.onclick = function () { S.mode = isDark() ? 'light' : 'dark'; saveSettings(); applyMode(); LOG('mode', { mode: S.mode }); };
    el.shrink.onclick = function () { setMini(true); };
    el.mexp.onclick = function () { setMini(false); };
    makeDraggable(el.panel.querySelector('.hd'), true);
    makeDraggable(el.mini, false);
    window.addEventListener('resize', function () { if (host && host.style.left) { var r = host.getBoundingClientRect(); placeHost(r.left, r.top, true); } });
    var lastPD = null;
    setInterval(function () { if (!host) return; var pd = docsDark(); if (pd !== lastPD) { lastPD = pd; applyMode(); } else if (!S.mode && isDark() !== el.panel.classList.contains('dark')) applyMode(); }, 2000);
    el.prev.onclick = function () { jumpSeg(-1); };
    el.next.onclick = function () { jumpSeg(1); };
    el.gear.onclick = function () { el.settings.hidden = !el.settings.hidden; el.gear.classList.toggle('on', !el.settings.hidden); };
    el.rate.onchange = function () { S.rate = parseFloat(el.rate.value) || 1; audio.defaultPlaybackRate = S.rate; audio.playbackRate = S.rate; saveSettings(); updateInfo(); };
    el.voice.onchange = function () { S.voice = el.voice.value.trim() || DEFAULTS.voice; el.voice.value = S.voice; saveSettings(); syncVoiceSel(); voiceChanged(); };
    el.voicesel.onchange = function () {
      if (el.voicesel.value === '__custom__') { el.blendrow.hidden = false; el.voice.focus(); return; }
      S.voice = el.voicesel.value; el.voice.value = S.voice; el.blendrow.hidden = true; saveSettings(); voiceChanged();
    };
    el.vprev.onclick = previewVoice;
    buildSwatches();
    el.server.onchange = function () { S.server = el.server.value.trim() || DEFAULTS.server; el.server.value = S.server; saveSettings(); voicesLoaded = false; fillVoices(); voiceChanged(); };
    el.autoscroll.onchange = function () { S.autoscroll = el.autoscroll.checked; saveSettings(); if (window.KRO) KRO.setAutoscroll(S.autoscroll); };
    el.onpage.onchange = function () { S.onpage = el.onpage.checked; saveSettings(); if (S.onpage) attachOverlay(); else if (window.KRO) KRO.detach(); applyTextVis(); updateInfo(); };
    el.showtext.onchange = function () { S.showtext = el.showtext.checked; saveSettings(); applyTextVis(); };
    el.autostart.onchange = function () { S.autostart = el.autostart.checked; saveSettings(); };
    el.reload.onclick = function () { loadText(); };
    el.dbg.onclick = copyReport;
    el.diag.onclick = function () { setInfo(window.KRO ? KRO.diagnose() : 'Overlay script missing'); };
    el.check.onclick = function () {
      setInfo('Checking server...');
      bg({ type: 'ping', server: S.server }).then(function (r) { setInfo(r.ok ? 'Voice server is running.' : 'Server answered with an error.', !r.ok); })
        .catch(function (e) { showError(e); });
    };
    el.prog.onchange = function () { if (M) seekToWord(parseInt(el.prog.value, 10) || 0, true); };
    el.pastego.onclick = function () { var t = el.pastebox.value; if (t.trim()) { el.paste.hidden = true; setModel(t); } };
    el.text.addEventListener('click', function (e) {
      var s = e.target.closest ? e.target.closest('.w') : null;
      if (s && M) seekToWord(parseInt(s.dataset.i, 10), true);
    });
    ['wheel', 'touchmove'].forEach(function (t) { el.text.addEventListener(t, function () { lastUserScroll = Date.now(); }, { passive: true }); });
    applySettingsToUI(); fillVoices();
  }

  function applySettingsToUI() {
    if (!host) return;
    el.voice.value = S.voice; el.server.value = S.server;
    el.autoscroll.checked = !!S.autoscroll; el.autostart.checked = !!S.autostart; el.onpage.checked = !!S.onpage; el.showtext.checked = !!S.showtext;
    applyTextVis(); applyMode(); applyMini(); syncVoiceSel();
    el.rate.value = String(S.rate);
    if (el.rate.value !== String(S.rate)) { el.rate.value = '1'; S.rate = 1; }
    audio.defaultPlaybackRate = S.rate; audio.playbackRate = S.rate;
  }

  var voiceIds = [], voicesLoaded = false, previewAudio = null;
  var GROUPS = [['af_', 'American, female'], ['am_', 'American, male'], ['bf_', 'British, female'], ['bm_', 'British, male'],
    ['ef_', 'Spanish'], ['em_', 'Spanish'], ['ff_', 'French'], ['hf_', 'Hindi'], ['hm_', 'Hindi'], ['if_', 'Italian'], ['im_', 'Italian'],
    ['jf_', 'Japanese'], ['jm_', 'Japanese'], ['pf_', 'Portuguese'], ['pm_', 'Portuguese'], ['zf_', 'Chinese'], ['zm_', 'Chinese']];
  function prettyVoice(v) { var n = v.replace(/^[a-z]{2}_/, ''); return n.charAt(0).toUpperCase() + n.slice(1); }
  function fillVoices() {
    if (!host || voicesLoaded) return;
    bg({ type: 'voices', server: S.server }).then(function (r) {
      voiceIds = (r.voices || []).slice().sort(); voicesLoaded = true; buildVoiceSel();
    }).catch(function () { voiceIds = []; buildVoiceSel(); });
  }
  function buildVoiceSel() {
    var sel = el.voicesel; sel.textContent = '';
    function opt(parent, v, label) { var o = document.createElement('option'); o.value = v; o.textContent = label; parent.appendChild(o); return o; }
    var rec = document.createElement('optgroup'); rec.label = 'Recommended';
    opt(rec, DEFAULTS.voice, 'Heart + Sarah blend (default)');
    sel.appendChild(rec);
    var byGroup = {}, order = [];
    voiceIds.forEach(function (v) {
      var g = 'Other';
      for (var k = 0; k < GROUPS.length; k++) if (v.indexOf(GROUPS[k][0]) === 0) { g = GROUPS[k][1]; break; }
      if (!byGroup[g]) { byGroup[g] = []; order.push(g); }
      byGroup[g].push(v);
    });
    order.forEach(function (g) {
      var og = document.createElement('optgroup'); og.label = g;
      byGroup[g].forEach(function (v) { opt(og, v, prettyVoice(v)); });
      sel.appendChild(og);
    });
    var cu = document.createElement('optgroup'); cu.label = 'Advanced';
    opt(cu, '__custom__', 'Custom blend...');
    sel.appendChild(cu);
    syncVoiceSel();
  }
  function syncVoiceSel() {
    if (!host) return;
    var sel = el.voicesel, found = false;
    for (var i = 0; i < sel.options.length; i++) if (sel.options[i].value === S.voice) { found = true; break; }
    if (found) { sel.value = S.voice; el.blendrow.hidden = true; }
    else { sel.value = '__custom__'; el.blendrow.hidden = false; }
    el.voice.value = S.voice;
  }
  function previewVoice() {
    var v = el.voicesel.value === '__custom__' ? (el.voice.value.trim() || S.voice) : el.voicesel.value;
    el.vprev.disabled = true; el.vprev.textContent = '...';
    bg({ type: 'tts', server: S.server, voice: v, text: 'Hi, this is how I sound when I read your document aloud.' }).then(function (r) {
      if (previewAudio) { previewAudio.pause(); }
      previewAudio = new Audio(URL.createObjectURL(b64ToBlob(r.audio, r.format)));
      previewAudio.playbackRate = S.rate;
      return previewAudio.play();
    }).catch(function (e) { showError(e); }).then(function () { el.vprev.disabled = false; el.vprev.textContent = 'Preview'; });
  }

  /* ---------- themes ---------- */
  function buildSwatches() {
    function mk(container, key, withExtras) {
      container.textContent = '';
      if (withExtras) {
        var m = document.createElement('button'); m.className = 'off'; m.dataset.v = 'match'; m.title = 'Same as highlight'; m.textContent = '='; container.appendChild(m);
        var f = document.createElement('button'); f.className = 'off'; f.dataset.v = 'off'; f.title = 'No sentence highlight'; f.textContent = '×'; container.appendChild(f);
      }
      Object.keys(THEMES).forEach(function (k) {
        var b = document.createElement('button'); b.dataset.v = k; b.title = THEMES[k].name; b.style.background = THEMES[k].ring; container.appendChild(b);
      });
      container.onclick = function (e) {
        var b = e.target.closest ? e.target.closest('button') : null; if (!b) return;
        S[key] = b.dataset.v; saveSettings(); applyTheme();
      };
    }
    mk(el.swtheme, 'theme', false); mk(el.swsent, 'sentTheme', true);
  }
  function applyMode() {
    if (!host) return;
    var d = isDark();
    el.panel.classList.toggle('dark', d); el.mini.classList.toggle('dark', d);
    el.mode.title = d ? 'Switch to light mode' : 'Switch to dark mode';
    applyTheme();
  }
  /* ---------- small button mode and dragging ---------- */
  function placeHost(x, y, nosave) {
    var r = host.getBoundingClientRect();
    x = Math.min(Math.max(4, x), Math.max(4, window.innerWidth - r.width - 4));
    y = Math.min(Math.max(4, y), Math.max(4, window.innerHeight - r.height - 4));
    host.style.left = x + 'px'; host.style.top = y + 'px'; host.style.right = 'auto';
    if (!nosave) { S[S.mini ? 'miniPos' : 'pos'] = { x: Math.round(x), y: Math.round(y) }; saveSettings(); }
  }
  function applyMini() {
    el.panel.hidden = !!S.mini; el.mini.hidden = !S.mini;
    var pos = S.mini ? S.miniPos : S.pos;
    if (pos && typeof pos.x === 'number') placeHost(pos.x, pos.y, true);
  }
  function setMini(on) {
    var r = host.getBoundingClientRect();
    S.mini = !!on; el.panel.hidden = !!on; el.mini.hidden = !on;
    var r2 = host.getBoundingClientRect();
    placeHost(r.right - r2.width, r.top);
    saveSettings(); LOG('mini', { on: !!on });
  }
  var lastDrag = 0;
  function makeDraggable(handle, skipControls) {
    handle.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      if (skipControls && e.target.closest && e.target.closest('button,select,input')) return;
      var r = host.getBoundingClientRect(), sx = e.clientX, sy = e.clientY, moved = false;
      function mv(ev) {
        var dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 5) return;
        moved = true; ev.preventDefault(); placeHost(r.left + dx, r.top + dy, true);
      }
      function up() {
        window.removeEventListener('pointermove', mv, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up, true);
        if (moved) { lastDrag = Date.now(); var b = host.getBoundingClientRect(); placeHost(b.left, b.top); }
      }
      window.addEventListener('pointermove', mv, true); window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', up, true);
    });
    handle.addEventListener('click', function (e) { if (Date.now() - lastDrag < 300) { e.stopPropagation(); e.preventDefault(); } }, true);
  }
  function applyTheme() {
    if (!host) return;
    var t = currentTheme(), base = THEMES[S.theme] || THEMES.orange;
    LOG('theme-change', { theme: S.theme, sentence: S.sentTheme, playing: playing, word: cur.word });
    el.panel.style.setProperty('--ring', base.ring); el.mini.style.setProperty('--ring', base.ring);
    el.panel.style.setProperty('--sent', t.sent || 'transparent');
    [[el.swtheme, S.theme], [el.swsent, S.sentTheme]].forEach(function (p) {
      Array.prototype.forEach.call(p[0].children, function (b) { b.classList.toggle('on', b.dataset.v === p[1]); });
    });
    if (window.KRO && KRO.setTheme) KRO.setTheme(t);
  }

  function copyReport() {
    var extra = { settings: { voice: S.voice, rate: S.rate, theme: S.theme, sentence: S.sentTheme, onpage: S.onpage, autoscroll: S.autoscroll },
      state: { words: M && M.words.length, chunks: M && M.chunks.length, word: cur.word, playing: playing, overlay: ovStatus } };
    try { if (window.KRO) { extra.snapshot = KRO.snapshot(); extra.diagnose = KRO.diagnose(); } } catch (e) { extra.snapshotError = String(e); }
    var text = KRLOG.report(extra);
    function done(ok) { setInfo(ok ? 'Debug report copied (' + text.split('\n').length + ' lines). Paste it to Claude.' : 'Could not copy. Select the text in the box below and copy it.', !ok); if (!ok) showReportBox(text); }
    try {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { fallbackCopy(text, done); });
    } catch (e) { fallbackCopy(text, done); }
  }
  function fallbackCopy(text, done) {
    try {
      var ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      root.appendChild(ta); ta.select(); var ok = document.execCommand('copy'); ta.remove(); done(ok);
    } catch (e) { done(false); }
  }
  function showReportBox(text) { el.paste.hidden = false; el.pastemsg.textContent = 'Debug report (select all and copy)'; el.pastebox.value = text; }

  function textVisible() { return !S.onpage || S.showtext || ovStatus === 'failed'; }
  function applyTextVis() { if (host) el.panel.classList.toggle('notext', !textVisible()); }
  function onOverlayStatus(st) { ovStatus = st; applyTextVis(); updateInfo(); }
  function attachOverlay() {
    if (!S.onpage || !M || !window.KRO) return;
    ovStatus = 'searching';
    if (KRO.setTheme) KRO.setTheme(currentTheme());
    KRO.attach({ getModel: function () { return M; }, onSeek: function (i) { seekToWord(i, true); }, onStatus: onOverlayStatus });
    if (cur.word >= 0) KRO.setWord(cur.word, M.segs[cur.seg] ? M.segs[cur.seg].w0 : cur.word, M.segs[cur.seg] ? M.segs[cur.seg].w1 : cur.word + 1, S.autoscroll);
  }

  function panelOpen() { return !!host && host.style.display !== 'none'; }
  function docTitle() { return (document.title || (isDocs ? 'Document' : location.hostname)).replace(/ - Google Docs$/, ''); }

  async function openPanel(forceStart) {
    if (!settingsLoaded) await loadSettings();
    if (!host) buildPanel(); else { host.style.display = ''; applySettingsToUI(); }
    el.doctitle.textContent = docTitle();
    setupMediaSession();
    if (M) attachOverlay();
    if (!M) {
      var ok = await loadText();
      if (ok && (forceStart || S.autostart)) toggle();
    } else if (forceStart && !playing) toggle();
  }
  function closePanel() {
    token++; playing = false; audio.pause(); cancelAnimationFrame(raf); updatePlayBtn();
    if (window.KRO) KRO.detach();
    if (host) host.style.display = 'none';
  }

  function setInfo(msg, isErr) { if (!host) return; el.info.textContent = msg; el.info.classList.toggle('err', !!isErr); }
  function showError(e) {
    var m = String((e && e.message) || e);
    LOG('ERROR', { where: 'panel', msg: m });
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) m = 'Voice server not reachable at ' + S.server + '. It should start at login. Open ' + S.server + '/web to check.';
    setInfo(m, true);
  }
  function setBusy(b, msg) { busy = b; if (b) setInfo(msg || 'Working...'); else updateInfo(); }
  function updatePlayBtn() { if (host) { el.play.textContent = playing ? '⏸' : '▶'; el.mplay.textContent = playing ? '⏸' : '▶'; } }
  function updateInfo() {
    if (!host || !M || busy) return;
    var w = Math.max(0, cur.word), rem = M.words.length - w;
    var mins = Math.max(1, Math.round(rem / (165 * S.rate)));
    var extra = '';
    if (S.onpage) extra = ovStatus === 'searching' ? '  ·  matching the page...' : (ovStatus === 'failed' ? '  ·  could not match the page, text shown here' : '');
    setInfo('Word ' + (w + 1) + ' of ' + M.words.length + '  ·  about ' + mins + ' min left' + extra);
  }

  /* ---------- document text ---------- */
  async function fetchDocText() {
    var m = location.pathname.match(/^(\/document(?:\/u\/\d+)?\/d\/[^/]+)/);
    if (!m) throw new Error('This page is not a Google Doc.');
    var tab = new URLSearchParams(location.search).get('tab');
    var url = location.origin + m[1] + '/export?format=txt' + (tab ? '&tab=' + encodeURIComponent(tab) : '');
    var text = null;
    try {
      var r = await fetch(url, { credentials: 'include' });
      if (r.ok) text = await r.text();
    } catch (e) { /* fall through to background fetch */ }
    if (text === null) text = (await bg({ type: 'fetchText', url: url })).text;
    if (/^\s*<(!doctype|html)/i.test(text)) throw new Error('Google returned a web page instead of the text. The owner may have disabled downloads for this doc.');
    return text;
  }

  async function loadText() {
    setBusy(false); setInfo(isDocs ? 'Reading document text...' : 'Reading this page...');
    var raw;
    try {
      if (isDocs) raw = await fetchDocText();
      else {
        if (!window.KRP) throw new Error('Page reader missing.');
        var ex = KRP.extract();
        raw = ex.text;
        if (host) el.doctitle.textContent = docTitle() + (ex.mode === 'selection' ? '  ·  selected text' : '');
      }
    }
    catch (e) {
      el.pastemsg.textContent = String(e.message || e) + ' Paste the text below instead.';
      el.paste.hidden = false;
      setInfo('Could not read the document automatically.', true);
      return false;
    }
    el.paste.hidden = true;
    return setModel(raw);
  }

  function setModel(raw) {
    token++; playing = false; finished = false; audio.pause(); audio.removeAttribute('src'); cancelAnimationFrame(raf);
    clearCache();
    cur = { chunk: -1, word: -1, seg: -1, times: null };
    M = KR.buildModel(raw);
    updatePlayBtn();
    if (window.KRO) KRO.detach();
    if (!M.words.length) { el.text.textContent = ''; setInfo(isDocs ? 'This document has no text to read.' : 'No readable text found on this page. Select some text and press Alt+Shift+L.', true); return false; }
    renderText();
    el.prog.max = String(M.words.length - 1); el.prog.value = '0';
    attachOverlay();
    updateInfo();
    return true;
  }

  function renderText() {
    el.text.textContent = '';
    spans = new Array(M.words.length);
    var frag = document.createDocumentFragment();
    M.paras.forEach(function (pa) {
      var p = document.createElement('p');
      for (var i = pa.w0; i < pa.w1; i++) {
        var s = document.createElement('span');
        s.className = 'w'; s.dataset.i = String(i); s.textContent = M.words[i].t + ' ';
        spans[i] = s; p.appendChild(s);
      }
      frag.appendChild(p);
    });
    el.text.appendChild(frag);
  }

  /* ---------- audio generation and cache ---------- */
  function clearCache() {
    cache.forEach(function (p) { p.then(function (d) { if (d && d.url) URL.revokeObjectURL(d.url); }).catch(function () {}); });
    cache.clear();
  }
  function load(idx) {
    if (idx < 0 || idx >= M.chunks.length) return null;
    if (cache.has(idx)) return cache.get(idx);
    var c = M.chunks[idx];
    var p = (async function () {
      if (!c.text.trim()) return { url: null, times: M.words.slice(c.w0, c.w1).map(function () { return { s: 0, e: 0 }; }), dur: 0 };
      var r = await bg({ type: 'tts', server: S.server, voice: S.voice, text: c.text });
      var url = URL.createObjectURL(b64ToBlob(r.audio, r.format));
      var ts = r.timestamps || [], dur;
      if (ts.length) dur = ts[ts.length - 1].end_time + 0.3; else dur = (await audioDuration(url)) || 0;
      return { url: url, times: KR.alignWords(M.words, c.w0, c.w1, ts, dur), dur: dur };
    })();
    p.catch(function () { if (cache.get(idx) === p) cache.delete(idx); });
    cache.set(idx, p);
    return p;
  }
  function prefetch(i) { var p = load(i); if (p) p.catch(function () {}); }
  function evict(k) {
    cache.forEach(function (p, i) {
      if (Math.abs(i - k) > 4) { cache.delete(i); p.then(function (d) { if (d && d.url) URL.revokeObjectURL(d.url); }).catch(function () {}); }
    });
  }
  function voiceChanged() { LOG('voice-change', { voice: S.voice, playing: playing, word: cur.word });
    if (!M) return;
    var w = Math.max(0, cur.word), wasPlaying = playing;
    token++; audio.pause(); audio.removeAttribute('src'); cur.times = null; clearCache();
    if (wasPlaying) startFrom(w); else { playing = false; updatePlayBtn(); }
  }

  /* ---------- playback ---------- */
  function chunkOfWord(i) {
    var lo = 0, hi = M.chunks.length - 1;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (M.chunks[mid].w1 <= i) lo = mid + 1; else hi = mid; }
    return lo;
  }
  function playFail(e) {
    playing = false; updatePlayBtn();
    if (e && e.name === 'NotAllowedError') setInfo('Chrome blocked autoplay. Press the play button.', true); else showError(e);
  }
  function startTick() { cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); }
  function tick() { if (!playing) return; paint(); raf = requestAnimationFrame(tick); }

  function paint() {
    var times = cur.times; if (!times || cur.chunk < 0 || !times.length) return;
    var t = audio.currentTime, lo = 0, hi = times.length - 1, k = 0;
    while (lo <= hi) { var mid = (lo + hi) >> 1; if (times[mid].s <= t + 0.001) { k = mid; lo = mid + 1; } else hi = mid - 1; }
    setCurrentWord(M.chunks[cur.chunk].w0 + k);
  }
  function setCurrentWord(i) {
    if (i === cur.word) return;
    var old = spans[cur.word]; if (old) old.classList.remove('cw');
    var sp = spans[i]; if (!sp) return;
    sp.classList.add('cw');
    var seg = M.words[i].seg;
    if (seg !== cur.seg) { paintSeg(cur.seg, false); paintSeg(seg, true); cur.seg = seg; }
    cur.word = i;
    if (S.onpage && window.KRO && M.segs[seg]) KRO.setWord(i, M.segs[seg].w0, M.segs[seg].w1, S.autoscroll);
    if (S.autoscroll && textVisible()) ensureVisible(sp);
    el.prog.value = String(i);
    updateInfo();
  }
  function paintSeg(si, on) {
    if (si < 0 || !M.segs[si]) return;
    var sg = M.segs[si];
    for (var k = sg.w0; k < sg.w1; k++) spans[k].classList[on ? 'add' : 'remove']('cs');
  }
  function ensureVisible(sp) {
    if (Date.now() - lastUserScroll < 2500) return;
    var box = el.text.getBoundingClientRect(), r = sp.getBoundingClientRect(), margin = box.height * 0.22;
    if (r.top < box.top + margin || r.bottom > box.bottom - margin) {
      el.text.scrollTo({ top: el.text.scrollTop + (r.top - box.top) - box.height * 0.36, behavior: 'smooth' });
    }
  }

  async function playChunk(idx, startWord, autoplay) {
    if (autoplay === undefined) autoplay = true;
    var my = ++token;
    if (idx >= M.chunks.length) { finish(); return; }
    setBusy(true, 'Generating voice...');
    var d;
    try { d = await load(idx); }
    catch (e) { if (my === token) { setBusy(false); playing = false; updatePlayBtn(); showError(e); } return; }
    if (my !== token) return;
    setBusy(false);
    var c = M.chunks[idx];
    cur.chunk = idx; cur.times = d.times;
    if (!d.url) { if (autoplay) { playChunk(idx + 1, null, true); } return; }
    var startT = startWord != null ? d.times[startWord - c.w0].s : 0;
    await new Promise(function (res) {
      var t = setTimeout(res, 3000);
      audio.onloadedmetadata = function () { clearTimeout(t); res(); };
      audio.src = d.url;
    });
    if (my !== token) return;
    audio.defaultPlaybackRate = S.rate; audio.playbackRate = S.rate; audio.preservesPitch = true;
    if (startT > 0) audio.currentTime = Math.max(0, startT - 0.02);
    audio.onended = function () { if (my === token && playing) playChunk(idx + 1, null, true); };
    paint();
    if (autoplay) {
      try { await audio.play(); } catch (e) { if (my === token) playFail(e); return; }
      if (my !== token) return;
      startTick();
    }
    evict(idx); prefetch(idx + 1); prefetch(idx + 2);
  }

  function startFrom(word) { LOG('start', { word: word, rate: S.rate, voice: S.voice }); playing = true; finished = false; updatePlayBtn(); startTick(); playChunk(chunkOfWord(word), word, true); }
  function finish() { playing = false; finished = true; updatePlayBtn(); setInfo('Finished reading.'); }

  function toggle() { LOG('toggle', { wasPlaying: playing });
    if (!M || !M.words.length) return;
    if (playing) { playing = false; audio.pause(); updatePlayBtn(); return; }
    if (finished) { startFrom(0); return; }
    playing = true; updatePlayBtn();
    if (cur.times && audio.getAttribute('src') && cur.chunk >= 0 && !audio.ended) {
      audio.play().then(startTick).catch(playFail);
    } else startFrom(cur.word >= 0 ? cur.word : 0);
  }

  function seekToWord(i, autoplay) { LOG('seek', { word: i });
    i = Math.max(0, Math.min(M.words.length - 1, i));
    var ci = chunkOfWord(i);
    finished = false;
    if (ci === cur.chunk && cur.times && audio.getAttribute('src')) {
      audio.currentTime = cur.times[i - M.chunks[ci].w0].s + 0.001;
      paint();
      if (autoplay && audio.paused) { playing = true; updatePlayBtn(); audio.play().then(startTick).catch(playFail); }
      return;
    }
    playing = !!autoplay; updatePlayBtn(); if (autoplay) startTick();
    playChunk(ci, i, !!autoplay);
  }

  function jumpSeg(delta) {
    if (!M) return;
    var w = Math.max(0, cur.word), si = M.words[w].seg, target;
    if (delta < 0) {
      var segStart = M.segs[si].w0, elapsed = 0;
      if (cur.times && cur.chunk >= 0 && chunkOfWord(segStart) === cur.chunk) {
        elapsed = audio.currentTime - cur.times[segStart - M.chunks[cur.chunk].w0].s;
      }
      target = elapsed > 1.2 ? segStart : M.segs[Math.max(0, si - 1)].w0;
    } else target = M.segs[Math.min(M.segs.length - 1, si + 1)].w0;
    seekToWord(target, true);
  }

  function onPanelKey(e) {
    var tag = (e.composedPath()[0] || {}).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); jumpSeg(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); jumpSeg(-1); }
  }

  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: docTitle(), artist: 'Kokoro Reader' });
      navigator.mediaSession.setActionHandler('play', function () { if (!playing) toggle(); });
      navigator.mediaSession.setActionHandler('pause', function () { if (playing) toggle(); });
      navigator.mediaSession.setActionHandler('nexttrack', function () { jumpSeg(1); });
      navigator.mediaSession.setActionHandler('previoustrack', function () { jumpSeg(-1); });
    } catch (e) { /* not supported */ }
  }

  /* ---------- messages from the toolbar button and shortcuts ---------- */
  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg) return;
    if (msg.type === 'toggle-panel') { if (panelOpen()) closePanel(); else openPanel(false); }
    else if (msg.type === 'play-pause') { if (!panelOpen()) openPanel(true); else toggle(); }
  });


  window.__krTest = { openPanel: openPanel, seek: function (i) { seekToWord(i, true); }, kro: function () { return window.KRO && KRO.debug(); }, state: function () { return { cur: cur, playing: playing, words: M && M.words.length, chunks: M && M.chunks.length }; } };
})();
