// src/cache-manager.js
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { StorageError } = require('./errors');
const logger = require('./logger');

const DEFAULT_CACHE_DIR = '.image_cache';

/**
 * Genera una clave de caché única a partir de un objeto de opciones.
 * Esto asegura que la misma combinación de imagen de entrada + opciones dé la misma clave.
 * @param {Buffer} imageBuffer - El buffer de la imagen original.
 * @param {object} options - Las opciones de procesamiento (outputFormat, quality, transformations, sizes, etc.).
 * @returns {string} Una clave de caché única.
 */
function generateCacheKey(imageBuffer, options) {
  const imageHash = crypto
    .createHash('sha256')
    .update(imageBuffer)
    .digest('hex');

  const relevantOptions = { ...options };
  if (typeof relevantOptions.filenameGenerator === 'string') {
    // Si ya está stringified, no hacer nada
  } else if (typeof relevantOptions.filenameGenerator === 'function') {
    // Fallback si se llama directamente con una función
    relevantOptions.filenameGenerator =
      relevantOptions.filenameGenerator.toString();
  }

  const optionsString = JSON.stringify(relevantOptions);
  const optionsHash = crypto
    .createHash('sha256')
    .update(optionsString)
    .digest('hex');

  return `${imageHash}-${optionsHash}`;
}

/**
 * Gestiona el almacenamiento y recuperación de imágenes cacheadas.
 */
class CacheManager {
  constructor(cacheDir, cacheEnabled = false) {
    this.cacheDir = cacheDir
      ? path.resolve(cacheDir)
      : path.resolve(DEFAULT_CACHE_DIR);
    this.cacheEnabled = cacheEnabled;
    logger.info(
      `Cache Manager inicializado. Ruta del caché: %s, Habilitado: %s`,
      this.cacheDir,
      this.cacheEnabled
    );
  }

  /**
   * Inicializa el directorio de caché, creándolo si no existe.
   */
  async init() {
    if (!this.cacheEnabled) {
      logger.info(
        'CacheManager: Caché deshabilitado, no se creará el directorio.'
      );
      return;
    }
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      logger.info(
        `CacheManager: Directorio de caché creado/verificado: %s`,
        this.cacheDir
      );
    } catch (error) {
      logger.error(
        `CacheManager: Error al inicializar el directorio de caché en %s: %s`,
        this.cacheDir,
        error.message,
        { originalError: error }
      );
      throw new StorageError(
        `Error al inicializar el directorio de caché en '${this.cacheDir}': ${error.message}`,
        error
      );
    }
  }

  /**
   * Intenta recuperar las imágenes (buffers y metadatos) del caché.
   * @param {string} cacheKey - La clave única de la imagen procesada.
   * @returns {Promise<Array<{buffer: Buffer, filename: string, sizeKey: string, metadata: object}> | null>}
   * Un array de objetos imagen (similar a `allImagesToSave`) si se encuentra en caché, o null.
   */
  async getCachedImages(cacheKey) {
    if (!this.cacheEnabled) return null;

    const cacheEntryPath = path.join(this.cacheDir, cacheKey);
    try {
      logger.debug(
        'CacheManager: Intentando obtener de caché para clave: %s en %s',
        cacheKey,
        cacheEntryPath
      );
      const metadataFilePath = path.join(cacheEntryPath, 'metadata.json');
      const metadataContent = await fs.readFile(metadataFilePath, 'utf8');
      const cachedMetadata = JSON.parse(metadataContent);

      const cachedImages = [];

      const originalMetadata = cachedMetadata.original;
      if (originalMetadata) {
        const originalBufferPath = path.join(
          cacheEntryPath,
          `original.${originalMetadata.format}`
        );
        const originalBuffer = await fs.readFile(originalBufferPath);
        cachedImages.push({
          buffer: originalBuffer,
          filename: null,
          sizeKey: 'original',
          metadata: originalMetadata,
        });
        logger.debug(
          'CacheManager: Buffer original recuperado de caché: %s',
          originalBufferPath
        );
      }

      for (const sizeKey in cachedMetadata.resized) {
        const resizedMeta = cachedMetadata.resized[sizeKey];
        const resizedBufferPath = path.join(
          cacheEntryPath,
          `${sizeKey}.${resizedMeta.format}`
        );
        const resizedBuffer = await fs.readFile(resizedBufferPath);
        cachedImages.push({
          buffer: resizedBuffer,
          filename: null,
          sizeKey: sizeKey,
          metadata: resizedMeta,
        });
        logger.debug(
          'CacheManager: Buffer redimensionado (%s) recuperado de caché: %s',
          sizeKey,
          resizedBufferPath
        );
      }

      logger.info(
        `CacheManager: Imágenes recuperadas de caché para clave: %s`,
        cacheKey
      );
      return cachedImages;
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.debug(
          `CacheManager: Archivo de caché no encontrado para clave: %s`,
          cacheKey
        );
        return null;
      }
      logger.error(
        `CacheManager: Error al cargar imágenes desde caché para %s: %s`,
        cacheKey,
        error.message,
        { originalError: error }
      );
      // Este error no es fatal para la operación principal, por lo que solo se registra.
      return null;
    }
  }

  /**
   * Almacena las imágenes (buffers y metadatos) en el caché.
   * @param {string} cacheKey - La clave única.
   * @param {Array<{buffer: Buffer, filename: string, sizeKey: string, metadata: object}>} allImagesToSave - Array de objetos con buffers e información.
   */
  async setCachedImages(cacheKey, allImagesToSave) {
    if (!this.cacheEnabled) return;

    const cacheEntryPath = path.join(this.cacheDir, cacheKey);
    try {
      logger.debug(
        'CacheManager: Intentando guardar en caché para clave: %s en %s',
        cacheKey,
        cacheEntryPath
      );
      await fs.mkdir(cacheEntryPath, { recursive: true });

      const metadataToCache = {
        original: null,
        resized: {},
      };

      for (const img of allImagesToSave) {
        const bufferFilePath = path.join(
          cacheEntryPath,
          `${img.sizeKey}.${img.metadata.format}`
        );
        await fs.writeFile(bufferFilePath, img.buffer);
        logger.debug(
          'CacheManager: Buffer guardado en caché: %s',
          bufferFilePath
        );

        if (img.sizeKey === 'original') {
          metadataToCache.original = img.metadata;
        } else {
          metadataToCache.resized[img.sizeKey] = img.metadata;
        }
      }

      const metadataFilePath = path.join(cacheEntryPath, 'metadata.json');
      await fs.writeFile(
        metadataFilePath,
        JSON.stringify(metadataToCache, null, 2),
        'utf8'
      );
      logger.debug(
        'CacheManager: Metadatos guardados en caché: %s',
        metadataFilePath
      );

      logger.info(
        `CacheManager: Imágenes guardadas en caché para clave: %s`,
        cacheKey
      );
    } catch (error) {
      logger.error(
        `CacheManager: Error al guardar imágenes en caché para %s: %s`,
        cacheKey,
        error.message,
        { originalError: error }
      );
      // No lanzar error aquí para no detener el proceso principal si el caché falla
    }
  }

  /**
   * Limpia todo el caché.
   */
  async clearCache() {
    try {
      logger.info(
        `CacheManager: Iniciando limpieza de caché en %s`,
        this.cacheDir
      );
      await fs.rm(this.cacheDir, { recursive: true, force: true });
      logger.info(`CacheManager: Caché limpiado en %s`, this.cacheDir);
    } catch (error) {
      logger.error(
        `CacheManager: Error al limpiar el caché en %s: %s`,
        this.cacheDir,
        error.message,
        { originalError: error }
      );
      throw new StorageError(
        `Error al limpiar el caché: ${error.message}`,
        error
      );
    }
  }
}

module.exports = { CacheManager, generateCacheKey };
