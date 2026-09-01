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
| `modelo3d.py` | El modelo del avatar, su render a sprite y la hoja de contactos |

Nada más de esta carpeta se versiona: las fuentes se bajan del paquete oficial y
los PNG los dibujan `logo.py` y `modelo3d.py`. Se regeneran en dos comandos, así
que guardar binarios que no son nuestros no aporta nada.

## Rehacerlo, en un contenedor

**Recomendado, y no por gusto.** La máquina de producción tiene una instalación
de Python incompleta —falta `C:\Python313\Lib` y no hay `pip`— y arreglarla para
generar un PDF sería tocar el sistema por una tarea de diez minutos. En un
contenedor no se instala nada en la máquina y da igual qué Python haya.

```bash
# Desde la raíz del repositorio.

# 1. Raleway, que es la tipografía de la marca. No se versiona a propósito.
cd docs/propuesta && npm pack @fontsource/raleway && tar xzf fontsource-raleway-*.tgz && cd -

# 2. Todo lo demás, dentro del contenedor.
docker run --rm -v "$(pwd)/docs/propuesta:/trabajo" -w /trabajo python:3.13-slim sh -c '
  pip install --quiet --no-cache-dir reportlab pillow fonttools brotli
  python - <<PY
from fontTools.ttLib import TTFont
import os
os.makedirs("fuentes", exist_ok=True)
for peso, nombre in ((400,"Regular"),(500,"Medium"),(600,"SemiBold"),(700,"Bold"),(800,"ExtraBold")):
    f = TTFont(f"package/files/raleway-latin-{peso}-normal.woff2")
    f.flavor = None
    f.save(f"fuentes/Raleway-{nombre}.ttf")
PY
  python logo.py && python modelo3d.py && python build_pdf.py
'

# 3. El resultado va a docs/, que es donde se lee.
mv docs/propuesta/DevUP-Propuesta-de-Desarrollo.pdf docs/
rm -rf docs/propuesta/package docs/propuesta/*.tgz
```

En una máquina con Python funcionando basta con `pip install reportlab pillow
fonttools brotli` y los tres `python` del paso 2.

## El orden importa

`build_pdf.py` **no dibuja nada**: coloca imágenes que ya existen. Si se lanza
antes que `logo.py` y `modelo3d.py`, falla con un `Cannot open resource` que no
dice cuál es el paso que faltaba.

Y hasta hoy fallaba igual aunque se siguiera el orden: `hoja_direcciones.png`
—la fila con las cuatro direcciones y los dos pasos— la pedía la segunda figura
y **no la generaba nadie**. Se había hecho a mano una vez y, como los PNG de
esta carpeta no se versionan, la cadena del README no funcionaba de punta a
punta. Ahora la hace `modelo3d.py` con el resto.

## Dos avisos

**El isotipo es una reconstrucción.** `logo.py` dibuja el anillo de pinceladas a
partir del manual de marca porque no teníamos el archivo original a mano. Sirve
para maquetar; antes de que el documento salga de la empresa conviene sustituirlo
por el vector real y borrar `logo.py` de la cadena.

**El render del avatar es un boceto.** `modelo3d.py` es un rasterizador propio
con volúmenes simples: existe para enseñar que la tubería —modelar en 3D,
renderizar a sprite de 44 × 64 en cuatro direcciones— funciona y produce volumen
real. El modelo definitivo se hace en una herramienta de modelado; lo que no
cambia es lo que el juego recibe, que sigue siendo la imagen.
