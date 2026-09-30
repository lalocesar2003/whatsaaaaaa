const assert = require('assert');
const utils = require('./utils');
const config = require('./config');

console.log('🧪 Probando sistema de aleatoriedad avanzada anti-bot...\n');

// 1. Probar generador de mensajes variados
console.log('📝 Generando 5 mensajes de prueba:');
const generatedMessages = new Set();
for (let i = 1; i <= 5; i++) {
  const msg = utils.generateRandomMessage(config.messageVariations);
  console.log(`\n--- Mensaje ${i} ---`);
  console.log(msg);
  generatedMessages.add(msg);
  assert(msg.includes('César'), 'El mensaje debe incluir el nombre César');
  assert(msg.includes('Ingeniería de Sistemas'), 'El mensaje debe mencionar Ingeniería de Sistemas');
}

console.log(`\nVariedad conseguida: ${generatedMessages.size} de 5 mensajes son sintácticamente únicos.`);
console.log('✅ Prueba 1: Generación de mensajes aleatorios superada.\n');

// 2. Probar cálculo de ventana de tiempo aleatoria
console.log('⏰ Probando cálculo de horarios aleatorios:');
for (let i = 1; i <= 3; i++) {
  const nextTime = utils.getNextScheduledTime(config.timeWindow);
  console.log(`   Simulación ${i}: Programado para ${nextTime.toLocaleDateString()} a las ${utils.formatTime(nextTime)}`);
  assert(nextTime instanceof Date, 'Debe retornar una instancia de Date');
}
console.log('✅ Prueba 2: Cálculo de horarios con desfase horario superada.\n');

// 3. Probar retardos aleatorios entre mensajes
console.log('⏳ Probando desfase entre mensajes:');
for (let i = 1; i <= 3; i++) {
  const delayMs = utils.getRandomInt(config.delayBetweenMessages.minMs, config.delayBetweenMessages.maxMs);
  const minutes = (delayMs / 60000).toFixed(1);
  console.log(`   Pausa ${i}: ${delayMs} ms (~${minutes} minutos)`);
  assert(delayMs >= config.delayBetweenMessages.minMs && delayMs <= config.delayBetweenMessages.maxMs);
}
console.log('✅ Prueba 3: Cálculo de pausas entre prospectos superada.\n');

console.log('🎉 ¡Todas las pruebas de aleatoriedad pasaron exitosamente!');
