// src/s3-storage.js
const AWS = require('aws-sdk');
const { StorageError } = require('./errors');
const logger = require('./logger');

let s3;

function initS3(accessKeyId, secretAccessKey, region) {
  logger.info('Inicializando cliente AWS S3 para región: %s', region);
  try {
    s3 = new AWS.S3({
      accessKeyId,
      secretAccessKey,
      region,
    });
    logger.info('Cliente S3 inicializado.');
  } catch (error) {
    logger.error(
      'StorageError: Error al inicializar el cliente S3: %s',
      error.message,
      { originalError: error }
    );
    throw new StorageError(
      `Error al inicializar el cliente S3: ${error.message}`,
      error
    );
  }
}

async function uploadSingleImageToS3(imageBuffer, key, bucketName) {
  const params = {
    Bucket: bucketName,
    Key: key,
    Body: imageBuffer,
  };

  try {
    logger.debug('Subiendo objeto a S3. Bucket: %s, Key: %s', bucketName, key);
    const data = await s3.upload(params).promise();
    logger.info('Imagen subida a S3: %s', data.Location);
    return data.Location;
  } catch (error) {
    logger.error(
      'StorageError: Error al subir la imagen a S3 (Key: %s): %s',
      key,
      error.message,
      { originalError: error }
    );
    throw new StorageError(
      `Error al subir la imagen a S3 (Key: ${key}): ${error.message}`,
      error
    );
  }
}

/**
 * Sube un array de objetos de imagen (original y redimensionadas) a AWS S3.
 * @param {Array<{buffer: Buffer, filename: string, sizeKey: string}>} imagesToSave - Array de objetos con buffers, nombres de archivo y claves de tamaño.
 * @param {string} s3BucketName - El nombre del bucket S3.
 * @returns {Promise<object>} Un objeto con las URLs de las imágenes subidas.
 * @throws {StorageError} Si hay un error al subir los archivos.
 */
async function uploadImageToS3(imagesToSave, s3BucketName) {
  logger.info(
    'Iniciando proceso de subida de imágenes a S3. Bucket: %s',
    s3BucketName
  );
  if (!s3) {
    logger.error('StorageError: El cliente S3 no ha sido inicializado.');
    throw new StorageError(
      'El cliente S3 no ha sido inicializado. Asegúrese de llamar a initS3.'
    );
  }

  const results = {
    original: null,
    resized: {},
  };

  try {
    for (const img of imagesToSave) {
      logger.debug(
        'Subiendo imagen S3: %s (sizeKey: %s)',
        img.filename,
        img.sizeKey
      );
      if (img.sizeKey === 'original') {
        results.original = await uploadSingleImageToS3(
          img.buffer,
          img.filename,
          s3BucketName
        );
      } else {
        results.resized[img.sizeKey] = await uploadSingleImageToS3(
          img.buffer,
          img.filename,
          s3BucketName
        );
      }
    }
    logger.info('Todas las imágenes subidas a S3.');
    return results;
  } catch (error) {
    // uploadSingleImageToS3 ya lanza StorageError, solo re-lanzamos
    logger.error(
      'StorageError: Fallo al procesar la subida a S3: %s',
      error.message,
      { originalError: error.originalError || error }
    );
    throw error;
  }
}

module.exports = { initS3, uploadImageToS3 };
