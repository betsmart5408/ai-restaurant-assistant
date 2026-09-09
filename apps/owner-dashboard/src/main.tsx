import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Se un componente va in errore React smonta tutto e resta una pagina bianca,
// senza nessuna indicazione di cosa sia successo. Questa rete di sicurezza
// mostra invece l'errore e un pulsante per ricaricare.
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { errore: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { errore: null };
  }
  static getDerivedStateFromError(errore: Error) { return { errore }; }
  componentDidCatch(errore: Error, info: React.ErrorInfo) {
    console.error('Errore nella dashboard:', errore, info.componentStack);
  }
  render() {
    if (!this.state.errore) return this.props.children;
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0f172a', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif', padding: 24,
      }}>
        <div style={{ maxWidth: 560, background: '#1e293b', padding: 28, borderRadius: 14, border: '1px solid #334155' }}>
          <div style={{ fontSize: 30, marginBottom: 10 }}>⚠️</div>
          <h1 style={{ fontSize: 19, margin: '0 0 10px' }}>Qualcosa si e' rotto in questa schermata</h1>
          <p style={{ fontSize: 14, color: '#94a3b8', margin: '0 0 16px', lineHeight: 1.5 }}>
            I tuoi dati sono al sicuro: il problema e' solo nel modo in cui questa pagina li mostra.
            Ricarica, e se succede di nuovo copia il testo qui sotto e mandamelo.
          </p>
          <pre style={{
            fontSize: 12, background: '#0f172a', color: '#fca5a5', padding: 12, borderRadius: 8,
            overflowX: 'auto', margin: '0 0 16px', whiteSpace: 'pre-wrap',
          }}>{this.state.errore.message}</pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 18px', borderRadius: 9, border: 'none', cursor: 'pointer',
              background: '#6366f1', color: '#fff', fontSize: 14, fontWeight: 600,
            }}>Ricarica la pagina</button>
        </div>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
