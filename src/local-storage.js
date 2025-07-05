// src/local-storage.js
const fs = require('fs').promises;
const path = require('path');
const { StorageError } = require('./errors');
const logger = require('./logger');

async function saveSingleImageLocally(imageBuffer, filename, basePath) {
  const fullPath = path.join(basePath, filename);
  const dir = path.dirname(fullPath);

  try {
    logger.debug('Creando directorio local recursivamente: %s', dir);
    await fs.mkdir(dir, { recursive: true });
    logger.debug('Escribiendo archivo local: %s', fullPath);
    await fs.writeFile(fullPath, imageBuffer);
    logger.info('Imagen guardada localmente: %s', fullPath);
    return fullPath;
  } catch (error) {
    // Asegurarse de que el error original se pase como 'cause'
    logger.error(
      'StorageError: Error al guardar la imagen localmente en %s: %s',
      fullPath,
      error.message,
      { originalError: error }
    );
    throw new StorageError(
      `Error al guardar la imagen localmente en '${fullPath}': ${error.message}`,
      error
    );
  }
}

/**
 * Guarda un array de objetos de imagen (original y redimensionadas) en el almacenamiento local.
 * @param {Array<{buffer: Buffer, filename: string, sizeKey: string}>} imagesToSave - Array de objetos con buffers, nombres de archivo y claves de tamaño.
 * @param {string} localStoragePath - La ruta base de almacenamiento local.
 * @returns {Promise<object>} Un objeto con las rutas de las imágenes guardadas.
 * @throws {StorageError} Si hay un error al guardar los archivos.
 */
async function saveImageLocally(imagesToSave, localStoragePath) {
  logger.info(
    'Iniciando proceso de guardado de imágenes localmente. Base path: %s',
    localStoragePath
  );
  const results = {
    original: null,
    resized: {},
  };

  try {
    for (const img of imagesToSave) {
      logger.debug(
        'Guardando imagen local: %s (sizeKey: %s)',
        img.filename,
        img.sizeKey
      );
      if (img.sizeKey === 'original') {
        results.original = await saveSingleImageLocally(
          img.buffer,
          img.filename,
          localStoragePath
        );
      } else {
        results.resized[img.sizeKey] = await saveSingleImageLocally(
          img.buffer,
          img.filename,
          localStoragePath
        );
      }
    }
    logger.info('Todas las imágenes guardadas localmente.');
    return results;
  } catch (error) {
    // saveSingleImageLocally ya lanza StorageError, solo re-lanzamos
    logger.error(
      'StorageError: Fallo al procesar el almacenamiento local: %s',
      error.message,
      { originalError: error.originalError || error }
    );
    throw error;
  }
}

module.exports = { saveImageLocally };
