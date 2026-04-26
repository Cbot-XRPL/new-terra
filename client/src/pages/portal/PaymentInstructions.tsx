import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

interface Settings {
  zelleEmail: string | null;
  zelleName: string | null;
  zellePhone: string | null;
  achInstructions: string | null;
  checkPayableTo: string | null;
  checkMailingAddress: string | null;
  paymentNotes: string | null;
}

interface Props {
  // Render compactly inside the row expansion (no extra heading) vs as its
  // own card on a standalone page.
  variant?: 'compact' | 'card';
}

// Cached at module scope so opening five invoice rows in a row doesn't fire
// /api/settings five times. The settings change rarely, the cache lives for
// the lifetime of the SPA, and admin's own settings page does its own GET.
let cache: Settings | null = null;

export default function PaymentInstructions({ variant = 'compact' }: Props) {
  const [settings, setSettings] = useState<Settings | null>(cache);

  useEffect(() => {
    if (cache) {
      setSettings(cache);
      return;
    }
    api<{ settings: Settings }>('/api/settings')
      .then((r) => {
        cache = r.settings;
        setSettings(r.settings);
      })
      .catch(() => undefined);
  }, []);

  if (!settings) return null;

  const hasZelle = !!(settings.zelleEmail || settings.zellePhone);
  const hasAch = !!settings.achInstructions;
  const hasCheck = !!(settings.checkPayableTo || settings.checkMailingAddress);

  if (!hasZelle && !hasAch && !hasCheck && !settings.paymentNotes) return null;

  const inner = (
    <>
      <h3 style={{ marginTop: 0 }}>How to pay us</h3>
      {settings.paymentNotes && (
        <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{settings.paymentNotes}</p>
      )}

      <div className="payment-methods">
        {hasZelle && (
          <div className="payment-method">
            <div className="payment-method-title">Zelle</div>
            {settings.zelleName && <div>To: {settings.zelleName}</div>}
            {settings.zelleEmail && <div>Email: <code>{settings.zelleEmail}</code></div>}
            {settings.zellePhone && <div>Phone: <code>{settings.zellePhone}</code></div>}
            <div className="muted" style={{ fontSize: '0.85rem' }}>
              Reply with the confirmation code so we can match the payment.
            </div>
          </div>
        )}
        {hasAch && (
          <div className="payment-method">
            <div className="payment-method-title">ACH transfer</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{settings.achInstructions}</div>
          </div>
        )}
        {hasCheck && (
          <div className="payment-method">
            <div className="payment-method-title">Check</div>
            {settings.checkPayableTo && (
              <div>
                Payable to: <strong>{settings.checkPayableTo}</strong>
              </div>
            )}
            {settings.checkMailingAddress && (
              <div style={{ whiteSpace: 'pre-wrap', marginTop: '0.25rem' }}>
                {settings.checkMailingAddress}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );

  if (variant === 'card') {
    return <section className="card">{inner}</section>;
  }
  return <div className="payment-instructions">{inner}</div>;
}
