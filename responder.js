const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { loadNumbers, sleep, getRandomInt, formatTime } = require('./utils');

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

/**
 * Manejador principal de mensajes entrantes.
 * Filtra, analiza y responde solo a prospectos conocidos.
 */
async function handleIncomingMessage(client, msg) {
  // --- FILTROS DE SEGURIDAD ---

  // No procesar si el responder no está activo
  if (!responderActive || !openai) return;

  // Ignorar mensajes de grupos
  if (msg.from.endsWith('@g.us')) return;

  // Ignorar mensajes propios
  if (msg.fromMe) return;

  // Ignorar mensajes vacíos o solo multimedia sin texto
  if (!msg.body || msg.body.trim() === '') return;

  // Extraer número limpio
  const number = msg.from.replace('@c.us', '');

  // No responder al número del quiz (tu novia)
  if (number === config.quiz.targetNumber) return;

  // No responder a tu número personal
  if (number === config.responder.cesarNumber) return;

  // Solo responder a prospectos de numeros.txt
  if (!isProspectNumber(number)) return;

  // --- CARGAR CONVERSACIÓN ---
  const conversation = loadConversation(number);

  // Si la conversación fue cerrada (prospecto dijo "no me interesa"), no responder más
  if (conversation.closed) {
    console.log(`🔒 [Responder] Conversación cerrada con +${number}. No se responde.`);
    return;
  }

  // Verificar límite de respuestas por contacto
  if (conversation.replyCount >= config.responder.maxRepliesPerContact) {
    console.log(`⚠️ [Responder] Límite de ${config.responder.maxRepliesPerContact} respuestas alcanzado para +${number}.`);
    return;
  }

  console.log(`\n💬 [Responder] (${formatTime(new Date())}) Mensaje de +${number}: "${msg.body}"`);

  try {
    // --- PAUSA HUMANA ---
    const delay = getRandomInt(config.responder.replyDelay.minMs, config.responder.replyDelay.maxMs);
    const delayMin = (delay / 60000).toFixed(1);
    console.log(`⏳ [Responder] Esperando ${delayMin} min antes de responder...`);
    await sleep(delay);

    // --- GENERAR RESPUESTA CON CHATGPT ---
    const result = await generateResponse(msg.body, conversation);

    if (!result.mensaje || result.mensaje.trim() === '') {
      console.log('⚠️ [Responder] ChatGPT devolvió mensaje vacío. No se envía nada.');
      return;
    }

    // --- ENVIAR RESPUESTA ---
    await client.sendMessage(msg.from, result.mensaje);
    console.log(`✅ [Responder] Respondido a +${number}: "${result.mensaje}"`);

    // --- GUARDAR HISTORIAL ---
    conversation.messages.push({ role: 'user', content: msg.body });
    conversation.messages.push({ role: 'assistant', content: result.mensaje });
    conversation.replyCount++;

    // Detectar si la conversación se cerró (prospecto no interesado)
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

  } catch (err) {
    console.error(`❌ [Responder] Error respondiendo a +${number}:`, err.message);
  }
}

module.exports = { initResponder, handleIncomingMessage };
