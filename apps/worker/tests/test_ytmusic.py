"""Busca no YouTube Music (experimento de fonte de letra), com um `YTMusic` falso: sem rede."""

from types import SimpleNamespace

import pytest

from app import ytmusic


def timed(text: str, start: int, end: int):
    return SimpleNamespace(text=text, start_time=start, end_time=end, id=0)


def song(video_id: str, title: str, *, artists=("Artista",), album="Álbum", duration=200, result_type="song"):
    return {
        "resultType": result_type,
        "videoId": video_id,
        "title": title,
        "artists": [{"name": name, "id": "x"} for name in artists],
        "album": {"name": album, "id": "y"} if album else None,
        "duration_seconds": duration,
    }


class FakeYTMusic:
    results: list = []
    lyrics_by_video: dict = {}   # videoId → retorno do get_lyrics (None = sem letra)
    failing_videos: set = set()
    tracks_by_video: dict = {}   # videoId → track do get_watch_playlist (sdd-011)
    search_error: Exception | None = None
    queries: list = []

    def search(self, query, filter=None):
        FakeYTMusic.queries.append((query, filter))
        if FakeYTMusic.search_error:
            raise FakeYTMusic.search_error
        return FakeYTMusic.results

    def get_watch_playlist(self, video_id, limit=25):
        if video_id in FakeYTMusic.failing_videos:
            raise RuntimeError("formato mudou")
        track = FakeYTMusic.tracks_by_video.get(video_id)
        return {
            "tracks": [track] if track else [],
            "lyrics": f"MPLY{video_id}" if FakeYTMusic.lyrics_by_video.get(video_id) is not None else None,
        }

    def get_lyrics(self, browse_id, timestamps=False):
        assert timestamps is True
        return FakeYTMusic.lyrics_by_video[browse_id.removeprefix("MPLY")]


@pytest.fixture
def fake_ytmusic(monkeypatch: pytest.MonkeyPatch) -> type[FakeYTMusic]:
    FakeYTMusic.results = []
    FakeYTMusic.lyrics_by_video = {}
    FakeYTMusic.failing_videos = set()
    FakeYTMusic.tracks_by_video = {}
    FakeYTMusic.search_error = None
    FakeYTMusic.queries = []
    monkeypatch.setattr(ytmusic, "YTMusic", FakeYTMusic)
    return FakeYTMusic


def test_devolve_musicas_com_letra_sincronizada_texto_e_sem_letra(client, fake_ytmusic):
    fake_ytmusic.results = [
        song("aaaaaaaaaaa", "Sincronizada", artists=("A", "B")),
        {"resultType": "video", "videoId": "vvvvvvvvvvv", "title": "Clipe"},
        song("bbbbbbbbbbb", "Só texto", album=None, duration=None),
        song("ccccccccccc", "Instrumental"),
        song("ddddddddddd", "Quebrada"),
    ]
    fake_ytmusic.lyrics_by_video = {
        "aaaaaaaaaaa": {
            "lyrics": [timed("♪", 0, 900), timed("Primeira linha", 1000, 2500), timed("  ", 2500, 2600), timed("Segunda", 2600, 4000)],
            "source": "Source: LyricFind",
            "hasTimestamps": True,
        },
        "bbbbbbbbbbb": {"lyrics": "Linha um\n\nLinha dois\n", "source": "Source: Musixmatch", "hasTimestamps": False},
        "ccccccccccc": None,
    }
    fake_ytmusic.failing_videos = {"ddddddddddd"}

    response = client.post("/ytmusic/search", json={"query": "  Artista   Música "})

    assert response.status_code == 200
    songs = response.json()["songs"]
    assert fake_ytmusic.queries == [("Artista Música", "songs")]
    assert [s["videoId"] for s in songs] == ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc", "ddddddddddd"]
    assert songs[0] == {
        "videoId": "aaaaaaaaaaa",
        "title": "Sincronizada",
        "artist": "A, B",
        "album": "Álbum",
        "durationS": 200.0,
        "lyrics": {
            "status": "synced",
            "source": "LyricFind",
            "lines": [
                {"text": "Primeira linha", "startMs": 1000, "endMs": 2500},
                {"text": "Segunda", "startMs": 2600, "endMs": 4000},
            ],
        },
    }
    assert songs[1]["album"] is None and songs[1]["durationS"] is None
    assert songs[1]["lyrics"] == {
        "status": "plain",
        "source": "Musixmatch",
        "lines": [{"text": "Linha um", "startMs": None, "endMs": None}, {"text": "Linha dois", "startMs": None, "endMs": None}],
    }
    assert songs[2]["lyrics"] == {"status": "none", "source": None, "lines": []}
    assert songs[3]["lyrics"]["status"] == "error"


def test_limita_o_numero_de_musicas(client, fake_ytmusic):
    fake_ytmusic.results = [song(f"{i:011d}", f"Música {i}") for i in range(20)]
    response = client.post("/ytmusic/search", json={"query": "muitas"})
    assert len(response.json()["songs"]) == ytmusic.SEARCH_RESULTS


@pytest.mark.parametrize("bad", ["", "   ", "x" * 201])
def test_query_invalida_400_sem_chamar_o_youtube_music(client, fake_ytmusic, bad):
    response = client.post("/ytmusic/search", json={"query": bad})
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_query"
    assert fake_ytmusic.queries == []


def test_falha_da_busca_502(client, fake_ytmusic):
    fake_ytmusic.search_error = RuntimeError("YouTube Music mudou")
    response = client.post("/ytmusic/search", json={"query": "Artista"})
    assert response.status_code == 502
    assert response.json()["error"] == "search_failed"


# ── sdd-011: busca sem letra e metadados de um vídeo ──────────────────


def test_busca_sem_letra_nao_pede_a_letra(client, fake_ytmusic, monkeypatch):
    fake_ytmusic.results = [song("aaaaaaaaaaa", "Uma"), song("bbbbbbbbbbb", "Outra")]
    monkeypatch.setattr(ytmusic, "lyrics", lambda video_id: pytest.fail("não devia buscar a letra"))
    response = client.post("/ytmusic/search", json={"query": "artista", "withLyrics": False})
    assert response.status_code == 200
    assert [s["lyrics"]["status"] for s in response.json()["songs"]] == ["none", "none"]


def track(video_id: str, title: str = "Tanto Faz", length: str = "3:17"):
    return {"videoId": video_id, "title": title, "artists": [{"name": "Tim Bernardes"}], "album": {"name": "Recomeçar"}, "length": length}


def test_song_devolve_metadados_e_letra(client, fake_ytmusic):
    fake_ytmusic.tracks_by_video = {"lB0FNP4o02U": track("lB0FNP4o02U")}
    fake_ytmusic.lyrics_by_video = {"lB0FNP4o02U": {"lyrics": [timed("Tanto faz", 960, 7610)], "hasTimestamps": True, "source": "Source: Musixmatch"}}
    response = client.post("/ytmusic/song", json={"videoId": "lB0FNP4o02U"})
    assert response.status_code == 200
    body = response.json()
    assert (body["title"], body["artist"], body["album"], body["durationS"]) == ("Tanto Faz", "Tim Bernardes", "Recomeçar", 197.0)
    assert body["lyrics"]["status"] == "synced" and body["lyrics"]["source"] == "Musixmatch"
    assert body["lyrics"]["lines"] == [{"text": "Tanto faz", "startMs": 960, "endMs": 7610}]


def test_song_sem_letra(client, fake_ytmusic):
    fake_ytmusic.tracks_by_video = {"lB0FNP4o02U": track("lB0FNP4o02U", length="1:02:03")}
    body = client.post("/ytmusic/song", json={"videoId": "lB0FNP4o02U"}).json()
    assert body["durationS"] == 3723.0
    assert body["lyrics"] == {"status": "none", "source": None, "lines": []}


def test_song_desconhecido_422_video_unavailable(client, fake_ytmusic):
    response = client.post("/ytmusic/song", json={"videoId": "lB0FNP4o02U"})
    assert response.status_code == 422
    assert response.json()["error"] == "video_unavailable"


def test_song_falha_da_lib_502(client, fake_ytmusic):
    fake_ytmusic.failing_videos = {"lB0FNP4o02U"}
    response = client.post("/ytmusic/song", json={"videoId": "lB0FNP4o02U"})
    assert response.status_code == 502
    assert response.json()["error"] == "search_failed"


@pytest.mark.parametrize("body", [{"videoId": "curto"}, {}])
def test_song_video_id_invalido_400(client, fake_ytmusic, body):
    response = client.post("/ytmusic/song", json=body)
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_video_id"
