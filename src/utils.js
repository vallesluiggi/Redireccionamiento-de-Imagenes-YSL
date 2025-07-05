const sharp = require('sharp');
const path = require('path');
const { ImageProcessingError } = require('./errors');

const SIZES = {
  small: { width: 320, defaultQuality: 70 },
  medium: { width: 640, defaultQuality: 80 },
  large: { width: 1024, defaultQuality: 90 },
};

const SUPPORTED_OUTPUT_FORMATS = {
  jpeg: 'jpeg',
  jpg: 'jpeg', // Alias para facilidad de uso
  png: 'png',
  webp: 'webp',
  tiff: 'tiff',
  // Puedes añadir más formatos si sharp los soporta, ej: avif, gif (solo para animación simple)
};

/**
 * Redimensiona una imagen y la convierte al formato y calidad deseados.
 * @param {Buffer} imageBuffer - El buffer de la imagen original.
 * @param {string} sizeKey - La clave del tamaño ('small', 'medium', 'large').
 * @param {string} originalFilename - El nombre original del archivo (para referencia y posible inferencia).
 * @param {string} [outputFormat='jpeg'] - El formato de salida deseado (ej. 'jpeg', 'png', 'webp').
 * @param {number} [quality] - La calidad de la imagen de salida (0-100). Si no se especifica, usa la calidad por defecto del tamaño.
 * @returns {Promise<Buffer>} El buffer de la imagen redimensionada.
 * @throws {ImageProcessingError} Si el tamaño o formato no son soportados, o si hay un error en el procesamiento.
 */
async function resizeImage(
  imageBuffer,
  sizeKey,
  originalFilename,
  outputFormat = 'jpeg',
  quality
) {
  const sizeConfig = SIZES[sizeKey];
  if (!sizeConfig) {
    throw new ImageProcessingError(
      `Tamaño de imagen no soportado: '${sizeKey}'. Tamaños disponibles: ${Object.keys(
        SIZES
      ).join(', ')}.`
    );
  }

  const finalOutputFormat =
    SUPPORTED_OUTPUT_FORMATS[outputFormat.toLowerCase()];
  if (!finalOutputFormat) {
    throw new ImageProcessingError(
      `Formato de salida no soportado: '${outputFormat}'. Formatos disponibles: ${Object.keys(
        SUPPORTED_OUTPUT_FORMATS
      ).join(', ')}.`
    );
  }

  const finalQuality =
    quality !== undefined
      ? Math.min(100, Math.max(0, quality))
      : sizeConfig.defaultQuality;

  try {
    let sharpInstance = sharp(imageBuffer).resize({
      width: sizeConfig.width,
      fit: sharp.fit.inside,
      withoutEnlargement: true,
    });

    // Aplicar el formato y calidad de salida
    switch (finalOutputFormat) {
      case 'jpeg':
        sharpInstance = sharpInstance.jpeg({ quality: finalQuality });
        break;
      case 'png':
        sharpInstance = sharpInstance.png({ quality: finalQuality });
        break;
      case 'webp':
        sharpInstance = sharpInstance.webp({ quality: finalQuality });
        break;
      case 'tiff':
        sharpInstance = sharpInstance.tiff({ quality: finalQuality });
        break;
      default:
        // Esto no debería ocurrir si ya validamos finalOutputFormat
        sharpInstance = sharpInstance.toFormat(finalOutputFormat, {
          quality: finalQuality,
        });
        break;
    }

    return await sharpInstance.toBuffer();
  } catch (error) {
    // Envolver errores de sharp en nuestro ImageProcessingError
    throw new ImageProcessingError(
      `Fallo al redimensionar la imagen para el tamaño ${sizeKey} y formato ${outputFormat}: ${error.message}`,
      error
    );
  }
}

/**
 * Obtiene la extensión de archivo común para un formato de salida dado.
 * @param {string} format - El formato de salida (ej. 'jpeg', 'webp').
 * @returns {string} La extensión de archivo (ej. 'jpg', 'webp').
 */
function getFileExtensionForFormat(format) {
  // Sharp maneja 'jpeg' pero la extensión común es 'jpg'
  if (format.toLowerCase() === 'jpeg') return 'jpg';
  // Otros formatos pueden usar su nombre como extensión
  return format.toLowerCase();
}

module.exports = {
  resizeImage,
  SIZES,
  SUPPORTED_OUTPUT_FORMATS,
  getFileExtensionForFormat,
};
