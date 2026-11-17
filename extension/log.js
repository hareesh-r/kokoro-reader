/* Kokoro Reader debug log: keeps the last events in memory so a problem can be copied and pasted into a bug report. */
(function (g) {
  'use strict';
  var BUF = [], MAX = 600, T0 = Date.now(), counts = {};
  var KRLOG = {
    version: '',
    add: function (type, data) {
      try {
        counts[type] = (counts[type] || 0) + 1;
        BUF.push({ t: Date.now() - T0, type: type, d: data });
        if (BUF.length > MAX) BUF.shift();
      } catch (e) {}
    },
    err: function (where, e) {
      KRLOG.add('ERROR', { where: where, msg: String((e && e.message) || e), stack: String((e && e.stack) || '').split('\n').slice(0, 4).join(' | ') });
    },
    counts: function () { return counts; },
    clear: function () { BUF.length = 0; counts = {}; },
    report: function (extra) {
      var L = [];
      L.push('Kokoro Reader debug report v' + KRLOG.version);
      L.push('time: ' + new Date().toISOString());
      L.push('url: ' + location.origin + location.pathname.replace(/(\/d\/)([^/]{6})[^/]*/, '$1$2...'));
      L.push('browser: ' + navigator.userAgent);
      L.push('screen: ' + screen.width + 'x' + screen.height + ', window ' + innerWidth + 'x' + innerHeight + ', devicePixelRatio ' + devicePixelRatio);
      L.push('event counts: ' + JSON.stringify(counts));
      if (extra) Object.keys(extra).forEach(function (k) { L.push(k + ': ' + (typeof extra[k] === 'string' ? extra[k] : JSON.stringify(extra[k]))); });
      L.push('--- last events (time in seconds since the page loaded) ---');
      BUF.slice(-300).forEach(function (e) { L.push('+' + (e.t / 1000).toFixed(2) + 's ' + e.type + ' ' + (e.d === undefined ? '' : JSON.stringify(e.d))); });
      return L.join('\n');
    }
  };
  g.addEventListener('error', function (e) { KRLOG.add('ERROR', { where: 'window', msg: e.message, at: (e.filename || '').split('/').pop() + ':' + e.lineno }); });
  g.addEventListener('unhandledrejection', function (e) { KRLOG.add('ERROR', { where: 'promise', msg: String(e.reason && e.reason.message || e.reason) }); });
  g.KRLOG = KRLOG;
})(window);
