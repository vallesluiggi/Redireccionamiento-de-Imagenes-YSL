# --- resized-imagen-ysl ✨ ---

Una potente y flexible librería de Node.js para el redimensionamiento, optimización y almacenamiento de imágenes. Diseñada para ofrecer un control granular sobre el procesamiento de imágenes, soporta almacenamiento local y subida a AWS S3, con gestión de caché inteligente y un robusto manejo de errores. Ideal para aplicaciones que requieren un procesamiento de imágenes eficiente y escalable.

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

### ✨ Características

Redimensionamiento Flexible: Define múltiples tamaños personalizados para tus imágenes (ej., thumbnail, mobile, desktopHD) o utiliza los predefinidos (small, medium, large).

Optimización de Formato: Soporte para JPEG, PNG, WebP, AVIF, TIFF. Incluye una opción para optimizar el formato de salida automáticamente (ej., convertir a WebP si detecta transparencia para mejor compresión).

## Almacenamiento Múltiple:

Local: Guarda las imágenes procesadas en un directorio especificado de tu sistema de archivos.

AWS S3: Sube las imágenes directamente a un bucket de S3 configurado.

Caché Inteligente: Almacena imágenes procesadas en caché (en disco) para evitar reprocesamientos innecesarios, reduciendo la carga de CPU y mejorando el rendimiento en solicitudes repetidas.

Transformaciones Avanzadas: Aplica una variedad de transformaciones de la librería sharp directamente, como rotaciones, volteos, escala de grises, tintes y operaciones de composición (superposición de imágenes).

Generación de Nombres de Archivo Personalizada: Ofrece una función callback para definir tu propia lógica de nombres de archivo, permitiendo incluir identificadores únicos por imagen para un fácil mapeo en bases de datos.

Generación de Metadatos: Obtiene y retorna metadatos clave (ancho, alto, formato, tamaño en bytes) de cada imagen procesada, tanto la original como las redimensionadas.

Logging Detallado: Utiliza winston para un registro estructurado y configurable de todas las operaciones, advertencias y errores, facilitando la depuración y el monitoreo.

Manejo de Errores Tipificado: Lanza errores personalizados para una depuración y manejo de excepciones más claros (ConfigurationError, ImageProcessingError, StorageError), incluyendo la causa raíz del problema.

Diseño Modular: Estructura de código limpia y modular para facilitar la mantenibilidad, extensibilidad y la colaboración.

Procesamiento Paralelo: Redimensionamiento de múltiples tamaños en paralelo para aprovechar al máximo los recursos del sistema y acelerar el procesamiento.

## 🚀 Instalación

Para instalar la librería en tu proyecto, asegúrate de tener Node.js (versión 16 o superior recomendada) y npm instalados.

```bash
npm install https://github.com/vallesluiggi/resized-imagen-ysl.git
```

## Para desarrollo local o pruebas (si la librería está en una carpeta hermana):

En el package.json de tu proyecto de prueba, puedes referenciar la librería localmente. Esto es útil para probar cambios sin necesidad de publicarlos en npm.

```bash
{
    "name": "mi-proyecto-test",
    "version": "1.0.0",
    "dependencies": {
        "images-resized": "file:../resized-imagen-ysl",
        "sharp": "^0.33.4",
        "file-type": "^19.0.0",
        "dotenv": "^16.4.5",
        "winston": "^3.13.0",
        "aws-sdk": "^2.1646.0"
    }
}
```

Luego, ejecuta npm install en la raíz de tu proyecto de prueba para instalar todas las dependencias, incluida tu librería local.

## ⚙️ Configuración

La librería se configura principalmente a través de variables de entorno definidas en un archivo .env y un objeto de configuración pasado al constructor de ImageResizer.

Variables de Entorno (.env)
Crea un archivo .env en la raíz de tu proyecto (donde ejecutas tu aplicación o script que usa la librería).

### --- Configuración de Almacenamiento Local ---

### Habilita o deshabilita el guardado local de imágenes (true/false).

```bash
ENABLE_LOCAL_STORAGE=true
```

### Ruta absoluta o relativa donde se guardarán las imágenes localmente.

### Ejemplo: ./output/images

```bash
LOCAL_STORAGE_PATH=./output/images
```

## --- Configuración de AWS S3 ---

### Habilita o deshabilita la subida de imágenes a AWS S3 (true/false).

```bash
ENABLE_S3_STORAGE=false
```

### Tus credenciales de AWS (requeridas si ENABLE_S3_STORAGE es 'true').

```bash
# AWS_ACCESS_KEY_ID=TU_ACCESS_KEY_ID_DE_AWS

# AWS_SECRET_ACCESS_KEY=TU_SECRET_ACCESS_KEY_DE_AWS

# La región de tu bucket S3 (ej: us-east-1, eu-west-1).

# AWS_REGION=tu-region-aws

# El nombre de tu bucket S3.

# AWS_S3_BUCKET_NAME=tu-nombre-de-bucket-s3
```

## --- Configuración de Caché ---

### Habilita o deshabilita el sistema de caché de imágenes procesadas (true/false).

```bash
ENABLE_IMAGE_CACHE=true

### Ruta donde se guardará el caché de imágenes en disco.

# Ejemplo: ./.image_cache

IMAGE_CACHE_PATH=./.image_cache
```

## --- Configuración de Logging ---

### Nivel de log para la consola y archivos.

#### Opciones: error, warn, info, http, verbose, debug, silly.

```bash
LOG_LEVEL=debug
```

## 💡 Uso

### Inicialización

Importa la clase ImageResizer y las clases de error para un manejo robusto de excepciones.

```bash
const ImageResizer = require('images-resized');
const { ConfigurationError, ImageProcessingError, StorageError } = require('images-resized');

// Opcional: Define tus propios tamaños de imagen.
// Si no se especifica 'customSizes', la librería usará un conjunto de tamaños por defecto.
const myCustomSizes = {
// Tamaños estándar
small: { width: 320, defaultQuality: 80 },
medium: { width: 640, defaultQuality: 85 },
large: { width: 1024, defaultQuality: 90 },

    // Tamaños adicionales para tu aplicación
    thumbnail: { width: 150, defaultQuality: 70 },
    mobile: { width: 480, defaultQuality: 75 },
    desktopHD: { width: 1920, defaultQuality: 92 },
    avatar: { width: 100, defaultQuality: 65, height: 100, fit: 'cover' } // Ejemplo de tamaño cuadrado

};

let resizer;
try {
// Pasa tus tamaños personalizados al constructor de ImageResizer.
resizer = new ImageResizer({
customSizes: myCustomSizes
});
console.log("ImageResizer inicializado con éxito.");
console.log("Tamaños configurados para esta instancia:", Object.keys(resizer.sizes));
} catch (error) {
if (error instanceof ConfigurationError) {
console.error(`\n❌ Error de configuración al inicializar ImageResizer (${error.code}): ${error.message}`);
} else {
console.error(`\n❌ Error inesperado durante la inicialización: ${error.message}`);
}
if (error.originalError) {
console.error(" Causa original:", error.originalError.message);
}
process.exit(1); // Es crítico salir si la inicialización falla
}

Tamaños por defecto (si no se usa customSizes):

const DEFAULT_SIZES = {
small: { width: 320, defaultQuality: 80 },
medium: { width: 640, defaultQuality: 85 },
large: { width: 1024, defaultQuality: 90 },
};
```

### Método processImage()

Este es el método principal para procesar tus imágenes. Acepta un buffer o un stream de imagen, el nombre original y un objeto de opciones para controlar el procesamiento y el almacenamiento.

/\*\*

- Procesa una imagen: la redimensiona, aplica transformaciones y la guarda.
-
- @param {Buffer | Readable} imageSource - El buffer de la imagen o un ReadableStream.
- @param {string} originalFilename - El nombre original del archivo (ej. "mi-imagen.jpg").
- @param {object} [options={}] - Opciones adicionales para el procesamiento.
- @param {string} [options.outputFormat] - El formato de salida deseado (ej. 'jpeg', 'png', 'webp', 'avif', 'tiff').
- Si no se especifica, se intenta optimizar o se usa el formato original/JPEG por defecto.
- @param {number} [options.quality] - La calidad de la imagen de salida (0-100).
- Si no se especifica, usa la calidad por defecto definida para cada tamaño.
- @param {boolean} [options.optimizeOutputFormat=false] - Si es `true`, la librería intentará elegir el mejor formato
- de salida basado en las propiedades de la imagen de entrada (ej. `webp` si detecta transparencia para mejor compresión).
- @param {string[]} [options.processSizes] - Un array de strings con las claves de los tamaños a procesar
- (ej. `['small', 'medium']`). Si se omite, se procesarán TODOS los tamaños configurados en la inicialización.
- @param {function(object): string} [options.filenameGenerator] - Una función `callback` para generar nombres de archivo personalizados.
- Recibe un objeto con propiedades:
- `{ originalFilename, baseName, extension, sizeKey, outputFormat, isOriginal, uniqueImageId }`.
- El `uniqueImageId` es un identificador generado por la librería para esta sesión de procesamiento,
- asegurando que todas las variantes de una misma imagen compartan el mismo ID base.
- Debe devolver el nombre de archivo completo (ej. "imagen-unique-id.webp").
- @param {object} [options.transformations] - Un objeto con opciones de transformación adicionales para `sharp`.
- Las claves corresponden a métodos de `sharp` (ej. `rotate`, `flip`, `grayscale`, `tint`).
- También soporta `composite` para superponer imágenes.
- Ej: `{ rotate: 90, grayscale: true, composite: [{ input: watermarkBuffer, gravity: 'southeast' }] }`.
- @returns {Promise<object>} Un objeto con los resultados del procesamiento:
- `{ metadata: { original: {}, resized: {} }, local: {}, s3: {} }`.
- Contiene metadatos (width, height, format, size, filename) y URLs/rutas de las imágenes guardadas.
- @throws {ConfigurationError} Si hay un problema con la configuración o las opciones de entrada.
- @throws {ImageProcessingError} Si hay un problema durante el procesamiento de la imagen (ej. formato inválido, corrupción).
- @throws {StorageError} Si hay un problema durante el almacenamiento de la imagen (local o S3).
  \*/

### Ejemplos de Uso

const fs = require('fs').promises;
const path = require('path');
const ImageResizer = require('images-resized');
const { ConfigurationError, ImageProcessingError, StorageError } = require('images-resized');

async function runExamples() {
// --- 1. Preparación de la imagen de entrada ---
// Asegúrate de que 'example.jpg' exista en la carpeta 'images-input'
const imagePath = path.join(\_\_dirname, 'images-input', 'example.jpg');
const originalFilename = 'example.jpg';

    // --- 2. Inicialización de la librería ImageResizer ---
    // (Asume que ya has inicializado 'resizer' como se mostró en la sección anterior)
    const myCustomSizes = {
        small: { width: 320, defaultQuality: 80 },
        medium: { width: 640, defaultQuality: 85 },
        large: { width: 1024, defaultQuality: 90 },
        thumbnail: { width: 150, defaultQuality: 70 },
        mobile: { width: 480, defaultQuality: 75 },
        desktopHD: { width: 1920, defaultQuality: 92 },
        avatar: { width: 100, defaultQuality: 65, height: 100, fit: 'cover' }
    };
    const resizer = new ImageResizer({ customSizes: myCustomSizes });

    try {
        const imageBuffer = await fs.readFile(imagePath);

        // --- Ejemplo 1: Redimensionar con configuraciones por defecto (todos los tamaños) ---
        console.log("\n--- Ejemplo 1: Procesando imagen con configuraciones por defecto (todos los tamaños) ---");
        // Al no especificar 'processSizes', se procesarán todos los tamaños definidos en 'myCustomSizes'.
        let resultsDefault = await resizer.processImage(imageBuffer, originalFilename, {
            outputFormat: 'webp', // Forzar salida a WebP para todos los tamaños
            quality: 80 // Calidad general para todos los tamaños
        });
        console.log("Resultados (todos los tamaños, WebP):", JSON.stringify(resultsDefault, null, 2));

        // --- Ejemplo 2: Redimensionar con tamaños específicos y formato optimizado ---
        console.log("\n--- Ejemplo 2: Procesando imagen con tamaños específicos y formato optimizado ---");
        let resultsOptimized = await resizer.processImage(imageBuffer, originalFilename, {
            processSizes: ['thumbnail', 'mobile', 'large'], // Procesar solo estos tamaños
            optimizeOutputFormat: true,                     // La librería elegirá el mejor formato
            quality: 85
        });
        console.log("Resultados (tamaños específicos, optimizado):", JSON.stringify(resultsOptimized, null, 2));

        // --- Ejemplo 3: Redimensionar con un generador de nombre de archivo personalizado ---
        console.log("\n--- Ejemplo 3: Procesando imagen con nombre de archivo personalizado ---");
        // Este generador de nombres usará el 'uniqueImageId' proporcionado por la librería
        const myCustomFilenameGenerator = ({ baseName, sizeKey, extension, isOriginal, uniqueImageId }) => {
            if (isOriginal) {
                return `original-uploads/${baseName}-${uniqueImageId}.original.${extension}`;
            }
            return `processed-images/${sizeKey}/${baseName}-${uniqueImageId}.${sizeKey}.${extension}`;
        };

        let resultsCustomName = await resizer.processImage(imageBuffer, originalFilename, {
            processSizes: ['avatar', 'small'], // Procesar solo estos tamaños
            filenameGenerator: myCustomFilenameGenerator,
            outputFormat: 'jpeg'
        });
        console.log("Resultados (nombre personalizado):", JSON.stringify(resultsCustomName, null, 2));

        // --- Ejemplo 4: Aplicar transformaciones (rotar y escala de grises) ---
        console.log("\n--- Ejemplo 4: Procesando imagen con transformaciones ---");
        let resultsTransformed = await resizer.processImage(imageBuffer, originalFilename, {
            outputFormat: 'png',
            processSizes: ['medium'],
            transformations: {
                rotate: 180,       // Rotar 180 grados
                grayscale: true,  // Convertir a escala de grises
                flip: true        // Voltear horizontalmente
            }
        });
        console.log("Resultados (transformaciones):", JSON.stringify(resultsTransformed, null, 2));

    } catch (error) {
        // --- Manejo de Errores durante el procesamiento ---
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
        }
    } finally {
        console.log("\n--- Proceso de prueba finalizado ---");
    }

}

runExamples();

### ⚠️ Manejo de Errores

La librería lanza errores específicos que puedes capturar y manejar de forma programática para una depuración y control de flujo efectivos. Todos los errores personalizados heredan de una clase base CustomError y tienen las siguientes propiedades:

message: Un mensaje descriptivo del error.

```bash
code: Un código de error único (ej. ERR_CONFIGURATION, ERR_IMAGE_PROCESSING, ERR_STORAGE).
```

originalError: Contiene el error subyacente (la causa raíz) si lo hay, útil para la depuración.

### Clases de Error:

ConfigurationError: Indica problemas con la configuración inicial de la librería o las opciones pasadas al método processImage (ej., rutas inválidas, variables de entorno faltantes, opciones de tamaño incorrectas).

ImageProcessingError: Señala fallos durante la lectura, validación del tipo de archivo o cualquier manipulación de la imagen con sharp (ej., archivo no soportado, imagen corrupta, error al aplicar una transformación).

StorageError: Ocurre cuando hay problemas al guardar la imagen en el almacenamiento local o al subirla a AWS S3 (ej., permisos insuficientes, problemas de conexión, bucket no encontrado).

### Ejemplo de cómo capturar y manejar los errores:

```bash
const ImageResizer = require('images-resized');
const { ConfigurationError, ImageProcessingError, StorageError } = require('images-resized');

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
}
// Puedes relanzar el error si necesitas que sea manejado por un nivel superior
throw error;
}
}
```

### 🤝 Contribución

¡Las contribuciones son bienvenidas! Si encuentras un error, tienes una idea para una mejora o quieres añadir una nueva característica, por favor, sigue estos pasos:

Haz un "fork" del repositorio.

Crea una nueva rama (git checkout -b feature/nueva-caracteristica o fix/correccion-de-bug).

Implementa tus cambios, asegurándote de seguir las convenciones de código.

Escribe pruebas unitarias y de integración para tus cambios.

Asegúrate de que todas las pruebas pasen (npm test).

Asegúrate de que el código pase el linter (si está configurado).

Crea un "pull request" detallado explicando tus cambios.

### 📄 Licencia

Este proyecto está bajo la Licencia MIT.

¿Por qué la Licencia MIT?
La Licencia MIT es una licencia de software de código abierto muy permisiva. Es ideal para tu caso de uso (librería para uso interno y para tus clientes) porque permite a otros (incluidos tus clientes) usar, copiar, modificar, fusionar, publicar, distribuir, sublicenciar y/o vender copias del software con muy pocas restricciones. La única condición principal es que se incluya el aviso de derechos de autor y el aviso de permiso en todas las copias o partes sustanciales del software. Esto te da flexibilidad y a tus clientes libertad para usar la librería sin complicaciones legales complejas.

Puedes encontrar el texto completo de la licencia en el archivo LICENSE en la raíz del repositorio.

### MIT License

Copyright (c) [2025] [Jose Valles]

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### 📧 Contacto

Para cualquier pregunta, sugerencia, colaboración o soporte, no dudes en contactar al creador:

Creador: Jose Valles
GitHub: [https://github.com/vallesluiggi](https://github.com/vallesluiggi)
Website: [https://yosoylu.com](https://yosoylu.com)
Correo Electrónico: [https://yosoylu.com](mailto:vallesluiggi@gmail.com)
WhatsApp: [+57 302 805 4676](https://api.whatsapp.com/send?phone=573028054676)
