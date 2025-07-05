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
  SUPPORTED_OUTPUT_FORMATS,
  resizeImage,
  getFileExtensionForFormat,
} = require('./utils');
const sharp = require('sharp');
const { Readable } = require('stream');
const { fileTypeFromBuffer } = require('file-type');
const path = require('path');
const { CacheManager, generateCacheKey } = require('./cache-manager');
const logger = require('./logger'); // Importar el logger

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
      if (
        typeof sizeConfig.width !== 'number' ||
        sizeConfig.width <= 0 ||
        typeof sizeConfig.defaultQuality !== 'number' ||
        sizeConfig.defaultQuality < 0 ||
        sizeConfig.defaultQuality > 100
      ) {
        logger.error(
          'ConfigurationError: La configuración para el tamaño %s es inválida.',
          sizeKey
        );
        throw new ConfigurationError(
          `La configuración para el tamaño '${sizeKey}' es inválida. Debe tener 'width' (número > 0) y 'defaultQuality' (número entre 0-100).`
        );
      }
    }

    if (!this.enableLocalStorage && !this.enableS3Storage) {
      logger.error(
        'ConfigurationError: Debe habilitar al menos una opción de almacenamiento.'
      );
      throw new ConfigurationError(
        'Debe habilitar al menos una opción de almacenamiento (ENABLE_LOCAL_STORAGE o ENABLE_S3_STORAGE) en el archivo .env.'
      );
    }

    if (this.enableLocalStorage) {
      this.localStoragePath = process.env.LOCAL_STORAGE_PATH;
      if (!this.localStoragePath) {
        logger.error('ConfigurationError: LOCAL_STORAGE_PATH no configurado.');
        throw new ConfigurationError(
          'La variable de entorno LOCAL_STORAGE_PATH debe estar configurada si ENABLE_LOCAL_STORAGE es true.'
        );
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
        logger.error(
          'ConfigurationError: Variables de entorno de AWS S3 no configuradas.'
        );
        throw new ConfigurationError(
          'Las variables de entorno de AWS S3 (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_S3_BUCKET_NAME) deben estar configuradas si ENABLE_S3_STORAGE es true.'
        );
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
      logger.error('Error al inicializar CacheManager: %s', err.message);
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
   * @throws {ConfigurationError} Si hay un problema con la configuración de las variables de entorno.
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

    // Validaciones iniciales
    if (
      !imageSource ||
      (!(imageSource instanceof Buffer) && !(imageSource instanceof Readable))
    ) {
      logger.error(
        'ImageProcessingError: `imageSource` debe ser un Buffer o ReadableStream.'
      );
      throw new ImageProcessingError(
        'El parámetro `imageSource` debe ser un Buffer o un ReadableStream.'
      );
    }
    if (
      !originalFilename ||
      typeof originalFilename !== 'string' ||
      originalFilename.trim() === ''
    ) {
      logger.error(
        'ImageProcessingError: `originalFilename` debe ser una cadena de texto no vacía.'
      );
      throw new ImageProcessingError(
        'El parámetro `originalFilename` debe ser una cadena de texto no vacía.'
      );
    }
    if (
      quality !== undefined &&
      (typeof quality !== 'number' || quality < 0 || quality > 100)
    ) {
      logger.error(
        'ConfigurationError: La calidad debe ser un número entre 0 y 100.'
      );
      throw new ConfigurationError(
        'La calidad debe ser un número entre 0 y 100.'
      );
    }
    if (processSizes !== undefined) {
      if (
        !Array.isArray(processSizes) ||
        !processSizes.every(
          (size) => typeof size === 'string' && this.sizes[size]
        )
      ) {
        logger.error(
          'ConfigurationError: El parámetro `processSizes` es inválido.'
        );
        throw new ConfigurationError(
          `El parámetro 'processSizes' debe ser un array de strings con claves de tamaño válidas (${Object.keys(
            this.sizes
          ).join(', ')}).`
        );
      }
    }
    if (
      filenameGenerator !== undefined &&
      typeof filenameGenerator !== 'function'
    ) {
      logger.error(
        'ConfigurationError: El parámetro `filenameGenerator` debe ser una función.'
      );
      throw new ConfigurationError(
        'El parámetro `filenameGenerator` debe ser una función.'
      );
    }
    if (
      transformations !== undefined &&
      (typeof transformations !== 'object' || transformations === null)
    ) {
      logger.error(
        'ConfigurationError: El parámetro `transformations` debe ser un objeto.'
      );
      throw new ConfigurationError(
        'El parámetro `transformations` debe ser un objeto.'
      );
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
            .on('error', reject);
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
        logger.error(
          'ImageProcessingError: Tipo MIME no soportado: %s',
          fileTypeResult ? fileTypeResult.mime : 'desconocido'
        );
        throw new ImageProcessingError(
          `Tipo de archivo no soportado o inválido: '${
            fileTypeResult ? fileTypeResult.mime : 'desconocido'
          }'. Solo se permiten imágenes (${Array.from(
            SUPPORTED_IMAGE_MIME_TYPES
          ).join(', ')}).`
        );
      }
      logger.info('Tipo MIME de imagen detectado: %s', fileTypeResult.mime);

      // --- Lógica de Caching ---
      const cacheKey = generateCacheKey(originalBuffer, {
        originalFilename,
        outputFormat,
        quality,
        optimizeOutputFormat,
        processSizes,
        transformations,
        filenameGenerator: filenameGenerator
          ? filenameGenerator.toString()
          : undefined,
      });
      logger.debug('Clave de caché generada: %s', cacheKey);

      const cachedImages = await this.cacheManager.getCachedImages(cacheKey);
      let allImagesToSave;
      let finalResults = {
        metadata: {
          original: null,
          resized: {},
        },
        local: null,
        s3: null,
      };

      if (cachedImages) {
        logger.info(`Cache HIT para ${cacheKey}. Usando imágenes cacheadas.`);
        allImagesToSave = cachedImages;

        const originalCachedImage = allImagesToSave.find(
          (img) => img.sizeKey === 'original'
        );
        if (originalCachedImage) {
          finalResults.metadata.original = originalCachedImage.metadata;
        }
        allImagesToSave
          .filter((img) => img.sizeKey !== 'original')
          .forEach((img) => {
            finalResults.metadata.resized[img.sizeKey] = img.metadata;
          });

        // Re-generar nombres de archivo para el guardado/subida, ya que no se cachean con los buffers
        const originalBasename = path.parse(originalFilename).name;
        const originalExtension = getFileExtensionForFormat(
          originalCachedImage.metadata.format
        );

        for (let i = 0; i < allImagesToSave.length; i++) {
          const img = allImagesToSave[i];
          if (img.sizeKey === 'original') {
            img.filename = filenameGenerator
              ? filenameGenerator({
                  originalFilename: originalFilename,
                  baseName: originalBasename,
                  extension: originalExtension,
                  isOriginal: true,
                  sizeKey: null,
                  outputFormat: img.metadata.format,
                })
              : `${originalBasename}.${originalExtension}`;
          } else {
            img.filename = filenameGenerator
              ? filenameGenerator({
                  originalFilename: originalFilename,
                  baseName: originalBasename,
                  extension: originalExtension,
                  isOriginal: false,
                  sizeKey: img.sizeKey,
                  outputFormat: img.metadata.format,
                })
              : `resized/${img.sizeKey}/${originalBasename}-${img.sizeKey}.${originalExtension}`;
          }
          if (typeof img.filename !== 'string' || img.filename.trim() === '') {
            logger.error(
              'ConfigurationError: filenameGenerator devuelve cadena vacía para imagen %s.',
              img.sizeKey
            );
            throw new ConfigurationError(
              `La función 'filenameGenerator' debe devolver una cadena de texto no vacía para la imagen ${img.sizeKey}.`
            );
          }
        }
      } else {
        logger.info(`Cache MISS para ${cacheKey}. Procesando la imagen.`);
        let baseSharpInstance = sharp(originalBuffer);

        if (transformations) {
          logger.debug('Aplicando transformaciones: %o', transformations);
          for (const key in transformations) {
            if (typeof baseSharpInstance[key] === 'function') {
              baseSharpInstance = baseSharpInstance[key](transformations[key]);
              logger.debug(`Transformación '${key}' aplicada.`);
            } else if (
              key === 'composite' &&
              Array.isArray(transformations[key])
            ) {
              baseSharpInstance = baseSharpInstance.composite(
                transformations[key]
              );
              logger.debug(`Transformación 'composite' aplicada.`);
            } else {
              logger.warn(
                `Advertencia: La transformación '${key}' no es una función de Sharp directamente aplicable o no está soportada en el objeto 'transformations'.`
              );
            }
          }
        }

        let finalOutputFormat = outputFormat
          ? outputFormat.toLowerCase()
          : 'jpeg';
        logger.debug('Formato de salida inicial: %s', finalOutputFormat);

        if (optimizeOutputFormat) {
          try {
            const imageMetadata = await baseSharpInstance.metadata();
            logger.debug(
              'Metadatos de imagen para optimización: %o',
              imageMetadata
            );

            if (imageMetadata.hasAlpha) {
              if (
                finalOutputFormat === 'jpeg' ||
                !SUPPORTED_OUTPUT_FORMATS[finalOutputFormat]
              ) {
                logger.info(`Detectada transparencia. Optimizando a 'webp'.`);
                finalOutputFormat = 'webp';
              }
            } else {
              if (
                !outputFormat ||
                (outputFormat.toLowerCase() !== 'webp' &&
                  outputFormat.toLowerCase() !== 'avif')
              ) {
                logger.info(
                  `Sin transparencia. Optimizando a 'webp' para compresión.`
                );
                finalOutputFormat = 'webp';
              }
            }
          } catch (metaError) {
            logger.warn(
              `Advertencia: No se pudieron obtener metadatos para optimización. Usando formato '%s'. Error: %s`,
              finalOutputFormat,
              metaError.message
            );
          }
        }
        logger.info('Formato de salida final decidido: %s', finalOutputFormat);

        if (!SUPPORTED_OUTPUT_FORMATS[finalOutputFormat]) {
          logger.error(
            'ConfigurationError: Formato de salida no soportado: %s',
            finalOutputFormat
          );
          throw new ConfigurationError(
            `El formato de salida final '${finalOutputFormat}' no es soportado. Los formatos soportados son: ${Object.keys(
              SUPPORTED_OUTPUT_FORMATS
            ).join(', ')}.`
          );
        }

        const originalBasename = path.parse(originalFilename).name;
        const originalExtension = getFileExtensionForFormat(finalOutputFormat);

        allImagesToSave = [];

        // 1. Datos para la imagen ORIGINAL
        logger.debug('Procesando imagen original...');
        const transformedOriginalBuffer = await baseSharpInstance.toBuffer();
        const originalMetadata = await sharp(
          transformedOriginalBuffer
        ).metadata();
        logger.debug('Metadatos original: %o', originalMetadata);

        let processedOriginalFilename;
        if (filenameGenerator) {
          processedOriginalFilename = filenameGenerator({
            originalFilename: originalFilename,
            baseName: originalBasename,
            extension: originalExtension,
            isOriginal: true,
            sizeKey: null,
            outputFormat: finalOutputFormat,
          });
          if (
            typeof processedOriginalFilename !== 'string' ||
            processedOriginalFilename.trim() === ''
          ) {
            logger.error(
              'ConfigurationError: filenameGenerator devuelve cadena vacía para imagen original.'
            );
            throw new ConfigurationError(
              'La función `filenameGenerator` debe devolver una cadena de texto no vacía para la imagen original.'
            );
          }
        } else {
          processedOriginalFilename = `${originalBasename}.${originalExtension}`;
        }
        logger.info(
          'Nombre de archivo original procesado: %s',
          processedOriginalFilename
        );
        allImagesToSave.push({
          buffer: transformedOriginalBuffer,
          filename: processedOriginalFilename,
          sizeKey: 'original',
          metadata: {
            width: originalMetadata.width,
            height: originalMetadata.height,
            format: originalMetadata.format,
            size: transformedOriginalBuffer.length,
          },
        });

        // 2. Datos para las imágenes REDIMENSIONADAS
        const sizesToProcess = processSizes || Object.keys(this.sizes);
        logger.debug('Tamaños a procesar: %o', sizesToProcess);
        for (const sizeKey of sizesToProcess) {
          const sizeConfig = this.sizes[sizeKey];
          logger.debug(
            'Procesando tamaño: %s con configuración: %o',
            sizeKey,
            sizeConfig
          );

          const resizedBuffer = await resizeImage(
            baseSharpInstance.clone(),
            sizeKey,
            finalOutputFormat,
            quality,
            sizeConfig
          );
          const resizedMetadata = await sharp(resizedBuffer).metadata();
          logger.debug(
            'Metadatos para tamaño %s: %o',
            sizeKey,
            resizedMetadata
          );

          let processedResizedFilename;
          if (filenameGenerator) {
            processedResizedFilename = filenameGenerator({
              originalFilename: originalFilename,
              baseName: originalBasename,
              extension: originalExtension,
              isOriginal: false,
              sizeKey: sizeKey,
              outputFormat: finalOutputFormat,
            });
            if (
              typeof processedResizedFilename !== 'string' ||
              processedResizedFilename.trim() === ''
            ) {
              logger.error(
                'ConfigurationError: filenameGenerator devuelve cadena vacía para tamaño %s.',
                sizeKey
              );
              throw new ConfigurationError(
                `La función 'filenameGenerator' debe devolver una cadena de texto no vacía para el tamaño '${sizeKey}'.`
              );
            }
          } else {
            processedResizedFilename = `resized/${sizeKey}/${originalBasename}-${sizeKey}.${originalExtension}`;
          }
          logger.info(
            'Nombre de archivo para tamaño %s: %s',
            sizeKey,
            processedResizedFilename
          );
          allImagesToSave.push({
            buffer: resizedBuffer,
            filename: processedResizedFilename,
            sizeKey: sizeKey,
            metadata: {
              width: resizedMetadata.width,
              height: resizedMetadata.height,
              format: resizedMetadata.format,
              size: resizedBuffer.length,
            },
          });
        }

        // Almacenar en caché después del procesamiento exitoso
        await this.cacheManager.setCachedImages(cacheKey, allImagesToSave);
        logger.info('Imágenes procesadas y guardadas en caché.');

        // Preparar resultados para el retorno
        const originalImageToSave = allImagesToSave.find(
          (img) => img.sizeKey === 'original'
        );
        if (originalImageToSave) {
          finalResults.metadata.original = originalImageToSave.metadata;
        }
        allImagesToSave
          .filter((img) => img.sizeKey !== 'original')
          .forEach((img) => {
            finalResults.metadata.resized[img.sizeKey] = img.metadata;
          });
      }

      // Realizar las operaciones de almacenamiento, usando los buffers y nombres preparados
      if (this.enableLocalStorage) {
        logger.info('Iniciando almacenamiento local...');
        finalResults.local = await saveImageLocally(
          allImagesToSave,
          this.localStoragePath
        );
        logger.info('Almacenamiento local completado.');
      }

      if (this.enableS3Storage) {
        logger.info('Iniciando almacenamiento S3...');
        finalResults.s3 = await uploadImageToS3(
          allImagesToSave,
          this.s3BucketName
        );
        logger.info('Almacenamiento S3 completado.');
      }

      logger.info(
        'Procesamiento de imagen completado con éxito para %s.',
        originalFilename
      );
      return finalResults;
    } catch (error) {
      if (
        error instanceof ConfigurationError ||
        error instanceof ImageProcessingError ||
        error instanceof StorageError
      ) {
        logger.error(
          'Error durante el procesamiento de imagen para %s: %s',
          originalFilename,
          error.message,
          { error: error }
        );
        throw error;
      }
      logger.error(
        'Error inesperado durante el procesamiento de imagen para %s: %s',
        originalFilename,
        error.message,
        { error: error }
      );
      throw new Error(
        `Error inesperado al procesar la imagen: ${error.message}`,
        { cause: error }
      );
    }
  }
}

module.exports = ImageResizer;
module.exports.ConfigurationError = ConfigurationError;
module.exports.ImageProcessingError = ImageProcessingError;
module.exports.StorageError = StorageError;
