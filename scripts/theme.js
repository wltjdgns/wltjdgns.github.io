(function () {
  var tt = document.getElementById('theme-toggle');
  if (!tt) return;
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('theme', t);
    tt.textContent = t === 'light' ? '\u{1F319}' : '\u2600\uFE0F';
  }
  var saved = localStorage.getItem('theme') || 'dark';
  tt.textContent = saved === 'light' ? '\u{1F319}' : '\u2600\uFE0F';
  tt.addEventListener('click', function () {
    var cur = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(cur === 'light' ? 'dark' : 'light');
  });
})();
