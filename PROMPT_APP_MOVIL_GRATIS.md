# Prompt de ejecución — FocusData Móvil, **modo gratuito** (solo Android)

> **Qué es este documento:** un complemento de [PROMPT_APP_MOVIL.md](PROMPT_APP_MOVIL.md)
> para llegar a tener la app funcionando en un teléfono Android **sin pagar nada**: sin
> cuenta de Apple Developer, sin cuenta de Google Play, sin planes de pago de EAS ni de
> servidor.
>
> **Cómo usarlo:** abre el agente en la raíz del repositorio `FocusData` y pégale:
> *"Lee `PROMPT_APP_MOVIL.md` completo y después `PROMPT_APP_MOVIL_GRATIS.md`, que manda
> sobre él. Ejecuta la Fase 0. Tras cada fase, detente, muéstrame la verificación y espera
> mi confirmación antes de seguir."*
>
> **Precedencia:** ante cualquier contradicción, **manda este documento**. Todo lo que
> aquí no se menciona se aplica tal cual: el contrato de la API (§3), las reglas de
> negocio (§4), los problemas conocidos de la web (§5) y las reglas invariables (§6) del
> documento principal.

---

## 1. Qué significa "gratuito" aquí

Costo monetario **cero** para desarrollar, instalar y usar la app en tus teléfonos
Android.

| Gasto del plan original | Cómo se evita |
|---|---|
| Apple Developer, 99 USD/año | iOS queda **fuera de alcance**; el código se deja preparado para añadirlo después |
| Google Play, 25 USD | La app se instala como **APK**, sin publicar en la tienda |
| EAS Build, 19 USD/mes | **Compilación local ilimitada** con Android Studio; el plan gratuito de EAS (15 builds de Android al mes, cola lenta) queda solo como respaldo |
| PythonAnywhere Developer, 10 USD/mes | Sigue el plan **gratuito** que ya usas, con las limitaciones de §4 |
| Dominio propio | No se usa: basta el subdominio de PythonAnywhere, que ya trae HTTPS |
| Servicios por uso (transcripción, modelos de IA, palabra clave de voz) | No se usa ninguno |

Herramientas necesarias, todas gratuitas: **Android Studio** (SDK, emulador y JDK),
**ffmpeg** (Fase 8) y Node. **Pide permiso al usuario antes de instalar cualquiera**
(regla invariable 12). Android Studio ocupa unos 10 GB.

---

## 2. Plataforma: solo Android

- **No instales ninguna librería de iOS ni crees objetivos de iOS.** Queda fuera de
  alcance todo lo marcado como iPhone en el documento principal: Live Activity y Dynamic
  Island (`expo-widgets`, `@expo/ui`), `expo-apple-authentication` e inicio de sesión con
  Apple, la revocación de tokens de Apple, el *entitlement* de avisos urgentes, TestFlight
  y los formularios de privacidad de la App Store.
- **El código sigue siendo multiplataforma.** En `src/domain/` no puede haber ninguna
  condición por plataforma, y las partes específicas de Android (notificación en curso,
  canales) viven detrás de una interfaz con una implementación vacía para iOS. El día que
  pagues los 99 USD, añadir iPhone debe ser sumar implementaciones, no reescribir.
- La guía 4.8 de Apple no aplica (no hay App Store): **Google como único inicio de sesión
  social es correcto**.
- En cada fase, donde el documento principal pida verificar en iPhone, **omítelo y
  anótalo como pendiente** en el resumen de la fase.

---

## 3. Compilación y distribución (sustituye a las decisiones de EAS y a la Fase 16.3)

- **Fases 4–6:** se prueban en **Expo Go** en tu teléfono Android o en el emulador. Sin
  compilar nada.
- **Desde la Fase 7** (notificaciones, audio en segundo plano, Google) hace falta un
  *development build*, que aquí se genera **en tu PC**: `npx expo prebuild --platform
  android` y `npx expo run:android`.
- **APK para el día a día:** keystore propio + `./gradlew assembleRelease`, según la
  Fase 4b de §6.
- **Instalación:** `adb install -r app-release.apk` por USB, o copiar el archivo al
  teléfono y permitir "instalar apps de origen desconocido" para el explorador de
  archivos.
- **Actualizaciones:** reinstalar el APK. Con el **mismo keystore** se actualiza encima y
  conserva los datos; con uno distinto, Android obliga a desinstalar primero, y ahí se
  pierden la sesión y la base local.
- **Respaldo:** si la compilación local falla y no se resuelve en un tiempo razonable,
  usa el plan gratuito de EAS Build (15 builds de Android al mes). No actives planes de
  pago.
- **Opcional y gratis, solo si el usuario lo pide:** EAS Update (hasta 1000 usuarios
  activos al mes) para enviar cambios de JavaScript sin reinstalar el APK.
- `mobile/README.md` documenta este procedimiento **en vez de** los perfiles de EAS.

---

## 4. Servidor gratuito (PythonAnywhere Beginner)

Sirve perfectamente, con tres avisos que el agente debe dejar escritos en el resumen
final y en `mobile/README.md`:

1. **Las web apps gratuitas caducan y hay que reactivarlas** con un botón del panel
   (durante años fue cada 3 meses; desde enero de 2026 el plazo se acortó a un mes).
   **Confírmalo en tu panel** y ponte un recordatorio: si caduca, la app móvil deja de
   sincronizar y el inicio de sesión falla.
2. **Salida a internet solo a dominios permitidos.** `.googleapis.com` y `.google.com`
   están permitidos, que es lo único que necesita la Fase 13 para verificar los tokens de
   Google.
3. **512 MB de disco** compartidos entre `study.db` y los fondos subidos (hasta 6 por
   usuario y 4 MB cada uno). Con varias cuentas, vigílalo.

Un solo worker: la sincronización del móvil descarga **todo** el historial de una vez, así
que respeta los disparadores del §5.2 del documento principal (arranque, volver a primer
plano, deslizar para refrescar, tras registrar una sesión y al recuperar conexión). Nunca
en bucle ni por temporizador.

Para desarrollo se sigue usando el Flask local, con el comando de la Fase 4.

---

## 5. Cambios fase por fase

| Fase | Cambio en modo gratuito |
|---|---|
| **0 Pre-vuelo** | En el punto 5, ya no preguntes por la cuenta de Apple Developer. Sí por el proyecto de Google Cloud (gratis) y por el tipo de cuenta de PythonAnywhere. Añade al inventario: Android Studio, SDK, `ANDROID_HOME`, `adb` y JDK |
| **1–3 Backend y web** | Sin cambios |
| **4 Esqueleto** | Sin cambios, salvo que se verifica solo en Android (Expo Go). El `package` de la app debe quedar fijado aquí: cambiarlo después obliga a reinstalar y a rehacer las credenciales de Google |
| **4b (nueva)** | Entorno local de compilación: §6 |
| **5, 6** | Sin cambios; verificación solo en Android |
| **7 Notificaciones** | Se mantiene **todo lo de Android**: fin de fase con alarma exacta, notificación en curso con cuenta atrás y botones Pausar/Reanudar, resumen semanal, permisos y planificador puro. Se elimina la Live Activity, la Dynamic Island y el *entitlement* de iOS. El punto 7.1 (builds de desarrollo con EAS) se sustituye por el build local de la Fase 4b. En 7.2, verifica solo `react-native-notify-kit` |
| **8 Música** | Sin cambios. ffmpeg se instala gratis con `winget`, previa autorización |
| **9–12** | Sin cambios; verificación solo en Android. En la Fase 12, la sección Cuenta no menciona Apple |
| **13 Backend Google/Apple** | **Solo Google.** Sin `apple_exchange_code`, `apple_revoke` ni variables `APPLE_*`, y sin `FOCUSDATA_TOKEN_KEY`. **Conserva la tabla `oauth_identities` exactamente como está definida** (con `provider` y `refresh_token_enc` sin usar): así añadir Apple más adelante no exige migrar. `/api/auth/providers` devuelve `apple: false` |
| **14 Web Google** | Sin cambios |
| **15 App Google/Apple** | **Solo Google**: un botón en la pantalla de acceso y, en Ajustes, solo la fila de Google. `Eliminar cuenta` se confirma con la contraseña o volviendo a entrar con Google |
| **16 Pulido** | Sin perfiles de EAS, TestFlight ni formularios de tiendas. Quedan: accesibilidad, icono y splash, revisión de los permisos de Android declarados, `mobile/README.md` con la compilación e instalación locales, y el resumen final |

**Las Fases 13–15 son opcionales en modo gratuito.** La app funciona con usuario y
contraseña. Ejecútalas solo si el usuario quiere entrar con Google o tener una vía de
recuperación de contraseña. Si se ejecutan: Google Cloud es gratis, pero en el cliente de
OAuth de Android hay que registrar la **huella SHA-1 del keystore** (la de depuración y la
de release); si cambias de keystore, el inicio de sesión con Google deja de funcionar
hasta registrar la nueva.

---

## 6. FASE 4b (nueva) — Entorno local de compilación e instalación

Va justo después de la Fase 4 del documento principal.

1. **Inventario, sin instalar nada por tu cuenta:** Android Studio, SDK de Android,
   `ANDROID_HOME`, `adb` en el PATH y JDK. Informa de lo que falte y **pide permiso** para
   instalarlo.
2. **Dispositivo:** teléfono con opciones de desarrollador y depuración USB, o un emulador
   creado en Android Studio. `adb devices` debe listarlo.
3. **Build de desarrollo:** `npx expo prebuild --platform android` y
   `npx expo run:android`. La app debe abrir en el dispositivo.
4. **Firma de release, resistente a `prebuild`:** las carpetas `android/` e `ios/` **no se
   versionan** (se regeneran), así que **no edites `android/app/build.gradle` a mano**:
   crea un *config plugin* propio en `mobile/plugins/withReleaseSigning.js` que inyecte el
   `signingConfig` leyendo propiedades de Gradle, y regístralo en la configuración de la
   app. Las contraseñas van en `~/.gradle/gradle.properties`, **nunca en el repo**.
5. **Keystore:** genera uno con `keytool -genkeypair -v -keystore focusdata.jks -keyalg
   RSA -keysize 2048 -validity 10000 -alias focusdata`. Guárdalo **fuera del repositorio**
   y dile al usuario que lo respalde: si lo pierde, no podrá actualizar la app instalada y
   tendrá que reinstalarla desde cero.
6. **APK:** `cd android && ./gradlew assembleRelease` →
   `android/app/build/outputs/apk/release/app-release.apk` → `adb install -r`.
7. **Documenta** en `mobile/README.md`: requisitos, los dos comandos, dónde vive el
   keystore, cómo respaldarlo, cómo instalar el APK en un teléfono sin cable y cómo sacar
   la huella SHA-1 (`keytool -list -v -keystore focusdata.jks`) para las Fases 13 y 15.

### Verificación
`npx expo run:android` abre la app; el APK de release se instala en un teléfono físico y
arranca **sin** el servidor de desarrollo; reinstalar el APK encima conserva los datos y la
sesión; `.gitignore` cubre `android/`, `ios/`, el keystore y `gradle.properties`.

**Commit:** `Móvil: compilación local de Android y APK firmado`

---

## 7. Checklist de regresión — ajustes

Se aplica el checklist del documento principal **quitando** todo lo de iPhone, Apple y
Live Activity, y **añadiendo**:

- [ ] El APK firmado se instala en el teléfono y funciona **sin** el PC ni el servidor de desarrollo.
- [ ] Reinstalar una versión nueva encima conserva sesión, historial local y ajustes.
- [ ] Si se ejecutaron las Fases 13–15: entrar con Google funciona con el APK firmado (huella SHA-1 registrada), y también tras reinstalar.
- [ ] La web app de PythonAnywhere está reactivada y el móvil sincroniza contra producción.
- [ ] `mobile/README.md` explica compilar, firmar, instalar y reactivar el servidor.
- [ ] Ningún archivo del repo contiene el keystore ni contraseñas.

---

## 8. Fuera de alcance (además del §"Fuera de alcance" del documento principal)

- iPhone en cualquier forma: compilar, probar, Live Activity, Apple sign-in, TestFlight.
- Publicar en Google Play (son 25 USD y una prueba cerrada con 12 personas durante 14
  días) o en cualquier otra tienda.
- Planes de pago de EAS, servidor de pago, dominio propio.
- Cualquier servicio con costo por uso: transcripción de voz en la nube, modelos de IA,
  motores de palabra clave.

---

## 9. Camino de salida (para cuando haya presupuesto)

Nada de lo hecho aquí se tira:

1. **25 USD, una vez → Google Play.** Añadir el perfil de producción, generar un AAB,
   registrar la huella de la firma de Play en Google Cloud y pasar la prueba cerrada de 12
   personas durante 14 días.
2. **99 USD al año → iPhone.** Se recuperan del documento principal las partes marcadas
   como fuera de alcance: Live Activity, Apple sign-in y la revocación de sus tokens,
   avisos urgentes y compilación con EAS. Como el dominio y la interfaz se mantuvieron
   multiplataforma, es sumar, no reescribir.
3. **10 USD al mes → servidor.** Quita la caducidad de la web app, la lista de dominios
   permitidos y el límite de disco.
