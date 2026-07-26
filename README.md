<div align="center">
  <img src="assets/images/icon.png" width="104" alt="SK Music">
  <h1>SK Music</h1>
  <p><strong>Reproductor de música offline.</strong> Pegas un link de YouTube, la app extrae el audio, lo guarda en el teléfono y desde ahí suena sin conexión.</p>
</div>

---

## Descargar

**[⬇ Última versión del APK](https://github.com/saidklelers/sk-music/releases/latest)**

Android: descarga el `.apk` y ábrelo. La primera vez el sistema pide permitir la instalación desde orígenes desconocidos.

iOS: no hay descarga directa. Ver [Compilar para iPhone](#compilar-para-iphone).

## Qué hace

- **Descarga desde YouTube** pegando el link, o buscando por nombre desde la propia app.
- **Reproducción sin conexión.** Una vez descargada, la canción vive en el dispositivo.
- **Audio en segundo plano** con controles en la pantalla bloqueada.
- **Listas de reproducción**, cola, aleatorio y repetición.
- **Sin servidor.** No hay backend que mantener ni por el que pasen tus datos: la extracción ocurre completa en el teléfono.
- **Sin cuentas, sin anuncios, sin telemetría.**

## Cómo funciona

```
link de YouTube
      ↓
youtubei.js  ──  resuelve metadatos y la URL del stream de audio
      ↓
expo-file-system  ──  descarga el m4a al almacenamiento de la app
      ↓
SQLite  ──  guarda título, artista, duración y rutas
      ↓
expo-audio  ──  reproduce desde disco, también en segundo plano
```

Tres decisiones que vale la pena explicar:

**Se pide m4a/AAC, no webm/opus.** YouTube sirve la mayoría del audio en webm/opus, que Android reproduce pero iOS no. Pedir m4a explícitamente evita tener que transcodificar, algo que no es viable en el dispositivo, y el formato está disponible en prácticamente todos los videos.

**Se prueban varios clientes de YouTube en orden**, con el de iOS primero: es el que entrega URLs de audio sin cifrar ni estrangular, y sin exigir PoToken.

**En la base de datos se guarda solo el nombre del archivo, nunca la ruta absoluta.** En iOS el contenedor de la app cambia de ubicación entre instalaciones y actualizaciones, así que una URI absoluta guardada hoy apunta a la nada mañana. La ruta se rearma en cada lectura.

## Stack

| | |
|---|---|
| Framework | Expo SDK 57 · React Native 0.86 · React 19 |
| Navegación | expo-router (rutas tipadas) |
| Audio | expo-audio |
| Extracción | youtubei.js (build de React Native) |
| Datos | expo-sqlite |
| Gráficos | react-native-svg |
| Lenguaje | TypeScript en modo estricto |

## Desarrollo

```bash
npm install
npx expo start
```

> **Ojo:** el audio en segundo plano **no funciona en Expo Go**, porque no aplica la configuración nativa. Para probarlo hay que usar el APK o un development build.

Comprobaciones:

```bash
npx tsc --noEmit
npx expo lint
npx expo-doctor
```

### Estructura

```
src/
├── app/            Rutas (expo-router)
├── components/     UI reutilizable, logo e iconos
├── db/             Esquema SQLite y consultas
├── downloads/      Cola de descargas y almacenamiento
├── lib/            Polyfills y utilidades de formato
├── library/        Estado global de la biblioteca
├── player/         Estado global del reproductor
├── theme/          Paleta, tipografía y espaciado
└── youtube/        Cliente Innertube y resolución de links
```

## Compilar

El APK se compila solo: cada push a `main` dispara el workflow de GitHub Actions, que genera el proyecto nativo con `expo prebuild`, compila con Gradle y publica el resultado como Release. No requiere cuenta de Expo ni secretos.

Para compilar en local hace falta Android Studio con el SDK instalado:

```bash
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease
```

El APK queda en `android/app/build/outputs/apk/release/`.

### Compilar para iPhone

```bash
npx eas build --platform ios --profile preview
```

Requiere cuenta de Expo y cuenta de Apple. Con cuenta de Apple gratuita la app **caduca a los 7 días** y hay que reinstalarla; con cuenta de desarrollador de pago dura un año.

## Limitaciones conocidas

- **La pantalla bloqueada no tiene botones de siguiente/anterior.** `expo-audio` solo expone play/pausa y adelantar/retroceder dentro de la canción. Para cambiar de pista hay que abrir la app.
- **Las descargas se rompen cuando YouTube cambia algo.** Es el costo de no tener servidor. La cura suele ser `npm update youtubei.js` y recompilar. En Ajustes hay un botón para reiniciar la sesión por si es algo transitorio.
- **Optimización de batería en Android.** Algunos fabricantes (Xiaomi, Samsung, Oppo, Huawei) matan servicios en primer plano de forma agresiva. Si el audio se corta al bloquear la pantalla, hay que excluir la app en los ajustes de batería del teléfono.
- **Videos con restricción de edad** no se pueden descargar.

## Nota legal

Esta app es para uso personal. Descarga únicamente contenido sobre el que tengas derechos o que esté bajo una licencia que lo permita. Descargar material con copyright puede infringir los términos de servicio de YouTube y la legislación de derechos de autor de tu país.

## Licencia

MIT. Ver [LICENSE](LICENSE).
