const AWS = require('aws-sdk');
const path = require('path');
const { resizeImage, SIZES, getFileExtensionForFormat } = require('./utils');
const {
  StorageError,
  ImageProcessingError,
  ConfigurationError,
} = require('./errors');

let s3Instance; // Instancia Singleton de S3

/**
 * Inicializa la instancia de AWS S3. Debe llamarse una vez antes de usar uploadImageToS3.
 * @param {string} accessKeyId - La clave de acceso de AWS.
 * @param {string} secretAccessKey - La clave secreta de AWS.
 * @param {string} region - La región de AWS (ej. 'us-east-1').
 * @returns {AWS.S3} La instancia de S3 inicializada.
 * @throws {ConfigurationError} Si hay un problema al inicializar S3.
 */
function initS3(accessKeyId, secretAccessKey, region) {
  if (!s3Instance) {
    try {
      s3Instance = new AWS.S3({
        accessKeyId: accessKeyId,
        secretAccessKey: secretAccessKey,
        region: region,
        apiVersion: '2006-03-01', // Especifica una versión de API para mayor estabilidad
      });
    } catch (error) {
      throw new ConfigurationError(
        `Error al inicializar AWS S3 SDK: ${error.message}`,
        error
      );
    }
  }
  return s3Instance;
}

/**
 * Sube la imagen original y sus versiones redimensionadas a un bucket S3.
 * Las imágenes se organizan en el bucket como:
 * [bucketName]/images/original_image.jpg
 * [bucketName]/images/resized/original_image_name/small/original_image-small.jpg
 * [bucketName]/images/resized/original_image_name/medium/original_image-medium.jpg
 * [bucketName]/images/resized/original_image_name/large/original_image-large.jpg
 *
 * @param {Buffer} imageBuffer - El buffer de la imagen original.
 * @param {string} originalFilename - El nombre original del archivo (ej. "mi-imagen.jpg").
 * @param {string} bucketName - El nombre del bucket S3.
 * @param {string} [outputFormat='jpeg'] - El formato de salida deseado para las imágenes redimensionadas.
 * @param {number} [quality] - La calidad de las imágenes redimensionadas (0-100).
 * @returns {Promise<object>} Un objeto con las URLs de las imágenes subidas.
 * @throws {ConfigurationError} Si S3 no ha sido inicializado o el bucketName no está configurado.
 * @throws {StorageError} Si falla alguna operación de subida a S3.
 * @throws {ImageProcessingError} Si falla el redimensionamiento de alguna imagen.
 */
async function uploadImageToS3(
  imageBuffer,
  originalFilename,
  bucketName,
  outputFormat = 'jpeg',
  quality
) {
  if (!s3Instance) {
    throw new ConfigurationError(
      'AWS S3 no ha sido inicializado. Llama a initS3 primero.'
    );
  }
  if (!bucketName) {
    throw new ConfigurationError(
      'El nombre del bucket S3 (AWS_S3_BUCKET_NAME) debe estar configurado.'
    );
  }

  const filenameWithoutExt = path.parse(originalFilename).name;
  const originalFileExtension = path.parse(originalFilename).ext.toLowerCase(); // Incluye el punto
  const outputExt = getFileExtensionForFormat(outputFormat);

  const baseKey = `images/${originalFilename}`; // Clave para la imagen original
  // Clave base para redimensionadas, crea una "subcarpeta" con el nombre del archivo original
  const resizedBaseKey = `images/resized/${filenameWithoutExt}`;

  try {
    // Determinar ContentType para la imagen original
    let originalContentType = `application/octet-stream`; // Default
    switch (originalFileExtension) {
      case '.jpg':
      case '.jpeg':
        originalContentType = 'image/jpeg';
        break;
      case '.png':
        originalContentType = 'image/png';
        break;
      case '.gif':
        originalContentType = 'image/gif';
        break;
      case '.webp':
        originalContentType = 'image/webp';
        break;
      case '.tiff':
      case '.tif':
        originalContentType = 'image/tiff';
        break;
      // Añadir más casos según sea necesario
    }

    // Sube la imagen original
    await s3Instance
      .upload({
        Bucket: bucketName,
        Key: baseKey,
        Body: imageBuffer,
        ContentType: originalContentType,
        ACL: 'public-read', // O el ACL que necesites
      })
      .promise();

    const uploadedUrls = {
      original: `https://${bucketName}.s3.${s3Instance.config.region}.amazonaws.com/${baseKey}`,
      resized: {},
    };

    // Redimensiona y sube las imágenes redimensionadas
    for (const sizeKey in SIZES) {
      const resizedBuffer = await resizeImage(
        imageBuffer,
        sizeKey,
        originalFilename,
        outputFormat,
        quality
      );
      const resizedKey = `${resizedBaseKey}/${sizeKey}/${filenameWithoutExt}-${sizeKey}.${outputExt}`;

      await s3Instance
        .upload({
          Bucket: bucketName,
          Key: resizedKey,
          Body: resizedBuffer,
          ContentType: `image/${outputExt === 'jpg' ? 'jpeg' : outputExt}`, // ContentType para la salida
          ACL: 'public-read', // O el ACL que necesites
        })
        .promise();

      uploadedUrls.resized[
        sizeKey
      ] = `https://${bucketName}.s3.${s3Instance.config.region}.amazonaws.com/${resizedKey}`;
    }

    return {
      urls: uploadedUrls,
      message: 'Imágenes subidas a S3 con éxito.',
    };
  } catch (error) {
    // Re-lanza nuestros errores personalizados directamente
    if (
      error instanceof ImageProcessingError ||
      error instanceof ConfigurationError
    ) {
      throw error;
    }
    // Envuelve otros errores inesperados de S3 en un StorageError
    throw new StorageError(
      `Fallo al subir imágenes a S3: ${error.message}`,
      error
    );
  }
}

module.exports = {
  initS3,
  uploadImageToS3,
};
