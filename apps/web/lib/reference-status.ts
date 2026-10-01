/**
 * Espelho de `PROCESSING_STALE_MS` (`apps/api/src/repositories/song.repository.ts`): passado
 * isso, a API aceita um novo processamento por cima de um `PROCESSING` (regra 6 da sdd-003).
 */
export const PROCESSING_STALE_MS = 15 * 60_000;

/**
 * `PROCESSING` que parou de andar (achado da sdd-011): a API caiu sem reiniciar, ou o worker
 * travou. Conta pelo `referenceUpdatedAt` do servidor, não pelo relógio da tela (que zera ao
 * recarregar a página). Sem data, ou data ilegível, não dá para dizer: `false`.
 */
export function isProcessingStale(referenceUpdatedAt: string | null, now: number): boolean {
  if (referenceUpdatedAt === null) return false;
  const since = Date.parse(referenceUpdatedAt);
  if (Number.isNaN(since)) return false;
  return now - since > PROCESSING_STALE_MS;
}
