"""Builds sit-bell-v1.ogg: 2 hours of silence followed by one soft singing-bowl strike.

The app starts playback N minutes before the bell, so the phone simply plays the
file through (even with the screen off) and the bell rings at the end.

Needs ffmpeg with libopus on PATH. No Python packages required.
"""
import math, os, struct, subprocess, wave

RATE = 48000
SILENCE_S = 7200          # 120 minutes: the longest session
BELL_S = 11.0             # length of the bell tail
OUT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP_WAV = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bell.wav')
OUT = os.path.join(OUT_DIR, 'sit-bell-v1.ogg')

# Singing-bowl partials: (frequency ratio, relative amplitude, decay time in s, beat Hz)
F0 = 196.0  # G3: low and warm
PARTIALS = [
    (1.000, 1.00, 9.0, 0.35),
    (2.756, 0.42, 5.5, 0.80),
    (5.404, 0.16, 3.2, 1.30),
    (8.933, 0.05, 1.8, 1.90),
]
ATTACK_S = 0.06            # soft mallet: no click
PEAK = 0.50                # about -6 dBFS: present but not startling


def bell_samples():
    n = int(BELL_S * RATE)
    out = [0.0] * n
    for ratio, amp, decay, beat in PARTIALS:
        f = F0 * ratio
        # two slightly detuned components give the slow "wah" beating of a real bowl
        f1, f2 = f - beat / 2, f + beat / 2
        w1, w2 = 2 * math.pi * f1 / RATE, 2 * math.pi * f2 / RATE
        k = 1.0 / (decay * RATE)
        for i in range(n):
            env = math.exp(-i * k)
            out[i] += amp * env * 0.5 * (math.sin(w1 * i) + math.sin(w2 * i + 0.7))
    # raised-cosine attack and a final fade so nothing clicks
    a = int(ATTACK_S * RATE)
    for i in range(a):
        out[i] *= 0.5 - 0.5 * math.cos(math.pi * i / a)
    f = int(1.0 * RATE)
    for i in range(f):
        out[n - f + i] *= 0.5 + 0.5 * math.cos(math.pi * i / f)
    peak = max(abs(s) for s in out) or 1.0
    return [s * PEAK / peak for s in out]


def write_wav(path, samples):
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b''.join(struct.pack('<h', max(-32767, min(32767, int(s * 32767)))) for s in samples))


write_wav(TMP_WAV, bell_samples())
subprocess.run([
    'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', f'anullsrc=r={RATE}:cl=mono:d={SILENCE_S}',
    '-i', TMP_WAV,
    '-filter_complex', '[0][1]concat=n=2:v=0:a=1',
    '-c:a', 'libopus', '-b:a', '64k', '-vbr', 'on', '-application', 'audio',
    OUT,
], check=True)
os.remove(TMP_WAV)
print('wrote', OUT, os.path.getsize(OUT), 'bytes')
