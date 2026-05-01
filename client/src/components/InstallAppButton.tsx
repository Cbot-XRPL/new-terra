import { useEffect, useState } from 'react';
import { Smartphone } from 'lucide-react';

// Browsers fire 'beforeinstallprompt' when the PWA install heuristics
// pass (manifest, service worker, prior visits, https). We capture the
// event and stash it so the user can trigger install on demand instead
// of relying on a one-time browser prompt that might never re-appear.
//
// Caveats:
// - Safari (iOS + macOS) does NOT fire this event. We detect iOS and
//   show a short "Add to Home Screen" hint instead.
// - When the app is already running standalone (display-mode: standalone)
//   the button hides itself.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  // iPadOS 13+ reports as Mac in userAgent, so also check touch points.
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.userAgent.includes('Mac') && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // iOS exposes navigator.standalone; everyone else uses display-mode.
  const navStandalone = (navigator as Navigator & { standalone?: boolean }).standalone;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    navStandalone === true
  );
}

export default function InstallAppButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState<boolean>(() => isStandalone());
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    if (installed) return;
    function onBeforeInstall(e: Event) {
      // Stop the browser from showing its own mini-infobar — we want a
      // dedicated, predictable button instead.
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setInstalled(true);
      setDeferred(null);
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [installed]);

  if (installed) {
    return (
      <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
        ✓ App installed — you're using the standalone version right now.
      </p>
    );
  }

  async function handleInstall() {
    if (deferred) {
      await deferred.prompt();
      await deferred.userChoice;
      // Whether accepted or dismissed, the event can only fire once
      // per page load — clear the cached prompt either way.
      setDeferred(null);
      return;
    }
    if (isIos()) {
      setShowIosHint((v) => !v);
    }
  }

  // No deferred prompt and not on iOS → browser doesn't support
  // installable PWAs, hide the row entirely so we don't tease a
  // button that won't do anything.
  if (!deferred && !isIos()) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <button
        type="button"
        className="button"
        onClick={handleInstall}
        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
      >
        <Smartphone size={16} /> Install app
      </button>
      {showIosHint && (
        <p className="muted" style={{ fontSize: '0.85rem', margin: 0, lineHeight: 1.5 }}>
          On iPhone / iPad: tap the <strong>Share</strong> button in Safari, then{' '}
          <strong>Add to Home Screen</strong>. The portal opens like a real app
          and remembers you signed in.
        </p>
      )}
      {!showIosHint && (
        <p className="muted" style={{ fontSize: '0.8rem', margin: 0 }}>
          Adds a home-screen shortcut and runs full-screen with offline-friendly caching.
        </p>
      )}
    </div>
  );
}
