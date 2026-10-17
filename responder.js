const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
const config = require('./config');
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
    temperature: 0.7,
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
  if (msg.from.endsWith('@c.us')) return msg.from.replace('@c.us', '');
  if (!msg.from.endsWith('@lid')) return null;

  const [entry] = await lookupLidAndPhone(client, [msg.from]);
  const pn = entry && cleanDigits(entry.pn);
  if (pn) {
    lidToPhone.set(msg.from, pn);
    return pn;
  }

  if (lidToPhone.has(msg.from)) return lidToPhone.get(msg.from);

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
  return fallbackMessages.slice(-10);
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

      const { chatId, texts } = pendingByNumber.get(number);
      pendingByNumber.delete(number);
      const incoming = texts.join('\n');

      const conversation = loadConversation(number);
      if (conversation.closed) {
        console.log(`🔒 [Responder] Conversación cerrada con +${number}. No se responde.`);
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
      const result = await generateResponse(incoming, { messages: context });

      if (!result.mensaje || result.mensaje.trim() === '') {
        console.log('⚠️ [Responder] ChatGPT devolvió mensaje vacío. No se envía nada.');
        continue;
      }

      // --- ENVIAR RESPUESTA ---
      await client.sendMessage(chatId, result.mensaje);
      console.log(`✅ [Responder] Respondido a +${number}: "${result.mensaje}"`);

      // --- GUARDAR HISTORIAL ---
      conversation.messages.push({ role: 'user', content: incoming });
      conversation.messages.push({ role: 'assistant', content: result.mensaje });
      conversation.replyCount++;

      if (result.conversacionCerrada) {
        conversation.closed = true;
        console.log(`🔒 [Responder] Conversación con +${number} marcada como cerrada.`);
      }

      saveConversation(number, conversation);

      // --- NOTIFICAR A CÉSAR SI SE AGENDÓ UNA CITA ---
      if (result.citaAgendada) {
        const notifChatId = `${config.responder.cesarNumber}@c.us`;
        const notifMsg =
          `🔔 *¡CITA AGENDADA!*\n\n` +
          `📱 Prospecto: +${number}\n` +
          `📝 ${result.resumen}\n` +
          `⏰ Notificado: ${formatTime(new Date())}\n\n` +
          `💡 Revisa la conversación completa en los logs del servidor.`;

        await client.sendMessage(notifChatId, notifMsg);
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

  // No responder al número del quiz (tu novia) ni a tu número personal
  if (number === config.quiz.targetNumber) return;
  if (number === config.responder.cesarNumber) return;

  // Solo responder a prospectos de numeros.txt
  if (!isProspectNumber(number)) {
    console.log(`ℹ️ [Responder] Ignorado: +${number} (${msg.from}) no está en numeros.txt`);
    return;
  }

  console.log(`\n💬 [Responder] (${formatTime(new Date())}) Mensaje de +${number}: "${msg.body}"`);
  enqueue(client, number, msg.from, msg.body);
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

  let found = 0;
  for (const number of contacted) {
    const conversation = loadConversation(number);
    if (conversation.closed || conversation.replyCount >= config.responder.maxRepliesPerContact) continue;

    const candidates = [phoneToLid.get(number), `${number}@c.us`].filter(Boolean);
    for (const chatId of candidates) {
      try {
        const chat = await client.getChatById(chatId);
        const msgs = await chat.fetchMessages({ limit: 20 });
        if (msgs.length === 0) continue;

        const lastMineIdx = msgs.map(m => m.fromMe).lastIndexOf(true);
        if (lastMineIdx === -1) break;

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
        // Probar el siguiente ID candidato
      }
    }
  }

  console.log(`🔎 [Responder] Revisión inicial completada: ${found} prospecto(s) con mensajes pendientes.`);
}

module.exports = { initResponder, handleIncomingMessage, processPendingReplies };
