# Silbato — Control de partido de HaxBall para Discord

Sitio web (HTML + CSS + JS puro, sin backend) para arbitrar partidos de HaxBall en vivo:
marcador, goles, tarjetas, offsides, tiempos, y un webhook de Discord que se actualiza solo
cada pocos segundos con una imagen del marcador. Incluye un sistema de ligas y eliminatorias
para armar fixtures y torneos.

## Cómo usarlo

1. Abrí `index.html` en el navegador (podés simplemente hacer doble clic, o subir la carpeta
   a un hosting).
2. Andá a la pestaña **Ajustes** y pegá la URL de tu webhook de Discord.
   - En Discord: Configuración del canal → Integraciones → Webhooks → Crear webhook → Copiar URL.
   - Tocá "Probar conexión" para confirmar que funciona (te llega un mensaje de prueba).
3. En la pestaña **Partido**, cargá los nombres y colores de los equipos y tocá "Crear partido".
4. Usá los botones de Iniciar / Pausar / Entretiempo / Finalizar, Goles, Tarjetas y Offside.
   La imagen de la izquierda es exactamente la que se manda a Discord, y se reenvía sola cada
   5 segundos (configurable en Ajustes) mientras el partido está en juego, además de cada vez
   que ocurre un evento.
5. En la pestaña **Ligas** podés crear una liga (todos contra todos, con tabla de posiciones)
   o una eliminatoria directa (bracket tipo Challonge). Desde cualquier partido del fixture
   podés tocar "Jugar en vivo" para cargarlo directo en la pantalla de Partido, o "Cargar
   resultado" para anotarlo manualmente si ya se jugó afuera de la app.

## Cómo publicarlo como sitio web real

Esta carpeta son 3 archivos estáticos (`index.html`, `style.css`, `app.js`). Para tenerlo en
una URL propia, la forma más simple es GitHub Pages:

1. Creá un repositorio nuevo en GitHub y subí estos 3 archivos (más este README si querés).
2. En el repo: Settings → Pages → Source: rama `main`, carpeta `/ (root)` → Save.
3. En un par de minutos tu sitio queda en `https://tu-usuario.github.io/tu-repo/`.

También podés arrastrar la carpeta a [Netlify Drop](https://app.netlify.com/drop) para
tenerlo online en segundos, sin cuenta de GitHub.

## Dónde vive la información

Todo se guarda en el `localStorage` del navegador (webhook, ajustes, historial, ligas, el
partido en curso). Es información **local a ese navegador/dispositivo** — no hay servidor ni
base de datos. Si abrís el sitio en otra computadora o borrás los datos del navegador, no vas
a ver lo que cargaste antes. Si en algún momento querés que varios árbitros compartan el mismo
historial de ligas desde distintos dispositivos, se necesitaría agregar un backend con una
base de datos — avisame si eso te interesa y lo armamos como siguiente paso.

## Notas técnicas

- El envío a Discord se hace con `fetch` directo desde el navegador al webhook (Discord permite
  esto vía CORS). No necesitás un servidor intermedio.
- Cada actualización reemplaza la imagen anterior del mismo mensaje (se edita el mensaje, no se
  manda uno nuevo cada vez), así el canal no se llena de mensajes.
- Si el webhook falla (URL mal copiada, canal borrado, sin internet), vas a ver el aviso en rojo
  debajo de la vista previa del marcador; el partido sigue funcionando igual en la pantalla,
  solo no se actualiza Discord hasta que se resuelva.

## Posibles mejoras futuras

- Subir escudos/logos de equipo (agregar carga de imagen y dibujarla en el canvas).
- Doble eliminatoria (actualmente es solo eliminación simple).
- Exportar/importar ligas e historial como archivo, para pasarlos entre dispositivos.
- Estadísticas de jugadores individuales (goleadores, tarjetas por jugador).
