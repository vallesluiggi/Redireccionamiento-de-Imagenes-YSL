require('dotenv').config(); // Carga las variables de entorno al inicio

const { saveImageLocally } = require('./local-storage');
const { initS3, uploadImageToS3 } = require('./s3-storage');
const {
  ConfigurationError,
  ImageProcessingError,
  StorageError,
} = require('./errors');
const { SUPPORTED_OUTPUT_FORMATS } = require('./utils');

/**
 * Clase principal para la librería de redimensionamiento de imágenes YSL.
 * Permite procesar imágenes y almacenarlas localmente o en AWS S3 según la configuración.
 */
class ImageResizer {
  /**
   * @property {boolean} enableLocalStorage - Indica si el almacenamiento local está habilitado.
   * @property {boolean} enableS3Storage - Indica si el almacenamiento en S3 está habilitado.
   * @property {string | null} localStoragePath - Ruta de almacenamiento local si está habilitado.
   * @property {string | null} s3BucketName - Nombre del bucket S3 si está habilitado.
   */
  constructor() {
    this.enableLocalStorage = process.env.ENABLE_LOCAL_STORAGE === 'true';
    this.enableS3Storage = process.env.ENABLE_S3_STORAGE === 'true';

    // Validar que al menos una opción de almacenamiento esté habilitada
    if (!this.enableLocalStorage && !this.enableS3Storage) {
      throw new ConfigurationError(
        'Debe habilitar al menos una opción de almacenamiento (ENABLE_LOCAL_STORAGE o ENABLE_S3_STORAGE) en el archivo .env.'
      );
    }

    // Configuración para almacenamiento local
    if (this.enableLocalStorage) {
      this.localStoragePath = process.env.LOCAL_STORAGE_PATH;
      if (!this.localStoragePath) {
        throw new ConfigurationError(
          'La variable de entorno LOCAL_STORAGE_PATH debe estar configurada si ENABLE_LOCAL_STORAGE es true.'
        );
      }
    }

    // Configuración para almacenamiento S3
    if (this.enableS3Storage) {
      this.s3BucketName = process.env.AWS_S3_BUCKET_NAME;
      const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION } =
        process.env;

      if (
        !AWS_ACCESS_KEY_ID ||
        !AWS_SECRET_ACCESS_KEY ||
        !AWS_REGION ||
        !this.s3BucketName
      ) {
        throw new ConfigurationError(
          'Las variables de entorno de AWS S3 (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_S3_BUCKET_NAME) deben estar configuradas si ENABLE_S3_STORAGE es true.'
        );
      }
      initS3(AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION);
    }
  }

  /**
   * Procesa una imagen, redimensionándola y guardándola según las opciones de almacenamiento habilitadas.
   * Si ambos almacenamientos están habilitados, la imagen se procesará y guardará en ambos.
   * @param {Buffer} imageBuffer - El buffer de la imagen a procesar.
   * @param {string} originalFilename - El nombre original del archivo (ej. "mi-imagen.jpg").
   * @param {object} [options={}] - Opciones adicionales para el procesamiento.
   * @param {string} [options.outputFormat='jpeg'] - El formato de salida deseado para las imágenes redimensionadas (ej. 'jpeg', 'png', 'webp').
   * @param {number} [options.quality] - La calidad de la imagen de salida (0-100). Si no se especifica, usa la calidad por defecto del tamaño.
   * @returns {Promise<object>} Un objeto con los resultados de cada tipo de almacenamiento (local y/o S3).
   * @throws {ConfigurationError} Si hay un problema con la configuración de las variables de entorno.
   * @throws {ImageProcessingError} Si hay un problema durante el procesamiento de la imagen.
   * @throws {StorageError} Si hay un problema durante el almacenamiento de la imagen.
   */
  async processImage(imageBuffer, originalFilename, options = {}) {
    const { outputFormat = 'jpeg', quality } = options;

    // Validaciones de parámetros de entrada
    if (!imageBuffer || !(imageBuffer instanceof Buffer)) {
      throw new ImageProcessingError(
        'El parámetro `imageBuffer` debe ser un Buffer válido.'
      );
    }
    if (
      !originalFilename ||
      typeof originalFilename !== 'string' ||
      originalFilename.trim() === ''
    ) {
      throw new ImageProcessingError(
        'El parámetro `originalFilename` debe ser una cadena de texto no vacía.'
      );
    }
    // Normalizar y validar el formato de salida
    const normalizedOutputFormat = outputFormat.toLowerCase();
    if (!SUPPORTED_OUTPUT_FORMATS[normalizedOutputFormat]) {
      throw new ConfigurationError(
        `El formato de salida '${outputFormat}' no es soportado. Los formatos soportados son: ${Object.keys(
          SUPPORTED_OUTPUT_FORMATS
        ).join(', ')}.`
      );
    }
    if (
      quality !== undefined &&
      (typeof quality !== 'number' || quality < 0 || quality > 100)
    ) {
      throw new ConfigurationError(
        'La calidad debe ser un número entre 0 y 100.'
      );
    }

    const results = {};

    try {
      if (this.enableLocalStorage) {
        console.log('Procesando para almacenamiento local...');
        results.local = await saveImageLocally(
          imageBuffer,
          originalFilename,
          this.localStoragePath,
          normalizedOutputFormat,
          quality
        );
      }

      if (this.enableS3Storage) {
        console.log('Procesando para almacenamiento S3...');
        results.s3 = await uploadImageToS3(
          imageBuffer,
          originalFilename,
          this.s3BucketName,
          normalizedOutputFormat,
          quality
        );
      }

      return results;
    } catch (error) {
      // Re-lanzar nuestros errores personalizados directamente
      if (
        error instanceof ConfigurationError ||
        error instanceof ImageProcessingError ||
        error instanceof StorageError
      ) {
        throw error;
      }
      // Envolver cualquier otro error inesperado en un error genérico
      throw new Error(
        `Error inesperado al procesar la imagen: ${error.message}`,
        { cause: error }
      );
    }
  }
}

// Exporta la clase principal y las clases de error para que sean accesibles externamente
module.exports = ImageResizer;
module.exports.ConfigurationError = ConfigurationError;
module.exports.ImageProcessingError = ImageProcessingError;
module.exports.StorageError = StorageError;
