# Cómo se rehace la propuesta

`docs/DevUP-Propuesta-de-Desarrollo.pdf` no se edita a mano: se genera desde
aquí. Así el documento se puede corregir sin volver a maquetarlo, y el texto
vive en control de versiones como todo lo demás.

## Qué hay

| Archivo | Qué es |
|---|---|
| `contenido.py` | **El texto.** Es lo único que hay que tocar para cambiar lo que dice |
| `build_pdf.py` | La maqueta: portada, marca de agua, estilos, tablas y figuras |
| `logo.py` | El isotipo de Hytrex, en versión de portada y de marca de agua |
| `modelo3d.py` | El modelo del avatar y su render a sprite |

## Rehacerlo

```bash
pip install reportlab pillow fonttools brotli

# Raleway, que es la tipografía de la marca
npm pack @fontsource/raleway && tar xzf fontsource-raleway-*.tgz
python3 - <<'PY'
from fontTools.ttLib import TTFont
import os
os.makedirs('fuentes', exist_ok=True)
for peso, nombre in ((400,'Regular'),(500,'Medium'),(600,'SemiBold'),
                     (700,'Bold'),(800,'ExtraBold')):
    f = TTFont(f'package/files/raleway-latin-{peso}-normal.woff2')
    f.flavor = None
    f.save(f'fuentes/Raleway-{nombre}.ttf')
PY

python3 logo.py        # isotipo y marca de agua
python3 modelo3d.py    # sprites del avatar
python3 build_pdf.py   # el PDF
```

Las fuentes no están en el repositorio a propósito: se bajan del paquete
oficial en dos líneas y no hay motivo para versionar binarios que no son
nuestros.

## Dos avisos

**El isotipo es una reconstrucción.** `logo.py` dibuja el anillo de pinceladas
a partir del manual de marca porque no teníamos el archivo original a mano.
Sirve para maquetar; antes de que el documento salga de la empresa conviene
sustituirlo por el vector real y borrar `logo.py` de la cadena.

**El render del avatar es un boceto.** `modelo3d.py` es un rasterizador propio
con volúmenes simples: existe para enseñar que la tubería —modelar en 3D,
renderizar a sprite de 44 × 64 en cuatro direcciones— funciona y produce
volumen real. El modelo definitivo se hace en una herramienta de modelado; lo
que no cambia es lo que el juego recibe, que sigue siendo la imagen.
