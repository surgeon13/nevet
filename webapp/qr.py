"""QR codes without extra packages (the Pi updates itself from git, so no pip installs).

    import qr
    m = qr.encode("https://example.org/register")    # list of rows, True = dark module
    qr.svg(m)                                           # an <svg> for web pages
    qr.text_lines(m)                                    # rows of ▀▄█ for a terminal (two modules per character)

Byte mode, versions 1-40, error correction L/M/Q/H (M by default, raised to
Q or H when that still fits the same size), the mask with the lowest penalty.
Follows ISO/IEC 18004; the structure follows Project Nayuki's reference
encoder (MIT).
"""

ECL = {"L": (0, 1), "M": (1, 0), "Q": (2, 3), "H": (3, 2)}     # name -> (table row, format bits)

ECC_CODEWORDS_PER_BLOCK = (
    (-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30),
    (-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28),
    (-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30),
    (-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30),
)
NUM_ERROR_CORRECTION_BLOCKS = (
    (-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25),
    (-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49),
    (-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68),
    (-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81),
)


def _bit(x, i):
    return (x >> i) & 1 != 0


def _raw_modules(ver):
    n = (16 * ver + 128) * ver + 64
    if ver >= 2:
        na = ver // 7 + 2
        n -= (25 * na - 10) * na - 55
        if ver >= 7:
            n -= 36
    return n


def _data_codewords(ver, row):
    return _raw_modules(ver) // 8 - ECC_CODEWORDS_PER_BLOCK[row][ver] * NUM_ERROR_CORRECTION_BLOCKS[row][ver]


def _rs_mul(x, y):
    z = 0
    for i in reversed(range(8)):
        z = (z << 1) ^ ((z >> 7) * 0x11D)
        z ^= ((y >> i) & 1) * x
    return z


def _rs_divisor(degree):
    result = [0] * (degree - 1) + [1]
    root = 1
    for _ in range(degree):
        for j in range(degree):
            result[j] = _rs_mul(result[j], root)
            if j + 1 < degree:
                result[j] ^= result[j + 1]
        root = _rs_mul(root, 0x02)
    return result


def _rs_remainder(data, divisor):
    result = [0] * len(divisor)
    for b in data:
        factor = b ^ result.pop(0)
        result.append(0)
        for i, coef in enumerate(divisor):
            result[i] ^= _rs_mul(coef, factor)
    return result


class _Grid:
    def __init__(self, ver):
        self.ver, self.size = ver, ver * 4 + 17
        self.m = [[False] * self.size for _ in range(self.size)]
        self.fn = [[False] * self.size for _ in range(self.size)]

    def set_fn(self, x, y, dark):
        self.m[y][x] = dark
        self.fn[y][x] = True

    def alignment_positions(self):
        if self.ver == 1:
            return []
        na = self.ver // 7 + 2
        step = (self.ver * 8 + na * 3 + 5) // (na * 4 - 4) * 2
        return list(reversed([self.size - 7 - i * step for i in range(na - 1)] + [6]))

    def draw_function_patterns(self):
        s = self.size
        for i in range(s):
            self.set_fn(6, i, i % 2 == 0)
            self.set_fn(i, 6, i % 2 == 0)
        for cx, cy in ((3, 3), (s - 4, 3), (3, s - 4)):                 # finders with their white separators
            for dy in range(-4, 5):
                for dx in range(-4, 5):
                    x, y = cx + dx, cy + dy
                    if 0 <= x < s and 0 <= y < s:
                        d = max(abs(dx), abs(dy))
                        self.set_fn(x, y, d not in (2, 4))
        pos = self.alignment_positions()
        last = len(pos) - 1
        for i, a in enumerate(pos):
            for j, b in enumerate(pos):
                if (i, j) in ((0, 0), (0, last), (last, 0)):
                    continue
                for dy in range(-2, 3):
                    for dx in range(-2, 3):
                        self.set_fn(a + dx, b + dy, max(abs(dx), abs(dy)) != 1)
        self.draw_format(0, 0)                                          # reserve; drawn for real later
        if self.ver >= 7:
            rem = self.ver
            for _ in range(12):
                rem = (rem << 1) ^ ((rem >> 11) * 0x1F25)
            bits = self.ver << 12 | rem
            for i in range(18):
                a, b = s - 11 + i % 3, i // 3
                self.set_fn(a, b, _bit(bits, i))
                self.set_fn(b, a, _bit(bits, i))

    def draw_format(self, fmt_bits, mask):
        data = fmt_bits << 3 | mask
        rem = data
        for _ in range(10):
            rem = (rem << 1) ^ ((rem >> 9) * 0x537)
        bits = (data << 10 | rem) ^ 0x5412
        s = self.size
        for i in range(6):
            self.set_fn(8, i, _bit(bits, i))
        self.set_fn(8, 7, _bit(bits, 6))
        self.set_fn(8, 8, _bit(bits, 7))
        self.set_fn(7, 8, _bit(bits, 8))
        for i in range(9, 15):
            self.set_fn(14 - i, 8, _bit(bits, i))
        for i in range(8):
            self.set_fn(s - 1 - i, 8, _bit(bits, i))
        for i in range(8, 15):
            self.set_fn(8, s - 15 + i, _bit(bits, i))
        self.set_fn(8, s - 8, True)

    def draw_codewords(self, data):
        s, i, n = self.size, 0, len(data) * 8
        right = s - 1
        while right >= 1:
            if right == 6:
                right = 5
            for vert in range(s):
                for j in range(2):
                    x = right - j
                    upward = ((right + 1) & 2) == 0
                    y = s - 1 - vert if upward else vert
                    if not self.fn[y][x] and i < n:
                        self.m[y][x] = _bit(data[i >> 3], 7 - (i & 7))
                        i += 1
            right -= 2

    def apply_mask(self, mask):
        f = (lambda x, y: (x + y) % 2 == 0, lambda x, y: y % 2 == 0, lambda x, y: x % 3 == 0,
             lambda x, y: (x + y) % 3 == 0, lambda x, y: (x // 3 + y // 2) % 2 == 0,
             lambda x, y: x * y % 2 + x * y % 3 == 0, lambda x, y: (x * y % 2 + x * y % 3) % 2 == 0,
             lambda x, y: ((x + y) % 2 + x * y % 3) % 2 == 0)[mask]
        for y in range(self.size):
            for x in range(self.size):
                if not self.fn[y][x] and f(x, y):
                    self.m[y][x] = not self.m[y][x]

    def penalty(self):
        s, m, score = self.size, self.m, 0
        lines = m + [[m[y][x] for y in range(s)] for x in range(s)]
        for line in lines:                                              # runs of five or more
            run, prev = 0, None
            for v in line:
                if v == prev:
                    run += 1
                else:
                    if run >= 5:
                        score += run - 2
                    run, prev = 1, v
            if run >= 5:
                score += run - 2
            padded = [False] * 4 + line + [False] * 4                   # finder-like 1:1:3:1:1 with light around
            for i in range(len(padded) - 10):
                w = padded[i:i + 11]
                if w == [False] * 4 + [True, False, True, True, True, False, True] or \
                   w == [True, False, True, True, True, False, True] + [False] * 4:
                    score += 40
        for y in range(s - 1):                                          # 2x2 blocks
            for x in range(s - 1):
                if m[y][x] == m[y][x + 1] == m[y + 1][x] == m[y + 1][x + 1]:
                    score += 3
        dark = sum(sum(r) for r in m)
        total = s * s
        k = (abs(dark * 20 - total * 10) + total - 1) // total - 1
        return score + max(0, k) * 10


def encode(text, ecl="M", boost=True, min_version=1):
    """The QR code for text (UTF-8 bytes) as rows of booleans (True = dark), without the quiet zone."""
    data = text.encode("utf-8") if isinstance(text, str) else bytes(text)
    row, fmt = ECL[ecl]
    for ver in range(min_version, 41):
        cap = _data_codewords(ver, row) * 8
        need = 4 + (8 if ver <= 9 else 16) + len(data) * 8
        if need <= cap:
            break
    else:
        raise ValueError("Too long for a QR code")
    if boost:                                                           # more error correction if it still fits
        for name in ("M", "Q", "H"):
            r2, f2 = ECL[name]
            if r2 > row and need <= _data_codewords(ver, r2) * 8:
                row, fmt = r2, f2
        cap = _data_codewords(ver, row) * 8
    bits = []

    def put(val, n):
        bits.extend((val >> i) & 1 for i in reversed(range(n)))
    put(0b0100, 4)
    put(len(data), 8 if ver <= 9 else 16)
    for b in data:
        put(b, 8)
    put(0, min(4, cap - len(bits)))
    put(0, (-len(bits)) % 8)
    pad = 0xEC
    while len(bits) < cap:
        put(pad, 8)
        pad ^= 0xEC ^ 0x11
    codewords = [int("".join(map(str, bits[i:i + 8])), 2) for i in range(0, len(bits), 8)]
    # error correction blocks, interleaved
    nblocks, ecclen = NUM_ERROR_CORRECTION_BLOCKS[row][ver], ECC_CODEWORDS_PER_BLOCK[row][ver]
    raw = _raw_modules(ver) // 8
    nshort, shortlen = nblocks - raw % nblocks, raw // nblocks
    div, blocks, k = _rs_divisor(ecclen), [], 0
    for i in range(nblocks):
        dat = codewords[k:k + shortlen - ecclen + (0 if i < nshort else 1)]
        k += len(dat)
        ecc = _rs_remainder(dat, div)
        if i < nshort:
            dat = dat + [0]
        blocks.append(dat + ecc)
    final = [blk[i] for i in range(len(blocks[0])) for j, blk in enumerate(blocks) if i != shortlen - ecclen or j >= nshort]
    g = _Grid(ver)
    g.draw_function_patterns()
    g.draw_codewords(final)
    best, best_score = 0, None
    for mask in range(8):
        g.apply_mask(mask)
        g.draw_format(fmt, mask)
        sc = g.penalty()
        if best_score is None or sc < best_score:
            best, best_score = mask, sc
        g.apply_mask(mask)                                              # undo (XOR)
    g.apply_mask(best)
    g.draw_format(fmt, best)
    return [row_[:] for row_ in g.m]


def with_quiet_zone(m, quiet=4):
    n = len(m) + 2 * quiet
    blank = [False] * n
    return [blank[:] for _ in range(quiet)] + [[False] * quiet + r + [False] * quiet for r in m] + [blank[:] for _ in range(quiet)]


def text_lines(m, quiet=4, big=False):
    """Rows for a terminal, meant to be drawn dark on a light background. Terminal cells are about twice as
    tall as wide, so each character holds two modules on top of each other (▀ top dark, ▄ bottom dark,
    █ both) and the modules come out square. big=True: each module is two full characters on one row,
    the same shape at twice the size, for large screens."""
    q = with_quiet_zone(m, quiet)
    if big:
        return ["".join("██" if v else "  " for v in r) for r in q]
    if len(q) % 2:
        q.append([False] * len(q[0]))
    out = []
    for y in range(0, len(q), 2):
        out.append("".join({(False, False): " ", (True, False): "▀", (False, True): "▄", (True, True): "█"}[(a, b)]
                           for a, b in zip(q[y], q[y + 1])))
    return out


def svg(m, quiet=4, scale=8, dark="#1e2a20", light="#ffffff", title="QR code"):
    """An SVG drawing of the code (one path), for web pages."""
    n = len(m) + 2 * quiet
    path = "".join(f"M{x + quiet},{y + quiet}h1v1h-1z" for y, r in enumerate(m) for x, v in enumerate(r) if v)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n} {n}" width="{n * scale}" height="{n * scale}" '
            f'shape-rendering="crispEdges" role="img" aria-label="{title}"><rect width="{n}" height="{n}" fill="{light}"/>'
            f'<path d="{path}" fill="{dark}"/></svg>')
