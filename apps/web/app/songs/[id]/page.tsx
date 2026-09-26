import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SongPrep } from "@/components/song-prep";
import { ApiError } from "@/lib/api";
import { serverApi } from "@/lib/api.server";
import { DEFAULT_DIFFICULTY } from "@/lib/difficulty";
import type { SongDto } from "@/lib/types";

interface SongPageProps {
  params: Promise<{ id: string }>;
}

/** Id inválido (400 do Zod) ou inexistente (404) viram a página de "não encontrada". */
async function loadSong(id: string): Promise<SongDto> {
  try {
    return await serverApi.getSong(id);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: SongPageProps): Promise<Metadata> {
  const { id } = await params;
  try {
    const song = await serverApi.getSong(id);
    return { title: `${song.title} · ${song.artist}` };
  } catch {
    return { title: "Música" };
  }
}

export default async function SongPage({ params }: SongPageProps) {
  const { id } = await params;
  const song = await loadSong(id);
  // O nível escolhido fica no dispositivo, então o servidor só conhece o padrão; o
  // componente busca o ranking de outro nível depois da hidratação (sdd-009).
  const ranking = await serverApi.getRanking(id, 10, DEFAULT_DIFFICULTY);

  return <SongPrep song={song} ranking={ranking} />;
}
