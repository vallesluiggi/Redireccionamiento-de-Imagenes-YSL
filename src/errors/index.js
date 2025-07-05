// src/errors/index.js
const CustomError = require('./CustomError');
const ConfigurationError = require('./ConfigurationError');
const ImageProcessingError = require('./ImageProcessingError');
const StorageError = require('./StorageError');

module.exports = {
  CustomError,
  ConfigurationError,
  ImageProcessingError,
  StorageError,
};
