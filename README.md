# 🤖 WhatsApp Bot 24/7 — César

Bot en **Node.js** con **whatsapp-web.js** que corre 24/7 en un servidor Ubuntu (laptop i5) con una única sesión de WhatsApp vinculada. Un solo proceso (`index.js`) ejecuta tres módulos:

| Módulo | Qué hace | Archivos |
|---|---|---|
| **Prospección** | Envía la propuesta de página web a 5 negocios nuevos por día | `index.js`, `utils.js`, `numeros.txt`, `historial.json` |
| **Quiz médico** | Sesión diaria de 5 preguntas clínicas con respuesta a los 7 min | `quiz.js`, `preguntas.json`, `quiz-historial.json` |
| **Auto-responder** | Contesta con ChatGPT a los prospectos que responden | `responder.js`, `conversaciones/` |

Toda la configuración está en `config.js`. Los datos privados (teléfonos) van en `config.local.js`, que **no se sube a GitHub**:

```bash
cp config.local.example.js config.local.js   # y completa los números
```

También se pueden pasar como variables de entorno: `QUIZ_TARGET_NUMBER` y `CESAR_NUMBER`.

---

## 🕐 Zona horaria

El servidor corre en **UTC**, pero `index.js` fija `process.env.TZ = 'America/Lima'` al inicio. **Todos los horarios de `config.js` son hora de Perú**, y los logs muestran hora de Perú.

---

## 📣 Módulo 1: Prospección

- **Cuota:** 5 mensajes por día (`dailyLimit`).
- **Ventana:** de 08:00 a 19:00 (`timeWindow`). Cada día se sortea una hora distinta.
- **Pausa entre prospectos:** de 2 a 7 min aleatorios (`delayBetweenMessages`).
- **Texto variable:** 5 saludos × 3 presentaciones × 3 contextos × 3 propuestas = 135 combinaciones (`messageVariations`).
- **Verificación previa:** con `isRegisteredUser` se omiten los números sin WhatsApp, como los fijos que empiezan con `5173…`.
- **Agregar números:** en `numeros.txt`, separados por comas o saltos de línea. El bot elimina duplicados y agrega el `51` a los celulares de 9 dígitos.

---

## 📚 Módulo 2: Quiz médico

- **Destino:** `quizTargetNumber` en `config.local.js`.
- **Preguntas por día:** 5 (`questionsPerDay`).
- **Dinámica de cada pregunta:** se envía la pregunta, a los **7 min** la respuesta con su explicación (`answerDelayMs`), y **1 hora** después la siguiente pregunta (`delayBetweenQuestionsMs`).
- **Duración de la sesión:** unas 4 h 35 min.
- **Ventana:** de 09:00 a 23:00 (`timeWindow`). La hora de **inicio** se sortea entre las 09:00 y la hora que permite terminar antes de las 23:00 (hoy, 18:25). Ver `getQuizStartWindow()` en `quiz.js`.
- **Reinicios:** si el bot se reinicia a mitad de la sesión, retoma las preguntas que falten del día. El conteo usa la fecha de Perú.
- **Rotación:** cuando se envían todas las preguntas del banco, el ciclo vuelve a empezar.

### Banco de preguntas (`preguntas.json`), 48 preguntas

- **1–28:** cardiología, gastroenterología y neurología.
- **29–48:** infecciosas (MRSA, tifoidea, dengue, malaria, VIH, ofidismo), respiratorio (insuficiencia respiratoria, NAC, TBC, EPOC, asma, derrame pleural), cardiovascular (FA, insuficiencia cardiaca, crisis hipertensiva, IAMCEST) y endocrino (DM2, Graves, Cushing, Addison).

Formato de cada pregunta:

```json
{
  "id": 49,
  "tema": "...",
  "pregunta": "...",
  "alternativas": ["A) ...", "B) ...", "C) ...", "D) ..."],
  "respuesta": "B",
  "explicacion": "..."
}
```

Los `id` deben ser únicos y nuevos, porque el historial se lleva por `id`.

---

## 💬 Módulo 3: Auto-responder (ChatGPT)

- **Modelo:** `gpt-4o-mini`. La clave se lee de la variable de entorno `OPENAI_API_KEY`, configurada en el proceso de PM2.
- **A quién responde:** solo a números de `numeros.txt`. Ignora grupos, estados, mensajes propios, el número del quiz y el número personal de César.
- **IDs `@lid`:** WhatsApp suele entregar los chats como `@lid` en vez del número. El teléfono real se obtiene con `client.getContactLidAndPhone()`. `contact.number` **no** sirve, porque devuelve los dígitos del LID.
- **Respuesta:** espera de 1 a 3 min, agrupa los mensajes seguidos en una sola respuesta y usa como contexto el chat real de WhatsApp (que incluye el mensaje de prospección y lo que César haya escrito a mano).
- **Límites:** 10 respuestas por prospecto.
- **Cuándo deja de responder a un contacto** (`closed: true` en `conversaciones/<número>.json`, con el motivo en `closedReason`):
  - `cita_agendada`: al confirmar una cita, el bot responde una última vez, avisa **una sola vez** a César y se retira. César continúa a mano.
  - `cesar_manual`: si César escribe a mano en el chat (desde su celular), el bot no vuelve a responder a ese contacto. Lo detecta con el evento `message_create`; los mensajes del propio bot se distinguen porque se registran antes de enviarse (`markBotMessage`).
  - `no_interesado`: el prospecto dijo que no le interesa.
  - Para reactivar el bot con un contacto, edita su archivo y pon `"closed": false`.
- **Descartes:** cada mensaje descartado queda en el log con el motivo (`ℹ️ [Responder] Ignorado: ...`).
- **Pendientes al arrancar:** `processPendingReplies()` busca prospectos que escribieron en los últimos 3 días sin recibir respuesta.
  - ⚠️ **Pendiente de arreglar:** hoy falla al abrir los chats (`No se pudo revisar ...`), así que no recupera mensajes viejos. Las respuestas en vivo no se ven afectadas.

---

## 📁 Estructura

```
whatsapp-bot/
├── index.js              # Orquestador: WhatsApp, heartbeat cada 30 s, prospección y quiz
├── config.js             # ⚙️ Configuración de los 3 módulos
├── config.local.js       # 🔒 Teléfonos privados              (ignorado por git)
├── config.local.example.js # Plantilla de config.local.js
├── utils.js              # Números, horarios aleatorios, Spintax, historial
├── quiz.js               # Lógica del quiz (rotación, conteo diario, ventana de inicio)
├── responder.js          # Auto-responder con ChatGPT
├── preguntas.json        # Banco de preguntas médicas
├── numeros.txt           # Prospectos
├── historial.json        # Envíos de prospección          (ignorado por git)
├── quiz-historial.json   # Preguntas enviadas             (ignorado por git)
├── conversaciones/       # Conversaciones por prospecto   (ignorado por git)
├── .wwebjs_auth/         # Sesión de WhatsApp             (ignorado por git)
├── UBUNTU_SERVER_SETUP.md
└── test-logic.js, test-randomness.js
```

---

## 🖥️ Servidor y despliegue

- **Acceso:** PC → Cloudflare Tunnel → VPS → SSH a la i5 por red local (datos de acceso fuera del repositorio).
- **Carpeta activa:** `/home/cesar/whatsapp-bot-git`. Hay un respaldo antiguo en `~/whatsapp-bot`.
- **Proceso:** PM2, con el nombre `whatsapp-bot`.

Para desplegar un cambio, primero súbelo desde la PC:

```bash
git add . && git commit -m "..." && git push
```

Después, en la i5, actualiza y reinicia:

```bash
git -C ~/whatsapp-bot-git pull && pm2 restart whatsapp-bot --update-env
```

Antes de reiniciar, revisa los logs: el reinicio corta cualquier ronda de prospección o sesión de quiz que esté en curso.

### Monitoreo

```bash
pm2 status
pm2 logs whatsapp-bot --lines 100 --nostream
pm2 logs whatsapp-bot --lines 300 --nostream | grep Responder
pm2 logs whatsapp-bot --lines 300 --nostream | grep Quiz
```

Para la instalación desde cero, ver [`UBUNTU_SERVER_SETUP.md`](./UBUNTU_SERVER_SETUP.md).

---

## 🛡️ Anti-bloqueo

1. Máximo 5 prospectos por día.
2. Hora de envío distinta cada día.
3. Pausas de 2 a 7 min entre prospectos y de 1 a 3 min antes de cada respuesta.
4. 135 variaciones del mensaje inicial.
5. Verificación de cuenta activa antes de enviar.

---

## 📝 Historial de cambios recientes

| Commit | Cambio |
|---|---|
| `a9e35dc` | Quiz: 1 hora entre preguntas; la sesión termina antes de las 23:00 |
| `9277896` | Quiz de 5 preguntas por día, 20 preguntas nuevas (48 en total), zona horaria de Perú |
| `a03c9f8`, `30d78ba`, `d7c5247` | Auto-responder: teléfono real de los chats `@lid`, agrupación de mensajes, logs de descarte |

---

Uso personal: proyecto universitario de César, Ingeniería de Sistemas.
