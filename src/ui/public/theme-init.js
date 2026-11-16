(function() {
  try {
    var stored = localStorage.getItem('nutriscore_theme_mode');
    var isDark = stored === 'dark' || (!stored && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (isDark) {
      document.documentElement.classList.add('dark');
      document.documentElement.setAttribute('data-mode', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.setAttribute('data-mode', 'light');
    }
  } catch(e) {}
})();
