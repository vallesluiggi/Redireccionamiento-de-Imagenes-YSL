redimensionamiento-de-imagenes-ysl
Una potente y flexible librería de Node.js para el redimensionamiento, optimización y almacenamiento de imágenes. Soporta almacenamiento local y subida a AWS S3, con gestión de caché integrada y un robusto manejo de errores.

📋 Tabla de Contenidos
Características

Instalación

Configuración

Variables de Entorno (.env)

Uso

Inicialización

Método processImage()

Ejemplos de Uso

Manejo de Errores

Contribución

Licencia

Contacto

✨ Características
Redimensionamiento Flexible: Define múltiples tamaños personalizados para tus imágenes o utiliza los predefinidos.

Optimización de Formato: Soporte para JPEG, PNG, WebP, AVIF, TIFF. Opción para optimizar el formato de salida automáticamente (ej., convertir a WebP si detecta transparencia).

Almacenamiento Múltiple:

Local: Guarda las imágenes procesadas en un directorio de tu sistema de archivos.

AWS S3: Sube las imágenes directamente a un bucket de S3.

Caché Inteligente: Almacena imágenes procesadas en caché (en disco) para evitar reprocesamientos innecesarios y mejorar el rendimiento.

Transformaciones Avanzadas: Aplica rotaciones, volteos, escala de grises y otras transformaciones de la librería sharp directamente.

Generación de Nombres de Archivo Personalizada: Define tu propia lógica (función callback) para nombrar los archivos de salida.

Generación de Metadatos: Obtiene y retorna metadatos clave (ancho, alto, formato, tamaño en bytes) de cada imagen procesada.

Logging Detallado: Utiliza winston para un registro estructurado y configurable de todas las operaciones y errores.

Manejo de Errores Tipificado: Errores personalizados para una depuración y manejo de excepciones más claros (ConfigurationError, ImageProcessingError, StorageError), incluyendo la causa raíz.

Diseño Modular: Estructura de código limpia y modular para facilitar la mantenibilidad y extensibilidad.

Procesamiento Paralelo: Redimensionamiento de múltiples tamaños en paralelo para un mejor rendimiento.

🚀 Instalación
Para instalar la librería en tu proyecto, asegúrate de tener Node.js (versión 16 o superior recomendada) y npm instalados.

npm install redimensionamiento-de-imagenes-ysl

Para desarrollo local o pruebas (si la librería está en una carpeta hermana):

En el package.json de tu proyecto de prueba, puedes referenciar la librería localmente:

{
"name": "mi-proyecto-test",
"version": "1.0.0",
"dependencies": {
"redimensionamiento-de-imagenes-ysl": "file:../redimensionamiento-de-imagenes-ysl",
"sharp": "^0.33.4",
"file-type": "^19.0.0",
"dotenv": "^16.4.5",
"winston": "^3.13.0",
"aws-sdk": "^2.1646.0"
}
}

Luego, ejecuta npm install en la raíz de tu proyecto de prueba.

⚙️ Configuración
La librería se configura a través de variables de entorno y un objeto de configuración pasado al constructor de ImageResizer.

Variables de Entorno (.env)
Crea un archivo .env en la raíz de tu proyecto (donde ejecutas tu aplicación o script que usa la librería).

# --- Configuración de Almacenamiento Local ---

# Habilita o deshabilita el guardado local de imágenes.

ENABLE_LOCAL_STORAGE=true

# Ruta absoluta o relativa donde se guardarán las imágenes localmente.

LOCAL_STORAGE_PATH=./output/images

# --- Configuración de AWS S3 ---

# Habilita o deshabilita la subida de imágenes a AWS S3.

ENABLE_S3_STORAGE=false

# Tus credenciales de AWS (requeridas si ENABLE_S3_STORAGE es 'true').

# AWS_ACCESS_KEY_ID=TU_ACCESS_KEY_ID

# AWS_SECRET_ACCESS_KEY=TU_SECRET_ACCESS_KEY

# La región de tu bucket S3 (ej: us-east-1).

# AWS_REGION=tu-region-aws

# El nombre de tu bucket S3.

# AWS_S3_BUCKET_NAME=tu-nombre-de-bucket-s3

# --- Configuración de Caché ---

# Habilita o deshabilita el sistema de caché de imágenes procesadas.

ENABLE_IMAGE_CACHE=true

# Ruta donde se guardará el caché de imágenes en disco.

IMAGE_CACHE_PATH=./.image_cache

# --- Configuración de Logging ---

# Nivel de log para la consola y archivos (error, warn, info, verbose, debug, silly).

LOG_LEVEL=debug

💡 Uso
Inicialización
Importa la clase ImageResizer y las clases de error para un manejo robusto.

const ImageResizer = require('redimensionamiento-de-imagenes-ysl');
const { ConfigurationError, ImageProcessingError, StorageError } = require('redimensionamiento-de-imagenes-ysl');

// Opcional: Define tus propios tamaños de imagen.
// Si no se especifica, la librería usará tamaños por defecto (small, medium, large).
const myCustomSizes = {
thumbnail: { width: 150, defaultQuality: 60 },
mobile: { width: 480, defaultQuality: 75 },
desktop: { width: 1440, defaultQuality: 90 }
};

let resizer;
try {
resizer = new ImageResizer({
customSizes: myCustomSizes // Pasa tus tamaños personalizados al constructor
});
console.log("ImageResizer inicializado con éxito.");
} catch (error) {
if (error instanceof ConfigurationError) {
console.error(`Error de configuración al inicializar: ${error.message}`);
} else {
console.error(`Error inesperado durante la inicialización: ${error.message}`);
}
process.exit(1); // Salir si la inicialización falla
}

Tamaños por defecto (si no se usa customSizes):

const DEFAULT_SIZES = {
small: { width: 320, defaultQuality: 80 },
medium: { width: 640, defaultQuality: 85 },
large: { width: 1024, defaultQuality: 90 },
};

Método processImage()
Este es el método principal para procesar tus imágenes.

/\*\*

- Procesa una imagen, aplicando redimensionamiento, transformaciones y guardándola según la configuración.
-
- @param {Buffer | Readable} imageSource - El buffer de la imagen o un ReadableStream.
- @param {string} originalFilename - El nombre original del archivo (ej. "mi-imagen.jpg").
- @param {object} [options={}] - Opciones adicionales para el procesamiento.
- @param {string} [options.outputFormat] - El formato de salida deseado (ej. 'jpeg', 'png', 'webp', 'avif', 'tiff').
- Si no se especifica, se intenta optimizar o se usa 'jpeg' por defecto.
- @param {number} [options.quality] - La calidad de la imagen de salida (0-100).
- Si no se especifica, usa la calidad por defecto del tamaño.
- @param {boolean} [options.optimizeOutputFormat=false] - Si es `true`, la librería intentará elegir el mejor formato
- de salida basado en las propiedades de la imagen de entrada
- (ej. `webp` si detecta transparencia).
- @param {string[]} [options.processSizes] - Un array de strings con las claves de los tamaños a procesar
- (ej. `['small', 'medium']`). Si no se especifica, se procesan todos
- los tamaños configurados en la inicialización.
- @param {function(object): string} [options.filenameGenerator] - Una función `callback` para generar nombres de archivo personalizados.
- Recibe un objeto con propiedades:
- `{ originalFilename, baseName, extension, sizeKey, outputFormat, isOriginal }`.
- Debe devolver el nombre de archivo completo (ej. "imagen-unique.webp").
- @param {object} [options.transformations] - Un objeto con opciones de transformación adicionales para `sharp`.
- Las claves corresponden a métodos de `sharp` (ej. `rotate`, `flip`, `grayscale`, `tint`).
- También soporta `composite` para superponer imágenes.
- Ej: `{ rotate: 90, grayscale: true, composite: [{ input: watermarkBuffer, gravity: 'southeast' }] }`.
- @returns {Promise<object>} Un objeto con los resultados del procesamiento:
- `{ metadata: { original: {}, resized: {} }, local: {}, s3: {} }`.
- Contiene metadatos (width, height, format, size) y URLs/rutas de las imágenes guardadas.
- @throws {ConfigurationError} Si hay un problema con la configuración o las opciones de entrada.
- @throws {ImageProcessingError} Si hay un problema durante el procesamiento de la imagen (ej. formato inválido, corrupción).
- @throws {StorageError} Si hay un problema durante el almacenamiento de la imagen (local o S3).
  \*/

Ejemplos de Uso
const fs = require('fs').promises;
const path = require('path');
const ImageResizer = require('redimensionamiento-de-imagenes-ysl');
const { ConfigurationError, ImageProcessingError, StorageError } = require('redimensionamiento-de-imagenes-ysl');

async function runExamples() {
const imagePath = path.join(\_\_dirname, 'images-input', 'example.jpg'); // Asegúrate de tener esta imagen
const originalFilename = 'example.jpg';

    // Inicializa el resizer (asegúrate de que tu .env esté configurado)
    const resizer = new ImageResizer(); // Usará los tamaños por defecto si no se pasaron customSizes

    try {
        const imageBuffer = await fs.readFile(imagePath);

        // --- Ejemplo 1: Redimensionar con configuraciones por defecto ---
        console.log("\n--- Procesando imagen con configuraciones por defecto ---");
        let resultsDefault = await resizer.processImage(imageBuffer, originalFilename);
        console.log("Resultados (por defecto):", JSON.stringify(resultsDefault, null, 2));

        // --- Ejemplo 2: Redimensionar con tamaños específicos y formato optimizado ---
        console.log("\n--- Procesando imagen con tamaños específicos y formato optimizado ---");
        let resultsOptimized = await resizer.processImage(imageBuffer, originalFilename, {
            processSizes: ['small', 'medium'], // Procesar solo estos tamaños
            optimizeOutputFormat: true,         // La librería elegirá el mejor formato (ej. WebP)
            quality: 85                         // Calidad general para todos los tamaños procesados
        });
        console.log("Resultados (específicos y optimizado):", JSON.stringify(resultsOptimized, null, 2));

        // --- Ejemplo 3: Redimensionar con un generador de nombre de archivo personalizado ---
        console.log("\n--- Procesando imagen con nombre de archivo personalizado ---");
        const myFilenameGenerator = ({ baseName, sizeKey, extension, isOriginal, outputFormat }) => {
            const timestamp = Date.now();
            if (isOriginal) {
                return `original/${baseName}_${timestamp}.${extension}`;
            }
            return `processed/${sizeKey}/${baseName}_${sizeKey}_${timestamp}.${extension}`;
        };
        let resultsCustomName = await resizer.processImage(imageBuffer, originalFilename, {
            processSizes: ['small', 'large'],
            filenameGenerator: myFilenameGenerator,
            outputFormat: 'webp'
        });
        console.log("Resultados (nombre personalizado):", JSON.stringify(resultsCustomName, null, 2));

        // --- Ejemplo 4: Aplicar transformaciones (rotar y escala de grises) ---
        console.log("\n--- Procesando imagen con transformaciones ---");
        let resultsTransformed = await resizer.processImage(imageBuffer, originalFilename, {
            outputFormat: 'jpeg',
            processSizes: ['medium'],
            transformations: {
                rotate: 90,       // Rotar 90 grados
                grayscale: true,  // Convertir a escala de grises
                flip: true        // Voltear horizontalmente
            }
        });
        console.log("Resultados (transformaciones):", JSON.stringify(resultsTransformed, null, 2));

    } catch (error) {
        // Manejo de errores centralizado
        if (error instanceof ConfigurationError) {
            console.error(`\n❌ ERROR DE CONFIGURACIÓN (${error.code}): ${error.message}`);
        } else if (error instanceof ImageProcessingError) {
            console.error(`\n❌ ERROR DE PROCESAMIENTO DE IMAGEN (${error.code}): ${error.message}`);
        } else if (error instanceof StorageError) {
            console.error(`\n❌ ERROR DE ALMACENAMIENTO (${error.code}): ${error.message}`);
        } else {
            console.error(`\n❌ ERROR INESPERADO: ${error.message}`);
        }
        if (error.originalError) {
            console.error("   Causa original:", error.originalError.message);
            // console.error("   Stack de la causa:", error.originalError.stack); // Descomentar para más detalles
        }
        // console.error("   Stack completo del error:", error.stack); // Descomentar para stack completo
    } finally {
        console.log("\n--- Ejemplos de uso finalizados ---");
    }

}

runExamples();

⚠️ Manejo de Errores
La librería lanza errores específicos que puedes capturar y manejar de forma programática. Todos los errores personalizados heredan de una clase base CustomError y tienen las siguientes propiedades:

message: Un mensaje descriptivo del error.

code: Un código de error único (ej. ERR_CONFIGURATION, ERR_IMAGE_PROCESSING, ERR_STORAGE).

originalError: Contiene el error subyacente (la causa raíz) si lo hay, útil para la depuración.

Clases de Error:

ConfigurationError: Indica problemas con la configuración inicial de la librería o las opciones pasadas al método processImage (ej., rutas inválidas, variables de entorno faltantes, opciones de tamaño incorrectas).

ImageProcessingError: Señala fallos durante la lectura, validación del tipo de archivo o cualquier manipulación de la imagen con sharp (ej., archivo no soportado, imagen corrupta, error al aplicar una transformación).

StorageError: Ocurre cuando hay problemas al guardar la imagen en el almacenamiento local o al subirla a AWS S3 (ej., permisos insuficientes, problemas de conexión, bucket no encontrado).

Ejemplo de cómo capturar y manejar los errores:

const ImageResizer = require('redimensionamiento-de-imagenes-ysl');
const { ConfigurationError, ImageProcessingError, StorageError } = require('redimensionamiento-de-imagenes-ysl');

async function processMyImageSafely(imageBuffer, filename, options) {
const resizer = new ImageResizer(); // O tu instancia ya creada
try {
const result = await resizer.processImage(imageBuffer, filename, options);
console.log("Imagen procesada con éxito:", result);
} catch (error) {
if (error instanceof ConfigurationError) {
console.error(`[ERROR DE CONFIGURACIÓN - ${error.code}]: ${error.message}`);
} else if (error instanceof ImageProcessingError) {
console.error(`[ERROR DE PROCESAMIENTO - ${error.code}]: ${error.message}`);
} else if (error instanceof StorageError) {
console.error(`[ERROR DE ALMACENAMIENTO - ${error.code}]: ${error.message}`);
} else {
console.error(`[ERROR DESCONOCIDO]: ${error.message}`);
}
if (error.originalError) {
console.error(" Causa subyacente:", error.originalError.message);
// console.error(" Stack de la causa:", error.originalError.stack);
}
// Puedes relanzar el error si necesitas que sea manejado por un nivel superior
throw error;
}
}

// Uso:
// processMyImageSafely(myImageBuffer, 'my-file.png', { outputFormat: 'webp' });

🤝 Contribución
¡Las contribuciones son bienvenidas! Si encuentras un error, tienes una idea para una mejora o quieres añadir una nueva característica, por favor, sigue estos pasos:

Haz un "fork" del repositorio.

Crea una nueva rama (git checkout -b feature/nueva-caracteristica o fix/correccion-de-bug).

Implementa tus cambios, asegurándote de seguir las convenciones de código.

Escribe pruebas unitarias y de integración para tus cambios.

Asegúrate de que todas las pruebas pasen (npm test).

Asegúrate de que el código pase el linter (si está configurado).

Crea un "pull request" detallado explicando tus cambios.

📄 Licencia
Este proyecto está bajo la Licencia ISC. Puedes encontrar el texto completo de la licencia en el archivo LICENSE en la raíz del repositorio.

ISC License

Copyright (c) [2025] [Jose Valles]

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

📧 Contacto
Para cualquier pregunta, sugerencia o colaboración, no dudes en contactar al creador:

Creador: Jose Valles
GitHub: https://github.com/vallesluiggi
website: https://yosoylu.com
Correo Electrónico: vallesluiggi@gmail.com
