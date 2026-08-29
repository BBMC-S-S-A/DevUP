// Convierte un documento de docs/ en PDF, sin dependencias nuevas.
//
// POR QUÉ NO EL GENERADOR DE LA PROPUESTA. `docs/propuesta/` maqueta con
// reportlab en Python: portada, marca de agua, figuras, el isotipo dibujado a
// mano. Está bien para el documento que sale de la empresa, y es demasiado —y
// pide instalar Python, reportlab, pillow y las fuentes— para un documento
// interno que solo quiere leerse bien impreso. Aquí se usa lo que ya hay en el
// repositorio: `marked`, que es una dependencia existente, y el Chrome que ya
// está instalado en la máquina.
//
// LA TIPOGRAFÍA VA CON RESPALDO A PROPÓSITO. Se intenta Raleway desde Google
// Fonts porque es la de la marca, pero si la red no la sirve —ya pasó que un
// filtro de red bloqueara un dominio entero— el documento sale igual con la
// pila del sistema en vez de salir sin maquetar.
//
//   node scripts/md-a-pdf.mjs docs/prioridades-2026-08-29.md

import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, basename, resolve } from "node:path";
import { marked } from "marked";

const entrada = process.argv[2];
if (!entrada) {
  console.error("uso: node scripts/md-a-pdf.mjs <fichero.md> [salida.pdf]");
  process.exit(1);
}
// Absoluta a propósito: con una ruta relativa Chrome escribe el PDF donde sea
// que tenga su directorio de trabajo, dice que lo escribió, y el archivo no
// aparece donde uno lo espera.
const salida = resolve(process.argv[3] ?? entrada.replace(/\.md$/, ".pdf"));

const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
].find((ruta) => existsSync(ruta));

if (!CHROME) {
  console.error("no encuentro chrome.exe; edita la lista CHROME de este script");
  process.exit(1);
}

const md = readFileSync(entrada, "utf8");

// El primer encabezado de nivel uno es el título del documento, y se saca del
// cuerpo para que no salga dos veces: una en la portadilla y otra en el texto.
const titulo = (md.match(/^#\s+(.+)$/m)?.[1] ?? basename(entrada)).replace(/`/g, "");
const cuerpo = marked.parse(md.replace(/^#\s+.+$\n?/m, ""));

const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>${titulo}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Raleway:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root {
    --tinta: #1a1626;
    --apagado: #5f5872;
    --tenue: #837b96;
    --acento: #6d28d9;
    --linea: #e4e0ee;
    --papel: #ffffff;
    --suave: #f6f4fb;
  }
  @page { size: A4; margin: 20mm 18mm 18mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: Raleway, "Segoe UI", system-ui, sans-serif;
    font-size: 10.5pt;
    line-height: 1.62;
    color: var(--tinta);
    background: var(--papel);
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* Portadilla: no es una portada entera porque esto es un documento de
     trabajo, pero sí merece que el título respire antes del primer párrafo. */
  .portadilla { border-bottom: 2px solid var(--acento); padding-bottom: 14mm; margin-bottom: 10mm; }
  .marca {
    font-size: 8pt; font-weight: 800; letter-spacing: 0.22em;
    text-transform: uppercase; color: var(--acento); margin-bottom: 6mm;
  }
  .portadilla h1 { font-size: 26pt; font-weight: 800; line-height: 1.12; margin: 0; letter-spacing: -0.02em; }

  h2 {
    font-size: 14pt; font-weight: 700; margin: 11mm 0 3mm;
    letter-spacing: -0.01em; break-after: avoid;
  }
  h2::before {
    content: ""; display: block; width: 16mm; height: 2px;
    background: var(--acento); margin-bottom: 3mm;
  }
  h3 { font-size: 11pt; font-weight: 700; margin: 7mm 0 2mm; color: var(--acento); break-after: avoid; }
  p { margin: 0 0 3.4mm; text-align: justify; hyphens: auto; }
  strong { font-weight: 700; }
  em { color: var(--apagado); }

  ul { margin: 0 0 4mm; padding-left: 5mm; }
  li { margin-bottom: 2.2mm; }
  li::marker { color: var(--acento); }

  /* Las tablas no se parten a mitad de fila: una fila cortada por el salto de
     página se lee como dos filas distintas. */
  table { width: 100%; border-collapse: collapse; margin: 0 0 5mm; font-size: 9.5pt; }
  tr { break-inside: avoid; }
  th {
    text-align: left; font-size: 8pt; font-weight: 700; letter-spacing: 0.1em;
    text-transform: uppercase; color: var(--tenue);
    border-bottom: 1.5px solid var(--linea); padding: 2mm 3mm 1.6mm;
  }
  td { padding: 2.4mm 3mm; border-bottom: 1px solid var(--linea); vertical-align: top; }
  tbody tr:nth-child(odd) { background: var(--suave); }

  code {
    font-family: "Cascadia Mono", Consolas, ui-monospace, monospace;
    font-size: 9pt; background: var(--suave); color: var(--acento);
    padding: 0.4mm 1.2mm; border-radius: 2px;
  }
  pre {
    background: var(--suave); border-left: 2px solid var(--acento);
    padding: 3.5mm 4mm; border-radius: 0 4px 4px 0; overflow: hidden;
    break-inside: avoid; margin: 0 0 5mm;
  }
  pre code { background: none; color: var(--tinta); padding: 0; font-size: 8.6pt; }

  hr { border: 0; border-top: 1px solid var(--linea); margin: 9mm 0; }

  a { color: var(--acento); text-decoration: none; }
</style></head>
<body>
  <div class="portadilla">
    <div class="marca">DevUP · Documento interno</div>
    <h1>${titulo}</h1>
  </div>
  ${cuerpo}
</body></html>`;

const temporal = mkdtempSync(join(tmpdir(), "devup-pdf-"));
const rutaHtml = join(temporal, "documento.html");
writeFileSync(rutaHtml, html, "utf8");

// Con `DEVUP_PDF_HTML=ruta.html` se guarda también el intermedio. Sirve para
// mirar la maqueta en un navegador, que es la única forma cómoda de ver por qué
// una tabla se parte mal sin reimprimir el PDF cada vez.
if (process.env.DEVUP_PDF_HTML) writeFileSync(resolve(process.env.DEVUP_PDF_HTML), html, "utf8");

try {
  execFileSync(
    CHROME,
    [
      "--headless",
      "--disable-gpu",
      "--no-pdf-header-footer",
      // Un margen de espera: sin él, Chrome puede imprimir antes de que llegue
      // la tipografía y el documento sale con la pila de respaldo aunque la red
      // funcionase.
      "--virtual-time-budget=4000",
      `--print-to-pdf=${salida}`,
      `file:///${rutaHtml.replace(/\\/g, "/")}`,
    ],
    { stdio: "pipe" },
  );
} finally {
  rmSync(temporal, { recursive: true, force: true });
}

console.log(`escrito ${salida}`);
