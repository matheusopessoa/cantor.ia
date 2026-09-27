import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { FastifyReply, FastifyRequest } from "fastify";
import { songService } from "../services/song.service.js";
import { youtubeSuggestionService } from "../services/youtube-suggestion.service.js";
import { InvalidYoutubeUrlError, MissingUploadFileError } from "../utils/errors.js";
import {
  createSongBodySchema,
  referenceRedoSchema,
  songParamsSchema,
  songSearchQuerySchema,
  songStemParamsSchema,
  youtubeReferenceBodySchema,
} from "../utils/validators.js";
import { parseYoutubeVideoId } from "../utils/youtube.js";

export async function searchSongs(request: FastifyRequest, reply: FastifyReply) {
  const { q } = songSearchQuerySchema.parse(request.query);
  const items = await songService.search(q);
  return reply.status(200).send(items);
}

/** Busca pela letra no LRCLIB (sdd-015). */
export async function searchSongsByLyrics(request: FastifyRequest, reply: FastifyReply) {
  const { q } = songSearchQuerySchema.parse(request.query);
  const items = await songService.searchLyrics(q);
  return reply.status(200).send(items);
}

/** Cadastro pelo vídeo (sdd-011, já começa a preparar) ou pela letra (sdd-015, fica em `NONE`). */
export async function createSong(request: FastifyRequest, reply: FastifyReply) {
  const body = createSongBodySchema.parse(request.body);
  const { song, created } =
    "lrclibId" in body ? await songService.createFromLyrics(body.lrclibId) : await songService.createFromVideo(body.videoId);
  return reply.status(created ? 201 : 200).send(song);
}

export async function getSong(request: FastifyRequest, reply: FastifyReply) {
  const { id } = songParamsSchema.parse(request.params);
  const song = await songService.getById(id);
  return reply.status(200).send(song);
}

export async function setReferenceFromYoutube(request: FastifyRequest, reply: FastifyReply) {
  const { id } = songParamsSchema.parse(request.params);
  const { url, redo } = youtubeReferenceBodySchema.parse(request.body);

  // Link inválido ou de outro host → 400 sem chamar o worker (regra 11).
  const videoId = parseYoutubeVideoId(url);
  if (videoId === null) throw new InvalidYoutubeUrlError();

  const started = await songService.startReferenceFromYoutube(id, videoId, { redo });
  return reply.status(202).send(started);
}

type MultipartFields = NonNullable<Awaited<ReturnType<FastifyRequest["file"]>>>["fields"];

/** Valor de um campo de texto do multipart, ou `undefined` se ausente ou se for um arquivo. */
function textField(fields: MultipartFields, name: string): unknown {
  const field = fields[name];
  const single = Array.isArray(field) ? field[0] : field;
  return single !== undefined && "value" in single ? single.value : undefined;
}

export async function uploadReference(request: FastifyRequest, reply: FastifyReply) {
  const { id } = songParamsSchema.parse(request.params);

  const file = await request.file();
  if (!file) throw new MissingUploadFileError();

  // Acima do limite (20 MB, app.ts) o próprio multipart rejeita com 413.
  const audio = await file.toBuffer();
  // Campos de texto só ficam disponíveis se vierem ANTES do arquivo no corpo (o web manda assim).
  const redo = referenceRedoSchema.parse(textField(file.fields, "redo"));

  const started = await songService.startReference(id, audio, file.filename, { redo });
  return reply.status(202).send(started);
}

export async function getReference(request: FastifyRequest, reply: FastifyReply) {
  const { id } = songParamsSchema.parse(request.params);
  const track = await songService.getReference(id);
  return reply.status(200).send(track);
}

/** Candidatos do YouTube ranqueados para a música (sdd-008). Não muda o status da referência. */
export async function getYoutubeCandidates(request: FastifyRequest, reply: FastifyReply) {
  const { id } = songParamsSchema.parse(request.params);
  const suggestion = await youtubeSuggestionService.forSong(id);
  return reply.status(200).send(suggestion);
}

/**
 * Voz e instrumental do áudio enviado (sdd-013). Recebe o arquivo no multipart (limite de
 * 20 MB do `app.ts`) e repassa o `multipart/form-data` do worker em streaming, com o
 * `content-type` (e o `boundary`) dele.
 */
export async function separateStems(request: FastifyRequest, reply: FastifyReply) {
  const { id } = songParamsSchema.parse(request.params);

  const file = await request.file();
  if (!file) throw new MissingUploadFileError();
  const audio = await file.toBuffer();

  const { stream, contentType, contentLength } = await songService.separateStems(id, audio, file.filename);

  reply.type(contentType);
  if (contentLength !== null) reply.header("content-length", contentLength);
  return reply.send(Readable.fromWeb(stream as NodeReadableStream<Uint8Array>));
}

/**
 * Uma trilha guardada da referência (sdd-016): `vocals` ou `instrumental`, como arquivo
 * `audio/mp4` em streaming do disco, com `Content-Length` (o web mostra o progresso).
 */
export async function getSongStem(request: FastifyRequest, reply: FastifyReply) {
  const { id, stem } = songStemParamsSchema.parse(request.params);
  const { stream, size, contentType } = await songService.getStem(id, stem);

  reply.type(contentType);
  reply.header("content-length", size);
  return reply.send(stream);
}

export async function getSongAudio(request: FastifyRequest, reply: FastifyReply) {
  const { id } = songParamsSchema.parse(request.params);
  const { stream, contentType, contentLength } = await songService.getAudio(id);

  reply.type(contentType);
  if (contentLength !== null) reply.header("content-length", contentLength);

  // Streaming: o Fastify precisa de um Readable do Node; nada fica inteiro em memória.
  return reply.send(Readable.fromWeb(stream as NodeReadableStream<Uint8Array>));
}
