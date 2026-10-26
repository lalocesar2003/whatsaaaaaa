const fs = require('fs');
const { OpenAI } = require('openai');
const config = require('./config');

// ================================================================
// MÓDULO RECORDATORIOS — César escribe al bot desde su número
// personal ("mañana tengo reunión con mi asesor a las 4 pm") y el bot
// le envía avisos: el día anterior en la mañana, el mismo día en la
// mañana y 1 hora antes.
// ================================================================

let openai = null;
let ticking = false;

// Últimos mensajes con César (para preguntas de seguimiento, ej. "¿a qué hora?")
const recentChat = [];

function getOpenAI() {
  if (!openai && config.responder.apiKey) openai = new OpenAI({ apiKey: config.responder.apiKey });
  return openai;
}

function loadReminders() {
  const file = config.recordatorios.file;
  if (!fs.existsSync(file)) return { items: [], nextId: 1 };
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return { items: data.items || [], nextId: data.nextId || 1 };
  } catch (e) {
    console.error('❌ [Recordatorios] Error leyendo recordatorios.json:', e.message);
    return { items: [], nextId: 1 };
  }
}

function saveReminders(data) {
  fs.writeFileSync(config.recordatorios.file, JSON.stringify(data, null, 2), 'utf-8');
}

// ---------------- Formato de fechas (hora de Perú) ----------------

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatHour(date) {
  let h = date.getHours();
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${pad(date.getMinutes())} ${suffix}`;
}

const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function formatDay(date) {
  return `${DAYS[date.getDay()]} ${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Calendario de los próximos 14 días para que ChatGPT no calcule fechas a mano.
 */
function buildCalendar(now) {
  const lines = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const label = i === 0 ? ' (hoy)' : i === 1 ? ' (mañana)' : '';
    lines.push(`- ${DAYS[d.getDay()]} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}${label}`);
  }
  return lines.join('\n');
}

// ---------------- Cálculo de avisos ----------------

/**
 * Avisos de un evento: día anterior 8 AM, mismo día 8 AM y 1 hora antes.
 * Solo se programan los que aún están en el futuro y antes del evento.
 */
function buildAlerts(eventDate, now = new Date()) {
  const { morningHour, morningMinute, hourBeforeMs } = config.recordatorios;
  const alerts = [];

  const dayBefore = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate() - 1, morningHour, morningMinute);
  const sameDayMorning = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate(), morningHour, morningMinute);
  const hourBefore = new Date(eventDate.getTime() - hourBeforeMs);

  if (dayBefore > now) alerts.push({ tipo: 'dia_anterior', at: dayBefore.toISOString(), sent: false });
  // Si el evento es muy temprano, el aviso de la mañana coincidiría con el de 1 hora antes
  if (sameDayMorning > now && sameDayMorning < hourBefore) {
    alerts.push({ tipo: 'mismo_dia', at: sameDayMorning.toISOString(), sent: false });
  }
  if (hourBefore > now) alerts.push({ tipo: 'una_hora', at: hourBefore.toISOString(), sent: false });

  return alerts;
}

const ALERT_LABEL = {
  dia_anterior: 'el día anterior a las 8:00 AM',
  mismo_dia: 'el mismo día a las 8:00 AM',
  una_hora: '1 hora antes'
};

function alertMessage(item, alert) {
  const event = new Date(item.fechaEvento);
  if (alert.tipo === 'dia_anterior') {
    return `🔔 *Recordatorio para mañana*\n\n📌 ${item.titulo}\n🗓️ Mañana ${formatDay(event)} a las ${formatHour(event)}`;
  }
  if (alert.tipo === 'mismo_dia') {
    return `🔔 *Recordatorio para hoy*\n\n📌 ${item.titulo}\n⏰ Hoy a las ${formatHour(event)}`;
  }
  return `⏰ *En 1 hora*\n\n📌 ${item.titulo}\n🕐 A las ${formatHour(event)}`;
}

function describeItem(item) {
  const event = new Date(item.fechaEvento);
  return `#${item.id} ${item.titulo} — ${formatDay(event)} ${formatHour(event)}`;
}

// ---------------- Interpretación con ChatGPT ----------------

async function interpret(text, data, now) {
  const active = data.items.filter(i => new Date(i.fechaEvento) > now);
  const system = `Eres el asistente de recordatorios de César por WhatsApp. Interpretas lo que César escribe y respondes SOLO en JSON.

Fecha y hora actual (Perú): ${formatDay(now)} ${now.getFullYear()}, ${formatHour(now)}.
Calendario (usa estas fechas exactas):
${buildCalendar(now)}

Recordatorios activos:
${active.length ? active.map(describeItem).join('\n') : '(ninguno)'}

Responde con este JSON:
{
  "accion": "crear" | "listar" | "cancelar" | "preguntar" | "otro",
  "titulo": "",
  "fecha": "YYYY-MM-DD",
  "hora": "HH:mm",
  "idCancelar": 0,
  "respuesta": ""
}

REGLAS:
- "crear": César menciona un evento con día y hora. "titulo" es una descripción corta y clara (ej: "Reunión con asesor de tesis"). "hora" en formato 24h ("4 de la tarde" = "16:00").
- Si falta el día o la hora, usa "preguntar" y en "respuesta" pregunta lo que falta en una línea.
- Si el día o la hora ya pasaron, usa "preguntar" y pide aclarar.
- "listar": pide ver sus recordatorios.
- "cancelar": quiere borrar uno. "idCancelar" es el número del recordatorio activo que corresponde. Si no está claro cuál, usa "preguntar".
- "otro": cualquier mensaje que no sea sobre recordatorios (ej: "ok", "gracias").
- Si César responde a una pregunta tuya anterior, combina esa respuesta con el mensaje anterior.`;

  const res = await getOpenAI().chat.completions.create({
    model: config.responder.model,
    temperature: 0,
    max_tokens: 250,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: system }, ...recentChat.slice(-6), { role: 'user', content: text }]
  });
  return JSON.parse(res.choices[0].message.content);
}

function remember(role, content) {
  recentChat.push({ role, content });
  while (recentChat.length > 6) recentChat.shift();
}

// ---------------- Acciones ----------------

/**
 * Procesa un mensaje de César. Devuelve el texto de respuesta (o null si no hay que responder).
 */
async function processCesarText(text, now = new Date()) {
  if (!getOpenAI()) return null;
  const data = loadReminders();
  const r = await interpret(text, data, now);
  let reply = null;

  if (r.accion === 'crear' && r.fecha && r.hora) {
    const [y, m, d] = r.fecha.split('-').map(Number);
    const [hh, mm] = r.hora.split(':').map(Number);
    const eventDate = new Date(y, m - 1, d, hh, mm);

    if (isNaN(eventDate) || eventDate <= now) {
      reply = '⚠️ Esa fecha ya pasó o no la entendí. ¿Me la repites con día y hora?';
    } else {
      const item = {
        id: data.nextId++,
        titulo: r.titulo || 'Evento',
        fechaEvento: eventDate.toISOString(),
        creado: now.toISOString(),
        avisos: buildAlerts(eventDate, now)
      };
      data.items.push(item);
      saveReminders(data);

      const cuando = sameDay(eventDate, now) ? `hoy ${formatDay(eventDate)}` : formatDay(eventDate);
      const avisos = item.avisos.length
        ? item.avisos.map(a => `• ${ALERT_LABEL[a.tipo]}`).join('\n')
        : '• (ya no queda tiempo para avisos previos)';
      reply = `✅ *Recordatorio #${item.id} creado*\n\n📌 ${item.titulo}\n🗓️ ${cuando} a las ${formatHour(eventDate)}\n\nTe aviso:\n${avisos}`;
      console.log(`📅 [Recordatorios] Creado #${item.id}: ${item.titulo} (${eventDate.toString().slice(0, 21)})`);
    }
  } else if (r.accion === 'listar') {
    const active = data.items.filter(i => new Date(i.fechaEvento) > now);
    reply = active.length
      ? `📋 *Tus recordatorios*\n\n${active.map(describeItem).join('\n')}\n\n_Para borrar uno: "cancela el #N"_`
      : '📋 No tienes recordatorios pendientes.';
  } else if (r.accion === 'cancelar' && r.idCancelar) {
    const idx = data.items.findIndex(i => i.id === Number(r.idCancelar));
    if (idx === -1) {
      reply = `⚠️ No encontré el recordatorio #${r.idCancelar}. Escribe "mis recordatorios" para ver la lista.`;
    } else {
      const [removed] = data.items.splice(idx, 1);
      saveReminders(data);
      reply = `🗑️ Cancelado: ${describeItem(removed)}`;
      console.log(`🗑️ [Recordatorios] Cancelado #${removed.id}: ${removed.titulo}`);
    }
  } else if (r.accion === 'preguntar' || r.accion === 'crear' || r.accion === 'cancelar') {
    reply = r.respuesta || '¿Me das el día y la hora del evento?';
  }

  remember('user', text);
  if (reply) remember('assistant', reply);
  return reply;
}

/**
 * Entrada desde WhatsApp: mensaje de César al número del bot.
 */
async function handleCesarMessage(client, msg, markBotMessage) {
  if (!msg.body || msg.body.trim() === '') return;
  console.log(`\n📅 [Recordatorios] Mensaje de César: "${msg.body}"`);
  try {
    const reply = await processCesarText(msg.body.trim());
    if (reply) {
      markBotMessage(reply);
      await client.sendMessage(msg.from, reply);
    }
  } catch (err) {
    console.error('❌ [Recordatorios] Error procesando mensaje:', err.message);
  }
}

/**
 * Heartbeat: envía los avisos vencidos. Se llama cada 30 s desde index.js.
 */
async function tick(client, markBotMessage, now = new Date()) {
  if (ticking || !config.responder.cesarNumber) return;
  ticking = true;
  try {
    const data = loadReminders();
    let changed = false;

    for (const item of data.items) {
      const event = new Date(item.fechaEvento);
      for (const alert of item.avisos) {
        if (alert.sent || new Date(alert.at) > now) continue;

        alert.sent = true;
        changed = true;
        // Si el bot estuvo apagado y el evento ya pasó, no tiene sentido avisar
        if (event <= now) {
          alert.skipped = true;
          continue;
        }

        const text = alertMessage(item, alert);
        try {
          markBotMessage(text);
          await client.sendMessage(`${config.responder.cesarNumber}@c.us`, text);
          console.log(`🔔 [Recordatorios] Aviso "${alert.tipo}" enviado: ${item.titulo}`);
        } catch (err) {
          alert.error = err.message;
          console.error(`❌ [Recordatorios] Error enviando aviso de #${item.id}:`, err.message);
        }
      }
    }

    // Limpiar eventos que pasaron hace más de 1 día
    const before = data.items.length;
    data.items = data.items.filter(i => now - new Date(i.fechaEvento) < 24 * 60 * 60 * 1000);
    if (data.items.length !== before) changed = true;

    if (changed) saveReminders(data);
  } finally {
    ticking = false;
  }
}

module.exports = { handleCesarMessage, processCesarText, tick, buildAlerts, loadReminders };
