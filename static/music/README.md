# Pistas de música

La música de concentración de FocusData trae **siete sonidos que se generan en el
navegador** con Web Audio (Lo-fi, Ambiente, Lluvia, Bosque, Olas, Chimenea y Ruido marrón): no
necesitan archivos y funcionan sin conexión. Están definidos en `static/js/music.js`.

Esta carpeta sirve para añadir **pistas propias**: canciones grabadas de lo-fi, piano, etc. Aparecen
en el panel de música, bajo «Pistas», y se reproducen en bucle.

## Cómo añadir una pista

1. Copia el archivo de audio en esta carpeta, por ejemplo `piano.mp3`.
2. Decláralo en `tracks.json`:

```json
[
  { "id": "piano", "label": "Piano", "hint": "suave y lento", "file": "piano.mp3", "colors": ["#94A3B8", "#334155"] }
]
```

| Campo    | Obligatorio | Descripción |
| -------- | ----------- | ----------- |
| `id`     | sí          | Minúsculas, números y guiones (máx. 30). Se guarda en el navegador del usuario: no lo cambies después |
| `file`   | sí          | Nombre del archivo en esta carpeta: `.mp3`, `.ogg`, `.oga`, `.m4a`, `.opus` o `.webm` |
| `label`  | no          | Nombre visible (máx. 30). Si falta, se usa el `id` |
| `hint`   | no          | Texto pequeño bajo el nombre (máx. 30). Por defecto, «pista» |
| `colors` | no          | Dos colores `#rrggbb` para el degradado de la miniatura |

Las entradas que no cumplan el formato se ignoran. Si el archivo no existe, la app
avisa al elegir la pista y vuelve a «Sin música».

## Especificaciones

- **Formato**: MP3 a 128–160 kbps es suficiente para música de fondo.
- **Peso**: una pista de 3–4 minutos ronda los 4–5 MB. Se descarga cuando el usuario
  la elige, no al abrir la app.
- **Bucle**: la pista se repite. Si no está pensada para repetirse, se notará el corte
  al volver al principio.
- **Volumen**: normaliza las pistas a un nivel parecido (por ejemplo, −16 LUFS) para que
  no suenen mucho más fuertes que los sonidos generados.

## Licencias

Estos archivos se sirven públicamente desde `/static`. Usa solo música que puedas
redistribuir: tuya, de dominio público (CC0) o con una licencia que lo permita. Revisa
la licencia de cada pista antes de subirla y, si pide atribución, añádela aquí.
