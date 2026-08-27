# Walkthrough — Ejecución de Correcciones FocusData

Se han completado y verificado todas las fases (Fase 0 a Fase 6) de [`PLAN_CORRECCIONES.md`](file:///c:/Users/cristobal/Desktop/Proyectos/FocusData/PLAN_CORRECCIONES.md) sin alterar el esquema de la base de datos, sin pérdida de datos y manteniendo un commit independiente por cada fase.

---

## Fases Ejecutadas y Commits Realizados

| Fase | Descripción | Archivos Modificados | Commit |
|---|---|---|---|
| **Fase 0** | Pre-vuelo: Backup de `study.db` y verificación del total (137 registros). | — | *(Pre-vuelo)* |
| **Fase 1** | Cierre de conexiones SQLite con `closing()`, validación estricta en POSTs, índices en `init_db()` y ajuste de `minLength` en login/registro. | [`app.py`](file:///c:/Users/cristobal/Desktop/Proyectos/FocusData/app.py), [`static/login.html`](file:///c:/Users/cristobal/Desktop/Proyectos/FocusData/static/login.html) | `355d1b5` |
| **Fase 2** | Endurecimiento de cookies de sesión (`HttpOnly`, `SameSite=Lax`, `Secure` vía env), limitador de fuerza bruta en login (HTTP 429) y exposición de `id` en `/api/me`. | [`app.py`](file:///c:/Users/cristobal/Desktop/Proyectos/FocusData/app.py), [`README.md`](file:///c:/Users/cristobal/Desktop/Proyectos/FocusData/README.md) | `e50ae52` |
| **Fase 3** | Frontend: Aislamiento del `localStorage` por usuario (`studylog_v1_u<id>`) y archivado seguro del blob anterior. | [`static/index.html`](file:///c:/Users/cristobal/Desktop/Proyectos/FocusData/static/index.html) | `da90839` |
| **Fase 4** | Frontend: Función `esc()` y escapeo de nombres de tipo y carpeta en plantillas `innerHTML` para mitigar vectores XSS. | [`static/index.html`](file:///c:/Users/cristobal/Desktop/Proyectos/FocusData/static/index.html) | `7bfa010` |
| **Fase 5** | Frontend: Corrección del filtro de días en historial comparando cadenas `YYYY-MM-DD` (`localDateStr`) para evitar desfase UTC. | [`static/index.html`](file:///c:/Users/cristobal/Desktop/Proyectos/FocusData/static/index.html) | `621686c` |
| **Fase 6** | Backend y Frontend: Reconexión de `DELETE /api/sessions/all` en `clearLog()`, descarga directa de CSV con BOM desde `/api/export/csv` y protección contra inyección de fórmulas CSV (`_csv_safe`). | [`app.py`](file:///c:/Users/cristobal/Desktop/Proyectos/FocusData/app.py), [`static/index.html`](file:///c:/Users/cristobal/Desktop/Proyectos/FocusData/static/index.html) | `63ddd8f` |

---

## Verificaciones Realizadas

### 1. Integridad de la Base de Datos
- **Total inicial:** 137 sesiones.
- **Total final:** 137 sesiones (`python ver_db.py`).
- Cero pérdida de datos y cero duplicados.

### 2. Índices e Inicialización
- `init_db()` ejecuta exitosamente:
  ```python
  CREATE INDEX IF NOT EXISTS idx_sessions_user_date ON sessions(user_id, date)
  CREATE INDEX IF NOT EXISTS idx_sessions_user_ts   ON sessions(user_id, ts)
  CREATE INDEX IF NOT EXISTS idx_categories_user    ON categories(user_id)
  ```

### 3. Freno de Fuerza Bruta en Login
- Verificado con test automatizado: tras 8 intentos fallidos consecutivos, el noveno intento responde:
  ```json
  HTTP 429 Too Many Requests
  {"error": "Demasiados intentos fallidos. Reintenta en 300 segundos."}
  ```

### 4. Seguridad de Cookies
- `SESSION_COOKIE_HTTPONLY = True`
- `SESSION_COOKIE_SAMESITE = "Lax"`
- `SESSION_COOKIE_SECURE` activable con variable de entorno `FOCUSDATA_HTTPS=1` (compatible en local con `http://`).

### 5. Historial de Git
```text
63ddd8f Reconecta los endpoints de borrado y exportación; protege el CSV de inyección de fórmulas
621686c Frontend: corrige el desfase de zona horaria del filtro de días
7bfa010 Frontend: escapa nombres de tipo y carpeta en las plantillas HTML
da90839 Frontend: caché de historial aislada por usuario en localStorage
e50ae52 Backend: cookie de sesión endurecida y freno de fuerza bruta en el login
355d1b5 Backend: cierra conexiones SQLite, valida entrada de la API y añade índices
```
