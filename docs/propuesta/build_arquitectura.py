# -*- coding: utf-8 -*-
"""Compone la propuesta de arquitectura de DevUP sobre la plantilla de Hytrex.

    py -m pip install reportlab pypdf
    py build_arquitectura.py

LA PLANTILLA MANDA, Y NO `build_pdf.py`. La primera versión de este generador
reutilizaba el de la propuesta de desarrollo —A4, Raleway, rojo #E10600— porque
era el único material de marca que había en el repositorio. Después apareció la
plantilla de verdad, `Hytrex-Plantilla-Propuesta-en-blanco.pdf`, y no coincide:
es tamaño Carta, en Helvetica, y su rojo es #E31E24. Este archivo se reescribió
contra ella.

Queda una inconsistencia que no es de este documento y conviene saber que
existe: los PDF ya entregados (`docs/DevUP-Propuesta-de-Desarrollo.pdf` y los
demás) están hechos con el otro criterio. Unificarlos es una decisión de marca,
no una tarea de este generador.

CADA MEDIDA SALE DE LA PLANTILLA, no de un ojo. Se leyeron los flujos de
contenido de sus dos páginas y de ahí vienen los márgenes (68,0315 pt), la
posición del logotipo (92 pt a 260, 511), el interletrado de HYTREX letra a
letra, la altura de la cabecera interior (línea a 745,2283) y los tres grises.
El logotipo no se copia como archivo aparte: se extrae de la propia plantilla
en cada compilación, así que no puede desincronizarse.
"""
import io
import os

from pypdf import PdfReader
from reportlab.lib.pagesizes import letter
from reportlab.lib.enums import TA_JUSTIFY
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, PageBreak,
                                NextPageTemplate, Flowable)

from contenido_arquitectura import BLOQUES

D = os.path.dirname(os.path.abspath(__file__))
W, H = letter                      # 612 x 792
PLANTILLA = f'{D}/Hytrex-Plantilla-Propuesta-en-blanco.pdf'

# Los cinco colores de la plantilla, leídos de su flujo de contenido.
NEGRO = colors.Color(.101961, .101961, .101961)      # #1A1A1A
ROJO = colors.Color(.890196, .117647, .141176)       # #E31E24
GRIS_MEDIO = colors.Color(.419608, .419608, .419608)  # #6B6B6B
GRIS_CLARO = colors.Color(.717647, .717647, .717647)  # #B7B7B7
GRIS_LINEA = colors.Color(.847059, .847059, .847059)  # #D8D8D8
GRIS_TEXTO = colors.Color(.22, .22, .22)              # cuerpo: un paso sobre el negro

MARGEN = 68.0315
DERECHA = 543.9685
ANCHO = DERECHA - MARGEN            # 475.937

# Portada
LOGO_LADO, LOGO_X, LOGO_Y = 92, 260, 511
Y_WORDMARK = 492
X_LETRAS = [233.272, 260.044, 285.386, 309.272, 336.044, 361.386]
Y_LEMA, Y_FILETE = 476, 437
Y_TITULO, Y_SUBTITULO, Y_UNALINEA = 392, 368, 350
Y_INGENIERIA, Y_NOMBRE_1, SALTO_NOMBRE = 320.315, 283.4646, 16
Y_PIE_LINEA, Y_PIE_TEXTO = 73.70079, 56.69291

# Interior
Y_CAB_TEXTO, Y_CAB_LINEA = 749.4803, 745.2283
TOPE_CUERPO = 712                   # debajo de la línea de cabecera, con aire
BASE_CUERPO = 68

TITULO = 'DevUP'
SUBTITULO = 'Propuesta de arquitectura'
UNA_LINEA = 'Por qué se siente como catorce cosas pegadas, y qué lo arregla'
CABECERA = 'DevUP · Propuesta de arquitectura'
INGENIEROS = ['Juan Esteban Bonilla', 'Juan Felipe Medina Orjuela',
              'Carlos Fernando Cáceres']
SALIDA = f'{D}/../DevUP-Propuesta-de-Arquitectura.pdf'


def logo_de_la_plantilla():
    """El isotipo, sacado de la plantilla en vez de guardado al lado.

    Así no hay dos copias que puedan divergir: si la plantilla cambia de
    logotipo, este documento lo cambia solo.
    """
    pagina = PdfReader(PLANTILLA).pages[0]
    imagenes = list(pagina.images)
    if not imagenes:
        raise SystemExit('la plantilla ya no trae el isotipo en su portada')
    return ImageReader(io.BytesIO(imagenes[0].data))


LOGO = logo_de_la_plantilla()

E = {
    'h1': ParagraphStyle('h1', fontName='Helvetica-Bold', fontSize=19, leading=22,
                         textColor=NEGRO, spaceBefore=0, spaceAfter=3),
    'h2': ParagraphStyle('h2', fontName='Helvetica-Bold', fontSize=12.2, leading=15.5,
                         textColor=NEGRO, spaceBefore=16, spaceAfter=5),
    'h3': ParagraphStyle('h3', fontName='Helvetica-Bold', fontSize=9.8, leading=13,
                         textColor=ROJO, spaceBefore=11, spaceAfter=2),
    'p': ParagraphStyle('p', fontName='Helvetica', fontSize=9.3, leading=14.4,
                        textColor=GRIS_TEXTO, alignment=TA_JUSTIFY, spaceAfter=7),
    'kicker': ParagraphStyle('kicker', fontName='Helvetica-Bold', fontSize=8.2, leading=10,
                             textColor=ROJO, spaceAfter=5),
    'quote': ParagraphStyle('quote', fontName='Helvetica-Oblique', fontSize=11.4, leading=16,
                            textColor=NEGRO, leftIndent=13, spaceBefore=5, spaceAfter=9),
    'bullet': ParagraphStyle('bullet', fontName='Helvetica', fontSize=9.3, leading=14.4,
                             textColor=GRIS_TEXTO, alignment=TA_JUSTIFY,
                             leftIndent=14, bulletIndent=3, spaceAfter=5),
    'celda': ParagraphStyle('celda', fontName='Helvetica', fontSize=8.4, leading=11.8,
                            textColor=GRIS_TEXTO),
    'celdaCab': ParagraphStyle('celdaCab', fontName='Helvetica-Bold', fontSize=8.4,
                               leading=11.8, textColor=NEGRO),
}


class Filete(Flowable):
    """El filete rojo de la plantilla: 36 pt de ancho, 2,4 de grosor."""

    def __init__(self, ancho=36, grosor=2.4, espacio=10):
        Flowable.__init__(self)
        self.ancho, self.grosor, self.espacio = ancho, grosor, espacio
        self.width, self.height = ancho, grosor + espacio

    def draw(self):
        self.canv.setFillColor(ROJO)
        self.canv.rect(0, self.espacio, self.ancho, self.grosor, stroke=0, fill=1)


def tabla(datos):
    filas = [[Paragraph(c, E['celdaCab'] if i == 0 else E['celda']) for c in fila]
             for i, fila in enumerate(datos)]
    n = len(datos[0])
    # Tres columnas: la primera estrecha para el rótulo o el número, la última
    # ancha porque es donde va el razonamiento.
    anchos = [ANCHO * .19, ANCHO * .23, ANCHO * .58] if n == 3 else [ANCHO / n] * n
    t = Table(filas, colWidths=anchos, repeatRows=1)
    t.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 11),
        ('LINEBELOW', (0, 0), (-1, 0), 1.1, ROJO),
        ('LINEBELOW', (0, 1), (-1, -2), .4, GRIS_LINEA),
        ('LINEBELOW', (0, -1), (-1, -1), .6, GRIS_LINEA),
    ]))
    return t


def portada(canv, doc):
    canv.saveState()
    canv.drawImage(LOGO, LOGO_X, LOGO_Y, LOGO_LADO, LOGO_LADO,
                   mask='auto', preserveAspectRatio=True)

    # HYTREX letra a letra, en las abscisas exactas de la plantilla: así el
    # interletrado y la X roja caen donde el diseño los puso.
    canv.setFont('Helvetica-Bold', 26)
    for letra, x in zip('HYTREX', X_LETRAS):
        canv.setFillColor(ROJO if letra == 'X' else NEGRO)
        canv.drawString(x, Y_WORDMARK, letra)

    canv.setFont('Helvetica', 8.3)
    canv.setFillColor(GRIS_MEDIO)
    canv.drawCentredString(W / 2, Y_LEMA, 'C L A R I T Y .   P U R P O S E .   I M P A C T .')

    canv.setStrokeColor(ROJO)
    canv.setLineWidth(2.4)
    canv.line(288, Y_FILETE, 324, Y_FILETE)

    canv.setFillColor(NEGRO)
    canv.setFont('Helvetica-Bold', 40)
    canv.drawCentredString(W / 2, Y_TITULO, TITULO)
    canv.setFillColor(GRIS_MEDIO)
    canv.setFont('Helvetica', 15)
    canv.drawCentredString(W / 2, Y_SUBTITULO, SUBTITULO)
    canv.setFont('Helvetica', 10)
    canv.drawCentredString(W / 2, Y_UNALINEA, UNA_LINEA)

    canv.setFillColor(ROJO)
    canv.setFont('Helvetica-Bold', 8.6)
    canv.drawCentredString(W / 2, Y_INGENIERIA, 'INGENIERÍA A CARGO')
    canv.setFillColor(NEGRO)
    canv.setFont('Helvetica-Oblique', 11)
    for i, nombre in enumerate(INGENIEROS):
        canv.drawCentredString(W / 2, Y_NOMBRE_1 - i * SALTO_NOMBRE, nombre)

    canv.setStrokeColor(GRIS_LINEA)
    canv.setLineWidth(.6)
    canv.line(MARGEN, Y_PIE_LINEA, DERECHA, Y_PIE_LINEA)
    canv.setFont('Helvetica', 8.3)
    canv.setFillColor(GRIS_MEDIO)
    canv.drawString(MARGEN, Y_PIE_TEXTO, 'Hytrex · Ingeniería digital con propósito')
    canv.drawRightString(DERECHA, Y_PIE_TEXTO, 'Documento interno · versión 1')
    canv.restoreState()


def interior(canv, doc):
    canv.saveState()
    canv.setFont('Helvetica-Oblique', 8)
    canv.setFillColor(GRIS_MEDIO)
    canv.drawString(MARGEN, Y_CAB_TEXTO, CABECERA)
    canv.drawRightString(DERECHA, Y_CAB_TEXTO, str(doc.page - 1))
    canv.setStrokeColor(GRIS_LINEA)
    canv.setLineWidth(.5)
    canv.line(MARGEN, Y_CAB_LINEA, DERECHA, Y_CAB_LINEA)
    canv.restoreState()


def construye():
    doc = BaseDocTemplate(SALIDA, pagesize=letter,
                          leftMargin=MARGEN, rightMargin=W - DERECHA,
                          topMargin=H - TOPE_CUERPO, bottomMargin=BASE_CUERPO,
                          title=f'{TITULO} · {SUBTITULO}', author='Hytrex')
    doc.addPageTemplates([
        PageTemplate(id='portada',
                     frames=[Frame(MARGEN, BASE_CUERPO, ANCHO, TOPE_CUERPO - BASE_CUERPO,
                                   id='portada')],
                     onPage=portada),
        PageTemplate(id='cuerpo',
                     frames=[Frame(MARGEN, BASE_CUERPO, ANCHO, TOPE_CUERPO - BASE_CUERPO,
                                   id='cuerpo')],
                     onPage=interior),
    ])

    # Sin esto, el dibujo de la portada se repite en cada página.
    hist = [NextPageTemplate('cuerpo'), PageBreak()]

    for b in BLOQUES:
        k = b[0]
        if k == 'pagebreak':
            hist.append(PageBreak())
        elif k == 'h1':
            hist.append(Paragraph(b[1], E['h1']))
            hist.append(Filete())
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
            hist.append(Spacer(1, 4))
            hist.append(tabla(b[1]))
            hist.append(Spacer(1, 9))
        else:
            raise SystemExit(f'bloque desconocido: {k}')

    doc.build(hist)
    print(f'ok · {os.path.basename(SALIDA)}')


if __name__ == '__main__':
    construye()
