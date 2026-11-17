"""Builds sit-bell-v3.ogg: 2 hours of silence followed by one soft bell strike.

The app starts playback N minutes before the bell, so the phone simply plays the
file through (even with the screen off) and the bell rings at the end.

v3: about 7 s (v2 was 5 s; v1 11 s), pure partials with no detuned pairs (v1's beating
sounded phasey), and no hiss (see the concat note below).

Needs ffmpeg with libopus on PATH. No Python packages required.
"""
import math, os, struct, subprocess, wave

RATE = 48000
SILENCE_S = 7200          # 120 minutes: the longest session
BELL_S = 7.0              # total length of the bell
FADE_S = 2.0           # gentle fade over the last part, so it ends in silence
OUT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP_WAV = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bell.wav')
OUT = os.path.join(OUT_DIR, 'sit-bell-v3.ogg')

# Bell partials: (frequency ratio, relative amplitude, decay time constant in s)
F0 = 220.0  # A3: low and warm
PARTIALS = [
    (1.000, 1.00, 2.5),
    (2.000, 0.30, 1.6),
    (2.756, 0.22, 1.2),
    (5.404, 0.06, 0.65),
]
ATTACK_S = 0.012           # soft mallet: rounded, no click
PEAK = 0.45                # about -7 dBFS: present but not startling


def bell_samples():
    n = int(BELL_S * RATE)
    out = [0.0] * n
    for ratio, amp, decay in PARTIALS:
        w = 2 * math.pi * F0 * ratio / RATE
        k = 1.0 / (decay * RATE)
        for i in range(n):
            out[i] += amp * math.exp(-i * k) * math.sin(w * i)
    a = int(ATTACK_S * RATE)
    for i in range(a):
        out[i] *= 0.5 - 0.5 * math.cos(math.pi * i / a)
    f = int(FADE_S * RATE)
    for i in range(f):
        out[n - f + i] *= 0.5 + 0.5 * math.cos(math.pi * i / f)
    peak = max(abs(s) for s in out) or 1.0
    return [s * PEAK / peak for s in out]


def write_wav(path, samples):
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b''.join(struct.pack('<h', max(-32767, min(32767, round(s * 32767)))) for s in samples))


write_wav(TMP_WAV, bell_samples())
subprocess.run([
    'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', f'anullsrc=r={RATE}:cl=mono:d={SILENCE_S}',
    '-i', TMP_WAV,
    # Both inputs as s16 mono before joining: mixing the float silence with the
    # s16 bell made the concat add audible hiss (this was v1's "white noise").
    '-filter_complex',
    '[0]aformat=sample_fmts=s16:channel_layouts=mono[a];'
    '[1]aformat=sample_fmts=s16:channel_layouts=mono[b];'
    '[a][b]concat=n=2:v=0:a=1',
    '-c:a', 'libopus', '-b:a', '96k', '-vbr', 'on', '-application', 'audio',
    OUT,
], check=True)
os.remove(TMP_WAV)
print('wrote', OUT, os.path.getsize(OUT), 'bytes')
