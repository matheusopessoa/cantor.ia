# Task: Criar as telas de busca, preparação, karaokê e resultado no web

- **Slug:** web-karaoke
- **Autor do plano:** Code-Planner (SDD)
- **Data:** 2026-09-25
- **Status:** ready
- **Versão-alvo:** web 0.2.0
- **App afetado:** web
- **Tipo de mudança:** feature
- **Impacto público (schema/API/UI contract):** none (consome as rotas de sdd-003; sem contrato novo)

## 1. Contexto e Motivação
- É a experiência completa do MVP: escolher a música, preparar a referência, cantar com a letra
  e o pitch ao vivo, e ver a nota e o ranking "de fliperama".
- Hoje `apps/web/app/page.tsx` é o boilerplate do `create-next-app`, e `globals.css` ainda não
  importa os tokens do design system.
- Pedido original: `specs/tasks.txt`, item 4.
- Rastreabilidade:
  - `apps/web/AGENTS.md`: o Next.js 16 tem breaking changes. **Antes de codar, o implementer
    deve ler `apps/web/node_modules/next/dist/docs/`** (App Router, Client Components,
    params assíncronos, env públicas).
  - cantor.ia Design System `apps/web/DESIGN_SYSTEM/readme.md` (refeito em 2026-09-25, ver
    `specs/sdd-005-design-system/tasks.md`):
    componentes prontos para todas as telas (`.ct-lyric` com preenchimento de karaokê,
    `.ct-highway`, `.ct-hud`, `.ct-score`/`.ct-grade`/`.ct-meter`, `.ct-ranking` +
    `.ct-marquee`, `.ct-name-entry`, `.ct-dropzone`, `.ct-song-row`, `.ct-badge`). O implementer
    usa essas classes em vez de recriar estilos.

## 2. Escopo
- **Inclui**
  - Integração do DS em `globals.css` (`@import` de `DESIGN_SYSTEM/styles.css` e
    `DESIGN_SYSTEM/tailwind-theme.css`), remoção do Geist via `next/font` no `layout.tsx` e troca
    do boilerplate.
  - Página `/` com a busca de músicas.
  - Página `/songs/[id]` com a preparação: cadastro/status da referência a partir do **link do
    YouTube** (aba principal) ou do **upload de arquivo** (aba alternativa), polling a cada 3 s
    enquanto `PROCESSING`, campo de nome, ranking top 10 e botão "Cantar". Enquanto processa,
    mostra a miniatura do vídeo numa `.ct-tv` e o tempo decorrido em `.ct-loading`, e o nome já
    pode ser preenchido.
  - Mapa tela → componente: seguir a tabela "Telas → componentes" do readme do design system.
    Nenhum estilo novo fora do DS. Se faltar componente, ele entra primeiro no DS (readme +
    vitrine) e depois na tela.
  - Botão "Procurar no YouTube" que abre numa aba nova
    `https://www.youtube.com/results?search_query=<artista título official audio>` (com
    `encodeURIComponent`), com a dica: "prefira vídeos 'official audio' ou 'lyric video'. Clipes
    costumam ter introdução diferente".
  - Página `/songs/[id]/sing` com o karaokê: música no fone, letra sincronizada, gráfico de
    pitch ao vivo (referência × voz), ajuste de offset da letra, parar/terminar, e depois a
    tela de resultado (nota, subnotas, posição e ranking).
  - **Áudio da música para tocar**: o servidor não guarda áudio. O browser mantém um **cache em
    IndexedDB** por `songId`. Sem cache: se a música tem `youtubeVideoId`, baixa via
    `GET /api/songs/:id/audio` (com progresso) e salva no cache. Se não tem (referência veio de
    upload) ou o download falhar, pede o arquivo com um seletor.
  - Captura do microfone com `AudioWorklet` e detecção de pitch com `pitchy` (hop de 10 ms),
    gerando um `PitchTrack` compatível com sdd-001.
  - Cliente da API tipado (`lib/api.ts`) e env `NEXT_PUBLIC_API_URL`.
  - **Vitest no `apps/web`** para as funções puras de `lib/` (`AGENTS.md` §10: "não commitar
    código sem testes").
- **Exclui**
  - Mobile como alvo principal (funciona se o browser suportar, mas o foco é Chrome e Safari
    desktop).
  - Instrumental sem voz, letra por palavra, login, compartilhamento.
  - Testes E2E com browser (Playwright): smoke manual no MVP.

## 3. Impacto Arquitetural
- Estrutura (App Router):
  ```
  apps/web/
  ├── app/
  │   ├── layout.tsx                    # lang="pt-BR", metadata "cantor.ia", tokens do DS
  │   ├── globals.css                   # @import do styles.css do DS + Tailwind 4
  │   ├── page.tsx                      # Server Component: shell + <SongSearch/>
  │   └── songs/[id]/
  │       ├── page.tsx                  # Server Component: busca SongDto + ranking; <SongPrep/>
  │       └── sing/page.tsx             # Server Component: SongDto; <KaraokeSession/>
  ├── components/
  │   ├── song-search.tsx               # "use client"
  │   ├── song-prep.tsx                 # "use client": link do YouTube/upload, polling, nome
  │   ├── karaoke-session.tsx           # "use client": máquina de estados da sessão
  │   ├── pitch-canvas.tsx              # "use client": canvas, requestAnimationFrame
  │   ├── lyrics-view.tsx
  │   ├── score-result.tsx
  │   └── ranking-list.tsx
  ├── lib/
  │   ├── api.ts                        # fetch tipado para /api/songs/*
  │   ├── types.ts                      # espelho dos DTOs de sdd-003 (ver risco R4)
  │   ├── pitch.ts                      # hzToMidi, foldToReference, framesToTrack (puras)
  │   ├── lyrics.ts                     # currentLineIndex(lines, tMs, offsetMs) (pura)
  │   ├── audio-store.ts                # IndexedDB: saveSongAudio/getSongAudio (cache)
  │   ├── youtube.ts                    # youtubeSearchUrl(artist, title) (pura)
  │   ├── player-name.ts                # localStorage: último nome usado
  │   └── recorder.ts                   # AudioContext + worklet + pitchy → frames
  ├── public/worklets/capture.worklet.js  # copia blocos de 128 amostras para a main thread
  └── tests/                            # *.spec.ts do Vitest (lib/ puras)
  ```
- Máquina de estados de `KaraokeSession`:
  ```
  loading-audio ─(cache no IndexedDB)──────────────────────────► checking-duration
        │                                                              ▲   │ (≠ ±10 s) → erro
        │ sem cache e com youtubeVideoId                               │   ▼
        ├──► downloading-audio (GET /audio, progresso) ─(ok, salva)────┤  ready
        │            │ falha                                           │
        │            ▼                                                 │
        └──(sem youtubeVideoId)──► pick-file ──────────────────────────┘
                                  │ clique "Começar" (gesto do usuário: libera o AudioContext)
                                  ▼
                              mic-permission ─(negada)─► erro com instrução
                                  ▼
                              countdown 3 s ─► singing ─(fim da música | "Terminar")─► submitting ─► result
                                                  │ "Parar" (descarta)
                                                  ▼
                                                ready
  ```
- Pipeline de áudio e sincronização:
  ```
  AudioContext (um relógio só)
   ├─ AudioBufferSourceNode(música decodificada) ─► destination (fone)
   │     start(t0)
   └─ MediaStreamSource(mic: echoCancellation/noiseSuppression/autoGainControl = false)
         ─► AudioWorkletNode(capture) ─postMessage(blocos)─► recorder.ts
               ring buffer de 2048 amostras; a cada 10 ms de áudio (sampleRate/100 amostras):
                 [hz, clarity] = pitchy.findPitch(buffer)
                 rms < gate || clarity < 0.9 || hz ∉ [65, 1100] → null, senão hzToMidi(hz)
                 frame índice = round((tempoDaAmostra - t0 - latência) / 10 ms)
  latência = audioContext.outputLatency + audioContext.baseLatency (compensação automática)
  ```
- Gráfico ao vivo: canvas dentro de `.ct-highway__lane`, com janela de ±4 s em volta do tempo
  atual. A referência é desenhada em `--pitch-reference` (ciano) e a voz em `--pitch-voice`
  (rosa), lidas com `getComputedStyle` uma vez na montagem (nada de hex no TS). A voz é
  **dobrada para a oitava mais próxima da referência** (`foldToReference`), para o usuário ver
  o alinhamento mesmo cantando uma oitava abaixo, igual à regra da nota. A cada 250 ms, um
  `.ct-hit` (PERFECT/GOOD/MISS pelo erro médio em cents: ≤ 50 / ≤ 100 / resto) aparece sobre a
  linha de acerto. Só feedback visual: a nota oficial vem da API.
- Fetch de dados: Server Components para `SongDto` e ranking iniciais. Polling, upload e envio
  da performance ficam em Client Components.

## 4. Contratos e Interfaces
- Consumidos (sdd-003): `GET /api/songs/search`, `POST /api/songs`, `GET /api/songs/:id`,
  `POST|GET /api/songs/:id/reference`, `POST /api/songs/:id/reference/youtube`,
  `GET /api/songs/:id/audio`, `POST|GET /api/songs/:id/performances`.
- `lib/api.ts`:
  ```ts
  export const api = {
    searchSongs(q: string): Promise<SongSearchItem[]>;
    createSong(lrclibId: number): Promise<SongDto>;
    getSong(id: string): Promise<SongDto>;
    setReferenceFromYoutube(id: string, url: string): Promise<{ status: ReferenceStatus; youtubeVideoId: string }>;
    uploadReference(id: string, file: File): Promise<{ status: ReferenceStatus }>;
    getReference(id: string): Promise<PitchTrack>;
    downloadSongAudio(id: string, onProgress?: (loaded: number, total: number | null) => void): Promise<Blob>;
    submitPerformance(id: string, body: { playerName: string; offsetMs: number; track: PitchTrack }): Promise<PerformanceResult>;
    getRanking(id: string, limit?: number): Promise<RankingItem[]>;
  };
  // Erro HTTP → ApiError { status, code?, message }. A tela escolhe o texto pelo `code`
  // (lib/reference-errors.ts), nunca mostra `message` nem stack
  ```
- `lib/pitch.ts`:
  ```ts
  export function hzToMidi(hz: number): number;
  export function foldToReference(sung: number, ref: number | null): number;
  export function framesToTrack(frames: (number | null)[], durationMs: number): PitchTrack;
  ```
- `lib/audio-store.ts`:
  ```ts
  export function saveSongAudio(songId: string, file: Blob): Promise<void>;
  export function getSongAudio(songId: string): Promise<Blob | null>;
  // try/catch em tudo: IndexedDB indisponível (aba anônima) → segue sem cache
  //   (baixa do YouTube a cada sessão ou pede o arquivo)
  ```
- `lib/youtube.ts`:
  ```ts
  export function youtubeSearchUrl(artist: string, title: string): string;
  export function youtubeThumbnailUrl(videoId: string, size: "default" | "hq"): string;
  // https://i.ytimg.com/vi/<id>/default.jpg (linha da busca) | hqdefault.jpg (TV)
  ```
- `lib/reference-errors.ts`:
  ```ts
  export function referenceErrorCopy(code: ReferenceErrorCode | "INVALID_YOUTUBE_URL",
    ctx: { songMs: number; audioMs: number | null }): { tone: "danger" | "warning"; title: string; body: string };
  // Textos exatamente como na tabela "Erros da referência" do readme do DS
  ```
- Miniaturas: `next/image` com `images.remotePatterns` liberando `https://i.ytimg.com/vi/**`
  em `next.config.ts` (conferir a API do Next 16 na doc local).
- Env (definidas em `specs/sdd-006-env-config/tasks.md`): `publicEnv.apiUrl`
  (`NEXT_PUBLIC_API_URL`) no browser e `serverEnv.apiInternalUrl` (`API_INTERNAL_URL`) nos
  Server Components, que dentro do container não alcançam a API por `localhost`. `lib/api.ts`
  escolhe a base conforme roda no servidor ou no browser. Não é preciso mexer em
  `CORS_ALLOWED_ORIGINS` no dev: `apps/api/src/config/cors.ts:15` já usa `origin: true` em dev.
- Dependências novas: `pitchy`; dev: `vitest` (versões via skill `latest-deps`). Script
  `"test": "vitest run"` no `apps/web/package.json`.

## 5. Regras de Negócio Aplicáveis
| # | Regra atual | Comportamento após a mudança | Origem |
|---|---|---|---|
| 1 | — | Nome obrigatório (1–20 chars, mesma regex da API) antes de cantar. Vem preenchido com o último nome usado no dispositivo | Decisão do usuário ("fliperama") |
| 2 | — | A referência é gerada uma vez por música, colando o link do YouTube (principal) ou enviando um arquivo (alternativa) | Decisão do usuário (2026-09-25, projeto pessoal) |
| 3 | — | Áudio para tocar: cache no IndexedDB → download via API (se houver `youtubeVideoId`) → seletor de arquivo. O arquivo escolhido no seletor nunca é enviado ao servidor | Decisão do usuário ("Descartar") |
| 4 | — | Áudio (do cache, do download ou do seletor) com duração diferente de `song.durationMs` em mais de 10 s é recusado | Mesmo critério da API (sdd-003 regra 7) |
| 5 | — | Aviso fixo de "use fone de ouvido" antes de começar: sem fone, o microfone capta a música | MVP |
| 6 | — | Offset da letra ajustável de −10 a +10 s (passos de 100 ms). É enviado como `offsetMs` e memorizado por música no dispositivo. Só desloca a letra, nunca muda a velocidade: se a letra acabar antes ou depois do áudio, é esperado e não é erro | MVP ("slider de ±2 s"); faixa ampliada para ±10 s a pedido do usuário em 2026-09-25 (mesmo limite da tolerância de duração) |
| 7 | — | "Terminar" antes do fim envia a performance parcial (a nota reflete a cobertura). "Parar" descarta | Evita nota sem querer |
| 8 | — | Resultado mostra nota, afinação, tempo, posição e ranking com a performance atual destacada | Fliperama |
| 9 | — | Copy em pt-BR com energia de fliperama, sem emoji (DS, seção "Voz e texto"). Nota em Press Start 2P (`.ct-score`) + conceito S/A/B/C/D (`.ct-grade`) | Design system |
| 10 | — | O link do YouTube não é validado no web além de "não vazio": a API é a fonte da verdade (400 `INVALID_YOUTUBE_URL` → mensagem da tabela do DS) | Evita duas regras divergentes |
| 11 | — | Toda falha de referência é mostrada pelo código (`referenceError`), com o texto da tabela "Erros da referência" do DS. `DURATION_MISMATCH` mostra as duas durações (`referenceAudioMs` × `durationMs`) | Design system |
| 12 | — | A espera do processamento mostra tempo decorrido, **nunca** porcentagem inventada. Porcentagem só no download do áudio, quando há `Content-Length` | Design system ("Telas → componentes") |

## 6. Critérios de Aceitação
- **Performance**
  - Detecção de pitch sem travar a UI: o trabalho por hop leva < 2 ms em média (medido com
    `performance.now()` no dev). O canvas roda a 60 fps em Chrome desktop.
  - O `PitchTrack` da referência é buscado **uma vez** por sessão (não a cada render).
  - Polling de status para ao chegar em `READY`/`FAILED` e ao desmontar o componente.
- **Sincronização**: cantar junto com a própria gravação original (tocando em outra caixa de
  som, sem fone) dá `timingScore` ≥ 8. Isso valida a compensação de latência.
- **Consistência com a nota**: o `PitchTrack` gerado tem `hopMs: 10` e
  `midi.length ≈ durationMs / 10` (±1%) e é aceito pelo `pitchTrackSchema` da API.
- **Robustez**: permissão de microfone negada, IndexedDB indisponível, API fora do ar, worker
  `FAILED`, link inválido e falha no download do YouTube mostram mensagens claras com ação
  possível (ex.: "não foi possível baixar do YouTube. Envie o arquivo de áudio"). Nenhuma tela
  quebra.
- **Download do áudio**: mostra progresso quando há `Content-Length`. Depois do primeiro
  download, recarregar a página toca direto do cache, sem nova chamada a `GET /audio`.
- **Recursos liberados**: sair da página fecha o `AudioContext`, as tracks do mic e os object
  URLs.
- **Segurança**: `playerName` renderizado como texto (sem `dangerouslySetInnerHTML`).
- **Qualidade**: `pnpm --filter web lint` e `pnpm --filter web test` verdes;
  `pnpm --filter web build` sem erros.
- **Critério de "pronto" do MVP** (com sdd-001/002/003 prontos): em 3 músicas, uma pessoa
  cantando bem tira ≥ 7, cantando mal ou falando tira ≤ 4, e cantar uma oitava abaixo dá
  praticamente a mesma nota.

## 7. Plano de Testes
- **Vitest (`apps/web/tests`)**, só para funções puras:
  - `pitch.spec.ts`: `hzToMidi(440)=69`, `hzToMidi(220)=57`; `foldToReference` (oitava
    abaixo/acima, ref null); `framesToTrack` (tamanho, `hopMs`, nulls preservados).
  - `lyrics.spec.ts`: `currentLineIndex` antes da 1ª linha, no meio, após a última, com
    offset positivo e negativo.
  - `player-name.spec.ts`: validação espelhando a regex da API.
  - `youtube.spec.ts`: `youtubeSearchUrl` monta a URL com o termo codificado (acentos, `&`,
    aspas); `youtubeThumbnailUrl` nos dois tamanhos.
  - `reference-errors.spec.ts`: um caso por código (tom, título e corpo), `DURATION_MISMATCH`
    formatando `m:ss`, código desconhecido caindo em `INTERNAL`.
- **Smoke manual (Chrome e Safari desktop, registrar no PR)**:
  1. Buscar, cadastrar, "Procurar no YouTube" abre a busca, colar o link, ver `PROCESSING` →
     `READY`.
  2. Cantar: o áudio é baixado via API com progresso. Recarregar: vem do cache, sem baixar.
  3. Aba anônima (sem cache): baixa de novo via API, sem pedir arquivo.
  4. Link inválido (`https://example.com`): mensagem clara, nada é processado.
  5. Outra música com referência por upload, em aba anônima: pede o arquivo e recusa um de
     duração errada.
  6. Cantar com fone: gráfico ao vivo acompanha, resultado aparece, ranking atualiza.
  7. Negar o microfone: aparece a mensagem de instrução.
  8. Ajustar o offset: a letra desloca e o valor persiste ao voltar.
- **Lint**: `pnpm --filter web lint`.

## 8. Dependências e Riscos
| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| R1. APIs do Next 16 diferentes do conhecido (params assíncronos etc.) | alta | médio | Ler `node_modules/next/dist/docs/` antes de codar (`apps/web/AGENTS.md`) |
| R2. Latência de áudio varia por dispositivo/Bluetooth (fone BT: 150–300 ms) | alta | médio | Compensação automática + offset manual. Recomendar fone com fio no aviso |
| R3. Safari: `outputLatency` indisponível ou `AudioWorklet` com restrições | média | médio | Fallback para `baseLatency` apenas. Testar no smoke |
| R4. Tipos duplicados entre `apps/api` e `apps/web` podem divergir | média | baixo | `lib/types.ts` com comentário apontando a origem. Pacote `packages/contracts` como follow-up |
| R5. ~~DS "Atrito" anti-gamificação~~ **Resolvido**: DS refeito como cantor.ia Design System (sdd-005, 2026-09-25), feito para o jogo | — | — | Usar as classes `ct-*` do DS |
| R6. Outra pessoa, em outro dispositivo, precisa do áudio para cantar | baixa (com YouTube) | médio | Resolvido pelo `GET /audio`. Só músicas com referência por upload ainda pedem o arquivo |
| R7. O vídeo escolhido não bate com a letra do LRCLIB (clipe com introdução, versão ao vivo) | média | médio | Busca já sugere "official audio" + dica na tela. A API recusa duração ±10 s fora. Offset de ±10 s cobre o resto |
| R8. Download do YouTube lento ou quebrado na hora de cantar | média | baixo | Progresso visível, cache no IndexedDB e seletor de arquivo como saída |

## 9. Perguntas em Aberto (bloqueantes)
_Nenhuma._

## 10. Checklist de Conformidade
- [x] Decisões citam o design system, `apps/web/AGENTS.md`, `AGENTS.md` ou decisão do usuário.
- [x] Nenhum código de produção foi escrito (apenas pseudocódigo/assinaturas).
- [x] Seção 6 (Critérios de Aceitação) preenchida de forma substantiva.
- [x] Sem contrato público novo. Consome sdd-003 sem alterá-lo.
- [x] Perguntas em aberto foram exauridas.
- [ ] Na implementação: documentar `pnpm --filter web test` em `AGENTS.md` §1 e
      `NEXT_PUBLIC_API_URL`/`API_INTERNAL_URL` no `README.md` do web (o catálogo em §11 vem da
      sdd-006).
- **Depende de:** sdd-003 (rotas), que depende de sdd-001 e sdd-002; e sdd-006 (`lib/env.*.ts`).
