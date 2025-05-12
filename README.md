# Buscador de Documentos PDF

Aplicación web para la gestión y búsqueda avanzada en documentos PDF.

## Características

1. **Subida de archivos PDF:** Permite subir archivos PDF de hasta 50MB a la base de datos MySQL en Clever Cloud.
2. **Búsqueda avanzada:** Búsqueda por texto en documentos completos o en páginas específicas.
3. **Visualización de documentos:** Tabla interactiva con DataTables para ver todos los documentos subidos.

## Requisitos

- Node.js >= 14.x
- MySQL (configurado en Clever Cloud)

## Instalación

1. Clonar el repositorio:
   ```
   git clone <url-del-repositorio>
   cd nombre-del-repositorio
   ```

2. Instalar dependencias:
   ```
   npm install
   ```

3. Crear archivo `.env` en la raíz del proyecto con el siguiente contenido:
   ```
   DB_HOST=tu-host-clever-cloud.mysql.clvrcld.net
   DB_USER=tu-usuario-clever-cloud
   DB_PASSWORD=tu-contraseña-clever-cloud
   DB_NAME=tu-base-de-datos-clever-cloud
   DB_PORT=3306
   PORT=3000
   ```

4. Crear las tablas en la base de datos:
   - Conectarse a la base de datos MySQL de Clever Cloud usando un cliente MySQL.
   - Ejecutar el script SQL ubicado en `config/schema.sql`.

5. Iniciar la aplicación:
   ```
   npm start
   ```

   Para desarrollo:
   ```
   npm run dev
   ```

6. Acceder a la aplicación en `http://localhost:3000`.

## Configuración de la base de datos en Clever Cloud

1. Crear una cuenta en [Clever Cloud](https://www.clever-cloud.com/).
2. Crear una base de datos MySQL.
3. Obtener las credenciales de conexión (host, usuario, contraseña, nombre de la base de datos).
4. Configurar estas credenciales en el archivo `.env`.

## Estructura del proyecto

- `index.js`: Archivo principal de la aplicación.
- `config/`: Configuraciones de la aplicación.
  - `database.js`: Configuración de conexión a la base de datos.
  - `schema.sql`: Script SQL para crear las tablas.
- `public/`: Archivos estáticos.
  - `css/`: Hojas de estilo.
  - `js/`: Scripts del lado del cliente.
- `views/`: Plantillas EJS.
- `uploads/`: Directorio donde se almacenan los archivos PDF subidos.

## Uso

1. **Subir un documento PDF**:
   - Selecciona un archivo PDF desde la sección "Subir Documento PDF".
   - Haz clic en "Subir Documento".

2. **Buscar en documentos**:
   - Introduce el texto a buscar en el campo de búsqueda.
   - Opcionalmente, selecciona un documento específico y/o número de página.
   - Haz clic en "Buscar".

3. **Ver documentos subidos**:
   - La tabla "Documentos Subidos" muestra todos los documentos disponibles.
   - Utiliza los botones de acción para buscar en un documento específico o eliminarlo.

## Licencia

Este proyecto está bajo la licencia MIT. 