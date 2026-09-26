import "server-only";
import { createApi, type Api } from "./api";
import { serverEnv } from "./env.server";

/** Cliente da API para Server Components: usa `API_INTERNAL_URL` (`http://api:3333` no compose). */
export const serverApi: Api = createApi(serverEnv.apiInternalUrl);
