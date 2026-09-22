import { useState, useEffect, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

// ─── Types ─────────────────────────────────────────────────
interface AuthData { token: string; restaurant?: { id: string; name: string; slug: string }; role: string; }
interface AdminRestaurant {
  id: string; name: string; slug: string; owner_email: string; logo_url?: string;
  plan: string; subscription_status: string; trial_ends_at: string; monthly_price: number | string;
  suspended_at: string | null; dish_count: number; sessions_30d: number; created_at: string;
  is_demo?: boolean; dishes_with_description?: number | string; demo_claim_token?: string | null; in_pausa?: boolean;
}
interface AdminStats {
  total_restaurants: number; active_subscriptions: number; trialing: number;
  suspended: number; mrr: string; sessions_30d: number; new_30d: number; demos?: number | string; prova_scaduta?: number | string;
}
interface Restaurant { id: string; name: string; slug: string; logo_url?: string; currency?: string; }

// Il titolare deve vedere i prezzi nella SUA valuta: a Sydney sono dollari
// australiani, non euro. Prima il simbolo era scritto a mano nel codice.
const SIMBOLI_VALUTA: Record<string, string> = {
  EUR: '\u20AC', AUD: 'A$', USD: '$', GBP: '\u00A3', CAD: 'C$', NZD: 'NZ$',
  CHF: 'CHF ', JPY: '\u00A5', CNY: '\u00A5', AED: 'AED ', THB: '\u0E3F',
};
function simboloValuta(codice?: string): string {
  if (!codice) return '\u20AC';
  const c = String(codice).toUpperCase();
  return SIMBOLI_VALUTA[c] ?? (c.length <= 2 ? codice : c + ' ');
}

// Le categorie del menu NON sono una lista fissa: ogni ristorante scrive le
// sue ("Hot Mezza", "To Share", "STARTERS"). Prima la dashboard mostrava solo
// quelle di Gusto, quindi il titolare vedeva "29 piatti" nel riepilogo ma in
// elenco ne trovava molti meno - o nessuno.
const CATEGORIE_SUGGERITE = ['antipasti','pizze','primi','secondi','contorni','dolci','cocktails','spirits','birre','vini','soft_drinks'];
function categorieDelMenu(piatti: { category: string }[]): string[] {
  const presenti: string[] = [];
  for (const p of piatti) {
    const c = (p.category ?? '').trim();
    if (c && !presenti.includes(c)) presenti.push(c);
  }
  const conosciute = CATEGORIE_SUGGERITE.filter(c => presenti.includes(c));
  return [...conosciute, ...presenti.filter(c => !CATEGORIE_SUGGERITE.includes(c))];
}
interface Dish { id: string; name: string; description: string; price: number; category: string; available: boolean; }
interface BillingStatus { plan: string; subscription_status: string; trial_ends_at: string; monthly_price: number | string; suspended_at: string | null; in_pausa?: boolean; giorni_tolleranza?: number; }
type Tab = 'menu' | 'traduzioni' | 'aspetto' | 'qr' | 'ia' | 'billing' | 'settings';

// ─── Auth helpers ───────────────────────────────────────────
function saveAuth(data: AuthData) { localStorage.setItem('owner_auth', JSON.stringify(data)); }
function loadAuth(): AuthData | null {
  try { return JSON.parse(localStorage.getItem('owner_auth') ?? 'null'); } catch { return null; }
}
function clearAuth() { localStorage.removeItem('owner_auth'); }

// ─── API helper ─────────────────────────────────────────────
class ApiError extends Error { status: number; constructor(status: number) { super(`${status}`); this.status = status; } }

async function apiFetch(path: string, token: string, opts?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts?.headers ?? {}) },
  });
  if (!res.ok) throw new ApiError(res.status);
  return res.json();
}
// Da usare al posto di `.catch(() => null)` quando un 401 (token scaduto/non
// valido) non deve essere silenziato come "endpoint non disponibile": senza
// questo, un token scaduto lascia la dashboard bloccata su dati vecchi per
// sempre, senza che l'utente capisca perche' (nessun errore, nessun re-login).
function ignoraSeNonAuth(err: unknown) {
  if (err instanceof ApiError && err.status === 401) throw err;
  return null;
}

// ─── Login Screen ───────────────────────────────────────────
// Due indirizzi, una sola app: admin.lingofork.com e' solo per noi (Super
// Admin), app.lingofork.com solo per i ristoratori, che cosi' non vedono
// nemmeno che esiste un accesso admin. Altrove (localhost, *.pages.dev)
// resta il vecchio ?admin per le prove.
const HOST = typeof window !== 'undefined' ? window.location.hostname : '';
const SITO_ADMIN = HOST.startsWith('admin.');
const SITO_RISTORATORI = HOST === 'app.lingofork.com';
function chiedeAdmin(): boolean {
  if (SITO_ADMIN) return true;
  if (SITO_RISTORATORI) return false;
  return /[?&]admin\b/.test(window.location.search) || window.location.hash.includes('admin');
}
if (SITO_ADMIN && typeof document !== 'undefined') document.title = 'LingoFork Admin';

function LoginScreen({ onLogin }: { onLogin: (data: AuthData) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Super Admin solo su admin.lingofork.com (o con ?admin nelle prove)
  const adminSbloccato = chiedeAdmin();
  const [mode, setMode] = useState<'owner' | 'admin'>(adminSbloccato ? 'admin' : 'owner');
  const [dimenticata, setDimenticata] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const url = mode === 'admin' ? `${API}/api/admin/login` : `${API}/api/auth/login`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { setError(data.error || 'Accesso non riuscito'); return; }
      saveAuth(data);
      onLogin(data);
    } catch {
      setError('Errore di connessione');
    } finally {
      setLoading(false);
    }
  }

  async function accediConGoogle(credential: string) {
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'Accesso con Google non riuscito'); return; }
      saveAuth(data);
      onLogin(data);
    } catch {
      setError('Errore di connessione');
    } finally {
      setLoading(false);
    }
  }

  if (dimenticata) return <PasswordDimenticata emailIniziale={email} onIndietro={() => setDimenticata(false)} />;

  return (
    <div style={S.loginWrap}>
      <div style={S.loginCard}>
        <div style={S.loginLogo}>{mode === 'admin' ? '🛡️' : '🍽️'}</div>
        <h1 style={S.loginTitle}>{mode === 'admin' ? 'Super Admin' : 'Dashboard Ristorante'}</h1>
        <p style={S.loginSub}>{mode === 'admin' ? 'Pannello di amministrazione piattaforma' : 'Accedi per gestire il tuo ristorante'}</p>
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={S.formLabel}>Email<input style={S.formInput} type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus /></label>
          <label style={S.formLabel}>Password<input style={S.formInput} type="password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
          {error && <div style={S.errorBox}>{error}</div>}
          <button style={S.btnPrimary} type="submit" disabled={loading}>{loading ? 'Accesso...' : 'Accedi →'}</button>
        </form>
        {mode === 'owner' && (
          <>
            <GoogleButton testo="signin_with" onCredential={accediConGoogle} />
            <button type="button" style={S.linkLogin} onClick={() => { setDimenticata(true); setError(''); }}>
              Hai dimenticato la password?
            </button>
          </>
        )}
        {!SITO_ADMIN && !SITO_RISTORATORI && (adminSbloccato || mode === 'admin') && (
          <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid rgba(148,163,184,0.25)' }}>
            <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 10 }}>
              {mode === 'owner' ? 'Sei l\'amministratore della piattaforma?' : 'Sei il titolare di un ristorante?'}
            </div>
            <button
              type="button"
              style={{
                width: '100%', padding: '11px 14px', borderRadius: 10, cursor: 'pointer',
                background: 'rgba(148,163,184,0.12)', border: '1px solid rgba(148,163,184,0.35)',
                color: '#e2e8f0', fontSize: 13, fontWeight: 600,
              }}
              onClick={() => { setMode(m => m === 'owner' ? 'admin' : 'owner'); setError(''); }}>
              {mode === 'owner' ? '\u{1F6E1}\uFE0F  Entra come Super Admin' : '\u{1F37D}\uFE0F  Entra come Ristorante'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Pulsante "Accedi con Google" ───────────────────────────
// Carica lo script di Google una volta sola. L'ID client arriva dall'API:
// se su Railway non c'e' GOOGLE_CLIENT_ID il pulsante semplicemente non compare.
let googleScript: Promise<void> | null = null;
function caricaGoogle(): Promise<void> {
  if (!googleScript) {
    googleScript = new Promise((ok, ko) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => ok();
      s.onerror = () => { googleScript = null; ko(new Error('Google non raggiungibile')); };
      document.head.appendChild(s);
    });
  }
  return googleScript;
}

function GoogleButton({ testo, onCredential }: { testo: 'signin_with' | 'continue_with'; onCredential: (credential: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [pronto, setPronto] = useState(false);
  // l'ultima callback, senza reinizializzare Google a ogni render
  const cb = useRef(onCredential);
  cb.current = onCredential;

  useEffect(() => {
    let annullato = false;
    (async () => {
      try {
        const cfg = await fetch(`${API}/api/auth/google-config`).then(r => r.json());
        if (!cfg.client_id || annullato) return;
        await caricaGoogle();
        if (annullato || !box.current) return;
        const g = (window as any).google.accounts.id;
        g.initialize({ client_id: cfg.client_id, callback: (r: { credential: string }) => cb.current(r.credential) });
        g.renderButton(box.current, { theme: 'outline', size: 'large', text: testo, shape: 'pill', locale: 'it', width: box.current.offsetWidth || 320 });
        setPronto(true);
      } catch { /* senza Google resta il login con password */ }
    })();
    return () => { annullato = true; };
  }, [testo]);

  return (
    <div style={{ display: pronto ? 'block' : 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0 14px', color: '#94a3b8', fontSize: 12 }}>
        <span style={{ flex: 1, height: 1, background: '#e2e8f0' }} />oppure<span style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
      </div>
      <div ref={box} style={{ display: 'flex', justifyContent: 'center', minHeight: 44 }} />
    </div>
  );
}

// ─── Password dimenticata ───────────────────────────────────
function PasswordDimenticata({ emailIniziale, onIndietro }: { emailIniziale: string; onIndietro: () => void }) {
  const [email, setEmail] = useState(emailIniziale);
  const [inviata, setInviata] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function invia(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) { setError('Qualcosa non ha funzionato, riprova tra poco'); return; }
      setInviata(true);
    } catch {
      setError('Errore di connessione');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={S.loginWrap}>
      <div style={S.loginCard}>
        <div style={S.loginLogo}>🔑</div>
        <h1 style={S.loginTitle}>Password dimenticata</h1>
        {inviata ? (
          <>
            <p style={S.loginSub}>
              Se <strong>{email}</strong> è registrata, tra un minuto ti arriva un'email con il link per
              scegliere una nuova password. Il link vale un'ora. Controlla anche lo spam.
            </p>
            <button style={{ ...S.btnPrimary, width: '100%' }} onClick={onIndietro}>Torna all'accesso</button>
          </>
        ) : (
          <>
            <p style={S.loginSub}>Scrivi l'email con cui accedi: ti mandiamo un link per sceglierne una nuova.</p>
            <form onSubmit={invia} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <label style={S.formLabel}>Email<input style={S.formInput} type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus /></label>
              {error && <div style={S.errorBox}>{error}</div>}
              <button style={S.btnPrimary} type="submit" disabled={loading}>{loading ? 'Invio...' : 'Mandami il link'}</button>
            </form>
            <button type="button" style={S.linkLogin} onClick={onIndietro}>← Torna all'accesso</button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Nuova password dal link ricevuto via email (?reset=...) ─
function ReimpostaPassword({ token, onDone }: { token: string; onDone: (d: AuthData) => void }) {
  const [password, setPassword] = useState('');
  const [conferma, setConferma] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function salva(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('La password deve avere almeno 8 caratteri'); return; }
    if (password !== conferma) { setError('Le due password non coincidono'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'Non è stato possibile cambiare la password'); return; }
      saveAuth(data);
      try { window.history.replaceState(null, '', window.location.pathname); } catch { /* ignora */ }
      onDone(data);
    } catch {
      setError('Errore di connessione');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={S.loginWrap}>
      <div style={S.loginCard}>
        <div style={S.loginLogo}>🔑</div>
        <h1 style={S.loginTitle}>Scegli una nuova password</h1>
        <p style={S.loginSub}>Almeno 8 caratteri. Dopo entri subito nella tua dashboard.</p>
        <form onSubmit={salva} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={S.formLabel}>Nuova password<input style={S.formInput} type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required autoFocus /></label>
          <label style={S.formLabel}>Ripeti la password<input style={S.formInput} type="password" autoComplete="new-password" value={conferma} onChange={e => setConferma(e.target.value)} required /></label>
          {error && <div style={S.errorBox}>{error}</div>}
          <button style={S.btnPrimary} type="submit" disabled={loading}>{loading ? 'Salvo...' : 'Salva ed entra →'}</button>
        </form>
        <button type="button" style={S.linkLogin} onClick={() => { window.location.href = window.location.pathname; }}>
          Il link è scaduto? Chiedine uno nuovo
        </button>
      </div>
    </div>
  );
}

// ─── Cambia password (Impostazioni) ─────────────────────────
function CambiaPassword({ token }: { token: string }) {
  const [attuale, setAttuale] = useState('');
  const [nuova, setNuova] = useState('');
  const [conferma, setConferma] = useState('');
  const [stato, setStato] = useState<{ ok: boolean; testo: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function salva(e: React.FormEvent) {
    e.preventDefault();
    setStato(null);
    if (nuova.length < 8) { setStato({ ok: false, testo: 'La nuova password deve avere almeno 8 caratteri' }); return; }
    if (nuova !== conferma) { setStato({ ok: false, testo: 'Le due password nuove non coincidono' }); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/change-password`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: attuale, new_password: nuova }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setStato({ ok: false, testo: data.error || 'Non è stato possibile cambiare la password' }); return; }
      setAttuale(''); setNuova(''); setConferma('');
      setStato({ ok: true, testo: 'Password cambiata. Dalla prossima volta accedi con quella nuova.' });
    } catch {
      setStato({ ok: false, testo: 'Errore di connessione' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ ...S.formCard, marginTop: 20 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Cambia password</h2>
      <p style={{ color: '#64748b', fontSize: 14, marginBottom: 16 }}>
        Per sicurezza serve anche quella attuale. Se non la ricordi, esci e usa "Hai dimenticato la password?".
      </p>
      <form onSubmit={salva} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 360 }}>
        <label style={S.formLabel}>Password attuale<input style={S.formInput} type="password" autoComplete="current-password" value={attuale} onChange={e => setAttuale(e.target.value)} required /></label>
        <label style={S.formLabel}>Nuova password<input style={S.formInput} type="password" autoComplete="new-password" value={nuova} onChange={e => setNuova(e.target.value)} required /></label>
        <label style={S.formLabel}>Ripeti la nuova password<input style={S.formInput} type="password" autoComplete="new-password" value={conferma} onChange={e => setConferma(e.target.value)} required /></label>
        {stato && (
          <div style={stato.ok
            ? { background: '#f0fdf4', border: '1px solid #86efac', color: '#166534', borderRadius: 10, padding: '10px 12px', fontSize: 14 }
            : S.errorBox}>
            {stato.testo}
          </div>
        )}
        <button style={{ ...S.btnPrimary, alignSelf: 'flex-start' }} type="submit" disabled={loading}>
          {loading ? 'Salvo...' : 'Cambia password'}
        </button>
      </form>
    </div>
  );
}

// ─── Attiva la tua demo ─────────────────────────────────────
function ClaimScreen({ slug, token, onDone }: { slug: string; token: string; onDone: (d: AuthData) => void }) {
  const [info, setInfo] = useState<{ name: string; logo_url?: string } | null>(null);
  const [fatal, setFatal] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/auth/claim?slug=${encodeURIComponent(slug)}&token=${encodeURIComponent(token)}`)
      .then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(({ ok, d }) => { if (ok) setInfo(d); else setFatal(d.error || 'Link non valido'); })
      .catch(() => setFatal('Errore di connessione'));
  }, []);

  async function attiva(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) { setError('La password deve avere almeno 8 caratteri'); return; }
    if (password !== password2) { setError('Le due password non coincidono'); return; }
    await invia({ slug, token, email, password });
  }

  async function invia(corpo: Record<string, string>) {
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Attivazione non riuscita'); return; }
      saveAuth(data);
      try { window.history.replaceState(null, '', window.location.pathname); } catch { /* ignora */ }
      onDone(data);
    } catch {
      setError('Errore di connessione');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={S.loginWrap}>
      <div style={S.loginCard}>
        {fatal ? (
          <>
            <div style={S.loginLogo}>⚠️</div>
            <h1 style={S.loginTitle}>{fatal}</h1>
            <p style={S.loginSub}>Se pensi sia un errore, scrivici e ti mandiamo un nuovo link.</p>
          </>
        ) : (
          <>
            {info?.logo_url
              ? <img src={info.logo_url.startsWith('http') ? info.logo_url : `${API}${info.logo_url}`} alt="" style={{ height: 54, objectFit: 'contain', display: 'block', margin: '0 auto 10px' }} />
              : <div style={S.loginLogo}>🍽️</div>}
            <h1 style={S.loginTitle}>Attiva {info?.name ?? 'la tua demo'}</h1>
            <p style={S.loginSub}>Il menu è già caricato e tradotto. Scegli le tue credenziali: prova gratuita, nessuna carta.</p>
            <form onSubmit={attiva} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <label style={S.formLabel}>Email<input style={S.formInput} type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus /></label>
              <label style={S.formLabel}>Password (min 8)<input style={S.formInput} type="password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
              <label style={S.formLabel}>Ripeti la password<input style={S.formInput} type="password" value={password2} onChange={e => setPassword2(e.target.value)} required /></label>
              {error && <div style={S.errorBox}>{error}</div>}
              <button style={S.btnPrimary} type="submit" disabled={loading || !info}>{loading ? 'Attivazione...' : 'Attiva e entra →'}</button>
            </form>
            {info && (
              <GoogleButton testo="continue_with" onCredential={credential => invia({ slug, token, google_credential: credential })} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Super Admin Panel ──────────────────────────────────────
// Indirizzo pubblico del menu cliente: e' il link che si manda al ristoratore.
const MENU_PUBBLICO = (import.meta as any).env?.VITE_MENU_URL ?? 'https://menu.lingofork.com';
// ─── Conversazioni (Super Admin) ─────────────────────────────
interface MessaggioConv { role: string; content: string; timestamp: string | null; motivi: string[]; }
interface Conversazione { id: string; ristorante: string; slug: string; demo: boolean; lingua: string; inizio: string; domande: number; sospette: number; messaggi: MessaggioConv[]; }

function Conversazioni({ token }: { token: string }) {
  const [giorni, setGiorni] = useState(7);
  const [slug, setSlug] = useState('');
  const [soloSospette, setSoloSospette] = useState(false);
  const [dati, setDati] = useState<{ conversazioni: Conversazione[]; ristoranti: Array<{ slug: string; nome: string; chat: number }> } | null>(null);
  const [aperta, setAperta] = useState<string | null>(null);

  useEffect(() => {
    setDati(null);
    const q = new URLSearchParams({ giorni: String(giorni), ...(slug ? { slug } : {}), ...(soloSospette ? { sospette: '1' } : {}) });
    fetch(`${API}/api/admin/conversazioni?${q}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setDati)
      .catch(() => setDati({ conversazioni: [], ristoranti: [] }));
  }, [giorni, slug, soloSospette, token]);

  const ora = (t: string | null) => t ? new Date(t).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  // Il grassetto dell'assistente (**nome**) si mostra come grassetto vero
  const testo = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>);

  return (
    <div style={S.content}>
      <h1 style={S.pageTitle}>💬 Conversazioni</h1>
      <p style={{ color: '#64748b', fontSize: 14, marginTop: -8 }}>
        Le chat vere dei clienti. In rosso le risposte sospette: promesse impossibili, nessun fornitore IA disponibile,
        tetto raggiunto, possibili fatti inventati sul locale. Leggerle qualche minuto al giorno è il controllo migliore.
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', margin: '8px 0 16px' }}>
        <select style={{ ...S.formInput, width: 'auto', minWidth: 220, margin: 0 }} value={slug} onChange={e => setSlug(e.target.value)}>
          <option value="">Tutti i ristoranti</option>
          {dati?.ristoranti.map(r => <option key={r.slug} value={r.slug}>{r.nome} ({r.chat})</option>)}
        </select>
        {[1, 7, 30].map(g => (
          <button key={g} onClick={() => setGiorni(g)} style={{
            padding: '7px 12px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer',
            border: '1px solid ' + (giorni === g ? '#6366f1' : '#e2e8f0'), background: giorni === g ? '#6366f1' : '#fff', color: giorni === g ? '#fff' : '#475569',
          }}>{g === 1 ? 'Oggi' : `${g} giorni`}</button>
        ))}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: '#334155', cursor: 'pointer' }}>
          <input type="checkbox" checked={soloSospette} onChange={e => setSoloSospette(e.target.checked)} /> Solo sospette
        </label>
      </div>
      {!dati && <div style={{ color: '#64748b' }}>Caricamento...</div>}
      {dati && dati.conversazioni.length === 0 && <div style={{ ...S.formCard, color: '#64748b', textAlign: 'center' }}>Nessuna conversazione nel periodo.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {dati?.conversazioni.map(c => (
          <div key={c.id} style={{ ...S.formCard, padding: 0, overflow: 'hidden', borderColor: c.sospette ? '#fca5a5' : undefined }}>
            <button onClick={() => setAperta(aperta === c.id ? null : c.id)} style={{
              width: '100%', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center',
              padding: '14px 18px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 14,
            }}>
              <span>
                <strong>{c.ristorante}</strong>{' '}
                <span style={{ fontSize: 11, fontWeight: 700, color: c.demo ? '#92400e' : '#3730a3' }}>{c.demo ? 'DEMO' : 'CLIENTE'}</span>
                <span style={{ color: '#64748b' }}> · {ora(c.inizio)} · {String(c.lingua || '').toUpperCase()} · {c.domande} domande</span>
              </span>
              <span style={{ fontWeight: 700, color: c.sospette ? '#b91c1c' : '#166534' }}>
                {c.sospette ? `⚠️ ${c.sospette} sospette` : '✓'} {aperta === c.id ? '▲' : '▼'}
              </span>
            </button>
            {aperta === c.id && (
              <div style={{ padding: '4px 18px 18px', display: 'flex', flexDirection: 'column', gap: 8, background: '#f8fafc' }}>
                {c.messaggi.map((m, i) => (
                  <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
                    <div style={{
                      whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.5, padding: '9px 13px', borderRadius: 12,
                      background: m.role === 'user' ? '#6366f1' : m.motivi.length ? '#fef2f2' : '#fff',
                      color: m.role === 'user' ? '#fff' : '#1e293b',
                      border: m.role === 'user' ? 'none' : `1px solid ${m.motivi.length ? '#fca5a5' : '#e2e8f0'}`,
                    }}>{testo(m.content)}</div>
                    <div style={{ fontSize: 11, color: m.motivi.length ? '#b91c1c' : '#94a3b8', marginTop: 2, textAlign: m.role === 'user' ? 'right' : 'left' }}>
                      {ora(m.timestamp)}{m.motivi.length ? ` · ⚠️ ${m.motivi.join(', ')}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Consumi IA (Super Admin) ───────────────────────────────
interface ConsumoRistorante {
  id: string; name: string; slug: string; is_demo: boolean; subscription_status: string;
  domande: number; senza_ia: number; limite: number; chiamate_ia: number;
  token_in: number | string; token_out: number | string; costo_usd: number;
}
interface ConsumoFornitore { fornitore: string; chiamate: number; token: number | string; costo_usd: number; }

function ConsumiIA({ token }: { token: string }) {
  const [giorni, setGiorni] = useState(30);
  const [dati, setDati] = useState<{ ristoranti: ConsumoRistorante[]; fornitori: ConsumoFornitore[] } | null>(null);
  const [errore, setErrore] = useState('');
  const [fornitori, setFornitori] = useState<Array<{ nome: string; ok: boolean; quota?: boolean; modello?: string; ms?: number; errore?: string }> | null>(null);
  const [provando, setProvando] = useState(false);
  function provaFornitori() {
    setProvando(true);
    fetch(`${API}/api/admin/fornitori`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setFornitori(d.fornitori ?? []))
      .catch(() => setFornitori([]))
      .finally(() => setProvando(false));
  }
  useEffect(() => { provaFornitori(); }, [token]);

  useEffect(() => {
    setErrore('');
    fetch(`${API}/api/admin/consumi?giorni=${giorni}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(setDati)
      .catch(() => setErrore('Non riesco a leggere i consumi.'));
  }, [giorni, token]);

  const n = (v: number | string) => Number(v ?? 0);
  const dollari = (v: number) => v === 0 ? '$0' : v < 0.01 ? '< $0,01' : `$${v.toFixed(2).replace('.', ',')}`;
  const migliaia = (v: number) => v.toLocaleString('it-IT');
  const r = dati?.ristoranti ?? [];
  const tot = r.reduce((a, x) => ({
    domande: a.domande + n(x.domande), senza: a.senza + n(x.senza_ia), ia: a.ia + n(x.chiamate_ia),
    limite: a.limite + n(x.limite), token: a.token + n(x.token_in) + n(x.token_out), costo: a.costo + n(x.costo_usd),
  }), { domande: 0, senza: 0, ia: 0, limite: 0, token: 0, costo: 0 });
  const paganti = r.filter(x => !x.is_demo);
  const costoPaganti = paganti.reduce((a, x) => a + n(x.costo_usd), 0);
  const cella: React.CSSProperties = { padding: '10px 12px', borderBottom: '1px solid #f1f5f9', fontSize: 14, whiteSpace: 'nowrap' };
  const testa: React.CSSProperties = { ...cella, fontSize: 12, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', background: '#f8fafc', textAlign: 'right' };

  return (
    <div style={S.content}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h1 style={S.pageTitle}>💸 Consumi IA</h1>
        <div style={{ display: 'flex', gap: 6 }}>
          {[1, 7, 30, 90].map(g => (
            <button key={g} onClick={() => setGiorni(g)} style={{
              padding: '7px 12px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer',
              border: '1px solid ' + (giorni === g ? '#6366f1' : '#e2e8f0'), background: giorni === g ? '#6366f1' : '#fff', color: giorni === g ? '#fff' : '#475569',
            }}>{g === 1 ? 'Oggi' : `${g} giorni`}</button>
          ))}
        </div>
      </div>
      {errore && <div style={S.errorBox}>{errore}</div>}
      <div style={{ ...S.formCard, marginTop: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Stato dei fornitori IA</h2>
          <button style={S.btnSecondary} disabled={provando} onClick={provaFornitori}>{provando ? 'Prova in corso...' : 'Riprova'}</button>
        </div>
        {!fornitori && <div style={{ color: '#64748b', fontSize: 14 }}>Prova in corso...</div>}
        {fornitori && fornitori.length === 0 && <div style={{ color: '#b91c1c', fontSize: 14 }}>Nessun fornitore configurato (o prova non riuscita).</div>}
        {fornitori?.map((f, i) => (
          <div key={f.nome} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '8px 0', borderTop: i ? '1px solid #f1f5f9' : 'none', fontSize: 14 }}>
            <span><strong>{i + 1}. {f.nome}</strong> {f.modello && <span style={{ color: '#64748b' }}>· {f.modello}</span>}</span>
            <span style={{ fontWeight: 700, color: f.ok ? '#166534' : f.quota ? '#b45309' : '#b91c1c' }}>
              {f.ok ? `✅ attivo (${((f.ms ?? 0) / 1000).toFixed(1)}s)` : f.quota ? `⏳ ${f.errore}` : `❌ ${f.errore}`}
            </span>
          </div>
        ))}
        <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 8 }}>La chat li prova in quest'ordine: se uno ha finito la quota passa al successivo.</div>
      </div>
      {dati && (
        <>
          <div style={S.kpiGrid}>
            <KPI label="Domande dei clienti" value={migliaia(tot.domande)} color="#6366f1" sub="Tutte quelle arrivate alla chat" />
            <KPI label="Risposte senza IA" value={tot.domande ? `${Math.round(tot.senza / tot.domande * 100)}%` : '—'} color="#22c55e" sub={`${migliaia(tot.senza)} gratis: prezzi, allergeni, vini...`} />
            <KPI label="Chiamate all'IA" value={migliaia(tot.ia)} color="#f59e0b" sub={`${migliaia(tot.token)} token`} />
            <KPI label="Costo totale" value={dollari(tot.costo)} color="#ef4444" sub={`di cui clienti ${dollari(costoPaganti)} · demo ${dollari(tot.costo - costoPaganti)}`} />
            <KPI label="Costo medio per cliente" value={paganti.length ? dollari(costoPaganti / paganti.length) : '—'} color="#0ea5e9" sub={`${paganti.length} clienti con traffico nel periodo`} />
            <KPI label="Limite raggiunto" value={migliaia(tot.limite)} color="#8b5cf6" sub="Domande rimandate al personale" />
          </div>

          {dati.fornitori.length > 0 && (
            <div style={{ ...S.formCard, marginTop: 20 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>Chi ha risposto</h2>
              {dati.fornitori.map(f => (
                <div key={f.fornitore} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 14 }}>
                  <span><strong>{f.fornitore}</strong> {n(f.costo_usd) === 0 && <span style={{ color: '#166534', fontSize: 12, fontWeight: 700 }}>GRATIS</span>}</span>
                  <span style={{ color: '#64748b' }}>{migliaia(n(f.chiamate))} chiamate · {migliaia(n(f.token))} token · <strong style={{ color: '#1e293b' }}>{dollari(n(f.costo_usd))}</strong></span>
                </div>
              ))}
            </div>
          )}

          <div style={{ ...S.formCard, marginTop: 20, padding: 0, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...testa, textAlign: 'left' }}>Ristorante</th>
                  <th style={testa}>Domande</th>
                  <th style={testa}>Senza IA</th>
                  <th style={testa}>IA</th>
                  <th style={testa}>Limite</th>
                  <th style={testa}>Token</th>
                  <th style={testa}>Costo</th>
                </tr>
              </thead>
              <tbody>
                {r.length === 0 && (
                  <tr><td colSpan={7} style={{ ...cella, textAlign: 'center', color: '#64748b' }}>Nessuna chat nel periodo.</td></tr>
                )}
                {r.map(x => (
                  <tr key={x.id}>
                    <td style={{ ...cella, whiteSpace: 'normal' }}>
                      <strong>{x.name}</strong>{' '}
                      <span style={{ fontSize: 11, fontWeight: 700, color: x.is_demo ? '#92400e' : '#3730a3' }}>{x.is_demo ? 'DEMO' : 'CLIENTE'}</span>
                    </td>
                    <td style={{ ...cella, textAlign: 'right' }}>{migliaia(n(x.domande))}</td>
                    <td style={{ ...cella, textAlign: 'right', color: '#166534' }}>{migliaia(n(x.senza_ia))}</td>
                    <td style={{ ...cella, textAlign: 'right' }}>{migliaia(n(x.chiamate_ia))}</td>
                    <td style={{ ...cella, textAlign: 'right', color: n(x.limite) ? '#7c3aed' : '#cbd5e1' }}>{migliaia(n(x.limite))}</td>
                    <td style={{ ...cella, textAlign: 'right', color: '#64748b' }}>{migliaia(n(x.token_in) + n(x.token_out))}</td>
                    <td style={{ ...cella, textAlign: 'right', fontWeight: 700 }}>{dollari(n(x.costo_usd))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 12 }}>
            Il costo usa i prezzi impostati su Railway (&lt;FORNITORE&gt;_PRICE_IN e _PRICE_OUT, dollari per milione di token):
            un fornitore senza prezzo conta come gratuito. Token e costi si contano da quando è attiva questa pagina.
          </p>
        </>
      )}
    </div>
  );
}

const linkDemo = (slug: string) => `${MENU_PUBBLICO}/?restaurant=${slug}`;
// Link da mandare in DM al titolare: la demo con dentro la chiave, cosi'
// dal tasto "Attiva" va dritto all'attivazione. Solo per chi lo riceve.
const linkPerDm = (r: AdminRestaurant) =>
  r.is_demo && r.demo_claim_token ? `${linkDemo(r.slug)}&attiva=${encodeURIComponent(r.demo_claim_token)}` : linkDemo(r.slug);

function SuperAdminPanel({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [copiato, setCopiato] = useState<string | null>(null);

  async function copiaLink(r: AdminRestaurant) {
    const link = linkPerDm(r);
    try {
      await navigator.clipboard.writeText(link);
      setCopiato(r.slug);
      setTimeout(() => setCopiato(c => (c === r.slug ? null : c)), 2000);
    } catch {
      // Certi browser bloccano la copia: mostriamo il link da copiare a mano.
      window.prompt('Copia il link:', link);
    }
  }

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [restaurants, setRestaurants] = useState<AdminRestaurant[]>([]);
  const [tab, setTab] = useState<'dashboard' | 'restaurants' | 'conversazioni' | 'consumi' | 'new'>('dashboard');
  const [loading, setLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 860);
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 859px)');
    const fn = () => setIsMobile(mq.matches);
    fn();
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  const [newForm, setNewForm] = useState({ restaurant_name: '', owner_email: '', owner_password: '', monthly_price: '30' });
  const [newMsg, setNewMsg] = useState('');
  const [search, setSearch] = useState('');
  const [filtro, setFiltro] = useState<'tutti' | 'paganti' | 'prova' | 'scaduti' | 'clienti' | 'demo' | 'sospesi'>('tutti');

  async function load() {
    setLoading(true);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const [s, r] = await Promise.all([
        fetch(`${API}/api/admin/stats`, { headers }).then(x => x.json()),
        fetch(`${API}/api/admin/restaurants`, { headers }).then(x => x.json()),
      ]);
      setStats(s);
      setRestaurants(Array.isArray(r) ? r : []);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const [creatingRestaurant, setCreatingRestaurant] = useState(false);

  async function createRestaurant() {
    if (creatingRestaurant) return; // evita doppie richieste da doppio click
    setNewMsg('');
    setCreatingRestaurant(true);
    try {
      const res = await fetch(`${API}/api/admin/restaurants`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newForm, monthly_price: parseFloat(newForm.monthly_price) }),
      });
      const data = await res.json();
      if (res.ok) {
        setNewMsg(`✅ Ristorante creato! Slug: ${data.slug} | QR: ${data.qr_base_url}`);
        setNewForm({ restaurant_name: '', owner_email: '', owner_password: '', monthly_price: '30' });
        load();
      } else setNewMsg(`❌ ${data.error}`);
    } catch { setNewMsg('❌ Errore di rete'); } finally { setCreatingRestaurant(false); }
  }

  async function patchRestaurant(id: string, action: string, extra?: object) {
    await fetch(`${API}/api/admin/restaurants/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    });
    load();
  }

  const cerca = search.toLowerCase();
  const filtered = restaurants.filter(r =>
    (r.name ?? '').toLowerCase().includes(cerca) ||
    (r.owner_email ?? '').toLowerCase().includes(cerca)
  );

  // Menu con descrizione = almeno un piatto con la descrizione scritta
  // (es. "Bruschetta — pane tostato con pomodoro"). Vanno in cima.
  const conDesc = (r: AdminRestaurant) => Number(r.dishes_with_description ?? 0) > 0;
  const quotaDesc = (r: AdminRestaurant) => Number(r.dish_count) > 0 ? Number(r.dishes_with_description ?? 0) / Number(r.dish_count) : 0;
  const conDescrizione = filtered.filter(conDesc).sort((a, b) => quotaDesc(b) - quotaDesc(a) || Number(b.dish_count) - Number(a.dish_count));
  const senzaDescrizione = filtered.filter(r => !conDesc(r));

  const statusColor = (s: string) => s === 'active' ? '#22c55e' : s === 'trialing' ? '#f59e0b' : s === 'past_due' ? '#f97316' : '#ef4444';
  const statusLabel = (s: string) => s === 'active' ? '✅ Attivo' : s === 'trialing' ? '🟡 Trial' : s === 'past_due' ? '🟠 In ritardo' : s === 'suspended' ? '🔴 Sospeso' : s === 'cancelled' ? '❌ Cancellato' : s;

  // Stato di un cliente in parole: quanto manca alla fine della prova, se
  // e' scaduta senza pagare, se il menu e' in pausa.
  const giorno = (d: string) => new Date(d).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  function statoCliente(r: AdminRestaurant): { titolo: string; dettaglio: string; colore: string; avviso?: boolean } {
    const prezzo = `A$${Number(r.monthly_price ?? 30).toFixed(0)}/mese`;
    if (r.suspended_at) return { titolo: '🔴 Sospeso', dettaglio: `dal ${giorno(r.suspended_at)}`, colore: '#ef4444' };
    if (r.subscription_status === 'active') return { titolo: '✅ Paga', dettaglio: prezzo, colore: '#22c55e' };
    if (r.subscription_status === 'past_due') return { titolo: '🟠 Pagamento non riuscito', dettaglio: 'Stripe sta riprovando', colore: '#f97316', avviso: true };
    if (r.subscription_status === 'cancelled') return { titolo: '❌ Ha disdetto', dettaglio: r.in_pausa ? 'menu in pausa' : '', colore: '#ef4444', avviso: true };
    if (r.subscription_status === 'trialing' && r.trial_ends_at) {
      const giorni = Math.ceil((new Date(r.trial_ends_at).getTime() - Date.now()) / 86400000);
      if (giorni > 0) return {
        titolo: '🟡 In prova',
        dettaglio: `${giorni === 1 ? 'scade domani' : `scade tra ${giorni} giorni`} (${giorno(r.trial_ends_at)})`,
        colore: '#f59e0b', avviso: giorni <= 2,
      };
      return {
        titolo: r.in_pausa ? '⏸️ Menu in pausa' : '🔴 Prova scaduta',
        dettaglio: `scaduta il ${giorno(r.trial_ends_at)} · non ha pagato`,
        colore: '#ef4444', avviso: true,
      };
    }
    return { titolo: statusLabel(r.subscription_status), dettaglio: prezzo, colore: statusColor(r.subscription_status) };
  }
  const provaScaduta = (r: AdminRestaurant) =>
    !r.is_demo && r.subscription_status === 'trialing' && !!r.trial_ends_at && new Date(r.trial_ends_at).getTime() <= Date.now();
  const FILTRI = {
    tutti:    { etichetta: 'Tutti', vale: (_r: AdminRestaurant) => true },
    paganti:  { etichetta: '✅ Paganti', vale: (r: AdminRestaurant) => !r.is_demo && r.subscription_status === 'active' },
    prova:    { etichetta: '🟡 In prova', vale: (r: AdminRestaurant) => !r.is_demo && r.subscription_status === 'trialing' && !provaScaduta(r) },
    scaduti:  { etichetta: '🔴 Prova scaduta', vale: provaScaduta },
    clienti:  { etichetta: '🏪 Tutti i clienti', vale: (r: AdminRestaurant) => !r.is_demo },
    demo:     { etichetta: '🎭 Demo', vale: (r: AdminRestaurant) => !!r.is_demo },
    sospesi:  { etichetta: '⛔ Sospesi', vale: (r: AdminRestaurant) => !r.is_demo && !!r.suspended_at },
  } as const;
  type Filtro = keyof typeof FILTRI;
  const apriElenco = (f: Filtro) => { setFiltro(f); setTab('restaurants'); };
  const perScadenza = (a: AdminRestaurant, b: AdminRestaurant) =>
    new Date(a.trial_ends_at || 0).getTime() - new Date(b.trial_ends_at || 0).getTime();

  const scheda = (r: AdminRestaurant) => (
                <div key={r.id} style={{ ...S.formCard, padding: '18px 20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                    <div style={{ minWidth: 0, flex: '1 1 240px' }}>
                      <div style={{ fontWeight: 700, fontSize: 17, color: '#1e293b', wordBreak: 'break-word' }}>{r.name}</div>
                      <div style={{ fontSize: 13, color: '#64748b', marginTop: 2, wordBreak: 'break-word' }}>
                        👤 {r.owner_email} &nbsp;|&nbsp; 📋 {r.dish_count} piatti &nbsp;|&nbsp; 💬 {r.sessions_30d} sessioni/30gg
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                          background: conDesc(r) ? '#dcfce7' : '#f1f5f9', color: conDesc(r) ? '#166534' : '#64748b' }}>
                          {conDesc(r)
                            ? `📝 Con descrizione · ${Number(r.dishes_with_description)} di ${r.dish_count} piatti`
                            : '⚪ Senza descrizione'}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 8px', borderRadius: 6,
                          background: r.is_demo ? '#fef3c7' : '#e0e7ff', color: r.is_demo ? '#92400e' : '#3730a3' }}>
                          {r.is_demo ? '🎭 Demo' : '🏪 Cliente'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                        <a
                          href={linkDemo(r.slug)}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontSize: 13, color: '#2563eb', textDecoration: 'none', fontWeight: 600,
                            border: '1px solid #bfdbfe', background: '#eff6ff',
                            padding: '5px 10px', borderRadius: 7, whiteSpace: 'nowrap',
                          }}>
                          🔗 Apri la demo
                        </a>
                        <button
                          onClick={() => copiaLink(r)}
                          title={r.is_demo ? 'Link della demo con il tasto per attivarla: mandalo solo al titolare' : undefined}
                          style={{
                            fontSize: 13, cursor: 'pointer', fontWeight: 600,
                            border: '1px solid ' + (copiato === r.slug ? '#86efac' : '#e2e8f0'),
                            background: copiato === r.slug ? '#f0fdf4' : '#f8fafc',
                            color: copiato === r.slug ? '#166534' : '#475569',
                            padding: '5px 10px', borderRadius: 7, whiteSpace: 'nowrap',
                          }}>
                          {copiato === r.slug ? '✓ Copiato' : r.is_demo ? '📋 Copia link per DM' : '📋 Copia link'}
                        </button>
                        <code style={{ fontSize: 11, color: '#94a3b8', wordBreak: 'break-all' }}>
                          /?restaurant={r.slug}
                        </code>
                      </div>
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                        Creato: {new Date(r.created_at).toLocaleDateString('it-IT')}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                      <div style={{ textAlign: 'right' }}>
                        {r.is_demo ? (
                          // Una demo non e' ancora un cliente: niente trial,
                          // il trial parte solo quando il ristoratore la attiva.
                          <div style={{ fontWeight: 700, color: '#0ea5e9' }}>⏳ In attivazione</div>
                        ) : (
                          <>
                            <div style={{ fontWeight: 700, color: statoCliente(r).colore }}>{statoCliente(r).titolo}</div>
                            <div style={{ fontSize: 13, color: statoCliente(r).avviso ? '#b91c1c' : '#64748b', fontWeight: statoCliente(r).avviso ? 700 : 400 }}>{statoCliente(r).dettaglio}</div>
                          </>
                        )}
                      </div>
                      {!r.is_demo && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {r.suspended_at
                          ? <button style={{ ...S.btnEdit, color: '#22c55e', borderColor: '#22c55e' }} onClick={() => patchRestaurant(r.id, 'activate')}>✅ Riattiva</button>
                          : <button style={{ ...S.btnEdit, color: '#ef4444', borderColor: '#ef4444' }} onClick={() => { if (confirm(`Sospendere ${r.name}?`)) patchRestaurant(r.id, 'suspend'); }}>🔴 Sospendi</button>
                        }
                      </div>}
                    </div>
                  </div>
                </div>
  );

  const sidebarStyle: React.CSSProperties = isMobile
    ? { ...S.sidebar, background: '#0f172a', position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 60, width: 250,
        transform: navOpen ? 'translateX(0)' : 'translateX(-100%)', transition: 'transform .25s ease', boxShadow: navOpen ? '0 0 40px #0007' : 'none' }
    : { ...S.sidebar, background: '#0f172a' };

  return (
    <div style={S.root}>
      {isMobile && (
        <div style={S.mobileBar}>
          <button style={S.hamburger} onClick={() => setNavOpen(true)} aria-label="Menu">☰</button>
          <span style={{ fontWeight: 700, fontSize: 15, color: '#1e293b' }}>Super Admin</span>
        </div>
      )}
      {isMobile && navOpen && <div style={S.navBackdrop} onClick={() => setNavOpen(false)} />}

      <aside style={sidebarStyle}>
        <div style={{ ...S.sidebarHeader, marginBottom: 28 }}>
          <div style={{ fontSize: 28 }}>🛡️</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#f8fafc' }}>Super Admin</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>Piattaforma</div>
          </div>
        </div>
        <nav style={S.nav}>
          {([['dashboard', '📊 Dashboard'], ['restaurants', '🍽️ Ristoranti'], ['conversazioni', '💬 Conversazioni'], ['consumi', '💸 Consumi IA'], ['new', '➕ Nuovo ristorante']] as const).map(([key, label]) => (
            <button key={key} style={{ ...S.navBtn, ...(tab === key ? S.navBtnActive : {}) }} onClick={() => { setTab(key); setNavOpen(false); }}>{label}</button>
          ))}
        </nav>
        <button style={S.logoutBtn} onClick={onLogout}>← Esci</button>
      </aside>

      <main style={{ ...S.main, ...(isMobile ? { paddingTop: 52 } : {}) }}>
        {loading && <div style={S.loader}>Caricamento...</div>}

        {/* ── DASHBOARD ── */}
        {tab === 'dashboard' && stats && (
          <div style={S.content}>
            <h1 style={S.pageTitle}>📊 Panoramica Piattaforma</h1>
            <div style={S.kpiGrid}>
              <KPI label="Clienti" value={String(stats.total_restaurants)} color="#6366f1" sub="Ristoranti attivati (demo escluse)" onClick={() => apriElenco('clienti')} />
              <KPI label="Abbonamenti attivi" value={String(stats.active_subscriptions)} color="#22c55e" sub="Pagano" onClick={() => apriElenco('paganti')} />
              <KPI label="In prova" value={String(stats.trialing)} color="#f59e0b" sub="Prova gratuita in corso" onClick={() => apriElenco('prova')} />
              <KPI label="Prova scaduta" value={String(stats.prova_scaduta ?? 0)} color="#ef4444" sub="Non hanno pagato" onClick={() => apriElenco('scaduti')} />
              <KPI label="Demo in attivazione" value={String(stats.demos ?? 0)} color="#0ea5e9" sub="Non ancora attivate dal ristoratore" onClick={() => apriElenco('demo')} />
              <KPI label="Sospesi" value={String(stats.suspended)} color="#ef4444" onClick={() => apriElenco('sospesi')} />
              <KPI label="MRR" value={`A$${parseFloat(stats.mrr || '0').toFixed(0)}`} color="#6366f1" sub="Ricavo mensile ricorrente" />
              <KPI label="Sessioni (30gg)" value={String(stats.sessions_30d)} color="#0ea5e9" />
              <KPI label="Nuovi (30gg)" value={String(stats.new_30d)} color="#8b5cf6" />
            </div>
          </div>
        )}

        {/* ── RISTORANTI ── */}
        {tab === 'restaurants' && (
          <div style={S.content}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <h1 style={S.pageTitle}>🍽️ Ristoranti</h1>
              <input style={{ ...S.formInput, width: '100%', maxWidth: 240, margin: 0 }} placeholder="🔍 Cerca..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '4px 0 8px' }}>
              {(Object.keys(FILTRI) as Filtro[]).map(k => {
                const n = filtered.filter(FILTRI[k].vale).length;
                const on = filtro === k;
                return (
                  <button key={k} onClick={() => setFiltro(k)} style={{
                    padding: '7px 12px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    border: '1px solid ' + (on ? '#6366f1' : '#e2e8f0'), background: on ? '#6366f1' : '#fff', color: on ? '#fff' : '#475569',
                  }}>{FILTRI[k].etichetta} ({n})</button>
                );
              })}
            </div>
            {filtro !== 'tutti' && (() => {
              const lista = filtered.filter(FILTRI[filtro].vale);
              if (filtro === 'prova' || filtro === 'scaduti') lista.sort(perScadenza);
              return lista.length === 0
                ? <div style={{ ...S.formCard, color: '#64748b', textAlign: 'center' }}>Nessun ristorante in questo elenco.</div>
                : <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{lista.map(scheda)}</div>;
            })()}
            {filtro === 'tutti' && ([
              ['📝 Menu con descrizione', `Almeno un piatto ha la descrizione (es. "Bruschetta — pane tostato con pomodoro"). Ordinati dal menu più completo.`, conDescrizione, '#166534'],
              ['⚪ Menu senza descrizione', 'Solo nomi dei piatti (e prezzi), nessuna descrizione.', senzaDescrizione, '#64748b'],
            ] as const).map(([titolo, spiega, lista, colore]) => (
              <section key={titolo} style={{ marginTop: 8 }}>
                <h2 style={{ fontSize: 18, fontWeight: 800, color: colore, margin: '18px 0 2px' }}>{titolo} ({lista.length})</h2>
                <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 12 }}>{spiega}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {lista.map(scheda)}
                </div>
              </section>
            ))}
          </div>
        )}

        {tab === 'conversazioni' && <Conversazioni token={token} />}
        {tab === 'consumi' && <ConsumiIA token={token} />}

        {/* ── NUOVO RISTORANTE ── */}
        {tab === 'new' && (
          <div style={S.content}>
            <h1 style={S.pageTitle}>➕ Nuovo ristorante</h1>
            <div style={S.formCard}>
              <div style={S.formGrid}>
                <label style={S.formLabel}>Nome ristorante<input style={S.formInput} value={newForm.restaurant_name} onChange={e => setNewForm(f => ({ ...f, restaurant_name: e.target.value }))} placeholder="Es. Ristorante Da Mario" /></label>
                <label style={S.formLabel}>Email owner<input style={S.formInput} type="email" value={newForm.owner_email} onChange={e => setNewForm(f => ({ ...f, owner_email: e.target.value }))} placeholder="mario@ristorante.it" /></label>
                <label style={S.formLabel}>Password owner<input style={S.formInput} type="password" value={newForm.owner_password} onChange={e => setNewForm(f => ({ ...f, owner_password: e.target.value }))} placeholder="Min 8 caratteri" /></label>
                <label style={S.formLabel}>Prezzo mensile (A$)<input style={S.formInput} type="number" value={newForm.monthly_price} onChange={e => setNewForm(f => ({ ...f, monthly_price: e.target.value }))} /></label>
              </div>
              {newMsg && <div style={{ marginTop: 12, fontSize: 14, padding: '10px 14px', borderRadius: 8, background: newMsg.startsWith('✅') ? '#f0fdf4' : '#fef2f2', color: newMsg.startsWith('✅') ? '#166534' : '#991b1b', border: `1px solid ${newMsg.startsWith('✅') ? '#86efac' : '#fca5a5'}` }}>{newMsg}</div>}
              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                <button style={S.btnPrimary} onClick={createRestaurant} disabled={creatingRestaurant || !newForm.restaurant_name || !newForm.owner_email || !newForm.owner_password}>
                  {creatingRestaurant ? 'Creazione...' : '➕ Crea ristorante'}
                </button>
                <button style={S.btnSecondary} onClick={() => { setNewForm({ restaurant_name: '', owner_email: '', owner_password: '', monthly_price: '30' }); setNewMsg(''); }}>Reset</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Main App ───────────────────────────────────────────────
// ─── Assistente del pannello ─────────────────────────────────
// Aiuta il TITOLARE a usare LingoFork (non l'assistente che parla con i
// clienti nel menu pubblico: quello è un'altra cosa, configurabile in
// "Impostazioni IA"). Fluttua su tutte le schede della dashboard.
function AssistenteWidget({ token }: { token: string }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [msgs, loading, open]);

  async function invia(e?: React.FormEvent) {
    e?.preventDefault();
    const testo = input.trim();
    if (!testo || loading) return;
    const cronologia = msgs;
    setMsgs(m => [...m, { role: 'user', content: testo }]);
    setInput('');
    setLoading(true);
    try {
      const data = await apiFetch('/api/assistente/chat', token, {
        method: 'POST',
        body: JSON.stringify({ message: testo, history: cronologia }),
      });
      setMsgs(m => [...m, { role: 'assistant', content: data.message }]);
    } catch {
      setMsgs(m => [...m, { role: 'assistant', content: '⚠️ Non riesco a rispondere adesso. Riprova tra poco.' }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {open && (
        <div style={S.assistPanel}>
          <div style={S.assistHead}>
            <div style={{ fontWeight: 700, fontSize: 14.5 }}>🤖 Assistente LingoFork</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 1 }}>Ti aiuto a usare il pannello</div>
          </div>
          <div style={S.assistBody} ref={bodyRef}>
            {msgs.length === 0 && (
              <div style={S.assistBubbleA}>Ciao! 👋 Chiedimi pure — es. "come aggiungo un piatto?", "quanto costa l'abbonamento?", "come cambio i colori del menu?"</div>
            )}
            {msgs.map((m, i) => <div key={i} style={m.role === 'user' ? S.assistBubbleU : S.assistBubbleA}>{m.content}</div>)}
            {loading && <div style={S.assistBubbleA}>Sto pensando…</div>}
          </div>
          <form onSubmit={invia} style={S.assistForm}>
            <input style={S.assistInput} value={input} onChange={e => setInput(e.target.value)} placeholder="Scrivi una domanda..." autoFocus />
            <button style={{ ...S.assistSend, opacity: loading || !input.trim() ? 0.5 : 1 }} type="submit" disabled={loading || !input.trim()} aria-label="Invia">➤</button>
          </form>
        </div>
      )}
      <button style={S.assistBtn} onClick={() => setOpen(o => !o)} aria-label={open ? 'Chiudi assistente' : 'Apri assistente'}>
        {open ? '✕' : '🤖'}
      </button>
    </>
  );
}

export default function App() {
  const [auth, setAuth] = useState<AuthData | null>(() => loadAuth());
  // ?vai=abbonamento (link nelle email e nei WhatsApp di fine prova) apre
  // direttamente la scheda per pagare
  const [tab, setTab] = useState<Tab>(() =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('vai') === 'abbonamento' ? 'billing' : 'menu');
  // Stripe rimanda qui con ?billing=success dopo il pagamento
  const [benvenutoPro, setBenvenutoPro] = useState(() =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('billing') === 'success');
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('billing')) return;
    try { window.history.replaceState(null, '', window.location.pathname); } catch { /* ignora */ }
  }, []);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 860);
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 859px)');
    const upd = () => setIsMobile(mq.matches);
    upd();
    mq.addEventListener('change', upd);
    return () => mq.removeEventListener('change', upd);
  }, []);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [menu, setMenu] = useState<Dish[]>([]);
  const [menuForm, setMenuForm] = useState<Partial<Dish> | null>(null);
  const [menuSaving, setMenuSaving] = useState(false);
  const [menuSaveError, setMenuSaveError] = useState('');
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoMsg, setLogoMsg] = useState('');
  const [settingsKey, setSettingsKey] = useState('');
  const [settingsMsg, setSettingsMsg] = useState('');
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [aiName, setAiName] = useState('Marco');
  const [assistenteAttivo, setAssistenteAttivo] = useState(true);
  const [assistenteSalvando, setAssistenteSalvando] = useState(false);
  const [assistenteMsg, setAssistenteMsg] = useState('');
  const [aiNameMsg, setAiNameMsg] = useState('');
  const [locale, setLocale] = useState<{ city: string; region: string; country: string; timezone: string; latitude: number | null; longitude: number | null; cuisine_type: string; about: string; instagram_url: string; ig_popup_shown: number; ig_follow_clicks: number }>(
    { city: '', region: '', country: '', timezone: '', latitude: null, longitude: null, cuisine_type: '', about: '', instagram_url: '', ig_popup_shown: 0, ig_follow_clicks: 0 }
  );
  const [cercaCitta, setCercaCitta] = useState('');
  const [risultatiCitta, setRisultatiCitta] = useState<any[]>([]);
  const [cercando, setCercando] = useState(false);
  const [localeMsg, setLocaleMsg] = useState('');
  const [localeSaving, setLocaleSaving] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Traduzioni
  const LINGUE: [string, string][] = [
    ['en', 'Inglese'], ['it', 'Italiano'], ['de', 'Tedesco'], ['fr', 'Francese'],
    ['pt', 'Portoghese'], ['ru', 'Russo'], ['zh', 'Cinese'], ['ja', 'Giapponese'], ['ar', 'Arabo'],
    ['ko', 'Coreano'], ['id', 'Indonesiano'], ['hi', 'Hindi'],
  ];
  const [trLang, setTrLang] = useState('en');
  // loadTab e' ricreata a ogni render e chiusa sul trLang di quel render:
  // per accorgersi che nel frattempo l'utente ha scelto un'altra lingua
  // serve leggere il valore PIU' RECENTE, non quello catturato alla chiamata.
  const trLangRef = useRef('en');
  useEffect(() => { trLangRef.current = trLang; }, [trLang]);
  const [trRows, setTrRows] = useState<any[]>([]);
  const [trMsg, setTrMsg] = useState('');
  const [trBusy, setTrBusy] = useState(false);

  // Colori della pagina cliente
  const [colBg, setColBg] = useState('#0f0f1a');
  const [colPrimary, setColPrimary] = useState('#e94560');
  const [colMsg, setColMsg] = useState('');
  const [colSaving, setColSaving] = useState(false);
  const coloriCaricati = useRef(false);
  const [colFont, setColFont] = useState('system');

  // Il logout NON smonta questo componente (stesso App, torna solo a mostrare
  // <LoginScreen/>): senza questo reset esplicito, tutto lo stato del
  // ristorante precedente (colori, menu, nome AI, coloriCaricati...) resta in
  // memoria e "trapela" nel prossimo login fatto nella stessa scheda.
  function handleLogout() {
    clearAuth();
    setAuth(null);
    setRestaurant(null);
    setMenu([]);
    setMenuForm(null);
    setBilling(null);
    setAiName('Marco');
    setLocale({ city: '', region: '', country: '', timezone: '', latitude: null, longitude: null, cuisine_type: '', about: '', instagram_url: '', ig_popup_shown: 0, ig_follow_clicks: 0 });
    setTrRows([]);
    setColBg('#0f0f1a');
    setColPrimary('#e94560');
    setColFont('system');
    coloriCaricati.current = false;
    setTab('menu');
  }

  const CARATTERI: [string, string, string][] = [
    ['system', 'Predefinito', "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"],
    ['Inter', 'Inter — pulito e moderno', "'Inter', system-ui, sans-serif"],
    ['Poppins', 'Poppins — tondo e amichevole', "'Poppins', system-ui, sans-serif"],
    ['Montserrat', 'Montserrat — deciso', "'Montserrat', system-ui, sans-serif"],
    ['Lora', 'Lora — classico con grazie', "'Lora', Georgia, serif"],
    ['Playfair Display', 'Playfair — elegante', "'Playfair Display', Georgia, serif"],
    ['Caveat', 'Caveat — scritto a mano', "'Caveat', cursive"],
  ];

  // Tavolozze pronte: un clic e il locale ha un aspetto coerente
  const TAVOLOZZE: [string, string, string][] = [
    ['Notte', '#0f0f1a', '#e94560'],
    ['Carbone', '#1c1c1e', '#f5a623'],
    ['Bosco', '#10241c', '#4caf50'],
    ['Vino', '#2a1015', '#c0392b'],
    ['Panna', '#faf9f7', '#b03a2e'],
    ['Sabbia', '#f4efe6', '#8a6d3b'],
    ['Ghiaccio', '#f2f5f9', '#2f6feb'],
  ];

  // carica da Google Fonts il carattere scelto, per un'anteprima veritiera
  useEffect(() => {
    if (colFont === 'system') return;
    const id = `gf-${colFont}`;
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id; link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(colFont).replace(/%20/g, '+')}:wght@400;600;700&display=swap`;
    document.head.appendChild(link);
  }, [colFont]);

  const fontCss = (CARATTERI.find(c => c[0] === colFont) ?? CARATTERI[0])[2];

  // Stessa regola usata dalla pagina cliente: sfondo chiaro -> testo scuro
  function luminosita(sfondo: string) {
    if (!/^#[0-9a-fA-F]{6}$/.test(sfondo)) return 0;
    const r = parseInt(sfondo.slice(1, 3), 16), g = parseInt(sfondo.slice(3, 5), 16), b = parseInt(sfondo.slice(5, 7), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
  function mescola(sfondo: string, quanto: number) {
    if (!/^#[0-9a-fA-F]{6}$/.test(sfondo)) return sfondo;
    const chiaro = luminosita(sfondo) > 0.5;
    const verso = chiaro ? 0 : 255;
    const c = [1, 3, 5].map(i => {
      const v = parseInt(sfondo.slice(i, i + 2), 16);
      return Math.round(v + (verso - v) * quanto);
    });
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  }
  const superficieSu = (sfondo: string) => mescola(sfondo, 0.07);
  const bordoSu = (sfondo: string) => mescola(sfondo, 0.22);

  function testoSu(sfondo: string) {
    if (!/^#[0-9a-fA-F]{6}$/.test(sfondo)) return '#fff';
    const r = parseInt(sfondo.slice(1, 3), 16), g = parseInt(sfondo.slice(3, 5), 16), b = parseInt(sfondo.slice(5, 7), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? '#1b1b22' : '#f2f2f5';
  }

  async function salvaColori() {
    if (!auth || !restaurant) return;
    setColSaving(true); setColMsg('');
    try {
      const res = await fetch(`${API}/api/dashboard/${restaurant.id}/appearance`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ background_color: colBg, primary_color: colPrimary, font_family: colFont }),
      });
      const data = await res.json();
      setColMsg(res.ok ? 'Colori salvati. Ricarica la pagina del cliente per vederli.' : (data.error ?? 'Salvataggio non riuscito'));
    } catch { setColMsg('Errore di rete.'); } finally { setColSaving(false); }
  }

  useEffect(() => {
    // Il superadmin non appartiene a nessun ristorante: /api/auth/me cerca
    // nella tabella dei titolari e per lui non trova niente. Senza questo
    // controllo il fallimento faceva scattare il logout, e l'accesso super
    // admin rimbalzava subito alla schermata di login.
    if (!auth || auth.role === 'superadmin') return;
    apiFetch('/api/auth/me', auth.token)
      .then((me: any) => setRestaurant({ id: me.restaurant_id, name: me.restaurant_name, slug: me.slug }))
      .catch(() => { clearAuth(); setAuth(null); });
  }, [auth]);

  // Stato dell'abbonamento subito, non solo nella sua scheda: serve al
  // banner di fine prova in cima a ogni pagina.
  useEffect(() => {
    if (!auth || auth.role === 'superadmin') return;
    apiFetch('/api/billing/status', auth.token).then(setBilling).catch(() => {});
    if (new URLSearchParams(window.location.search).has('vai')) {
      try { window.history.replaceState(null, '', window.location.pathname); } catch { /* ignora */ }
    }
  }, [auth]);

  // La valuta del ristorante: serve per scrivere i prezzi con il simbolo
  // giusto in tutte le schede, non solo in quella dell'aspetto.
  useEffect(() => {
    if (!auth || !restaurant?.slug || restaurant.currency) return;
    apiFetch(`/api/menu/${restaurant.slug}/info`, auth.token)
      .then((info: any) => {
        if (info?.currency) setRestaurant(r => (r ? { ...r, currency: info.currency } : r));
      })
      .catch(() => { /* senza valuta si resta sull'euro */ });
  }, [auth, restaurant?.slug]);

  // Attenzione: la dipendenza e' restaurant?.id, NON l'oggetto restaurant.
  // Dentro loadTab aggiorniamo restaurant (per il logo): se dipendesse
  // dall'oggetto, ogni caricamento ne farebbe partire un altro all'infinito,
  // e a ogni giro i colori scelti verrebbero riscritti con quelli salvati.
  useEffect(() => {
    if (!auth || !restaurant?.id) return;
    loadTab(tab);
  }, [tab, restaurant?.id]);

  useEffect(() => {
    if (!auth || !restaurant || tab !== 'traduzioni') return;
    loadTab('traduzioni');
  }, [trLang]);

  // Salva una correzione fatta a mano: da quel momento e' definitiva
  async function salvaTraduzione(dishId: string, name: string, description: string) {
    if (!auth || !restaurant) return;
    setTrBusy(true); setTrMsg('');
    try {
      const res = await fetch(`${API}/api/menu/${restaurant.slug}/translations/${dishId}/${trLang}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });
      if (res.ok) {
        setTrRows(rows => rows.map(r => r.id === dishId ? { ...r, name, description, source: 'manual' } : r));
        setTrMsg('Correzione salvata: non verra piu sovrascritta.');
      } else setTrMsg('Salvataggio non riuscito.');
    } catch { setTrMsg('Errore di rete.'); } finally { setTrBusy(false); }
  }

  // Riempie le traduzioni mancanti di tutto il menu, a blocchi
  async function completaTraduzioni() {
    if (!auth || !restaurant) return;
    setTrBusy(true); setTrMsg('Traduzione in corso...');
    try {
      for (let giro = 0; giro < 40; giro++) {
        const res = await fetch(`${API}/api/menu/${restaurant.slug}/translations/refresh`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const data = await res.json();
        if (data.errore) { setTrMsg(`Traduzione interrotta: ${data.errore}`); break; }
        if (data.completato) { setTrMsg('Tutte le traduzioni sono complete.'); break; }
        setTrMsg(`Tradotti ${(giro + 1) * 25} piatti, continuo...`);
      }
      await loadTab('traduzioni');
    } catch { setTrMsg('Errore di rete.'); } finally { setTrBusy(false); }
  }

  async function loadTab(t: Tab) {
    if (!auth || !restaurant) return;
    setLoading(true);
    try {
      if (t === 'menu') {
        const data = await apiFetch(`/api/menu/${restaurant.slug}/dishes`, auth.token);
        setMenu(data);
      } else if (t === 'traduzioni') {
        const linguaRichiesta = trLang;
        const data = await apiFetch(`/api/menu/${restaurant.slug}/translations?lang=${linguaRichiesta}`, auth.token);
        // Se nel frattempo l'utente ha cambiato lingua, questa risposta e' vecchia: scartala.
        if (linguaRichiesta !== trLangRef.current) return;
        setTrRows(Array.isArray(data) ? data : []);
      } else if (t === 'ia') {
        const data = await apiFetch(`/api/dashboard/${restaurant.id}/settings`, auth.token).catch(ignoraSeNonAuth);
        if (data?.ai_name) setAiName(data.ai_name);
        if (typeof data?.assistente_attivo === 'boolean') setAssistenteAttivo(data.assistente_attivo);
      } else if (t === 'settings') {
        const data = await apiFetch(`/api/dashboard/${restaurant.id}/locale`, auth.token).catch(ignoraSeNonAuth);
        if (data) setLocale({
          city: data.city ?? '', region: '', country: data.country ?? '',
          timezone: data.timezone ?? '',
          latitude: data.latitude != null ? Number(data.latitude) : null,
          longitude: data.longitude != null ? Number(data.longitude) : null,
          cuisine_type: data.cuisine_type ?? '', about: data.about ?? '',
          instagram_url: data.instagram_url ?? '',
          ig_popup_shown: Number(data.ig_popup_shown ?? 0),
          ig_follow_clicks: Number(data.ig_follow_clicks ?? 0),
        });
      } else if (t === 'billing') {
        const data = await apiFetch('/api/billing/status', auth.token);
        setBilling(data);
      } else if (t === 'aspetto') {
        const restFull = await apiFetch(`/api/menu/${restaurant.slug}/info`, auth.token).catch(ignoraSeNonAuth);
        if (restFull?.logo_url) {
          const nuovo = `${API}${restFull.logo_url}`;
          setRestaurant(r => (r && r.logo_url === nuovo ? r : (r ? { ...r, logo_url: nuovo } : r)));
        }
        // solo al primo ingresso nella scheda: cosi' non sovrascrive
        // il colore che il titolare sta scegliendo in questo momento
        if (!coloriCaricati.current) {
          if (restFull?.background_color) setColBg(restFull.background_color);
          if (restFull?.primary_color) setColPrimary(restFull.primary_color);
          if (restFull?.font_family) setColFont(restFull.font_family);
          coloriCaricati.current = true;
        }
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { handleLogout(); alert('Sessione scaduta: effettua di nuovo l\'accesso.'); }
    } finally { setLoading(false); }
  }

  async function uploadLogo(file: File) {
    if (!auth) return;
    setLogoUploading(true); setLogoMsg('');
    try {
      const fd = new FormData();
      fd.append('logo', file);
      const res = await fetch(`${API}/api/upload/logo`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth.token}` },
        body: fd,
      });
      const data = await res.json();
      if (data.logo_url) {
        setRestaurant(r => r ? { ...r, logo_url: `${API}${data.logo_url}` } : r);
        setLogoMsg('✅ Logo aggiornato con successo!');
      } else setLogoMsg(`❌ ${data.error}`);
    } catch { setLogoMsg('❌ Errore upload'); } finally { setLogoUploading(false); }
  }

  async function cercaCittaOra() {
    if (!auth || cercaCitta.trim().length < 2) return;
    setCercando(true); setLocaleMsg(''); setRisultatiCitta([]);
    try {
      const data = await apiFetch(`/api/dashboard/cerca-citta?q=${encodeURIComponent(cercaCitta.trim())}`, auth.token);
      setRisultatiCitta(data.risultati ?? []);
      if ((data.risultati ?? []).length === 0) {
        setLocaleMsg('Nessuna citta\' trovata con questo nome. Controlla come l\'hai scritta.');
      }
    } catch { setLocaleMsg('Ricerca non riuscita.'); } finally { setCercando(false); }
  }

  function scegliCitta(c: any) {
    setLocale(l => ({
      ...l,
      city: c.city, region: c.region ?? '', country: c.country ?? '',
      timezone: c.timezone ?? '', latitude: c.latitude, longitude: c.longitude,
    }));
    setRisultatiCitta([]);
    setCercaCitta('');
    setLocaleMsg('');
  }

  async function salvaLocale() {
    if (!auth || !restaurant) return;
    setLocaleSaving(true); setLocaleMsg('');
    try {
      const res = await fetch(`${API}/api/dashboard/${restaurant.id}/locale`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(locale),
      });
      const data = await res.json();
      if (!res.ok) { setLocaleMsg(data.error ?? 'Salvataggio non riuscito'); return; }
      setLocaleMsg(data.completo
        ? 'Salvato.'
        : "Salvato, ma senza citta' scelta dall'elenco l'assistente non potra' dare ora e meteo locali.");
    } catch { setLocaleMsg('Errore di rete.'); } finally { setLocaleSaving(false); }
  }

  async function cambiaAssistente(acceso: boolean) {
    if (!auth || !restaurant || assistenteSalvando) return;
    setAssistenteSalvando(true);
    setAssistenteMsg('');
    try {
      const res = await fetch(`${API}/api/dashboard/${restaurant.id}/settings`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ assistente_attivo: acceso }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setAssistenteMsg(data.error ?? 'Salvataggio non riuscito'); return; }
      setAssistenteAttivo(acceso);
      setAssistenteMsg(acceso
        ? `Assistente acceso: entro un minuto i clienti vedono di nuovo ${aiName || 'Marco'}.`
        : 'Assistente spento: entro un minuto i clienti vedono solo il menu.');
    } catch { setAssistenteMsg('Errore di rete.'); }
    finally { setAssistenteSalvando(false); }
  }

  async function salvaNomeAI() {
    if (!auth || !restaurant) return;
    setAiNameMsg('');
    try {
      const res = await fetch(`${API}/api/dashboard/${restaurant.id}/settings`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai_name: aiName }),
      });
      const data = await res.json();
      if (res.ok) {
        setAiNameMsg('Nome salvato. I clienti lo vedranno al prossimo accesso.');
        if (!aiName.trim()) setAiName('Marco');
      } else setAiNameMsg(data.error ?? 'Salvataggio non riuscito');
    } catch { setAiNameMsg('Errore di rete.'); }
  }

  async function saveApiKey() {
    if (!auth || !restaurant) return;
    setSettingsSaving(true); setSettingsMsg('');
    try {
      const res = await fetch(`${API}/api/dashboard/${restaurant.id}/settings`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ groq_api_key: settingsKey }),
      });
      const data = await res.json();
      setSettingsMsg(res.ok ? '✅ Chiave salvata!' : `❌ ${data.error}`);
      if (res.ok) setSettingsKey('');
    } catch { setSettingsMsg('❌ Errore di rete'); } finally { setSettingsSaving(false); }
  }

  async function saveDish() {
    if (!auth || !restaurant || !menuForm) return;
    if (!menuForm.name?.trim() || !(menuForm.category ?? '').trim() || !Number.isFinite(menuForm.price) || (menuForm.price as number) < 0) {
      setMenuSaveError('Nome, categoria e prezzo (≥ 0) sono obbligatori.');
      return;
    }
    setMenuSaving(true);
    setMenuSaveError('');
    try {
      const method = menuForm.id ? 'PATCH' : 'POST';
      const url = menuForm.id
        ? `${API}/api/menu/${restaurant.slug}/dishes/${menuForm.id}`
        : `${API}/api/menu/${restaurant.slug}/dishes`;
      const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(menuForm),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMenuSaveError(data.error || `Salvataggio non riuscito (errore ${res.status})`);
        return; // il form resta aperto: niente si perde
      }
      setMenuForm(null);
      const data = await apiFetch(`/api/menu/${restaurant.slug}/dishes`, auth.token);
      setMenu(data);
    } catch {
      setMenuSaveError('Errore di rete: il piatto potrebbe non essere stato salvato.');
    } finally { setMenuSaving(false); }
  }

  async function deleteDish(id: string) {
    if (!auth || !restaurant || !confirm('Eliminare questo piatto?')) return;
    // Si toglie dall'elenco solo se il server conferma: altrimenti sparirebbe
    // qui ma resterebbe visibile ai clienti.
    try {
      const res = await fetch(`${API}/api/menu/${restaurant.slug}/dishes/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!res.ok) {
        alert(`Il piatto NON e' stato eliminato (errore ${res.status}). Riprova.`);
        return;
      }
      setMenu(m => m.filter(d => d.id !== id));
    } catch {
      alert('Il piatto NON e\' stato eliminato: problema di rete. Riprova.');
    }
  }

  async function startCheckout() {
    if (!auth) return;
    try {
      const res = await fetch(`${API}/api/billing/checkout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) { window.location.href = data.url; return; }
      alert('Errore checkout Stripe' + (data.dettaglio ? `:
${data.dettaglio}` : ''));
    } catch { alert('Errore checkout Stripe'); }
  }

  async function openPortal() {
    if (!auth) return;
    try {
      const data = await apiFetch('/api/billing/portal', auth.token, { method: 'POST' });
      if (data.url) window.open(data.url, '_blank');
    } catch { alert('Nessun abbonamento attivo'); }
  }

  // Il link di attivazione della demo (?attiva=slug&token=...) ha la precedenza
  // su qualunque sessione gia' salvata in questo browser: chi apre quel link
  // deve sempre finire sulla schermata "scegli email e password", non su una
  // dashboard altrui rimasta loggata (es. un accesso di prova).
  {
    const qp = new URLSearchParams(window.location.search);
    const claimSlug = qp.get('attiva');
    const claimToken = qp.get('token');
    if (claimSlug && claimToken) {
      return <ClaimScreen slug={claimSlug} token={claimToken} onDone={d => { saveAuth(d); setAuth(d); }} />;
    }
    const resetToken = qp.get('reset');
    if (resetToken) {
      return <ReimpostaPassword token={resetToken} onDone={d => { saveAuth(d); setAuth(d); }} />;
    }
  }

  // Sul sito admin serve una sessione Super Admin, sul sito dei ristoratori
  // una da ristoratore: altrimenti si torna al login giusto.
  const vuoleAdmin = chiedeAdmin();
  if (!auth || (vuoleAdmin && auth.role !== 'superadmin') || (SITO_RISTORATORI && auth.role === 'superadmin')) {
    return <LoginScreen onLogin={d => { saveAuth(d); setAuth(d); }} />;
  }

  if (auth.role === 'superadmin') {
    return <SuperAdminPanel token={auth.token} onLogout={() => { clearAuth(); setAuth(null); }} />;
  }

  // Indirizzo pubblico del menu del ristorante (uno solo, niente piu' tavoli)
  const menuBase = MENU_PUBBLICO;
  const menuUrl = restaurant ? `${menuBase}/?restaurant=${restaurant.slug}` : '';
  const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(menuUrl)}`;
  // Banner di fine prova: da 3 giorni prima della scadenza fino al pagamento
  const bannerProva = (() => {
    if (!billing) return null;
    const rosso = { background: '#fef2f2', borderColor: '#fca5a5', color: '#991b1b' };
    const giallo = { background: '#fffbeb', borderColor: '#fcd34d', color: '#92400e' };
    if (billing.in_pausa) {
      return { stile: rosso, testo: "⏸️ Il tuo menu è in pausa: i clienti non lo vedono. Menu e QR code sono salvati, attiva l'abbonamento e torna online subito." };
    }
    if (billing.subscription_status !== 'trialing' || !billing.trial_ends_at) return null;
    const fine = new Date(billing.trial_ends_at);
    const giorni = Math.ceil((fine.getTime() - Date.now()) / 86400000);
    if (giorni <= 0) {
      const pausa = new Date(fine.getTime() + (billing.giorni_tolleranza ?? 3) * 86400000);
      return { stile: rosso, testo: `⏳ La prova gratuita è finita. Il menu resta online fino al ${pausa.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}, poi va in pausa.` };
    }
    if (giorni <= 3) {
      return { stile: giallo, testo: `⏳ La prova gratuita finisce ${giorni === 1 ? 'domani' : `tra ${giorni} giorni`}.` };
    }
    return null;
  })();
  const statusColor = billing?.subscription_status === 'active' ? '#22c55e' : billing?.subscription_status === 'trialing' ? '#f59e0b' : '#ef4444';
  const statusLabel = billing?.subscription_status === 'active' ? '✅ Attivo' : billing?.subscription_status === 'trialing' ? '🟡 Trial' : billing?.subscription_status === 'past_due' ? '🔴 Pagamento in ritardo' : billing?.subscription_status === 'cancelled' ? '❌ Cancellato' : '—';

  const navItems: [Tab, string][] = [
    ['menu', '📋 Menu'],
    ['traduzioni', '🌍 Traduzioni'],
    ['aspetto', '🎨 Aspetto'],
    ['qr', '📱 QR Code'],
    ['ia', '🤖 Impostazioni IA'],
    ['billing', '💳 Abbonamento'],
    ['settings', '⚙️ Impostazioni'],
  ];

  const sidebarStyle: React.CSSProperties = isMobile
    ? { ...S.sidebar, position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 60, width: 250,
        transform: navOpen ? 'translateX(0)' : 'translateX(-100%)', transition: 'transform .25s ease', boxShadow: navOpen ? '0 0 40px #0007' : 'none' }
    : S.sidebar;

  return (
    <div style={S.root}>
      {benvenutoPro && (
        <div style={S.benvenutoOverlay} onClick={() => setBenvenutoPro(false)}>
          <div style={S.benvenutoCard} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
            <button style={S.benvenutoX} onClick={() => setBenvenutoPro(false)} aria-label="Chiudi">✕</button>
            <div style={{ fontSize: 52, lineHeight: 1 }}>🎉</div>
            <h2 style={{ margin: '14px 0 8px', fontSize: 22, color: '#1e293b' }}>Benvenuto in LingoFork Pro!</h2>
            <p style={{ margin: 0, color: '#475569', lineHeight: 1.55 }}>
              Il tuo abbonamento è attivo. Da oggi ogni cliente che inquadra il QR trova il tuo menu
              nella sua lingua, con Marco pronto a consigliarlo.
            </p>
            <p style={{ margin: '12px 0 0', color: '#64748b', fontSize: 13, lineHeight: 1.5 }}>
              Il rinnovo è automatico ogni mese. Ricevute e metodo di pagamento sono in 💳 Abbonamento.
            </p>
            <button style={{ ...S.btnPrimary, marginTop: 22, width: '100%' }} onClick={() => setBenvenutoPro(false)}>
              Iniziamo
            </button>
          </div>
        </div>
      )}
      {isMobile && (
        <div style={S.mobileBar}>
          <button style={S.hamburger} onClick={() => setNavOpen(true)} aria-label="Menu">☰</button>
          <span style={{ fontWeight: 700, fontSize: 15, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {restaurant?.name ?? 'Dashboard'}
          </span>
        </div>
      )}
      {isMobile && navOpen && <div style={S.navBackdrop} onClick={() => setNavOpen(false)} />}

      {/* Sidebar */}
      <aside style={sidebarStyle}>
        <div style={S.sidebarHeader}>
          {restaurant?.logo_url
            ? <img src={restaurant.logo_url} alt="logo" style={{ height: 40, objectFit: 'contain', borderRadius: 8 }} />
            : <div style={S.sidebarLogo}>🍽️</div>}
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#f8fafc' }}>{restaurant?.name ?? '...'}</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>Dashboard</div>
          </div>
        </div>
        <nav style={S.nav}>
          {navItems.map(([key, label]) => (
            <button key={key} style={{ ...S.navBtn, ...(tab === key ? S.navBtnActive : {}) }} onClick={() => { setTab(key); setNavOpen(false); }}>
              {label}
            </button>
          ))}
          {/* Subito sotto le voci, non in fondo alla barra: la barra e' alta
              quanto la pagina e con un menu lungo "Esci" finiva fuori vista */}
          <button style={S.logoutBtn} onClick={handleLogout}>
            ← Esci
          </button>
        </nav>
      </aside>

      {/* Main */}
      <main style={{ ...S.main, ...(isMobile ? { paddingTop: 52 } : {}) }}>
        {loading && <div style={S.loader}>Caricamento...</div>}
        {bannerProva && (
          <div style={{ ...S.bannerProva, ...bannerProva.stile }}>
            <span>{bannerProva.testo}</span>
            {tab !== 'billing' && (
              <button style={S.bannerProvaBtn} onClick={() => setTab('billing')}>Attiva l'abbonamento</button>
            )}
          </div>
        )}

        {/* ── MENU ── */}
        {tab === 'menu' && (
          <div style={S.content}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <h1 style={S.pageTitle}>📋 Gestione Menu</h1>
              <button style={S.btnPrimary} onClick={() => { setMenuSaveError(''); setMenuForm({ name: '', description: '', price: 0, category: categorieDelMenu(menu)[0] ?? '', available: true }); }}>
                + Aggiungi piatto
              </button>
            </div>
            {menuForm !== null && (
              <div style={S.formCard}>
                <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>{menuForm.id ? 'Modifica' : 'Nuovo piatto'}</h2>
                {menuSaveError && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>⚠️ {menuSaveError}</div>}
                <div style={S.formGrid}>
                  <label style={S.formLabel}>Nome<input style={S.formInput} value={menuForm.name ?? ''} onChange={e => setMenuForm(f => ({ ...f, name: e.target.value }))} /></label>
                  <label style={S.formLabel}>Categoria
                    <input style={S.formInput} list="categorie-menu" placeholder="es. Antipasti, Hot Mezza, To Share"
                      value={menuForm.category ?? ''} onChange={e => setMenuForm(f => ({ ...f, category: e.target.value }))} />
                    <datalist id="categorie-menu">
                      {[...new Set([...categorieDelMenu(menu), ...CATEGORIE_SUGGERITE])].map(c => <option key={c} value={c} />)}
                    </datalist>
                  </label>
                  <label style={S.formLabel}>Prezzo ({simboloValuta(restaurant?.currency)})<input style={S.formInput} type="number" step="0.5" value={menuForm.price ?? 0} onChange={e => setMenuForm(f => ({ ...f, price: parseFloat(e.target.value) }))} /></label>
                  <label style={S.formLabel}>Disponibile
                    <select style={S.formInput} value={menuForm.available ? 'si' : 'no'} onChange={e => setMenuForm(f => ({ ...f, available: e.target.value === 'si' }))}>
                      <option value="si">Sì</option><option value="no">No</option>
                    </select>
                  </label>
                </div>
                <label style={{ ...S.formLabel, marginTop: 8 }}>Descrizione<textarea style={{ ...S.formInput, minHeight: 64, resize: 'vertical' }} value={menuForm.description ?? ''} onChange={e => setMenuForm(f => ({ ...f, description: e.target.value }))} /></label>
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <button style={S.btnPrimary} disabled={menuSaving} onClick={saveDish}>{menuSaving ? 'Salvataggio...' : 'Salva'}</button>
                  <button style={S.btnSecondary} onClick={() => { setMenuForm(null); setMenuSaveError(''); }}>Annulla</button>
                </div>
              </div>
            )}
            {categorieDelMenu(menu).map(cat => {
              const dishes = menu.filter(d => (d.category ?? '').trim() === cat);
              if (!dishes.length) return null;
              return (
                <div key={cat}>
                  <h2 style={S.sectionTitle}>{cat} <span style={{ fontWeight: 400, fontSize: 13, color: '#94a3b8' }}>({dishes.length})</span></h2>
                  <div style={S.table}>
                    <div style={{ ...S.tableHeader, gridTemplateColumns: '1.6fr 2fr 90px 90px 84px 52px', minWidth: 760 }}>
                      <span>Nome</span><span>Descrizione</span><span>Prezzo</span><span>Stato</span><span></span><span></span>
                    </div>
                    {dishes.map(d => (
                      <div key={d.id} style={{ ...S.tableRow, gridTemplateColumns: '1.6fr 2fr 90px 90px 84px 52px', minWidth: 760 }}>
                        <span style={{ fontWeight: 600 }}>{d.name}</span>
                        <span style={{ color: '#64748b', fontSize: 13 }}>{d.description}</span>
                        <span>{simboloValuta(restaurant?.currency)}{parseFloat(String(d.price)).toFixed(2)}</span>
                        <span style={{ color: d.available ? '#22c55e' : '#ef4444', fontWeight: 600 }}>{d.available ? '✓ Attivo' : '✗ Nascosto'}</span>
                        <button style={S.btnEdit} onClick={() => { setMenuSaveError(''); setMenuForm({ ...d }); }}>Modifica</button>
                        <button style={{ ...S.btnEdit, color: '#ef4444', borderColor: '#ef4444' }} onClick={() => deleteDish(d.id)}>✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── TRADUZIONI ── */}
        {tab === 'traduzioni' && (
          <div style={S.content}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <h1 style={S.pageTitle}>🌍 Traduzioni</h1>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <select style={{ ...S.formInput, width: 160 }} value={trLang} onChange={e => setTrLang(e.target.value)}>
                  {LINGUE.map(([code, nome]) => <option key={code} value={code}>{nome}</option>)}
                </select>
                <button style={S.btnPrimary} disabled={trBusy} onClick={completaTraduzioni}>
                  {trBusy ? 'Attendere...' : 'Completa le mancanti'}
                </button>
              </div>
            </div>

            <p style={{ color: '#64748b', margin: '4px 0 16px' }}>
              I piatti nuovi vengono tradotti da soli quando li salvi. Qui puoi correggere a mano
              quello che non ti convince: le correzioni restano e non vengono mai sovrascritte.
            </p>
            {trMsg && <div style={{ ...S.formCard, padding: 12, marginBottom: 12 }}>{trMsg}</div>}

            <div style={S.table}>
              <div style={{ ...S.tableHeader, gridTemplateColumns: '1.4fr 1.6fr 1.6fr 90px' }}>
                <span>Originale</span><span>Nome tradotto</span><span>Descrizione tradotta</span><span></span>
              </div>
              {trRows.map(r => (
                <div key={r.id} style={{ ...S.tableRow, gridTemplateColumns: '1.4fr 1.6fr 1.6fr 90px', alignItems: 'center' }}>
                  <span>
                    <strong>{r.original_name}</strong>
                    <br /><span style={{ color: '#94a3b8', fontSize: 12 }}>{r.original_description}</span>
                    {r.source === 'manual' && <><br /><span style={{ color: '#22c55e', fontSize: 11 }}>corretto a mano</span></>}
                    {!r.name && <><br /><span style={{ color: '#ef4444', fontSize: 11 }}>manca</span></>}
                  </span>
                  <input
                    style={{ ...S.formInput, width: '95%' }}
                    defaultValue={r.name ?? ''}
                    placeholder={r.original_name}
                    onChange={e => { r.name = e.target.value; }}
                  />
                  <input
                    style={{ ...S.formInput, width: '95%' }}
                    defaultValue={r.description ?? ''}
                    placeholder={r.original_description}
                    onChange={e => { r.description = e.target.value; }}
                  />
                  <button style={S.btnEdit} disabled={trBusy}
                    onClick={() => salvaTraduzione(r.id, r.name ?? '', r.description ?? '')}>
                    Salva
                  </button>
                </div>
              ))}
              {trRows.length === 0 && (
                <div style={{ padding: 20, color: '#64748b' }}>Nessun piatto da mostrare.</div>
              )}
            </div>
          </div>
        )}

        {/* ── LOGO ── */}
        {tab === 'aspetto' && (
          <div style={S.content}>
            <h1 style={S.pageTitle}>🎨 Aspetto</h1>
            <div style={S.formCard}>
              <p style={{ color: '#64748b', marginBottom: 20 }}>
                Il logo apparirà nell'app del cliente al posto dell'icona predefinita.<br />
                Formati: PNG, JPG, WebP, SVG. Massimo 2 MB.
              </p>
              {restaurant?.logo_url && (
                <div style={{ marginBottom: 20, textAlign: 'center' }}>
                  <p style={{ color: '#64748b', fontSize: 13, marginBottom: 8 }}>Logo attuale:</p>
                  <img src={restaurant.logo_url} alt="logo" style={{ maxHeight: 120, maxWidth: 280, objectFit: 'contain', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 }} />
                </div>
              )}
              <input ref={logoInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { if (e.target.files?.[0]) uploadLogo(e.target.files[0]); }} />
              <button style={S.btnPrimary} disabled={logoUploading} onClick={() => logoInputRef.current?.click()}>
                {logoUploading ? '⏳ Caricamento...' : '📤 Carica nuovo logo'}
              </button>
              {logoMsg && <div style={{ marginTop: 12, fontSize: 14, color: logoMsg.startsWith('✅') ? '#166534' : '#ef4444' }}>{logoMsg}</div>}
            </div>

            <div style={S.formCard}>
              <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Colori e carattere</h2>
              <p style={{ color: '#64748b', fontSize: 14, marginBottom: 18 }}>
                Parti da una tavolozza pronta e poi ritocca quello che vuoi. Il telefono qui a
                fianco si aggiorna mentre scegli: quello che vedi e' quello che vedra' il cliente.
              </p>

              <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-start' }}>

                {/* ─ comandi ─ */}
                <div style={{ flex: '1 1 360px', minWidth: 320 }}>

                  <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 8 }}>Tavolozze pronte</div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 22 }}>
                    {TAVOLOZZE.map(([nome, sfondo, principale]) => {
                      const attiva = colBg.toLowerCase() === sfondo && colPrimary.toLowerCase() === principale;
                      return (
                        <button key={nome}
                          onClick={() => { setColBg(sfondo); setColPrimary(principale); setColMsg(''); }}
                          title={nome}
                          style={{
                            border: attiva ? '2px solid #6366f1' : '1px solid #cbd5e1',
                            borderRadius: 10, padding: 6, background: '#fff', cursor: 'pointer',
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: 74,
                          }}>
                          <span style={{ display: 'block', width: '100%', height: 26, borderRadius: 6, background: sfondo, position: 'relative' }}>
                            <span style={{ position: 'absolute', right: 5, bottom: 5, width: 10, height: 10, borderRadius: '50%', background: principale }} />
                          </span>
                          <span style={{ fontSize: 11, color: '#475569' }}>{nome}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 20 }}>
                    <label style={S.formLabel}>
                      Sfondo
                      <span style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                        <input type="color" value={colBg} onChange={e => { setColBg(e.target.value); setColMsg(''); }}
                          style={{ width: 48, height: 38, border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff', cursor: 'pointer' }} />
                        <input style={{ ...S.formInput, width: 110 }} value={colBg}
                          onChange={e => { setColBg(e.target.value); setColMsg(''); }} />
                      </span>
                    </label>
                    <label style={S.formLabel}>
                      Colore principale
                      <span style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                        <input type="color" value={colPrimary} onChange={e => { setColPrimary(e.target.value); setColMsg(''); }}
                          style={{ width: 48, height: 38, border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff', cursor: 'pointer' }} />
                        <input style={{ ...S.formInput, width: 110 }} value={colPrimary}
                          onChange={e => { setColPrimary(e.target.value); setColMsg(''); }} />
                      </span>
                    </label>
                  </div>

                  <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 8 }}>Carattere</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
                    {CARATTERI.map(([codice, etichetta, css]) => (
                      <button key={codice}
                        onClick={() => { setColFont(codice); setColMsg(''); }}
                        style={{
                          textAlign: 'left', padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
                          border: colFont === codice ? '2px solid #6366f1' : '1px solid #cbd5e1',
                          background: colFont === codice ? '#eef2ff' : '#fff',
                          fontFamily: css, fontSize: 15, color: '#1e293b',
                        }}>
                        {etichetta}
                      </button>
                    ))}
                  </div>

                  {colMsg && <div style={{ marginTop: 12, fontSize: 14, color: colMsg.includes('salvat') ? '#166534' : '#ef4444' }}>{colMsg}</div>}
                  <button style={{ ...S.btnPrimary, marginTop: 16 }} disabled={colSaving} onClick={salvaColori}>
                    {colSaving ? 'Salvataggio...' : 'Salva aspetto'}
                  </button>
                </div>

                {/* ─ telefono ─ */}
                <div style={{ flex: '0 0 auto' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 8 }}>Anteprima dal vivo</div>
                  <div style={{
                    width: 288, height: 580, borderRadius: 36, background: '#111', padding: 10,
                    boxShadow: '0 12px 32px rgba(15,23,42,0.22)',
                  }}>
                    <div style={{
                      width: '100%', height: '100%', borderRadius: 28, overflow: 'hidden',
                      background: colBg, fontFamily: fontCss, display: 'flex', flexDirection: 'column',
                      color: testoSu(colBg),
                    }}>
                      {/* barra alta */}
                      <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '14px 14px 10px', borderBottom: `1px solid ${bordoSu(colBg)}`,
                      }}>
                        <span style={{ fontSize: 12, opacity: 0.8 }}>IT</span>
                        {restaurant?.logo_url
                          ? <img src={restaurant.logo_url} alt="" style={{ height: 26, maxWidth: 110, objectFit: 'contain' }} />
                          : <span style={{ fontWeight: 700, fontSize: 14 }}>{restaurant?.name ?? 'Il tuo locale'}</span>}
                        <span style={{
                          fontSize: 11, border: `1px solid ${colPrimary}`, color: colPrimary,
                          borderRadius: 12, padding: '3px 8px',
                        }}>Lista</span>
                      </div>

                      {/* categorie */}
                      <div style={{ display: 'flex', gap: 8, padding: '12px 14px', overflow: 'hidden' }}>
                        {['Antipasti', 'Primi', 'Pizze'].map((c, i) => (
                          <span key={c} style={{
                            fontSize: 12, padding: '6px 12px', borderRadius: 14, whiteSpace: 'nowrap',
                            background: i === 0 ? colPrimary : 'transparent',
                            color: i === 0 ? '#fff' : testoSu(colBg),
                            border: i === 0 ? 'none' : `1px solid ${bordoSu(colBg)}`,
                          }}>{c}</span>
                        ))}
                      </div>

                      {/* piatti */}
                      <div style={{ padding: '0 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {[['Bruschetta al Pomodoro', 'Pane tostato, pomodorini, origano', '7,00'],
                          ['Carbonara', 'Guanciale, uovo, pecorino, pepe', '14,00'],
                          ['Tiramisù', 'Crema a strati, cacao', '6,00']].map(([n, d, p]) => (
                          <div key={n} style={{
                            background: superficieSu(colBg), borderRadius: 12, padding: '10px 12px',
                            border: `1px solid ${bordoSu(colBg)}`, display: 'flex', gap: 10, alignItems: 'flex-start',
                          }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 700, fontSize: 13 }}>{n}</div>
                              <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2, lineHeight: 1.35 }}>{d}</div>
                            </div>
                            <div style={{ color: colPrimary, fontWeight: 700, fontSize: 13 }}>€{p}</div>
                          </div>
                        ))}
                      </div>

                      {/* pulsante assistente */}
                      <div style={{ marginTop: 'auto', padding: 14 }}>
                        <div style={{
                          background: colPrimary, color: '#fff', textAlign: 'center',
                          padding: '12px', borderRadius: 14, fontWeight: 700, fontSize: 14,
                        }}>💬 Chiedi a {aiName}</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── QR CODE ── */}
        {tab === 'qr' && (
          <div style={S.content}>
            <h1 style={S.pageTitle}>📱 QR Code</h1>
            <div style={S.formCard}>
              <p style={{ color: '#64748b', marginBottom: 20 }}>
                Questo e' il codice che porta al tuo menu. Stampalo e mettilo dove vuoi:
                sui tavoli, in vetrina, sul biglietto da visita. Funziona sempre, anche
                se cambi i piatti.
              </p>
              <div style={{ ...S.qrCard, maxWidth: 320 }}>
                <img src={qrImgUrl} alt="QR del menu" style={{ width: 240, height: 240, borderRadius: 8 }} />
                <a href={qrImgUrl} download="qr-menu.png"
                   style={{ ...S.btnPrimary, display: 'inline-block', marginTop: 14, textDecoration: 'none' }}>
                  Scarica il QR
                </a>
              </div>
              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: 13, color: '#64748b', marginBottom: 6 }}>Indirizzo del menu</div>
                <code style={{ background: '#f1f5f9', padding: '8px 12px', borderRadius: 8, fontSize: 13, display: 'block', wordBreak: 'break-all' }}>
                  {menuUrl}
                </code>
              </div>
            </div>
          </div>
        )}

        {/* ── ABBONAMENTO ── */}
        {tab === 'billing' && (
          <div style={S.content}>
            <h1 style={S.pageTitle}>💳 Abbonamento</h1>
            {billing && (
              <div style={S.formCard}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <div>
                    <div style={{ fontSize: 13, color: '#64748b' }}>Stato abbonamento</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: statusColor }}>{statusLabel}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13, color: '#64748b' }}>Piano</div>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>{billing.plan === 'trial' ? 'Trial gratuito' : 'Abbonamento'}</div>
                  </div>
                </div>

                {billing.subscription_status === 'trialing' && billing.trial_ends_at && (
                  <div style={S.infoBox}>
                    ⏳ Trial gratuito fino al <strong>{new Date(billing.trial_ends_at).toLocaleDateString('it-IT')}</strong>.
                    Attiva l'abbonamento per continuare dopo la scadenza.
                  </div>
                )}

                {billing.subscription_status === 'past_due' && (
                  <div style={{ ...S.infoBox, background: '#fef2f2', borderColor: '#fca5a5', color: '#991b1b' }}>
                    ⚠️ Pagamento in ritardo. Aggiorna il metodo di pagamento per evitare la sospensione.
                  </div>
                )}

                {billing.suspended_at && (
                  <div style={{ ...S.infoBox, background: '#fef2f2', borderColor: '#fca5a5', color: '#991b1b' }}>
                    🚫 Account sospeso il {new Date(billing.suspended_at).toLocaleDateString('it-IT')}. Contatta il supporto.
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 20 }}>
                  <div style={S.kpiCard}>
                    <div style={S.kpiLabel}>Costo mensile</div>
                    <div style={{ ...S.kpiValue, color: '#6366f1', fontSize: 28 }}>A${Number(billing.monthly_price ?? 30).toFixed(2)}</div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
                  {(billing.subscription_status === 'trialing' || billing.subscription_status === 'cancelled') && (
                    <button style={S.btnPrimary} onClick={startCheckout}>
                      💳 Attiva abbonamento
                    </button>
                  )}
                  {billing.subscription_status === 'active' && (
                    <button style={S.btnSecondary} onClick={openPortal}>
                      ⚙️ Gestisci pagamenti
                    </button>
                  )}
                  {billing.subscription_status === 'past_due' && (
                    <button style={S.btnPrimary} onClick={openPortal}>
                      💳 Aggiorna pagamento
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── IMPOSTAZIONI ── */}
        {/* ── IMPOSTAZIONI IA ── */}
        {tab === 'ia' && (
          <div style={S.content}>
            <h1 style={S.pageTitle}>🤖 Impostazioni IA</h1>
            <div style={S.formCard}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 260px' }}>
                  <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Assistente per i clienti</h2>
                  <p style={{ color: '#64748b', fontSize: 14, margin: 0 }}>
                    {assistenteAttivo
                      ? <>I clienti possono chattare con <strong>{aiName || 'Marco'}</strong> e chiedergli dei piatti.</>
                      : <>Spento: i clienti vedono <strong>solo il menu tradotto</strong>, senza chat e senza pulsanti dell'assistente.</>}
                  </p>
                </div>
                <button
                  role="switch"
                  aria-checked={assistenteAttivo}
                  aria-label="Assistente per i clienti"
                  disabled={assistenteSalvando}
                  onClick={() => cambiaAssistente(!assistenteAttivo)}
                  style={{ ...S.interruttore, ...(assistenteAttivo ? S.interruttoreOn : {}) }}>
                  <span style={{ ...S.interruttorePallino, ...(assistenteAttivo ? { transform: 'translateX(68px)' } : {}) }} />
                  <span style={{ ...S.interruttoreTesto, ...(assistenteAttivo ? { left: 14 } : { right: 12 }) }}>{assistenteAttivo ? 'Acceso' : 'Spento'}</span>
                </button>
              </div>
              {assistenteMsg && <div style={{ marginTop: 12, fontSize: 14, color: assistenteMsg.startsWith('Assistente') ? '#166534' : '#ef4444' }}>{assistenteMsg}</div>}
            </div>

            <div style={S.formCard}>
              <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Nome dell'assistente</h2>
              <p style={{ color: '#64748b', fontSize: 14, marginBottom: 16 }}>
                E' il nome con cui si presenta ai tuoi clienti. Scegline uno che suoni bene
                nel tuo locale. Se lasci il campo vuoto torna a <strong>Marco</strong>.
              </p>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <label style={S.formLabel}>
                  Nome
                  <input style={{ ...S.formInput, width: 220 }} value={aiName} maxLength={30}
                    placeholder="Marco"
                    onChange={e => { setAiName(e.target.value); setAiNameMsg(''); }} />
                </label>
                <button style={S.btnPrimary} onClick={salvaNomeAI}>Salva nome</button>
              </div>
              {aiNameMsg && <div style={{ marginTop: 10, fontSize: 14, color: aiNameMsg.includes('salvato') ? '#166534' : '#ef4444' }}>{aiNameMsg}</div>}
            </div>

            <div style={S.formCard}>
              <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Chiave per le traduzioni e l'assistente</h2>
              <p style={{ color: '#64748b', fontSize: 14, marginBottom: 16 }}>
                Serve per due cose: tradurre da sole le descrizioni dei piatti nuovi che aggiungi,
                e far rispondere l'assistente ai clienti.<br />
                La chiave e' gratuita: la ottieni su{' '}
                <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" style={{ color: '#6366f1' }}>console.groq.com/keys</a>{' '}
                (non serve la carta di credito).
              </p>
              <label style={S.formLabel}>
                Chiave (inizia con <code>gsk_</code>)
                <input style={S.formInput} type="password" placeholder="gsk_..." value={settingsKey}
                  onChange={e => { setSettingsKey(e.target.value); setSettingsMsg(''); }} />
              </label>
              {settingsMsg && <div style={{ marginTop: 8, fontSize: 14, color: settingsMsg.startsWith('✅') ? '#166534' : '#ef4444' }}>{settingsMsg}</div>}
              <button style={{ ...S.btnPrimary, marginTop: 16 }} disabled={settingsSaving || !settingsKey} onClick={saveApiKey}>
                {settingsSaving ? 'Salvataggio...' : 'Salva chiave'}
              </button>
              <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 14 }}>
                Senza chiave il menu funziona lo stesso: i piatti gia' tradotti restano tradotti,
                ma quelli nuovi resteranno nella lingua in cui li scrivi.
              </p>
            </div>
          </div>
        )}

        {/* ── IMPOSTAZIONI ── */}
        {tab === 'settings' && (
          <div style={S.content}>
            <h1 style={S.pageTitle}>⚙️ Impostazioni</h1>
            <div style={S.formCard}>
              <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Dove sei e cosa cucini</h2>
              <p style={{ color: '#64748b', fontSize: 14, marginBottom: 16 }}>
                Serve all'assistente per sapere che ore sono da te e che tempo fa, e per non
                inventarsi storie sul tuo locale. Cerca la tua citta' e scegliela dall'elenco:
                paese e fuso orario si compilano da soli.
              </p>

              {/* Citta' scelta */}
              {locale.city && (
                <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
                  <div style={{ fontWeight: 700, color: '#166534' }}>
                    {[locale.city, locale.region, locale.country].filter(Boolean).join(', ')}
                  </div>
                  <div style={{ fontSize: 13, color: '#15803d', marginTop: 2 }}>
                    {locale.timezone
                      ? `Fuso orario: ${locale.timezone}`
                      : "Attenzione: nessun fuso orario. Ricerca di nuovo la citta' e scegliela dall'elenco."}
                  </div>
                </div>
              )}

              {/* Ricerca */}
              <label style={{ ...S.formLabel, display: 'block' }}>
                {locale.city ? 'Cambia citta\'' : 'Cerca la tua citta\''}
                <span style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
                  <input
                    style={{ ...S.formInput, width: 260 }}
                    value={cercaCitta}
                    placeholder="Sydney, Malaga, Taormina..."
                    onChange={e => setCercaCitta(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); cercaCittaOra(); } }}
                  />
                  <button style={S.btnSecondary} disabled={cercando || cercaCitta.trim().length < 2} onClick={cercaCittaOra}>
                    {cercando ? 'Cerco...' : 'Cerca'}
                  </button>
                </span>
              </label>

              {risultatiCitta.length > 0 && (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, marginTop: 10, overflow: 'hidden' }}>
                  {risultatiCitta.map((c, i) => (
                    <button
                      key={i}
                      onClick={() => scegliCitta(c)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px',
                        background: i % 2 ? '#f8fafc' : '#fff', border: 'none',
                        borderBottom: i < risultatiCitta.length - 1 ? '1px solid #e2e8f0' : 'none',
                        cursor: 'pointer', fontSize: 14, color: '#1e293b',
                      }}
                    >
                      <strong>{c.city}</strong>
                      {c.region ? `, ${c.region}` : ''}{c.country ? `, ${c.country}` : ''}
                      <span style={{ color: '#94a3b8', fontSize: 12 }}>{c.timezone ? `  ·  ${c.timezone}` : ''}</span>
                    </button>
                  ))}
                </div>
              )}

              <div style={{ ...S.formGrid, marginTop: 16 }}>
                <label style={S.formLabel}>Tipo di cucina
                  <input style={S.formInput} value={locale.cuisine_type} placeholder="italiana, pesce, pizzeria..."
                    onChange={e => { setLocale(l => ({ ...l, cuisine_type: e.target.value })); setLocaleMsg(''); }} />
                </label>
              </div>

              <label style={{ ...S.formLabel, display: 'block', marginTop: 12 }}>
                Due righe sul locale (le usa l'assistente parlando ai clienti)
                <textarea style={{ ...S.formInput, minHeight: 80, width: '100%', fontFamily: 'inherit' }}
                  value={locale.about} maxLength={400}
                  placeholder="Trattoria di famiglia dal 1998, pasta fatta in casa, terrazza sul porto."
                  onChange={e => { setLocale(l => ({ ...l, about: e.target.value })); setLocaleMsg(''); }} />
              </label>

              <label style={{ ...S.formLabel, display: 'block', marginTop: 12 }}>
                Instagram del ristorante
                <input style={{ ...S.formInput, width: '100%' }}
                  value={locale.instagram_url}
                  placeholder="@iltuoristorante  oppure  instagram.com/iltuoristorante"
                  onChange={e => { setLocale(l => ({ ...l, instagram_url: e.target.value })); setLocaleMsg(''); }} />
                <span style={{ fontSize: 12, opacity: 0.7, display: 'block', marginTop: 4 }}>
                  Dopo 90 secondi il cliente vede un invito a seguirti. Lascia vuoto per non mostrarlo.
                </span>
              </label>

              {(locale.ig_popup_shown > 0 || locale.instagram_url) && (
                <div style={{ marginTop: 10, padding: '10px 12px', background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: 10, fontSize: 13, color: '#6b21a8' }}>
                  📸 Invito visto da <strong>{locale.ig_popup_shown}</strong> client{locale.ig_popup_shown === 1 ? 'e' : 'i'} ·
                  {' '}<strong>{locale.ig_follow_clicks}</strong> {locale.ig_follow_clicks === 1 ? 'ha' : 'hanno'} toccato «Segui»
                  {locale.ig_popup_shown > 0 && (
                    <> ({Math.round((locale.ig_follow_clicks / locale.ig_popup_shown) * 100)}%)</>
                  )}
                </div>
              )}

              {localeMsg && <div style={{ marginTop: 10, fontSize: 14, color: localeMsg === 'Salvato.' ? '#166534' : '#b45309' }}>{localeMsg}</div>}
              <button style={{ ...S.btnPrimary, marginTop: 14 }} disabled={localeSaving} onClick={salvaLocale}>
                {localeSaving ? 'Salvataggio...' : 'Salva'}
              </button>
            </div>

            <div style={S.formCard}>
              <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Il tuo ristorante</h2>
              <div style={{ color: '#334155', fontSize: 15, lineHeight: 1.9 }}>
                <div><strong>Nome:</strong> {restaurant?.name}</div>
                <div><strong>Indirizzo del menu:</strong></div>
                <code style={{ background: '#f1f5f9', padding: '8px 12px', borderRadius: 8, fontSize: 13, display: 'block', wordBreak: 'break-all', marginTop: 4 }}>
                  {menuUrl}
                </code>
              </div>
            </div>

            <CambiaPassword token={auth.token} />
          </div>
        )}
      </main>
      <AssistenteWidget token={auth.token} />
    </div>
  );
}

function KPI({ label, value, color, sub, onClick }: { label: string; value: string; color: string; sub?: string; onClick?: () => void }) {
  return (
    <div style={{ ...S.kpiCard, borderTopColor: color, ...(onClick ? { cursor: 'pointer' } : {}) }}
      onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? e => { if (e.key === 'Enter') onClick(); } : undefined}
      title={onClick ? 'Apri l\'elenco' : undefined}>
      <div style={S.kpiLabel}>{label}</div>
      <div style={{ ...S.kpiValue, color }}>{value}</div>
      {sub && <div style={S.kpiSub}>{sub}</div>}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  // Login
  loginWrap: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f1f5f9' },
  loginCard: { background: '#fff', borderRadius: 16, padding: '40px 36px', width: '100%', maxWidth: 400, boxShadow: '0 4px 24px #0001' },
  loginLogo: { fontSize: 48, textAlign: 'center', marginBottom: 12 },
  loginTitle: { fontSize: 24, fontWeight: 700, textAlign: 'center', color: '#1e293b', marginBottom: 4 },
  loginSub: { fontSize: 14, color: '#64748b', textAlign: 'center', marginBottom: 28 },
  errorBox: { background: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b', padding: '10px 14px', borderRadius: 8, fontSize: 14 },

  // Assistente AI del pannello (per il titolare, non per i suoi clienti)
  assistBtn: { position: 'fixed', right: 20, bottom: 20, zIndex: 70, width: 56, height: 56, borderRadius: '50%', border: 'none', background: 'linear-gradient(135deg,#FF8A4B,#FF3D6E)', color: '#fff', fontSize: 24, cursor: 'pointer', boxShadow: '0 10px 26px -6px rgba(255,61,110,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  assistPanel: { position: 'fixed', right: 20, bottom: 86, zIndex: 70, width: 340, maxWidth: 'calc(100vw - 40px)', height: 460, maxHeight: 'calc(100vh - 140px)', background: '#fff', borderRadius: 18, boxShadow: '0 20px 60px -12px rgba(0,0,0,.35)', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  assistHead: { padding: '14px 16px', borderBottom: '1px solid #e2e8f0', background: '#fff8f5' },
  assistBody: { flex: 1, overflowY: 'auto', padding: '14px 14px 4px', display: 'flex', flexDirection: 'column', gap: 10 },
  assistBubbleA: { alignSelf: 'flex-start', background: '#f1f5f9', color: '#1e293b', borderRadius: '4px 14px 14px 14px', padding: '9px 13px', fontSize: 13.5, lineHeight: 1.5, maxWidth: '86%', whiteSpace: 'pre-wrap' as const },
  assistBubbleU: { alignSelf: 'flex-end', background: '#FF4D5E', color: '#fff', borderRadius: '14px 4px 14px 14px', padding: '9px 13px', fontSize: 13.5, lineHeight: 1.5, maxWidth: '86%', whiteSpace: 'pre-wrap' as const },
  assistForm: { display: 'flex', gap: 8, padding: 12, borderTop: '1px solid #e2e8f0' },
  assistInput: { flex: 1, border: '1px solid #e2e8f0', borderRadius: 10, padding: '9px 12px', fontSize: 13.5, outline: 'none' },
  assistSend: { width: 38, height: 38, borderRadius: 10, border: 'none', background: '#FF4D5E', color: '#fff', fontSize: 16, cursor: 'pointer', flexShrink: 0 },

  // Layout
  root: { display: 'flex', minHeight: '100vh', background: '#f8fafc' },
  mobileBar: { position: 'fixed', top: 0, left: 0, right: 0, height: 52, zIndex: 50, background: '#fff', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px' },
  hamburger: { background: 'none', border: 'none', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: '#1e293b', padding: 4 },
  navBackdrop: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 55 },
  bannerProva: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', border: '1px solid', borderRadius: 12, padding: '12px 16px', margin: '0 0 18px', fontSize: 14, fontWeight: 600 },
  bannerProvaBtn: { background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' },
  interruttore: { position: 'relative', width: 104, height: 36, borderRadius: 999, border: 'none', background: '#cbd5e1', cursor: 'pointer', padding: 0, flexShrink: 0, transition: 'background .2s' },
  interruttoreOn: { background: '#22c55e' },
  interruttorePallino: { position: 'absolute', top: 4, left: 4, width: 28, height: 28, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px #0003', transition: 'transform .2s' },
  interruttoreTesto: { position: 'absolute', top: 0, bottom: 0, display: 'flex', alignItems: 'center', fontSize: 13, fontWeight: 700, color: '#fff' },
  linkLogin: { display: 'block', margin: '16px auto 0', background: 'none', border: 'none', color: '#6366f1', fontSize: 13, cursor: 'pointer', textDecoration: 'underline' },
  benvenutoOverlay: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  benvenutoCard: { position: 'relative', background: '#fff', borderRadius: 16, padding: '32px 28px 24px', maxWidth: 420, width: '100%', textAlign: 'center', boxShadow: '0 20px 60px #0004' },
  benvenutoX: { position: 'absolute', top: 12, right: 12, width: 32, height: 32, border: 'none', borderRadius: 8, background: '#f1f5f9', color: '#475569', fontSize: 16, cursor: 'pointer' },
  sidebar: { width: 240, background: '#1e293b', color: '#f8fafc', display: 'flex', flexDirection: 'column', padding: '20px 16px', gap: 4, flexShrink: 0 },
  sidebarHeader: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24, padding: '0 4px' },
  sidebarLogo: { fontSize: 28 },
  nav: { display: 'flex', flexDirection: 'column', gap: 2, flex: 1 },
  navBtn: { background: 'none', color: '#94a3b8', border: 'none', padding: '10px 12px', borderRadius: 8, fontSize: 14, textAlign: 'left', cursor: 'pointer' },
  navBtnActive: { background: '#334155', color: '#f8fafc', fontWeight: 600 },
  logoutBtn: { background: 'none', color: '#64748b', border: 'none', padding: '10px 12px', fontSize: 13, cursor: 'pointer', textAlign: 'left', marginTop: 8, borderTop: '1px solid #334155', paddingTop: 16 },
  main: { flex: 1, overflowY: 'auto' },
  loader: { padding: 40, color: '#64748b' },
  content: { padding: 'clamp(14px, 4vw, 32px)', display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1100 },
  pageTitle: { fontSize: 26, fontWeight: 700, color: '#1e293b' },

  // KPI
  kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 },
  kpiCard: { background: '#fff', borderRadius: 12, padding: '18px 20px', borderTop: '4px solid #6366f1', boxShadow: '0 1px 3px #0001' },
  kpiLabel: { fontSize: 13, color: '#64748b', marginBottom: 6 },
  kpiValue: { fontSize: 28, fontWeight: 700 },
  kpiSub: { fontSize: 12, color: '#64748b', marginTop: 4 },
  sectionTitle: { fontSize: 17, fontWeight: 600, color: '#1e293b' },
  chartCard: { background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px #0001' },

  // Table
  table: { background: '#fff', borderRadius: 12, overflowX: 'auto', boxShadow: '0 1px 3px #0001', WebkitOverflowScrolling: 'touch' },
  tableHeader: { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', minWidth: 620, padding: '10px 16px', background: '#f1f5f9', fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' },
  tableRow: { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', minWidth: 620, padding: '12px 16px', borderTop: '1px solid #e2e8f0', fontSize: 14, color: '#1e293b', alignItems: 'center', gap: 8 },

  // Buttons
  btnPrimary: { background: '#6366f1', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  btnSecondary: { background: '#f1f5f9', color: '#1e293b', border: '1px solid #e2e8f0', padding: '10px 20px', borderRadius: 8, fontSize: 14, cursor: 'pointer' },
  btnEdit: { background: 'none', color: '#6366f1', border: '1px solid #6366f1', padding: '5px 12px', borderRadius: 6, fontSize: 13, cursor: 'pointer' },

  // Forms
  formCard: { background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px #0001', border: '1px solid #e2e8f0' },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 },
  formLabel: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 600, color: '#475569' },
  formInput: { marginTop: 2, padding: '8px 10px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 14, color: '#1e293b', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' },

  // QR
  qrCard: { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' },

  // Billing
  infoBox: { background: '#fefce8', border: '1px solid #fde047', borderRadius: 8, padding: '12px 16px', fontSize: 14, color: '#713f12', marginBottom: 8 },
};
