# Fotos de las escenas

Cada escena de FocusData tiene **tres colores propios** (definidos en
`static/js/scenes.js`) que pintan el ambiente de fondo y el anillo del
temporizador. La foto de esta carpeta se superpone con un fundido si existe; si
no existe, la escena sigue funcionando solo con sus colores. Nunca se rompe nada
por dejar una foto sin poner.

Los fondos que sube cada usuario **no** van aquí: se guardan en `uploads/` (fuera
de `static/`) y solo los ve su dueño.

## Nombres de archivo

El nombre debe ser exactamente el id de la escena, en `.jpg`. Las escenas con
miniatura usan además `<id>-thumb.jpg` en los menús y en la galería de
Configuración.

| Archivo                               | Escena en la interfaz |
| ------------------------------------- | --------------------- |
| `road.jpg` + `road-thumb.jpg`         | Carretera             |
| `blossom.jpg` + `blossom-thumb.jpg`   | Cerezos               |
| `dusk.jpg`                            | Atardecer (opcional)  |
| `ocean.jpg`                           | Océano (opcional)     |
| `forest.jpg`                          | Bosque (opcional)     |

`Nebulosa` y `Sin escena` no usan foto: son solo color. Si añades una escena
nueva, regístrala también en `VALID_SCENES` de `app.py`.

## Especificaciones

- **Formato**: JPG.
- **Resolución**: 2560×1440 es suficiente. Más grande no se nota y pesa el doble.
  Miniatura: 480×270.
- **Peso**: apunta a **~450 KB** por foto y **~30 KB** por miniatura. La app carga
  la foto de la escena activa en cada arranque, así que el peso se paga en cada visita.
- **Encuadre**: la imagen se recorta con `cover` y hace un zoom lento de hasta el
  9 %. Deja aire en los bordes: lo que esté pegado al borde se sale.
- **Tono**: encima va un velo que oscurece en modo oscuro y aclara solo el centro
  en modo claro. Una foto muy clara y muy contrastada (cielo blanco, focos) hará
  que el texto se lea peor.

Para convertir y optimizar:

```
# con ImageMagick
magick original.jpg -resize 2560x1440^ -gravity center -extent 2560x1440 -quality 62 road.jpg
magick original.jpg -resize 480x270^ -gravity center -extent 480x270 -quality 72 road-thumb.jpg
```
