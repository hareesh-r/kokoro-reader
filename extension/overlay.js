/* Kokoro Reader: highlight words directly on the Google Docs page.
   Docs paints text on canvas, so word boxes are found from the pixels and matched to the document text. */
(function (g) {
  'use strict';
  var KRO = {};
  var C = { dark: false, theme: { word: '#ff8a3d', ring: '#D35400', sent: '#ffe3c4' }, on: false, opts: null, M: null, lens: null, pages: new Map(), cont: null, pool: [], scroller: null,
    timer: 0, seen: new Map(), lastVerify: 0, vOk: 0, vMiss: 0, lastLayout: '', lastWordLog: 0, ro: null, watched: new WeakSet(), cur: -1, seg0: -1, seg1: -1, fails: 0, status: 'searching', renderQ: 0, lastUserScroll: 0, lastSeekScroll: 0, seekTries: 0, auto: true };

  function med(a) { var b = a.slice().sort(function (x, y) { return x - y; }), n = b.length; return n ? (n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2) : 0; }

  /* Arial advance widths (per 1000 em) for the characters that matter; used to predict how wide a word is drawn */
  var AW = {};
  (function () {
    function set(chars, w) { for (var i = 0; i < chars.length; i++) AW[chars.charAt(i)] = w; }
    set(' !,./:;[\\]fijlIt|', 278); set('il', 222); set('ft', 278); set('r', 333); set('()-`', 333); set('"', 355); set("'", 191); set('*', 389);
    set('#$0123456789?_abdeghnopqu', 556); set('%', 889); set('&ABEKPSVXY', 667); set('+<=>~', 584); set('@', 1015);
    set('CDHNRUw', 722); set('GOQ', 778); set('FTZ', 611); set('J', 500); set('L', 556); set('M', 833); set('W', 944); set('^', 469);
    set('cksvxyz', 500); set('m', 833); set('{}', 334); set('w', 722);
    AW[String.fromCharCode(8217)] = 222; AW[String.fromCharCode(8216)] = 222; AW[String.fromCharCode(8220)] = 333; AW[String.fromCharCode(8221)] = 333;
    AW[String.fromCharCode(8211)] = 556; AW[String.fromCharCode(8212)] = 1000; AW[String.fromCharCode(8226)] = 350; AW[String.fromCharCode(8230)] = 1000;
  })();
  function emW(t) { var w = 0; for (var i = 0; i < t.length; i++) { var c = AW[t.charAt(i)]; w += c === undefined ? 600 : c; } return w / 1000; }

  /* ---------- pixel analysis ---------- */
  /* Background colour of a Docs canvas: the real canvases are opaque (white, or dark in dark mode), so ink = differs from this colour. */
  function bgFromPixels(get, W, H) {
    var pts = [[4, 4], [W - 5, 4], [4, H - 5], [W - 5, H - 5]], cols = [], k;
    for (k = 0; k < pts.length; k++) { var q = get(pts[k][0], pts[k][1]); if (q && q[3] > 200) cols.push(q); }
    if (cols.length < 3) return null;
    var m = [0, 1, 2].map(function (j) { return med(cols.map(function (q) { return q[j]; })); });
    var same = cols.filter(function (q) { return Math.abs(q[0] - m[0]) + Math.abs(q[1] - m[1]) + Math.abs(q[2] - m[2]) < 60; }).length;
    return same >= 3 ? m : null;
  }
  function canvasBg(c) {
    try {
      var W = c.width, H = c.height; if (W < 12 || H < 12) return null;
      /* copy the four corner pixels into a tiny scratch canvas and read them in one go (Docs' own canvas is not read-optimised) */
      var t = C.bgCv || (C.bgCv = document.createElement('canvas')); t.width = 2; t.height = 2;
      var x = t.getContext('2d', { willReadFrequently: true }); x.clearRect(0, 0, 2, 2);
      x.drawImage(c, 4, 4, 1, 1, 0, 0, 1, 1); x.drawImage(c, W - 5, 4, 1, 1, 1, 0, 1, 1);
      x.drawImage(c, 4, H - 5, 1, 1, 0, 1, 1, 1); x.drawImage(c, W - 5, H - 5, 1, 1, 1, 1, 1, 1);
      var d = x.getImageData(0, 0, 2, 2).data;
      return bgFromPixels(function (px, py) { var i = ((py === 4 ? 0 : 2) + (px === 4 ? 0 : 1)) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; }, W, H);
    } catch (e) { return null; }
  }
  function lumaOf(bg) { return 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]; }
  /* Hyperlinks are underlined and tables have borders. Both are long thin horizontal strokes that glue several words
     into one box, so remove every horizontal run much longer than any glyph before looking for words. */
  function stripRules(mask, W, H) {
    var L = Math.max(26, Math.round(W * 0.034)), V = Math.max(40, Math.round(H * 0.045)), y, x, st, o, q, y0, rules = [];
    /* table borders run top to bottom through every row and would fuse the rows into one block (done first, so row separators do not cut them short) */
    for (x = 0; x < W; x++) {
      y = 0;
      while (y < H) {
        if (!mask[y * W + x]) { y++; continue; }
        y0 = y; while (y < H && mask[y * W + x]) y++;
        if (y - y0 >= V) for (q = y0; q < y; q++) mask[q * W + x] = 0;
      }
    }
    for (y = 0; y < H; y++) {
      o = y * W; x = 0;
      while (x < W) {
        if (!mask[o + x]) { x++; continue; }
        st = x; while (x < W && mask[o + x]) x++;
        if (x - st >= L) { rules.push(y); for (q = st; q < x; q++) mask[o + q] = 0; }
      }
    }
    return rules;
  }
  /* Table cells with several lines, side by side: the pixels read row by row but the text goes cell by cell.
     Find runs of lines that share a vertical gutter, and build the cell by cell ordering as an alternative the matcher can try. */
  function findBands(lines, rules, medH) {
    var g = Math.max(10, 0.8 * medH), out = [], i = 0, n = lines.length;
    function ruleBetween(a, b) { for (var r = 0; r < rules.length; r++) if (rules[r] > lines[a].y1 - 2 && rules[r] < lines[b].y0 + 2) return true; return false; }
    function gaps(bx) { var o = [], k; for (k = 0; k + 1 < bx.length; k++) if (bx[k + 1].x0 - bx[k].x1 >= g) o.push([bx[k].x1, bx[k + 1].x0]); return o; }
    function cut(gut, bx) {   /* remove from the free intervals everything a line's boxes cover */
      var res = [];
      gut.forEach(function (iv) {
        var a = iv[0], b = iv[1], segs = [[a, b]];
        bx.forEach(function (q) { var nx = []; segs.forEach(function (sg) { if (q.x1 <= sg[0] || q.x0 >= sg[1]) nx.push(sg); else { if (q.x0 - sg[0] >= g) nx.push([sg[0], q.x0]); if (sg[1] - q.x1 >= g) nx.push([q.x1, sg[1]]); } }); segs = nx; });
        segs.forEach(function (sg) { if (sg[1] - sg[0] >= g) res.push(sg); });
      });
      return res;
    }
    while (i < n - 1) {
      var gut = gaps(lines[i].boxes);
      if (!gut.length) { i++; continue; }
      var j = i;
      while (j + 1 < n && !ruleBetween(j, j + 1)) { var ng = cut(gut, lines[j + 1].boxes); if (!ng.length) break; gut = ng; j++; }
      if (j > i) {
        var cs = gut.map(function (iv) { return (iv[0] + iv[1]) / 2; }).sort(function (a, b) { return a - b; });
        var ncol = cs.length + 1, cols = [], c, k;
        for (c = 0; c < ncol; c++) cols.push([]);
        var multi = false;
        for (k = i; k <= j; k++) {
          var per = []; for (c = 0; c < ncol; c++) per.push([]);
          lines[k].boxes.forEach(function (q) { var m = (q.x0 + q.x1) / 2, ci = 0; while (ci < cs.length && m > cs[ci]) ci++; per[ci].push(q); });
          for (c = 0; c < ncol; c++) if (per[c].length) cols[c].push({ y0: lines[k].y0, y1: lines[k].y1, boxes: per[c], virt: true });
        }
        cols.forEach(function (cl) { if (cl.length > 1) multi = true; });
        if (multi) { var alt = []; cols.forEach(function (cl) { cl.forEach(function (v) { alt.push(v); }); }); out.push({ from: i, to: j, alt: alt }); }
        i = j + 1;
      } else i++;
    }
    return out;
  }
  function analyze(canvas) {
    var W = canvas.width, H = canvas.height; if (!W || !H) return null;
    var data;
    try { data = canvas.getContext('2d').getImageData(0, 0, W, H).data; } catch (e) { return null; }
    var mask = new Uint8Array(W * H), p, i;
    var bg = bgFromPixels(function (px, py) { var o = (py * W + px) * 4; return [data[o], data[o + 1], data[o + 2], data[o + 3]]; }, W, H);
    if (bg) { var b0 = bg[0], b1 = bg[1], b2 = bg[2]; for (p = 0, i = 0; p < mask.length; p++, i += 4) { if (data[i + 3] > 40 && Math.abs(data[i] - b0) + Math.abs(data[i + 1] - b1) + Math.abs(data[i + 2] - b2) > 160) mask[p] = 1; } }
    else { for (p = 0, i = 0; p < mask.length; p++, i += 4) { if (data[i + 3] > 40 && (C.dark || (data[i] + data[i + 1] + data[i + 2]) < 510)) mask[p] = 1; } }
    var rules = stripRules(mask, W, H);
    var rows = new Int32Array(H), x, y;
    for (y = 0; y < H; y++) { var c = 0, o = y * W; for (x = 0; x < W; x++) c += mask[o + x]; rows[y] = c; }
    var spans = [], s = -1;
    for (y = 0; y < H; y++) { if (rows[y] > 0) { if (s < 0) s = y; } else if (s >= 0) { spans.push([s, y - 1]); s = -1; } }
    if (s >= 0) spans.push([s, H - 1]);
    spans = spans.filter(function (a) { return a[1] - a[0] + 1 >= 4; });
    if (!spans.length) return { W: W, H: H, lines: [], boxes: [], medH: 0 };
    var medH = med(spans.map(function (a) { return a[1] - a[0] + 1; }));
    // split merged lines when a clear valley exists
    var out = [];
    spans.forEach(function (a) {
      var stack = [a], guard = 0;
      while (stack.length && guard++ < 12) {
        var sp = stack.pop(), h = sp[1] - sp[0] + 1;
        if (h > 1.75 * medH) {
          var lo = sp[0] + Math.round(h * 0.3), hi = sp[1] - Math.round(h * 0.3), mi = -1, mv = 1e9, rv = [];
          for (y = sp[0]; y <= sp[1]; y++) rv.push(rows[y]);
          var mr = med(rv);
          for (y = lo; y <= hi; y++) if (rows[y] < mv) { mv = rows[y]; mi = y; }
          if (mi > 0 && mv < 0.2 * mr) { stack.push([sp[0], mi - 1], [mi + 1, sp[1]]); continue; }
        }
        out.push(sp);
      }
    });
    out.sort(function (a, b) { return a[0] - b[0]; });
    var lines = [], boxes = [], pageLike = H / W > 1.15 && H / W < 1.7;
    out.forEach(function (sp) {
      var h = sp[1] - sp[0] + 1;
      if (h > 2.6 * medH) return;                               // images and drawings
      if (pageLike && (sp[0] < 0.06 * H || sp[1] > 0.94 * H)) return;        // header and footer zones
      var thr = Math.max(2, 0.2 * Math.max(h, 0.8 * medH));
      var segs = [], st = -1, gap = 0, last = -1;
      for (x = 0; x < W; x++) {
        var ink = false;
        for (y = sp[0]; y <= sp[1]; y++) if (mask[y * W + x]) { ink = true; break; }
        if (ink) { if (st < 0) st = x; gap = 0; last = x; }
        else if (st >= 0) { gap++; if (gap >= thr) { segs.push([st, last]); st = -1; gap = 0; } }
      }
      if (st >= 0) segs.push([st, last]);
      if (!segs.length) return;
      var L = { y0: sp[0], y1: sp[1], boxes: segs.map(function (b) { return { x0: b[0], x1: b[1], y0: sp[0], y1: sp[1], w: b[1] - b[0] + 1 }; }) };
      lines.push(L); L.boxes.forEach(function (b) { boxes.push(b); });
    });
    return { W: W, H: H, lines: lines, boxes: boxes, medH: medH, bands: findBands(lines, rules, medH) };
  }

  /* ---------- matching boxes to text ---------- */
  function rOf(w, len) { return Math.log(w / (len + 0.6)); }
  function ratio(w, len) { return Math.log(Math.max(w, 1) / (len + 0.08)); }
  /* Align the boxes of one line to the next words. Handles a word split into several boxes (digits, capital I),
     two words joined in one box, stray glyphs, and chooses how many words the line used by also checking the next line. */
  function alignLine(L, next, lens, p, rh) {
    var bx = L.boxes, n = bx.length, j, i, nl = lens.length;
    var ref = 0, bestMad = 1e9, k, rs;
    for (var ki = 0; ki < 5; ki++) {
      k = [0, 1, -1, 2, -2][ki];   /* no shift unless another one fits clearly better */
      rs = [];
      for (i = 0; i < n; i++) { var wi0 = p + i + k; if (wi0 >= 0 && wi0 < nl && (k >= 0 || i + k >= 0)) rs.push(ratio(bx[i].x1 - bx[i].x0 + 1, lens[wi0])); }
      if (rs.length < (rh != null ? 3 : Math.min(3, n))) continue;   /* two boxes can always agree with each other, so they say nothing about scale */
      var rm = med(rs), mad = med(rs.map(function (x) { return Math.abs(x - rm); }));
      if (mad < bestMad - (bestMad < 1e9 ? 0.03 : 0)) { bestMad = mad; ref = rm; }
    }
    var haveRef = bestMad < 1e9;
    if (!haveRef && rh != null) ref = rh;   /* a line with 1 or 2 boxes: borrow the page's usual scale */
    function d(w, len) { return Math.min(Math.abs(ratio(w, len) - ref), 1); }
    function span(a, b) { return bx[b].x1 - bx[a].x0 + 1; }
    var maxW = Math.min(n + 3, nl - p), minW = Math.max(0, n - 3), INF = 1e9;
    var dp = [], bp = [];
    for (i = 0; i <= n; i++) { dp.push(new Array(maxW + 1).fill(INF)); bp.push(new Array(maxW + 1).fill(null)); }
    dp[0][0] = 0;
    function relax(i2, j2, c, from) { if (i2 <= n && j2 <= maxW && c < dp[i2][j2]) { dp[i2][j2] = c; bp[i2][j2] = from; } }
    for (i = 0; i < n; i++) for (j = 0; j <= maxW; j++) {
      var c0 = dp[i][j]; if (c0 >= INF) continue;
      if (j < maxW) {
        relax(i + 1, j + 1, c0 + d(span(i, i), lens[p + j]), [i, j, 'm']);
        if (i + 1 < n) relax(i + 2, j + 1, c0 + d(span(i, i + 1), lens[p + j]) + 0.1, [i, j, 's2']);
        if (i + 2 < n) relax(i + 3, j + 1, c0 + d(span(i, i + 2), lens[p + j]) + 0.22, [i, j, 's3']);
        if (j + 1 < maxW) relax(i + 1, j + 2, c0 + d(span(i, i), lens[p + j] + lens[p + j + 1] + 0.278) + 0.22, [i, j, 'j']);
        relax(i, j + 1, c0 + 0.7, [i, j, 'w']);
      }
      relax(i + 1, j, c0 + 0.6, [i, j, 'b']);
    }
    var nb = next ? next.boxes : null, best = INF, bestW = Math.min(n, maxW);
    for (var W = minW; W <= maxW; W++) {
      if (dp[n][W] >= INF) continue;
      var tot = dp[n][W] / Math.max(1, n);
      if (nb && p + W < nl) tot += 0.9 * alignLine(next, null, lens, p + W, rh).cost / Math.max(1, nb.length);
      if (tot < best) { best = tot; bestW = W; }
    }
    function trace(Wsel) {
      var items = [], cur = [n, Wsel];
      if (dp[n][Wsel] >= INF) { for (i = 0; i < n && p + i < nl; i++) items.push({ w: p + i, x0: bx[i].x0, x1: bx[i].x1 }); return items; }
      while (cur[0] > 0 || cur[1] > 0) {
        var f = bp[cur[0]][cur[1]]; if (!f) break;
        var fi = f[0], fj = f[1], kind = f[2];
        if (kind === 'm') items.push({ w: p + fj, x0: bx[fi].x0, x1: bx[fi].x1 });
        else if (kind === 's2') items.push({ w: p + fj, x0: bx[fi].x0, x1: bx[fi + 1].x1 });
        else if (kind === 's3') items.push({ w: p + fj, x0: bx[fi].x0, x1: bx[fi + 2].x1 });
        else if (kind === 'j') {
          var l1 = lens[p + fj], l2 = lens[p + fj + 1], tw = bx[fi].x1 - bx[fi].x0, cut = bx[fi].x0 + tw * l1 / (l1 + l2 + 0.28);
          items.push({ w: p + fj, x0: bx[fi].x0, x1: cut }, { w: p + fj + 1, x0: cut, x1: bx[fi].x1 });
        }
        cur = [fi, fj];
      }
      return items;
    }
    var byW = [], Wk;
    for (Wk = 0; Wk <= maxW; Wk++) byW.push(dp[n][Wk] >= INF ? INF : dp[n][Wk]);
    if (dp[n][bestW] >= INF) return { W: Math.min(n, nl - p), items: trace(bestW), cost: n * 0.5, ref: null, byW: byW, trace: trace };
    return { W: bestW, items: trace(bestW), cost: dp[n][bestW], ref: haveRef && n >= 6 ? ref : null, byW: byW, trace: trace };
  }

  /* find where this page starts in the text: shortlist by a cheap per-line-normalised score, then confirm with the line aligner */
  function chainCost(an, lens, s0, maxLines) {
    var p = s0, tot = 0, nb = 0, li;
    for (li = 0; li < an.lines.length && li < maxLines; li++) {
      if (p >= lens.length) return { cost: 9, nb: nb };
      var r = alignLine(an.lines[li], an.lines[li + 1], lens, p);
      tot += r.cost; nb += an.lines[li].boxes.length; p += r.W;
    }
    return { cost: nb ? tot / nb : 9, nb: nb };
  }
  function findStart(an, lens, lo, hi) {
    var n = lens.length, lines = an.lines, K = 0, idx = [], li, bi;
    for (li = 0; li < lines.length && K < 40; li++) for (bi = 0; bi < lines[li].boxes.length && K < 40; bi++) { idx.push([li, lines[li].boxes[bi].x1 - lines[li].boxes[bi].x0 + 1]); K++; }
    if (K < 3) return { start: -1, score: 9, second: 9 };
    lo = Math.max(0, lo); hi = Math.min(hi, n - K);
    var short = [], s0, j;
    for (s0 = lo; s0 <= hi; s0++) {
      var rs = new Array(K), byLine = {};
      for (j = 0; j < K; j++) { rs[j] = ratio(idx[j][1], lens[s0 + j]); (byLine[idx[j][0]] = byLine[idx[j][0]] || []).push(j); }
      var res = new Array(K);
      Object.keys(byLine).forEach(function (k) { var js = byLine[k], m = med(js.map(function (q) { return rs[q]; })); js.forEach(function (q) { res[q] = Math.abs(rs[q] - m); }); });
      short.push([med(res), s0]);
    }
    short.sort(function (a, b) { return a[0] - b[0]; });
    var best = 9, bs = -1, second = 9;
    short.slice(0, 25).forEach(function (c) {
      var cc = chainCost(an, lens, c[1], 6).cost;
      if (cc < best) { if (bs < 0 || Math.abs(c[1] - bs) > 2) second = best; best = cc; bs = c[1]; }
      else if (cc < second && Math.abs(c[1] - bs) > 2) second = cc;
    });
    return { start: bs, score: best, second: second };
  }
  function mapPage(an, lens, hint) {
    var N = an.boxes.length; if (N < 2) return null;
    var r = null;
    if (hint.exact != null) {
      /* the previous page ended near here, but its last lines may be a few words off, so look in a wide window and demand a clear win */
      var q = findStart(an, lens, hint.exact - 12, hint.exact + 36);
      if (q.start >= 0 && q.score < 0.22 && (q.score < 0.1 || q.score < 0.75 * q.second)) r = q;
      if (!r) { var q1 = findStart(an, lens, hint.exact - 3, hint.exact + 3); if (q1.start >= 0 && q1.score < 0.2) r = q1; }
    }
    if (!r && hint.lo != null && N >= 6) { var q2 = findStart(an, lens, hint.lo, hint.hi); if (q2.start >= 0 && q2.score < 0.30 && q2.score < 0.8 * q2.second) r = q2; }
    if (!r && N >= 10) { var q3 = findStart(an, lens, 0, lens.length); if (q3.start >= 0 && q3.score < 0.28 && q3.score < 0.75 * q3.second) r = q3; }
    if (!r) return null;
    var p = r.start, wb = {}, lines = an.lines, li, fixes = 0, refs = [], rh = null;
    var bandAt = {}, vid = 100000;
    (an.bands || []).forEach(function (b) { bandAt[b.from] = b; });
    function nxt(i) { return lines[i + 1] && !bandAt[i + 1] ? lines[i + 1] : null; }   /* a table follows: its first drawn line is not the next line of text */
    function two(i, at) {
      var a = alignLine(lines[i], nxt(i), lens, at, rh), nbA = lines[i].boxes.length, c = a.cost / nbA;
      if (nxt(i) && at + a.W < lens.length) { var b = alignLine(lines[i + 1], nxt(i + 1), lens, at + a.W, rh); c = (c * nbA + b.cost) / (nbA + lines[i + 1].boxes.length); }
      return { c: c, a: a };
    }
    function seeRef(a) { if (a && a.ref != null) { refs.push(a.ref); if (refs.length > 7) refs.shift(); rh = med(refs); } }
    function runSeq(seq, tail, at) {
      var tot = 0, nbx = 0, W = 0, items = [], k, a;
      for (k = 0; k < seq.length; k++) {
        if (at + W >= lens.length) { tot += 0.6 * seq[k].boxes.length; nbx += seq[k].boxes.length; items.push(null); continue; }
        a = alignLine(seq[k], seq[k + 1] || tail, lens, at + W, rh); tot += a.cost; nbx += seq[k].boxes.length; W += a.W; items.push(a);
      }
      return { c: nbx ? tot / nbx : 9, W: W, items: items };
    }
    for (li = 0; li < lines.length; li++) {
      if (p >= lens.length) break;
      var bd = bandAt[li];
      if (bd) {
        /* row by row (as drawn) or cell by cell (as a table is read): keep whichever the words fit better */
        var rowSeq = lines.slice(bd.from, bd.to + 1), tail = lines[bd.to + 1] || null;
        var A = runSeq(rowSeq, tail, p), B = runSeq(bd.alt, tail, p), useAlt = B.c < A.c - 0.03, ch = useAlt ? B : A, sq = useAlt ? bd.alt : rowSeq;
        sq.forEach(function (ln, k) {
          var a = ch.items[k]; if (!a) return; seeRef(a);
          var id = useAlt ? vid++ : bd.from + k;
          a.items.forEach(function (it) { wb[it.w] = { x0: it.x0, x1: it.x1, y0: ln.y0, y1: ln.y1, line: id }; });
        });
        p += ch.W; li = bd.to;
        continue;
      }
      function shortLn(q) { if (q >= lines.length || bandAt[q]) return false; var bq = lines[q].boxes; return bq.length <= 6 && bq[bq.length - 1].x1 - bq[0].x0 < 0.45 * an.W && (lines[q].y1 - lines[q].y0 + 1) <= 1.35 * an.medH; }
      if (shortLn(li) && shortLn(li + 1)) {
        /* a block of very short lines (list items, key and value pairs): one line says little, so align the whole block together,
           and let the first long line after it help decide */
        var e2 = li; while (e2 - li < 13 && shortLn(e2 + 1)) e2++;
        var term = lines[e2 + 1] && !bandAt[e2 + 1] && !shortLn(e2 + 1) ? lines[e2 + 1] : null;
        var layer = {}; layer[p] = { c: 0, back: null };
        var layers = [layer], k2, pos;
        for (k2 = li; k2 <= e2; k2++) {
          var nl2 = {};
          Object.keys(layer).forEach(function (ps) {
            pos = +ps; if (pos >= lens.length) return;
            var a = alignLine(lines[k2], null, lens, pos, rh);
            a.byW.forEach(function (cw, W) { if (cw >= 1e9 || pos + W > lens.length) return; var np = pos + W, c = layer[ps].c + cw; if (!nl2[np] || c < nl2[np].c) nl2[np] = { c: c, back: pos, W: W, a: a }; });
          });
          layer = nl2; layers.push(layer);
          if (!Object.keys(layer).length) break;
        }
        if (term && layers.length === e2 - li + 2 && Object.keys(layer).length) {
          var bestEnd = -1, bestTot = 1e18;
          Object.keys(layer).forEach(function (ps) {
            var tot = layer[ps].c;
            if (term && +ps < lens.length) { var ta = alignLine(term, nxt(e2 + 1), lens, +ps, rh); tot += 1.3 * ta.cost; }
            if (tot < bestTot) { bestTot = tot; bestEnd = +ps; }
          });
          var path = [], cp = bestEnd, kk;
          for (kk = layers.length - 1; kk >= 1; kk--) { var node = layers[kk][cp]; path.unshift(node); cp = node.back; }
          path.forEach(function (node, q) {
            var ln = lines[li + q], items = node.a.trace(node.W);
            items.forEach(function (it) { wb[it.w] = { x0: it.x0, x1: it.x1, y0: ln.y0, y1: ln.y1, line: li + q }; });
          });
          p = bestEnd; li = e2; continue;
        }
      }
      var cur = two(li, p), res = cur.a, nbx = lines[li].boxes.length;
      if (li > 0 && nbx >= 4 && cur.c > 0.2) {
        /* this line fits badly: we probably lost count on an earlier one. Try nearby starting points. */
        var bestC = cur.c, bestP = p, d, pp;
        for (d = -14; d <= 40; d++) {
          if (!d) continue; pp = p + d; if (pp < r.start - 4 || pp >= lens.length) continue;
          var t = two(li, pp); if (t.c < bestC) { bestC = t.c; bestP = pp; }
        }
        if (bestP !== p && bestC < 0.6 * cur.c && bestC < 0.25) { p = bestP; res = alignLine(lines[li], nxt(li), lens, p, rh); fixes++; }
      }
      seeRef(res);
      res.items.forEach(function (it) { wb[it.w] = { x0: it.x0, x1: it.x1, y0: lines[li].y0, y1: lines[li].y1, line: li }; });
      p += res.W;
    }
    fillGaps(wb, r.start, p, lens);
    return { start: r.start, end: p, wb: wb, score: r.score, fixes: fixes };
  }
  /* words the aligner skipped still get a box, placed between their mapped neighbours on the same line */
  function fillGaps(wb, s, e, lens) {
    var j = s;
    while (j < e) {
      if (wb[j]) { j++; continue; }
      var a = j - 1, b = j; while (b < e && !wb[b]) b++;
      var pa = a >= s ? wb[a] : null, pb = b < e ? wb[b] : null;
      var line = pa ? pa : pb; if (!line) { j = b; continue; }
      var x0, x1;
      if (pa && pb && pa.line === pb.line) { x0 = pa.x1; x1 = pb.x0; }
      else if (pa) { x0 = pa.x1; x1 = pa.x1 + (pa.x1 - pa.x0) * 0.6; }
      else { x1 = pb.x0; x0 = pb.x0 - (pb.x1 - pb.x0) * 0.6; }
      var tot = 0, q; for (q = j; q < b; q++) tot += lens[q] + 0.1;
      var span = Math.max(2, x1 - x0), cx = x0;
      for (q = j; q < b; q++) {
        var w = span * (lens[q] + 0.1) / tot;
        wb[q] = { x0: cx, x1: cx + w, y0: line.y0, y1: line.y1, line: line.line, guessed: true };
        cx += w;
      }
      j = b;
    }
  }

  /* ---------- page tracking ---------- */
  function signature(c) {
    var t = C.sigCanvas || (C.sigCanvas = document.createElement('canvas'));
    t.width = 96; t.height = 128;
    var x = t.getContext('2d', { willReadFrequently: true });
    x.clearRect(0, 0, 96, 128);
    try { x.drawImage(c, 0, 0, 96, 128); var d = x.getImageData(0, 0, 96, 128).data, h = 2166136261; for (var i = 0; i < d.length; i += 4) { h ^= ((d[i] + d[i + 1] + d[i + 2]) >> 6) ^ (d[i + 3] >> 5); h = Math.imul(h, 16777619); } return h >>> 0; }
    catch (e) { return 0; }
  }

  function checkLayout() {
    var cv = document.querySelector('canvas.kix-canvas-tile-content'), rc = cv ? cv.getBoundingClientRect() : null;
    var key = devicePixelRatio + '|' + innerWidth + 'x' + innerHeight + '|' + (cv ? cv.width + 'x' + cv.height + '@' + Math.round(rc.width) : 'none');
    if (key !== C.lastLayout) {
      C.lastLayout = key; schedRender();
      if (window.KRLOG) KRLOG.add('layout', { dpr: devicePixelRatio, win: innerWidth + 'x' + innerHeight, canvas: cv ? cv.width + 'x' + cv.height : null, shown: rc ? Math.round(rc.width) + 'x' + Math.round(rc.height) : null });
    }
  }

  function scan() {
    if (!C.on || !C.M) return;
    try { scanInner(); } catch (e) { if (window.KRLOG) KRLOG.err('scan', e); }
  }
  function scanInner() {
    var sc = C.scroller = document.querySelector('.kix-appview-editor') || C.scroller; if (!sc) return;
    var t0 = performance.now();
    var cr = sc.getBoundingClientRect();
    C.pages.forEach(function (v, k) { if (!k.isConnected) C.pages.delete(k); });
    C.seen.forEach(function (v, k) { if (!k.isConnected) C.seen.delete(k); });
    checkLayout();
    var items = [].slice.call(document.querySelectorAll('canvas.kix-canvas-tile-content')).map(function (c) { return { c: c, r: c.getBoundingClientRect() }; })
      .filter(function (o) { return o.r.width > 200 && o.r.bottom > cr.top - 800 && o.r.top < cr.bottom + 800; });
    items.sort(function (a, b) { return a.r.top - b.r.top; });
    if (C.ro) items.forEach(function (o) { if (!C.watched.has(o.c)) { C.watched.add(o.c); C.ro.observe(o.c); } });
    if (!items.length) { bump(true); return; }
    var mid = (cr.top + cr.bottom) / 2, cands = [];
    items.forEach(function (o) {
      o.sig = signature(o.c);
      var sn = C.seen.get(o.c);
      var stable = !!sn && sn.sig === o.sig && sn.cw === o.c.width && sn.ch === o.c.height;   // wait until the page stops repainting
      C.seen.set(o.c, { sig: o.sig, cw: o.c.width, ch: o.c.height });
      var st = C.pages.get(o.c);
      var need = !st || st.sig !== o.sig || st.sw !== o.c.width || st.sh !== o.c.height;
      if (need && stable) cands.push({ o: o, d: Math.abs((o.r.top + o.r.bottom) / 2 - mid) });
    });
    cands.sort(function (a, b) { return a.d - b.d; });
    for (var q = 0; q < cands.length; q++) {
      if (q >= 1 && performance.now() - t0 > 60) break;
      analyzeOne(cands[q].o, items);
    }
    setStatus();
    render();
  }
  function analyzeOne(todo, items) {
    var t1 = performance.now();
    var an = analyze(todo.c), k = items.indexOf(todo), hint = {};
    var up = items[k - 1], dn = items[k + 1];
    var upst = up && C.pages.get(up.c), dnst = dn && C.pages.get(dn.c);
    if (upst && upst.start >= 0 && todo.r.top - up.r.bottom < 60) hint.exact = upst.end;
    else if (dnst && dnst.start >= 0 && dn.r.top - todo.r.bottom < 60 && an) hint.lo = dnst.start - an.boxes.length - 40, hint.hi = dnst.start - an.boxes.length + 40;
    else if (C.cur >= 0) { hint.lo = C.cur - 1500; hint.hi = C.cur + 1500; }
    var mp = an ? mapPage(an, C.lens, hint) : null;
    var old = C.pages.get(todo.c);
    var sizeChanged = old && (old.sw !== todo.c.width || old.sh !== todo.c.height);
    if (an && !mp && an.boxes.length >= 10) bump(true); else if (mp) { C.fails = 0; }
    var rec;
    if (mp) rec = { sig: todo.sig, start: mp.start, end: mp.end, wb: mp.wb, cw: todo.c.width, ch: todo.c.height, sw: todo.c.width, sh: todo.c.height, score: mp.score };
    else if (old && old.start >= 0 && sizeChanged) { rec = Object.assign({}, old, { sig: todo.sig, sw: todo.c.width, sh: todo.c.height, kept: true }); }   // zoomed: keep the scaled old boxes
    else rec = { sig: todo.sig, start: -1, end: -1, wb: null, cw: todo.c.width, ch: todo.c.height, sw: todo.c.width, sh: todo.c.height };
    C.pages.set(todo.c, rec);
    if (window.KRLOG) KRLOG.add('page', { i: k, bmp: todo.c.width + 'x' + todo.c.height, shown: Math.round(todo.r.width) + 'x' + Math.round(todo.r.height), boxes: an ? an.boxes.length : null, lines: an ? an.lines.length : null,
      hint: hint.exact != null ? 'exact' + hint.exact : (hint.lo != null ? 'range' : 'none'), start: rec.start, end: rec.end, score: mp ? +mp.score.toFixed(3) : null, kept: !!rec.kept, ms: Math.round(performance.now() - t1) });
  }
  function bump(fail) { if (fail) C.fails++; setStatus(); }
  function mappedCount() { var n = 0; C.pages.forEach(function (v) { if (v.start >= 0) n++; }); return n; }
  function setStatus() {
    var st = mappedCount() ? 'ok' : (C.fails >= 3 ? 'failed' : 'searching');
    if (st !== C.status) { C.status = st; if (C.opts && C.opts.onStatus) C.opts.onStatus(st); }
  }

  /* ---------- painting ---------- */
  function ensureCont() {
    if (C.cont) return;
    var d = document.createElement('div'); d.id = 'kr-overlay';
    d.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;pointer-events:none;z-index:2147483000;mix-blend-mode:' + (C.dark ? 'screen' : 'multiply') + ';';
    document.documentElement.appendChild(d); C.cont = d;
  }
  function box(i) {
    var b = C.pool[i];
    if (!b) { b = document.createElement('div'); b.style.cssText = 'position:absolute;border-radius:3px;display:none;'; C.cont.appendChild(b); C.pool[i] = b; }
    return b;
  }
  function pageRect(c) { var r = c.getBoundingClientRect(); return { r: r, k: c.width / r.width, ky: c.height / r.height }; }

  /* self check: is there ink under the box we are about to show? If not, say how far off the real word is. */
  function verify(c, st, cw, wi) {
    var now = Date.now(); if (now - C.lastVerify < 1200) return; C.lastVerify = now;
    try {
      var sx = c.width / st.cw, sy = c.height / st.ch;
      var x0 = Math.max(0, Math.floor(cw.x0 * sx)), x1 = Math.min(c.width, Math.ceil(cw.x1 * sx)), y0 = Math.max(0, Math.floor(cw.y0 * sy)), y1 = Math.min(c.height, Math.ceil(cw.y1 * sy));
      var w = x1 - x0, h = y1 - y0; if (w < 2 || h < 2) return;
      var pad = Math.round(Math.max(60, w * 1.5)), sx0 = Math.max(0, x0 - pad), sw = Math.min(c.width, x1 + pad) - sx0;
      var d = c.getContext('2d').getImageData(sx0, y0, sw, h).data, col = new Int32Array(sw), i, x, y;
      var vbg = canvasBg(c), v0 = vbg ? vbg[0] : 0, v1 = vbg ? vbg[1] : 0, v2 = vbg ? vbg[2] : 0;
      for (y = 0; y < h; y++) for (x = 0; x < sw; x++) { i = (y * sw + x) * 4; if (d[i + 3] > 40 && (vbg ? Math.abs(d[i] - v0) + Math.abs(d[i + 1] - v1) + Math.abs(d[i + 2] - v2) > 255 : (C.dark || d[i] + d[i + 1] + d[i + 2] < 510))) col[x]++; }
      function inkAt(dx) { var n = 0, a = x0 - sx0 + dx, b = a + w; for (var q = Math.max(0, a); q < Math.min(sw, b); q++) n += col[q]; return n / (w * h); }
      var ink = inkAt(0);
      if (ink >= 0.02) { C.vOk++; if (C.vOk % 10 === 1 && window.KRLOG) KRLOG.add('verify-ok', { word: wi, ink: +ink.toFixed(3) }); return; }
      var best = 0, bd = 0; for (var dx = -pad; dx <= pad; dx += 2) { var v = inkAt(dx); if (v > best) { best = v; bd = dx; } }
      C.vMiss++;
      if (window.KRLOG) KRLOG.add('MISS', { word: wi, ink: +ink.toFixed(3), word_text: C.M && C.M.words[wi] ? C.M.words[wi].t : '', bestShiftPx: bd, bestInk: +best.toFixed(3), box: [x0, y0, w, h], guessed: !!cw.guessed, kept: !!st.kept, bmp: c.width + 'x' + c.height, wbUnits: st.cw + 'x' + st.ch, dpr: devicePixelRatio });
    } catch (e) { if (window.KRLOG) KRLOG.err('verify', e); }
  }

  function render() {
    try { return renderInner(); } catch (e) { if (window.KRLOG) KRLOG.err('render', e); return null; }
  }
  function renderInner() {
    if (!C.on || !C.cont) return null;
    var sc = C.scroller; if (!sc) return null;
    var cr = sc.getBoundingClientRect();
    C.cont.style.left = cr.left + 'px'; C.cont.style.top = cr.top + 'px'; C.cont.style.width = cr.width + 'px'; C.cont.style.height = cr.height + 'px';
    var used = 0, wordRect = null, wi = C.cur;
    if (wi >= 0) C.pages.forEach(function (st, c) {
      if (st.start < 0 || !st.wb) return;
      var pr = pageRect(c), k = st.cw / pr.r.width, ky = st.ch / pr.r.height, lineBoxes = {};
      var a = Math.max(C.seg0, st.start), z = Math.min(C.seg1, st.end);
      for (var j = a; j < z; j++) {
        var b = st.wb[j]; if (!b) continue;
        var L = lineBoxes[b.line] || (lineBoxes[b.line] = { x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1 });
        if (b.x0 < L.x0) L.x0 = b.x0; if (b.x1 > L.x1) L.x1 = b.x1;
      }
      Object.keys(lineBoxes).forEach(function (li) {
        var L = lineBoxes[li], e = box(used++);
        if (!C.theme.sent) { e.style.display = 'none'; return; }
        e.style.display = 'block'; e.style.background = C.theme.sent; e.style.boxShadow = 'none';
        e.style.left = (pr.r.left + L.x0 / k - cr.left - 2) + 'px'; e.style.top = (pr.r.top + L.y0 / ky - cr.top - 1) + 'px';
        e.style.width = ((L.x1 - L.x0) / k + 4) + 'px'; e.style.height = ((L.y1 - L.y0) / ky + 2) + 'px';
      });
      var cw = st.wb[wi];
      if (cw && wi >= st.start && wi < st.end) {
        verify(c, st, cw, wi);
        var e2 = box(used++);
        var l = pr.r.left + cw.x0 / k - cr.left - 2, t = pr.r.top + cw.y0 / ky - cr.top - 1, w = (cw.x1 - cw.x0) / k + 4, h = (cw.y1 - cw.y0) / ky + 2;
        e2.style.display = 'block'; e2.style.background = C.theme.word; e2.style.boxShadow = '0 0 0 1.5px ' + C.theme.ring;
        e2.style.left = l + 'px'; e2.style.top = t + 'px'; e2.style.width = w + 'px'; e2.style.height = h + 'px';
        wordRect = { top: t + cr.top, bottom: t + h + cr.top };
      }
    });
    for (var u = used; u < C.pool.length; u++) C.pool[u].style.display = 'none';
    return wordRect;
  }

  function followScroll(wordRect) {
    var sc = C.scroller; if (!sc || !C.auto) return;
    if (Date.now() - C.lastUserScroll < 3000) return;
    var cr = sc.getBoundingClientRect(), now = Date.now();
    if (wordRect) {
      C.seekTries = 0;
      var h = cr.height;
      if (wordRect.top < cr.top + h * 0.15 || wordRect.bottom > cr.bottom - h * 0.25) {
        sc.scrollTo({ top: sc.scrollTop + (wordRect.top - cr.top) - h * 0.35, behavior: 'smooth' });
      }
      return;
    }
    // word is on a page that is not drawn yet: step toward it
    if (C.cur < 0 || now - C.lastSeekScroll < 450 || C.seekTries > 40) return;
    var lo = 1e9, hi = -1;
    C.pages.forEach(function (st) { if (st.start >= 0) { lo = Math.min(lo, st.start); hi = Math.max(hi, st.end); } });
    if (hi < 0) return;
    var dir = C.cur < lo ? -1 : 1;
    C.lastSeekScroll = now; C.seekTries++;
    sc.scrollTo({ top: sc.scrollTop + dir * cr.height * 0.7, behavior: 'smooth' });
  }

  function schedRender() {
    if (C.renderQ) return;
    C.renderQ = requestAnimationFrame(function () { C.renderQ = 0; render(); });
  }

  /* ---------- Alt+click to jump ---------- */
  function wordAt(x, y) {
    var hit = -1;
    C.pages.forEach(function (st, c) {
      if (hit >= 0 || st.start < 0 || !st.wb) return;
      var pr = pageRect(c), k = st.cw / pr.r.width, ky = st.ch / pr.r.height;
      if (x < pr.r.left || x > pr.r.right || y < pr.r.top || y > pr.r.bottom) return;
      var px = (x - pr.r.left) * k, py = (y - pr.r.top) * ky, bestD = 1e9;
      Object.keys(st.wb).forEach(function (j) {
        var b = st.wb[j];
        if (py >= b.y0 - 3 && py <= b.y1 + 3) { var d = px < b.x0 ? b.x0 - px : (px > b.x1 ? px - b.x1 : 0); if (d < bestD) { bestD = d; hit = +j; } }
      });
      if (bestD > 12 * k) hit = -1;
    });
    return hit;
  }
  function onMouse(e) {
    if (!C.on || !e.altKey) return;
    var i = wordAt(e.clientX, e.clientY);
    if (i >= 0) { e.preventDefault(); e.stopPropagation(); if (e.type === 'mousedown' && C.opts.onSeek) C.opts.onSeek(i); }
  }
  function onUserScroll() { C.lastUserScroll = Date.now(); }

  /* ---------- public API ---------- */
  KRO.attach = function (opts) {
    KRO.detach();
    C.opts = opts; C.M = opts.getModel(); if (!C.M) return;
    C.lens = C.M.words.map(function (w) { return emW(w.t); });
    C.on = true; C.pages = new Map(); C.fails = 0; C.status = 'searching'; C.cur = -1; C.seg0 = C.seg1 = -1; C.auto = true;
    ensureCont();
    C.scroller = document.querySelector('.kix-appview-editor');
    if (C.scroller) {
      C.scroller.addEventListener('scroll', schedRender, { passive: true });
      C.scroller.addEventListener('wheel', onUserScroll, { passive: true });
      C.scroller.addEventListener('touchmove', onUserScroll, { passive: true });
      C.scroller.addEventListener('mousedown', onMouse, true);
      C.scroller.addEventListener('click', onMouse, true);
    }
    window.addEventListener('resize', schedRender);
    C.watched = new WeakSet();
    C.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(function () { schedRender(); }) : null;
    if (C.ro && C.scroller) C.ro.observe(C.scroller);
    C.timer = setInterval(scan, 250); scan();
  };
  KRO.detach = function () {
    C.on = false; clearInterval(C.timer);
    if (C.ro) { C.ro.disconnect(); C.ro = null; }
    if (C.scroller) {
      C.scroller.removeEventListener('scroll', schedRender); C.scroller.removeEventListener('wheel', onUserScroll);
      C.scroller.removeEventListener('touchmove', onUserScroll); C.scroller.removeEventListener('mousedown', onMouse, true);
      C.scroller.removeEventListener('click', onMouse, true);
    }
    window.removeEventListener('resize', schedRender);
    if (C.cont) { C.cont.remove(); C.cont = null; C.pool = []; }
  };
  KRO.setWord = function (i, seg0, seg1, autoscroll) {
    if (!C.on) return;
    C.cur = i; C.seg0 = seg0; C.seg1 = seg1; C.auto = !!autoscroll;
    var wr = render();
    var nowT = Date.now();
    if (window.KRLOG && nowT - C.lastWordLog > 3000) { C.lastWordLog = nowT; KRLOG.add('word', { i: i, onPage: !!wr, zoomKey: C.lastLayout }); }
    followScroll(wr);
  };
  KRO.setAutoscroll = function (v) { C.auto = !!v; };
  /* true if the Google Doc page is dark, false if light, null if no page is on screen yet */
  KRO.docDark = function () {
    var cs = document.querySelectorAll('canvas.kix-canvas-tile-content');
    for (var i = 0; i < cs.length; i++) { var bg = canvasBg(cs[i]); if (bg) return lumaOf(bg) < 110; }
    return null;
  };
  KRO.setTheme = function (t) {
    if (window.KRLOG) KRLOG.add('theme', t);
    if (!t) return;
    var dark = !!t.dark, flipped = dark !== C.dark;
    C.theme = { word: t.word, ring: t.ring, sent: t.sent };
    C.dark = dark;
    if (C.cont) C.cont.style.mixBlendMode = dark ? 'screen' : 'multiply';
    if (flipped) { C.pages.clear(); C.seen.clear(); }
    if (C.on) schedRender();
  };
  KRO.diagnose = function () {
    var sc = document.querySelector('.kix-appview-editor'), cv = [].slice.call(document.querySelectorAll('canvas.kix-canvas-tile-content')), out = [];
    out.push('scroller ' + (sc ? 'found' : 'MISSING') + ', canvases ' + cv.length + ', status ' + C.status + ', pages matched ' + mappedCount() + ', words in text ' + (C.lens ? C.lens.length : 0));
    cv.slice(0, 4).forEach(function (c) {
      var an = analyze(c), q = null;
      if (an && an.boxes.length >= 10 && C.lens && C.lens.length > 10) q = findStart(an, C.lens, 0, C.lens.length);
      var rr = c.getBoundingClientRect();
      out.push('canvas ' + c.width + 'x' + c.height + ' shown ' + Math.round(rr.width) + 'x' + Math.round(rr.height) + ' (dpr ' + window.devicePixelRatio + ', scale x' + (c.width / rr.width).toFixed(2) + ' y' + (c.height / rr.height).toFixed(2) + '): boxes ' + (an ? an.boxes.length : 'unreadable') + ', lines ' + (an ? an.lines.length : 0) + (q ? ', best score ' + q.score.toFixed(2) + ' (needs under 0.28) at word ' + q.start + ', runner-up ' + q.second.toFixed(2) : ''));
    });
    return out.join('  |  ');
  };
  KRO.snapshot = function () {
    var o = { status: C.status, fails: C.fails, word: C.cur, seg: [C.seg0, C.seg1], verifyOk: C.vOk, verifyMiss: C.vMiss, layout: C.lastLayout, pages: [] };
    [].slice.call(document.querySelectorAll('canvas.kix-canvas-tile-content')).forEach(function (c) {
      var r = c.getBoundingClientRect(), st = C.pages.get(c);
      o.pages.push({ bmp: c.width + 'x' + c.height, shown: Math.round(r.width) + 'x' + Math.round(r.height), top: Math.round(r.top), start: st ? st.start : 'unseen', end: st ? st.end : null, mapped: st && st.wb ? Object.keys(st.wb).length : 0, units: st ? st.cw + 'x' + st.ch : null, kept: !!(st && st.kept) });
    });
    return o;
  };
  KRO.status = function () { return C.status; };
  KRO.dump = function () {
    var o = [];
    [].slice.call(document.querySelectorAll('canvas.kix-canvas-tile-content')).forEach(function (c, ci) {
      var st = C.pages.get(c), r = c.getBoundingClientRect();
      if (!st || !st.wb) { o.push({ ci: ci, top: Math.round(r.top), unseen: true }); return; }
      var words = {}; Object.keys(st.wb).forEach(function (j) { var b = st.wb[j]; words[j] = [Math.round(b.x0), Math.round(b.x1), Math.round(b.y0), Math.round(b.y1), b.line]; });
      o.push({ ci: ci, top: Math.round(r.top), start: st.start, end: st.end, score: st.score, kept: !!st.kept, cw: st.cw, ch: st.ch, words: words });
    });
    return o;
  };
  KRO.debug = function () { var o = []; C.pages.forEach(function (v) { o.push({ start: v.start, end: v.end, n: v.wb ? Object.keys(v.wb).length : 0 }); }); return { status: C.status, fails: C.fails, pages: o }; };
  KRO._analyze = analyze; KRO._mapPage = mapPage; KRO._emw = emW; KRO._find = findStart; KRO._chain = chainCost; KRO._align = alignLine;
  g.KRO = KRO;
})(typeof window !== 'undefined' ? window : this);
