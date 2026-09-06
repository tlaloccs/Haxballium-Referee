# Haxballium Referee — Control de partido de HaxBall para Discord

Sitio web (HTML + CSS + JS puro, sin backend) para arbitrar partidos de HaxBall en vivo, con
ligas, grupos, eliminatorias simples y dobles, planteles de jugadores y estadísticas — todo
transmitido a Discord vía webhook con una imagen del marcador que se actualiza sola.

## Novedades v1.1

- **Escudos de equipo**: subís una imagen al crear el equipo (partido suelto o dentro de una
  liga) y se dibuja en el marcador.
- **Doble eliminación**: además de la eliminatoria simple, ahora hay un formato de doble
  eliminación con cuadro de ganadores, cuadro de perdedores y gran final (con revancha si
  hace falta).
- **Exportar / Importar**: en Ajustes → Copia de seguridad podés bajar un archivo con todas
  tus ligas e historial, y volver a subirlo en otro dispositivo o navegador.
- **Goleadores y tarjetas nominales**: al cargar un gol, amarilla, roja u offside te pregunta
  el nombre del jugador (opcional, con autocompletado si el equipo tiene plantel cargado). Si
  un jugador recibe una segunda amarilla en el mismo partido, se marca como "doble amarilla"
  y se le suma la roja automáticamente.
- **Grupos**: el formato Liga ahora permite elegir cuántos grupos tiene la competición (por
  defecto 1, sin límite) y a qué grupo va cada equipo. Cada grupo tiene su propia tabla y
  fixture de todos-contra-todos.
- **Etiquetas de posición**: en la tabla de cada grupo podés crear etiquetas con nombre y
  color propios (por ejemplo "Clasifica a semis"), y asignarlas a cualquier puesto de la
  tabla. Por defecto no hay ninguna — las agregás vos manualmente.
- **Planteles y estadísticas por jugador**: cada equipo de una liga tiene una pestaña de
  Planteles donde agregás jugadores y les cargás manualmente goles, asistencias, amarillas
  y rojas acumuladas.
- **Interfaz renovada**: mismo esquema de colores (verde/blanco/negro) pero con más
  jerarquía visual, sombras, tipografía y detalles pensados para que se vea profesional.
- **Varios webhooks**: guardá uno por canal/servidor de Discord con un nombre, y elegí a
  cuál transmitir cada partido o cada liga antes de arrancar.

## Cómo usarlo

1. Abrí `index.html`, o subí la carpeta a tu hosting (ver más abajo).
2. En **Ajustes → Webhooks de Discord**, agregá uno o más webhooks (nombre + URL). Podés
   probarlos individualmente con el botón "Probar".
3. En **Partido**, elegí a qué webhook transmitir, cargá equipos (con escudo opcional) y
   creá el partido. Los botones de gol/tarjeta/offside te van a preguntar el nombre del
   jugador (podés dejarlo en blanco si no lo tenés a mano).
4. En **Ligas**, creá una competición: elegí formato (Liga, Eliminatoria simple o Doble
   eliminación), cuántos grupos (si es Liga) y a qué webhook transmitir. Agregá los equipos
   uno por uno, eligiendo su grupo. Desde el fixture o el bracket podés tocar "Jugar en
   vivo" (te pregunta a qué webhook transmitir ese partido puntual) o cargar el resultado
   a mano si ya se jugó.
5. En la pestaña **Planteles** de cada liga agregás jugadores por equipo y les editás sus
   estadísticas manualmente. En la pestaña **Tabla**, el botón "🏷 Etiquetas" te deja crear,
   renombrar, recolorear o borrar etiquetas y asignarlas a cualquier puesto.

## Cómo publicarlo (gratis, sin exponer el código en un repositorio)

La forma más simple es [Netlify Drop](https://app.netlify.com/drop): arrastrás esta carpeta
y te da una URL al toque, sin cuenta ni repositorio de por medio. Para actualizaciones
futuras, reclamá el sitio ("Claim this site") una vez y después arrastrá la carpeta
actualizada en la pestaña "Deploys" de ese mismo sitio — mantiene la misma URL.

Nota: como cualquier sitio web sin backend, el código HTML/CSS/JS siempre puede verse con
"Ver código fuente" del navegador por cualquiera que visite la página — eso no depende de
dónde lo hostees. Lo que sí evitás con Netlify Drop es tener un repositorio público en
GitHub donde el código quede organizado y buscable.

## Dónde vive la información

Todo se guarda en el `localStorage` del navegador (webhooks, ligas, historial, planteles,
etiquetas, el partido en curso). Es información local a ese navegador/dispositivo. Usá
Exportar/Importar (en Ajustes) para pasar tus datos a otro dispositivo.

## Notas técnicas y límites conocidos

- El envío a Discord se hace con `fetch` directo desde el navegador (Discord permite CORS
  en sus webhooks). Cada actualización edita el mismo mensaje, no crea uno nuevo.
- Los escudos se guardan como imagen achicada (128×128) en base64 dentro del mismo
  `localStorage`; evitá subir demasiadas fotos de alta resolución para no acercarte al
  límite de espacio del navegador (~5MB).
- La doble eliminación funciona mejor con una cantidad de equipos potencia de 2 (4, 8, 16,
  32). Con otras cantidades se usan pases directos ("byes") para completar el cuadro; en
  casos muy irregulares de cantidad de equipos, algunos cruces del cuadro de perdedores
  pueden quedar vacíos antes de tiempo. Si te pasa, avisame y lo afinamos para tu caso.
- Las estadísticas de jugadores (goles, asistencias, tarjetas) son manuales — vos las
  cargás y editás desde la pestaña Planteles; no se completan solas a partir de los
  eventos del partido en vivo.

## Posibles mejoras futuras

- Auto-completar las estadísticas de plantel a partir de los eventos del partido en vivo.
- Sub-torneos (grupos que alimentan automáticamente una eliminatoria posterior).
- Estadísticas agregadas de la competición completa (goleador general, etc.).
