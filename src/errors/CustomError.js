// src/errors/CustomError.js
/**
 * Clase base para errores personalizados de la librería.
 * Permite tipificar los errores para un manejo más granular.
 */
class CustomError extends Error {
    constructor(message, originalError = null, code = 'ERR_UNKNOWN') {
        super(message);
        this.name = this.constructor.name;
        this.originalError = originalError; // Guarda el error original para depuración
        this.code = code; // Código de error específico
        // Captura el stack trace, excluyendo el constructor del error de la pila
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

module.exports = CustomError;