;(function (W, D, C) {
  'use strict';

  /* ── anti-iframe (always active, even for the owner) ─────────── */
  try {
    if (W.top !== W.self) { W.top.location = W.self.location; }
  } catch (e) {
    W.location.href = 'about:blank';
  }

  /* ── owner bypass ────────────────────────────────────────────── */
  function isOwner() {
    try {
      return !!(
        localStorage.getItem('xcm_owner') ||
        sessionStorage.getItem('xcm_api_key')
      );
    } catch (e) {
      return false;
    }
  }

  if (isOwner()) return;

  /* ── save real console.log BEFORE we noop it ────────────────── */
  var _origLog = C.log.bind(C);
  var _tripped = false;
  var _strikes = 0;

  /* ── lockdown screen (no reload loop) ───────────────────────── */
  function lockdown() {
    if (_tripped || isOwner()) return;
    _tripped = true;
    try {
      D.documentElement.innerHTML =
        '<body style="margin:0;height:100dvh;display:flex;flex-direction:column;' +
        'align-items:center;justify-content:center;background:#08090d;font-family:monospace">' +
        '<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<rect width="64" height="64" rx="12" fill="#08090d"/>' +
        '<line x1="14" y1="12" x2="50" y2="52" stroke="url(#g)" stroke-width="7" stroke-linecap="round"/>' +
        '<line x1="50" y1="12" x2="14" y2="52" stroke="url(#g)" stroke-width="7" stroke-linecap="round"/>' +
        '<defs><linearGradient id="g" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">' +
        '<stop stop-color="#6e5cff"/><stop offset="1" stop-color="#0ff4c6"/></linearGradient></defs></svg>' +
        '<p style="margin:24px 0 8px;color:#6e5cff;font-size:1rem;letter-spacing:.05em">RESTRICTED</p>' +
        '<p style="margin:0;color:rgba(255,255,255,.3);font-size:.75rem">Inspection tools are not permitted</p>' +
        '</body>';
    } catch (e) {}
  }

  /* ── silence console ────────────────────────────────────────── */
  var _noop = function () {};
  ['log','debug','info','warn','error','table','dir','dirxml',
   'assert','group','groupCollapsed','groupEnd','count','countReset',
   'clear','time','timeEnd','timeLog','timeStamp','trace',
   'profile','profileEnd'].forEach(function (m) {
    try { C[m] = _noop; } catch (e) {}
  });

  /* ── DevTools detection ──────────────────────────────────────── */
  /* Uses two independent signals. Both must agree before striking. */
  /* Requires 2 consecutive strikes to trigger lockdown — prevents  */
  /* a single false positive from nuking the page.                  */
  setInterval(function () {
    if (isOwner()) return;

    /* Signal 1: window size delta — fires when DevTools docked     */
    /* to bottom or side (threshold 160 px).                        */
    var bySize = (
      W.outerWidth  - W.innerWidth  > 160 ||
      W.outerHeight - W.innerHeight > 160
    );

    /* Signal 2: console getter — fires when the DevTools console   */
    /* panel is open and actively formatting logged objects.         */
    var byConsole = false;
    var _probe = Object.defineProperty({}, '_xcm', {
      get: function () { byConsole = true; }
    });
    _origLog(_probe);

    if (bySize || byConsole) {
      _strikes++;
      if (_strikes >= 2) lockdown();
    } else {
      _strikes = 0;   // reset on a clean tick
    }
  }, 1000);

  /* ── keyboard shortcuts ─────────────────────────────────────── */
  D.addEventListener('keydown', function (e) {
    if (isOwner()) return;
    var k  = e.key  || '';
    var kU = k.toUpperCase();
    var ct = e.ctrlKey || e.metaKey;
    var sh = e.shiftKey;
    if (k === 'F12')                          { e.preventDefault(); e.stopPropagation(); }
    if (ct && sh && /^[IJCKM]$/.test(kU))    { e.preventDefault(); e.stopPropagation(); }
    if (ct && kU === 'U')                     { e.preventDefault(); e.stopPropagation(); }
    if (ct && !sh && kU === 'S')              { e.preventDefault(); e.stopPropagation(); }
    if (ct && !sh && kU === 'P')              { e.preventDefault(); e.stopPropagation(); }
  }, true);

  /* ── right-click block ──────────────────────────────────────── */
  D.addEventListener('contextmenu', function (e) {
    if (isOwner()) return;
    var tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    e.preventDefault();
  }, true);

  /* ── drag block ─────────────────────────────────────────────── */
  D.addEventListener('dragstart', function (e) {
    if (isOwner()) return;
    var tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    e.preventDefault();
  }, true);

  /* ── disable text selection ─────────────────────────────────── */
  var _style = D.createElement('style');
  _style.id = 'xcm-sec-style';
  _style.textContent =
    '*:not(input):not(textarea):not([contenteditable]):not([contenteditable] *)' +
    '{ -webkit-user-select:none!important; user-select:none!important; }' +
    'input,textarea,[contenteditable]{ -webkit-user-select:text!important; user-select:text!important; }';
  D.head && D.head.appendChild(_style);

  /* ── lift restrictions once owner logs in ───────────────────── */
  setInterval(function () {
    if (!isOwner()) return;
    var s = D.getElementById('xcm-sec-style');
    if (s) s.remove();
  }, 2000);

}(window, document, console));
