/* Kokoro Reader: text model, sentence chunking, word timing alignment. */
(function (root) {
  'use strict';

  var ABBR = /^(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|e\.g|i\.e|no|fig|inc|ltd|co)\.$/i;
  var INITIALS = /^(?:\p{L}\.){1,4}$/u;
  var ALNUM_G = /[\p{L}\p{N}]/gu;
  var ALNUM_1 = /[\p{L}\p{N}]/u;

  function alnumLen(s) {
    var m = String(s || '').match(ALNUM_G);
    return m ? m.length : 0;
  }

  var CH = String.fromCharCode;
  var RE_BOM = new RegExp('^' + CH(0xfeff));
  var RE_LINE_SEPS = new RegExp('[' + CH(0x0b, 0x2028, 0x2029, 0x0c) + ']', 'g');
  var RE_NBSP = new RegExp(CH(0xa0), 'g');
  var RE_ZW = new RegExp('[' + CH(0x200b, 0x200c, 0x200d, 0x2060, 0xfeff) + ']', 'g');
  var ELL = CH(0x2026);
  var CLOSERS = '"\'' + CH(0x201d, 0x2019) + ')\\]';
  var RE_SENT_END = new RegExp('[.!?' + ELL + '][' + CLOSERS + ']*$');
  var RE_CLOSERS_TAIL = new RegExp('[' + CLOSERS + ']+$');
  var RE_SOFT_END = new RegExp('[,;:][' + CLOSERS + ']*$');
  var RE_PUNCT_END = new RegExp('[.!?' + ELL + ':;][' + CLOSERS + ']*$');

  function normalizeDocText(raw) {
    return String(raw)
      .replace(RE_BOM, '')
      .replace(/\r\n?/g, '\n')
      .replace(RE_LINE_SEPS, '\n')
      .replace(RE_NBSP, ' ')
      .replace(RE_ZW, '');
  }

  function spokenForm(w) {
    if (/^https?:\/\//i.test(w) || /^www\./i.test(w)) return 'link';
    if (!ALNUM_1.test(w)) return '';
    return w;
  }

  function isSentenceEnd(w) {
    if (!RE_SENT_END.test(w)) return false;
    var bare = w.replace(RE_CLOSERS_TAIL, '');
    if (ABBR.test(bare)) return false;
    if (INITIALS.test(bare) && bare.length <= 4) return false;
    return true;
  }

  function buildSegments(words) {
    var segs = [], start = 0, chars = 0;
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      chars += w.t.length + 1;
      var last = i === words.length - 1;
      var end = last || w.endsPara || isSentenceEnd(w.t) ||
        (chars > 380 && RE_SOFT_END.test(w.t)) || chars > 520;
      if (end) {
        segs.push({ w0: start, w1: i + 1 });
        for (var k = start; k <= i; k++) words[k].seg = segs.length - 1;
        start = i + 1;
        chars = 0;
      }
    }
    return segs;
  }

  function chunkText(words, w0, w1) {
    var out = [];
    for (var i = w0; i < w1; i++) {
      var w = words[i];
      if (!w.sp) continue;
      var s = w.sp;
      if (w.endsPara && !RE_PUNCT_END.test(s)) s += '.';
      out.push(s);
    }
    return out.join(' ');
  }

  function buildChunks(words, segs, opts) {
    opts = opts || {};
    var first = opts.first || 150, target = opts.target || 340, hard = opts.hard || 520;
    var chunks = [], cur = null;
    for (var s = 0; s < segs.length; s++) {
      var seg = segs[s], len = 0;
      for (var i = seg.w0; i < seg.w1; i++) len += words[i].t.length + 1;
      if (cur && (cur.chars >= (chunks.length === 0 ? first : target) || cur.chars + len > hard)) {
        chunks.push(cur);
        cur = null;
      }
      if (!cur) cur = { s0: s, s1: s + 1, w0: seg.w0, w1: seg.w1, chars: len };
      else { cur.s1 = s + 1; cur.w1 = seg.w1; cur.chars += len; }
    }
    if (cur) chunks.push(cur);
    chunks.forEach(function (c) { c.text = chunkText(words, c.w0, c.w1); });
    return chunks;
  }

  function buildModel(raw, opts) {
    var lines = normalizeDocText(raw).split('\n');
    var words = [], paras = [];
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li].trim();
      if (!line) continue;
      var parts = line.split(/\s+/);
      var w0 = words.length;
      for (var k = 0; k < parts.length; k++) {
        words.push({ t: parts[k], sp: spokenForm(parts[k]), p: paras.length, endsPara: k === parts.length - 1, seg: 0 });
      }
      paras.push({ w0: w0, w1: words.length });
    }
    var segs = buildSegments(words);
    var chunks = buildChunks(words, segs, opts);
    return { words: words, paras: paras, segs: segs, chunks: chunks };
  }

  /* Map server word timestamps onto display words by cumulative letter/digit
     count. Exact when texts match, degrades gracefully when the server
     expands numbers or symbols. Returns [{s,e}] per word in [w0,w1). */
  function alignWords(words, w0, w1, timestamps, duration) {
    var n = w1 - w0, out = new Array(n), i;
    var wt = [], Cd = 0;
    for (i = 0; i < n; i++) { var c = alnumLen(words[w0 + i].sp); wt.push(c); Cd += c; }
    var toks = [], Ct = 0;
    (timestamps || []).forEach(function (t) {
      var c = alnumLen(t.word);
      if (!c) return;
      toks.push({ c: c, s: +t.start_time, e: +t.end_time, cum: Ct });
      Ct += c;
    });
    var acc = 0;
    if (!toks.length || !Cd) {
      var dur = duration || 0, tot = Cd || n;
      for (i = 0; i < n; i++) {
        var wgt = Cd ? wt[i] : 1;
        out[i] = { s: acc / tot * dur, e: (acc + wgt) / tot * dur };
        acc += wgt;
      }
      return out;
    }
    function at(x, isEnd) {
      var lo = 0, hi = toks.length - 1;
      while (lo < hi) {
        var mid = (lo + hi) >> 1, t = toks[mid];
        var goRight = isEnd ? (t.cum + t.c < x - 1e-6) : (t.cum + t.c <= x + 1e-6);
        if (goRight) lo = mid + 1; else hi = mid;
      }
      var tk = toks[lo];
      var f = Math.min(1, Math.max(0, (x - tk.cum) / tk.c));
      return tk.s + f * (tk.e - tk.s);
    }
    for (i = 0; i < n; i++) {
      var x0 = acc / Cd * Ct, x1 = (acc + wt[i]) / Cd * Ct;
      acc += wt[i];
      var s = at(x0, false);
      var e = wt[i] ? at(x1, true) : s;
      if (e < s) e = s;
      out[i] = { s: s, e: e };
    }
    return out;
  }

  var api = { alnumLen: alnumLen, normalizeDocText: normalizeDocText, buildModel: buildModel, alignWords: alignWords, isSentenceEnd: isSentenceEnd };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.KR = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
