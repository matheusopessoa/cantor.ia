import "server-only";
import { publicEnv, requireUrl } from "./env.public";

const apiInternalUrl = process.env.API_INTERNAL_URL;

export const serverEnv = {
  // Dentro do container do web, localhost não é a API: o compose define http://api:3333.
  apiInternalUrl: apiInternalUrl
    ? requireUrl("API_INTERNAL_URL", apiInternalUrl)
    : publicEnv.apiUrl,
};
