/* Kokoro Reader background worker: talks to the local voice server and fetches doc text.
   Only localhost voice servers and Google doc export URLs are allowed. */
'use strict';

function serverBase(server) {
  var u = new URL(server || 'http://localhost:8880');
  if (u.protocol !== 'http:' || (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1')) {
    throw new Error('Voice server must be http://localhost or http://127.0.0.1');
  }
  return u.origin;
}

function allowedTextUrl(url) {
  var u = new URL(url);
  return u.protocol === 'https:' && (u.hostname === 'docs.google.com' || u.hostname.endsWith('.googleusercontent.com'));
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  (async function () {
    try {
      if (msg.type === 'tts') {
        var r = await fetch(serverBase(msg.server) + '/dev/captioned_speech', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'kokoro', input: msg.text, voice: msg.voice, speed: 1.0,
            response_format: 'mp3', stream: false, return_timestamps: true
          })
        });
        if (!r.ok) throw new Error('Voice server error ' + r.status + ': ' + (await r.text()).slice(0, 200));
        var j = await r.json();
        sendResponse({ audio: j.audio, format: j.audio_format, timestamps: j.timestamps || [] });
      } else if (msg.type === 'voices') {
        var rv = await fetch(serverBase(msg.server) + '/v1/audio/voices');
        if (!rv.ok) throw new Error('Voice server error ' + rv.status);
        var jv = await rv.json();
        var list = (jv.voices || jv).map(function (v) { return typeof v === 'string' ? v : v.id; });
        sendResponse({ voices: list });
      } else if (msg.type === 'ping') {
        var rp = await fetch(serverBase(msg.server) + '/v1/audio/voices');
        sendResponse({ ok: rp.ok });
      } else if (msg.type === 'fetchText') {
        if (!allowedTextUrl(msg.url)) throw new Error('URL not allowed');
        var rt = await fetch(msg.url, { credentials: 'include' });
        if (!rt.ok) throw new Error('HTTP ' + rt.status);
        sendResponse({ text: await rt.text() });
      } else {
        sendResponse({ error: 'Unknown message' });
      }
    } catch (e) {
      sendResponse({ error: String((e && e.message) || e) });
    }
  })();
  return true;
});

var PAGE_FILES = ['log.js', 'lib.js', 'pagemode.js', 'content.js'];

/* Docs tabs already have the reader. On any other page it is injected on demand,
   only after the user clicks the icon or presses the shortcut (activeTab). */
function sendToActiveTab(msg) {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs || !tabs[0]) return;
    var id = tabs[0].id;
    chrome.tabs.sendMessage(id, msg, function () {
      if (!chrome.runtime.lastError) return;
      chrome.scripting.executeScript({ target: { tabId: id }, files: PAGE_FILES }, function () {
        if (chrome.runtime.lastError) return; // restricted page such as chrome:// or the Web Store
        setTimeout(function () { chrome.tabs.sendMessage(id, msg, function () { void chrome.runtime.lastError; }); }, 80);
      });
    });
  });
}

chrome.action.onClicked.addListener(function () { sendToActiveTab({ type: 'toggle-panel' }); });
chrome.commands.onCommand.addListener(function (cmd) { sendToActiveTab({ type: cmd }); });
