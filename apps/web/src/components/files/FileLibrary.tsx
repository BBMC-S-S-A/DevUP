"use client";

import {
  Check,
  ChevronRight,
  CornerLeftUp,
  FileArchive,
  FileAudio,
  FileCode2,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  LayoutGrid,
  Plus,
  Radio,
  Rows3,
  Search,
  SearchX,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { type Carpeta, type FileRecord, type Tag, api } from "@/lib/api";
import { retraso } from "@/lib/animacion";
import { formatBytes, kindOf } from "@/lib/files/upload";
import { useFileFeed } from "@/lib/files/useFileFeed";
import { Boton, BotonIcono } from "@/components/ui/Boton";
import { Dialogo, EstadoVacio, Rotulo } from "@/components/ui/Superficies";
import { Entrada, Field } from "@/components/ui/Field";
import { FilePreview } from "./FilePreview";
import { TagBadge } from "./TagBadge";
import { UploadZone } from "./UploadZone";

/**
 * Cada tipo de archivo tiene su icono y su tinte. Sirve para reconocer el
 * contenido de la rejilla de un vistazo, sin leer un solo nombre — que es lo
 * que se hace de verdad al buscar algo en una carpeta.
 *
 * Los tintes son de baja opacidad a propósito: el color aquí es una señal de
 * tipo, no de estado. El brillo de verdad sigue reservado a lo que está vivo.
 */
const TIPOS = {
  image: { Icono: ImageIcon, tinte: "text-violet", pozo: "border-violet/20 bg-violet/5" },
  video: { Icono: FileVideo, tinte: "text-accent-bright", pozo: "border-accent/20 bg-accent/5" },
  audio: { Icono: FileAudio, tinte: "text-cyan", pozo: "border-cyan/20 bg-cyan/5" },
  pdf: { Icono: FileText, tinte: "text-warn", pozo: "border-warn/20 bg-warn/5" },
  text: { Icono: FileCode2, tinte: "text-live", pozo: "border-live/20 bg-live/5" },
  other: { Icono: FileArchive, tinte: "text-muted", pozo: "border-line bg-raised/40" },
} as const;

const REJILLA = "grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3";

/** El punto inicial no cuenta (`.env` no tiene extensión, se llama así). */
function extensionDe(nombre: string): string {
  const punto = nombre.lastIndexOf(".");
  return punto > 0 ? nombre.slice(punto + 1).slice(0, 4) : "";
}

/** Escalón de entrada topado: el archivo 40 no debe entrar 1,6 s tarde. */
// `retraso` vivía aquí duplicado. Ahora es de `@/lib/animacion`, y el paso
// va explícito porque aquí siempre fue 40 ms y no los 35 de la barra.

export function FileLibrary({
  workspaceId,
  organizationId,
  channelId = null,
}: {
  workspaceId: string;
  organizationId: string;
  channelId?: string | null;
}) {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<FileRecord | null>(null);
  // Solo presentación: la rejilla es para reconocer, la lista para comparar
  // tamaños y autores en columna. No viaja al servidor ni filtra nada.
  const [vista, setVista] = useState<"rejilla" | "lista">("rejilla");

  /**
   * Las carpetas (0053), y dónde estamos dentro de ellas.
   *
   * La base las tenía desde la 0053 —con el anillo impedido por un disparador,
   * para que una carpeta no pueda acabar siendo su propia abuela— y la API ya
   * las servía. Lo único que faltaba era esto: una rejilla plana donde doce
   * archivos se llaman `image.png` no se ordena con etiquetas.
   */
  const [carpetas, setCarpetas] = useState<Carpeta[]>([]);
  const [carpetaId, setCarpetaId] = useState<string | null>(null);
  const [creandoCarpeta, setCreandoCarpeta] = useState(false);
  /** Sobre qué carpeta se está soltando ahora mismo. Solo para pintarla. */
  const [encima, setEncima] = useState<string | null>(null);
  /**
   * Las miniaturas, por id de archivo.
   *
   * SE PIDEN EN BLOQUE Y NO UNA POR TARJETA: `POST /files/urls` firma hasta
   * cincuenta de una vez, así que una rejilla entera cuesta UNA petición. Una
   * por miniatura serían sesenta, y el ahorro no es de red sino de firmas.
   */
  const [previas, setPrevias] = useState<Record<string, string>>({});

  // La búsqueda espera a que la persona deje de escribir: sin esto, «informe»
  // son siete consultas a la base y la última puede llegar antes que la
  // penúltima.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const filtrando = debounced.length > 0 || selectedTags.length > 0;

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (debounced) params.set("q", debounced);
    if (channelId) params.set("channelId", channelId);
    if (selectedTags.length > 0) params.set("tags", selectedTags.join(","));
    // BUSCAR MIRA LA BIBLIOTECA ENTERA, no la carpeta abierta. Si buscar solo
    // mirara aquí dentro, lo que se busca sería justamente lo que no aparece —
    // nadie recuerda en qué carpeta dejó algo, por eso lo busca.
    if (!filtrando) params.set("carpeta", carpetaId ?? "raiz");
    return params.toString();
  }, [debounced, channelId, selectedTags, filtrando, carpetaId]);

  // Descarta respuestas que llegan tarde: sin esto, una búsqueda lenta puede
  // pisar el resultado de otra posterior y enseñar lo que no toca.
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const mine = ++requestId.current;
    try {
      const [{ files }, { tags }, { carpetas }] = await Promise.all([
        api.get<{ files: FileRecord[] }>(
          `/workspaces/${workspaceId}/files${query ? `?${query}` : ""}`,
        ),
        api.get<{ tags: Tag[] }>(`/organizations/${organizationId}/tags`),
        api.get<{ carpetas: Carpeta[] }>(`/workspaces/${workspaceId}/carpetas`),
      ]);
      if (mine !== requestId.current) return;
      setFiles(files);
      setTags(tags);
      setCarpetas(carpetas);

      // Las miniaturas, después y sin bloquear: la rejilla ya se puede usar
      // con sus iconos mientras llegan. Si esto falla, se quedan los iconos —
      // que es exactamente lo que había antes, no una pantalla rota.
      const imagenes = files.filter((f) => kindOf(f.mimeType) === "image").slice(0, 50);
      if (imagenes.length > 0) {
        void api
          .post<{ urls: Record<string, string> }>("/files/urls", {
            ids: imagenes.map((f) => f.id),
          })
          .then(({ urls }) => {
            if (mine === requestId.current) setPrevias((previo) => ({ ...previo, ...urls }));
          })
          .catch(() => {});
      }
    } finally {
      if (mine === requestId.current) setLoading(false);
    }
  }, [workspaceId, organizationId, query]);

  useEffect(() => {
    void load();
  }, [load]);

  // Subir algo en otra pestaña tiene que aparecer aquí.
  useFileFeed(workspaceId, load);

  /** Mover un archivo a una carpeta. `null` es sacarlo a la raíz. */
  const mover = useCallback(
    async (fileId: string, destino: string | null) => {
      // Optimista: la tarjeta desaparece de la carpeta abierta en cuanto se
      // suelta. Si el servidor dice que no, `load` la devuelve a su sitio.
      setFiles((actuales) => actuales.filter((f) => f.id !== fileId));
      try {
        await api.patch(`/files/${fileId}`, { carpetaId: destino });
      } finally {
        await load();
      }
    },
    [load],
  );

  /** Las carpetas de este nivel. El árbol se arma aquí, a partir de `padreId`. */
  const aquiDentro = useMemo(
    () => carpetas.filter((c) => (c.padreId ?? null) === carpetaId),
    [carpetas, carpetaId],
  );

  /** El camino hasta donde estamos, para las migas. */
  const camino = useMemo(() => {
    const ruta: Carpeta[] = [];
    let actual = carpetaId;
    // Con tope: el disparador de la 0053 impide los anillos en la base, pero
    // esto se dibuja con lo que llegue por la red y un bucle infinito aquí
    // congelaría la pestaña.
    for (let i = 0; actual && i < 20; i += 1) {
      const carpeta = carpetas.find((c) => c.id === actual);
      if (!carpeta) break;
      ruta.unshift(carpeta);
      actual = carpeta.padreId ?? null;
    }
    return ruta;
  }, [carpetas, carpetaId]);


  // El peso total del listado visible. `sizeBytes` puede llegar como cadena
  // (bigint serializado), así que se normaliza antes de sumar o una sola fila
  // rara convierte el total en NaN.
  const pesoTotal = useMemo(
    () =>
      files.reduce((suma, file) => {
        const bytes = Number(file.sizeBytes);
        return suma + (Number.isFinite(bytes) ? bytes : 0);
      }, 0),
    [files],
  );

  return (
    <div className="space-y-4">
      <UploadZone
        workspaceId={workspaceId}
        channelId={channelId}
        tagIds={selectedTags}
        onUploaded={(file) => setFiles((current) => [file, ...current])}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-faint"
          />
          <Entrada
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nombre o descripción"
            aria-label="Buscar archivos"
            className="pl-9 pr-10"
          />
          {search.length > 0 && (
            <BotonIcono
              etiqueta="Limpiar la búsqueda"
              className="absolute right-1 top-1 size-8"
              onClick={() => setSearch("")}
            >
              <X size={14} />
            </BotonIcono>
          )}
        </div>
        <NuevaEtiqueta organizationId={organizationId} onCreated={load} />
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Rotulo className="mr-1">filtro</Rotulo>
          {tags.map((tag) => (
            <TagBadge
              key={tag.id}
              tag={tag}
              active={selectedTags.includes(tag.id)}
              onClick={() =>
                setSelectedTags((current) =>
                  current.includes(tag.id)
                    ? current.filter((id) => id !== tag.id)
                    : [...current, tag.id],
                )
              }
            />
          ))}
          {selectedTags.length > 0 && (
            <Boton variante="fantasma" tamano="sm" onClick={() => setSelectedTags([])}>
              limpiar
            </Boton>
          )}
        </div>
      )}

      {/* Dónde estoy, y cómo salgo. Las migas son también sitio para soltar:
          arrastrar un archivo a «Biblioteca» lo saca de la carpeta, que es el
          gesto que falta en casi todas las bibliotecas que sí dejan meterlo. */}
      {!filtrando && (
        <div className="flex flex-wrap items-center gap-1.5">
          <MigaCarpeta
            texto="Biblioteca"
            activa={carpetaId === null}
            resaltada={encima === "raiz"}
            onIr={() => setCarpetaId(null)}
            onSoltar={(fileId) => void mover(fileId, null)}
            onEncima={(si) => setEncima(si ? "raiz" : null)}
          />
          {camino.map((carpeta) => (
            <span key={carpeta.id} className="flex items-center gap-1.5">
              <ChevronRight size={12} className="shrink-0 text-faint" aria-hidden />
              <MigaCarpeta
                texto={carpeta.nombre}
                activa={carpeta.id === carpetaId}
                resaltada={encima === carpeta.id}
                onIr={() => setCarpetaId(carpeta.id)}
                onSoltar={(fileId) => void mover(fileId, carpeta.id)}
                onEncima={(si) => setEncima(si ? carpeta.id : null)}
              />
            </span>
          ))}
          <div className="flex-1" />
          {creandoCarpeta ? (
            <NuevaCarpeta
              workspaceId={workspaceId}
              padreId={carpetaId}
              onCerrar={() => setCreandoCarpeta(false)}
              onCreada={load}
            />
          ) : (
            <Boton
              tamano="sm"
              variante="secundario"
              icono={<FolderPlus size={14} />}
              onClick={() => setCreandoCarpeta(true)}
            >
              Nueva carpeta
            </Boton>
          )}
        </div>
      )}

      {!filtrando && aquiDentro.length > 0 && (
        <ul className={REJILLA}>
          {aquiDentro.map((carpeta, indice) => (
            <li key={carpeta.id} className="devup-entrada" style={retraso(indice, 40)}>
              <TarjetaCarpeta
                carpeta={carpeta}
                resaltada={encima === carpeta.id}
                onAbrir={() => setCarpetaId(carpeta.id)}
                onSoltar={(fileId) => void mover(fileId, carpeta.id)}
                onEncima={(si) => setEncima(si ? carpeta.id : null)}
              />
            </li>
          ))}
        </ul>
      )}

      {/* Fila de instrumentos: lo que hay delante, cuánto pesa y cómo se mira.
          El filo de luz separa el mando del contenido sin un borde duro. */}
      <div className="filo-luz flex items-center justify-between gap-3 pb-2.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <Rotulo>archivos</Rotulo>
          <span className="font-mono text-sm tabular-nums text-ink">
            {loading ? "—" : files.length}
          </span>
          {!loading && files.length > 0 && (
            <>
              <span className="text-faint" aria-hidden>
                ·
              </span>
              <span className="font-mono text-[11px] tabular-nums text-faint">
                {formatBytes(pesoTotal)}
              </span>
            </>
          )}
          {filtrando && !loading && (
            <span className="truncate text-[11px] text-faint">filtrado</span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5 rounded-xl border border-line bg-surface/60 p-0.5">
          <BotonIcono
            etiqueta="Ver en rejilla"
            aria-pressed={vista === "rejilla"}
            onClick={() => setVista("rejilla")}
            className={vista === "rejilla" ? "bg-accent-soft text-accent-bright" : ""}
          >
            <LayoutGrid size={14} />
          </BotonIcono>
          <BotonIcono
            etiqueta="Ver en lista"
            aria-pressed={vista === "lista"}
            onClick={() => setVista("lista")}
            className={vista === "lista" ? "bg-accent-soft text-accent-bright" : ""}
          >
            <Rows3 size={14} />
          </BotonIcono>
        </div>
      </div>

      {loading ? (
        <Esqueleto vista={vista} />
      ) : files.length === 0 ? (
        filtrando ? (
          <EstadoVacio
            icono={<SearchX size={20} />}
            titulo="Nada coincide con ese filtro"
            pista="Prueba con otras palabras o suelta alguna de las etiquetas activas."
            accion={
              <Boton
                variante="secundario"
                tamano="sm"
                onClick={() => {
                  setSearch("");
                  setSelectedTags([]);
                }}
              >
                Quitar los filtros
              </Boton>
            }
          />
        ) : (
          <EstadoVacio
            icono={<FolderOpen size={20} />}
            titulo={carpetaId ? "Esta carpeta está vacía" : "El almacén está vacío"}
            pista={
              carpetaId
                ? "Arrastra aquí un archivo desde la biblioteca, o súbelo con la carpeta abierta."
                : "Arrastra archivos a la zona de arriba. Se guardan cifrados y se abren siempre por enlace firmado."
            }
          />
        )
      ) : vista === "rejilla" ? (
        <ul className={REJILLA}>
          {files.map((file, indice) => (
            <li key={file.id} className="devup-entrada" style={retraso(indice, 40)}>
              <TarjetaArchivo
                file={file}
                previa={previas[file.id]}
                onAbrir={() => setPreview(file)}
              />
            </li>
          ))}
        </ul>
      ) : (
        // `capa-flotante` y no `panel`: esta biblioteca se escribió (b0360a5,
        // el 13 de agosto) antes de que existieran los tokens de Sala y se
        // quedó opaca, cortando la atmósfera. La composición del mock de la
        // biblioteca ya es la de la vista en rejilla de aquí abajo —tarjeta,
        // etiqueta, tamaño en mono, autor—; no hacía falta rehacerla.
        <div className="capa-flotante overflow-hidden rounded-2xl">
          {/* Cabecera de columnas: en modo lista los números están para
              compararse, y sin rótulo encima no se sabe qué se compara. */}
          <div className="hidden items-center gap-3 border-b border-line px-3 py-2 sm:flex">
            <span className="w-4" aria-hidden />
            <Rotulo className="flex-1">archivo</Rotulo>
            <Rotulo className="w-20 text-right">tamaño</Rotulo>
            <Rotulo className="w-36">subido por</Rotulo>
          </div>
          <ul className="divide-y divide-line/70">
            {files.map((file, indice) => (
              <li key={file.id} className="devup-entrada" style={retraso(indice, 40)}>
                <FilaArchivo file={file} onAbrir={() => setPreview(file)} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview && (
        <FilePreview
          file={preview}
          carpetas={carpetas}
          onMover={async (destino) => {
            await mover(preview.id, destino);
            setPreview(null);
          }}
          onClose={() => setPreview(null)}
          onDeleted={(fileId) => setFiles((current) => current.filter((f) => f.id !== fileId))}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Una miga del camino, que además es sitio donde soltar.
 *
 * El arrastre va con la API nativa de HTML5, como el tablero: la misma forma de
 * hacerlo en los dos sitios de la aplicación donde se arrastra, y ninguna
 * dependencia nueva.
 */
function MigaCarpeta({
  texto,
  activa,
  resaltada,
  onIr,
  onSoltar,
  onEncima,
}: {
  texto: string;
  activa: boolean;
  resaltada: boolean;
  onIr: () => void;
  onSoltar: (fileId: string) => void;
  onEncima: (si: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={onIr}
      onDragOver={(evento) => {
        evento.preventDefault();
        onEncima(true);
      }}
      onDragLeave={() => onEncima(false)}
      onDrop={(evento) => {
        evento.preventDefault();
        onEncima(false);
        const fileId = evento.dataTransfer.getData("text/devup-archivo");
        if (fileId) onSoltar(fileId);
      }}
      className={`presionable flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition-colors
        ${resaltada ? "border-accent/50 bg-accent-soft/50 text-accent" : activa ? "border-line-strong text-ink" : "border-transparent text-muted hover:text-ink"}`}
    >
      {activa ? <FolderOpen size={12} /> : <CornerLeftUp size={12} />}
      {texto}
    </button>
  );
}

/** Una carpeta en la rejilla: se abre al pulsarla y traga lo que se le suelte. */
function TarjetaCarpeta({
  carpeta,
  resaltada,
  onAbrir,
  onSoltar,
  onEncima,
}: {
  carpeta: Carpeta;
  resaltada: boolean;
  onAbrir: () => void;
  onSoltar: (fileId: string) => void;
  onEncima: (si: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={onAbrir}
      onDragOver={(evento) => {
        evento.preventDefault();
        onEncima(true);
      }}
      onDragLeave={() => onEncima(false)}
      onDrop={(evento) => {
        evento.preventDefault();
        onEncima(false);
        const fileId = evento.dataTransfer.getData("text/devup-archivo");
        if (fileId) onSoltar(fileId);
      }}
      className={`capa-flotante elevable group flex h-full w-full items-center gap-3 rounded-2xl p-3 text-left
        transition-colors ${resaltada ? "border-accent/60 bg-accent-soft/30" : "hover:border-line-strong"}`}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-raised/50 text-muted">
        <Folder size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-ink">{carpeta.nombre}</span>
        <span className="mt-0.5 block font-mono text-[10px] tabular-nums text-faint">
          {carpeta.archivos} {carpeta.archivos === 1 ? "archivo" : "archivos"}
          {carpeta.subcarpetas > 0 && ` · ${carpeta.subcarpetas} dentro`}
        </span>
      </span>
    </button>
  );
}

/** El campo para crear una carpeta aquí mismo, sin salir de donde estás. */
function NuevaCarpeta({
  workspaceId,
  padreId,
  onCerrar,
  onCreada,
}: {
  workspaceId: string;
  padreId: string | null;
  onCerrar: () => void;
  onCreada: () => Promise<void> | void;
}) {
  const [nombre, setNombre] = useState("");
  const [enviando, setEnviando] = useState(false);

  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={async (evento) => {
        evento.preventDefault();
        if (nombre.trim().length === 0) return;
        setEnviando(true);
        try {
          await api.post(`/workspaces/${workspaceId}/carpetas`, {
            nombre: nombre.trim(),
            padreId,
          });
          await onCreada();
          onCerrar();
        } finally {
          setEnviando(false);
        }
      }}
    >
      <Entrada
        autoFocus
        value={nombre}
        onChange={(evento) => setNombre(evento.target.value)}
        onKeyDown={(evento) => {
          if (evento.key === "Escape") onCerrar();
        }}
        placeholder="Nombre de la carpeta"
        aria-label="Nombre de la carpeta"
        className="w-48"
      />
      <Boton type="submit" tamano="sm" variante="primario" cargando={enviando}>
        Crear
      </Boton>
      <Boton type="button" tamano="sm" variante="fantasma" onClick={onCerrar}>
        Cancelar
      </Boton>
    </form>
  );
}

/** Tarjeta de la rejilla. Toda ella es el disparador de la previsualización. */
function TarjetaArchivo({
  file,
  previa,
  onAbrir,
}: {
  file: FileRecord;
  /** La URL firmada de la miniatura, si es una imagen y ya llegó. */
  previa?: string;
  onAbrir: () => void;
}) {
  const tipo = TIPOS[kindOf(file.mimeType)];
  const extension = extensionDe(file.name);

  return (
    <button
      type="button"
      onClick={onAbrir}
      draggable
      // El id viaja en un tipo propio y no en `text/plain`: así soltar un
      // archivo del escritorio sobre una carpeta no se confunde con esto.
      onDragStart={(evento) => evento.dataTransfer.setData("text/devup-archivo", file.id)}
      // `elevable` y no `presionable`: la tarjeta entera es el botón, y en
      // globals.css el levantado del hover gana al hundido del pulsado, así que
      // poner las dos deja la pulsación sin respuesta.
      // `capa-flotante` y no `panel` (mismo motivo que el envoltorio de la
      // lista, arriba). Se quita `hover:shadow-[var(--sombra-panel)]`: esa
      // sombra ya la pone `capa-flotante` en reposo, así que la utilidad de
      // Tailwind quedaría compitiendo con una clase sin capa por la misma
      // propiedad y perdería en silencio — la trampa de siempre, evitada antes
      // de que pase en vez de después.
      className="capa-flotante elevable group flex h-full w-full flex-col rounded-2xl p-2.5 text-left
        hover:border-line-strong"
    >
      <span
        className={`relative grid h-24 place-items-center overflow-hidden rounded-xl border ${tipo.pozo}`}
      >
        <span aria-hidden className="rejilla absolute inset-0 opacity-70" />
        {/* LA MINIATURA, QUE ES LA MITAD DE ESTA PANTALLA: doce archivos
            llamados `image.png` se distinguen mirando, no leyendo. Cuando no
            hay —no es imagen, o la firma no llegó— se queda el icono de tipo,
            que es lo que había antes. */}
        {previa ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previa}
            alt=""
            loading="lazy"
            className="absolute inset-0 size-full object-cover transition-transform duration-200
              ease-[var(--ease-out)] motion-safe:group-hover:scale-105"
          />
        ) : (
          <tipo.Icono
            size={24}
            className={`relative transition-transform duration-200 ease-[var(--ease-out)]
              motion-safe:group-hover:scale-110 ${tipo.tinte}`}
          />
        )}
        {extension && (
          <span
            className={`absolute left-2 top-2 rounded-md border border-line-strong/60 bg-canvas/80 px-1.5
              py-0.5 font-mono text-[9px] uppercase leading-none tracking-wide ${tipo.tinte}`}
          >
            {extension}
          </span>
        )}
      </span>

      <span className="mt-2.5 line-clamp-2 break-words text-xs leading-snug text-ink">
        {file.name}
      </span>

      {/* Una grabación es un archivo más —mismas políticas, misma URL
          firmada— pero encontrarla entre cien no lo era: la columna que dice de
          qué llamada salió se escribía desde la 0004 y no la leía nadie. Sin
          esto, buscar «la grabación de la reunión» es mirar nombres uno a uno. */}
      {file.callSessionId && (
        <span
          title="Grabación de una llamada"
          className="mt-2 inline-flex w-fit items-center gap-1 rounded-lg border border-line
            bg-canvas/60 px-1.5 py-0.5 text-[10px] text-muted"
        >
          <Radio size={9} className="shrink-0" />
          Grabación
        </span>
      )}

      <span className="mt-auto flex items-baseline gap-1.5 pt-2 text-[11px]">
        <span className="font-mono tabular-nums text-muted">{formatBytes(file.sizeBytes)}</span>
        <span className="text-faint" aria-hidden>
          ·
        </span>
        <span className="min-w-0 truncate text-faint">{file.uploadedByName}</span>
      </span>

      {file.tags.length > 0 && (
        <span className="mt-2 flex flex-wrap gap-1">
          {file.tags.slice(0, 3).map((tag) => (
            <TagBadge key={tag.id} tag={tag} />
          ))}
        </span>
      )}
    </button>
  );
}

/** Fila de la vista lista: densa, con las cifras alineadas en su columna. */
function FilaArchivo({ file, onAbrir }: { file: FileRecord; onAbrir: () => void }) {
  const tipo = TIPOS[kindOf(file.mimeType)];

  return (
    <button
      type="button"
      onClick={onAbrir}
      className="presionable flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-raised/60"
    >
      <tipo.Icono size={15} className={`shrink-0 ${tipo.tinte}`} />

      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="min-w-0 truncate text-xs text-ink">{file.name}</span>
        {file.callSessionId && (
          <Radio size={10} className="shrink-0 text-faint" aria-label="Grabación de una llamada" />
        )}
        {file.tags.slice(0, 2).map((tag) => (
          <TagBadge key={tag.id} tag={tag} />
        ))}
      </span>

      <span className="w-20 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted">
        {formatBytes(file.sizeBytes)}
      </span>
      <span className="hidden w-36 shrink-0 truncate text-[11px] text-faint sm:block">
        {file.uploadedByName}
      </span>
    </button>
  );
}

/** Esqueleto con la forma exacta de lo que va a llegar, para que no salte nada. */
function Esqueleto({ vista }: { vista: "rejilla" | "lista" }) {
  const huecos = Array.from({ length: vista === "rejilla" ? 10 : 6 }, (_, i) => i);

  // El mismo material que la versión ya cargada (`capa-flotante`): si el
  // esqueleto fuera opaco, la biblioteca cambiaría de material al llegar los
  // archivos y la pantalla se sentiría como que "acaba de aparecer algo
  // distinto" en vez de haberse llenado.
  if (vista === "lista") {
    return (
      <div className="capa-flotante divide-y divide-line/70 overflow-hidden rounded-2xl">
        {huecos.map((i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-2.5">
            <span className="devup-esqueleto size-4 rounded" />
            <span className="devup-esqueleto h-3 flex-1 rounded" />
            <span className="devup-esqueleto h-3 w-16 rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={REJILLA} aria-hidden>
      {huecos.map((i) => (
        <div key={i} className="capa-flotante rounded-2xl p-2.5">
          <span className="devup-esqueleto block h-24 rounded-xl" />
          <span className="devup-esqueleto mt-2.5 block h-3 w-4/5 rounded" />
          <span className="devup-esqueleto mt-2 block h-2.5 w-1/2 rounded" />
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Los ocho colores de etiqueta, escritos uno a uno por el mismo motivo que en
 * TagBadge: Tailwind no puede generar una clase que solo existe en tiempo de
 * ejecución. El `valor` es lo que viaja a la API — no se toca.
 */
const COLORES = [
  { valor: "slate", muestra: "bg-slate-400" },
  { valor: "blue", muestra: "bg-blue-400" },
  { valor: "green", muestra: "bg-emerald-400" },
  { valor: "amber", muestra: "bg-amber-400" },
  { valor: "red", muestra: "bg-red-400" },
  { valor: "violet", muestra: "bg-violet-400" },
  { valor: "pink", muestra: "bg-pink-400" },
  { valor: "teal", muestra: "bg-teal-400" },
] as const;

function NuevaEtiqueta({
  organizationId,
  onCreated,
}: {
  organizationId: string;
  onCreated: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState("blue");

  return (
    <>
      <Boton variante="secundario" icono={<Plus size={14} />} onClick={() => setOpen(true)}>
        Etiqueta
      </Boton>

      {open && (
        <Dialogo
          titulo="Nueva etiqueta"
          descripcion="Las etiquetas son de la organización: quien tenga acceso al workspace las verá."
          ancho="sm"
          onCerrar={() => setOpen(false)}
        >
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              await api.post(`/organizations/${organizationId}/tags`, { name, color });
              setName("");
              setOpen(false);
              await onCreated();
            }}
            className="space-y-4"
          >
            <Field label="Nombre" value={name} onChange={setName} placeholder="contratos" autoFocus />

            <div>
              <span className="mb-2 block">
                <Rotulo>color</Rotulo>
              </span>
              <div className="flex flex-wrap gap-1.5">
                {COLORES.map((opcion) => (
                  <button
                    key={opcion.valor}
                    type="button"
                    aria-label={`Color ${opcion.valor}`}
                    aria-pressed={color === opcion.valor}
                    onClick={() => setColor(opcion.valor)}
                    className={`presionable grid size-8 place-items-center rounded-lg border
                      ${opcion.muestra}
                      ${
                        color === opcion.valor
                          ? "border-ink/70 ring-1 ring-ink/40"
                          : "border-transparent opacity-60 hover:opacity-100"
                      }`}
                  >
                    {color === opcion.valor && <Check size={14} className="text-canvas" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Boton variante="fantasma" type="button" onClick={() => setOpen(false)}>
                Cancelar
              </Boton>
              <Boton variante="primario" type="submit" disabled={name.trim().length === 0}>
                Crear
              </Boton>
            </div>
          </form>
        </Dialogo>
      )}
    </>
  );
}
