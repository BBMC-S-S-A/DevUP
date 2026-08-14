"use client";

import { CalendarDays, Loader2, Plus, Trash2, User, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type BoardColumn,
  type OrganizationMember,
  type Tag,
  type Task,
  api,
} from "@/lib/api";
import { TagBadge } from "@/components/files/TagBadge";

/**
 * Tablero de tareas del workspace.
 *
 * El arrastre va con la API nativa de HTML5 en vez de una librería: mover
 * tarjetas entre columnas es lo único que hace falta, y una dependencia más
 * para eso no se paga sola.
 *
 * Al soltar se actualiza el estado local antes de llamar a la API. Si la
 * llamada falla se recarga el tablero entero y la tarjeta vuelve a su sitio:
 * es más honesto que dejarla donde el usuario la soltó fingiendo que se
 * guardó.
 */
export function TaskBoard({
  workspaceId,
  organizationId,
}: {
  workspaceId: string;
  organizationId: string;
}) {
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Task | null>(null);
  const dragging = useRef<{ taskId: string; fromColumn: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [board, memberList, tagList] = await Promise.all([
        api.get<{ columns: BoardColumn[] }>(`/workspaces/${workspaceId}/board`),
        api.get<{ members: OrganizationMember[] }>(`/organizations/${organizationId}/members`),
        api.get<{ tags: Tag[] }>(`/organizations/${organizationId}/tags`),
      ]);
      setColumns(board.columns);
      setMembers(memberList.members);
      setTags(tagList.tags);
      setError(null);
    } catch {
      setError("no se pudo cargar el tablero");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const drop = async (columnId: string, afterTaskId: string | null) => {
    const info = dragging.current;
    dragging.current = null;
    setDropTarget(null);
    if (!info) return;

    // Movimiento optimista: la tarjeta salta donde se soltó y la petición va
    // detrás.
    setColumns((current) => {
      const task = current.flatMap((c) => c.tasks).find((t) => t.id === info.taskId);
      if (!task) return current;
      return current.map((column) => {
        const without = column.tasks.filter((t) => t.id !== info.taskId);
        if (column.id !== columnId) return { ...column, tasks: without };
        const index = afterTaskId ? without.findIndex((t) => t.id === afterTaskId) + 1 : 0;
        return {
          ...column,
          tasks: [...without.slice(0, index), { ...task, columnId }, ...without.slice(index)],
        };
      });
    });

    try {
      await api.post(`/tasks/${info.taskId}/move`, { columnId, afterTaskId });
    } catch {
      setError("no se pudo mover la tarjeta");
      await load();
    }
  };

  if (loading) {
    return (
      <div className="grid place-items-center py-16">
        <Loader2 className="animate-spin text-faint" size={20} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns.map((column) => (
          <section
            key={column.id}
            onDragOver={(event) => {
              event.preventDefault();
              setDropTarget(column.id);
            }}
            onDragLeave={() => setDropTarget((current) => (current === column.id ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              void drop(column.id, null);
            }}
            className={`flex w-72 shrink-0 flex-col rounded-xl border bg-surface/60 transition ${
              dropTarget === column.id ? "border-accent/50 bg-accent-soft/20" : "border-line"
            }`}
          >
            <header className="flex items-center justify-between px-3 py-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                {column.name}
              </h3>
              <span className="rounded-full bg-raised px-1.5 py-0.5 text-[10px] text-faint">
                {column.tasks.length}
              </span>
            </header>

            <ul className="flex-1 space-y-2 px-2 pb-2">
              {column.tasks.map((task) => (
                <li
                  key={task.id}
                  draggable
                  onDragStart={() => {
                    dragging.current = { taskId: task.id, fromColumn: column.id };
                  }}
                  onDrop={(event) => {
                    // Soltar sobre una tarjeta la coloca justo debajo de ella;
                    // sin esto solo se podría añadir al principio de la columna.
                    event.preventDefault();
                    event.stopPropagation();
                    void drop(column.id, task.id);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                >
                  <button
                    type="button"
                    onClick={() => setOpen(task)}
                    className="w-full cursor-grab rounded-lg border border-line bg-surface p-3 text-left transition hover:border-line-strong active:cursor-grabbing"
                  >
                    <p className="text-sm leading-snug">{task.title}</p>

                    {task.tags.length > 0 && (
                      <span className="mt-2 flex flex-wrap gap-1">
                        {task.tags.map((tag) => (
                          <TagBadge key={tag.id} tag={tag} />
                        ))}
                      </span>
                    )}

                    {(task.assigneeName || task.dueDate) && (
                      <span className="mt-2 flex items-center gap-3 text-[11px] text-faint">
                        {task.assigneeName && (
                          <span className="flex items-center gap-1">
                            <User size={11} />
                            {task.assigneeName}
                          </span>
                        )}
                        {task.dueDate && (
                          <span className="flex items-center gap-1">
                            <CalendarDays size={11} />
                            {task.dueDate}
                          </span>
                        )}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>

            <NewTask
              workspaceId={workspaceId}
              columnId={column.id}
              onCreated={(task) =>
                setColumns((current) =>
                  current.map((c) => (c.id === column.id ? { ...c, tasks: [...c.tasks, task] } : c)),
                )
              }
            />
          </section>
        ))}

        <NewColumn workspaceId={workspaceId} onCreated={load} />
      </div>

      {open && (
        <TaskDialog
          task={open}
          members={members}
          tags={tags}
          onClose={() => setOpen(null)}
          onSaved={async () => {
            setOpen(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function NewTask({
  workspaceId,
  columnId,
  onCreated,
}: {
  workspaceId: string;
  columnId: string;
  onCreated: (task: Task) => void;
}) {
  const [title, setTitle] = useState("");
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="m-2 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-faint transition hover:bg-raised hover:text-muted"
      >
        <Plus size={13} />
        Nueva tarea
      </button>
    );
  }

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const { task } = await api.post<{ task: Task }>(`/workspaces/${workspaceId}/tasks`, {
          columnId,
          title,
        });
        onCreated(task);
        setTitle("");
        setOpen(false);
      }}
      className="m-2"
    >
      <textarea
        autoFocus
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
          if (event.key === "Escape") setOpen(false);
        }}
        rows={2}
        placeholder="Qué hay que hacer"
        className="w-full resize-none rounded-lg border border-line bg-canvas p-2 text-sm outline-none placeholder:text-faint focus:border-accent/60"
      />
      <div className="mt-1.5 flex gap-1.5">
        <button
          type="submit"
          disabled={title.trim().length === 0}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-canvas disabled:opacity-40"
        >
          Añadir
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-line px-2 py-1.5 text-xs text-muted"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

function NewColumn({
  workspaceId,
  onCreated,
}: {
  workspaceId: string;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-10 w-56 shrink-0 items-center gap-2 rounded-xl border border-dashed border-line px-3 text-sm text-faint transition hover:border-line-strong hover:text-muted"
      >
        <Plus size={15} />
        Nueva columna
      </button>
    );
  }

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        await api.post(`/workspaces/${workspaceId}/columns`, { name });
        setName("");
        setOpen(false);
        await onCreated();
      }}
      className="w-56 shrink-0"
    >
      <input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Nombre de la columna"
        className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none placeholder:text-faint focus:border-accent/60"
      />
    </form>
  );
}

function TaskDialog({
  task,
  members,
  tags,
  onClose,
  onSaved,
}: {
  task: Task;
  members: OrganizationMember[];
  tags: Tag[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [assigneeId, setAssigneeId] = useState(task.assigneeId ?? "");
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const [tagIds, setTagIds] = useState(task.tags.map((t) => t.id));
  const [busy, setBusy] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6"
      onClick={onClose}
      role="presentation"
    >
      <form
        onClick={(event) => event.stopPropagation()}
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            await api.patch(`/tasks/${task.id}`, {
              title,
              description,
              assigneeId: assigneeId || null,
              dueDate: dueDate || null,
              tagIds,
            });
            await onSaved();
          } finally {
            setBusy(false);
          }
        }}
        className="w-full max-w-lg space-y-4 rounded-2xl border border-line bg-surface p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent text-base font-medium outline-none focus:border-line focus:bg-canvas focus:px-2 focus:py-1"
          />
          <button type="button" onClick={onClose} className="text-faint hover:text-ink">
            <X size={16} />
          </button>
        </div>

        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          placeholder="Detalles, contexto, criterio de aceptación…"
          className="w-full resize-none rounded-lg border border-line bg-canvas p-3 text-sm outline-none placeholder:text-faint focus:border-accent/60"
        />

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-muted">Responsable</span>
            <select
              value={assigneeId}
              onChange={(event) => setAssigneeId(event.target.value)}
              className="w-full rounded-lg border border-line bg-canvas px-2 py-2 text-sm outline-none"
            >
              <option value="">Sin asignar</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.displayName}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs text-muted">Fecha límite</span>
            <input
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className="w-full rounded-lg border border-line bg-canvas px-2 py-2 text-sm outline-none"
            />
          </label>
        </div>

        {tags.length > 0 && (
          <div>
            <span className="mb-1.5 block text-xs text-muted">Etiquetas</span>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <TagBadge
                  key={tag.id}
                  tag={tag}
                  active={tagIds.includes(tag.id)}
                  onClick={() =>
                    setTagIds((current) =>
                      current.includes(tag.id)
                        ? current.filter((id) => id !== tag.id)
                        : [...current, tag.id],
                    )
                  }
                />
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={async () => {
              if (!window.confirm(`¿Eliminar «${task.title}»?`)) return;
              await api.delete(`/tasks/${task.id}`);
              await onSaved();
            }}
            className="flex items-center gap-1.5 text-xs text-faint transition hover:text-danger"
          >
            <Trash2 size={13} />
            Eliminar
          </button>

          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-canvas disabled:opacity-40"
          >
            Guardar
          </button>
        </div>
      </form>
    </div>
  );
}
