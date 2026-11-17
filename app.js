(function () {
  'use strict';

  /* ---------------------------------------------------------------
     Constants
  --------------------------------------------------------------- */
  var AUDIO_URL = 'sit-bell-v1.ogg'; // 2 h of silence, then the bell
  var BELL_AT = 7200;                // seconds into the file where the bell starts
  var MIN = 1, MAX = 120, DEFAULT = 10;
  var KEY = 'sit.minutes';
  var PPM = 12;                      // ruler: pixels per minute
  var SLOP = 8;                      // px a finger may wander and still count as a tap
  var HOLD_MS = 1500;                // hold this long to end a session

  var $ = function (id) { return document.getElementById(id); };
  var app = $('app');
  var minutesEl = $('minutes');
  var unitEl = $('unit');
  var statusEl = $('status');
  var hintEl = $('hint');
  var canvas = $('ruler');
  var ctx = canvas.getContext('2d');
  var dial = $('dial');
  var dctx = dial.getContext('2d');

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* ---------------------------------------------------------------
     Remembered time
  --------------------------------------------------------------- */
  function loadMinutes() {
    try {
      var v = parseInt(localStorage.getItem(KEY), 10);
      if (v >= MIN && v <= MAX) return v;
    } catch (e) {}
    return DEFAULT;
  }
  function saveMinutes(v) {
    try { localStorage.setItem(KEY, String(v)); } catch (e) {}
  }

  /* ---------------------------------------------------------------
     State
  --------------------------------------------------------------- */
  var chosen = loadMinutes(); // the picked whole minutes
  var pos = chosen;           // ruler position in minutes (fractional while moving)
  var mode = 'pick';          // 'pick' | 'run' | 'done'
  var sessionMinutes = 0;
  var sessionStart = 0;       // file position where this session began
  var pendingSeek = null;     // seek to apply once the audio is ready

  /* ---------------------------------------------------------------
     Audio. The phone plays this file through to the bell, so the
     timer keeps going with the screen off. The countdown is simply
     read from the track's position.
  --------------------------------------------------------------- */
  var audio = new Audio();
  audio.preload = 'metadata';
  audio.src = AUDIO_URL;          // works straight away (online)
  var audioSrc = AUDIO_URL;
  var blobUrl = null;

  // Then load the whole file into memory (from the offline cache): seeking
  // is instant and works without a connection.
  fetch(AUDIO_URL)
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.blob(); })
    .then(function (b) {
      blobUrl = URL.createObjectURL(b);
      if (mode === 'pick' && audio.paused) useSrc(blobUrl);
    })
    .catch(function () {});

  function useSrc(src) {
    audioSrc = src;
    audio.preload = 'auto';
    audio.src = src;
  }

  // Fully release the track: this also takes the media notification away.
  function resetAudio() {
    pendingSeek = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    useSrc(blobUrl || audioSrc);
  }

  audio.addEventListener('loadedmetadata', function () {
    if (pendingSeek !== null) {
      audio.currentTime = pendingSeek;
      pendingSeek = null;
    }
  });
  audio.addEventListener('play', function () { updateMediaState(); update(); });
  audio.addEventListener('pause', function () { updateMediaState(); update(); });
  audio.addEventListener('seeked', function () { updateMediaState(); update(); });
  audio.addEventListener('timeupdate', update);
  audio.addEventListener('ended', function () {
    if (mode === 'run') { mode = 'done'; render(); }
    clearMediaSession();
    resetAudio();
  });

  function remainingSeconds() {
    if (pendingSeek !== null) return sessionMinutes * 60;
    return Math.max(0, BELL_AT - audio.currentTime);
  }

  /* ---------------------------------------------------------------
     Media notification (lock screen): "Sit · N min", pause / stop
  --------------------------------------------------------------- */
  var ms = 'mediaSession' in navigator ? navigator.mediaSession : null;

  function setHandler(action, fn) {
    try { ms.setActionHandler(action, fn); } catch (e) {}
  }

  function setupMediaSession() {
    if (!ms) return;
    try {
      ms.metadata = new MediaMetadata({
        title: 'Sit',
        artist: sessionMinutes + ' min',
        artwork: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      });
    } catch (e) {}
    setHandler('play', function () { if (mode === 'run') audio.play().catch(function () {}); });
    setHandler('pause', function () { if (mode === 'run') audio.pause(); });
    setHandler('stop', function () { endSession(); stepBack(); });
    // No seeking: the lock-screen slider must not move the timer.
    ['seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack'].forEach(function (a) {
      setHandler(a, null);
    });
  }

  function updateMediaState() {
    if (!ms || mode === 'pick') return;
    try { ms.playbackState = audio.paused ? 'paused' : 'playing'; } catch (e) {}
    var dur = sessionMinutes * 60;
    if (!dur || pendingSeek !== null) return;
    try {
      ms.setPositionState({
        duration: dur,
        playbackRate: 1,
        position: clamp(audio.currentTime - sessionStart, 0, dur)
      });
    } catch (e) {}
  }

  function clearMediaSession() {
    if (!ms) return;
    try { ms.metadata = null; ms.playbackState = 'none'; } catch (e) {}
    try { ms.setPositionState(null); } catch (e) {}
  }

  /* ---------------------------------------------------------------
     Session flow
  --------------------------------------------------------------- */
  function startSession(n) {
    sessionMinutes = n;
    sessionStart = BELL_AT - n * 60;
    mode = 'run';
    // play() has to be called right here, inside the tap, or Android blocks it.
    if (audio.readyState >= 1) {
      audio.currentTime = sessionStart;
    } else {
      pendingSeek = sessionStart;
    }
    var p = audio.play();
    if (p && p.catch) p.catch(function () { render(); }); // blocked: shows "paused"
    history.pushState({ v: 'session' }, '', '#sitting');
    setupMediaSession();
    render();
    startTicker();
  }

  function togglePause() {
    if (audio.paused) audio.play().catch(function () {});
    else audio.pause();
  }

  // Stop early (hold, back button, notification stop).
  function endSession() {
    if (mode === 'run') {
      clearMediaSession();
      resetAudio();
    }
    // In 'done' the bell is left to fade out on its own.
    mode = 'pick';
    pos = chosen;
    stopTicker();
    render();
  }

  function stepBack() {
    if (history.state && history.state.v === 'session') history.back();
  }

  window.addEventListener('popstate', function () {
    var inSession = history.state && history.state.v === 'session';
    if (!inSession && mode !== 'pick') endSession();
  });

  // Called on a timer and on audio events: notices the bell arriving.
  function update() {
    if (mode === 'run' && pendingSeek === null && audio.readyState >= 1 &&
        (audio.currentTime >= BELL_AT - 0.02 || audio.ended)) {
      mode = 'done';
      stopTicker();
      updateMediaState();
    }
    render();
  }

  /* ---------------------------------------------------------------
     Rendering
  --------------------------------------------------------------- */
  function render() {
    var cls = mode + (holding && mode === 'run' ? ' holding' : '');
    if (app.className !== cls) app.className = cls;
    if (mode === 'pick') {
      setText(minutesEl, String(clamp(Math.round(pos), MIN, MAX)));
      minutesEl.hidden = false;
      unitEl.hidden = false;
      statusEl.hidden = true;
      hintEl.hidden = true;
      draw();
    } else if (mode === 'run') {
      var rem = remainingSeconds();
      setText(minutesEl, String(Math.ceil(rem / 60 - 1e-9)));
      minutesEl.hidden = false;
      var paused = audio.paused;
      statusEl.hidden = !paused;
      if (paused) setText(statusEl, 'paused');
      unitEl.hidden = paused;
      hintEl.hidden = !paused;
      if (paused) setText(hintEl, 'tap to resume · hold to end');
      drawDial(rem / (sessionMinutes * 60), paused);
    } else {
      minutesEl.hidden = true;
      unitEl.hidden = true;
      statusEl.hidden = false;
      setText(statusEl, 'done');
      hintEl.hidden = false;
      setText(hintEl, 'tap to return');
      drawDial(0, false);
    }
  }

  // Hold-to-end feedback: a line under the dial fills over the hold.
  var holding = false;
  function setHolding(on) {
    if (holding === on) return;
    holding = on;
    render();
  }

  function setText(el, t) { if (el.textContent !== t) el.textContent = t; }

  /* ---------------------------------------------------------------
     The ruler
  --------------------------------------------------------------- */
  var colors = {};
  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    colors.ink = cs.getPropertyValue('--ink').trim();
    colors.soft = cs.getPropertyValue('--ink-soft').trim();
    colors.dim = cs.getPropertyValue('--ink-dim').trim();
    colors.faint = cs.getPropertyValue('--ink-faint').trim();
    colors.font = cs.getPropertyValue('--serif').trim();
  }
  readColors();
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      readColors();
      render();
    });
  } catch (e) {}

  var dpr = 1;
  // Match a canvas's backing store to its on-screen size. Returns false while hidden.
  function fit(c) {
    dpr = window.devicePixelRatio || 1;
    var w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return false;
    var W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    return true;
  }
  window.addEventListener('resize', render);

  /* The dial: a faint ring with a mark per minute (every 5 past an hour),
     and an ink arc from the top for the time that is left. */
  function drawDial(frac, paused) {
    if (!fit(dial)) return;
    var s = dial.clientWidth;
    var c = s / 2, r = c - 4;
    dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dctx.clearRect(0, 0, s, s);

    dctx.strokeStyle = colors.faint;
    dctx.lineWidth = 1;
    dctx.beginPath();
    dctx.arc(c, c, r, 0, Math.PI * 2);
    dctx.stroke();

    var n = sessionMinutes || 1;
    var step = n <= 60 ? 1 : 5;
    dctx.beginPath();
    for (var i = 0; i < n; i += step) {
      var a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      var len = i === 0 ? 10 : 5;
      dctx.moveTo(c + Math.cos(a) * (r - 9), c + Math.sin(a) * (r - 9));
      dctx.lineTo(c + Math.cos(a) * (r - 9 - len), c + Math.sin(a) * (r - 9 - len));
    }
    dctx.stroke();

    frac = clamp(frac, 0, 1);
    if (frac > 0) {
      dctx.strokeStyle = paused ? colors.dim : colors.soft;
      dctx.lineWidth = 2.5;
      dctx.lineCap = 'round';
      dctx.beginPath();
      dctx.arc(c, c, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      dctx.stroke();
      dctx.lineCap = 'butt';
    }
  }

  function draw() {
    if (!fit(canvas)) return;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    var cx = w / 2;
    var tickColor = colors.soft;
    var lineColor = colors.ink;
    var top = 22;
    var span = cx / PPM + 2;
    var from = Math.max(0, Math.floor(pos - span));
    var to = Math.min(MAX, Math.ceil(pos + span));

    ctx.fillStyle = tickColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = 'italic 13px ' + colors.font;

    for (var m = from; m <= to; m++) {
      var x = cx + (m - pos) * PPM;
      var d = Math.abs(x - cx) / cx;
      if (d >= 1) continue;
      ctx.globalAlpha = 1 - Math.pow(d, 2.2); // ticks soften toward the edges
      var len = m % 10 === 0 ? 26 : m % 5 === 0 ? 18 : 10;
      var px = Math.round(x * dpr) / dpr;
      ctx.fillRect(px - 0.5, top, 1, len);
      if (m % 10 === 0) ctx.fillText(String(m), px, top + len + 17);
    }

    // the fixed centre line
    ctx.globalAlpha = 1;
    ctx.fillStyle = lineColor;
    ctx.fillRect(Math.round(cx * dpr) / dpr - 0.75, top - 14, 1.5, 48);
  }

  /* ---------------------------------------------------------------
     Ruler motion: drag, fling, snap to a whole minute
  --------------------------------------------------------------- */
  var animId = 0;
  function stopAnim() {
    if (animId) cancelAnimationFrame(animId);
    animId = 0;
  }

  function setPos(v) {
    pos = clamp(v, MIN, MAX);
    render();
  }

  function snap() {
    stopAnim();
    var target = clamp(Math.round(pos), MIN, MAX);
    var from = pos, t0 = 0, dur = 160;
    function step(t) {
      if (!t0) t0 = t;
      var k = Math.min(1, (t - t0) / dur);
      var e = 1 - Math.pow(1 - k, 3);
      pos = from + (target - from) * e;
      if (k >= 1) {
        animId = 0;
        pos = target;
        if (target !== chosen) { chosen = target; saveMinutes(chosen); }
        render();
        return;
      }
      render();
      animId = requestAnimationFrame(step);
    }
    animId = requestAnimationFrame(step);
  }

  function fling(pxPerMs) {
    stopAnim();
    if (Math.abs(pxPerMs) < 0.3) { snap(); return; }
    pxPerMs = clamp(pxPerMs, -3, 3); // a hard flick glides ~30 minutes, not the whole ruler
    var v = -pxPerMs / PPM; // minutes per ms (dragging left adds minutes)
    var last = 0;
    function step(t) {
      if (!last) last = t;
      var dt = Math.min(48, t - last);
      last = t;
      pos += v * dt;
      v *= Math.pow(0.992, dt);
      if (pos <= MIN || pos >= MAX) { pos = clamp(pos, MIN, MAX); snap(); return; }
      if (Math.abs(v) * PPM < 0.04) { snap(); return; }
      render();
      animId = requestAnimationFrame(step);
    }
    animId = requestAnimationFrame(step);
  }

  /* ---------------------------------------------------------------
     Gestures. The whole screen is the control:
       pick: slide to set, tap to begin
       run:  tap to pause / resume, hold to end
       done: tap to go back to the ruler
  --------------------------------------------------------------- */
  var g = null;

  app.addEventListener('pointerdown', function (e) {
    if (g || e.isPrimary === false) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try { app.setPointerCapture(e.pointerId); } catch (err) {}
    g = {
      id: e.pointerId, mode: mode,
      x: e.clientX, y: e.clientY, lastX: e.clientX,
      moved: false, wasMoving: false, holdFired: false, holdTimer: 0,
      samples: [{ x: e.clientX, t: e.timeStamp }]
    };
    if (mode === 'pick' && animId) { stopAnim(); g.wasMoving = true; render(); }
    if (mode === 'run') {
      var mine = g;
      setHolding(true);
      g.holdTimer = setTimeout(function () {
        if (g === mine && !mine.moved && mode === 'run') {
          mine.holdFired = true;
          setHolding(false);
          endSession();
          stepBack();
        }
      }, HOLD_MS);
    }
  });

  app.addEventListener('pointermove', function (e) {
    if (!g || e.pointerId !== g.id) return;
    if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) > SLOP) {
      g.moved = true;
      clearTimeout(g.holdTimer);
      setHolding(false);
    }
    if (g.mode === 'pick' && mode === 'pick' && g.moved) {
      setPos(pos - (e.clientX - g.lastX) / PPM);
      g.lastX = e.clientX;
      g.samples.push({ x: e.clientX, t: e.timeStamp });
      while (g.samples.length > 2 && e.timeStamp - g.samples[0].t > 100) g.samples.shift();
    }
  });

  function velocity(s, x, t) {
    var first = null;
    for (var i = 0; i < s.length; i++) if (t - s[i].t <= 100) { first = s[i]; break; }
    if (!first || t - first.t < 1) return 0;
    return (x - first.x) / (t - first.t);
  }

  app.addEventListener('pointerup', function (e) {
    if (!g || e.pointerId !== g.id) return;
    var gg = g;
    g = null;
    clearTimeout(gg.holdTimer);
    setHolding(false);
    if (gg.holdFired || gg.mode !== mode) return; // the screen changed mid-gesture

    if (mode === 'pick') {
      if (gg.moved) fling(velocity(gg.samples, e.clientX, e.timeStamp));
      else if (gg.wasMoving) snap();
      else startSession(chosen);
    } else if (mode === 'run') {
      if (!gg.moved) togglePause();
    } else if (mode === 'done') {
      if (!gg.moved) { endSession(); stepBack(); }
    }
  });

  app.addEventListener('pointercancel', function (e) {
    if (!g || e.pointerId !== g.id) return;
    clearTimeout(g.holdTimer);
    setHolding(false);
    var wasDragging = g.mode === 'pick' && (g.moved || g.wasMoving);
    g = null;
    if (wasDragging && mode === 'pick') snap();
  });

  app.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // Keyboard, for completeness: arrows set, Space / Enter acts like a tap.
  document.addEventListener('keydown', function (e) {
    if (mode === 'pick' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      stopAnim();
      chosen = clamp(chosen + (e.key === 'ArrowRight' ? 1 : -1), MIN, MAX);
      saveMinutes(chosen);
      pos = chosen;
      render();
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (mode === 'pick') { stopAnim(); pos = chosen; startSession(chosen); }
      else if (mode === 'run') togglePause();
      else { endSession(); stepBack(); }
    } else if (e.key === 'Escape' && mode !== 'pick') {
      endSession(); stepBack();
    }
  });

  /* ---------------------------------------------------------------
     Ticker: redraw the drifting ruler while visible
  --------------------------------------------------------------- */
  var ticker = 0;
  function startTicker() {
    stopTicker();
    if (document.visibilityState === 'visible') ticker = setInterval(update, 250);
  }
  function stopTicker() {
    if (ticker) clearInterval(ticker);
    ticker = 0;
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      update();
      if (mode === 'run') startTicker();
    } else {
      stopTicker();
    }
  });

  /* ---------------------------------------------------------------
     Start
  --------------------------------------------------------------- */
  history.replaceState({ v: 'pick' }, '', location.pathname + location.search);
  render();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }
})();
