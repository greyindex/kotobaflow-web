// Page-turn motion for the book layout (js/core/book-pager.js), added
// 2026-10-15 at the user's request. The pager moves the real content to the
// destination spread before a turn plays, so the motion is purely additive: a
// transient layer over the frame shows frozen copies of the turning pages and
// is removed when the motion ends or the next turn begins.
//
// The leaf hinged at the spine and the soft paper curl (a chain of nested
// strips that each bend a little more than the last) follow Open Book Reader
// (MIT, (c) 2026 Peach Studio; resources/licenses/THIRD_PARTY_NOTICES.md).
// A lesson here can run to 40+ pages and one full copy takes ~15 ms to lay
// out, so every copy is pruned to its own page instead: content before the
// element it starts at (the nearest one beginning at the top of a page, or in
// running text the nearest one beginning on an earlier page) and after the
// page stays only as hidden shells (sibling selectors still match, skipped
// counters are carried over), and the side being revealed is the live page
// itself. A copy that does not paginate like the live page is dropped and the
// turn falls back to a slide. With reduced motion a page turns instantly.
(function (window) {
  'use strict';

  var app = window.JPLearn || (window.JPLearn = {});

  var LOOKBACK = 12; // pages searched back for an element beginning at a page top
  var FLAT = 0.38; // spine-side share of a curling page that stays flat
  var STRIPS = 8; // strips across the curling part
  // Peak bend per strip. The free edge's net angle (leaf + all strips) must
  // stay inside ±90° while that face is shown, or its strips cull away.
  var BEND = 10;
  var DURATION = { spread: 760, page: 600, slide: 220 };
  // The turn's timing curve as cubic-bezier control points; the shading
  // samples the same curve the transforms play on.
  var CURVE = [0.42, 0, 0.58, 1];
  // The reading light sits a little right of the reader, so a page darkens
  // as it lifts towards the spine and clears again as it lands.
  var LIGHT = (20 * Math.PI) / 180;
  var SAMPLES = 24; // shading keyframes per face

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function div(className) {
    var element = document.createElement('div');
    element.className = className;
    return element;
  }

  // CSS cubic-bezier() as a function of time.
  function cubic(points) {
    function axis(a, b, s) {
      return 3 * a * s * (1 - s) * (1 - s) + 3 * b * s * s * (1 - s) + s * s * s;
    }
    return function (t) {
      var lo = 0;
      var hi = 1;
      for (var i = 0; i < 24; i++) {
        var mid = (lo + hi) / 2;
        if (axis(points[0], points[2], mid) < t) lo = mid;
        else hi = mid;
      }
      return axis(points[1], points[3], (lo + hi) / 2);
    };
  }

  // Value of [offset, value] keyframes at progress `p`, as WAAPI interpolates them.
  function interpolate(steps, p) {
    for (var i = 1; i < steps.length; i++) {
      if (p <= steps[i][0]) {
        var a = steps[i - 1];
        var b = steps[i];
        return a[1] + ((b[1] - a[1]) * (p - a[0])) / (b[0] - a[0] || 1);
      }
    }
    return steps[steps.length - 1][1];
  }

  // How much darker than a page lying flat a face looks when its normal is
  // turned `angle` degrees about the spine (0 faces the reader).
  function darkness(angle) {
    var lit = Math.cos((angle * Math.PI) / 180 - LIGHT) / Math.cos(LIGHT);
    return Math.max(0, Math.min(1, 1 - lit));
  }

  // Live geometry of the content, measured once per turn phase. Positions are
  // in layout px: client rects are divided by the display zoom. Sizes keep
  // their fractions: a copy half a pixel taller fits one more line per column
  // and breaks long paragraphs differently.
  function context(pager) {
    var body = pager.body;
    var bounds = body.getBoundingClientRect();
    if (!bounds.width || !body.clientWidth || !(pager.column > 1)) return null;
    var style = window.getComputedStyle(body);
    var scale = body.clientWidth / bounds.width;
    var padLeft = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.borderLeftWidth) || 0);
    var padTop = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.borderTopWidth) || 0);
    var frame = pager.frame.getBoundingClientRect();
    return {
      body: body,
      style: style,
      scale: scale,
      left: bounds.left + padLeft / scale,
      top: bounds.top + padTop / scale,
      padLeft: padLeft,
      padTop: padTop,
      scroll: body.scrollLeft,
      pitch: pager.column,
      width: bounds.width * scale,
      height: bounds.height * scale,
      offsetLeft: (bounds.left - frame.left) * scale - pager.frame.clientLeft,
      offsetTop: (bounds.top - frame.top) * scale - pager.frame.clientTop,
      spans: new Map(),
    };
  }

  // First and last page an element occupies, and how far below the top of
  // its first page it begins. Null for elements without boxes.
  function span(ctx, element) {
    if (ctx.spans.has(element)) return ctx.spans.get(element);
    var rects = element.getClientRects();
    var result = null;
    for (var i = 0; i < rects.length; i++) {
      var rect = rects[i];
      if (!rect.width && !rect.height) continue;
      var x0 = (rect.left - ctx.left) * ctx.scale + ctx.scroll;
      var x1 = (rect.right - ctx.left) * ctx.scale + ctx.scroll;
      var first = Math.max(0, Math.floor((x0 + 2) / ctx.pitch));
      var last = Math.max(first, Math.floor((x1 - 2) / ctx.pitch));
      if (!result) result = { first: first, last: last, top: (rect.top - ctx.top) * ctx.scale };
      else {
        if (first < result.first) result.first = first;
        if (last > result.last) result.last = last;
      }
    }
    ctx.spans.set(element, result);
    return result;
  }

  function inFlow(element) {
    var style = window.getComputedStyle(element);
    return style.position !== 'absolute' && style.position !== 'fixed' && style.float === 'none';
  }

  // Whether an element sets its content in lines: text, or inline elements
  // such as the sentence spans of a narrated passage. Copies keep it whole,
  // since hiding part of it would rewrap the rest.
  function hasText(element) {
    for (var node = element.firstChild; node; node = node.nextSibling) {
      if (node.nodeType === 3 && /\S/.test(node.nodeValue)) return true;
      if (node.nodeType === 1 && /^(inline|ruby|contents)/.test(window.getComputedStyle(node).display))
        return true;
    }
    return false;
  }

  function firstRect(element) {
    var rects = element.getClientRects();
    for (var i = 0; i < rects.length; i++) if (rects[i].width || rects[i].height) return rects[i];
    return null;
  }

  // The chain of elements from `parent` down to the first one whose box
  // begins on `page`; the elements above it in the chain continue from an
  // earlier page. With `top` it must begin at the top of the page, so the
  // copy shows the whole page; otherwise it may begin lower, for a copy that
  // starts on a page it never shows. Null when no element begins on the page
  // (it holds the middle of running text), or when a float that the copy
  // would leave out shifts lines on it. `items`: the children of a grid,
  // flex or table box, which place each other.
  function startOn(ctx, parent, page, top, items) {
    if (hasText(parent)) return null;
    for (var child = parent.firstElementChild; child; child = child.nextElementSibling) {
      var box = span(ctx, child);
      if (!box || box.last < page) continue;
      if (!inFlow(child)) {
        if (window.getComputedStyle(child).float !== 'none' && (box.first < page || !top)) return null;
        continue;
      }
      if (box.first > page) return null;
      if (box.first === page) {
        if (!top) return [{ element: child, top: box.top }];
        // Above it on this page there is at most its own (forced-break) margin.
        var margin = parseFloat(window.getComputedStyle(child).marginTop) || 0;
        return box.top <= margin + 1 ? [{ element: child, top: box.top }] : null;
      }
      // The page begins inside this element. A copy can cut between stacked
      // blocks anywhere, but inside a grid, flex or table box only at an item
      // that begins at the top of the page; an item cut by the page stays whole.
      var inner = null;
      if (!items) {
        var blocks = /^(block|list-item|flow-root)$/.test(window.getComputedStyle(child).display);
        inner = startOn(ctx, child, page, top || !blocks, !blocks);
      }
      if (inner) return [{ element: child }].concat(inner);
      // Below the top of the page, the next element can start the copy if
      // this one ends on the page.
      if (top || box.last > page) return null;
    }
    return null;
  }

  // Live, the top margins of first children that collapse through the start
  // element merge into its own margin, or vanish with it at a page break. The
  // copy places the start element by its margin alone, so those margins are
  // zeroed: a child that begins where its parent begins had its margin
  // collapsed (margins inside padding, borders or flex and grid boxes keep
  // the child lower).
  function collapseFirstMargins(live, copy) {
    while (live && copy && live.children.length === copy.children.length && !hasText(live)) {
      var style = window.getComputedStyle(live);
      if (parseFloat(style.paddingTop) || parseFloat(style.borderTopWidth)) return;
      var index = 0;
      var child = live.firstElementChild;
      while (child && !firstRect(child)) {
        child = child.nextElementSibling;
        index++;
      }
      if (!child || !inFlow(child)) return;
      var outer = firstRect(live);
      var inner = firstRect(child);
      if (!outer || Math.abs(inner.top - outer.top) > 0.5) return;
      if (parseFloat(window.getComputedStyle(child).marginTop)) copy.children[index].style.marginTop = '0px';
      live = child;
      copy = copy.children[index];
    }
  }

  function shell(element) {
    var copy = element.cloneNode(false);
    copy.setAttribute('style', 'display:none');
    return copy;
  }

  // Counter increments of an element as [name, amount] pairs, including the
  // implicit list-item one that computed styles leave out.
  function incrementsOf(element) {
    var style = window.getComputedStyle(element);
    var value = style.counterIncrement;
    var parts = value && value !== 'none' ? value.trim().split(/\s+/) : [];
    var pairs = [];
    for (var i = 0; i < parts.length; i++) {
      var name = parts[i];
      var amount = 1;
      if (/^-?\d+$/.test(parts[i + 1] || '')) amount = Number(parts[++i]);
      pairs.push([name, amount]);
    }
    var listed = pairs.some(function (pair) {
      return pair[0] === 'list-item';
    });
    if (!listed && style.display === 'list-item') pairs.push(['list-item', 1]);
    return pairs;
  }

  function addIncrements(totals, element) {
    totals = totals || {};
    incrementsOf(element).forEach(function (pair) {
      totals[pair[0]] = (totals[pair[0]] || 0) + pair[1];
    });
    return totals;
  }

  // Hidden siblings no longer count; the first kept one counts for them too.
  function carryCounters(live, copy, skipped) {
    var totals = addIncrements(Object.assign({}, skipped), live);
    var value = Object.keys(totals)
      .filter(function (name) {
        return totals[name] !== 0;
      })
      .map(function (name) {
        return name + ' ' + totals[name];
      })
      .join(' ');
    if (value) copy.style.counterIncrement = value;
  }

  // Images keep the box the live page gives them while a copy loads them,
  // fractions included.
  function pinMedia(live, copy) {
    var originals = live.tagName === 'IMG' ? [live] : live.getElementsByTagName('img');
    if (!originals.length) return;
    var copies = copy.tagName === 'IMG' ? [copy] : copy.getElementsByTagName('img');
    for (var i = 0; i < originals.length && i < copies.length; i++) {
      var style = window.getComputedStyle(originals[i]);
      copies[i].style.width = style.width;
      copies[i].style.height = style.height;
    }
  }

  // A minimal copy of the first block after the page: enough of its start to
  // fill the next page, so the page still breaks before it as it does live.
  // Without it, a trimmed container's end padding moves up and can push the
  // last block of the page over.
  function lead(live) {
    if (!live.firstElementChild || hasText(live) || live.getElementsByTagName('*').length <= 24) {
      var whole = live.cloneNode(true);
      pinMedia(live, whole);
      return whole;
    }
    var copy = live.cloneNode(false);
    var first = true;
    for (var node = live.firstChild; node; node = node.nextSibling) {
      if (node.nodeType !== 1) copy.appendChild(node.cloneNode(false));
      else if (first && inFlow(node)) {
        copy.appendChild(lead(node));
        first = false;
      } else copy.appendChild(shell(node));
    }
    return copy;
  }

  // Copies the children of `live` into `copy`, keeping pages [start, page]
  // laid out as they are and hiding everything outside them.
  function fill(ctx, live, copy, start, page, path, depth, checks) {
    var skipped = null;
    var led = null;
    var step = path[depth];
    // Elements before the start's branch end above it, even on its page.
    var before = !!step;
    for (var node = live.firstChild; node; node = node.nextSibling) {
      if (node.nodeType !== 1) {
        copy.appendChild(node.cloneNode(false));
        continue;
      }
      var onPath = !!step && step.element === node;
      if (onPath) before = false;
      var box = span(ctx, node);
      if (!onPath && box && (box.last < start || (before && inFlow(node)))) {
        skipped = addIncrements(skipped, node);
        copy.appendChild(shell(node));
        continue;
      }
      if (!onPath && box && box.first > page && inFlow(node)) {
        // The first block after the page leads, with the rest of its row in a
        // grid or a wrapped flex line, where the tallest item sets the height.
        var sameRow = led && box.first === led.first && Math.abs(box.top - led.top) < 1;
        copy.appendChild(!led || sameRow ? lead(node) : shell(node));
        if (!led) led = box;
        continue;
      }
      var continues = onPath && depth + 1 < path.length;
      var kept;
      if (continues || (box && box.last > page && node.firstElementChild && !hasText(node))) {
        // Continued from an earlier page (no top edge there) or running past
        // this one (its tail is trimmed): copy it level by level.
        kept = node.cloneNode(false);
        if (continues) {
          kept.style.marginTop = '0px';
          kept.style.paddingTop = '0px';
          kept.style.borderTopWidth = '0px';
          kept.style.breakBefore = 'auto';
        }
        fill(ctx, node, kept, start, page, continues ? path : [], continues ? depth + 1 : 0, checks);
      } else {
        kept = node.cloneNode(true);
        pinMedia(node, kept);
      }
      if (onPath && !continues) {
        // The start: it sits where the live page places it.
        kept.style.marginTop = step.top + 'px';
        kept.style.breakBefore = 'auto';
        collapseFirstMargins(node, kept);
      }
      if (skipped) {
        carryCounters(node, kept, skipped);
        skipped = null;
      }
      if (box && box.first >= start && box.first <= page) checks.push({ copy: kept, box: box });
      copy.appendChild(kept);
    }
  }

  // The nearest page from `from` back, at most `reach` pages before `page`,
  // where `startOn` finds a start.
  function nearestStart(ctx, page, from, top, reach) {
    for (var at = from; at >= 0 && page - at <= reach; at--) {
      var path = startOn(ctx, ctx.body, at, top);
      if (path) return { page: at, path: path };
    }
    return null;
  }

  // A detached copy of the content that lays out `page` like the live one.
  // It starts at the top of the nearest page an element begins at; failing
  // that (running text without a clean page start), at the nearest element
  // beginning on an earlier page, however far back: one paragraph of a
  // classic can run over twenty pages.
  function snapshot(ctx, page) {
    var found =
      nearestStart(ctx, page, page, true, LOOKBACK) || nearestStart(ctx, page, page - 1, false, page);
    if (!found) return null;
    var start = found.page;
    var path = found.path;
    var root = ctx.body.cloneNode(false);
    var checks = [];
    fill(ctx, ctx.body, root, start, page, path, 0, checks);
    root.removeAttribute('id');
    root.removeAttribute('tabindex');
    // Copies never join radio groups, label targets or fragment links.
    var marked = root.querySelectorAll('[id], [name]');
    for (var i = 0; i < marked.length; i++) {
      marked[i].removeAttribute('id');
      marked[i].removeAttribute('name');
    }
    // The live body takes these from `.book-frame > .book-body`, which a copy
    // inside the turn layer no longer matches. Its own inline style, such as
    // custom properties a module sets on it, stays.
    var style = ctx.style;
    var layout = {
      position: 'absolute',
      top: ctx.offsetTop + 'px',
      left: '0',
      'box-sizing': 'border-box',
      width: ctx.width + 'px',
      'min-width': '0',
      'max-width': 'none',
      height: ctx.height + 'px',
      'min-height': '0',
      'max-height': 'none',
      margin: '0',
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].join(' '),
      border: '0',
      'border-radius': '0',
      background: 'none',
      'box-shadow': 'none',
      overflow: 'visible',
      'column-count': style.columnCount,
      'column-gap': style.columnGap,
      'column-fill': 'auto',
    };
    Object.keys(layout).forEach(function (name) {
      root.style.setProperty(name, layout[name]);
    });
    return { root: root, start: start, page: page, checks: checks, probe: null };
  }

  // Places a copy of `snap` so its page fills slot `slot` (0 left, 1 right of
  // the spread) of a window whose left edge sits at frame x `origin`. The
  // first placement is the copy the turn verifies before it plays.
  function placeCopy(snap, geo, slot, origin) {
    var copy = snap.probe ? snap.root.cloneNode(true) : snap.root;
    if (!snap.probe) snap.probe = copy;
    copy.style.left = geo.left - origin + 'px';
    copy.style.transform = 'translateX(' + (slot - (snap.page - snap.start)) * geo.pitch + 'px)';
    return copy;
  }

  // The probe paginates like the live content: every element measured on the
  // live pages starts on the same page at the same height.
  function verify(ctx, snap) {
    if (!snap || !snap.probe) return true;
    var origin = snap.probe.getBoundingClientRect();
    for (var i = 0; i < snap.checks.length; i++) {
      var check = snap.checks[i];
      var rects = check.copy.getClientRects();
      var rect = null;
      for (var j = 0; j < rects.length && !rect; j++) if (rects[j].width || rects[j].height) rect = rects[j];
      var x = rect ? (rect.left - origin.left) * ctx.scale - ctx.padLeft : 0;
      var page = Math.max(0, Math.floor((x + 2) / ctx.pitch)) + snap.start;
      var top = rect ? (rect.top - origin.top) * ctx.scale - ctx.padTop : NaN;
      if (!rect || page !== check.box.first || !(Math.abs(top - check.box.top) <= 1.5)) {
        app.bookTurn.lastFallback = {
          page: snap.page,
          start: snap.start,
          element: String(check.copy.className || check.copy.tagName).slice(0, 60),
          live: [check.box.first, Math.round(check.box.top)],
          copy: [page, Math.round(top)],
        };
        return false;
      }
    }
    return true;
  }

  function geometry(pager, ctx) {
    var spread = pager.perSpread === 2;
    var width = pager.frame.clientWidth;
    var spine = spread ? ctx.offsetLeft + ctx.width / 2 : 0;
    return {
      spread: spread,
      width: width,
      height: ctx.offsetTop + ctx.height,
      spine: spine,
      leaf: width - spine,
      left: ctx.offsetLeft,
      pitch: ctx.pitch,
    };
  }

  // A flat page that stays put while the leaf turns over it.
  function stillPage(snap, geo, slot, x, width, gutter) {
    var page = div('book-flip-page' + (gutter ? ' book-flip-gutter-' + gutter : ''));
    page.style.left = x + 'px';
    page.style.width = width + 'px';
    page.appendChild(placeCopy(snap, geo, slot, x));
    return page;
  }

  // The back of a turning leaf: the page it carries over the spine, flat.
  function backFace(snap, geo, origin) {
    var element = div('book-flip-face is-back book-flip-gutter-r');
    element.appendChild(placeCopy(snap, geo, 0, origin));
    var shade = div('book-flip-shade');
    element.appendChild(shade);
    return { element: element, shades: [{ element: shade, bend: 0 }], back: true };
  }

  // The front of a curling leaf: a flat spine-side part, then strips nested
  // at each other's free edge so their bends add up to a paper curve. Each
  // part shades with two opposed ramps, one per edge, so the tone runs on
  // smoothly across the creases; `bend` counts the strip bends at that edge.
  function curlFront(leaf, snap, geo, slot, gutter) {
    var widths = [geo.leaf * FLAT];
    for (var i = 0; i < STRIPS; i++) widths.push((geo.leaf * (1 - FLAT)) / STRIPS);
    var parent = leaf;
    var offset = 0;
    var parts = [];
    widths.forEach(function (width, index) {
      var strip = div('book-flip-strip');
      strip.style.width = width + 'px';
      var part = div(
        'book-flip-face is-front' + (index === 0 && gutter ? ' book-flip-gutter-' + gutter : ''),
      );
      // A 1px overlap under the next strip hides hairline seams as they bend.
      part.style.width = width + (index < widths.length - 1 ? 1 : 0) + 'px';
      part.appendChild(placeCopy(snap, geo, slot, geo.spine + offset));
      var inner = div('book-flip-shade is-in');
      var outer = div('book-flip-shade is-out');
      part.appendChild(inner);
      part.appendChild(outer);
      strip.appendChild(part);
      parent.appendChild(strip);
      parent = strip;
      offset += width;
      parts.push({
        strip: index ? strip : null,
        shades: [
          { element: inner, bend: Math.max(0, index - 0.5) },
          { element: outer, bend: index < STRIPS ? index + 0.5 : index },
        ],
        back: false,
      });
    });
    return parts;
  }

  function cast(className, x, width) {
    var element = div('book-flip-cast ' + className);
    element.style.left = x + 'px';
    element.style.width = width + 'px';
    return element;
  }

  function end(pager) {
    var turn = pager && pager._turn;
    if (!turn) return;
    pager._turn = null;
    turn.animations.forEach(function (animation) {
      try {
        animation.cancel();
      } catch (e) {
        /* Already finished. */
      }
    });
    if (turn.layer) turn.layer.remove();
    pager.frame.classList.remove('is-turning');
  }

  function track(pager, turn) {
    pager._turn = turn;
    if (turn.layer) pager.frame.classList.add('is-turning');
    turn.animations[0].finished
      .then(function () {
        if (pager._turn === turn) end(pager);
      })
      .catch(function () {
        /* Cancelled by end(); already torn down. */
      });
  }

  // Short eased slide of the live content towards the side turned to.
  function slide(pager, forward) {
    if (!pager.body.animate) return;
    var from = forward ? 28 : -28;
    track(pager, {
      layer: null,
      animations: [
        pager.body.animate(
          [
            { transform: 'translateX(' + from + 'px)', opacity: 0.35 },
            { transform: 'none', opacity: 1 },
          ],
          { duration: DURATION.slide, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' },
        ),
      ],
    });
  }

  // When the strips bend, as [offset, share of the peak]. The bend lives only
  // while the strips face the reader and is flat again by edge-on, so a
  // culled strip never exposes the page behind it.
  function bendPlan(spread, forward) {
    if (!spread)
      return [
        [0, 0],
        [0.5, 1],
        [1, 0],
      ];
    return forward
      ? [
          [0, 0],
          [0.3, 1],
          [0.5, 0],
          [1, 0],
        ]
      : [
          [0, 0],
          [0.5, 0],
          [0.7, 1],
          [1, 0],
        ];
  }

  // Builds and plays the 3D turn; false when a copy cannot be trusted.
  function play3d(pager, plan) {
    var ctx = context(pager);
    if (!ctx) return false;
    var geo = geometry(pager, ctx);
    var forward = plan.forward;
    var spread = geo.spread;
    var before = plan.before;
    var source = plan.from * pager.perSpread;
    var target = plan.to * pager.perSpread;
    // The incoming page carried by the leaf; forward single pages reveal the
    // live page instead.
    var incoming = null;
    if (spread) incoming = snapshot(ctx, forward ? target : target + 1);
    else if (!forward) incoming = snapshot(ctx, target);
    if ((spread || !forward) && !incoming) return false;

    var layer = div('book-flip-layer');
    layer.setAttribute('aria-hidden', 'true');
    layer.setAttribute('inert', '');
    layer.style.width = geo.width + 'px';
    layer.style.height = geo.height + 'px';
    layer.style.perspective = Math.round(Math.max(geo.leaf, 280) * (spread ? 6.5 : 5)) + 'px';

    var leaf = div('book-flip-leaf');
    leaf.style.left = geo.spine + 'px';
    leaf.style.width = geo.leaf + 'px';
    var faces = [];
    // The page under the leaf as it lifts, and the page it lands on.
    var revealed = null;
    var landing = null;

    if (spread) {
      var left = { x: 0, width: geo.spine };
      var right = { x: geo.spine, width: geo.leaf };
      var still = forward ? left : right;
      layer.appendChild(
        stillPage(
          before[forward ? source : source + 1],
          geo,
          forward ? 0 : 1,
          still.x,
          still.width,
          forward ? 'r' : 'l',
        ),
      );
      landing = cast(forward ? 'is-landing is-left' : 'is-landing is-right', still.x, still.width);
      revealed = cast(
        forward ? 'is-right' : 'is-left',
        forward ? right.x : left.x,
        forward ? right.width : left.width,
      );
      // Front: the right-hand page at rest; back: the left-hand page after it lands.
      faces = curlFront(leaf, forward ? before[source + 1] : incoming, geo, 1, 'l');
      var back = backFace(forward ? incoming : before[source], geo, geo.spine - geo.leaf);
      leaf.appendChild(back.element);
      faces.push(back);
    } else {
      if (forward) revealed = cast('is-page', 0, geo.width);
      else {
        layer.appendChild(stillPage(before[source], geo, 0, 0, geo.width, ''));
        landing = cast('is-landing is-page', 0, geo.width);
      }
      faces = curlFront(leaf, forward ? before[source] : incoming, geo, 0, '');
    }
    if (landing) layer.appendChild(landing);
    if (revealed) layer.appendChild(revealed);
    layer.appendChild(leaf);
    pager.frame.appendChild(layer);

    var snaps = [incoming].concat(
      Object.keys(before).map(function (key) {
        return before[key];
      }),
    );
    for (var i = 0; i < snaps.length; i++) {
      if (!verify(ctx, snaps[i])) {
        layer.remove();
        return false;
      }
    }

    // Verified flat; now arm the 3D pose and play.
    var duration = DURATION[spread ? 'spread' : 'page'];
    var down = spread ? -180 : -90;
    var from = forward ? 0 : down;
    var to = forward ? down : 0;
    leaf.classList.add('is-armed');
    leaf.style.transform = 'rotateY(' + from + 'deg)';
    var timing = {
      duration: duration,
      easing: 'cubic-bezier(' + CURVE.join(', ') + ')',
      fill: 'forwards',
    };
    var animations = [
      leaf.animate(
        [{ transform: 'rotateY(' + from + 'deg)' }, { transform: 'rotateY(' + to + 'deg)' }],
        timing,
      ),
    ];
    var plan3d = bendPlan(spread, forward);
    var bend = plan3d.map(function (step) {
      return { offset: step[0], transform: 'rotateY(' + step[1] * BEND + 'deg)' };
    });
    // Each face shades by its angle to the light along the same curve.
    var at = cubic(CURVE);
    var linear = { duration: duration, easing: 'linear', fill: 'forwards' };
    faces.forEach(function (part) {
      if (part.strip) animations.push(part.strip.animate(bend, timing));
      part.shades.forEach(function (shade) {
        var frames = [];
        for (var i = 0; i <= SAMPLES; i++) {
          var t = i / SAMPLES;
          var angle = from + (to - from) * at(t);
          angle += shade.bend * BEND * interpolate(plan3d, at(t)) + (part.back ? 180 : 0);
          frames.push({ offset: t, opacity: Number(darkness(angle).toFixed(3)) });
        }
        animations.push(shade.element.animate(frames, linear));
      });
    });
    // The lifted leaf shades the page it uncovers, then the page it lands on.
    if (revealed)
      animations.push(
        revealed.animate(
          [
            { offset: 0, opacity: 1 },
            { offset: 0.35, opacity: 0.8 },
            { offset: 0.6, opacity: 0 },
            { offset: 1, opacity: 0 },
          ],
          timing,
        ),
      );
    if (landing)
      animations.push(
        landing.animate(
          [
            { offset: 0, opacity: 0 },
            { offset: 0.5, opacity: 0 },
            { offset: 0.85, opacity: 1 },
            { offset: 1, opacity: 0 },
          ],
          timing,
        ),
      );
    track(pager, { layer: layer, animations: animations });
    return true;
  }

  app.bookTurn = {
    // Called by the pager before it moves from spread `from` to `to`, while
    // the old pages are still laid out. Returns the turn to play once the
    // destination is in place, or null for an instant turn.
    prepare: function (pager, from, to) {
      end(pager);
      if (prefersReducedMotion() || from === to || !pager.body.animate) return null;
      var forward = to > from;
      var ctx = context(pager);
      var before = {};
      var first = from * pager.perSpread;
      for (var page = first; ctx && page < first + pager.perSpread; page++) {
        // A single-page turn only needs the page it turns away from.
        before[page] = snapshot(ctx, page);
        if (!before[page]) ctx = null;
      }
      var plan = { forward: forward, from: from, to: to, before: before };
      return {
        play: function () {
          if (!pager.frame.isConnected) return;
          if (!ctx || !play3d(pager, plan)) slide(pager, forward);
        },
      };
    },
    end: end,
    isTurning: function (pager) {
      return !!(pager && pager._turn);
    },
  };
})(window);
