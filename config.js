const path = require('path');

module.exports = {
  // Límite diario de mensajes
  dailyLimit: 5,

  // Código de país por defecto (51 = Perú)
  defaultCountryCode: '51',

  // Ventana horaria para el inicio aleatorio del envío diario (Formato 24h)
  // Cada día elegirá una hora y minuto al azar dentro de este rango.
  timeWindow: {
    startHour: 8,     // Desde las 08:30 AM
    startMinute: 30,
    endHour: 12,      // Hasta las 12:30 PM
    endMinute: 30
  },

  // Pausa aleatoria entre mensaje y mensaje (en milisegundos)
  // 120000 ms = 2 minutos, 420000 ms = 7 minutos
  // Esto simula que una persona real busca, lee y envía con calma
  delayBetweenMessages: {
    minMs: 120000, // 2 minutos
    maxMs: 420000  // 7 minutos
  },

  // Variaciones de mensajes (Spintax inteligente)
  // Genera más de 100 combinaciones diferentes para que WhatsApp nunca detecte texto idéntico repetido
  messageVariations: {
    greetings: [
      'Hola.',
      'Hola, ¿qué tal?',
      'Hola, buen día.',
      'Buenas tardes.',
      'Hola, ¿cómo están?'
    ],
    introductions: [
      'Mi nombre es César, soy estudiante universitario de Ingeniería de Sistemas.',
      'Me llamo César y soy estudiante de la carrera de Ingeniería de Sistemas.',
      'Soy César, estudiante universitario de Ingeniería de Sistemas.'
    ],
    contexts: [
      'Vi su perfil en Google Maps, noté que tienen muy buenas reseñas, pero vi que les falta una página web para que los encuentren más fácil.',
      'Estuve viendo su negocio en Google Maps y tienen excelentes calificaciones, pero noté que aún no tienen una página web propia para conseguir más clientes.',
      'Encontré su perfil en Google Maps con muy buenas opiniones, y me percaté de que todavía no cuentan con una página web para que los ubiquen rápido.'
    ],
    proposals: [
      'Como parte de mi proyecto de curso, estoy ofreciendo diseñar la web completa para un negocio local. ¿Les gustaría ser el negocio elegido para mi proyecto?',
      'Como parte de mi proyecto universitario, voy a desarrollar la página web completa para un negocio local. ¿Les interesaría ser el negocio seleccionado?',
      'Para un proyecto de mi facultad, estoy buscando un negocio local para diseñarle su web completa. ¿Les gustaría que trabajemos juntos en mi proyecto?'
    ]
  },

  // Identificador único de sesión para persistencia permanente de WhatsApp
  authClientId: 'prospeccion-bot',

  // Rutas de archivos
  numbersFile: path.join(__dirname, 'numeros.txt'),
  historyFile: path.join(__dirname, 'historial.json'),
  authDataPath: path.join(__dirname, '.wwebjs_auth')
};
