import type { FastifyInstance } from "fastify";
import { getRanking, submitPerformance } from "../controllers/performance.controller.js";
import {
  createSong,
  getReference,
  getSong,
  getSongAudio,
  searchSongs,
  setReferenceFromYoutube,
  uploadReference,
} from "../controllers/song.controller.js";

/** Um PitchTrack de 10 min tem ~60 mil frames (~400 KB em JSON): 2 MB dá folga. */
const PERFORMANCE_BODY_LIMIT = 2 * 1024 * 1024;

export async function songRoutes(app: FastifyInstance) {
  app.get("/search", searchSongs);
  app.post("/", createSong);
  app.get("/:id", getSong);

  app.post("/:id/reference/youtube", setReferenceFromYoutube);
  app.post("/:id/reference", uploadReference);
  app.get("/:id/reference", getReference);
  app.get("/:id/audio", getSongAudio);

  app.post("/:id/performances", { bodyLimit: PERFORMANCE_BODY_LIMIT }, submitPerformance);
  app.get("/:id/performances", getRanking);
}
