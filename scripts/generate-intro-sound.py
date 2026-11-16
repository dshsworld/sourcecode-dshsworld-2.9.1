"""Original SOLGAE opening sound design: air, low impact and a wide harmonic tail.

No recordings, borrowed melodies, instruments or sample packs are used.
Python/NumPy synthesize the waveforms; ffmpeg encodes the finished stereo cue.
"""
from pathlib import Path
import subprocess
import tempfile
import wave
import numpy as np

RATE = 44100
DURATION = 7.2
t = np.arange(round(RATE * DURATION)) / RATE
rng = np.random.default_rng(270219)
channels = np.zeros((len(t), 2), dtype=np.float64)

def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)

def add(signal, pan=0):
    channels[:, 0] += signal * np.sqrt((1 - pan) / 2)
    channels[:, 1] += signal * np.sqrt((1 + pan) / 2)

def air_band(low, high):
    frequency = np.fft.rfftfreq(len(t), 1 / RATE)
    spectrum = np.fft.rfft(rng.standard_normal(len(t)))
    response = (1 - np.exp(-(frequency / low) ** 2)) * np.exp(-(frequency / high) ** 2)
    response /= np.sqrt(np.maximum(frequency, 80))
    signal = np.fft.irfft(spectrum * response, n=len(t))
    return signal / max(1e-6, signal.std())

# Increasing layers of filtered air follow the camera's forward acceleration.
rise = smooth((t - .15) / .9) * (1 - smooth((t - 3.45) / .55))
pan = .65 * np.sin((t - .5) * 1.25)
add(air_band(120, 2600) * rise * .035, pan)
add(air_band(1700, 7200) * rise * smooth((t - 1.3) / 1.2) * .025, -pan)
add(np.sin(2 * np.pi * 55 * t) * rise * .014)

# Short intake during the pullback, followed by a single soft, broad release.
add(air_band(500, 4200) * np.exp(-((t - 3.43) / .2) ** 2) * .035, -.25)
age = np.maximum(t - 3.85, 0)
active = t >= 3.85
release = (1 - np.exp(-age / .018)) * np.exp(-age / .33) * active
add(air_band(220, 8500) * release * .11, .15)
phase = 2 * np.pi * (48 * age + 19 * .11 * (1 - np.exp(-age / .11)))
add(np.sin(phase) * (1 - np.exp(-age / .012)) * np.exp(-age / .3) * active * .17)

# A sustained chord blooms under the logo; no bell notes or melodic jingle.
bed = smooth(age / .42) * np.exp(-age / 1.65) * active
for i, (frequency, pan) in enumerate([(146.83, -.6), (220, .6), (293.66, -.2), (329.63, .4), (369.99, -.4)]):
    tone = np.zeros(len(t))
    for harmonic, gain in [(1, 1), (2, .24), (3, .09), (4, .035)]:
        drift = .004 * np.sin(2 * np.pi * (.11 + i * .025) * age)
        tone += gain * np.sin(2 * np.pi * frequency * harmonic * age + drift + i * .71)
    add(tone * bed * .035, pan)
add(air_band(2500, 9500) * bed * .009, -.6)
add(air_band(2000, 8500) * bed * .009, .6)

# Wide, irregular reflections keep the bloom spacious without a repeating echo.
dry = channels.copy()
for i, delay in enumerate([.047, .083, .131, .193, .271, .367, .481, .613]):
    shift = round(delay * RATE)
    channels[shift:] += dry[:-shift, ::-1 if i % 2 else 1] * (.12 * np.exp(-delay * 2.4))
channels *= smooth(t / .04)[:, None]
channels *= smooth((DURATION - t) / .65)[:, None]
channels = np.tanh(channels * 1.2)
channels *= .65 / float(np.abs(channels).max())
destination = Path(__file__).resolve().parents[1] / 'public/assets/solgae-intro.mp3'
with tempfile.TemporaryDirectory() as folder:
    wav = Path(folder) / 'intro.wav'
    with wave.open(str(wav), 'wb') as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(RATE)
        output.writeframes((channels * 32767).astype('<i2').tobytes())
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(wav),
                    '-codec:a', 'libmp3lame', '-b:a', '128k', '-map_metadata', '-1', str(destination)], check=True)
print(f'Synthesized {DURATION}s original stereo cue; peak 0.65; {destination.stat().st_size} bytes')
