import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { KaraokeSession } from "@/components/karaoke-session";
import { ApiError } from "@/lib/api";
import { serverApi } from "@/lib/api.server";
import type { SongDto } from "@/lib/types";

interface SingPageProps {
  params: Promise<{ id: string }>;
}

async function loadSong(id: string): Promise<SongDto> {
  try {
    return await serverApi.getSong(id);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 400)) notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: SingPageProps): Promise<Metadata> {
  const { id } = await params;
  try {
    const song = await serverApi.getSong(id);
    return { title: `Cantando ${song.title}` };
  } catch {
    return { title: "Cantar" };
  }
}

export default async function SingPage({ params }: SingPageProps) {
  const { id } = await params;
  const song = await loadSong(id);

  // Sem referência pronta não há o que cantar: volta para a preparação.
  if (song.referenceStatus !== "READY") redirect(`/songs/${song.id}`);

  return <KaraokeSession song={song} />;
}
