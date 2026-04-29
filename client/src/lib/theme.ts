// Theme + cookie-consent preferences. Persisted in localStorage and applied
// to <html data-theme="…"> so the CSS in global.css can target each variant.
// The `system` mode follows the user's OS color preference live.

export type ThemeMode = 'light' | 'dark' | 'system';
export type CookieConsent = 'minimal' | 'all';

const THEME_KEY = 'nt_theme';
const COOKIE_KEY = 'nt_cookie_consent';

export function getStoredTheme(): ThemeMode {
  const v = localStorage.getItem(THEME_KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

export function setStoredTheme(mode: ThemeMode): void {
  localStorage.setItem(THEME_KEY, mode);
  applyTheme(mode);
}

function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return mode;
}

export function applyTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = resolveTheme(mode);
}

// Call once at boot to apply the saved theme + start tracking the OS scheme
// when the user is on `system`. Returns the cleanup function (unused in app
// boot but handy if a component ever wants to scope this).
export function initTheme(): () => void {
  const mode = getStoredTheme();
  applyTheme(mode);

  const mql = window.matchMedia('(prefers-color-scheme: light)');
  const onChange = () => {
    if (getStoredTheme() === 'system') applyTheme('system');
  };
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

// --- Cookie consent ---------------------------------------------------------
//
// The portal itself only writes essential cookies/storage (the auth token in
// localStorage, cached avatars). "minimal" = essential only. "all" reserves
// space for any future analytics/tracking we might add — flipping this to
// "all" is the user opting in to those.

export function getCookieConsent(): CookieConsent {
  const v = localStorage.getItem(COOKIE_KEY);
  return v === 'all' ? 'all' : 'minimal';
}

export function setCookieConsent(c: CookieConsent): void {
  localStorage.setItem(COOKIE_KEY, c);
}
