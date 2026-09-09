# -*- coding: utf-8 -*-
"""Compone la propuesta de arquitectura de DevUP en PDF.

    py -m pip install reportlab
    py build_arquitectura.py

POR QUÉ NO REUTILIZA `portada()` NI `interior()` DE `build_pdf.py`, aunque son
casi iguales: las dos funciones llevan cableado el subtítulo y el pie del
documento, así que compartirlas exigía parametrizarlas — es decir, tocar el
generador de la propuesta de desarrollo, que es un PDF que ya se manda fuera.
Cambiar un documento entregado para añadir otro es un riesgo sin beneficio, así
que aquí se duplican las sesenta líneas de portada y pie, y se importa de él
todo lo que sí es común y no tiene texto dentro: las fuentes ya registradas, la
paleta, los estilos de párrafo, el filete rojo y el constructor de tablas.

Si algún día hay un tercer documento, entonces sí toca extraer una plantilla
compartida: dos copias se vigilan, tres divergen.
"""
import os

from reportlab.lib.pagesizes import A4
from reportlab.lib.enums import TA_CENTER
from reportlab.pdfbase import pdfmetrics
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, PageBreak, NextPageTemplate)

# `build_pdf` registra las fuentes al importarse y expone la paleta, los
# estilos y los ayudantes. No ejecuta nada: su `construye()` vive detrás de
# `if __name__ == '__main__'`.
from build_pdf import (E, ROJO, NEGRO, GRIS, GRIS_MEDIO, GRIS_LINEA,
                       MARGEN, ANCHO, Regla, tabla)
from contenido_arquitectura import BLOQUES

D = os.path.dirname(os.path.abspath(__file__))
W, H = A4

SUBTITULO = 'Propuesta de arquitectura'
LEMA = 'Por qué se siente como catorce cosas pegadas, y qué lo arregla'
PIE = 'DevUP · Propuesta de arquitectura'
# Directo a `docs/`, que es donde viven los PDF que se commitean —
# `build_pdf.py` escribe al lado del generador y luego hay que moverlo a mano.
SALIDA = f'{D}/../DevUP-Propuesta-de-Arquitectura.pdf'

# Las tres cifras del diagnóstico, en la portada. Son el argumento entero
# resumido, y contadas sobre el repositorio.
CIFRAS = [
    ('46 / 6', 'tablas de dominio, y seis claves foráneas que cruzan dominios'),
    ('0', 'columnas relacionales en la tabla de tareas, fuera de tareas'),
    ('0', 'llamadas a un modelo en todo el repositorio'),
]


def portada(canv, doc):
    canv.saveState()
    iso = f'{D}/hytrex_isotipo.png'
    lado = 118
    canv.drawImage(iso, (W - lado) / 2, H - 196, lado, lado,
                   mask='auto', preserveAspectRatio=True)

    # Igual que en la otra portada: letra a letra, porque `charSpace` deja un
    # hueco detrás del último carácter y descuadra la X roja.
    def tracked(texto, fuente, tam, track, y, color_de):
        anchos = [pdfmetrics.stringWidth(c, fuente, tam) for c in texto]
        total = sum(anchos) + track * (len(texto) - 1)
        x = (W - total) / 2
        canv.setFont(fuente, tam)
        for c, a in zip(texto, anchos):
            canv.setFillColor(color_de(c))
            canv.drawString(x, y, c)
            x += a + track

    y0 = H - 238
    tracked('HYTREX', 'Raleway-Xb', 28, 9, y0,
            lambda c: ROJO if c == 'X' else NEGRO)
    tracked('CLARITY. PURPOSE. IMPACT.', 'Raleway-Md', 7.2, 3.4, y0 - 16,
            lambda c: GRIS_MEDIO)

    canv.setFillColor(ROJO)
    canv.rect((W - 46) / 2, H - 318, 46, 2.6, stroke=0, fill=1)

    canv.setFillColor(NEGRO)
    canv.setFont('Raleway-Xb', 36)
    canv.drawCentredString(W / 2, H - 374, 'DevUP')
    canv.setFont('Raleway-Md', 14)
    canv.setFillColor(GRIS)
    canv.drawCentredString(W / 2, H - 400, SUBTITULO)

    canv.setFont('Raleway', 9.6)
    canv.setFillColor(GRIS_MEDIO)
    canv.drawCentredString(W / 2, H - 426, LEMA)

    # Las tres cifras, repartidas en la mitad baja. Sin recuadros: son una
    # lectura, no tarjetas.
    ancho_col = ANCHO / 3
    for i, (cifra, pie) in enumerate(CIFRAS):
        cx = MARGEN + ancho_col * i + ancho_col / 2
        canv.setFillColor(NEGRO)
        canv.setFont('Raleway-Xb', 25)
        canv.drawCentredString(cx, 300, cifra)
        canv.setFillColor(GRIS_MEDIO)
        canv.setFont('Raleway', 7.4)
        # El pie va a dos líneas: se parte por la mitad de las palabras.
        palabras = pie.split()
        mitad = len(palabras) // 2 + len(palabras) % 2
        canv.drawCentredString(cx, 284, ' '.join(palabras[:mitad]))
        canv.drawCentredString(cx, 274, ' '.join(palabras[mitad:]))

    canv.setFillColor(GRIS_LINEA)
    canv.rect(MARGEN, 246, ANCHO, 0.6, stroke=0, fill=1)

    canv.setFont('Raleway-Sb', 8)
    canv._charSpace = 2.4
    canv.setFillColor(ROJO)
    canv.drawCentredString(W / 2, 210, 'DIAGNÓSTICO SOBRE EL REPOSITORIO')
    canv._charSpace = 0
    canv.setFont('Raleway', 9.2)
    canv.setFillColor(GRIS)
    canv.drawCentredString(W / 2, 190,
                           '46 tablas y 27 migraciones recorridas · auditoría de las')
    canv.drawCentredString(W / 2, 178,
                           'catorce pantallas probada a mano · 9 de septiembre de 2026')

    canv.setFillColor(GRIS_LINEA)
    canv.rect(MARGEN, 118, ANCHO, 0.6, stroke=0, fill=1)
    canv.setFont('Raleway', 8.4)
    canv.setFillColor(GRIS_MEDIO)
    canv.drawString(MARGEN, 102, 'Hytrex · Ingeniería digital con propósito')
    canv.drawRightString(W - MARGEN, 102, 'Documento interno · versión 1')
    canv.restoreState()


def interior(canv, doc):
    canv.saveState()
    lado = 330
    canv.drawImage(f'{D}/hytrex_agua.png', (W - lado) / 2, (H - lado) / 2 - 10,
                   lado, lado, mask='auto', preserveAspectRatio=True)

    canv.setFillColor(GRIS_LINEA)
    canv.rect(MARGEN, 46, ANCHO, 0.5, stroke=0, fill=1)
    canv.setFont('Raleway', 7.6)
    canv.setFillColor(GRIS_MEDIO)
    canv.drawString(MARGEN, 33, PIE)
    canv.setFont('Raleway-Sb', 7.6)
    canv.setFillColor(NEGRO)
    canv.drawRightString(W - MARGEN, 33, str(doc.page - 1))
    canv.setFillColor(ROJO)
    canv.rect(W - MARGEN - 20, 46, 20, 0.5, stroke=0, fill=1)
    canv.restoreState()


def construye():
    doc = BaseDocTemplate(SALIDA, pagesize=A4,
                          leftMargin=MARGEN, rightMargin=MARGEN,
                          topMargin=64, bottomMargin=62,
                          title='DevUP · Propuesta de arquitectura',
                          author='Hytrex')
    marco_portada = Frame(MARGEN, 62, ANCHO, H - 126, id='portada')
    marco = Frame(MARGEN, 62, ANCHO, H - 126, id='cuerpo')
    doc.addPageTemplates([
        PageTemplate(id='portada', frames=[marco_portada], onPage=portada),
        PageTemplate(id='cuerpo', frames=[marco], onPage=interior),
    ])

    # Sin esto, el dibujo de la portada se repite en cada página.
    hist = [NextPageTemplate('cuerpo'), PageBreak()]

    for b in BLOQUES:
        k = b[0]
        if k == 'pagebreak':
            hist.append(PageBreak())
        elif k == 'h1':
            hist.append(Paragraph(b[1], E['h1']))
            hist.append(Regla())
        elif k == 'kicker':
            hist.append(Paragraph(b[1].upper(), E['kicker']))
        elif k in ('h2', 'h3'):
            hist.append(Paragraph(b[1], E[k]))
        elif k == 'p':
            hist.append(Paragraph(b[1], E['p']))
        elif k == 'quote':
            hist.append(Spacer(1, 3))
            hist.append(Paragraph('«' + b[1] + '»', E['quote']))
            hist.append(Spacer(1, 3))
        elif k == 'bullets':
            for item in b[1]:
                hist.append(Paragraph(item, E['bullet'], bulletText='—'))
        elif k == 'table':
            hist.append(Spacer(1, 5))
            hist.append(tabla(b[1]))
            hist.append(Spacer(1, 10))
        else:
            raise SystemExit(f'bloque desconocido: {k}')

    doc.build(hist)
    print(f'ok · {os.path.basename(SALIDA)}')


if __name__ == '__main__':
    construye()
