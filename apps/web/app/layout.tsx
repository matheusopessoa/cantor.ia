import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "cantor.ia", template: "%s · cantor.ia" },
  description: "Karaokê que dá nota de 0 a 10 para a sua cantoria e grava seu nome no ranking.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <head>
        {/* Webfonts do design system (mesma URL de DESIGN_SYSTEM/tokens/fonts.css). O @import
            remoto não sobrevive ao bundle do Tailwind 4, então as fontes entram por <link>. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* A regra abaixo é do Pages Router (fonte só carregaria numa página): no App Router o
            root layout envolve todas as rotas, então o aviso é falso positivo. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bungee&family=Press+Start+2P&family=Rubik:wght@400;500;700;800;900&family=Silkscreen:wght@400;700&display=swap"
        />
      </head>
      <body className="flex min-h-screen flex-col">
        <header className="flex items-center justify-between border-b-2 border-line-subtle px-4 py-3">
          <Link href="/" className="no-underline" aria-label="cantor.ia, início">
            <span className="ct-wordmark [text-shadow:none]">
              cantor<span className="ct-wordmark__dot">.</span>ia
            </span>
          </Link>
        </header>
        <main className="flex flex-1 flex-col">{children}</main>
      </body>
    </html>
  );
}
