// src/errors/StorageError.js
const CustomError = require('./CustomError'); // Importa la clase base

/**
 * Error relacionado con problemas durante el almacenamiento de la imagen (local o S3).
 */
class StorageError extends CustomError {
  constructor(message, originalError = null) {
    super(message, originalError, 'ERR_STORAGE');
  }
}

module.exports = StorageError;
