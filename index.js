const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const config = require('./config');
const {
  loadNumbers,
  loadHistory,
  saveHistory,
  getLocalDateString,
  getSentTodayCount,
  getProcessedNumbersSet,
  sleep,
  getRandomInt,
  generateRandomMessage,
  getNextScheduledTime,
  formatTime
} = require('./utils');
const {
  getNextQuestion,
  sentQuizToday,
  saveQuizHistory,
  loadQuizHistory,
  getNextQuizTime,
  formatQuestionMessage,
  formatAnswerMessage
} = require('./quiz');

// Estado global de la aplicación
let clientReady = false;
let isSending = false;
let nextScheduledRun = null;

// Estado global del quiz
let nextQuizRun = null;
let isSendingQuiz = false;


// Configuración de Puppeteer (adaptada para Windows y Ubuntu Server)
const puppeteerOptions = {
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu'
  ]
};

if (process.env.PUPPETEER_EXECUTABLE_PATH) {
  puppeteerOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
}

// Inicialización del cliente con sesión persistente
const client = new Client({
  authStrategy: new LocalAuth({
    clientId: config.authClientId,
    dataPath: config.authDataPath
  }),
  puppeteer: puppeteerOptions
});

console.log('================================================================');
console.log(' 🚀 BOT DE PROSPECCIÓN WHATSAPP 24/7 (SESIÓN PERMANENTE)');
console.log('================================================================\n');

client.on('qr', (qr) => {
  console.log('\n📲 ESCANEA ESTE CÓDIGO QR CON WHATSAPP:');
  console.log('(Abre WhatsApp > Ajustes/Tres puntos > Dispositivos vinculados > Vincular un dispositivo)\n');
  qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
  console.log('🔐 [WhatsApp] Sesión autenticada y credenciales sincronizadas con éxito.');
});

client.on('auth_failure', (err) => {
  console.error('❌ [WhatsApp] Error de autenticación:', err);
});

client.on('disconnected', async (reason) => {
  console.warn(`⚠️ [WhatsApp] Cliente desconectado por: ${reason}`);
  clientReady = false;
  console.log('🔄 Reintentando reconectar en 30 segundos...');
  await sleep(30000);
  try {
    await client.initialize();
  } catch (e) {
    console.error('Error al reconectar:', e.message);
  }
});

client.on('ready', async () => {
  clientReady = true;
  console.log('\n✅ [WhatsApp] Conexión establecida y lista para operar 24/7.');

  const history = loadHistory(config.historyFile);
  const sentToday = getSentTodayCount(history);
  console.log(`📊 Mensajes enviados hoy (${getLocalDateString()}): ${sentToday}/${config.dailyLimit}`);

  if (sentToday >= config.dailyLimit) {
    console.log(`📌 Cuota diaria de hoy completada (${config.dailyLimit}/${config.dailyLimit}).`);
    scheduleNextRun(true);
  } else {
    scheduleNextRun(false);
  }

  // Inicializar el quiz
  scheduleNextQuiz();
});

/**
 * Programa la siguiente ronda de envíos con horario y minutos aleatorios.
 */
function scheduleNextRun(forceTomorrow = false) {
  if (forceTomorrow) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const startMinutes = config.timeWindow.startHour * 60 + config.timeWindow.startMinute;
    const endMinutes = config.timeWindow.endHour * 60 + config.timeWindow.endMinute;
    const chosenMinute = getRandomInt(startMinutes, endMinutes);
    tomorrow.setHours(Math.floor(chosenMinute / 60), chosenMinute % 60, getRandomInt(0, 59), 0);
    nextScheduledRun = tomorrow;
  } else {
    nextScheduledRun = getNextScheduledTime(config.timeWindow);
  }

  console.log(`\n⏰ [Planificador] Próxima ronda programada para:`);
  console.log(`   👉 Fecha: ${nextScheduledRun.toLocaleDateString()} a las ${formatTime(nextScheduledRun)}`);
  console.log(`   💤 El bot permanecerá en reposo conectado a WhatsApp hasta esa hora...\n`);
}

/**
 * Programa el próximo envío del quiz médico.
 */
function scheduleNextQuiz() {
  if (sentQuizToday()) {
    // Ya se envió hoy: programar para mañana
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const startMinutes = config.quiz.timeWindow.startHour * 60 + config.quiz.timeWindow.startMinute;
    const endMinutes = config.quiz.timeWindow.endHour * 60 + config.quiz.timeWindow.endMinute;
    const chosenMinute = getRandomInt(startMinutes, endMinutes);
    tomorrow.setHours(Math.floor(chosenMinute / 60), chosenMinute % 60, getRandomInt(0, 59), 0);
    nextQuizRun = tomorrow;
  } else {
    nextQuizRun = getNextQuizTime(config.quiz.timeWindow);
  }

  const questions = require('./quiz').loadQuestions();
  const history = require('./quiz').loadQuizHistory();
  const pending = questions.length - history.sent.length;

  console.log(`\n📚 [Quiz] Próxima pregunta médica programada para:`);
  console.log(`   👉 Fecha: ${nextQuizRun.toLocaleDateString()} a las ${formatTime(nextQuizRun)}`);
  console.log(`   📋 Preguntas pendientes en el banco: ${pending >= 0 ? pending : questions.length}\n`);
}


/**
 * Ejecuta el lote diario de prospección con variaciones y desfases humanos.
 */
async function executeDailyBatch() {
  if (isSending) return;
  isSending = true;

  try {
    console.log('\n================================================================');
    console.log(`🔔 [${formatTime(new Date())}] INICIANDO RONDA DIARIA DE PROSPECCIÓN`);
    console.log('================================================================');

    const history = loadHistory(config.historyFile);
    const sentToday = getSentTodayCount(history);

    if (sentToday >= config.dailyLimit) {
      console.log(`⚠️ Ya se alcanzó el límite de hoy (${sentToday}/${config.dailyLimit}).`);
      scheduleNextRun(true);
      isSending = false;
      return;
    }

    const remainingQuota = config.dailyLimit - sentToday;
    const processedNumbers = getProcessedNumbersSet(history);
    const allNumbers = loadNumbers(config.numbersFile, config.defaultCountryCode);
    const pendingNumbers = allNumbers.filter(num => !processedNumbers.has(num));

    if (pendingNumbers.length === 0) {
      console.warn('⚠️ No hay números pendientes en numeros.txt.');
      console.log('👉 Agrega nuevos números a numeros.txt. El bot volverá a comprobar mañana.');
      scheduleNextRun(true);
      isSending = false;
      return;
    }

    const batch = pendingNumbers.slice(0, remainingQuota);
    console.log(`🎯 Contactando ${batch.length} prospectos en esta ronda:\n`);

    for (let i = 0; i < batch.length; i++) {
      const number = batch[i];
      const chatId = `${number}@c.us`;

      console.log(`----------------------------------------------------------------`);
      console.log(`[${i + 1}/${batch.length}] (${formatTime(new Date())}) Contactando a +${number}...`);

      try {
        // 1. Verificar si tiene WhatsApp
        const isRegistered = await client.isRegisteredUser(chatId);
        if (!isRegistered) {
          console.log(`⚠️ El número +${number} no tiene cuenta activa en WhatsApp. Omitiendo...`);
          history.sent.push({
            number,
            date: new Date().toISOString(),
            status: 'NO_REGISTRADO',
            error: 'No existe en WhatsApp'
          });
          saveHistory(config.historyFile, history);
          continue;
        }

        // 2. Generar mensaje con redacción y saludo aleatorio
        const messageToSend = generateRandomMessage(config.messageVariations);
        console.log(`📨 Mensaje generado:\n"${messageToSend}"\n`);

        // 3. Enviar mensaje
        await client.sendMessage(chatId, messageToSend);
        console.log(`✨ ¡Mensaje enviado exitosamente a +${number}!`);

        history.sent.push({
          number,
          date: new Date().toISOString(),
          status: 'ENVIADO',
          messageSample: messageToSend.substring(0, 40) + '...'
        });
        saveHistory(config.historyFile, history);

      } catch (err) {
        console.error(`❌ Error al enviar a +${number}:`, err.message);
        history.sent.push({
          number,
          date: new Date().toISOString(),
          status: 'ERROR',
          error: err.message
        });
        saveHistory(config.historyFile, history);
      }

      // 4. Pausa humana aleatoria entre prospectos (si quedan más en este lote)
      if (i < batch.length - 1) {
        const delayMs = getRandomInt(config.delayBetweenMessages.minMs, config.delayBetweenMessages.maxMs);
        const delayMin = (delayMs / 60000).toFixed(1);
        console.log(`\n⏳ Pausa humana anti-bot: esperando ${delayMin} minutos antes del siguiente prospecto...`);
        await sleep(delayMs);
      }
    }

    console.log('\n================================================================');
    console.log('🎉 Ronda diaria completada con éxito.');
    const updatedCount = getSentTodayCount(history);
    console.log(`📊 Total enviados hoy: ${updatedCount}/${config.dailyLimit}`);

    const remainingTotal = loadNumbers(config.numbersFile, config.defaultCountryCode)
      .filter(num => !getProcessedNumbersSet(history).has(num)).length;
    console.log(`📋 Números restantes pendientes en archivo: ${remainingTotal}`);
    console.log('================================================================\n');

    // Programar la siguiente ejecución para mañana a una hora aleatoria
    scheduleNextRun(true);

  } catch (error) {
    console.error('❌ Error imprevisto durante la ronda diaria:', error);
    scheduleNextRun(true);
  } finally {
    isSending = false;
  }
}

/**
 * Ejecuta el envío de la pregunta diaria del quiz médico.
 * Primero envía la pregunta, espera 7 minutos y luego envía la respuesta.
 */
async function executeQuiz() {
  if (isSendingQuiz) return;
  isSendingQuiz = true;

  try {
    const question = getNextQuestion();
    if (!question) {
      console.log('⚠️ [Quiz] No hay preguntas en preguntas.json. Agrega preguntas y reinicia.');
      scheduleNextQuiz();
      isSendingQuiz = false;
      return;
    }

    const chatId = `${config.quiz.targetNumber}@c.us`;
    console.log(`\n📚 [Quiz] (${formatTime(new Date())}) Enviando pregunta: "${question.tema}"`);

    // 1. Verificar que el número existe en WhatsApp
    const isRegistered = await client.isRegisteredUser(chatId);
    if (!isRegistered) {
      console.error(`❌ [Quiz] El número ${config.quiz.targetNumber} no está registrado en WhatsApp.`);
      scheduleNextQuiz();
      isSendingQuiz = false;
      return;
    }

    // 2. Enviar la pregunta
    await client.sendMessage(chatId, formatQuestionMessage(question));
    console.log(`✅ [Quiz] Pregunta enviada. Esperando ${config.quiz.answerDelayMs / 60000} minutos para enviar respuesta...`);

    // 3. Esperar el tiempo configurado (7 minutos)
    await sleep(config.quiz.answerDelayMs);

    // 4. Enviar la respuesta
    await client.sendMessage(chatId, formatAnswerMessage(question));
    console.log(`✅ [Quiz] Respuesta enviada para: "${question.tema}"`);

    // 5. Guardar en historial
    const history = loadQuizHistory();
    history.sent.push({
      id: question.id,
      tema: question.tema,
      date: new Date().toISOString(),
      respuesta: question.respuesta
    });
    saveQuizHistory(history);

    // 6. Programar la siguiente pregunta
    scheduleNextQuiz();

  } catch (err) {
    console.error('❌ [Quiz] Error durante el envío:', err.message);
    scheduleNextQuiz();
  } finally {
    isSendingQuiz = false;
  }
}

// Heartbeat cada 30 segundos: verifica si llegó la hora del prospecting o del quiz
setInterval(() => {
  if (!clientReady) return;

  const now = new Date();

  // Verificar si es hora de prospectar
  if (!isSending && nextScheduledRun && now >= nextScheduledRun) {
    executeDailyBatch();
  }

  // Verificar si es hora de enviar pregunta del quiz
  if (!isSendingQuiz && nextQuizRun && now >= nextQuizRun) {
    executeQuiz();
  }
}, 30000);

// Iniciar el cliente de WhatsApp
client.initialize().catch((err) => {
  console.error('❌ Error crítico al inicializar cliente:', err);
});

