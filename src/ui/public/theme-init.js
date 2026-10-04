(function() {
  try {
    var t = localStorage.getItem('nutriscore_theme');
    if (t && t !== 'general') {
      document.documentElement.setAttribute('data-health-condition', t);
    }
  } catch(e) {}
})();
