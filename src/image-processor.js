// src/image-processor.js
const sharp = require('sharp');
const path = require('path');
const { ImageProcessingError, ConfigurationError } = require('./errors');
const {
  SUPPORTED_OUTPUT_FORMATS,
  resizeImage,
  getFileExtensionForFormat,
} = require('./utils');
const logger = require('./logger');

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/tiff',
]);

/**
 * Procesa un buffer de imagen, aplica transformaciones, determina el formato de salida
 * y genera buffers para la imagen original y sus versiones redimensionadas.
 * @param {Buffer} originalBuffer - El buffer de la imagen original.
 * @param {string} originalFilename - El nombre original del archivo.
 * @param {object} sizes - Objeto de configuración de tamaños (ej. { small: { width: 300, ... } }).
 * @param {object} options - Opciones de procesamiento (outputFormat, quality, optimizeOutputFormat, processSizes, transformations, filenameGenerator).
 * @returns {Promise<Array<{buffer: Buffer, filename: string, sizeKey: string, metadata: object}>>}
 * Un array de objetos con los buffers, nombres de archivo (temporales, para el caché),
 * claves de tamaño y metadatos de todas las imágenes procesadas.
 * @throws {ImageProcessingError} Si hay un problema durante el procesamiento de la imagen.
 * @throws {ConfigurationError} Si hay un problema con las opciones de configuración.
 */
async function processAndGenerateImages(
  originalBuffer,
  originalFilename,
  sizes,
  options = {}
) {
  logger.info(
    'ImageProcessor: Iniciando procesamiento de imagen. Filename: %s, Options: %o',
    originalFilename,
    options
  );

  const {
    outputFormat,
    quality,
    optimizeOutputFormat = false,
    processSizes,
    filenameGenerator, // Se pasa pero se usa para generar el nombre final en ImageResizer
    transformations,
  } = options;

  try {
    let baseSharpInstance = sharp(originalBuffer);

    if (transformations) {
      logger.debug(
        'ImageProcessor: Aplicando transformaciones: %o',
        transformations
      );
      for (const key in transformations) {
        // Validación básica de que la clave existe como método en Sharp y no es 'resize'
        // Ya que 'resize' se maneja por separado
        if (typeof baseSharpInstance[key] === 'function' && key !== 'resize') {
          try {
            baseSharpInstance = baseSharpInstance[key](transformations[key]);
            logger.debug(`ImageProcessor: Transformación '${key}' aplicada.`);
          } catch (transformError) {
            const msg = `Error al aplicar la transformación '${key}': ${transformError.message}`;
            logger.error('ImageProcessingError: %s', msg, {
              transformationKey: key,
              value: transformations[key],
              originalError: transformError,
            });
            throw new ImageProcessingError(msg, transformError);
          }
        } else if (key === 'composite' && Array.isArray(transformations[key])) {
          try {
            baseSharpInstance = baseSharpInstance.composite(
              transformations[key]
            );
            logger.debug(
              `ImageProcessor: Transformación 'composite' aplicada.`
            );
          } catch (compositeError) {
            const msg = `Error al aplicar la transformación 'composite': ${compositeError.message}`;
            logger.error('ImageProcessingError: %s', msg, {
              transformationKey: key,
              value: transformations[key],
              originalError: compositeError,
            });
            throw new ImageProcessingError(msg, compositeError);
          }
        } else {
          logger.warn(
            `ImageProcessor: Advertencia: La transformación '%s' no es una función de Sharp directamente aplicable o está reservada.`,
            key
          );
        }
      }
    }

    let finalOutputFormat = outputFormat ? outputFormat.toLowerCase() : 'jpeg';
    logger.debug(
      'ImageProcessor: Formato de salida inicial: %s',
      finalOutputFormat
    );

    if (optimizeOutputFormat) {
      try {
        const imageMetadata = await baseSharpInstance.metadata();
        logger.debug(
          'ImageProcessor: Metadatos de imagen para optimización: %o',
          imageMetadata
        );

        if (imageMetadata.hasAlpha) {
          if (
            finalOutputFormat === 'jpeg' ||
            !SUPPORTED_OUTPUT_FORMATS[finalOutputFormat]
          ) {
            logger.info(
              `ImageProcessor: Detectada transparencia. Optimizando a 'webp'.`
            );
            finalOutputFormat = 'webp';
          }
        } else {
          if (
            !outputFormat ||
            (outputFormat.toLowerCase() !== 'webp' &&
              outputFormat.toLowerCase() !== 'avif')
          ) {
            logger.info(
              `ImageProcessor: Sin transparencia. Optimizando a 'webp' para compresión.`
            );
            finalOutputFormat = 'webp';
          }
        }
      } catch (metaError) {
        logger.warn(
          `ImageProcessor: Advertencia: No se pudieron obtener metadatos para optimización. Usando formato '%s'. Error: %s`,
          finalOutputFormat,
          metaError.message,
          { originalError: metaError }
        );
      }
    }
    logger.info(
      'ImageProcessor: Formato de salida final decidido: %s',
      finalOutputFormat
    );

    if (!SUPPORTED_OUTPUT_FORMATS[finalOutputFormat]) {
      const msg = `El formato de salida final '${finalOutputFormat}' no es soportado. Los formatos soportados son: ${Object.keys(
        SUPPORTED_OUTPUT_FORMATS
      ).join(', ')}.`;
      logger.error('ConfigurationError: %s', msg);
      throw new ConfigurationError(msg);
    }

    const originalBasename = path.parse(originalFilename).name;
    const originalExtension = getFileExtensionForFormat(finalOutputFormat);

    const allImagesToSave = [];

    // 1. Datos para la imagen ORIGINAL
    logger.debug('ImageProcessor: Procesando imagen original...');
    let transformedOriginalBuffer;
    let originalMetadata;
    try {
      // Apply output format and quality to original image too
      let originalSharpInstance = baseSharpInstance.clone();
      if (finalOutputFormat) {
        originalSharpInstance = originalSharpInstance.toFormat(
          finalOutputFormat,
          { quality: quality || 100 }
        );
      }
      transformedOriginalBuffer = await originalSharpInstance.toBuffer();
      originalMetadata = await sharp(transformedOriginalBuffer).metadata();
      logger.debug('ImageProcessor: Metadatos original: %o', originalMetadata);
    } catch (err) {
      const msg = `Error al procesar la imagen original con Sharp: ${err.message}`;
      logger.error('ImageProcessingError: %s', msg, { originalError: err });
      throw new ImageProcessingError(msg, err);
    }

    // El nombre de archivo se generará más tarde en ImageResizer (o se usará el genérico)
    allImagesToSave.push({
      buffer: transformedOriginalBuffer,
      filename: null, // Será generado por ImageResizer
      sizeKey: 'original',
      metadata: {
        width: originalMetadata.width,
        height: originalMetadata.height,
        format: originalMetadata.format,
        size: transformedOriginalBuffer.length,
      },
    });

    // 2. Datos para las imágenes REDIMENSIONADAS (Paralelizado)
    const sizesToProcess = options.processSizes || Object.keys(sizes);
    logger.debug('ImageProcessor: Tamaños a procesar: %o', sizesToProcess);

    const processingPromises = sizesToProcess.map(async (sizeKey) => {
      const sizeConfig = sizes[sizeKey];
      if (!sizeConfig) {
        // Protección adicional
        const msg = `Tamaño '${sizeKey}' no encontrado en la configuración.`;
        logger.error('ConfigurationError: %s', msg);
        throw new ConfigurationError(msg);
      }
      logger.debug(
        'ImageProcessor: Procesando tamaño en paralelo: %s con configuración: %o',
        sizeKey,
        sizeConfig
      );

      let resizedBuffer;
      let resizedMetadata;
      try {
        // Clonar la instancia base para cada redimensionamiento
        const sharpInstanceForResize = baseSharpInstance.clone();
        resizedBuffer = await resizeImage(
          sharpInstanceForResize,
          sizeKey,
          finalOutputFormat,
          quality,
          sizeConfig
        );
        resizedMetadata = await sharp(resizedBuffer).metadata();
        logger.debug(
          'ImageProcessor: Metadatos para tamaño %s: %o',
          sizeKey,
          resizedMetadata
        );
      } catch (err) {
        const msg = `Error al redimensionar la imagen para el tamaño '${sizeKey}': ${err.message}`;
        logger.error('ImageProcessingError: %s', msg, {
          sizeKey: sizeKey,
          originalError: err,
        });
        throw new ImageProcessingError(msg, err);
      }

      return {
        buffer: resizedBuffer,
        filename: null, // Será generado por ImageResizer
        sizeKey: sizeKey,
        metadata: {
          width: resizedMetadata.width,
          height: resizedMetadata.height,
          format: resizedMetadata.format,
          size: resizedBuffer.length,
        },
      };
    });

    const resizedImagesToSave = await Promise.all(processingPromises);
    allImagesToSave.push(...resizedImagesToSave);

    logger.info(
      'ImageProcessor: Todas las imágenes procesadas y buffers generados.'
    );
    return allImagesToSave;
  } catch (error) {
    // Asegurarse de que los errores ya tipificados se relancen
    if (
      error instanceof ConfigurationError ||
      error instanceof ImageProcessingError
    ) {
      throw error;
    }
    // Envolver cualquier otro error inesperado
    const msg = `Error inesperado en el procesamiento de imagen para '${originalFilename}': ${error.message}`;
    logger.error('ImageProcessingError: %s', msg, {
      originalError: error,
      stack: error.stack,
    });
    throw new ImageProcessingError(msg, error);
  }
}

module.exports = {
  processAndGenerateImages,
};
