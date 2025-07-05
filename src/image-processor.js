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
  'image/gif', // Sharp puede leer GIF, pero no generar GIF animado
  'image/tiff',
  'image/heif', // Añadir soporte para HEIF/HEIC si Sharp lo tiene activado
]);

/**
 * Procesa un buffer de imagen, aplica transformaciones, determina el formato de salida
 * y genera buffers para la imagen original y sus versiones redimensionadas.
 * @param {Buffer} originalBuffer - El buffer de la imagen original.
 * @param {string} originalFilename - El nombre original del archivo.
 * @param {object} sizes - Objeto de configuración de tamaños (ej. { small: { width: 300, ... } }).
 * @param {object} options - Opciones de procesamiento (outputFormat, quality, optimizeOutputFormat, processSizes, transformations).
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
    transformations,
  } = options;

  let baseSharpInstance;
  let initialImageMetadata; // Metadatos iniciales del buffer antes de transformaciones

  try {
    baseSharpInstance = sharp(originalBuffer);
    initialImageMetadata = await baseSharpInstance.metadata(); // Obtener metadatos iniciales
  } catch (err) {
    const msg = `No se pudo inicializar Sharp con la imagen. Posiblemente formato no soportado o archivo corrupto: ${err.message}`;
    logger.error('ImageProcessingError: %s', msg, { originalError: err });
    throw new ImageProcessingError(msg, err, 'ERR_SHARP_INIT_FAILED');
  }

  // --- Aplicar transformaciones ---
  if (transformations) {
    logger.debug(
      'ImageProcessor: Aplicando transformaciones: %o',
      transformations
    );
    for (const key in transformations) {
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
          throw new ImageProcessingError(msg, transformError, 'ERR_TRANSFORMATION_FAILED');
        }
      } else if (key === 'composite' && Array.isArray(transformations[key])) {
        try {
          baseSharpInstance = baseSharpInstance.composite(
            transformations[key]
          );
          logger.debug(`ImageProcessor: Transformación 'composite' aplicada.`);
        } catch (compositeError) {
          const msg = `Error al aplicar la transformación 'composite': ${compositeError.message}`;
          logger.error('ImageProcessingError: %s', msg, {
            transformationKey: key,
            value: transformations[key],
            originalError: compositeError,
          });
          throw new ImageProcessingError(msg, compositeError, 'ERR_COMPOSITE_FAILED');
        }
      } else {
        logger.warn(
          `ImageProcessor: Advertencia: La transformación '%s' no es una función de Sharp directamente aplicable o está reservada.`,
          key
        );
      }
    }
  }

  // --- Determinar el formato de salida final ---
  let finalOutputFormat = outputFormat
    ? outputFormat.toLowerCase()
    : initialImageMetadata.format || 'jpeg'; // Usar formato original si no se especifica

  logger.debug(
    'ImageProcessor: Formato de salida inicial: %s',
    finalOutputFormat
  );

  if (optimizeOutputFormat) {
    try {
      // Obtener metadatos DESPUÉS de las transformaciones (si las hubo)
      const currentMetadataForOptimization = await baseSharpInstance.metadata();
      logger.debug(
        'ImageProcessor: Metadatos de imagen para optimización: %o',
        currentMetadataForOptimization
      );

      if (currentMetadataForOptimization.hasAlpha) {
        // Si tiene transparencia, intentar WebP o PNG
        if (
          !['webp', 'png', 'gif'].includes(finalOutputFormat) // Incluye gif si quieres que se mantenga
        ) {
          logger.info(`ImageProcessor: Detectada transparencia. Optimizando a 'webp'.`);
          finalOutputFormat = 'webp';
        }
      } else {
        // Sin transparencia, priorizar WebP o AVIF por compresión si no se especificó un formato o es JPEG/PNG
        if (
          !outputFormat || // Si no se especificó formato
          (outputFormat.toLowerCase() !== 'webp' && // O si se especificó, pero no es ya webp/avif
            outputFormat.toLowerCase() !== 'avif')
        ) {
          logger.info(`ImageProcessor: Sin transparencia. Optimizando a 'webp' para compresión.`);
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
    throw new ConfigurationError(msg, null, 'ERR_UNSUPPORTED_OUTPUT_FORMAT');
  }

  const allImagesToSave = [];

  // --- 1. Procesar la imagen ORIGINAL (aplicando transformaciones y formato de salida) ---
  logger.debug('ImageProcessor: Procesando imagen original...');
  let transformedOriginalBuffer;
  let finalOriginalMetadata; // Metadatos del original transformado
  try {
    let originalSharpInstance = baseSharpInstance.clone(); // Clonar para aplicar toFormat

    // Aplicar formato de salida y calidad al original también
    originalSharpInstance = originalSharpInstance.toFormat(
      finalOutputFormat,
      { quality: quality || 100 } // Usar calidad general o 100
    );
    transformedOriginalBuffer = await originalSharpInstance.toBuffer();
    finalOriginalMetadata = await sharp(transformedOriginalBuffer).metadata(); // Obtener metadatos del buffer final del original
    logger.debug('ImageProcessor: Metadatos original transformado: %o', finalOriginalMetadata);
  } catch (err) {
    const msg = `Error al procesar la imagen original con Sharp: ${err.message}`;
    logger.error('ImageProcessingError: %s', msg, { originalError: err });
    throw new ImageProcessingError(msg, err, 'ERR_ORIGINAL_IMAGE_PROCESS_FAILED');
  }

  // Se añade el objeto de la imagen original a la lista.
  // El nombre de archivo temporal será generado por ImageResizer o el generador personalizado.
  allImagesToSave.push({
    buffer: transformedOriginalBuffer,
    filename: null, // Placeholder, será generado en ImageResizer
    sizeKey: 'original',
    metadata: {
      width: finalOriginalMetadata.width,
      height: finalOriginalMetadata.height,
      format: finalOriginalMetadata.format,
      size: transformedOriginalBuffer.length,
    },
  });

  // --- 2. Procesar las imágenes REDIMENSIONADAS (en paralelo) ---
  const sizesToProcess = options.processSizes || Object.keys(sizes);
  logger.debug('ImageProcessor: Tamaños a procesar: %o', sizesToProcess);

  const processingPromises = sizesToProcess.map(async (sizeKey) => {
    const sizeConfig = sizes[sizeKey];
    if (!sizeConfig || typeof sizeConfig.width !== 'number') { // Añadir validación de width
      const msg = `Tamaño '${sizeKey}' no encontrado o configuración inválida (falta 'width').`;
      logger.error('ConfigurationError: %s', msg, { sizeKey: sizeKey, config: sizeConfig });
      throw new ConfigurationError(msg, null, 'ERR_INVALID_SIZE_CONFIG');
    }
    logger.debug(
      'ImageProcessor: Procesando tamaño en paralelo: %s con configuración: %o',
      sizeKey,
      sizeConfig
    );

    let resizedBuffer;
    let resizedMetadata;
    try {
      const sharpInstanceForResize = baseSharpInstance.clone(); // Clonar la instancia base
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
      throw new ImageProcessingError(msg, err, 'ERR_RESIZE_FAILED');
    }

    return {
      buffer: resizedBuffer,
      filename: null, // Placeholder, será generado en ImageResizer
      sizeKey: sizeKey,
      metadata: {
        width: resizedMetadata.width,
        height: resizedMetadata.height,
        format: resizedMetadata.format,
        size: resizedBuffer.length,
      },
    };
  });

  try {
    const resizedImagesToSave = await Promise.all(processingPromises);
    allImagesToSave.push(...resizedImagesToSave);
  } catch (error) {
    // Si alguna promesa paralela falla, Promise.all lanza la primera que falla.
    // Ya está tipificada dentro del map, solo necesitamos relanzarla.
    throw error;
  }

  logger.info(
    'ImageProcessor: Todas las imágenes procesadas y buffers generados.'
  );
  return allImagesToSave;
}

module.exports = {
  processAndGenerateImages,
};