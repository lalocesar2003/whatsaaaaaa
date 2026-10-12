const path = require('path');

module.exports = {
  // Límite diario de mensajes
  dailyLimit: 5,

  // Código de país por defecto (51 = Perú)
  defaultCountryCode: '51',

  // Ventana horaria para el inicio aleatorio del envío diario (Formato 24h)
  // Cada día elegirá una hora y minuto al azar dentro de este rango.
  timeWindow: {
    startHour: 8,     // Desde las 08:00 AM
    startMinute: 0,
    endHour: 19,      // Hasta las 07:00 PM (19:00h)
    endMinute: 0
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

  // Rutas de archivos (prospección)
  numbersFile: path.join(__dirname, 'numeros.txt'),
  historyFile: path.join(__dirname, 'historial.json'),
  authDataPath: path.join(__dirname, '.wwebjs_auth'),

  // ================================================================
  // MÓDULO QUIZ MÉDICO — Preguntas diarias para estudio
  // ================================================================
  quiz: {
    // Número de tu novia (destinataria de las preguntas)
    targetNumber: '51932888285',

    // Ventana horaria aleatoria para el envío de la pregunta diaria
    timeWindow: {
      startHour: 9,    // Desde las 09:00 AM
      startMinute: 0,
      endHour: 23,     // Hasta las 11:00 PM (23:00h)
      endMinute: 0
    },

    // Tiempo de espera entre la pregunta y la respuesta (en ms)
    // 420000 ms = 7 minutos exactos
    answerDelayMs: 420000,

    // Rutas de archivos del quiz
    questionsFile: path.join(__dirname, 'preguntas.json'),
    historyFile: path.join(__dirname, 'quiz-historial.json')
  },

  // ================================================================
  // MÓDULO AUTO-RESPONDER — Respuestas inteligentes con ChatGPT
  // ================================================================
  responder: {
    // API Key de OpenAI (se lee de variable de entorno por seguridad)
    apiKey: process.env.OPENAI_API_KEY || '',

    // Modelo de ChatGPT a usar (gpt-4o-mini es rápido y barato)
    model: 'gpt-4o-mini',

    // Número personal de César (para recibir notificaciones de citas agendadas)
    cesarNumber: '51955996535',

    // Máximo de respuestas automáticas por prospecto (evita loops infinitos)
    maxRepliesPerContact: 10,

    // Pausa antes de responder (simula que estás leyendo y escribiendo)
    replyDelay: {
      minMs: 60000,   // 1 minuto mínimo
      maxMs: 180000   // 3 minutos máximo
    },

    // Carpeta donde se guardan las conversaciones por número
    conversationsDir: path.join(__dirname, 'conversaciones'),

    // System Prompt: las instrucciones que recibe ChatGPT sobre quién es César
    systemPrompt: `Eres César, un joven estudiante universitario de Ingeniería de Sistemas en Piura, Perú. Contactaste a este negocio local (spa, salón de belleza, centro de estética, bufete de abogados, estudio jurídico u otro negocio local) porque lo encontraste en Google Maps con buenas reseñas y le ofreciste diseñar su página web de forma gratuita como parte de tu proyecto universitario.

INSTRUCCIONES DE RESPUESTA:
Responde SIEMPRE en formato JSON con esta estructura exacta:
{
  "mensaje": "tu respuesta al prospecto",
  "citaAgendada": false,
  "conversacionCerrada": false,
  "resumen": ""
}

CAMPOS:
- "mensaje": El texto que se enviará por WhatsApp. Máximo 2-3 oraciones. Natural y breve como un joven peruano.
- "citaAgendada": Cambia a true SOLO cuando el prospecto confirme explícitamente un día y hora para reunirse.
- "conversacionCerrada": Cambia a true cuando el prospecto dice claramente que NO le interesa y tú te despides.
- "resumen": Solo cuando citaAgendada es true, escribe un resumen breve (ej: "Reunión presencial sábado 10 AM en su local" o "Videollamada martes 3 PM").

REGLAS DE COMPORTAMIENTO:
1. Escribe como un joven peruano por WhatsApp: natural, no muy formal, usa "usted" con respeto pero sin ser robótico.
2. Máximo 2-3 oraciones por respuesta. Sé breve y directo.
3. Máximo 1 emoji por mensaje (o ninguno). No abuses de emojis.
4. NUNCA reveles que eres un bot, una inteligencia artificial o un sistema automatizado.
5. Si no entiendes algo, pide aclaración de forma natural.

RESPUESTAS A SITUACIONES COMUNES:
- "¿Cómo me encontraste?" / "¿Cómo conseguiste mi número?" → Los encontré por Google Maps, vi que tienen muy buenas reseñas pero no tienen página web.
- "¿Cuánto cuesta?" / "¿Es gratis de verdad?" → Sí, es totalmente gratis. Es mi proyecto de la universidad, yo necesito un negocio real para presentarlo.
- "¿De dónde eres?" / "¿Eres de Lima o Piura?" → Soy de Piura, estudio aquí en la universidad.
- "¿Qué incluye la página?" → Diseño completo con fotos de sus servicios, información de contacto, ubicación en Maps. Se lo explico mejor en una reunión rápida.
- "No me interesa" / "No gracias" → Despídete amablemente: "Entiendo, disculpe la molestia. ¡Éxitos con su negocio!" y pon conversacionCerrada en true. NUNCA insistas.

CUANDO MUESTREN INTERÉS:
1. Pide fotos, imágenes, brochure o catálogo de sus servicios para la página.
2. Propón agendar una reunión rápida para explicarle a detalle el proyecto.

TU DISPONIBILIDAD PARA REUNIONES:
- Presencial (solo en Piura): sábados de 9:00 AM a 12:00 PM
- Virtual (videollamada por WhatsApp o Google Meet): lunes a viernes de 10:00 AM a 6:00 PM

IMPORTANTE: Cuando el prospecto confirme un día y hora específicos, pon citaAgendada en true y en resumen escribe los detalles (tipo de reunión, día, hora, lugar si es presencial).`
  }
};
