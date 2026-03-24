'use client';

import { useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/context/AuthContext';

function txt(lang) {
  const t = {
    de: {
      title: 'Anmelden',
      intro: 'Gib deine E-Mail-Adresse ein. Wir senden dir einen sicheren Login-Link.',
      email: 'E-Mail-Adresse',
      send: 'Login-Link senden',
      sending: 'Wird gesendet…',
      close: 'Schließen',
      success: 'Prüfe dein Postfach. Dein Zugang ist unterwegs.',
      error: 'Der Login-Link konnte nicht gesendet werden.',
      legalPrefix: 'Mit dem Login stimmst du unserer',
      privacy: 'Datenschutzerklärung',
      legalConnector: 'und den',
      terms: 'Nutzungsbedingungen',
      legalSuffix: 'zu.',
    },
    en: {
      title: 'Sign in',
      intro: 'Enter your email address. We will send you a secure login link.',
      email: 'Email address',
      send: 'Send login link',
      sending: 'Sending…',
      close: 'Close',
      success: 'Check your inbox. Your access is on the way.',
      error: 'The login link could not be sent.',
      legalPrefix: 'By signing in, you agree to our',
      privacy: 'privacy policy',
      legalConnector: 'and',
      terms: 'terms of use',
      legalSuffix: '.',
    },
    it: {
      title: 'Accedi',
      intro: 'Inserisci il tuo indirizzo email. Ti invieremo un link di accesso sicuro.',
      email: 'Indirizzo email',
      send: 'Invia link di accesso',
      sending: 'Invio in corso…',
      close: 'Chiudi',
      success: 'Controlla la tua casella di posta. Il tuo accesso è in arrivo.',
      error: 'Impossibile inviare il link di accesso.',
      legalPrefix: 'Accedendo, accetti la nostra',
      privacy: 'informativa sulla privacy',
      legalConnector: 'e i',
      terms: 'termini di utilizzo',
      legalSuffix: '.',
    },
    fr: {
      title: 'Connexion',
      intro: 'Saisis ton adresse e-mail. Nous t’enverrons un lien de connexion sécurisé.',
      email: 'Adresse e-mail',
      send: 'Envoyer le lien',
      sending: 'Envoi…',
      close: 'Fermer',
      success: 'Vérifie ta boîte mail. Ton accès est en route.',
      error: 'Le lien de connexion n’a pas pu être envoyé.',
      legalPrefix: 'En vous connectant, vous acceptez notre',
      privacy: 'politique de confidentialité',
      legalConnector: 'et nos',
      terms: 'conditions d’utilisation',
      legalSuffix: '.',
    },
    hr: {
      title: 'Prijava',
      intro: 'Unesi svoju e-mail adresu. Poslat ćemo ti sigurnu poveznicu za prijavu.',
      email: 'E-mail adresa',
      send: 'Pošalji poveznicu',
      sending: 'Šalje se…',
      close: 'Zatvori',
      success: 'Provjeri svoju e-poštu. Tvoj pristup je na putu.',
      error: 'Poveznicu za prijavu nije bilo moguće poslati.',
      legalPrefix: 'Prijavom prihvaćate našu',
      privacy: 'politiku privatnosti',
      legalConnector: 'i',
      terms: 'uvjete korištenja',
      legalSuffix: '.',
    },
  };
  return t[lang] || t.en;
}

export default function AuthModal({ lang = 'de' }) {
  const { authModalOpen, setAuthModalOpen } = useAuth();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

    const pathname = usePathname();

  const routeLang = useMemo(() => {
    const first = String(pathname || '/')
      .split('/')
      .filter(Boolean)[0];

    return ['de', 'en', 'it', 'fr', 'hr'].includes(first) ? first : lang;
  }, [pathname, lang]);

  const legalLinks = {
  de: { privacy: '/de/datenschutz', terms: '/de/nutzungsbedingungen' },
  en: { privacy: '/en/privacy', terms: '/en/terms' },

  // Fallback → Englisch
    it: { privacy: '/it/privacy', terms: '/it/terms' },
    fr: { privacy: '/fr/privacy', terms: '/fr/terms' },
    hr: { privacy: '/hr/privacy', terms: '/hr/terms' },
  };

const links = legalLinks[routeLang] || legalLinks.en;

  const copy = useMemo(() => txt(routeLang), [routeLang]);

  if (!authModalOpen) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSuccess('');

    const origin =
      typeof window !== 'undefined' ? window.location.origin : 'https://wind2horizon.com';

    const nextPath =
      typeof window !== 'undefined'
        ? window.location.pathname + window.location.search + window.location.hash
        : '/de';

    const { error: authError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${origin}${nextPath}`,
      },
    });

    if (authError) {
      setError(copy.error);
      setBusy(false);
      return;
    }

    setSuccess(copy.success);
    setBusy(false);
  }

  return (
    <div
      onClick={() => setAuthModalOpen(false)}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.58)',
        zIndex: 100000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(520px, 100%)',
          borderRadius: 18,
          background: '#fff',
          boxShadow: '0 20px 50px rgba(0,0,0,.25)',
          padding: 22,
          display: 'grid',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>Wind2Horizon</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>{copy.title}</div>
          </div>

          <button
            type="button"
            onClick={() => setAuthModalOpen(false)}
            style={{
              border: 'none',
              background: 'transparent',
              fontSize: 24,
              cursor: 'pointer',
              lineHeight: 1,
            }}
            aria-label={copy.close}
            title={copy.close}
          >
            ×
          </button>
        </div>

        <p style={{ margin: 0, fontSize: 14, color: '#4b5563', lineHeight: 1.45 }}>
          {copy.intro}
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{copy.email}</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              style={{
                border: '1px solid #d1d5db',
                borderRadius: 12,
                padding: '12px 14px',
                fontSize: 14,
                outline: 'none',
              }}
            />
          </label>

          <button
            type="submit"
            disabled={busy}
            style={{
              border: 'none',
              borderRadius: 12,
              padding: '12px 16px',
              fontSize: 14,
              fontWeight: 800,
              background: '#0284c7',
              color: '#fff',
              cursor: 'pointer',
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? copy.sending : copy.send}
          </button>
                   <div
            style={{
              fontSize: 11,
              color: '#6b7280',
              marginTop: 14,
              lineHeight: 1.5,
              textAlign: 'center',
            }}
          >
            {copy.legalPrefix}{' '}
            <a
              href={links.privacy}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: 'underline' }}
            >
              {copy.privacy}
            </a>{' '}
            {copy.legalConnector}{' '}
            <a
              href={links.terms}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: 'underline' }}
            >
              {copy.terms}
            </a>
            {copy.legalSuffix}
          </div>
        </form>

        {success ? (
          <div
            style={{
              borderRadius: 12,
              background: '#ecfeff',
              border: '1px solid #a5f3fc',
              color: '#155e75',
              padding: 12,
              fontSize: 13,
            }}
          >
            {success}
          </div>
        ) : null}

        {error ? (
          <div
            style={{
              borderRadius: 12,
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#991b1b',
              padding: 12,
              fontSize: 13,
            }}
          >
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}