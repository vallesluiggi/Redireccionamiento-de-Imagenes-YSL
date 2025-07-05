class StorageError extends Error {
  constructor(message, originalError = null) {
    super(message);
    this.name = 'StorageError';
    this.originalError = originalError;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, StorageError);
    }
  }
}

module.exports = StorageError;
