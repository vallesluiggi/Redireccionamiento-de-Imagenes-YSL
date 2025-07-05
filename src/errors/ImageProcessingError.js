// src/errors/ImageProcessingError.js
const CustomError = require('./CustomError'); // Importa la clase base

/**
 * Error relacionado con problemas durante el procesamiento de la imagen (ej. formato inválido, corrupción).
 */
class ImageProcessingError extends CustomError {
  constructor(message, originalError = null) {
    super(message, originalError, 'ERR_IMAGE_PROCESSING');
  }
}

module.exports = ImageProcessingError;
