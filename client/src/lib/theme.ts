// Theme + cookie-consent preferences. Persisted in localStorage and applied
// to <html data-theme="…"> so the CSS in global.css can target each variant.
// The `system` mode follows the user's OS color preference live.

export type ThemeMode = 'native' | 'light' | 'dark';
export type CookieConsent = 'minimal' | 'all';

const THEME_KEY = 'nt_theme';
const COOKIE_KEY = 'nt_cookie_consent';

export function getStoredTheme(): ThemeMode {
  const v = localStorage.getItem(THEME_KEY);
  // Existing installs may have 'system' or 'tech' stored — both map to
  // 'native' going forward. New users default to 'native'.
  if (v === 'light' || v === 'dark' || v === 'native') return v;
  return 'native';
}

export function setStoredTheme(mode: ThemeMode): void {
  localStorage.setItem(THEME_KEY, mode);
  applyTheme(mode);
}

export function applyTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = mode;
}

// Call once at boot to apply the saved theme. Returns a cleanup function
// (no-op now that we've dropped the OS-tracking system mode, but kept
// for API stability — callers don't need to change).
export function initTheme(): () => void {
  applyTheme(getStoredTheme());
  return () => {};
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
