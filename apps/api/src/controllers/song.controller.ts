import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { FastifyReply, FastifyRequest } from "fastify";
import { songService } from "../services/song.service.js";
import { InvalidYoutubeUrlError, MissingUploadFileError } from "../utils/errors.js";
import {
  createSongBodySchema,
  songParamsSchema,
  songSearchQuerySchema,
  youtubeReferenceBodySchema,
} from "../utils/validators.js";
import { parseYoutubeVideoId } from "../utils/youtube.js";

export async function searchSongs(request: FastifyRequest, reply: FastifyReply) {
  const { q } = songSearchQuerySchema.parse(request.query);
  const items = await songService.search(q);
  return reply.status(200).send(items);
}

export async function createSong(request: FastifyRequest, reply: FastifyReply) {
  const { lrclibId } = createSongBodySchema.parse(request.body);
  const { song, created } = await songService.create(lrclibId);
  return reply.status(created ? 201 : 200).send(song);
}

export async function getSong(request: FastifyRequest, reply: FastifyReply) {
  const { id } = songParamsSchema.parse(request.params);
  const song = await songService.getById(id);
  return reply.status(200).send(song);
}

export async function setReferenceFromYoutube(request: FastifyRequest, reply: FastifyReply) {
  const { id } = songParamsSchema.parse(request.params);
  const { url } = youtubeReferenceBodySchema.parse(request.body);

  // Link inválido ou de outro host → 400 sem chamar o worker (regra 11).
  const videoId = parseYoutubeVideoId(url);
  if (videoId === null) throw new InvalidYoutubeUrlError();

  const started = await songService.startReferenceFromYoutube(id, videoId);
  return reply.status(202).send(started);
}

export async function uploadReference(request: FastifyRequest, reply: FastifyReply) {
  const { id } = songParamsSchema.parse(request.params);

  const file = await request.file();
  if (!file) throw new MissingUploadFileError();

  // Acima do limite (20 MB, app.ts) o próprio multipart rejeita com 413.
  const audio = await file.toBuffer();

  const started = await songService.startReference(id, audio, file.filename);
  return reply.status(202).send(started);
}

export async function getReference(request: FastifyRequest, reply: FastifyReply) {
  const { id } = songParamsSchema.parse(request.params);
  const track = await songService.getReference(id);
  return reply.status(200).send(track);
}

export async function getSongAudio(request: FastifyRequest, reply: FastifyReply) {
  const { id } = songParamsSchema.parse(request.params);
  const { stream, contentType, contentLength } = await songService.getAudio(id);

  reply.type(contentType);
  if (contentLength !== null) reply.header("content-length", contentLength);

  // Streaming: o Fastify precisa de um Readable do Node; nada fica inteiro em memória.
  return reply.send(Readable.fromWeb(stream as NodeReadableStream<Uint8Array>));
}
