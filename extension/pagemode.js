/* Kokoro Reader page mode: reads any web page aloud and highlights the spoken words
   with the CSS Custom Highlight API (no change to the page's DOM).
   Used on every site except Google Docs, where overlay.js draws the highlight instead.
   Exposes window.KRP (text extraction) and window.KRO (same interface as overlay.js). */
(function (g) {
  'use strict';
  var HOST_ID = 'kokoro-reader-host';
  var STYLE_ID = 'kr-page-style';
  var ZW = new RegExp('[' + String.fromCharCode(0x200b, 0x200c, 0x200d, 0x2060, 0xfeff) + ']', 'g');
  var SKIP_ALWAYS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, HEAD: 1 };
  var SKIP_STRICT = { SVG: 1, CANVAS: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, BUTTON: 1, SELECT: 1, OPTION: 1, TEXTAREA: 1, INPUT: 1, NAV: 1, ASIDE: 1, FOOTER: 1, FORM: 1, AUDIO: 1, VIDEO: 1, PRE: 1 };
  var SKIP_ROLES = /^(navigation|complementary|contentinfo|search|dialog|alertdialog|banner|menu|menubar|toolbar)$/;
  var HIDDEN_CLASS = /(^|[\s_-])(sr-only|visually-?hidden|screen-?reader-?text|assistive-?text|skip-?link)([\s_-]|$)/i;
  var NOISE_ANCESTOR = 'nav,aside,footer,form,[role=navigation],[role=complementary],[role=contentinfo],[role=banner]';

  var LAST = null; // result of the latest extract(): { words, mode }

  function visible(el) {
    try {
      if (el.checkVisibility) {
        if (el.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true })) return true;
        var cs = getComputedStyle(el);
        return cs.display === 'contents' && cs.visibility !== 'hidden'; // no box, but its children can still show
      }
    } catch (e) { /* older Chrome */ }
    return true;
  }

  function skipEl(el, strict) {
    var tn = el.nodeName.toUpperCase();
    if (SKIP_ALWAYS[tn] || el.id === HOST_ID) return true;
    if (strict) {
      if (SKIP_STRICT[tn]) return true;
      if (el.getAttribute('aria-hidden') === 'true' || el.hidden) return true;
      var role = el.getAttribute('role');
      if (role && SKIP_ROLES.test(role)) return true;
      if (el.getAttribute('aria-modal') === 'true') return true;
      var cls = el.getAttribute('class');
      if (cls && HIDDEN_CLASS.test(cls)) return true;
    }
    return !visible(el);
  }

  function isInline(el) {
    var d = getComputedStyle(el).display;
    return d.indexOf('inline') === 0 || d === 'contents' || d.indexOf('ruby') === 0;
  }
  function blockOf(node, cache) {
    var el = node.parentElement;
    while (el && el !== document.body && el !== document.documentElement) {
      var v = cache.get(el);
      if (v === undefined) { v = !isInline(el); cache.set(el, v); }
      if (v) return el;
      el = el.parentElement;
    }
    return el || document.body;
  }

  /* Walk the text under rootNode and return words with their exact DOM positions.
     The tokens are split the same way lib.js buildModel splits the joined text,
     so words[i] here is the same word as model.words[i]. */
  function collect(rootNode, strict, range) {
    var st = { words: [], block: null, brk: true, open: null };
    var cache = new Map();

    function addText(node, from, to) {
      var s = node.nodeValue || '', len = s.length;
      if (to == null || to > len) to = len;
      var block = blockOf(node, cache), re = /\S+/g, m, any = false;
      var brk = st.brk || st.block !== block;
      re.lastIndex = from || 0;
      while ((m = re.exec(s)) && m.index < to) {
        var start = m.index, end = Math.min(start + m[0].length, to);
        var tok = s.slice(start, end).replace(ZW, '');
        if (!tok) continue;
        any = true;
        if (!brk && st.open && start === 0) { // a word split by inline markup, like <b>Hel</b>lo
          var o = st.open; o.t += tok; o.en = node; o.eo = end;
        } else {
          st.words.push({ t: tok, sn: node, so: start, en: node, eo: end, brk: brk });
        }
        brk = false; st.block = block; st.brk = false;
        st.open = end === len ? st.words[st.words.length - 1] : null;
      }
      if (!any && len > 0) st.open = null;
    }

    if (rootNode.nodeType === 3) {
      addText(rootNode, range ? (rootNode === range.startContainer ? range.startOffset : 0) : 0, range ? (rootNode === range.endContainer ? range.endOffset : null) : null);
    } else {
      var tw = document.createTreeWalker(rootNode, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          if (n.nodeType === 1) return skipEl(n, strict) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      var n;
      while ((n = tw.nextNode())) {
        if (n.nodeType === 3) {
          if (range) {
            if (!range.intersectsNode(n)) continue;
            addText(n, n === range.startContainer ? range.startOffset : 0, n === range.endContainer ? range.endOffset : null);
          } else addText(n, 0, null);
        } else if (n.nodeName === 'BR') { st.brk = true; st.open = null; }
      }
    }
    return st.words;
  }

  function toText(words) {
    var lines = [], line = [];
    words.forEach(function (w) {
      if (w.brk && line.length) { lines.push(line.join(' ')); line = []; }
      line.push(w.t);
    });
    if (line.length) lines.push(line.join(' '));
    return lines.join('\n');
  }

  /* Pick the element that holds the main article text. */
  function pickRoot() {
    var best = null, bestLen = 0;
    var sem = document.querySelectorAll('article, main, [role=main]');
    for (var i = 0; i < sem.length; i++) {
      if (!visible(sem[i])) continue;
      var L = (sem[i].innerText || '').length;
      if (L > bestLen) { best = sem[i]; bestLen = L; }
    }
    if (best && bestLen >= 400) return best;
    var scores = new Map(), top = null, topScore = 0;
    var ps = document.querySelectorAll('p');
    for (var j = 0; j < ps.length; j++) {
      var p = ps[j], txt = (p.textContent || '').trim();
      if (txt.length < 40 || p.closest(NOISE_ANCESTOR) || !visible(p)) continue;
      var linkLen = 0, as = p.querySelectorAll('a');
      for (var k = 0; k < as.length; k++) linkLen += (as[k].textContent || '').length;
      var sc = txt.length * (1 - Math.min(1, linkLen / txt.length));
      var el = p.parentElement, f = 1;
      for (var d = 0; d < 3 && el && el !== document.documentElement; d++, f /= 2, el = el.parentElement) {
        var v = (scores.get(el) || 0) + sc * f;
        scores.set(el, v);
        if (v > topScore) { topScore = v; top = el; }
      }
    }
    if (top && topScore >= 200) return top;
    return best || document.body;
  }

  var KRP = {
    /* Reads the selected text if there is one, otherwise the main article, otherwise the page. */
    extract: function () {
      var words = [], mode = 'page';
      var sel = g.getSelection && g.getSelection();
      if (sel && sel.rangeCount && !sel.isCollapsed && String(sel).trim()) {
        var r = sel.getRangeAt(0);
        words = collect(r.commonAncestorContainer, false, r);
        mode = 'selection';
      }
      if (!words.length) {
        var root = pickRoot();
        words = collect(root, true);
        mode = root === document.body ? 'page' : 'article';
        if (words.length < 20 && root !== document.body) {
          var all = collect(document.body, true);
          if (all.length > words.length) { words = all; mode = 'page'; }
        }
      }
      LAST = { words: words, mode: mode };
      return { text: toText(words), words: words.length, mode: mode };
    },
    mode: function () { return LAST ? LAST.mode : null; },
    _collect: collect, _pickRoot: pickRoot
  };
  g.KRP = KRP;

  /* ---------- highlight (same interface as overlay.js's KRO) ---------- */
  var KRO = {};
  var C = { on: false, words: null, cur: -1, seg0: -1, seg1: -1, auto: true, theme: null, lastUserScroll: 0, status: 'idle', opts: null, style: null, sentKey: '' };

  function supported() { return typeof g.Highlight === 'function' && g.CSS && g.CSS.highlights; }
  function setStatus(st) { if (st !== C.status) { C.status = st; if (C.opts && C.opts.onStatus) C.opts.onStatus(st); } }

  function applyStyle() {
    if (!C.on) return;
    var t = C.theme || { word: '#ff8a3d', sent: '#ffe3c4' };
    var css = '::highlight(kr-word){background-color:' + t.word + ';}' + (t.sent ? '::highlight(kr-sent){background-color:' + t.sent + ';}' : '');
    if (!C.style) { C.style = document.createElement('style'); C.style.id = STYLE_ID; (document.head || document.documentElement).appendChild(C.style); }
    C.style.textContent = css;
    if (!t.sent && g.CSS && CSS.highlights) CSS.highlights.delete('kr-sent');
    C.sentKey = '';
  }

  function stale() { clearHighlights(); setStatus('failed'); }
  function clearHighlights() { if (g.CSS && CSS.highlights) { CSS.highlights.delete('kr-word'); CSS.highlights.delete('kr-sent'); } }

  function wordRange(w) {
    var r = document.createRange();
    r.setStart(w.sn, w.so); r.setEnd(w.en, w.eo);
    return r;
  }

  function scrollerOf(el) {
    while (el && el !== document.body && el !== document.documentElement) {
      var cs = getComputedStyle(el);
      if (/(auto|scroll|overlay)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4) return el;
      el = el.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }
  function followScroll(r, w) {
    if (!C.auto || Date.now() - C.lastUserScroll < 2500) return;
    var rect = r.getBoundingClientRect();
    if (!rect.height) return;
    var sc = scrollerOf(w.sn.parentElement), isRoot = sc === document.scrollingElement || sc === document.documentElement || sc === document.body;
    var top = 0, h = g.innerHeight;
    if (!isRoot) { var b = sc.getBoundingClientRect(); top = Math.max(0, b.top); h = Math.min(g.innerHeight, b.bottom) - top; }
    if (h <= 0) return;
    if (rect.top < top + h * 0.15 || rect.bottom > top + h * 0.8) {
      sc.scrollBy({ top: rect.top - (top + h * 0.35), behavior: 'smooth' });
    }
  }

  KRO.setWord = function (i, seg0, seg1, autoscroll) {
    if (!C.on || !C.words) return;
    var w = C.words[i];
    if (!w) return;
    C.cur = i; C.auto = !!autoscroll;
    try {
      if (!w.sn.isConnected || !w.en.isConnected) { stale(); return; }
      var r = wordRange(w);
      var hw = new Highlight(r); hw.priority = 2;
      CSS.highlights.set('kr-word', hw);
      var key = seg0 + ':' + seg1;
      if (C.theme && C.theme.sent && key !== C.sentKey) {
        var a = C.words[seg0], z = C.words[seg1 - 1];
        if (a && z && a.sn.isConnected && z.en.isConnected) {
          var sr = document.createRange();
          sr.setStart(a.sn, a.so); sr.setEnd(z.en, z.eo);
          CSS.highlights.set('kr-sent', new Highlight(sr));
          C.sentKey = key;
        }
      }
      followScroll(r, w);
      if (C.status !== 'ok') setStatus('ok');
    } catch (e) { stale(); }
  };

  /* index of the word at a screen position, or -1 */
  function pointNode(x, y) {
    if (document.caretPositionFromPoint) { var p = document.caretPositionFromPoint(x, y); return p ? { n: p.offsetNode, o: p.offset } : null; }
    if (document.caretRangeFromPoint) { var r = document.caretRangeFromPoint(x, y); return r ? { n: r.startContainer, o: r.startOffset } : null; }
    return null;
  }
  function cmp(an, ao, bn, bo) {
    if (an === bn) return ao < bo ? -1 : ao > bo ? 1 : 0;
    var pos = an.compareDocumentPosition(bn);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  }
  function wordAt(x, y) {
    var ws = C.words; if (!ws || !ws.length) return -1;
    var pt = pointNode(x, y);
    if (!pt || pt.n.nodeType !== 3) return -1;
    var first = ws[0], last = ws[ws.length - 1];
    if (cmp(pt.n, pt.o, first.sn, first.so) < 0 || cmp(pt.n, pt.o, last.en, last.eo) > 0) return -1;
    var lo = 0, hi = ws.length - 1, found = 0;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (cmp(ws[mid].sn, ws[mid].so, pt.n, pt.o) <= 0) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (cmp(pt.n, pt.o, ws[found].en, ws[found].eo) > 0 && found + 1 < ws.length) found++;
    return found;
  }
  function onMouse(e) {
    if (!C.on || !e.altKey) return;
    var i = wordAt(e.clientX, e.clientY);
    if (i >= 0) { e.preventDefault(); e.stopPropagation(); if (e.type === 'mousedown' && C.opts && C.opts.onSeek) C.opts.onSeek(i); }
  }
  function onUserScroll() { C.lastUserScroll = Date.now(); }

  KRO.attach = function (opts) {
    KRO.detach();
    C.opts = opts;
    var M = opts.getModel();
    if (!M || !LAST || !LAST.words.length) { C.status = 'idle'; setStatus('failed'); return; }
    if (!supported()) { C.status = 'idle'; setStatus('failed'); return; }
    if (LAST.words.length !== M.words.length) { C.status = 'idle'; setStatus('failed'); return; } // page text changed since it was read
    C.on = true; C.words = LAST.words; C.cur = -1; C.seg0 = C.seg1 = -1; C.auto = true; C.status = 'idle';
    applyStyle();
    document.addEventListener('mousedown', onMouse, true);
    document.addEventListener('click', onMouse, true);
    g.addEventListener('wheel', onUserScroll, { passive: true });
    g.addEventListener('touchmove', onUserScroll, { passive: true });
    setStatus('ok');
  };
  KRO.detach = function () {
    if (C.on) {
      document.removeEventListener('mousedown', onMouse, true);
      document.removeEventListener('click', onMouse, true);
      g.removeEventListener('wheel', onUserScroll);
      g.removeEventListener('touchmove', onUserScroll);
    }
    C.on = false;
    clearHighlights();
    if (C.style) { C.style.remove(); C.style = null; }
  };
  KRO.setAutoscroll = function (v) { C.auto = !!v; };
  KRO.setTheme = function (t) { if (!t) return; C.theme = { word: t.word, sent: t.sent, ring: t.ring, dark: !!t.dark }; if (C.on) applyStyle(); };
  KRO.status = function () { return C.status; };

  function bgOf(el) {
    var c = /rgba?\(([^)]+)\)/.exec(getComputedStyle(el).backgroundColor || '');
    if (!c) return null;
    var a = c[1].split(',').map(parseFloat);
    return (a.length > 3 && a[3] < 0.5) ? null : a;
  }
  /* true if the page is dark, false if light */
  KRO.docDark = function () {
    try {
      var els = [document.body, document.documentElement];
      for (var i = 0; i < els.length; i++) {
        var c = els[i] && bgOf(els[i]);
        if (c) return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) < 110;
      }
      var scheme = getComputedStyle(document.documentElement).colorScheme || '';
      if (/dark/.test(scheme) && !/light/.test(scheme.replace(/dark/, ''))) return !!(g.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    } catch (e) { /* fall through */ }
    return false;
  };
  KRO.diagnose = function () {
    return 'page mode (' + (LAST ? LAST.mode : 'not read yet') + '), words ' + (C.words ? C.words.length : 0) + ', highlight API ' + (supported() ? 'available' : 'MISSING') + ', status ' + C.status;
  };
  KRO.snapshot = function () { return { mode: LAST ? LAST.mode : null, status: C.status, word: C.cur, seg: [C.seg0, C.seg1], words: C.words ? C.words.length : 0 }; };
  KRO.debug = function () { return { status: C.status, mode: LAST ? LAST.mode : null, words: C.words ? C.words.length : 0 }; };
  g.KRO = KRO;
})(typeof window !== 'undefined' ? window : this);
