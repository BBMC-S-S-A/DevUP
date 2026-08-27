"""
Juan Medina, modelado en 3D y renderizado a sprite.

Es la tubería aprobada, en miniatura: un modelo con volúmenes reales, una luz
direccional real, una cámara en tres cuartos, y un render que sale a 48x64 px.
Lo que llega al juego es la imagen; el motor sigue siendo el lienzo 2D de hoy.

Sustituir esto por Blender no cambia nada aguas abajo: cambia la calidad del
modelo y del sombreado, no el contrato.
"""
from PIL import Image
import math
import os
from collections import Counter

OUT = os.path.dirname(os.path.abspath(__file__))

W, H, SS = 44, 64, 6           # lienzo final y supermuestreo
PITCH = math.radians(22)       # inclinación de la cámara
LIGHT = (-0.55, 0.72, 0.42)    # el sol de la sala, arriba a la izquierda
AMBIENT = 0.60

C = {
    'piel':      (0xf2, 0xb4, 0x88),
    'pielosc':   (0xd0, 0x91, 0x66),
    'pelo':      (0x3a, 0x31, 0x2c),
    'canas':     (0xa8, 0xa3, 0x9e),
    'barba':     (0x4a, 0x3e, 0x36),
    'traje':     (0x44, 0x4e, 0x64),
    'pantalon':  (0x39, 0x41, 0x54),
    'zapato':    (0x22, 0x26, 0x30),
    'camisa':    (0xee, 0xf1, 0xf6),
    'corbata':   (0x0e, 0x11, 0x17),
    'reloj':     (0xc3, 0xcc, 0xda),
    'rojo':      (0xe1, 0x06, 0x00),
    'ojo':       (0x14, 0x11, 0x18),
    'contorno':  (0x0b, 0x0e, 0x14),
}


def norm(v):
    m = math.sqrt(sum(c * c for c in v))
    return tuple(c / m for c in v)


LIGHT = norm(LIGHT)


class Caja:
    """Un volumen del modelo. `pivote`/`giro` es la articulación de la cadera."""

    def __init__(self, centro, tam, color, pivote=None, giro=0.0):
        self.c = centro
        self.t = tam
        self.color = color
        self.pivote = pivote
        self.giro = giro

    def caras(self):
        cx, cy, cz = self.c
        sx, sy, sz = (d / 2 for d in self.t)
        # origen, borde u, borde v, normal
        return [
            ((cx - sx, cy + sy, cz - sz), (2 * sx, 0, 0), (0, 0, 2 * sz), (0, 1, 0)),   # arriba
            ((cx - sx, cy - sy, cz + sz), (2 * sx, 0, 0), (0, 2 * sy, 0), (0, 0, 1)),   # frente
            ((cx - sx, cy - sy, cz - sz), (2 * sx, 0, 0), (0, 2 * sy, 0), (0, 0, -1)),  # espalda
            ((cx + sx, cy - sy, cz - sz), (0, 0, 2 * sz), (0, 2 * sy, 0), (1, 0, 0)),   # derecha
            ((cx - sx, cy - sy, cz - sz), (0, 0, 2 * sz), (0, 2 * sy, 0), (-1, 0, 0)),  # izquierda
            ((cx - sx, cy - sy, cz - sz), (2 * sx, 0, 0), (0, 0, 2 * sz), (0, -1, 0)),  # abajo
        ]


def gira_x(p, a, pivote):
    if a == 0:
        return p
    px, py, pz = pivote
    x, y, z = p[0] - px, p[1] - py, p[2] - pz
    ca, sa = math.cos(a), math.sin(a)
    return (x + px, y * ca - z * sa + py, y * sa + z * ca + pz)


def gira_x_dir(v, a):
    if a == 0:
        return v
    ca, sa = math.cos(a), math.sin(a)
    return (v[0], v[1] * ca - v[2] * sa, v[1] * sa + v[2] * ca)


def gira_y(p, a):
    ca, sa = math.cos(a), math.sin(a)
    return (p[0] * ca + p[2] * sa, p[1], -p[0] * sa + p[2] * ca)


def modelo(paso=0.0):
    """El muñeco. `paso` mueve las piernas desde la cadera, como un esqueleto."""
    a = math.radians(22) * paso
    cadera = (0, 16, 0)
    p = []

    # piernas y zapatos — giran juntos desde la cadera
    for lado, ang in ((-1, a), (1, -a)):
        p.append(Caja((3.4 * lado, 8.5, 0), (5.4, 15, 5.6), C['pantalon'], cadera, ang))
        p.append(Caja((3.4 * lado, 1.7, 1.4), (6.0, 3.4, 8.4), C['zapato'], cadera, ang))

    # torso
    p.append(Caja((0, 24, 0), (15.5, 16, 8.8), C['traje']))
    p.append(Caja((0, 29.6, 4.5), (5.8, 4.6, 0.6), C['camisa']))
    p.append(Caja((0, 25.6, 4.6), (2.0, 8.6, 0.6), C['corbata']))
    p.append(Caja((-4.6, 28.8, 4.7), (1.1, 1.1, 0.4), C['rojo']))          # pin Hytrex

    # brazos, puños y reloj
    for lado in (-1, 1):
        p.append(Caja((9.4 * lado, 25, 0), (3.8, 14, 5.2), C['traje']))
        p.append(Caja((9.4 * lado, 19.0, 0), (4.0, 1.3, 5.4), C['camisa']))
        p.append(Caja((9.4 * lado, 16.6, 0), (4.0, 3.6, 5.4), C['piel']))
    p.append(Caja((9.4, 20.1, 0), (4.2, 1.5, 5.6), C['reloj']))

    # cuello y cabeza — 18 de 52, un tercio del total
    p.append(Caja((0, 33.0, 0), (5.0, 3.0, 5.0), C['pielosc']))
    p.append(Caja((0, 43.0, 0), (16.5, 17.5, 14.5), C['piel']))

    # pelo: casquete arriba, masa por detrás, degradado corto en las sienes
    p.append(Caja((0, 50.4, 0), (17.1, 6.4, 15.1), C['pelo']))
    p.append(Caja((0, 44.5, -2.0), (17.3, 10.0, 11.5), C['pelo']))
    for lado in (-1, 1):
        p.append(Caja((8.4 * lado, 44.5, 1.4), (1.0, 9.0, 9.5), C['pelo']))
    for dx, dz in ((-4.6, -1.5), (-1.4, 2.6), (2.6, -3.2), (5.4, 1.4),
                   (0, -4.6), (-6.0, 3.2), (3.4, 3.8)):
        p.append(Caja((dx, 53.7, dz), (2.0, 0.5, 2.0), C['canas']))

    # barba recortada: mandíbula y patillas; la mejilla se queda en piel
    p.append(Caja((0, 36.6, 4.6), (12.6, 4.4, 6.0), C['barba']))
    for lado in (-1, 1):
        p.append(Caja((7.4 * lado, 39.4, 3.4), (1.8, 7.0, 6.8), C['barba']))
    p.append(Caja((0, 39.6, 6.9), (6.8, 1.6, 1.6), C['barba']))            # bigote

    # cara, sobre el plano frontal de la cabeza
    for lado in (-1, 1):
        p.append(Caja((3.9 * lado, 43.4, 7.4), (2.9, 2.2, 0.4), C['ojo']))
        p.append(Caja((3.9 * lado, 46.2, 7.4), (3.7, 1.1, 0.4), C['pelo']))
    p.append(Caja((0, 41.2, 7.9), (2.2, 3.0, 1.4), C['pielosc']))          # nariz
    p.append(Caja((0, 37.8, 7.5), (4.4, 1.0, 0.4), C['corbata']))          # boca
    return p


def proyecta(p, yaw):
    x, y, z = gira_y(p, yaw)
    ca, sa = math.cos(PITCH), math.sin(PITCH)
    return (x, y * ca - z * sa, y * sa + z * ca)


def sombra(color, normal_mundo):
    lam = max(0.0, sum(a * b for a, b in zip(normal_mundo, LIGHT)))
    k = AMBIENT + (1 - AMBIENT) * lam
    return tuple(min(255, int(c * k)) for c in color)


def dibuja(partes, yaw, escala, ox, oy, w, h):
    buf = [[None] * w for _ in range(h)]
    # Z mayor = más cerca del ojo: nos quedamos con el máximo.
    zbuf = [[-1e9] * w for _ in range(h)]

    for caja in partes:
        pv, gi = caja.pivote, caja.giro
        for origen, eu, ev, n in caja.caras():
            nm = gira_x_dir(n, gi) if gi else n
            nm = gira_y(nm, yaw)
            if nm[2] <= 0.02 and nm[1] <= 0.02:
                # cara que mira hacia atrás en la vista: no aporta
                pass
            col = sombra(caja.color, gira_x_dir(n, gi) if gi else n)

            lu = math.sqrt(sum(c * c for c in eu)) * escala
            lv = math.sqrt(sum(c * c for c in ev)) * escala
            su = max(2, int(lu * 1.6) + 1)
            sv = max(2, int(lv * 1.6) + 1)

            for i in range(su + 1):
                for j in range(sv + 1):
                    u, v = i / su, j / sv
                    pt = (origen[0] + eu[0] * u + ev[0] * v,
                          origen[1] + eu[1] * u + ev[1] * v,
                          origen[2] + eu[2] * u + ev[2] * v)
                    if gi:
                        pt = gira_x(pt, gi, pv)
                    X, Y, Z = proyecta(pt, yaw)
                    sx = int(X * escala + ox)
                    sy = int(-Y * escala + oy)
                    if 0 <= sx < w and 0 <= sy < h and Z > zbuf[sy][sx]:
                        zbuf[sy][sx] = Z
                        buf[sy][sx] = col
    return buf


def encuadre(yaws, w, h):
    """Un solo encuadre para todas las direcciones: si no, el muñeco baila."""
    xs, ys = [], []
    for yaw in yaws:
        for caja in modelo(1.0) + modelo(-1.0):
            cx, cy, cz = caja.c
            sx, sy, sz = (d / 2 for d in caja.t)
            for dx in (-sx, sx):
                for dy in (-sy, sy):
                    for dz in (-sz, sz):
                        pt = (cx + dx, cy + dy, cz + dz)
                        if caja.pivote:
                            pt = gira_x(pt, caja.giro, caja.pivote)
                        X, Y, _ = proyecta(pt, yaw)
                        xs.append(X)
                        ys.append(Y)
    escala = min((w - 2) / (max(xs) - min(xs)), (h - 2) / (max(ys) - min(ys)))
    ox = w / 2 - (max(xs) + min(xs)) / 2 * escala
    oy = h / 2 + (max(ys) + min(ys)) / 2 * escala
    return escala, ox, oy


def reduce(buf, w, h, ss):
    """Bajar de resolución por moda, no por media: conserva el color plano."""
    out = [[None] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            muestras = []
            for j in range(ss):
                for i in range(ss):
                    c = buf[y * ss + j][x * ss + i]
                    if c is not None:
                        muestras.append(c)
            if len(muestras) > ss * ss * 0.42:
                out[y][x] = Counter(muestras).most_common(1)[0][0]
    return out


def contorno(g, w, h):
    src = [row[:] for row in g]
    for y in range(h):
        for x in range(w):
            if src[y][x] is not None:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and src[ny][nx] is not None:
                    g[y][x] = C['contorno']
                    break


def sprite(yaw, paso, escala, ox, oy):
    buf = dibuja(modelo(paso), yaw, escala * SS, ox * SS, oy * SS, W * SS, H * SS)
    g = reduce(buf, W, H, SS)
    contorno(g, W, H)
    return g


def guarda(g, escala_px, ruta):
    img = Image.new('RGBA', (W * escala_px, H * escala_px), (0, 0, 0, 0))
    pix = img.load()
    for y in range(H):
        for x in range(W):
            c = g[y][x]
            if c is None:
                continue
            for j in range(escala_px):
                for i in range(escala_px):
                    pix[x * escala_px + i, y * escala_px + j] = c + (255,)
    img.save(ruta)


YAWS = [math.radians(a) for a in (-26, 64, 154, 244)]
NOMBRES = ('sur', 'este', 'norte', 'oeste')

escala, ox, oy = encuadre(YAWS, W, H)

for nombre, yaw in zip(NOMBRES, YAWS):
    g = sprite(yaw, 0.0, escala, ox, oy)
    guarda(g, 1, f'{OUT}/m_{nombre}_1x.png')
    if nombre == 'sur':
        guarda(g, 8, f'{OUT}/m_sur_8x.png')

for etiqueta, paso in (('a', 1.0), ('b', -1.0)):
    g = sprite(YAWS[0], paso, escala, ox, oy)
    guarda(g, 1, f'{OUT}/m_paso{etiqueta}_1x.png')

print('ok')
