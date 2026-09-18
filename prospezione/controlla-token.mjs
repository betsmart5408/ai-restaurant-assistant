/**
 * Dice se il FOURSQUARE_TOKEN nel .env e' completo, senza mai stamparlo.
 *   node prospezione/controlla-token.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const RADICE = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = join(RADICE, '.env');
if (!existsSync(env)) { console.error('Non trovo il file .env.'); process.exit(1); }

let tok = '';
for (const riga of readFileSync(env, 'utf-8').split('\n')) {
  const t = riga.trim();
  if (t.startsWith('FOURSQUARE_TOKEN=')) tok = t.slice(17).trim().replace(/^["']|["']$/g, '');
}

if (!tok) {
  console.log('✗ Nel .env non c\'e\' nessuna riga FOURSQUARE_TOKEN=');
  process.exit(1);
}

const parti = tok.split('.');
console.log(`Lunghezza: ${tok.length} caratteri`);
console.log(`Pezzi separati da punto: ${parti.length}  (ne servono 3)`);

const strani = [...new Set([...tok].filter(c => !/[A-Za-z0-9\-_.]/.test(c)))];
if (strani.length) console.log(`Caratteri che non dovrebbero esserci: ${JSON.stringify(strani)}  (spazi o a-capo di troppo)`);

if (parti.length !== 3 || parti.some(p => p.length === 0)) {
  console.log('\n✗ TOKEN INCOMPLETO. Manca un pezzo: quasi sempre la firma finale.');
  console.log('  Genera un token nuovo sul Places Portal e usa il pulsante di copia,');
  console.log('  non la selezione col mouse. Poi rilancia questo controllo.');
  process.exit(1);
}

try {
  const corpo = JSON.parse(Buffer.from(parti[1] + '='.repeat((4 - parti[1].length % 4) % 4), 'base64url').toString());
  if (corpo.exp) {
    const quando = new Date(corpo.exp * 1000);
    const giorni = Math.round((quando - Date.now()) / 86400000);
    console.log(`Scadenza: ${quando.toISOString().slice(0, 16).replace('T', ' ')} UTC  (fra ${giorni} giorni)`);
    if (giorni < 0) { console.log('\n✗ TOKEN SCADUTO. Generane uno nuovo.'); process.exit(1); }
  }
} catch { /* se non riusciamo a leggerlo, il controllo sui 3 pezzi basta */ }

console.log('\n✓ Il token sembra completo. Prova:  .\\trova-foursquare.ps1 -Prova');
