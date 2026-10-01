/** Progresso de um download: `total` só quando a API mandou `Content-Length`. */
export type DownloadProgress = (loaded: number, total: number | null) => void;

/**
 * Soma o progresso de vários downloads em paralelo num `onProgress` só (as duas trilhas da
 * sdd-016): o total só existe quando todos já informaram o deles; antes disso a tela mostra
 * espera indeterminada.
 */
export function combinedProgress(count: number, onProgress?: DownloadProgress): DownloadProgress[] {
  const loaded = new Array<number>(count).fill(0);
  const totals = new Array<number | null>(count).fill(null);
  const report = () => {
    const complete = totals.every((value) => value !== null);
    const total = complete ? totals.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null;
    onProgress?.(
      loaded.reduce((sum, value) => sum + value, 0),
      total,
    );
  };
  return loaded.map((_, index) => (value, total) => {
    loaded[index] = value;
    totals[index] = total;
    report();
  });
}
