// src/index.js
require('dotenv').config(); // Carga las variables de entorno desde el archivo .env

const path = require('path'); // Módulo para trabajar con rutas de archivos y directorios
const { Readable } = require('stream'); // Clase para trabajar con streams de lectura
const { fileTypeFromBuffer } = require('file-type'); // Para detectar el tipo de archivo de un buffer

// Importaciones de módulos internos de la librería
const { processAndGenerateImages } = require('./image-processor'); // Lógica de procesamiento de imágenes con Sharp
const { saveImageLocally } = require('./local-storage'); // Funciones para guardar imágenes localmente
const { initS3, uploadImageToS3 } = require('./s3-storage'); // Funciones para interactuar con AWS S3
const { CacheManager, generateCacheKey } = require('./cache-manager'); // Clase para gestionar el caché y función para generar claves
const logger = require('./logger'); // Módulo de logging configurado con Winston
const { ConfigurationError, ImageProcessingError, StorageError } = require('./errors'); // Clases de errores personalizados
const { getFileExtensionForFormat } = require('./utils'); // Funciones de utilidad (ej. obtener extensión)
const { generateTimestampedRandomString } = require('./utils/uuid'); // Función para generar nombres aleatorios/únicos

// Tipos MIME de imagen soportados por la librería
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/tiff',
    'image/heif', // Soporte para HEIF/HEIC si Sharp lo tiene activado
]);

// Tamaños de imagen por defecto si no se especifican tamaños personalizados
const DEFAULT_SIZES = {
    small: { width: 320, defaultQuality: 80 },
    medium: { width: 640, defaultQuality: 85 },
    large: { width: 1024, defaultQuality: 90 },
};

/**
 * Clase principal para la librería de redimensionamiento de imágenes YSL.
 * Permite procesar imágenes (redimensionar, transformar) y almacenarlas
 * localmente o en AWS S3, con un sistema de caché integrado.
 */
class ImageResizer {
    /**
     * Constructor de la clase ImageResizer.
     * Inicializa las configuraciones de almacenamiento, caché y tamaños de imagen.
     * @param {object} [config={}] - Objeto de configuración opcional.
     * @param {object} [config.customSizes] - Objeto con definiciones de tamaños personalizados.
     * @throws {ConfigurationError} Si la configuración de entorno es inválida o incompleta.
     */
    constructor(config = {}) {
        logger.info('ImageResizer: Inicializando con configuración: %o', config);

        // --- Carga y validación de variables de entorno ---
        const enableLocalStorage = process.env.ENABLE_LOCAL_STORAGE === 'true';
        const localStoragePath = process.env.LOCAL_STORAGE_PATH;

        const enableS3Storage = process.env.ENABLE_S3_STORAGE === 'true';
        const awsConfig = enableS3Storage ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            region: process.env.AWS_REGION,
            bucketName: process.env.AWS_S3_BUCKET_NAME
        } : null;

        const enableCache = process.env.ENABLE_IMAGE_CACHE === 'true';
        const cachePath = process.env.IMAGE_CACHE_PATH;

        // Validaciones de configuración obligatorias
        if (enableLocalStorage && !localStoragePath) {
            const msg = 'LOCAL_STORAGE_PATH no está definido en las variables de entorno.';
            logger.error('ConfigurationError: %s', msg);
            throw new ConfigurationError(msg, null, 'ERR_LOCAL_STORAGE_PATH_MISSING');
        }
        if (enableS3Storage && (!awsConfig.accessKeyId || !awsConfig.secretAccessKey || !awsConfig.region || !awsConfig.bucketName)) {
            const msg = 'Credenciales de AWS S3 incompletas o faltantes en las variables de entorno.';
            logger.error('ConfigurationError: %s', msg);
            throw new ConfigurationError(msg, null, 'ERR_AWS_CREDENTIALS_MISSING');
        }
        if (enableCache && !cachePath) {
            const msg = 'IMAGE_CACHE_PATH no está definido en las variables de entorno.';
            logger.error('ConfigurationError: %s', msg);
            throw new ConfigurationError(msg, null, 'ERR_CACHE_PATH_MISSING');
        }
        if (!enableLocalStorage && !enableS3Storage) {
            logger.warn('ImageResizer: Ni almacenamiento local ni S3 están habilitados. Las imágenes procesadas no se guardarán.');
        }

        // --- Configuración de tamaños de imagen ---
        // Permite al usuario definir tamaños personalizados o usa los por defecto.
        this.sizes = config.customSizes || DEFAULT_SIZES;

        // Validar la estructura de los tamaños de imagen
        for (const sizeKey in this.sizes) {
            const sizeConfig = this.sizes[sizeKey];
            if (typeof sizeConfig.width !== 'number' || sizeConfig.width <= 0) {
                const msg = `La configuración para el tamaño '${sizeKey}' es inválida: 'width' debe ser un número positivo.`;
                logger.error('ConfigurationError: %s', msg);
                throw new ConfigurationError(msg, null, 'ERR_INVALID_SIZE_CONFIG');
            }
            if (typeof sizeConfig.defaultQuality !== 'number' || sizeConfig.defaultQuality < 0 || sizeConfig.defaultQuality > 100) {
                const msg = `La configuración para el tamaño '${sizeKey}' es inválida: 'defaultQuality' debe ser un número entre 0 y 100.`;
                logger.error('ConfigurationError: %s', msg);
                throw new ConfigurationError(msg, null, 'ERR_INVALID_QUALITY_CONFIG');
            }
        }

        // --- Inicialización de módulos de almacenamiento y caché ---
        // Ahora, almacenamos la ruta directamente en el objeto localStorage para que sea accesible
        this.localStorage = enableLocalStorage ? { saveImage: saveImageLocally, path: localStoragePath } : null;
        this.s3Storage = enableS3Storage ? { init: initS3, uploadImage: uploadImageToS3, config: awsConfig } : null; // Almacena la config de AWS
        this.cacheManager = enableCache ? new CacheManager(cachePath, enableCache) : null; // Pasa enableCache al constructor

        // Inicializa S3 si está habilitado
        if (this.s3Storage) {
            this.s3Storage.init(this.s3Storage.config.accessKeyId, this.s3Storage.config.secretAccessKey, this.s3Storage.config.region);
        }
        // Inicializa el directorio de caché
        if (this.cacheManager) {
            this.cacheManager.init().catch(err => {
                logger.error('ImageResizer: Error al inicializar el directorio de caché: %s', err.message, { originalError: err });
                // No lanzar, el caché es una optimización, no debe detener la librería
            });
        }

        logger.info('ImageResizer: Módulos de almacenamiento y caché inicializados.');
    }

    /**
     * Generador de nombres de archivo por defecto.
     * Crea un nombre único combinando el nombre base original, un ID aleatorio y el tamaño/original.
     * @param {object} params - Parámetros para la generación del nombre.
     * @param {string} params.baseName - El nombre base del archivo original (sin extensión).
     * @param {string} params.extension - La extensión de archivo final (ej. 'jpg', 'webp').
     * @param {string} [params.sizeKey] - La clave del tamaño de la imagen (ej. 'small', 'medium').
     * @param {string} params.outputFormat - El formato de salida final de la imagen.
     * @param {boolean} params.isOriginal - True si es la imagen original procesada, false para redimensionadas.
     * @param {string} params.uniqueImageId - El ID único generado para esta sesión de procesamiento de imagen.
     * @returns {string} Nombre de archivo único.
     */
    defaultFilenameGenerator({ baseName, extension, sizeKey, outputFormat, isOriginal, uniqueImageId }) {
        // Usa el uniqueImageId pasado para asegurar que todas las variantes de la misma imagen compartan el mismo ID
        let finalBaseName = `${baseName}-${uniqueImageId}`;
        let finalExtension = outputFormat || extension; // Usar outputFormat si está definido, si no, la original

        if (isOriginal) {
            return `${finalBaseName}.original.${finalExtension}`;
        }
        // Para imágenes redimensionadas, crea una estructura de subcarpeta por tamaño
        return `resized/${sizeKey}/${finalBaseName}.${sizeKey}.${finalExtension}`;
    }

    /**
     * Procesa una imagen: la redimensiona, aplica transformaciones y la guarda.
     * @param {Buffer | Readable} imageSource - El buffer de la imagen o un ReadableStream.
     * @param {string} originalFilename - El nombre original del archivo (ej. "mi-imagen.jpg").
     * @param {object} [options={}] - Opciones adicionales para el procesamiento.
     * @param {string} [options.outputFormat] - El formato de salida deseado (ej. 'jpeg', 'png', 'webp').
     * @param {number} [options.quality] - La calidad de la imagen de salida (0-100).
     * @param {boolean} [options.optimizeOutputFormat=false] - Si es true, la librería intentará elegir el mejor formato.
     * @param {string[]} [options.processSizes] - Un array de strings con las claves de los tamaños a procesar.
     * @param {function(object): string} [options.filenameGenerator] - Función para generar nombres personalizados.
     * @param {object} [options.transformations] - Objeto con opciones de transformación adicionales para `sharp`.
     * @returns {Promise<object>} Un objeto con los resultados de cada tipo de almacenamiento (local y/o S3),
     * incluyendo metadatos de las imágenes.
     * @throws {ConfigurationError} Si hay un problema con la configuración o las opciones de entrada.
     * @throws {ImageProcessingError} Si hay un problema durante el procesamiento de la imagen.
     * @throws {StorageError} Si hay un problema durante el almacenamiento de la imagen.
     */
    async processImage(imageSource, originalFilename, options = {}) {
        logger.info('ImageResizer: Iniciando procesamiento para %s con opciones: %o', originalFilename, options);

        // Validaciones de entrada (aquí se mantienen las validaciones generales)
        if (!imageSource || (!(imageSource instanceof Buffer) && !(imageSource instanceof Readable))) {
            const msg = 'El parámetro `imageSource` debe ser un Buffer o un ReadableStream.';
            logger.error('ImageProcessingError: %s', msg);
            throw new ImageProcessingError(msg, null, 'ERR_INVALID_IMAGE_SOURCE');
        }
        if (typeof originalFilename !== 'string' || originalFilename.trim() === '') {
            const msg = 'El parámetro `originalFilename` debe ser una cadena de texto no vacía.';
            logger.error('ImageProcessingError: %s', msg);
            throw new ImageProcessingError(msg, null, 'ERR_INVALID_FILENAME');
        }
        if (options.quality !== undefined && (typeof options.quality !== 'number' || options.quality < 0 || options.quality > 100)) {
            const msg = 'La calidad debe ser un número entre 0 y 100.';
            logger.error('ConfigurationError: %s', msg);
            throw new ConfigurationError(msg, null, 'ERR_INVALID_QUALITY');
        }
        if (options.processSizes !== undefined) {
            if (!Array.isArray(options.processSizes) || !options.processSizes.every(size => typeof size === 'string' && this.sizes[size])) {
                const invalidSizes = options.processSizes.filter(size => !this.sizes[size]);
                const msg = `El parámetro 'processSizes' contiene claves de tamaño inválidas: ${invalidSizes.join(', ')}. Las claves válidas son: ${Object.keys(this.sizes).join(', ')}.`;
                logger.error('ConfigurationError: %s', msg);
                throw new ConfigurationError(msg, null, 'ERR_INVALID_PROCESS_SIZES');
            }
        }
        if (options.filenameGenerator !== undefined && typeof options.filenameGenerator !== 'function') {
            const msg = 'El parámetro `filenameGenerator` debe ser una función.';
            logger.error('ConfigurationError: %s', msg);
            throw new ConfigurationError(msg, null, 'ERR_INVALID_FILENAME_GENERATOR');
        }
        if (options.transformations !== undefined && (typeof options.transformations !== 'object' || options.transformations === null || Array.isArray(options.transformations))) {
            const msg = 'El parámetro `transformations` debe ser un objeto válido.';
            logger.error('ConfigurationError: %s', msg);
            throw new ConfigurationError(msg, null, 'ERR_INVALID_TRANSFORMATIONS_OBJECT');
        }

        // Generar un ID único para esta sesión de procesamiento de imagen
        // Este ID se usará para todas las variantes de la imagen original.
        const uniqueImageId = generateTimestampedRandomString(8);

        // Usar el generador de nombre de archivo proporcionado o el por defecto
        const filenameGenerator = options.filenameGenerator || this.defaultFilenameGenerator;

        // --- Lógica de Caché (comprobación) ---
        let allImagesToSave; // Este array contendrá los buffers y metadatos de todas las imágenes procesadas
        let finalResults = { // Objeto para el resultado final a retornar
            metadata: {
                original: null,
                resized: {}
            },
            local: {},
            s3: {}
        };

        if (this.cacheManager) {
            // generateCacheKey es una función independiente, no un método de instancia
            // La clave de caché NO debe incluir el uniqueImageId, ya que el ID es para el nombre de archivo,
            // no para la identificación del contenido del caché.
            const cacheKey = generateCacheKey(imageSource, options, this.sizes);
            try {
                const cachedData = await this.cacheManager.getCachedImages(cacheKey); // Obtener buffers y metadatos cacheados
                if (cachedData) {
                    logger.info('ImageResizer: Cache HIT para %s. Retornando resultados cacheados.', originalFilename);
                    allImagesToSave = cachedData;

                    // Reconstruir finalResults.metadata y asignar nombres de archivo definitivos
                    const originalFileBaseName = path.parse(originalFilename).name;
                    for (const img of allImagesToSave) {
                        const isOriginal = img.sizeKey === 'original';
                        const baseName = originalFileBaseName;
                        const extension = getFileExtensionForFormat(img.metadata.format);

                        // Pasar el uniqueImageId generado para esta sesión
                        const finalFilename = filenameGenerator({
                            originalFilename: originalFilename,
                            baseName: baseName,
                            extension: extension,
                            sizeKey: img.sizeKey,
                            outputFormat: img.metadata.format,
                            isOriginal: isOriginal,
                            uniqueImageId: uniqueImageId // Pasa el ID único
                        });
                        img.filename = finalFilename; // Asignar el nombre generado

                        if (isOriginal) {
                            finalResults.metadata.original = { ...img.metadata, filename: finalFilename };
                        } else {
                            finalResults.metadata.resized[img.sizeKey] = { ...img.metadata, filename: finalFilename };
                        }
                    }

                    // Proceder directamente al almacenamiento con las imágenes cacheadas
                    return this._performStorageOperations(allImagesToSave, finalResults, originalFilename);
                }
            } catch (cacheError) {
                logger.warn('ImageResizer: Error al buscar en caché para %s. Procediendo con el procesamiento normal. Error: %s', originalFilename, cacheError.message, { originalError: cacheError });
                // No lanzar, el caché es una optimización
            }
        }

        // --- Procesamiento de imagen (si no hubo cache hit) ---
        logger.info('ImageResizer: Cache MISS o caché deshabilitado. Procesando imagen %s.', originalFilename);
        try {
            // `processAndGenerateImages` retorna los buffers y metadatos de las imágenes
            allImagesToSave = await processAndGenerateImages(
                imageSource,
                originalFilename,
                this.sizes, // Pasa la configuración de tamaños del ImageResizer
                options // Pasa las opciones de procesamiento (outputFormat, quality, etc.)
            );

            // Después del procesamiento, generar los nombres de archivo definitivos
            const originalFileBaseName = path.parse(originalFilename).name;
            for (const img of allImagesToSave) {
                const isOriginal = img.sizeKey === 'original';
                const baseName = originalFileBaseName;
                const extension = getFileExtensionForFormat(img.metadata.format);

                // Pasar el uniqueImageId generado para esta sesión
                const finalFilename = filenameGenerator({
                    originalFilename: originalFilename,
                    baseName: baseName,
                    extension: extension,
                    sizeKey: img.sizeKey,
                    outputFormat: img.metadata.format,
                    isOriginal: isOriginal,
                    uniqueImageId: uniqueImageId // Pasa el ID único
                });
                img.filename = finalFilename; // Asignar el nombre generado

                if (isOriginal) {
                    finalResults.metadata.original = { ...img.metadata, filename: finalFilename };
                } else {
                    finalResults.metadata.resized[img.sizeKey] = { ...img.metadata, filename: finalFilename };
                }
            }

            // Guardar los resultados del procesamiento en caché para futuras solicitudes
            if (this.cacheManager) {
                const cacheKey = generateCacheKey(imageSource, options, this.sizes);
                await this.cacheManager.setCachedImages(cacheKey, allImagesToSave); // Guarda los buffers y metadatos
                logger.info('ImageResizer: Imágenes procesadas y guardadas en caché para %s.', originalFilename);
            }

            // --- Realizar operaciones de almacenamiento ---
            return this._performStorageOperations(allImagesToSave, finalResults, originalFilename);

        } catch (error) {
            // Relanzar errores que ya son de nuestras clases personalizadas
            if (error instanceof ConfigurationError || error instanceof ImageProcessingError || error instanceof StorageError) {
                logger.error('ImageResizer: Error durante el procesamiento de imagen para %s: %s (Code: %s)', originalFilename, error.message, error.code, { originalError: error.originalError, stack: error.stack });
                throw error;
            }
            // Envolver cualquier otro error inesperado en un ImageProcessingError
            const msg = `Error inesperado al procesar la imagen '${originalFilename}': ${error.message}`;
            logger.error('ImageResizer: %s', msg, { originalError: error, stack: error.stack });
            throw new ImageProcessingError(msg, error, 'ERR_UNEXPECTED_PROCESSING_ERROR');
        }
    }

    /**
     * Método auxiliar para realizar las operaciones de almacenamiento (local y S3).
     * @param {Array<object>} imagesToSave - Array de objetos de imagen con buffers y nombres de archivo definitivos.
     * @param {object} finalResults - Objeto de resultados que se está construyendo.
     * @param {string} originalFilename - Nombre del archivo original para logging.
     * @returns {Promise<object>} El objeto finalResults actualizado con las URLs/rutas de almacenamiento.
     * @private
     */
    async _performStorageOperations(imagesToSave, finalResults, originalFilename) {
        // --- Guardar en Local Storage ---
        if (this.localStorage) {
            logger.info('ImageResizer: Iniciando almacenamiento local para %s.', originalFilename);
            try {
                // Pasa el array completo de imágenes y la ruta base de almacenamiento local
                const localResults = await this.localStorage.saveImage(imagesToSave, this.localStorage.path);
                finalResults.local = localResults;
                logger.info('ImageResizer: Almacenamiento local completado para %s.', originalFilename);
            } catch (error) {
                logger.error('ImageResizer: Fallo al guardar en almacenamiento local para %s: %s', originalFilename, error.message, { originalError: error });
                // No lanzar, permite que otros almacenamientos continúen o solo reporte el error
                // finalResults.local podría quedar incompleto o con error si se desea reflejarlo
            }
        }

        // --- Guardar en S3 ---
        if (this.s3Storage) {
            logger.info('ImageResizer: Iniciando subida a S3 para %s.', originalFilename);
            try {
                // Pasa el array completo de imágenes y el nombre del bucket S3
                const s3Results = await this.s3Storage.uploadImage(imagesToSave, this.s3Storage.config.bucketName);
                finalResults.s3 = s3Results;
                logger.info('ImageResizer: Subida a S3 completada para %s.', originalFilename);
            } catch (error) {
                logger.error('ImageResizer: Fallo al subir a S3 para %s: %s', originalFilename, error.message, { originalError: error });
                // No lanzar, permite que otros almacenamientos continúen o solo reporte el error
                // finalResults.s3 podría quedar incompleto o con error si se desea reflejarlo
            }
        }
        return finalResults;
    }
}

// --- Exportaciones de la librería ---
// Exportar la clase principal ImageResizer
module.exports = ImageResizer;

// Exportar las clases de error para que los consumidores de la librería puedan usarlas
module.exports.ConfigurationError = ConfigurationError;
module.exports.ImageProcessingError = ImageProcessingError;
module.exports.StorageError = StorageError;