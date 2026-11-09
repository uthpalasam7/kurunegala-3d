#!/usr/bin/env python3
"""One-time data pipeline for the Kurunegala scene. Standard library only.

Downloads elevation tiles (Mapzen Terrarium on AWS) and OpenStreetMap features,
then writes data/terrain.bin and data/scene.json. Raw downloads are cached in
tools/.cache. The website itself never contacts these services.

Run from the project root:  python3 -I tools/fetch_data.py
"""
import json, math, os, random, struct, urllib.parse, urllib.request, zlib
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'tools', '.cache')
OUT = os.path.join(ROOT, 'data')
os.makedirs(CACHE, exist_ok=True)
os.makedirs(OUT, exist_ok=True)

LAT0, LON0 = 7.4900, 80.3645   # scene origin, between the tower, lake and rock
HALF = 2600.0                  # metres from origin to the edge of the detailed area
N = 513                        # detailed terrain grid vertices per side
OUTER_HALF = 24000.0
OUTER_N = 257
M_LAT = 110574.0
M_LON = 111320.0 * math.cos(math.radians(LAT0))
UA = {'User-Agent': 'kurunegala-3d-model/1.0'}


def project(lat, lon):
    """Return scene metres: x east, z south."""
    return (lon - LON0) * M_LON, -(lat - LAT0) * M_LAT


def unproject(x, z):
    return LAT0 - z / M_LAT, LON0 + x / M_LON


# --- PNG / elevation ---------------------------------------------------------
def decode_png(raw):
    pos, idat, w, h, depth, ctype, interlace = 8, bytearray(), 0, 0, 0, 0, 0
    while pos < len(raw):
        size, kind = struct.unpack('>I4s', raw[pos:pos + 8])
        body = raw[pos + 8:pos + 8 + size]
        if kind == b'IHDR':
            w, h, depth, ctype, _, _, interlace = struct.unpack('>IIBBBBB', body)
        elif kind == b'IDAT':
            idat += body
        pos += size + 12
    if depth != 8 or ctype not in (2, 6) or interlace:
        raise ValueError('unsupported PNG')
    bpp = 3 if ctype == 2 else 4
    data, stride, prev, rows, p = zlib.decompress(bytes(idat)), w * bpp, bytearray(w * bpp), [], 0
    for _ in range(h):
        f, line = data[p], bytearray(data[p + 1:p + 1 + stride])
        p += stride + 1
        for i in range(stride):
            a = line[i - bpp] if i >= bpp else 0
            b = prev[i]
            c = prev[i - bpp] if i >= bpp else 0
            if f == 1: line[i] = (line[i] + a) & 255
            elif f == 2: line[i] = (line[i] + b) & 255
            elif f == 3: line[i] = (line[i] + (a + b) // 2) & 255
            elif f == 4:
                q = a + b - c
                pa, pb, pc = abs(q - a), abs(q - b), abs(q - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append([line[i] * 256 + line[i + 1] + line[i + 2] / 256 - 32768 for i in range(0, stride, bpp)])
        prev = line
    return rows


class Elevation:
    def __init__(self, z):
        self.z, self.tiles = z, {}

    def tile(self, tx, ty):
        key = (tx, ty)
        if key not in self.tiles:
            path = os.path.join(CACHE, f'terrarium_{self.z}_{tx}_{ty}.png')
            if not os.path.exists(path):
                url = f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{self.z}/{tx}/{ty}.png'
                with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                    open(path, 'wb').write(r.read())
            self.tiles[key] = decode_png(open(path, 'rb').read())
        return self.tiles[key]

    def px(self, ix, iy):
        tx, ty = ix // 256, iy // 256
        return self.tile(tx, ty)[iy % 256][ix % 256]

    def sample(self, lat, lon):
        n = 2 ** self.z * 256
        fx = (lon + 180) / 360 * n - .5
        s = math.radians(lat)
        fy = (1 - math.log(math.tan(s) + 1 / math.cos(s)) / math.pi) / 2 * n - .5
        ix, iy = math.floor(fx), math.floor(fy)
        tx, ty = fx - ix, fy - iy
        a, b = self.px(ix, iy) * (1 - tx) + self.px(ix + 1, iy) * tx, self.px(ix, iy + 1) * (1 - tx) + self.px(ix + 1, iy + 1) * tx
        return a * (1 - ty) + b * ty


def blur(g, size, radius):
    """Separable box blur, applied in place."""
    for axis in (0, 1):
        src = g[:]
        for j in range(size):
            for i in range(size):
                total, count = 0, 0
                for k in range(-radius, radius + 1):
                    u, v = (i + k, j) if axis == 0 else (i, j + k)
                    if 0 <= u < size and 0 <= v < size:
                        total += src[v * size + u]
                        count += 1
                g[j * size + i] = total / count


def value_noise(x, z, seed=0):
    def r(i, j):
        v = math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453
        return v - math.floor(v)
    i, j = math.floor(x), math.floor(z)
    u, v = x - i, z - j
    u, v = u * u * (3 - 2 * u), v * v * (3 - 2 * v)
    return (r(i, j) * (1 - u) + r(i + 1, j) * u) * (1 - v) + (r(i, j + 1) * (1 - u) + r(i + 1, j + 1) * u) * v


# --- OSM ---------------------------------------------------------------------
def load_osm():
    path = os.path.join(CACHE, 'osm.json')
    if not os.path.exists(path):
        q = ('[out:json][timeout:120];(way(7.455,80.335,7.52,80.40);'
             'node["amenity"="clock"](7.455,80.335,7.52,80.40);'
             'node["amenity"="place_of_worship"](7.455,80.335,7.52,80.40););(._;>;);out body;')
        data = urllib.parse.urlencode({'data': q}).encode()
        with urllib.request.urlopen(urllib.request.Request('https://overpass-api.de/api/interpreter', data, UA), timeout=200) as r:
            open(path, 'wb').write(r.read())
    return json.load(open(path))


def rasterize(poly, mask, value=1):
    """Scanline fill of a polygon given in scene metres onto an N*N grid."""
    cell = 2 * HALF / (N - 1)
    pts = [((x + HALF) / cell, (z + HALF) / cell) for x, z in poly]
    zs = [p[1] for p in pts]
    for j in range(max(0, math.ceil(min(zs))), min(N - 1, math.floor(max(zs))) + 1):
        xs = []
        for (ax, az), (bx, bz) in zip(pts, pts[1:] + pts[:1]):
            if (az <= j < bz) or (bz <= j < az):
                xs.append(ax + (j - az) / (bz - az) * (bx - ax))
        xs.sort()
        for a, b in zip(xs[::2], xs[1::2]):
            for i in range(max(0, math.ceil(a)), min(N - 1, math.floor(b)) + 1):
                mask[j * N + i] = value


def chamfer(mask):
    """Approximate distance, in cells, from cells where mask is 0."""
    inf = 1e9
    d = [0.0 if not m else inf for m in mask]
    for j in range(N):
        for i in range(N):
            k = j * N + i
            if i: d[k] = min(d[k], d[k - 1] + 1)
            if j:
                d[k] = min(d[k], d[k - N] + 1)
                if i: d[k] = min(d[k], d[k - N - 1] + 1.41)
                if i < N - 1: d[k] = min(d[k], d[k - N + 1] + 1.41)
    for j in range(N - 1, -1, -1):
        for i in range(N - 1, -1, -1):
            k = j * N + i
            if i < N - 1: d[k] = min(d[k], d[k + 1] + 1)
            if j < N - 1:
                d[k] = min(d[k], d[k + N] + 1)
                if i < N - 1: d[k] = min(d[k], d[k + N + 1] + 1.41)
                if i: d[k] = min(d[k], d[k + N - 1] + 1.41)
    return d


def r1(v):
    return round(v, 1)


def main():
    osm = load_osm()['elements']
    nodes = {e['id']: e for e in osm if e['type'] == 'node'}
    ways = [e for e in osm if e['type'] == 'way']

    def geom(w):
        return [project(nodes[n]['lat'], nodes[n]['lon']) for n in w['nodes'] if n in nodes]

    def inside(x, z, m=0):
        return abs(x) <= HALF + m and abs(z) <= HALF + m

    print('Sampling elevation...')
    fine, coarse = Elevation(14), Elevation(11)
    cell = 2 * HALF / (N - 1)
    h = [0.0] * (N * N)
    for j in range(N):
        for i in range(N):
            h[j * N + i] = fine.sample(*unproject(-HALF + i * cell, -HALF + j * cell))
    blur(h, N, 2)

    oc = 2 * OUTER_HALF / (OUTER_N - 1)
    outer = [0.0] * (OUTER_N * OUTER_N)
    for j in range(OUTER_N):
        for i in range(OUTER_N):
            outer[j * OUTER_N + i] = coarse.sample(*unproject(-OUTER_HALF + i * oc, -OUTER_HALF + j * oc))
    blur(outer, OUTER_N, 1)

    def outer_at(x, z):
        fx, fz = (x + OUTER_HALF) / oc, (z + OUTER_HALF) / oc
        i, j = min(int(fx), OUTER_N - 2), min(int(fz), OUTER_N - 2)
        u, v = fx - i, fz - j
        o = outer
        return (o[j * OUTER_N + i] * (1 - u) + o[j * OUTER_N + i + 1] * u) * (1 - v) + (o[(j + 1) * OUTER_N + i] * (1 - u) + o[(j + 1) * OUTER_N + i + 1] * u) * v

    # Ease the edge of the detailed area into the surrounding low-resolution terrain.
    for j in range(N):
        for i in range(N):
            e = min(i, j, N - 1 - i, N - 1 - j) / 14
            if e < 1:
                t = e * e * (3 - 2 * e)
                k = j * N + i
                h[k] = h[k] * t + outer_at(-HALF + i * cell, -HALF + j * cell) * (1 - t)

    print('Rocks and lakes...')
    rocks, lakes = [], []
    rock_mask = [0.0] * (N * N)
    names = {}
    for w in ways:
        t = w.get('tags', {})
        if t.get('natural') in ('bare_rock', 'rock') and len(w['nodes']) > 3:
            p = geom(w)
            if any(inside(x, z) for x, z in p):
                rocks.append({'name': t.get('name'), 'p': [[r1(x), r1(z)] for x, z in p]})
                rasterize(p, rock_mask, 1.0)
                if t.get('name'):
                    names[t['name']] = p
    blur(rock_mask, N, 1)
    for j in range(N):
        for i in range(N):
            k = j * N + i
            m = rock_mask[k]
            if m > 0:
                x, z = i * cell, j * cell
                ridges = 1 - abs(value_noise(x / 48, z / 48, 3) * 2 - 1)
                fine_ridges = 1 - abs(value_noise(x / 19, z / 19, 7) * 2 - 1)
                h[k] += m * m * (5 + ridges * 3.5 + fine_ridges * 1.3)

    for w in ways:
        t = w.get('tags', {})
        if t.get('natural') != 'water' and t.get('landuse') != 'reservoir':
            continue
        p = geom(w)
        if len(p) < 4 or not any(inside(x, z) for x, z in p):
            continue
        mask = [0] * (N * N)
        rasterize(p, mask)
        idx = [k for k, m in enumerate(mask) if m]
        if len(idx) < 12:
            continue
        level = sorted(h[k] for k in idx)[len(idx) // 2]
        inner = chamfer(mask)
        outer_d = chamfer([0 if m else 1 for m in mask])
        for k in range(N * N):
            if mask[k]:
                h[k] = level - .7 - min(4.5, inner[k] * cell * .05)
            elif outer_d[k] < 6:
                f = outer_d[k] / 6
                bank = level + .55 + outer_d[k] * .18
                h[k] = max(h[k], bank) if f > .35 else bank
        cells = []
        for j in range(N - 1):
            run = None
            for i in range(N - 1):
                near = outer_d[j * N + i] < 2.5 or mask[j * N + i]
                if near:
                    if run is None: run = i
                elif run is not None:
                    cells.append([j, run, i]); run = None
            if run is not None:
                cells.append([j, run, N - 1])
        lakes.append({'name': t.get('name'), 'level': round(level, 2), 'p': [[r1(x), r1(z)] for x, z in p], 'cells': cells})

    print('Roads, land use, buildings...')
    road_w = {'motorway': 15, 'trunk': 11, 'trunk_link': 7, 'primary': 10, 'primary_link': 7, 'secondary': 9,
              'tertiary': 8, 'unclassified': 6, 'residential': 5, 'living_street': 5, 'service': 3.5, 'motorway_link': 8,
              'road': 5, 'track': 2.5, 'path': 1.6, 'footway': 1.6, 'steps': 1.6}
    roads, landuse = [], []
    commercial = [0] * (N * N)
    for w in ways:
        t = w.get('tags', {})
        if t.get('highway') in road_w:
            p = geom(w)
            if any(inside(x, z, 40) for x, z in p):
                oneway = t.get('oneway') in ('yes', '1', '-1') or t['highway'] in ('motorway', 'motorway_link')
                if t.get('oneway') == '-1':
                    p = p[::-1]
                roads.append({'c': t['highway'], 'w': road_w[t['highway']], 'o': 1 if oneway else 0, 'p': [[r1(x), r1(z)] for x, z in p]})
        kind = t.get('landuse') or t.get('leisure') or (t.get('natural') if t.get('natural') in ('wood', 'grassland') else None)
        if kind and kind != 'reservoir' and len(w['nodes']) > 3:
            p = geom(w)
            if any(inside(x, z, 40) for x, z in p):
                landuse.append({'t': kind, 'p': [[r1(x), r1(z)] for x, z in p]})
                if kind in ('retail', 'commercial', 'civic_admin', 'industrial'):
                    rasterize(p, commercial)

    tower = next(e for e in osm if e['type'] == 'node' and e.get('tags', {}).get('amenity') == 'clock')
    tx, tz = project(tower['lat'], tower['lon'])
    statue = next(e for e in osm if e['type'] == 'node' and 'Buddha Statue' in e.get('tags', {}).get('name', ''))
    sx, sz = project(statue['lat'], statue['lon'])

    children = next(e for e in osm if e['type'] == 'node' and e.get('tags', {}).get('name', '').startswith('Children park'))
    park_x, park_z = project(children['lat'], children['lon'])

    def outline(test):
        way = next(e for e in ways if test(e.get('tags', {})))
        return [[r1(x), r1(z)] for x, z in geom(way)]
    near_kovil = lambda w: abs(sum(project(nodes[n]['lat'], nodes[n]['lon'])[0] for n in w['nodes']) / len(w['nodes']) + 370) < 60
    kovil_way = next(w for w in ways if w.get('tags', {}).get('religion') == 'hindu' and near_kovil(w))
    places = {
        'stadium': outline(lambda t: t.get('name') == 'Welagedara Stadium'),
        'mosque': outline(lambda t: t.get('name') == 'Malay Jumma Mosque'),
        'kovil': [[r1(x), r1(z)] for x, z in geom(kovil_way)],
    }

    def height_at(x, z):
        fx, fz = (x + HALF) / cell, (z + HALF) / cell
        i, j = max(0, min(int(fx), N - 2)), max(0, min(int(fz), N - 2))
        u, v = fx - i, fz - j
        return (h[j * N + i] * (1 - u) + h[j * N + i + 1] * u) * (1 - v) + (h[(j + 1) * N + i] * (1 - u) + h[(j + 1) * N + i + 1] * u) * v

    buildings = []
    stats = Counter()
    for w in ways:
        t = w.get('tags', {})
        if 'building' not in t or len(w['nodes']) < 4:
            continue
        p = geom(w)
        if p[0] == p[-1]:
            p = p[:-1]
        cx, cz = sum(a for a, _ in p) / len(p), sum(b for _, b in p) / len(p)
        if not inside(cx, cz, -24) or math.hypot(cx - tx, cz - tz) < 14:
            continue
        area = abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(p, p[1:] + p[:1]))) / 2
        if area < 12:
            continue
        rng = random.Random(w['id'])
        d = math.hypot(cx - tx, cz - tz)
        i, j = int((cx + HALF) / cell), int((cz + HALF) / cell)
        busy = commercial[j * N + i] or d < 420
        try:
            floors = int(float(t.get('building:levels', '')))
            stats['levels tagged'] += 1
        except ValueError:
            if busy:
                floors = rng.choices([1, 2, 3, 4, 5], [1, 4, 4, 2, 1])[0]
            elif d < 1100:
                floors = rng.choices([1, 2, 3], [6, 3, 1])[0]
            else:
                floors = rng.choices([1, 2], [9, 1])[0]
            if area > 700:
                floors = max(floors, 2)
        kind = 2 if t.get('building') in ('temple', 'religious', 'church', 'mosque', 'hindu_temple') else (1 if busy or floors >= 3 else 0)
        stats[('house', 'commercial', 'religious')[kind]] += 1
        buildings.append({'p': [v for a in p for v in (r1(a[0]), r1(a[1]))], 'f': floors, 'k': kind, 's': w['id'] % 1000})

    # Geometry is exported only now, because lakes and rocks altered the heights.
    rock_bytes = bytes(min(255, int(m * 255)) for m in rock_mask)
    with open(os.path.join(OUT, 'terrain.bin'), 'wb') as f:
        f.write(struct.pack(f'<{N * N}f', *h))
        f.write(struct.pack(f'<{OUTER_N * OUTER_N}f', *outer))
        f.write(rock_bytes)

    rock = names['Athugala']
    summit = max(rock, key=lambda a: height_at(*a))
    lake = next(l for l in lakes if l['name'] == 'Kurunegala Lake')
    lx = sum(a for a, _ in lake['p']) / len(lake['p'])
    lz = sum(b for _, b in lake['p']) / len(lake['p'])
    scene = {
        'origin': [LAT0, LON0], 'half': HALF, 'n': N, 'outerHalf': OUTER_HALF, 'outerN': OUTER_N,
        'landmarks': {
            'clock': {'x': r1(tx), 'z': r1(tz), 'y': round(height_at(tx, tz), 2)},
            'statue': {'x': r1(sx), 'z': r1(sz), 'y': round(height_at(sx, sz), 2)},
            'rock': {'x': r1(sum(a for a, _ in rock) / len(rock)), 'z': r1(sum(b for _, b in rock) / len(rock)), 'y': round(height_at(*summit), 2)},
            'lake': {'x': r1(lx), 'z': r1(lz), 'y': lake['level']},
            'park': {'x': r1(park_x), 'z': r1(park_z)},
            'places': places,
        },
        'lakes': lakes, 'rocks': rocks, 'roads': roads, 'landuse': landuse, 'buildings': buildings,
    }
    json.dump(scene, open(os.path.join(OUT, 'scene.json'), 'w'), separators=(',', ':'))

    print('height range', round(min(h), 1), round(max(h), 1))
    print('landmarks', scene['landmarks'])
    print('lakes', [(l['name'], l['level'], len(l['cells'])) for l in lakes])
    print('rocks', len(rocks), 'roads', len(roads), 'landuse', len(landuse), 'buildings', len(buildings), dict(stats))


if __name__ == '__main__':
    main()
