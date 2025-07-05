const fs = require('fs').promises;
const path = require('path');
const { resizeImage, SIZES, getFileExtensionForFormat } = require('./utils');
const { StorageError, ImageProcessingError } = require('./errors');

// Cache para directorios ya creados en esta sesión
const createdDirectories = new Set();

/**
 * Asegura que un directorio exista. Si no existe, lo crea y lo añade al cache.
 * @param {string} dirPath - La ruta del directorio a asegurar.
 * @returns {Promise<void>}
 * @throws {StorageError} Si falla la creación del directorio.
 */
async function ensureDirectoryExists(dirPath) {
  if (createdDirectories.has(dirPath)) {
    return; // Ya sabemos que existe, no es necesario verificar nuevamente
  }
  try {
    await fs.mkdir(dirPath, { recursive: true });
    createdDirectories.add(dirPath); // Añadir al cache para futuras llamadas
  } catch (error) {
    throw new StorageError(
      `Error al crear o verificar el directorio: '${dirPath}'. ${error.message}`,
      error
    );
  }
}

/**
 * Guarda la imagen original y sus versiones redimensionadas localmente.
 * Las imágenes se organizan en:
 * [storagePath]/original_image.jpg
 * [storagePath]/resized/small/original_image-small.jpg
 * [storagePath]/resized/medium/original_image-medium.jpg
 * [storagePath]/resized/large/original_image-large.jpg
 *
 * @param {Buffer} imageBuffer - El buffer de la imagen original.
 * @param {string} originalFilename - El nombre original del archivo (ej. "mi-imagen.jpg").
 * @param {string} storagePath - La ruta base donde se guardarán las imágenes.
 * @param {string} [outputFormat='jpeg'] - El formato de salida deseado para las imágenes redimensionadas.
 * @param {number} [quality] - La calidad de las imágenes redimensionadas (0-100).
 * @returns {Promise<object>} Un objeto con las rutas de las imágenes guardadas.
 * @throws {StorageError} Si falla alguna operación de escritura de archivo o creación de directorio.
 * @throws {ImageProcessingError} Si falla el redimensionamiento de alguna imagen.
 */
async function saveImageLocally(
  imageBuffer,
  originalFilename,
  storagePath,
  outputFormat = 'jpeg',
  quality
) {
  const filenameWithoutExt = path.parse(originalFilename).name;
  const originalFileExtension = path.parse(originalFilename).ext;
  const outputExt = getFileExtensionForFormat(outputFormat);

  const originalImagePath = path.join(storagePath, originalFilename);
  const resizeDirPath = path.join(storagePath, 'resized');

  try {
    // Asegura que las carpetas existan de forma eficiente
    await ensureDirectoryExists(storagePath);
    await ensureDirectoryExists(resizeDirPath);
    for (const sizeKey in SIZES) {
      await ensureDirectoryExists(path.join(resizeDirPath, sizeKey));
    }

    // Guarda la imagen original
    await fs.writeFile(originalImagePath, imageBuffer);

    // Redimensiona y guarda las imágenes en sus carpetas respectivas
    const resizedImages = {};
    for (const sizeKey in SIZES) {
      const resizedBuffer = await resizeImage(
        imageBuffer,
        sizeKey,
        originalFilename,
        outputFormat,
        quality
      );
      const resizedFilename = `${filenameWithoutExt}-${sizeKey}.${outputExt}`;
      const resizedFilePath = path.join(
        resizeDirPath,
        sizeKey,
        resizedFilename
      );
      await fs.writeFile(resizedFilePath, resizedBuffer);
      resizedImages[sizeKey] = resizedFilePath;
    }

    return {
      original: originalImagePath,
      resized: resizedImages,
      message: 'Imágenes guardadas localmente con éxito.',
    };
  } catch (error) {
    // Re-lanza nuestros errores personalizados directamente
    if (
      error instanceof ImageProcessingError ||
      error instanceof StorageError
    ) {
      throw error;
    }
    // Envuelve otros errores inesperados en un StorageError
    throw new StorageError(
      `Fallo al guardar imágenes localmente: ${error.message}`,
      error
    );
  }
}

module.exports = {
  saveImageLocally,
};
