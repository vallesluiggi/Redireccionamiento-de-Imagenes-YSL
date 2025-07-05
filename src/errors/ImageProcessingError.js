// src/errors/ImageProcessingError.js
const CustomError = require('./CustomError');

class ImageProcessingError extends CustomError {
    constructor(message, originalError = null, code = 'ERR_IMAGE_PROCESSING') {
        super(code, message, originalError);
        this.name = 'ImageProcessingError';
    }
}
module.exports = ImageProcessingError;