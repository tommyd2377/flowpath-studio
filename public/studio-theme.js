// An async external script is a React-managed resource on both initial loads
// and client remounts. ThemeToggle also restores this preference at hydration.
try {
  var theme = localStorage.getItem('voice-studio-theme');
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
} catch {
  document.documentElement.dataset.theme = 'dark';
}
