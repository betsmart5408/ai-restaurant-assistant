/**
 * Lancia a mano la pre-generazione dei consigli (di notte la fa lo scheduler).
 *
 *   npm run pregenera --workspace=packages/api
 *   npm run pregenera --workspace=packages/api -- --prova
 *   npm run pregenera --workspace=packages/api -- --slug gusto-alcazabilla
 *   npm run pregenera --workspace=packages/api -- --giorni 7 --max 50
 *   npm run pregenera --workspace=packages/api -- --lingue it,en --forza
 *
 *   --prova    dice cosa farebbe senza chiamare nessun modello
 *   --slug     un ristorante preciso, in tutte le lingue che offre
 *   --giorni   quanto indietro guardare per il traffico (30)
 *   --lingue   solo queste
 *   --max      tetto di chiamate (400)
 *   --pausa    millisecondi fra una chiamata e l'altra (4000)
 *   --forza    riscrive anche quello che e' gia' pronto
 */
import 'dotenv/config';
import { pregeneraConsigli } from '../src/services/pregenera';

const arg = (nome: string): string | undefined => {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const flag = (nome: string) => process.argv.includes(`--${nome}`);

pregeneraConsigli({
  slug: arg('slug'),
  giorni: Number(arg('giorni')) || undefined,
  lingue: arg('lingue')?.split(',').map(s => s.trim()).filter(Boolean),
  max: Number(arg('max')) || undefined,
  pausaMs: Number(arg('pausa')) || undefined,
  forza: flag('forza'),
  prova: flag('prova'),
})
  .then(r => { console.log(r); process.exit(0); })
  .catch(e => { console.error(e); process.exit(1); });
