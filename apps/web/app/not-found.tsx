import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto grid w-full max-w-[var(--reading-max)] gap-6 px-4 py-16 text-center">
      <span className="ct-label">404</span>
      <h1>Essa música não está aqui</h1>
      <p className="text-fg-2">O endereço pode estar errado ou a música foi removida.</p>
      <p>
        <Link href="/" className="ct-btn ct-btn--secondary">
          Buscar outra música
        </Link>
      </p>
    </div>
  );
}
