# -*- coding: utf-8 -*-
"""Compone la propuesta de desarrollo de DevUP en PDF."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_JUSTIFY, TA_LEFT, TA_CENTER
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, Image, PageBreak,
                                KeepTogether, Flowable, NextPageTemplate)
from contenido import BLOQUES, INGENIEROS

D = os.path.dirname(os.path.abspath(__file__))
W, H = A4

ROJO = colors.HexColor('#E10600')
NEGRO = colors.HexColor('#111111')
GRIS = colors.HexColor('#333333')
GRIS_MEDIO = colors.HexColor('#666666')
GRIS_LINEA = colors.HexColor('#D8D8D8')

for nombre, archivo in (('Raleway', 'Raleway-Regular'), ('Raleway-Md', 'Raleway-Medium'),
                        ('Raleway-Sb', 'Raleway-SemiBold'), ('Raleway-Bd', 'Raleway-Bold'),
                        ('Raleway-Xb', 'Raleway-ExtraBold')):
    pdfmetrics.registerFont(TTFont(nombre, f'{D}/fuentes/{archivo}.ttf'))
pdfmetrics.registerFontFamily('Raleway', normal='Raleway', bold='Raleway-Bd',
                              italic='Raleway', boldItalic='Raleway-Bd')

MARGEN = 62
ANCHO = W - 2 * MARGEN

E = {
    'h1': ParagraphStyle('h1', fontName='Raleway-Xb', fontSize=23, leading=26,
                         textColor=NEGRO, spaceBefore=0, spaceAfter=4),
    'h2': ParagraphStyle('h2', fontName='Raleway-Bd', fontSize=13.5, leading=17,
                         textColor=NEGRO, spaceBefore=17, spaceAfter=6),
    'h3': ParagraphStyle('h3', fontName='Raleway-Sb', fontSize=10.8, leading=14,
                         textColor=ROJO, spaceBefore=12, spaceAfter=3),
    'p': ParagraphStyle('p', fontName='Raleway', fontSize=9.6, leading=15.2,
                        textColor=GRIS, alignment=TA_JUSTIFY, spaceAfter=8),
    'kicker': ParagraphStyle('kicker', fontName='Raleway-Sb', fontSize=8.6, leading=11,
                             textColor=ROJO, spaceAfter=6),
    'quote': ParagraphStyle('quote', fontName='Raleway-Md', fontSize=12, leading=17.5,
                            textColor=NEGRO, leftIndent=14, spaceBefore=6, spaceAfter=10),
    'bullet': ParagraphStyle('bullet', fontName='Raleway', fontSize=9.6, leading=15.2,
                             textColor=GRIS, alignment=TA_JUSTIFY,
                             leftIndent=15, bulletIndent=3, spaceAfter=6),
    'celda': ParagraphStyle('celda', fontName='Raleway', fontSize=8.7, leading=12.4,
                            textColor=GRIS),
    'celdaCab': ParagraphStyle('celdaCab', fontName='Raleway-Sb', fontSize=8.7,
                               leading=12.4, textColor=NEGRO),
    'pie': ParagraphStyle('pie', fontName='Raleway', fontSize=8.2, leading=11.5,
                          textColor=GRIS_MEDIO, spaceAfter=4),
    'fuente': ParagraphStyle('fuente', fontName='Raleway', fontSize=8.4, leading=12.6,
                             textColor=GRIS, leftIndent=15, bulletIndent=0, spaceAfter=6),
}


class Regla(Flowable):
    """Filete rojo corto: separa el titular de lo que viene debajo."""

    def __init__(self, ancho=46, grosor=2.4, color=ROJO, espacio=11):
        Flowable.__init__(self)
        self.ancho, self.grosor, self.color, self.espacio = ancho, grosor, color, espacio
        self.width, self.height = ancho, grosor + espacio

    def draw(self):
        self.canv.setFillColor(self.color)
        self.canv.rect(0, self.espacio, self.ancho, self.grosor, stroke=0, fill=1)


class BarraCita(Flowable):
    """La raya vertical roja de una cita, dibujada bajo el párrafo siguiente."""

    def __init__(self, alto):
        Flowable.__init__(self)
        self.width, self.height = 0, 0
        self.alto = alto

    def draw(self):
        self.canv.setFillColor(ROJO)
        self.canv.rect(0, -self.alto, 2.2, self.alto, stroke=0, fill=1)


def portada(canv, doc):
    canv.saveState()
    iso = f'{D}/hytrex_isotipo.png'
    lado = 132
    canv.drawImage(iso, (W - lado) / 2, H - 218, lado, lado,
                   mask='auto', preserveAspectRatio=True)

    # Logotipo: se dibuja letra a letra para controlar el tracking exacto —
    # `charSpace` mete además un hueco detrás del último carácter y descuadra
    # la X roja.
    def tracked(texto, fuente, tam, track, y, color_de):
        anchos = [pdfmetrics.stringWidth(c, fuente, tam) for c in texto]
        total = sum(anchos) + track * (len(texto) - 1)
        x = (W - total) / 2
        canv.setFont(fuente, tam)
        for c, a in zip(texto, anchos):
            canv.setFillColor(color_de(c))
            canv.drawString(x, y, c)
            x += a + track

    y0 = H - 262
    tracked('HYTREX', 'Raleway-Xb', 30, 9.5, y0,
            lambda c: ROJO if c == 'X' else NEGRO)
    tracked('CLARITY. PURPOSE. IMPACT.', 'Raleway-Md', 7.6, 3.6, y0 - 17,
            lambda c: GRIS_MEDIO)

    # Título del documento
    canv.setFillColor(ROJO)
    canv.rect((W - 46) / 2, H - 352, 46, 2.6, stroke=0, fill=1)

    canv.setFillColor(NEGRO)
    canv.setFont('Raleway-Xb', 38)
    canv.drawCentredString(W / 2, H - 412, 'DevUP')
    canv.setFont('Raleway-Md', 14.5)
    canv.setFillColor(GRIS)
    canv.drawCentredString(W / 2, H - 440, 'Propuesta de desarrollo')

    canv.setFont('Raleway', 10)
    canv.setFillColor(GRIS_MEDIO)
    canv.drawCentredString(W / 2, H - 468,
                           'El gestor del desarrollo del proyecto')

    # Equipo
    canv.setFont('Raleway-Sb', 8)
    canv._charSpace = 2.4
    canv.setFillColor(ROJO)
    canv.drawCentredString(W / 2, 232, 'INGENIERÍA A CARGO')
    canv._charSpace = 0
    canv.setFont('Raleway-Md', 11)
    canv.setFillColor(NEGRO)
    for i, nombre in enumerate(INGENIEROS):
        canv.drawCentredString(W / 2, 206 - i * 19, nombre)

    canv.setFillColor(GRIS_LINEA)
    canv.rect(MARGEN, 118, ANCHO, 0.6, stroke=0, fill=1)
    canv.setFont('Raleway', 8.4)
    canv.setFillColor(GRIS_MEDIO)
    canv.drawString(MARGEN, 102, 'Hytrex · Ingeniería digital con propósito')
    canv.drawRightString(W - MARGEN, 102, 'Documento interno · versión 1')
    canv.restoreState()


def interior(canv, doc):
    canv.saveState()
    # Marca de agua: el isotipo grande, centrado y apenas insinuado.
    lado = 330
    canv.drawImage(f'{D}/hytrex_agua.png', (W - lado) / 2, (H - lado) / 2 - 10,
                   lado, lado, mask='auto', preserveAspectRatio=True)

    canv.setFillColor(GRIS_LINEA)
    canv.rect(MARGEN, 46, ANCHO, 0.5, stroke=0, fill=1)
    canv.setFont('Raleway', 7.6)
    canv.setFillColor(GRIS_MEDIO)
    canv.drawString(MARGEN, 33, 'DevUP · Propuesta de desarrollo')
    canv.setFont('Raleway-Sb', 7.6)
    canv.setFillColor(NEGRO)
    canv.drawRightString(W - MARGEN, 33, str(doc.page - 1))
    canv.setFillColor(ROJO)
    canv.rect(W - MARGEN - 20, 46, 20, 0.5, stroke=0, fill=1)
    canv.restoreState()


def tabla(datos):
    filas = [[Paragraph(c, E['celdaCab'] if i == 0 else E['celda']) for c in fila]
             for i, fila in enumerate(datos)]
    n = len(datos[0])
    anchos = [ANCHO * 0.17, ANCHO * 0.24, ANCHO * 0.59] if n == 3 else [ANCHO / n] * n
    t = Table(filas, colWidths=anchos, repeatRows=1)
    t.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 7),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 12),
        ('LINEBELOW', (0, 0), (-1, 0), 1.1, ROJO),
        ('LINEBELOW', (0, 1), (-1, -2), 0.4, GRIS_LINEA),
        ('LINEBELOW', (0, -1), (-1, -1), 0.6, GRIS_LINEA),
    ]))
    return t


def figura(ruta, ancho, alto, pie):
    im = Image(ruta, width=ancho, height=alto)
    im.hAlign = 'CENTER'
    cap = Paragraph(pie, ParagraphStyle('cap', parent=E['pie'], alignment=TA_CENTER,
                                        spaceBefore=7))
    return KeepTogether([im, cap])


EXTRA = [
    ("h2", "14. El orden, de un vistazo"),
    ("p", "Con una sola regla detrás: primero lo que protege lo que existe, después lo "
          "que abarata lo siguiente."),
    ("table", [
        ["", "Bloque", "Por qué va ahí"],
        ["1", "Que nada se pierda",
         "Protege lo que ya existe y son las horas más baratas del plan."],
        ["2", "Cerrar lo a medias",
         "Deuda que cuesta más abierta que cerrada."],
        ["3", "Pruebas de navegador",
         "La red que hace segura toda la migración de interfaz que viene detrás."],
        ["4", "Interfaz: armazón, marco, datos y móvil",
         "Es la mitad de las pantallas que quedan, escrita una vez en vez de siete."],
        ["5", "Vista de infraestructura",
         "Cierra la tercera promesa y enciende los muebles muertos de DevVerse."],
        ["6", "Integraciones guiadas",
         "Lo que nadie más hace y lo que se entiende en treinta segundos."],
        ["7", "Agentes",
         "Necesita la bóveda probada por el bloque anterior."],
        ["8", "Base de datos como código",
         "Se apoya en un criterio que ya existe y está probado."],
        ["9", "Identidad propia y apertura",
         "Necesita copias de seguridad y correo real: el bloque 1 entero."],
        ["10", "Escalar",
         "Solo cuando duela. Antes es trabajo tirado."],
    ]),
]


FIGURAS = [
    ("figura", 'm_sur_8x.png', 176, 256,
     "Boceto · el modelo renderizado, ampliado ocho veces para ver el resultado del "
     "sombreado. Cada superficie recibe la luz según hacia dónde mira."),
    ("figura", 'hoja_direcciones.png', ANCHO, ANCHO * 320 / 1368,
     "Boceto · las cuatro direcciones y dos fotogramas de andar. Ninguna se dibujó: "
     "son el mismo modelo girado y vuelto a renderizar."),
]

FUENTES = [
    ("h2", "Fuentes"),
    ("fuente", "[1]&nbsp; Murty, R. N.; Dadlani, S.; Das, R. B. "
               "<i>How Much Time and Energy Do We Waste Toggling Between Applications?</i> "
               "Harvard Business Review, 29 de agosto de 2022. "
               "Estudio sobre 137 trabajadores de 20 equipos en tres empresas del "
               "Fortune 500, durante cinco semanas. "
               "hbr.org/2022/08/how-much-time-and-energy-do-we-waste-toggling-between-applications"),
    ("fuente", "[2]&nbsp; Mark, G.; González, V. M.; Harris, J. "
               "<i>No Task Left Behind? Examining the Nature of Fragmented Work.</i> "
               "CHI 2005, Portland, Oregón. Universidad de California en Irvine. "
               "Observación detallada de 24 trabajadores del conocimiento. "
               "ics.uci.edu/~gmark/CHI2005.pdf"),
    ("fuente", "[3]&nbsp; Stack Overflow. <i>2025 Developer Survey</i> y "
               "<i>Developers remain willing but reluctant to use AI.</i> "
               "survey.stackoverflow.co/2025/ai"),
    ("p", "Los datos sobre el estado del código de DevUP —número de puntos de API, "
          "tablas, migraciones, pantallas, comprobaciones de aislamiento y las cifras "
          "de la auditoría de interfaz del apartado 7— están contados sobre el "
          "repositorio, no estimados."),
    ("p", "<b>Nota de marca.</b> El isotipo de estas páginas es una reconstrucción hecha "
          "para poder maquetar el documento; antes de enviarlo fuera conviene "
          "sustituirlo por el archivo original."),
]


def construye():
    doc = BaseDocTemplate(f'{D}/DevUP-Propuesta-de-Desarrollo.pdf', pagesize=A4,
                          leftMargin=MARGEN, rightMargin=MARGEN,
                          topMargin=64, bottomMargin=62,
                          title='DevUP · Propuesta de desarrollo',
                          author='Hytrex')
    marco_portada = Frame(MARGEN, 62, ANCHO, H - 126, id='portada')
    marco = Frame(MARGEN, 62, ANCHO, H - 126, id='cuerpo')
    doc.addPageTemplates([
        PageTemplate(id='portada', frames=[marco_portada], onPage=portada),
        PageTemplate(id='cuerpo', frames=[marco], onPage=interior),
    ])

    # Sin esto, el dibujo de la portada se repite en cada página.
    hist = [NextPageTemplate('cuerpo'), PageBreak()]

    def emite(bloques):
        for b in bloques:
            k = b[0]
            if k == 'pagebreak':
                hist.append(PageBreak())
            elif k == 'h1':
                hist.append(Paragraph(b[1], E['h1']))
                hist.append(Regla())
            elif k in ('h2', 'h3', 'kicker'):
                hist.append(Paragraph(b[1].upper() if k == 'kicker' else b[1], E[k]))
            elif k == 'p':
                hist.append(Paragraph(b[1], E['p']))
            elif k == 'quote':
                hist.append(Spacer(1, 3))
                hist.append(Paragraph('«' + b[1] + '»', E['quote']))
                hist.append(Spacer(1, 3))
            elif k == 'bullets':
                for item in b[1]:
                    hist.append(Paragraph(item, E['bullet'], bulletText='—'))
            elif k == 'fuente':
                hist.append(Paragraph(b[1], E['fuente']))
            elif k == 'table':
                hist.append(Spacer(1, 5))
                hist.append(tabla(b[1]))
                hist.append(Spacer(1, 10))
            elif k == 'figura':
                hist.append(Spacer(1, 8))
                hist.append(figura(f'{D}/{b[1]}', b[2], b[3], b[4]))
                hist.append(Spacer(1, 14))

    corte = next(i for i, b in enumerate(BLOQUES) if b[0] == 'kicker' and b[1] == 'Parte III')
    emite(BLOQUES[:corte - 1])
    emite(EXTRA)
    emite(BLOQUES[corte - 1:])
    emite(FIGURAS)
    emite(FUENTES)

    doc.build(hist)
    print('ok')


if __name__ == '__main__':
    construye()
