# Redimensionamiento de Imágenes YSL

Una librería Node.js robusta y flexible para redimensionar y procesar imágenes, permitiendo su almacenamiento local o en buckets de AWS S3. Soporta múltiples formatos de imagen y ofrece un manejo de errores estructurado.

## Características

- **Redimensionamiento Flexible**: Ajusta imágenes a tamaños predefinidos (small, medium, large) con calidad configurable.
- **Múltiples Formatos de Salida**: Soporte para JPEG, PNG, WebP, TIFF, entre otros.
- **Opciones de Almacenamiento**:
  - **Local**: Guarda imágenes originales y redimensionadas en el servidor.
  - **AWS S3**: Sube imágenes originales y redimensionadas directamente a un bucket S3.
- **Manejo Robusto de Errores**: Clases de error personalizadas (`ConfigurationError`, `ImageProcessingError`, `StorageError`) para una depuración clara.
- **Optimización de I/O**: Cache de directorios creados para evitar operaciones redundantes de sistema de archivos.
- **Configuración por Variables de Entorno**: Fácil configuración de credenciales y rutas.

## Instalación

Puedes instalar esta librería directamente desde npm o desde un repositorio de GitHub:

````bash
npm install redimensionamiento-de-imagenes-ysl
# O desde GitHub:
# npm install your-github-username/redimensionamiento-de-imagenes-ysl
Uso
Configura tus variables de entorno: Crea un archivo .env en la raíz de tu proyecto basándote en .env.example.

Importa la librería:

JavaScript

require('dotenv').config(); // Carga tus variables de entorno

const ImageResizer = require('redimensionamiento-de-imagenes-ysl');
const fs = require('fs').promises; // Ejemplo para leer un archivo

async function procesarImagenDeEjemplo() {
    const imageResizer = new ImageResizer();

    try {
        // Lee el buffer de una imagen (ej. desde un formulario de carga)
        const imageBuffer = await fs.readFile('./path/to/your/image.jpg');
        const originalFilename = 'mi-foto.jpg';

        // Procesa la imagen
        const resultado = await imageResizer.processImage(imageBuffer, originalFilename, {
            outputFormat: 'webp', // Opcional: 'jpeg', 'png', 'tiff', etc.
            quality: 85           // Opcional: calidad de 0 a 100
        });

        console.log('Imagen procesada exitosamente:', resultado);

    } catch (error) {
        console.error('Error al procesar la imagen:');
        console.error(`Tipo: ${error.name}`);
        console.error(`Mensaje: ${error.message}`);
        if (error.originalError) {
            console.error(`Error Subyacente:`, error.originalError);
        }

        // Manejo específico de errores
        if (error instanceof ImageResizer.ConfigurationError) {
            console.error('Por favor, revisa tu configuración en el archivo .env.');
        } else if (error instanceof ImageResizer.ImageProcessingError) {
            console.error('La imagen no pudo ser procesada correctamente.');
        } else if (error instanceof ImageResizer.StorageError) {
            console.error('Hubo un problema al almacenar la imagen.');
        }
    }
}

procesarImagenDeEjemplo();
Configuración (.env)
Fragmento de código

# Configuración de Almacenamiento
# Habilitar o deshabilitar opciones de almacenamiento (true/false)
ENABLE_LOCAL_STORAGE=true
ENABLE_S3_STORAGE=false

# Variables para AWS S3 (si ENABLE_S3_STORAGE es true)
AWS_ACCESS_KEY_ID=tu_access_key_id
AWS_SECRET_ACCESS_KEY=tu_secret_access_key
AWS_REGION=tu_region_aws # Ejemplo: us-east-1
AWS_S3_BUCKET_NAME=tu_nombre_de_bucket_s3

# Variables para almacenamiento local (si ENABLE_LOCAL_STORAGE es true)
LOCAL_STORAGE_PATH=./uploads/images
Contribución
¡Las contribuciones son bienvenidas! Si tienes ideas para mejorar la librería, no dudes en abrir un issue o enviar un pull request.

Licencia
Este proyecto está bajo la Licencia MIT.

Autor
Jose Valles

Página Web: Yosoylu.com

Contacto: contacto@yosoylu.com


---

#### **`src/errors/ConfigurationError.js`**

```javascript
class ConfigurationError extends Error {
    constructor(message, originalError = null) {
        super(message);
        this.name = 'ConfigurationError';
        this.originalError = originalError;
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, ConfigurationError);
        }
    }
}

module.exports = ConfigurationError;
````
