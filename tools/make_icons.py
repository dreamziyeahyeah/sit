"""Generates the app icons: a few ruler ticks and a centre line on Henry's dark paper.
Dark and muted so the Android launch screen blends into the app. No dependencies."""
import os, struct, zlib

BG = (31, 29, 26)        # the app's dark background
TICK = (85, 80, 74)
LINE = (143, 137, 122)

def png(path, size, scale):
    # scale < 1 keeps the artwork inside the maskable safe zone
    s = size * scale
    cx, cy = size / 2, size / 2
    step = s * 0.075
    ticks = []
    for k in range(-4, 5):
        x = cx + k * step
        h = s * (0.20 if k % 5 == 0 else 0.13 if k % 2 == 0 else 0.08)
        ticks.append((x, cy - s * 0.10, h))
    tw = max(1.0, size * 0.012)
    lw = max(1.5, size * 0.02)
    line_top, line_bot = cy - s * 0.22, cy + s * 0.18

    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            col = BG
            # supersample 3x3 for soft edges
            hit_t = hit_l = 0
            for sy in range(3):
                for sx in range(3):
                    px, py = x + (sx + .5) / 3, y + (sy + .5) / 3
                    if abs(px - cx) < lw / 2 and line_top <= py <= line_bot:
                        hit_l += 1
                        continue
                    for tx, ty, th in ticks:
                        if abs(px - tx) < tw / 2 and ty <= py <= ty + th:
                            hit_t += 1
                            break
            if hit_t or hit_l:
                a_t, a_l = hit_t / 9, hit_l / 9
                col = tuple(round(BG[i] * (1 - a_t - a_l) + TICK[i] * a_t + LINE[i] * a_l) for i in range(3))
            raw += bytes(col)

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n'
                + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
                + chunk(b'IEND', b''))

out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'icons')
os.makedirs(out, exist_ok=True)
png(os.path.join(out, 'icon-192.png'), 192, 1.0)
png(os.path.join(out, 'icon-512.png'), 512, 1.0)
png(os.path.join(out, 'icon-maskable-512.png'), 512, 0.8)
print('icons written to', out)
