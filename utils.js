const fs = require('fs');

/**
 * Normaliza y formatea un número de teléfono.
 * Si tiene 9 dígitos y empieza con 9 (formato Perú), le antepone el código de país.
 */
function normalizeNumber(raw, defaultCountryCode = '51') {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  if (digits.length === 9 && digits.startsWith('9')) {
    return `${defaultCountryCode}${digits}`;
  }

  if (digits.length === 11 && digits.startsWith(`${defaultCountryCode}9`)) {
    return digits;
  }

  if (digits.length >= 8) {
    return digits;
  }

  return null;
}

/**
 * Lee el archivo de texto y extrae la lista de números únicos limpios.
 */
function loadNumbers(filePath, defaultCountryCode = '51') {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
  const rawItems = content.split(/[\r\n,;]+/);

  const uniqueNumbers = [];
  const seen = new Set();

  for (const item of rawItems) {
    const clean = item.trim();
    if (!clean) continue;

    const formatted = normalizeNumber(clean, defaultCountryCode);
    if (formatted && !seen.has(formatted)) {
      seen.add(formatted);
      uniqueNumbers.push(formatted);
    }
  }

  return uniqueNumbers;
}

/**
 * Carga el historial de envíos.
 */
function loadHistory(historyPath) {
  if (!fs.existsSync(historyPath)) {
    return { sent: [] };
  }

  try {
    const raw = fs.readFileSync(historyPath, 'utf-8');
    const data = JSON.parse(raw);
    if (!data.sent || !Array.isArray(data.sent)) {
      return { sent: [] };
    }
    return data;
  } catch (err) {
    return { sent: [] };
  }
}

/**
 * Guarda el historial de envíos.
 */
function saveHistory(historyPath, historyData) {
  fs.writeFileSync(historyPath, JSON.stringify(historyData, null, 2), 'utf-8');
}

/**
 * Obtiene la fecha local en formato YYYY-MM-DD.
 */
function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Cuenta cuántos mensajes se han enviado exitosamente hoy.
 */
function getSentTodayCount(historyData) {
  const todayStr = getLocalDateString();
  return historyData.sent.filter(entry => {
    if (entry.status !== 'ENVIADO') return false;
    const entryDate = entry.date ? getLocalDateString(new Date(entry.date)) : null;
    return entryDate === todayStr;
  }).length;
}

/**
 * Obtiene un conjunto con los números ya procesados.
 */
function getProcessedNumbersSet(historyData) {
  const set = new Set();
  for (const item of historyData.sent) {
    if (item.number) {
      set.add(item.number);
    }
  }
  return set;
}

/**
 * Pausa la ejecución durante ms milisegundos.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retorna un entero aleatorio entre min y max (inclusive).
 */
function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Genera un mensaje variado combinando aleatoriamente saludo, presentación, contexto y propuesta.
 */
function generateRandomMessage(variations) {
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const greeting = pick(variations.greetings);
  const intro = pick(variations.introductions);
  const context = pick(variations.contexts);
  const proposal = pick(variations.proposals);

  return `${greeting} ${intro} ${context} ${proposal}`;
}

/**
 * Calcula un horario aleatorio dentro de la ventana configurada.
 * Si la ventana de hoy ya pasó o está a punto de terminar, calcula el horario para mañana.
 */
function getNextScheduledTime(timeWindow) {
  const now = new Date();
  const target = new Date(now);

  const startMinutes = timeWindow.startHour * 60 + timeWindow.startMinute;
  const endMinutes = timeWindow.endHour * 60 + timeWindow.endMinute;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  let targetDayOffset = 0;
  let minAllowedMinute = startMinutes;

  if (currentMinutes >= endMinutes - 10) {
    // La ventana de hoy ya pasó o quedan menos de 10 minutos, programar para mañana
    targetDayOffset = 1;
    minAllowedMinute = startMinutes;
  } else if (currentMinutes > startMinutes) {
    // Estamos dentro de la ventana de hoy: elegir entre ahora (+ 3 a 10 min) y el fin de la ventana
    minAllowedMinute = currentMinutes + getRandomInt(2, 5);
  }

  // Generar minuto aleatorio
  const chosenMinuteOfDay = getRandomInt(minAllowedMinute, endMinutes);
  const chosenSecond = getRandomInt(0, 59);

  target.setDate(target.getDate() + targetDayOffset);
  target.setHours(Math.floor(chosenMinuteOfDay / 60), chosenMinuteOfDay % 60, chosenSecond, 0);

  return target;
}

/**
 * Formatea una fecha a hora legible (HH:MM:SS AM/PM).
 */
function formatTime(date) {
  return date.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
}

module.exports = {
  normalizeNumber,
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
};
