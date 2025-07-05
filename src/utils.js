// src/utils.js
const sharp = require('sharp'); // Necesario para la función resizeImage
const logger = require('./logger');
const { ImageProcessingError } = require('./errors'); // Importa errores para manejo interno de utils

const DEFAULT_SIZES = {
  small: { width: 320, defaultQuality: 80 },
  medium: { width: 640, defaultQuality: 85 },
  large: { width: 1024, defaultQuality: 90 },
};

// Formatos de salida soportados y sus opciones por defecto
const SUPPORTED_OUTPUT_FORMATS = {
  jpeg: { format: 'jpeg', options: { quality: 80 } },
  png: { format: 'png', options: { quality: 80, compressionLevel: 8 } },
  webp: { format: 'webp', options: { quality: 80 } },
  tiff: { format: 'tiff', options: { quality: 80 } },
  avif: { format: 'avif', options: { quality: 70 } }, // AVIF suele tener mejor compresión a menor calidad
  // gif: { format: 'gif' } // Sharp no soporta directamente la salida a GIF, solo la entrada
};

/**
 * Redimensiona una imagen a un tamaño específico con calidad y formato dados.
 * @param {sharp.Sharp} sharpInstance - Instancia de Sharp para procesar la imagen.
 * @param {string} sizeKey - La clave del tamaño a redimensionar (ej. 'small').
 * @param {string} outputFormat - El formato de salida deseado (ej. 'jpeg', 'png', 'webp').
 * @param {number} [overallQuality] - Calidad general a aplicar (0-100), si se anula la calidad por defecto.
 * @param {object} sizeConfig - Objeto de configuración para el tamaño específico (ej. {width: 300, defaultQuality: 80}).
 * @returns {Promise<Buffer>} El buffer de la imagen redimensionada.
 * @throws {ImageProcessingError} Si hay un error durante el redimensionamiento.
 */
async function resizeImage(
  sharpInstance,
  sizeKey,
  outputFormat,
  overallQuality,
  sizeConfig
) {
  const { width, defaultQuality } = sizeConfig;
  const qualityToApply =
    overallQuality !== undefined ? overallQuality : defaultQuality;

  logger.debug(
    `Redimensionando imagen a ${width}px (tamaño: ${sizeKey}) con calidad ${qualityToApply} y formato ${outputFormat}`
  );

  try {
    let pipeline = sharpInstance.resize(width); // Redimensiona a un ancho fijo

    // Aplicar formato y calidad
    if (SUPPORTED_OUTPUT_FORMATS[outputFormat]) {
      const formatOptions = {
        ...SUPPORTED_OUTPUT_FORMATS[outputFormat].options,
        quality: qualityToApply,
      };
      pipeline = pipeline.toFormat(outputFormat, formatOptions);
    } else {
      // Esto debería ser capturado antes por ImageProcessor, pero es una seguridad.
      const msg = `Formato de salida no soportado en resizeImage: ${outputFormat}`;
      logger.error('ImageProcessingError: %s', msg);
      throw new ImageProcessingError(msg);
    }

    return await pipeline.toBuffer();
  } catch (error) {
    const msg = `Error al redimensionar imagen para tamaño '${sizeKey}' a ${width}px: ${error.message}`;
    logger.error('ImageProcessingError: %s', msg, {
      sizeKey: sizeKey,
      width: width,
      outputFormat: outputFormat,
      quality: qualityToApply,
      originalError: error,
    });
    throw new ImageProcessingError(msg, error);
  }
}

/**
 * Obtiene la extensión de archivo correcta para un formato dado.
 * @param {string} format - El formato de imagen (ej. 'jpeg', 'png').
 * @returns {string} La extensión de archivo sin el punto (ej. 'jpg', 'png').
 */
function getFileExtensionForFormat(format) {
  if (format === 'jpeg') return 'jpg';
  return format;
}

module.exports = {
  DEFAULT_SIZES,
  SUPPORTED_OUTPUT_FORMATS,
  resizeImage,
  getFileExtensionForFormat,
};
