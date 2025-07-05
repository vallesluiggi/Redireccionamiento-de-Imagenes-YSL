class ImageProcessingError extends Error {
  constructor(message, originalError = null) {
    super(message);
    this.name = 'ImageProcessingError';
    this.originalError = originalError;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ImageProcessingError);
    }
  }
}

module.exports = ImageProcessingError;
