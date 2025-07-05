// src/errors/ConfigurationError.js
const CustomError = require('./CustomError'); // Importa la clase base

/**
 * Error relacionado con problemas de configuración de la librería o de las opciones de entrada.
 */
class ConfigurationError extends CustomError {
  constructor(message, originalError = null) {
    super(message, originalError, 'ERR_CONFIGURATION');
  }
}

module.exports = ConfigurationError;
