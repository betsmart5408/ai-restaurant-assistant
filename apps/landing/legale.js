// Scelta della lingua per privacy e termini: ?lang=en, poi la scelta
// salvata, poi la lingua del browser. Senza JavaScript restano visibili tutte e due.
(function () {
  var doc = document.documentElement;
  doc.classList.add('js');
  var bottoni = document.querySelectorAll('.lingue button');
  var testi = document.querySelectorAll('article[data-l]');

  function mostra(l) {
    testi.forEach(function (a) { a.hidden = a.getAttribute('data-l') !== l; });
    bottoni.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-l') === l)); });
    doc.lang = l;
  }

  var scelta = new URLSearchParams(location.search).get('lang');
  if (!scelta) { try { scelta = localStorage.getItem('lf_lingua_legale'); } catch (e) {} }
  if (!scelta) scelta = /^it\b/i.test(navigator.language || '') ? 'it' : 'en';
  mostra(scelta === 'en' ? 'en' : 'it');

  bottoni.forEach(function (b) {
    b.addEventListener('click', function () {
      var l = b.getAttribute('data-l');
      mostra(l);
      try { localStorage.setItem('lf_lingua_legale', l); } catch (e) {}
    });
  });
})();
