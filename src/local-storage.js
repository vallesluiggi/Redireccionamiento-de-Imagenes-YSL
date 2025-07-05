// src/local-storage.js
const fs = require('fs').promises; // Usamos la versión de promesas de fs
const path = require('path'); // Módulo para trabajar con rutas de archivos y directorios
const { StorageError } = require('./errors'); // Importa la clase de error personalizada
const logger = require('./logger'); // Importa el módulo de logging

/**
 * Guarda un único buffer de imagen en el sistema de archivos local.
 * Asegura que el directorio de destino exista, creándolo recursivamente si es necesario.
 * @param {Buffer} imageBuffer - El buffer de la imagen a guardar.
 * @param {string} filename - El nombre de archivo completo (incluyendo subdirectorios si los hay).
 * @param {string} basePath - La ruta base donde se guardará el archivo (ej. './output/images').
 * @returns {Promise<string>} La ruta completa del archivo guardado.
 * @throws {StorageError} Si hay un error al guardar el archivo.
 */
async function saveSingleImageLocally(imageBuffer, filename, basePath) {
    // Construye la ruta completa del archivo
    const fullPath = path.join(basePath, filename);
    // Extrae el directorio del archivo
    const dir = path.dirname(fullPath);

    try {
        logger.debug('LocalStorage: Verificando/Creando directorio recursivamente: %s', dir);
        // ¡Punto clave! Crea el directorio de forma recursiva si no existe
        await fs.mkdir(dir, { recursive: true });
        logger.debug('LocalStorage: Escribiendo archivo local: %s', fullPath);
        // Escribe el buffer de la imagen en la ruta especificada
        await fs.writeFile(fullPath, imageBuffer);
        logger.info('LocalStorage: Imagen guardada localmente: %s', fullPath);
        return fullPath; // Retorna la ruta completa del archivo guardado
    } catch (error) {
        // Captura cualquier error durante la creación del directorio o la escritura del archivo
        logger.error('StorageError: Error al guardar la imagen localmente en %s: %s', fullPath, error.message, { originalError: error });
        // Lanza un StorageError personalizado con el mensaje y el error original
        throw new StorageError(`Error al guardar la imagen localmente en '${fullPath}': ${error.message}`, error, 'ERR_LOCAL_SAVE_FAILED');
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
    logger.info('LocalStorage: Iniciando proceso de guardado de imágenes localmente. Base path: %s', localStoragePath);
    const results = {
        original: null,
        resized: {}
    };

    try {
        // Itera sobre cada imagen en el array y la guarda individualmente
        for (const img of imagesToSave) {
            logger.debug('LocalStorage: Guardando imagen local: %s (sizeKey: %s)', img.filename, img.sizeKey);
            if (img.sizeKey === 'original') {
                results.original = await saveSingleImageLocally(img.buffer, img.filename, localStoragePath);
            } else {
                results.resized[img.sizeKey] = await saveSingleImageLocally(img.buffer, img.filename, localStoragePath);
            }
        }
        logger.info('LocalStorage: Todas las imágenes procesadas guardadas localmente.');
        return results; // Retorna el objeto con todas las rutas de los archivos guardados
    } catch (error) {
        // saveSingleImageLocally ya lanza un StorageError, solo lo relanzamos aquí
        logger.error('StorageError: Fallo al procesar el almacenamiento local: %s', error.message, { originalError: error.originalError || error });
        throw error;
    }
}

module.exports = { saveImageLocally };