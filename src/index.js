// src/index.js
require('dotenv').config();

const { saveImageLocally } = require('./local-storage');
const { initS3, uploadImageToS3 } = require('./s3-storage');
const {
  ConfigurationError,
  ImageProcessingError,
  StorageError,
} = require('./errors');
const {
  DEFAULT_SIZES,
  SUPPORTED_OUTPUT_FORMATS, // Mantenemos SUPPORTED_OUTPUT_FORMATS aquí si se usa para validación de constructor
  // resizeImage, // Ya no se importa directamente aquí, se usa en image-processor
  getFileExtensionForFormat,
} = require('./utils');
const sharp = require('sharp'); // Necesario para fileTypeFromBuffer y metadata inicial
const { Readable } = require('stream');
const { fileTypeFromBuffer } = require('file-type');
const path = require('path');
const { CacheManager, generateCacheKey } = require('./cache-manager');
const logger = require('./logger');
const { processAndGenerateImages } = require('./image-processor'); // NUEVA IMPORTACIÓN

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/tiff',
]);

/**
 * Clase principal para la librería de redimensionamiento de imágenes YSL.
 * Permite procesar imágenes y almacenarlas localmente o en AWS S3 según la configuración.
 */
class ImageResizer {
  constructor(config = {}) {
    logger.info('Inicializando ImageResizer con configuración: %o', config);

    this.enableLocalStorage = process.env.ENABLE_LOCAL_STORAGE === 'true';
    this.enableS3Storage = process.env.ENABLE_S3_STORAGE === 'true';

    this.sizes =
      config.customSizes && typeof config.customSizes === 'object'
        ? { ...DEFAULT_SIZES, ...config.customSizes }
        : DEFAULT_SIZES;

    for (const sizeKey in this.sizes) {
      const sizeConfig = this.sizes[sizeKey];
      if (typeof sizeConfig.width !== 'number' || sizeConfig.width <= 0) {
        const msg = `La configuración para el tamaño '${sizeKey}' es inválida: 'width' debe ser un número positivo.`;
        logger.error('ConfigurationError: %s', msg);
        throw new ConfigurationError(msg);
      }
      if (
        typeof sizeConfig.defaultQuality !== 'number' ||
        sizeConfig.defaultQuality < 0 ||
        sizeConfig.defaultQuality > 100
      ) {
        const msg = `La configuración para el tamaño '${sizeKey}' es inválida: 'defaultQuality' debe ser un número entre 0 y 100.`;
        logger.error('ConfigurationError: %s', msg);
        throw new ConfigurationError(msg);
      }
    }

    if (!this.enableLocalStorage && !this.enableS3Storage) {
      const msg =
        'Debe habilitar al menos una opción de almacenamiento (ENABLE_LOCAL_STORAGE o ENABLE_S3_STORAGE) en el archivo .env.';
      logger.error('ConfigurationError: %s', msg);
      throw new ConfigurationError(msg);
    }

    if (this.enableLocalStorage) {
      this.localStoragePath = process.env.LOCAL_STORAGE_PATH;
      if (!this.localStoragePath) {
        const msg =
          'La variable de entorno LOCAL_STORAGE_PATH debe estar configurada si ENABLE_LOCAL_STORAGE es true.';
        logger.error('ConfigurationError: %s', msg);
        throw new ConfigurationError(msg);
      }
      logger.info(
        'Almacenamiento local habilitado. Ruta: %s',
        this.localStoragePath
      );
    }

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
        const msg =
          'Las variables de entorno de AWS S3 (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_S3_BUCKET_NAME) deben estar configuradas si ENABLE_S3_STORAGE es true.';
        logger.error('ConfigurationError: %s', msg);
        throw new ConfigurationError(msg);
      }
      initS3(AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION);
      logger.info(
        'Almacenamiento S3 habilitado. Bucket: %s',
        this.s3BucketName
      );
    }

    this.cacheManager = new CacheManager(
      process.env.IMAGE_CACHE_PATH,
      process.env.ENABLE_IMAGE_CACHE === 'true'
    );
    this.cacheManager.init().catch((err) => {
      logger.error('Error al inicializar CacheManager: %s', err.message, {
        originalError: err,
      });
      // Este error no es fatal para la operación de la librería si el caché es solo una optimización.
      // Por lo tanto, solo logueamos y no relanzamos, permitiendo que la librería funcione sin caché.
    });
    logger.info(
      'CacheManager inicializado. Habilitado: %s',
      process.env.ENABLE_IMAGE_CACHE === 'true'
    );
  }

  /**
   * Procesa una imagen, redimensionándola y guardándola según la configuración.
   * Puede aceptar la imagen como un Buffer o un ReadableStream.
   * Si ambos almacenamientos están habilitados, la imagen se procesará y guardará en ambos.
   * @param {Buffer | Readable} imageSource - El buffer de la imagen o un ReadableStream.
   * @param {string} originalFilename - El nombre original del archivo (ej. "mi-imagen.jpg").
   * @param {object} [options={}] - Opciones adicionales para el procesamiento.
   * @param {string} [options.outputFormat] - El formato de salida deseado (ej. 'jpeg', 'png', 'webp'). Si no se especifica, se intenta optimizar o se usa 'jpeg' por defecto.
   * @param {number} [options.quality] - La calidad de la imagen de salida (0-100). Si no se especifica, usa la calidad por defecto del tamaño.
   * @param {boolean} [options.optimizeOutputFormat=false] - Si es true, la librería intentará elegir el mejor formato de salida basado en las propiedades de la imagen de entrada (ej. transparencia).
   * @param {string[]} [options.processSizes] - Un array de strings con las claves de los tamaños a procesar (ej. ['small', 'medium']). Si no se especifica, se procesan todos los tamaños configurados.
   * @param {function(object): string} [options.filenameGenerator] - Una función para generar nombres de archivo personalizados. Recibe un objeto { originalFilename, baseName, extension, sizeKey, outputFormat, isOriginal }. Debe devolver el nombre de archivo completo (ej. "imagen-unique.webp").
   * @param {object} [options.transformations] - Un objeto con opciones de transformación adicionales para `sharp` (ej. { rotate: 90, flip: true, grayscale: true }).
   * @returns {Promise<object>} Un objeto con los resultados de cada tipo de almacenamiento (local y/o S3), incluyendo metadatos de las imágenes.
   * @throws {ConfigurationError} Si hay un problema con la configuración de las variables de entorno o las opciones de entrada.
   * @throws {ImageProcessingError} Si hay un problema durante el procesamiento de la imagen.
   * @throws {StorageError} Si hay un problema durante el almacenamiento de la imagen.
   */
  async processImage(imageSource, originalFilename, options = {}) {
    logger.info(
      'Iniciando procesamiento para imagen: %s con opciones: %o',
      originalFilename,
      options
    );
    const {
      outputFormat,
      quality,
      optimizeOutputFormat = false,
      processSizes,
      filenameGenerator,
      transformations,
    } = options;

    // Validaciones de entrada mejoradas (moved to ImageResizer as they depend on its state or are general input checks)
    if (
      !imageSource ||
      (!(imageSource instanceof Buffer) && !(imageSource instanceof Readable))
    ) {
      const msg =
        'El parámetro `imageSource` debe ser un Buffer o un ReadableStream.';
      logger.error('ImageProcessingError: %s', msg);
      throw new ImageProcessingError(msg);
    }
    if (
      typeof originalFilename !== 'string' ||
      originalFilename.trim() === ''
    ) {
      const msg =
        'El parámetro `originalFilename` debe ser una cadena de texto no vacía.';
      logger.error('ImageProcessingError: %s', msg);
      throw new ImageProcessingError(msg);
    }
    if (
      quality !== undefined &&
      (typeof quality !== 'number' || quality < 0 || quality > 100)
    ) {
      const msg = 'La calidad debe ser un número entre 0 y 100.';
      logger.error('ConfigurationError: %s', msg);
      throw new ConfigurationError(msg);
    }
    if (processSizes !== undefined) {
      if (
        !Array.isArray(processSizes) ||
        !processSizes.every(
          (size) => typeof size === 'string' && this.sizes[size]
        )
      ) {
        const invalidSizes = processSizes.filter((size) => !this.sizes[size]);
        const msg = `El parámetro 'processSizes' contiene claves de tamaño inválidas: ${invalidSizes.join(
          ', '
        )}. Las claves válidas son: ${Object.keys(this.sizes).join(', ')}.`;
        logger.error('ConfigurationError: %s', msg);
        throw new ConfigurationError(msg);
      }
    }
    if (
      filenameGenerator !== undefined &&
      typeof filenameGenerator !== 'function'
    ) {
      const msg = 'El parámetro `filenameGenerator` debe ser una función.';
      logger.error('ConfigurationError: %s', msg);
      throw new ConfigurationError(msg);
    }
    if (
      transformations !== undefined &&
      (typeof transformations !== 'object' ||
        transformations === null ||
        Array.isArray(transformations))
    ) {
      const msg = 'El parámetro `transformations` debe ser un objeto válido.';
      logger.error('ConfigurationError: %s', msg);
      throw new ConfigurationError(msg);
    }

    let originalBuffer;
    let fileTypeResult;

    try {
      logger.debug('Leyendo imageSource...');
      if (imageSource instanceof Readable) {
        originalBuffer = await new Promise((resolve, reject) => {
          const chunks = [];
          imageSource
            .on('data', (chunk) => chunks.push(chunk))
            .on('end', () => resolve(Buffer.concat(chunks)))
            .on('error', reject); // Propagar errores del stream
        });
        logger.debug('ImageSource leído como ReadableStream.');
      } else {
        originalBuffer = imageSource;
        logger.debug('ImageSource es un Buffer.');
      }

      fileTypeResult = await fileTypeFromBuffer(originalBuffer);

      if (
        !fileTypeResult ||
        !SUPPORTED_IMAGE_MIME_TYPES.has(fileTypeResult.mime)
      ) {
        const msg = `Tipo de archivo no soportado o inválido: '${
          fileTypeResult ? fileTypeResult.mime : 'desconocido'
        }'. Solo se permiten imágenes (${Array.from(
          SUPPORTED_IMAGE_MIME_TYPES
        ).join(', ')}).`;
        logger.error('ImageProcessingError: %s', msg, {
          fileType: fileTypeResult ? fileTypeResult.mime : 'unknown',
        });
        throw new ImageProcessingError(msg);
      }
      logger.info('Tipo MIME de imagen detectado: %s', fileTypeResult.mime);

      // --- Lógica de Caching ---
      // La generación de la clave de caché ahora incluye la versión stringified del filenameGenerator
      const cacheKey = generateCacheKey(originalBuffer, {
        originalFilename,
        outputFormat,
        quality,
        optimizeOutputFormat,
        processSizes,
        transformations,
        filenameGenerator: filenameGenerator
          ? filenameGenerator.toString()
          : undefined, // IMPORTANT: pass stringified version
      });
      logger.debug('Clave de caché generada: %s', cacheKey);

      let allImagesToSave;
      let finalResults = {
        metadata: {
          original: null,
          resized: {},
        },
        local: null,
        s3: null,
      };

      // Intenta obtener del caché
      const cachedImages = await this.cacheManager.getCachedImages(cacheKey);

      if (cachedImages) {
        logger.info(`Cache HIT para %s. Usando imágenes cacheadas.`, cacheKey);
        allImagesToSave = cachedImages;

        const originalBasename = path.parse(originalFilename).name;
        const originalImageMeta = allImagesToSave.find(
          (img) => img.sizeKey === 'original'
        )?.metadata;
        const finalOutputFormatFromCache = originalImageMeta
          ? originalImageMeta.format
          : outputFormat || 'jpeg'; // Fallback

        // Regenerar filenames para las imágenes cacheadas usando filenameGenerator
        for (let i = 0; i < allImagesToSave.length; i++) {
          const img = allImagesToSave[i];
          // Usar el formato de la imagen cacheada para la extensión
          const currentExtension = getFileExtensionForFormat(
            img.metadata.format
          );

          if (img.sizeKey === 'original') {
            img.filename = filenameGenerator
              ? filenameGenerator({
                  originalFilename: originalFilename,
                  baseName: originalBasename,
                  extension: currentExtension,
                  isOriginal: true,
                  sizeKey: null,
                  outputFormat: img.metadata.format,
                })
              : `${originalBasename}.${currentExtension}`;
          } else {
            img.filename = filenameGenerator
              ? filenameGenerator({
                  originalFilename: originalFilename,
                  baseName: originalBasename,
                  extension: currentExtension,
                  isOriginal: false,
                  sizeKey: img.sizeKey,
                  outputFormat: img.metadata.format,
                })
              : `resized/${img.sizeKey}/${originalBasename}-${img.sizeKey}.${currentExtension}`;
          }
          if (typeof img.filename !== 'string' || img.filename.trim() === '') {
            const msg = `La función 'filenameGenerator' debe devolver una cadena de texto no vacía para la imagen ${img.sizeKey}.`;
            logger.error('ConfigurationError: %s', msg);
            throw new ConfigurationError(msg);
          }
          finalResults.metadata[
            img.sizeKey === 'original' ? 'original' : 'resized'
          ][img.sizeKey] = img.metadata;
        }
      } else {
        logger.info(`Cache MISS para %s. Procesando la imagen.`, cacheKey);

        // *** INVOCACIÓN AL NUEVO image-processor ***
        allImagesToSave = await processAndGenerateImages(
          originalBuffer,
          originalFilename,
          this.sizes, // Pasa la configuración de tamaños del ImageResizer
          {
            outputFormat,
            quality,
            optimizeOutputFormat,
            processSizes,
            transformations,
          }
        );

        // Ahora, generar los nombres de archivo finales DESPUÉS de que los metadatos se hayan determinado en processAndGenerateImages
        const originalBasename = path.parse(originalFilename).name;
        const originalImageMeta = allImagesToSave.find(
          (img) => img.sizeKey === 'original'
        )?.metadata;
        const finalOutputFormatForOriginal = originalImageMeta
          ? originalImageMeta.format
          : outputFormat || 'jpeg';

        for (let i = 0; i < allImagesToSave.length; i++) {
          const img = allImagesToSave[i];
          const currentExtension = getFileExtensionForFormat(
            img.metadata.format
          ); // Usar el formato real de la imagen procesada

          if (img.sizeKey === 'original') {
            img.filename = filenameGenerator
              ? filenameGenerator({
                  originalFilename: originalFilename,
                  baseName: originalBasename,
                  extension: currentExtension,
                  isOriginal: true,
                  sizeKey: null,
                  outputFormat: img.metadata.format,
                })
              : `${originalBasename}.${currentExtension}`;
          } else {
            img.filename = filenameGenerator
              ? filenameGenerator({
                  originalFilename: originalFilename,
                  baseName: originalBasename,
                  extension: currentExtension,
                  isOriginal: false,
                  sizeKey: img.sizeKey,
                  outputFormat: img.metadata.format,
                })
              : `resized/${img.sizeKey}/${originalBasename}-${img.sizeKey}.${currentExtension}`;
          }
          if (typeof img.filename !== 'string' || img.filename.trim() === '') {
            const msg = `La función 'filenameGenerator' debe devolver una cadena de texto no vacía para la imagen ${img.sizeKey}.`;
            logger.error('ConfigurationError: %s', msg);
            throw new ConfigurationError(msg);
          }
          // Populate metadata for finalResults
          finalResults.metadata[
            img.sizeKey === 'original' ? 'original' : 'resized'
          ][img.sizeKey] = img.metadata;
        }

        await this.cacheManager.setCachedImages(cacheKey, allImagesToSave);
        logger.info('Imágenes procesadas y guardadas en caché.');
      }

      // --- Lógica de Almacenamiento ---
      if (this.enableLocalStorage) {
        logger.info('Iniciando almacenamiento local...');
        try {
          finalResults.local = await saveImageLocally(
            allImagesToSave,
            this.localStoragePath
          );
          logger.info('Almacenamiento local completado.');
        } catch (err) {
          logger.error(
            'StorageError: Fallo al procesar el almacenamiento local: %s',
            err.message,
            { originalError: err }
          );
          throw err; // Re-lanzar el StorageError que ya viene de local-storage.js
        }
      }

      if (this.enableS3Storage) {
        logger.info('Iniciando almacenamiento S3...');
        try {
          finalResults.s3 = await uploadImageToS3(
            allImagesToSave,
            this.s3BucketName
          );
          logger.info('Almacenamiento S3 completado.');
        } catch (err) {
          logger.error(
            'StorageError: Fallo al procesar la subida a S3: %s',
            err.message,
            { originalError: err }
          );
          throw err; // Re-lanzar el StorageError que ya viene de s3-storage.js
        }
      }

      logger.info(
        'Procesamiento de imagen completado con éxito para %s.',
        originalFilename
      );
      return finalResults;
    } catch (error) {
      // Aquí se capturan los errores que ya son de nuestro tipo personalizado,
      // o errores inesperados que deben ser envueltos.
      if (
        error instanceof ConfigurationError ||
        error instanceof ImageProcessingError ||
        error instanceof StorageError
      ) {
        logger.error(
          'Error durante el procesamiento de imagen para %s: %s (Code: %s)',
          originalFilename,
          error.message,
          error.code,
          { originalError: error.originalError, stack: error.stack }
        );
        throw error;
      }
      // Para errores no capturados por nuestras clases, los envolvemos en ImageProcessingError
      const msg = `Error inesperado al procesar la imagen '${originalFilename}': ${error.message}`;
      logger.error('ImageProcessingError: %s', msg, {
        originalError: error,
        stack: error.stack,
      });
      throw new ImageProcessingError(msg, error);
    }
  }
}

module.exports = ImageResizer;
module.exports.ConfigurationError = ConfigurationError;
module.exports.ImageProcessingError = ImageProcessingError;
module.exports.StorageError = StorageError;
