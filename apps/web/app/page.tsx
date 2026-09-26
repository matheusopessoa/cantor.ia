import { SongSearch } from "@/components/song-search";

export default function HomePage() {
  return (
    <>
      <section className="relative ct-crt" aria-label="Início">
        <div className="ct-horizon" aria-hidden="true">
          <div className="ct-horizon__sun" />
          <div className="ct-horizon__grid" />
        </div>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-4 text-center">
          <h1 className="ct-wordmark ct-wordmark--hero ct-flicker">
            cantor<span className="ct-wordmark__dot">.</span>ia
          </h1>
          <p className="rounded-btn bg-[var(--bg-scrim)] px-4 py-2 text-lg text-fg">
            Cante, acerte a nota e grave seu nome no ranking.
          </p>
        </div>
      </section>
      <div className="mx-auto w-full max-w-[var(--reading-max)] px-4 py-8">
        <SongSearch />
      </div>
    </>
  );
}
