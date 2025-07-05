// src/errors/CustomError.js
class CustomError extends Error {
    constructor(code, message, originalError = null) {
        super(message);
        this.name = this.constructor.name;
        this.code = code;
        this.originalError = originalError;

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}
module.exports = CustomError;