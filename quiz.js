const fs = require('fs');
const config = require('./config');
const { getRandomInt, getNextScheduledTime, formatTime, getLocalDateString } = require('./utils');

/**
 * Carga las preguntas desde preguntas.json
 */
function loadQuestions() {
  if (!fs.existsSync(config.quiz.questionsFile)) return [];
  try {
    return JSON.parse(fs.readFileSync(config.quiz.questionsFile, 'utf-8'));
  } catch (e) {
    console.error('❌ [Quiz] Error leyendo preguntas.json:', e.message);
    return [];
  }
}

/**
 * Carga el historial del quiz
 */
function loadQuizHistory() {
  if (!fs.existsSync(config.quiz.historyFile)) {
    return { sent: [], cyclesCompleted: 0 };
  }
  try {
    const data = JSON.parse(fs.readFileSync(config.quiz.historyFile, 'utf-8'));
    return { sent: data.sent || [], cyclesCompleted: data.cyclesCompleted || 0 };
  } catch (e) {
    return { sent: [], cyclesCompleted: 0 };
  }
}

/**
 * Guarda el historial del quiz
 */
function saveQuizHistory(data) {
  fs.writeFileSync(config.quiz.historyFile, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Obtiene la siguiente pregunta pendiente.
 * Cuando se terminan todas, reinicia el ciclo.
 */
function getNextQuestion() {
  const questions = loadQuestions();
  if (questions.length === 0) return null;

  const history = loadQuizHistory();
  const sentIds = new Set(history.sent.map(e => e.id));
  const pending = questions.filter(q => !sentIds.has(q.id));

  if (pending.length === 0) {
    // Todas enviadas: reiniciar ciclo
    console.log(`🔄 [Quiz] Ciclo ${history.cyclesCompleted + 1} completado. Reiniciando preguntas...`);
    saveQuizHistory({ sent: [], cyclesCompleted: history.cyclesCompleted + 1 });
    return questions[0];
  }

  return pending[0];
}

/**
 * Cuenta cuántas preguntas se enviaron hoy
 */
function getQuizSentTodayCount() {
  const history = loadQuizHistory();
  const today = getLocalDateString();
  return history.sent.filter(e => e.date && getLocalDateString(new Date(e.date)) === today).length;
}

/**
 * Verifica si ya se completó la cuota diaria del quiz
 */
function sentQuizToday() {
  const questionsPerDay = config.quiz.questionsPerDay || 1;
  return getQuizSentTodayCount() >= questionsPerDay;
}

/**
 * Calcula el próximo horario aleatorio para el quiz
 */
function getNextQuizTime() {
  return getNextScheduledTime(getQuizStartWindow());
}

/**
 * Ventana para INICIAR la sesión: la hora final se adelanta lo que dura
 * la sesión, para que la última pregunta salga antes del fin de la ventana.
 */
function getQuizStartWindow(questionsToSend) {
  const w = config.quiz.timeWindow;
  const count = questionsToSend || config.quiz.questionsPerDay || 1;
  const sessionMinutes = Math.ceil(
    (count * config.quiz.answerDelayMs + (count - 1) * (config.quiz.delayBetweenQuestionsMs || 0)) / 60000
  );
  const startMinutes = w.startHour * 60 + w.startMinute;
  const endMinutes = Math.max(startMinutes, w.endHour * 60 + w.endMinute - sessionMinutes);
  return {
    startHour: w.startHour,
    startMinute: w.startMinute,
    endHour: Math.floor(endMinutes / 60),
    endMinute: endMinutes % 60
  };
}

/**
 * Formatea el mensaje de pregunta para WhatsApp
 */
function formatQuestionMessage(q) {
  const alternativas = q.alternativas.join('\n');
  return (
    `📚 *Pregunta de Medicina* 📚\n\n` +
    `🏥 *Tema:* ${q.tema}\n\n` +
    `${q.pregunta}\n\n` +
    `*Alternativas:*\n${alternativas}\n\n` +
    `⏱️ _La respuesta en 7 minutos..._`
  );
}

/**
 * Formatea el mensaje de respuesta para WhatsApp
 */
function formatAnswerMessage(q) {
  return (
    `✅ *Respuesta correcta: ${q.respuesta}*\n\n` +
    `💡 *Explicación:*\n${q.explicacion}`
  );
}

module.exports = {
  loadQuestions,
  loadQuizHistory,
  saveQuizHistory,
  getNextQuestion,
  sentQuizToday,
  getQuizSentTodayCount,
  getNextQuizTime,
  getQuizStartWindow,
  formatQuestionMessage,
  formatAnswerMessage
};
