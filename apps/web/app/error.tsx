"use client";

import Link from "next/link";
import { Alert } from "@/components/alert";
import { API_UNAVAILABLE_COPY } from "@/lib/reference-errors";

/** Falha ao montar a página no servidor (API fora do ar, por exemplo). Nunca mostra o stack. */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto grid w-full max-w-[var(--reading-max)] gap-6 px-4 py-16">
      <Alert tone={API_UNAVAILABLE_COPY.tone} title={API_UNAVAILABLE_COPY.title} body={API_UNAVAILABLE_COPY.body} />
      <div className="flex flex-wrap gap-4">
        <button type="button" className="ct-btn ct-btn--primary" onClick={reset}>
          Tentar de novo
        </button>
        <Link href="/" className="ct-btn ct-btn--ghost">
          Início
        </Link>
      </div>
    </div>
  );
}
