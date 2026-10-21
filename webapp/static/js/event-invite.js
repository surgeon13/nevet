/* Inviting people to events: copy / share the link, the QR code pop-up and the dashboard's one-tap answers.
   Used by the dashboard's "Coming up" strip (console.html) and the event page's Invite card (event.html). */
(function () {
  function copy(text, btn) {
    var done = function () {
      var was = btn.textContent;
      btn.textContent = 'Copied ✓';
      setTimeout(function () { btn.textContent = was; }, 1600);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () { window.prompt('Copy this link:', text); });
    } else {
      window.prompt('Copy this link:', text);
    }
  }

  function wire(root) {
    root.querySelectorAll('[data-copy]').forEach(function (b) {
      if (b._wired) return;
      b._wired = true;
      b.addEventListener('click', function () { copy(b.dataset.copy, b); });
    });
    root.querySelectorAll('[data-share]').forEach(function (b) {
      if (b._wired) return;
      b._wired = true;
      if (!navigator.share) return;
      b.hidden = false;
      b.addEventListener('click', function () {
        navigator.share({ title: b.dataset.title, text: 'Join us: ' + b.dataset.title, url: b.dataset.share }).catch(function () {});
      });
    });
  }
  wire(document);

  // the QR pop-up: the dashboard keeps each event's code in a <template data-qr-for="id">
  var dlg = document.getElementById('ev-qr-dialog');
  if (dlg) {
    var body = dlg.querySelector('.ev-qr-dialog-body');
    document.querySelectorAll('[data-open-qr]').forEach(function (b) {
      b.addEventListener('click', function () {
        var tpl = document.querySelector('template[data-qr-for="' + b.dataset.openQr + '"]');
        if (!tpl) return;
        body.innerHTML = '';
        body.appendChild(tpl.content.cloneNode(true));
        wire(body);
        if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
      });
    });
    dlg.addEventListener('click', function (e) {
      if (e.target === dlg || e.target.closest('[data-close]')) { dlg.close ? dlg.close() : dlg.removeAttribute('open'); }
    });
  }

  // one-tap "Going" / "Maybe" on the dashboard, without leaving the page
  document.querySelectorAll('form[data-rsvp]').forEach(function (f) {
    var card = f.closest('.ev-soon-card');
    f.addEventListener('submit', function (e) {
      if (!window.fetch) return;
      var btn = e.submitter || f.querySelector('button[name="answer"]');
      e.preventDefault();
      var fd = new FormData(f);
      var cur = card.dataset.answer || '';
      var want = btn ? btn.value : 'going';
      fd.set('answer', want === cur ? 'clear' : want);          // tapping your answer again takes it back
      f.classList.add('busy');
      fetch(f.action, { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          f.classList.remove('busy');
          if (!res.ok) { alert(res.j.error || 'That didn\'t work. Try again.'); return; }
          var a = res.j.answer || '';
          card.dataset.answer = a;
          f.querySelectorAll('button[name="answer"]').forEach(function (b) {
            var on = b.value === a;
            b.classList.toggle('on', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
          });
          var c = card.querySelector('[data-going]');
          if (c) c.textContent = res.j.expected;
          var note = card.querySelector('[data-mine]');
          if (note) note.textContent = a === 'going' ? 'You\'re going 🎉' : a === 'maybe' ? 'You said maybe' : '';
        })
        .catch(function () {
          f.classList.remove('busy');
          var h = document.createElement('input');
          h.type = 'hidden'; h.name = 'answer'; h.value = fd.get('answer');
          f.appendChild(h);
          f.submit();
        });
    });
  });
})();
