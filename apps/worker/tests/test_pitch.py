import numpy as np
import pytest

from app import main, pitch
from app.errors import WorkerError
from tests.conftest import glissando, silence, sine, white_noise, write_wav


def voiced(midi: list[float | None]) -> list[float]:
    return [m for m in midi if m is not None]


def test_hz_to_midi():
    assert pitch.hz_to_midi(440) == 69.0
    assert pitch.hz_to_midi(220) == 57.0
    assert pitch.hz_to_midi(261.63) == pytest.approx(60.0, abs=0.01)


def test_sine_440_hz_vira_midi_69():
    midi = pitch.track(sine(440, 3))
    in_range = [m for m in midi if m is not None and 68.9 <= m <= 69.1]
    assert len(in_range) / len(midi) >= 0.95


def test_silencio_vira_tudo_none():
    assert all(m is None for m in pitch.track(silence(3)))


def test_glissando_sobe_de_57_a_69():
    values = voiced(pitch.track(glissando(220, 440, 3)))
    assert len(values) > 250
    assert values[5] == pytest.approx(57, abs=0.3)
    assert values[-5] == pytest.approx(69, abs=0.3)
    # monotônico, com tolerância a pequenas oscilações do detector
    assert all(b >= a - 0.3 for a, b in zip(values, values[1:]))


def test_ruido_branco_quase_todo_none():
    midi = pitch.track(white_noise(3))
    assert sum(m is None for m in midi) / len(midi) >= 0.9


def test_tamanho_do_array_bate_com_a_duracao(tmp_path):
    path = write_wav(tmp_path / "a.wav", sine(330, 2.5))
    track = main._extract_sync(path, separate=False)
    assert track.hopMs == 10
    assert abs(len(track.midi) - round(track.durationMs / 10)) <= 1
    assert track.durationMs == pytest.approx(2500, abs=5)


def test_audio_sem_voz_levanta_no_voice(tmp_path):
    path = write_wav(tmp_path / "s.wav", silence(3))
    with pytest.raises(WorkerError) as exc:
        main._extract_sync(path, separate=False)
    assert exc.value.code == "no_voice"


@pytest.mark.slow
def test_pipeline_completo_com_demucs(tmp_path):
    rng = np.random.default_rng(1)
    mix = sine(440, 10, amp=0.4) + (0.05 * rng.standard_normal(10 * 44_100)).astype(np.float32)
    path = write_wav(tmp_path / "mix.wav", mix)
    track = main._extract_sync(path, separate=True)
    assert abs(len(track.midi) - round(track.durationMs / 10)) <= 1
