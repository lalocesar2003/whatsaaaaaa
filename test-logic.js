const assert = require('assert');
const path = require('path');
const fs = require('fs');
const utils = require('./utils');
const config = require('./config');

console.log('🧪 Iniciando pruebas de lógica del bot...');

// 1. Prueba de normalización de números
const n1 = utils.normalizeNumber('955555325', '51');
assert.strictEqual(n1, '51955555325', 'Debe anteponer 51 a número de 9 dígitos');

const n2 = utils.normalizeNumber('51955555325', '51');
assert.strictEqual(n2, '51955555325', 'Debe conservar número que ya tiene 51');

const n3 = utils.normalizeNumber(' +51 955-555-325 ', '51');
assert.strictEqual(n3, '51955555325', 'Debe limpiar espacios, guiones y símbolos');

console.log('✅ Prueba 1: Normalización de números exitosa.');

// 2. Prueba de carga desde archivo y deduplicación
const testNumbersFile = path.join(__dirname, 'test_numeros_temp.txt');
fs.writeFileSync(testNumbersFile, '955555325,952165948,954484541,952165948,954484541\n987654321, 912345678');

const loaded = utils.loadNumbers(testNumbersFile, '51');
// Esperamos 5 números únicos:
// 51955555325, 51952165948, 51954484541, 51987654321, 51912345678
assert.strictEqual(loaded.length, 5, `Se esperaban 5 números únicos, se obtuvieron ${loaded.length}`);
assert.strictEqual(loaded[0], '51955555325');
assert.strictEqual(loaded[1], '51952165948');
assert.strictEqual(loaded[2], '51954484541');
assert.strictEqual(loaded[3], '51987654321');
assert.strictEqual(loaded[4], '51912345678');
fs.unlinkSync(testNumbersFile);

console.log('✅ Prueba 2: Carga y deduplicación de números exitosa.');

// 3. Prueba de conteo de cuota diaria e historial
const mockHistory = {
  sent: [
    { number: '51955555325', date: new Date().toISOString(), status: 'ENVIADO' },
    { number: '51952165948', date: new Date().toISOString(), status: 'ENVIADO' },
    { number: '51900000000', date: '2026-01-01T10:00:00.000Z', status: 'ENVIADO' } // de otro día
  ]
};

const sentToday = utils.getSentTodayCount(mockHistory);
assert.strictEqual(sentToday, 2, 'Debe contar solo los 2 enviados hoy');

const processedSet = utils.getProcessedNumbersSet(mockHistory);
assert.strictEqual(processedSet.has('51955555325'), true);
assert.strictEqual(processedSet.has('51999999999'), false);

console.log('✅ Prueba 3: Manejo de historial y límite diario exitoso.');

console.log('\n🎉 ¡Todas las pruebas unitarias pasaron satisfactoriamente!');
