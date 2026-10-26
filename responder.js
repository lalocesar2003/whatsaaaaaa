const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const reminders = require('./recordatorios');
const { loadNumbers, loadHistory, sleep, getRandomInt, formatTime } = require('./utils');

let openai = null;
let responderActive = false;

/**
 * Inicializa el cliente de OpenAI.
 * Retorna true si se activó correctamente, false si falta la API key.
 */
function initResponder() {
  const apiKey = config.responder.apiKey;
  if (!apiKey || apiKey === '') {
    console.log('⚠️ [Responder] OPENAI_API_KEY no configurada. Auto-responder DESACTIVADO.');
    console.log('   💡 Configúralo con: export OPENAI_API_KEY="sk-..."');
    return false;
  }
  openai = new OpenAI({ apiKey });
  responderActive = true;
  console.log('🤖 [Responder] Auto-responder activado con ChatGPT (modelo: ' + config.responder.model + ').');
  return true;
}

/**
 * Verifica si un número está en la lista de prospectos.
 */
function isProspectNumber(number) {
  const prospects = loadNumbers(config.numbersFile, config.defaultCountryCode);
  return prospects.includes(number);
}

/**
 * Obtiene la ruta del archivo de conversación para un número.
 */
function getConversationPath(number) {
  const dir = config.responder.conversationsDir;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${number}.json`);
}

/**
 * Carga el historial de conversación con un prospecto.
 */
function loadConversation(number) {
  const filePath = getConversationPath(number);
  if (!fs.existsSync(filePath)) {
    return { messages: [], replyCount: 0, closed: false };
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    return { messages: [], replyCount: 0, closed: false };
  }
}

/**
 * Guarda el historial de conversación con un prospecto.
 */
function saveConversation(number, data) {
  const filePath = getConversationPath(number);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Genera una respuesta usando ChatGPT basada en el historial de conversación.
 */
async function generateResponse(incomingMsg, conversation) {
  // Construir el historial para ChatGPT (últimos 10 mensajes para contexto)
  const chatMessages = [
    { role: 'system', content: config.responder.systemPrompt },
    ...conversation.messages.slice(-10),
    { role: 'user', content: incomingMsg }
  ];

  const response = await openai.chat.completions.create({
    model: config.responder.model,
    messages: chatMessages,
    temperature: 0.4,
    max_tokens: 300,
    response_format: { type: 'json_object' }
  });

  const content = response.choices[0].message.content;

  try {
    return JSON.parse(content);
  } catch (e) {
    // Si ChatGPT no devuelve JSON válido, usar el texto directo
    return {
      mensaje: content,
      citaAgendada: false,
      resumen: ''
    };
  }
}

// Mapa LID -> teléfono (respaldo cuando WhatsApp no expone el número)
const lidToPhone = new Map();

// Cola por prospecto: agrupa mensajes seguidos en una sola respuesta
const pendingByNumber = new Map(); // number -> { chatId, texts: [] }
const processingNumbers = new Set();

// Textos que el propio bot está enviando: sirven para distinguir los mensajes
// del bot de los que César escribe a mano desde su celular
const botSentTexts = new Map(); // texto -> cantidad pendiente de confirmar

function markBotMessage(text) {
  const key = String(text || '').trim();
  botSentTexts.set(key, (botSentTexts.get(key) || 0) + 1);
}

function consumeBotMessage(text) {
  const key = String(text || '').trim();
  const count = botSentTexts.get(key) || 0;
  if (count === 0) return false;
  if (count === 1) botSentTexts.delete(key);
  else botSentTexts.set(key, count - 1);
  return true;
}

async function sendAsBot(client, chatId, text) {
  markBotMessage(text);
  return client.sendMessage(chatId, text);
}

function cleanDigits(value) {
  return String(value || '').replace(/@.*$/, '').replace(/\D/g, '');
}

/**
 * Consulta a WhatsApp el par { lid, pn } de uno o varios IDs.
 */
async function lookupLidAndPhone(client, ids) {
  if (typeof client.getContactLidAndPhone !== 'function') return [];
  try {
    const res = await client.getContactLidAndPhone(ids);
    return Array.isArray(res) ? res : [];
  } catch (e) {
    console.log(`⚠️ [Responder] getContactLidAndPhone falló: ${e.message}`);
    return [];
  }
}

/**
 * Obtiene el número telefónico real del remitente.
 * WhatsApp puede entregar el chat como @c.us (número) o @lid (ID anónimo).
 * Para @lid, contact.number devuelve los dígitos del LID, no el teléfono,
 * así que se usa getContactLidAndPhone y el mapa LID -> teléfono.
 */
async function resolveSenderNumber(client, msg) {
  return resolveNumber(client, msg.from);
}

async function resolveNumber(client, id) {
  if (!id) return null;
  if (id.endsWith('@c.us')) return id.replace('@c.us', '');
  if (!id.endsWith('@lid')) return null;

  const [entry] = await lookupLidAndPhone(client, [id]);
  const pn = entry && cleanDigits(entry.pn);
  if (pn) {
    lidToPhone.set(id, pn);
    return pn;
  }

  if (lidToPhone.has(id)) return lidToPhone.get(id);

  return null;
}

/**
 * Construye el contexto para ChatGPT a partir del chat real de WhatsApp
 * (incluye el mensaje de prospección y lo que César haya escrito a mano).
 */
async function buildChatContext(client, chatId, fallbackMessages) {
  try {
    const chat = await client.getChatById(chatId);
    const msgs = await chat.fetchMessages({ limit: 20 });
    const context = msgs
      .filter(m => m.body && m.body.trim() !== '' && (m.type === 'chat' || m.type === 'image'))
      .map(m => ({ role: m.fromMe ? 'assistant' : 'user', content: m.body }));
    if (context.length > 0) return context;
  } catch (e) {
    console.log(`⚠️ [Responder] No se pudo leer el chat ${chatId}: ${e.message}`);
  }
  return fallbackMessages.slice(-12);
}

/**
 * Mensaje de prospección enviado a un número (completo si está guardado).
 */
function getProspectingMessage(number) {
  const history = loadHistory(config.historyFile);
  const entry = history.sent.find(h => h.number === number && h.status === 'ENVIADO');
  if (!entry) return null;
  return entry.message ||
    'Hola, soy César, estudiante de Ingeniería de Sistemas. Vi su negocio en Google Maps con buenas reseñas pero sin página web. ' +
    'Como parte de mi proyecto universitario les ofrezco diseñar su web completa gratis. ¿Les gustaría ser el negocio elegido?';
}

// Palabras que indican que el prospecto NO está rechazando
const AFFIRMATIVE_RE = /(^|[^a-záéíóúñ])(s[ií]+|claro|ok+|okey|dale|listo|perfecto|me interesa|cuenta conmigo|me escribes|escr[ií]beme|de acuerdo|genial)([^a-záéíóúñ]|$)/i;

/**
 * Envía un aviso a César por WhatsApp.
 */
async function notifyCesar(client, text) {
  if (!config.responder.cesarNumber) return;
  try {
    await sendAsBot(client, `${config.responder.cesarNumber}@c.us`, text);
  } catch (e) {
    console.error('❌ [Responder] No se pudo avisar a César:', e.message);
  }
}

/**
 * Genera y envía la respuesta para todos los mensajes acumulados de un prospecto.
 */
async function processQueue(client, number) {
  if (processingNumbers.has(number)) return;
  processingNumbers.add(number);

  try {
    while (pendingByNumber.has(number)) {
      // --- PAUSA HUMANA (los mensajes que lleguen mientras tanto se agrupan) ---
      const delay = getRandomInt(config.responder.replyDelay.minMs, config.responder.replyDelay.maxMs);
      console.log(`⏳ [Responder] Esperando ${(delay / 60000).toFixed(1)} min antes de responder a +${number}...`);
      await sleep(delay);

      // César pudo tomar la conversación durante la espera (vacía la cola)
      const entry = pendingByNumber.get(number);
      if (!entry) break;
      const { chatId, texts } = entry;
      pendingByNumber.delete(number);
      const incoming = texts.join('\n');

      const conversation = loadConversation(number);
      if (conversation.closed) {
        console.log(`🔒 [Responder] Conversación cerrada con +${number}. No se responde.`);
        // César no está en el chat: reenviarle lo que escribió el prospecto
        if (['no_interesado', 'derivado_cesar'].includes(conversation.closedReason)) {
          await notifyCesar(client, `📩 *+${number} escribió:*\n\n"${incoming}"`);
        }
        return;
      }
      if (conversation.replyCount >= config.responder.maxRepliesPerContact) {
        console.log(`⚠️ [Responder] Límite de ${config.responder.maxRepliesPerContact} respuestas alcanzado para +${number}.`);
        return;
      }

      // --- GENERAR RESPUESTA CON CHATGPT ---
      // El chat real ya contiene los mensajes entrantes; se quitan del final para no duplicarlos
      const context = await buildChatContext(client, chatId, conversation.messages);
      while (context.length > 0 && context[context.length - 1].role === 'user') context.pop();
      const prospectingMsg = getProspectingMessage(number);
      if (prospectingMsg && !context.some(m => m.role === 'assistant' && m.content === prospectingMsg)) {
        context.unshift({ role: 'assistant', content: prospectingMsg });
      }
      const result = await generateResponse(incoming, { messages: context });

      if (!result.mensaje || result.mensaje.trim() === '') {
        console.log('⚠️ [Responder] ChatGPT devolvió mensaje vacío. No se envía nada.');
        continue;
      }

      // Un cierre con respuesta afirmativa es casi seguro un error de ChatGPT: derivar a César
      if (result.conversacionCerrada && AFFIRMATIVE_RE.test(incoming)) {
        console.log(`⚠️ [Responder] Cierre dudoso con +${number} ("${incoming}"). Se deriva a César.`);
        result.conversacionCerrada = false;
        result.derivarACesar = true;
        result.motivoDerivacion = 'El bot iba a cerrar, pero el prospecto respondió afirmativamente.';
        result.mensaje = 'Perfecto, le escribo personalmente en un rato para coordinar 👍';
      }

      // Si César escribió a mano mientras se generaba la respuesta, no enviar
      if (loadConversation(number).closed) {
        console.log(`✋ [Responder] +${number} ya está en manos de César. Respuesta descartada.`);
        return;
      }

      // --- ENVIAR RESPUESTA ---
      await sendAsBot(client, chatId, result.mensaje);
      console.log(`✅ [Responder] Respondido a +${number}: "${result.mensaje}"`);

      // --- GUARDAR HISTORIAL ---
      conversation.messages.push({ role: 'user', content: incoming });
      conversation.messages.push({ role: 'assistant', content: result.mensaje });
      conversation.replyCount++;

      if (result.conversacionCerrada) {
        conversation.closed = true;
        conversation.closedReason = 'no_interesado';
        console.log(`🔒 [Responder] Conversación con +${number} marcada como cerrada.`);
        await notifyCesar(client,
          `🚫 *Prospecto cerrado (no interesado)*\n\n📱 +${number}\n💬 Último mensaje: "${incoming}"\n\n` +
          `_Si fue un error, escríbele tú: el bot ya no le responde._`);
      }

      // Pedido fuera del guion: César toma la conversación
      if (result.derivarACesar && !result.citaAgendada && !conversation.closed) {
        conversation.closed = true;
        conversation.closedReason = 'derivado_cesar';
        conversation.motivoDerivacion = result.motivoDerivacion || '';
        console.log(`🙋 [Responder] +${number} derivado a César: ${conversation.motivoDerivacion}`);
        await notifyCesar(client,
          `🙋 *Prospecto para ti*\n\n📱 +${number}\n📝 ${conversation.motivoDerivacion}\n💬 Último mensaje: "${incoming}"\n\n` +
          `_Le dije que le escribes en un rato. El bot ya no le responde._`);
      }

      // Con la cita agendada el bot termina su trabajo: César sigue a mano
      const newCita = result.citaAgendada && !conversation.cita;
      if (result.citaAgendada) {
        conversation.closed = true;
        conversation.closedReason = 'cita_agendada';
        conversation.cita = conversation.cita || result.resumen;
        console.log(`🔒 [Responder] Cita agendada con +${number}. El bot deja de responder a este contacto.`);
      }

      saveConversation(number, conversation);
      if (conversation.closed) pendingByNumber.delete(number);

      // --- NOTIFICAR A CÉSAR SI SE AGENDÓ UNA CITA (una sola vez) ---
      if (newCita) {
        const notifMsg =
          `🔔 *¡CITA AGENDADA!*\n\n` +
          `📱 Prospecto: +${number}\n` +
          `📝 ${result.resumen}\n` +
          `⏰ Notificado: ${formatTime(new Date())}\n\n` +
          `💡 Revisa la conversación completa en los logs del servidor.`;

        await notifyCesar(client, notifMsg);
        console.log(`🔔 [Responder] ¡César notificado! Cita agendada con +${number}: ${result.resumen}`);
      }
    }
  } catch (err) {
    console.error(`❌ [Responder] Error respondiendo a +${number}:`, err.message);
  } finally {
    processingNumbers.delete(number);
  }
}

function enqueue(client, number, chatId, text) {
  const entry = pendingByNumber.get(number) || { chatId, texts: [] };
  entry.chatId = chatId;
  entry.texts.push(text);
  pendingByNumber.set(number, entry);
  processQueue(client, number);
}

/**
 * Manejador principal de mensajes entrantes.
 * Filtra, analiza y responde solo a prospectos conocidos.
 */
async function handleIncomingMessage(client, msg) {
  // --- FILTROS DE SEGURIDAD ---

  // No procesar si el responder no está activo
  if (!responderActive || !openai) return;

  // Ignorar mensajes de grupos, estados y difusiones
  if (msg.from.endsWith('@g.us') || msg.from.endsWith('@broadcast')) return;

  // Ignorar mensajes propios
  if (msg.fromMe) return;

  // Ignorar notificaciones de sistema y mensajes sin texto
  if (!msg.body || msg.body.trim() === '') {
    if (!['e2e_notification', 'notification_template'].includes(msg.type)) {
      console.log(`ℹ️ [Responder] Ignorado (sin texto, tipo ${msg.type}) de ${msg.from}`);
    }
    return;
  }

  // Extraer número limpio (soporta @c.us y @lid)
  const number = await resolveSenderNumber(client, msg);
  if (!number) {
    console.log(`⚠️ [Responder] Ignorado: no se pudo resolver el teléfono de ${msg.from}`);
    return;
  }

  // No responder al número del quiz ni a tu número personal
  if (number === config.quiz.targetNumber) return;
  // Mensajes de César al bot: módulo de recordatorios
  if (number === config.responder.cesarNumber) {
    return reminders.handleCesarMessage(client, msg, markBotMessage);
  }

  // Solo responder a prospectos de numeros.txt
  if (!isProspectNumber(number)) {
    console.log(`ℹ️ [Responder] Ignorado: +${number} (${msg.from}) no está en numeros.txt`);
    return;
  }

  console.log(`\n💬 [Responder] (${formatTime(new Date())}) Mensaje de +${number}: "${msg.body}"`);
  enqueue(client, number, msg.from, msg.body);
}

/**
 * Mensajes salientes (message_create con fromMe). Si César escribe a mano
 * en el chat de un prospecto, el bot deja de responder a ese contacto.
 */
async function handleOutgoingMessage(client, msg) {
  if (!msg.fromMe) return;
  if (consumeBotMessage(msg.body)) return; // lo envió el bot
  if (!msg.to || msg.to.endsWith('@g.us') || msg.to.endsWith('@broadcast')) return;

  const number = await resolveNumber(client, msg.to);
  if (!number || !isProspectNumber(number)) return;

  // El mensaje inicial de prospección también sale de este número
  if (sentByProspecting(number, msg.body)) return;

  const conversation = loadConversation(number);
  pendingByNumber.delete(number);
  if (conversation.closed) return;

  conversation.closed = true;
  conversation.closedReason = 'cesar_manual';
  conversation.messages.push({ role: 'assistant', content: msg.body || '[multimedia]' });
  saveConversation(number, conversation);
  console.log(`✋ [Responder] César escribió a mano a +${number}. El bot deja de responder a este contacto.`);
}

function sentByProspecting(number, body) {
  const history = loadHistory(config.historyFile);
  return history.sent.some(h =>
    h.number === number && h.messageSample && body &&
    (h.message ? body === h.message : body.startsWith(h.messageSample.replace(/\.\.\.$/, '')))
  );
}

/**
 * Al arrancar: busca prospectos que escribieron y no recibieron respuesta
 * (mensajes que llegaron con el bot apagado o que fueron descartados) y los responde.
 */
async function processPendingReplies(client) {
  if (!responderActive || !openai) return;

  const maxAgeMs = (config.responder.catchUpDays || 3) * 24 * 60 * 60 * 1000;
  const history = loadHistory(config.historyFile);
  const contacted = [...new Set(
    history.sent
      .filter(h => h.status === 'ENVIADO' && Date.now() - new Date(h.date).getTime() < 30 * 24 * 60 * 60 * 1000)
      .map(h => h.number)
  )];

  console.log(`🔎 [Responder] Revisando ${contacted.length} prospectos contactados por mensajes sin responder...`);

  // Mapear LID -> teléfono de los prospectos contactados
  const pairs = await lookupLidAndPhone(client, contacted.map(n => `${n}@c.us`));
  const phoneToLid = new Map();
  for (const p of pairs) {
    const pn = cleanDigits(p.pn);
    if (p.lid && pn) {
      lidToPhone.set(p.lid, pn);
      phoneToLid.set(pn, p.lid);
    }
  }
  console.log(`🔗 [Responder] LIDs mapeados: ${phoneToLid.size}/${contacted.length}`);

  let found = 0;
  for (const number of contacted) {
    const conversation = loadConversation(number);
    if (conversation.closed || conversation.replyCount >= config.responder.maxRepliesPerContact) continue;

    const candidates = [phoneToLid.get(number), `${number}@c.us`].filter(Boolean);
    for (const chatId of candidates) {
      try {
        const chat = await client.getChatById(chatId);
        const msgs = await chat.fetchMessages({ limit: 60 });
        if (msgs.length === 0) continue;

        // Si no aparece ningún mensaje propio (p. ej. el prospecto mandó muchas fotos),
        // todo lo visible es posterior a nuestro último mensaje
        const lastMineIdx = msgs.map(m => m.fromMe).lastIndexOf(true);

        const unanswered = msgs
          .slice(lastMineIdx + 1)
          .filter(m => !m.fromMe && m.body && m.body.trim() !== '' && Date.now() - m.timestamp * 1000 < maxAgeMs);

        if (unanswered.length > 0) {
          found++;
          const texts = unanswered.map(m => m.body);
          console.log(`📬 [Responder] +${number} tiene ${texts.length} mensaje(s) sin responder: "${texts.join(' / ')}"`);
          for (const t of texts) enqueue(client, number, chat.id._serialized, t);
        }
        break;
      } catch (e) {
        console.log(`⚠️ [Responder] No se pudo revisar ${chatId} (+${number}): ${e.message}`);
      }
    }
  }

  console.log(`🔎 [Responder] Revisión inicial completada: ${found} prospecto(s) con mensajes pendientes.`);
}

module.exports = { initResponder, handleIncomingMessage, handleOutgoingMessage, processPendingReplies, markBotMessage };
