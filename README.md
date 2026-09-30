# 🤖 WhatsApp Prospecting Bot — César

Bot de prospección automática para WhatsApp desarrollado en **Node.js** con **whatsapp-web.js**. Envía mensajes diarios a prospectos obtenidos de Google Maps, con sistema de aleatoriedad avanzado para evitar detección y bloqueos.

---

## ✨ Características

- 📅 **5 mensajes diarios** con control estricto de cuota
- 🎲 **Horario aleatorio** cada día (ventana configurable, ej. 08:30–12:30 AM)
- ⏳ **Pausas humanas** de 2–7 minutos entre cada mensaje
- 📝 **Variaciones de texto** dinámicas (más de 100 combinaciones únicas del mismo mensaje)
- 🔐 **Sesión permanente** — escanea el QR solo la primera vez
- 🔄 **Reconexión automática** si se cae el internet
- 📊 **Historial completo** en `historial.json` con estado de cada envío
- 🖥️ **Modo 24/7** usando PM2 en Ubuntu Server

---

## 📁 Estructura del Proyecto

```
whatsapp-bot/
├── index.js          # Script principal (servicio 24/7)
├── config.js         # ⚙️ Configuración (mensaje, horarios, límites)
├── utils.js          # Funciones auxiliares (aleatoriedad, historial)
├── numeros.txt       # 📋 Lista de números a prospectar
├── historial.json    # 📊 Registro automático (se genera solo)
├── .wwebjs_auth/     # 🔐 Sesión guardada de WhatsApp (ignorada por git)
└── test-randomness.js # Pruebas de aleatoriedad
```

---

## 🚀 Instalación

### Requisitos
- Node.js v20 o superior
- npm

### Pasos

```bash
git clone https://github.com/TU_USUARIO/whatsapp-bot.git
cd whatsapp-bot
npm install
```

---

## ⚙️ Configuración (`config.js`)

Abre `config.js` para personalizar:

| Parámetro | Descripción | Valor por defecto |
|---|---|---|
| `dailyLimit` | Mensajes por día | `5` |
| `timeWindow` | Ventana horaria de envío | `08:30 – 12:30` |
| `delayBetweenMessages` | Pausa entre mensajes | `2 – 7 min` |
| `defaultCountryCode` | Código de país | `51` (Perú) |
| `messageVariations` | Banco de variaciones del mensaje | Ver archivo |

---

## 📋 Agregar Números (`numeros.txt`)

Edita `numeros.txt` con los números separados por comas o saltos de línea:

```
51970842718,51952837829,51984712079
51941303365,51944921273
```

- El bot **elimina duplicados** automáticamente.
- Acepta números con o sin código de país.
- Los números de **teléfono fijo** (sin WhatsApp) son detectados y omitidos automáticamente.

---

## ▶️ Ejecución

### Primera vez (escanear QR):
```bash
node index.js
```
Escanea el código QR desde **WhatsApp → Dispositivos vinculados → Vincular dispositivo**. Solo necesitas hacer esto una vez.

### Modo 24/7 con PM2:
```bash
pm2 start index.js --name "whatsapp-bot"
pm2 startup   # Arranque automático al reiniciar el servidor
pm2 save
```

---

## 📊 Monitoreo

```bash
# Ver estado del proceso
pm2 status

# Ver logs en tiempo real
pm2 logs whatsapp-bot

# Ver últimos 50 logs sin quedarse en modo vivo
pm2 logs whatsapp-bot --lines 50 --nostream
```

---

## 🔧 Hotfix / Actualizar el servidor

Desde tu PC, haz tus cambios y sube a GitHub:

```bash
git add .
git commit -m "fix: descripción del cambio"
git push
```

En el servidor Ubuntu:

```bash
cd ~/whatsapp-bot && git pull && pm2 restart whatsapp-bot
```

---

## 🖥️ Instalación en Ubuntu Server 24/7

Ver guía completa en [`UBUNTU_SERVER_SETUP.md`](./UBUNTU_SERVER_SETUP.md).

---

## 🛡️ Consideraciones Anti-Bloqueo

Este bot implementa múltiples capas de protección:

1. **Límite de 5 mensajes/día** — muy por debajo del umbral de detección de WhatsApp.
2. **Horario aleatorio** — nunca envía a la misma hora exacta dos días seguidos.
3. **Pausas de 2–7 minutos** — simula el comportamiento humano entre envíos.
4. **Texto variado** — más de 100 combinaciones diferentes del mismo mensaje para evitar el "hash matching" de WhatsApp.
5. **Verificación previa** — solo envía a números con cuenta activa en WhatsApp (`isRegisteredUser`).

---

## 📝 Licencia

Uso personal — Proyecto universitario de César, Ingeniería de Sistemas.
