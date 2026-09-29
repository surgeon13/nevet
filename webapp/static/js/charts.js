/* charts.js - one shared tooltip for bar/column charts.
 * Any element with data-tip-value (+ optional data-tip-label) shows it on
 * hover and on keyboard focus. Text is set with textContent. */
(function () {
  var tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.setAttribute('role', 'status');
  var v = document.createElement('strong'), l = document.createElement('span');
  tip.appendChild(v); tip.appendChild(l);
  document.body.appendChild(tip);

  function show(el, x, y) {
    v.textContent = el.getAttribute('data-tip-value') || '';
    l.textContent = el.getAttribute('data-tip-label') || '';
    tip.classList.add('on');
    var r = tip.getBoundingClientRect();
    var left = Math.min(window.innerWidth - r.width - 8, Math.max(8, x - r.width / 2));
    var top = y - r.height - 12;
    if (top < 8) top = y + 16;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
  function hide() { tip.classList.remove('on'); }

  document.addEventListener('pointermove', function (e) {
    var el = e.target.closest && e.target.closest('[data-tip-value]');
    if (el) show(el, e.clientX, e.clientY); else hide();
  });
  document.addEventListener('focusin', function (e) {
    var el = e.target.closest && e.target.closest('[data-tip-value]');
    if (!el) return;
    var r = el.getBoundingClientRect();
    show(el, r.left + r.width / 2, r.top);
  });
  document.addEventListener('focusout', hide);
  window.addEventListener('scroll', hide, { passive: true });
})();
