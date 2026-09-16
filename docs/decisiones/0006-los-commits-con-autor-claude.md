# 0006 · Los 75 commits con autor «Claude» en el tronco

16 de septiembre de 2026. Cierra la tarjeta «Decidir · Los 75 commits con autor
«Claude» en el tronco».

**Decisión: no se reescriben.** La limpieza cuenta desde el PR #67 hacia
delante, que es lo que ya está pasando.

---

## Lo que hay, medido

| | |
|---|---|
| Commits en la rama | 408 |
| Con autor `Claude <noreply@anthropic.com>` | **75** |
| Fechas | del 16 de agosto al 13 de septiembre de 2026 |
| Primer commit afectado | `666042d8` |
| **Ramas remotas que lo contienen** | **25 de 30** |
| Commits por encima de él | 513 |
| PR abiertas ahora mismo | ninguna |
| Visibilidad del repositorio | **público** |

---

## Por qué no se reescribe

**1. No son 75 commits: son 25 ramas.** Cambiar el autor cambia el
identificador de un commit y el de todo lo que venga detrás. El primero
afectado está en 25 de las 30 ramas remotas, así que reescribirlo las invalida
todas: cada persona vuelve a clonar, y cualquier rama viva hay que rehacerla
sobre la historia nueva. La tarjeta hablaba de «la rama de la otra sesión»; son
veinticinco.

**2. El repositorio es público, así que no se borra nada.** La tarjeta daba por
hecho que era privado, y no lo es. En un repositorio público los objetos viejos
siguen alcanzables por su identificador —y a través de cualquier bifurcación—
mucho después de reescribir. O sea que la reescritura **no quita** la autoría de
«Claude» del registro público: solo cambia lo que enseña la rama de hoy. Se paga
el precio entero sin obtener lo que se buscaba.

**3. Ponerles un nombre sería inventarlo.** Los 75 llevan «Claude» también como
*committer* — comprobado, los 75 sin excepción. No queda rastro de qué sesión
los encargó, así que atribuirlos a una persona le adjudicaría trabajo que pudo
salir de la sesión de otra. Un registro honesto con una herramienta como autor
es mejor que uno limpio con el autor equivocado.

**4. Lo que de verdad importaba ya está arreglado.** Desde el PR #67 los commits
van a nombre de quien encarga el trabajo y sin líneas de atribución. El problema
era el flujo, y el flujo ya no lo produce.

---

## Si aun así se quisiera reescribir

No hace falta improvisarlo el día que se decida. El plan es este, y el orden no
es opcional:

1. **Avisar la víspera.** Todo el mundo empuja lo que tenga y no empieza nada.
2. **Comprobar que no queda trabajo sin empujar** en ningún portátil. Esto no lo
   puede verificar nadie desde fuera: lo dice cada uno.
3. Reescribir con `git filter-repo --mailmap`, no con `filter-branch` (más lento
   y con trampas conocidas).
4. `push --force-with-lease` de **las 25 ramas**, no solo del tronco.
5. Cada persona **vuelve a clonar**. No basta con `git pull`: la historia es
   otra.
6. Comprobar que el despliegue sigue apuntando a la rama correcta — el workflow
   la nombra explícitamente.

Y sabiendo que el punto 2 del apartado anterior sigue siendo cierto: el registro
público no se limpia con esto.

---

## Lo que no vuelve a pasar, decida lo que se decida

Los commits nuevos llevan el nombre de quien pide el trabajo y ninguna línea de
atribución. Está en las preferencias del entorno y se cumple desde el PR #67.
