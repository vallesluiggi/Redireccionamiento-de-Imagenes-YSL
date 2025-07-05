// images-resized\src\logger.js
const winston = require('winston');

// Definir los niveles de log y sus colores (opcional, pero buena práctica)
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  verbose: 4,
  debug: 5,
  silly: 6,
};

// Definir los colores para los niveles (para la consola)
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  verbose: 'cyan',
  debug: 'blue',
  silly: 'grey',
};

winston.addColors(colors); // Añadir colores a Winston

// Formato de log para archivos
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }), // Para incluir stack traces en errores
  winston.format.json() // Salida en formato JSON para archivos
);

// Formato de log para consola
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }), // Colorear todos los niveles
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(
    (info) =>
      `${info.timestamp} ${info.level}: ${info.message}` +
      (info.stack ? `\n${info.stack}` : '')
  )
);

// Obtener el nivel de log desde las variables de entorno, con un valor por defecto
const logLevel = process.env.LOG_LEVEL || 'info'; // 'info' como default si no está en .env

const logger = winston.createLogger({
  levels, // Usar los niveles personalizados
  level: logLevel, // Nivel de log actual
  transports: [
    new winston.transports.Console({
      format: consoleFormat,
    }),
    new winston.transports.File({
      filename: 'error.log',
      level: 'error',
      format: fileFormat,
    }),
    new winston.transports.File({
      filename: 'combined.log',
      format: fileFormat,
    }),
  ],
});

module.exports = logger;
