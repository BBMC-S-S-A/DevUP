"""
Isotipo de Hytrex, reconstruido para el documento.

NO es el archivo original de marca: es una reconstrucción del anillo de
pinceladas a partir del manual, para que el PDF se pueda maquetar. Antes de
enviar el documento fuera conviene sustituirlo por el vector real.

Se generan dos versiones: una a color para la portada sobre blanco, y una muy
clara para la marca de agua del interior.
"""
from PIL import Image, ImageDraw, ImageFilter
import math
import random
import os

OUT = os.path.dirname(os.path.abspath(__file__))
S = 1400                      # lado del lienzo, con margen de sobra
CX = CY = S / 2

ROJO = (225, 6, 0)
NEGRO = (17, 17, 17)
GRIS = (51, 51, 51)
GRIS_CLARO = (102, 102, 102)
BLANCO = (245, 245, 245)


def pincelada(draw, r0, a0, a1, grosor, color, rugosidad=1.0, semilla=0):
    """Una pincelada circular: gruesa en el centro del trazo y afilada al final."""
    rnd = random.Random(semilla)
    pasos = max(60, int(abs(a1 - a0) * r0 / 2))
    for i in range(pasos + 1):
        t = i / pasos
        ang = math.radians(a0 + (a1 - a0) * t)
        # el trazo se afila en los dos extremos
        afilado = math.sin(math.pi * t) ** 0.55
        g = grosor * afilado
        if g < 0.6:
            continue
        r = r0 + rnd.uniform(-rugosidad, rugosidad) * 2.2
        x = CX + math.cos(ang) * r
        y = CY + math.sin(ang) * r
        draw.ellipse([x - g / 2, y - g / 2, x + g / 2, y + g / 2], fill=color)


def construye(paleta):
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    negro, gris, gris_claro, rojo = paleta

    # Anillo exterior fino, casi cerrado
    pincelada(d, 520, 120, 430, 26, gris_claro, 1.6, 11)
    pincelada(d, 496, 150, 400, 18, gris, 1.4, 12)

    # Cuerpo principal: dos trazos gruesos que forman el anillo
    pincelada(d, 430, 105, 400, 96, negro, 1.2, 21)
    pincelada(d, 424, 170, 330, 78, gris, 1.0, 22)

    # El trazo rojo, arriba a la izquierda y bajando por el flanco
    pincelada(d, 452, 168, 300, 62, rojo, 1.1, 31)
    pincelada(d, 486, 196, 258, 30, rojo, 1.3, 32)
    pincelada(d, 410, 210, 292, 22, rojo, 0.9, 33)

    # Trazos interiores que cierran la boca del anillo
    pincelada(d, 356, 130, 415, 44, negro, 1.0, 41)
    pincelada(d, 344, 200, 350, 30, gris, 0.9, 42)
    pincelada(d, 372, 260, 400, 16, gris_claro, 1.2, 43)

    # Chispas sueltas del pincel, en el hueco
    rnd = random.Random(7)
    for _ in range(70):
        ang = math.radians(rnd.uniform(20, 110))
        r = rnd.uniform(360, 540)
        g = rnd.uniform(1.5, 6)
        x = CX + math.cos(ang) * r
        y = CY + math.sin(ang) * r
        col = rojo if rnd.random() < 0.35 else gris_claro
        d.ellipse([x - g, y - g, x + g, y + g], fill=col)

    return img.filter(ImageFilter.GaussianBlur(0.6))


# Portada: sobre papel blanco, así que el trazo claro pasa a gris medio.
construye((NEGRO, GRIS, GRIS_CLARO, ROJO)).save(f'{OUT}/hytrex_isotipo.png')

# Marca de agua: el mismo trazo, apenas insinuado.
agua = construye(((238, 238, 238), (241, 241, 241), (244, 244, 244), (251, 242, 241)))
agua.save(f'{OUT}/hytrex_agua.png')

print('ok')
