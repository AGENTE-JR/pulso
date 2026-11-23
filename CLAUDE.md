# Pulso — monitor de hardware (Electron)

- Open source (MIT). Repo destino: github.com/AGENTE-JR/pulso. Releases automáticos con `.github/workflows/release.yml` al subir un tag `v*` (Windows, macOS arm64/x64, Linux).
- Multiplataforma: GPU NVIDIA (nvidia-smi) → Apple (ioreg) → AMD Linux (sysfs) → contador genérico Windows (AMD/Intel). En Mac la ventana usa semáforos nativos (`os-darwin`). Mac/Linux sin probar en hardware real.

- Arrancar: `npm start` o acceso directo "Pulso" del escritorio (`npm run shortcut` lo crea).
- `main.js`: lee sensores (systeminformation + `nvidia-smi` + PowerShell persistente para el reloj real de CPU + LibreHardwareMonitor por WMI si está abierto) y envía `stats` cada 1 s.
- `storage.js` (proceso main): pestaña Almacenamiento — escáner de disco (árbol en memoria, 12 workers), top 300 archivos, duplicados (tamaño → hash parcial → MD5 completo, ignora AppData/sistema/node_modules/ocultas), basura por categorías. Archivos del usuario → `shell.trashItem` (papelera); cachés/temporales → borrado definitivo. Confirmación nativa en main; rutas del sistema protegidas (`isProtected`).
- `src/`: interfaz vanilla (index.html, app.js, storage.js, charts.js sin dependencias, mini.html = widget flotante).
- Config y sesiones: `%APPDATA%\pulso-monitor\` (config.json, sesiones\*.json/.csv).
- Temperatura CPU: Windows la bloquea sin admin → requiere LibreHardwareMonitor abierto (como admin).
- npm 11 bloquea el postinstall de Electron: si falta `node_modules/electron/dist/electron.exe`, extraer el zip de `%LOCALAPPDATA%\electron\Cache` en `dist` y crear `path.txt` con `electron.exe`.
- Depuración: `PULSO_DEBUG=1` (errores a stderr), `PULSO_SHOT=ruta.png` (capturas automáticas).
- Compilar .exe: `npm run dist` → `dist\Pulso-Setup-1.0.0.exe` (instalador) y `dist\Pulso-Portable-1.0.0.exe`. Icono: `npm run icon` (build/generar-icono.ps1).
- Si electron-builder falla con "Cannot create symbolic link" (winCodeSign): extraer el .7z de `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign` con `7za x -x!darwin` en la subcarpeta `winCodeSign-2.6.0`.
- El .exe no está firmado → Windows SmartScreen avisa la primera vez ("Más información → Ejecutar de todas formas").
- Pendiente/ideas: arranque con Windows, bandeja del sistema, firma de código.
