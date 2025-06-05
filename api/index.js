const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const pdfParse = require('pdf-parse');
const pool = require('../config/database');
const { s3, S3_BUCKET_NAME } = require('../config/s3');

// Este comentario es para forzar un nuevo despliegue en Vercel

// Configurar Express
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// No es necesario servir la carpeta 'uploads' localmente ya que los archivos estarán en Cellar
// app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Configurar EJS como motor de plantillas
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Rutas
app.get('/', async (req, res) => {
  try {
    // Obtenemos todos los documentos para pasarlos a la vista, incluyendo ruta_archivo
    const [documentos] = await pool.execute('SELECT id, nombre, num_paginas, fecha_subida, ruta_archivo FROM documentos ORDER BY fecha_subida DESC');
    
    // Renderizamos la vista con los documentos
    res.render('index', { documentos });
  } catch (error) {
    console.error('Error al obtener documentos para la vista principal:', error);
    // En caso de error, enviamos una lista vacía para evitar problemas en la vista
    res.render('index', { documentos: [] });
  }
});

// Ruta para obtener una URL pre-firmada para subida directa de PDF a Cellar
app.get('/s3-signed-url', async (req, res) => {
  const fileName = req.query.fileName;
  const fileType = req.query.fileType;

  if (!fileName || !fileType) {
    return res.status(400).json({ error: 'Faltan parámetros: fileName o fileType' });
  }

  const s3Params = {
    Bucket: S3_BUCKET_NAME,
    Key: `pdfs/${Date.now()}-${fileName}`,
    Expires: 300, // La URL expira en 300 segundos (5 minutos)
    ContentType: fileType,
    ACL: 'public-read' // O private, si controlas el acceso a través de tu aplicación
  };

  try {
    const uploadURL = await s3.getSignedUrlPromise('putObject', s3Params);
    res.json({ uploadURL: uploadURL, s3Key: s3Params.Key });
  } catch (error) {
    console.error('Error al obtener URL pre-firmada de S3/Cellar:', error);
    res.status(500).json({ error: 'Error al obtener la URL de subida de S3/Cellar' });
  }
});

// Nueva ruta para obtener una URL pre-firmada para subida directa de TEXTO JSON a Cellar
app.get('/s3-signed-text-url', async (req, res) => {
  const originalName = req.query.originalName;
  if (!originalName) {
    return res.status(400).json({ error: 'Falta el parámetro originalName' });
  }

  const s3Params = {
    Bucket: S3_BUCKET_NAME,
    Key: `text/${Date.now()}-${originalName.replace(/\.pdf$/i, '.json')}`,
    Expires: 300, // La URL expira en 300 segundos (5 minutos)
    ContentType: 'application/json',
    ACL: 'public-read' // O private
  };

  try {
    const uploadURL = await s3.getSignedUrlPromise('putObject', s3Params);
    res.json({ uploadURL: uploadURL, s3TextKey: s3Params.Key });
  } catch (error) {
    console.error('Error al obtener URL pre-firmada para texto S3/Cellar:', error);
    res.status(500).json({ error: 'Error al obtener la URL de subida de texto a S3/Cellar' });
  }
});

// Subir PDF (ahora recibe solo metadatos y las claves S3 del PDF y del TEXTO del cliente)
app.post('/upload', async (req, res) => {
  try {
    // Ahora esperamos s3Key (para el PDF) y s3TextKey (para el JSON de texto)
    const { s3Key, originalname, numPaginas, s3TextKey } = req.body;

    if (!s3Key || !originalname || !numPaginas || !s3TextKey) {
      return res.status(400).json({ error: 'Faltan datos de la subida (s3Key, originalname, numPaginas, s3TextKey)' });
    }

    const connection = await pool.getConnection(); // Obtener una conexión del pool para MySQL
    try {
      await connection.beginTransaction(); // Iniciar transacción para MySQL

      // Insertar documento con la URL de S3 del PDF y la clave S3 del texto
      // La columna 'contenido' ahora guardará la clave S3 del archivo JSON de texto
      const [documentoResult] = await connection.execute(
        'INSERT INTO documentos (nombre, ruta_archivo, contenido, num_paginas) VALUES (?, ?, ?, ?)',
        [originalname, s3Key, s3TextKey, numPaginas] // 'contenido' ahora es s3TextKey
      );

      const documentoId = documentoResult.insertId; // Obtener el ID del documento insertado para MySQL

      // No necesitamos insertar paginas_documento aquí si el frontend envía todo el texto
      // El frontend se encargará de subir el JSON de texto a Cellar y nosotros solo guardamos la s3TextKey

      await connection.commit(); // Confirmar transacción
      res.json({
        success: true,
        message: 'Archivo subido y procesado correctamente',
        documentId: documentoId,
        fileName: originalname,
        s3Url: s3Key,
        s3TextUrl: s3TextKey, // Devolvemos también la clave del texto
        pages: numPaginas
      });
    } catch (error) {
      await connection.rollback(); // Revertir transacción en caso de error
      console.error('Error al guardar en la base de datos:', error);
      res.status(500).json({ error: 'Error al procesar el archivo o guardar en la base de datos' });
    } finally {
      connection.release(); // Liberar la conexión al pool
    }
  } catch (error) {
    console.error('Error general en la subida:', error);
    res.status(500).json({ error: 'Error al procesar la subida de metadatos' });
  }
});

// Obtener todos los documentos
app.get('/documentos', async (req, res) => {
  try {
    // Usar pool.execute para MySQL, incluyendo ruta_archivo y contenido (que ahora es s3TextKey)
    const [rows] = await pool.execute('SELECT id, nombre, num_paginas, fecha_subida, ruta_archivo, contenido as s3TextKey FROM documentos ORDER BY fecha_subida DESC');
    res.json(rows);
  } catch (error) {
    console.error('Error al obtener documentos:', error);
    // En caso de error, devolver un array vacío para evitar TypeError en el frontend
    res.status(500).json([]); // Devolver un array vacío para que el frontend no falle con .forEach
  }
});

// Eliminar documento (modificado para MySQL y S3/Cellar)
app.delete('/documentos/:id', async (req, res) => {
  const documentoId = req.params.id;
  
  let connection; // Declarar connection fuera del try para que sea accesible en finally
  try {
    connection = await pool.getConnection(); // Obtener una conexión del pool para MySQL
    await connection.beginTransaction();

    // Obtener la ruta del archivo de S3/Cellar y la clave del texto antes de eliminar el registro de la DB
    const [rows] = await connection.execute(
      'SELECT ruta_archivo, contenido as s3TextKey FROM documentos WHERE id = ?',
      [documentoId]
    );

    if (rows.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ error: 'Documento no encontrado' });
    }

    const s3KeyToDelete = rows[0].ruta_archivo;
    const s3TextKeyToDelete = rows[0].s3TextKey;

    // Eliminar de la base de datos (ON DELETE CASCADE se encargará de paginas_documento)
    await connection.execute(
      'DELETE FROM documentos WHERE id = ?',
      [documentoId]
    );

    // Eliminar el archivo PDF de S3/Cellar
    if (s3KeyToDelete) {
      const params = {
        Bucket: S3_BUCKET_NAME,
        Key: s3KeyToDelete
      };
      await s3.deleteObject(params).promise();
      console.log(`Archivo PDF ${s3KeyToDelete} eliminado de S3/Cellar.`);
    }

    // Eliminar el archivo de texto JSON de S3/Cellar
    if (s3TextKeyToDelete) {
      const params = {
        Bucket: S3_BUCKET_NAME,
        Key: s3TextKeyToDelete
      };
      await s3.deleteObject(params).promise();
      console.log(`Archivo de texto ${s3TextKeyToDelete} eliminado de S3/Cellar.`);
    }

    await connection.commit();
    res.json({ success: true, message: 'Documento eliminado correctamente' });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    console.error('Error al eliminar documento:', error);
    res.status(500).json({ error: 'Error al eliminar el documento' });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// Función para descargar contenido de texto de Cellar
async function downloadTextFromS3(s3TextKey) {
  const params = {
    Bucket: S3_BUCKET_NAME,
    Key: s3TextKey,
  };
  try {
    const data = await s3.getObject(params).promise();
    return JSON.parse(data.Body.toString('utf-8')); // Parsear como JSON
  } catch (error) {
    console.error(`Error al descargar texto de S3/Cellar para ${s3TextKey}:`, error);
    throw new Error('Error al descargar el contenido del texto del documento.');
  }
}

// Buscar por número de serie - Versión mejorada para leer de Cellar
app.get('/buscar/serial', async (req, res) => {
  const { serial, documentoId } = req.query;
  
  try {
    if (!serial || serial.trim() === '') {
      return res.status(400).json({ error: 'Se requiere un número de serie para realizar la búsqueda' });
    }
    
    const formattedSerial = serial.trim();
    
    let sql, params;
    let documentosConTexto = [];

    // Primero, obtener documentos relevantes para descargar su texto
    if (documentoId) {
      sql = 'SELECT id, nombre, num_paginas, ruta_archivo, contenido as s3TextKey FROM documentos WHERE id = ?';
      params = [documentoId];
    } else {
      sql = 'SELECT id, nombre, num_paginas, ruta_archivo, contenido as s3TextKey FROM documentos';
      params = [];
    }

    const [docs] = await pool.execute(sql, params);
    
    // Descargar el contenido de texto de cada documento desde Cellar y buscar
    for (const doc of docs) {
      if (doc.s3TextKey) {
        try {
          const textData = await downloadTextFromS3(doc.s3TextKey);
          // Asegurarse de que textData.paginasContenido es un array
          if (textData && Array.isArray(textData.paginasContenido)) {
            for (let i = 0; i < textData.paginasContenido.length; i++) {
              const paginaContenido = textData.paginasContenido[i];
              // Realizar la búsqueda en el contenido de la página
              const patterns = [
                `%N⁰ ${formattedSerial}%`,
                `%N° ${formattedSerial}%`,
                `%Nº ${formattedSerial}%`,
                `%N.${formattedSerial}%`,
                `%${formattedSerial}%` // Búsqueda genérica también
              ];
              
              let found = false;
              for (const pattern of patterns) {
                if (paginaContenido.includes(pattern.replace(/%/g, ''))) { // Simplificado para `includes` en JS
                  found = true;
                  break;
                }
              }

              if (found) {
                documentosConTexto.push({
                  id: doc.id,
                  nombre: doc.nombre,
                  num_paginas: doc.num_paginas,
                  pagina_id: i + 1, // Simula el ID de la página
                  numero_pagina: i + 1,
                  contenido_pagina: paginaContenido.substring(0, 500) + '...' // Devolver un snippet
                });
              }
            }
          }
        } catch (downloadError) {
          console.warn(`No se pudo descargar o procesar texto para el documento ${doc.id}:`, downloadError.message);
          // Continuar con otros documentos
        }
      }
    }

    if (documentosConTexto.length === 0) {
      return res.status(404).json({ message: 'Número de serie no encontrado en el documento o documentos especificados.' });
    }
    
    res.json(documentosConTexto);

  } catch (error) {
    console.error('Error en la búsqueda por número de serie:', error);
    res.status(500).json({ error: 'Error al realizar la búsqueda' });
  }
});

// Buscar por número de página - Versión mejorada para leer de Cellar
app.get('/buscar/pagina', async (req, res) => {
  const { documentoId, pagina } = req.query;
  
  try {
    if (!documentoId) {
      return res.status(400).json({ error: 'Se requiere un documento para ver una página específica' });
    }
    
    if (!pagina) {
      return res.status(400).json({ error: 'Se requiere especificar un número de página' });
    }
    
    const paginaNum = parseInt(pagina, 10);
    if (isNaN(paginaNum) || paginaNum <= 0) {
      return res.status(400).json({ error: 'El número de página debe ser un número positivo' });
    }
    
    // Obtener la clave S3 del texto del documento
    const [docRows] = await pool.execute('SELECT ruta_archivo, contenido as s3TextKey FROM documentos WHERE id = ?', [documentoId]);
    
    if (docRows.length === 0) {
      return res.status(404).json({ error: 'Documento no encontrado' });
    }
    
    const documento = docRows[0];

    if (!documento.s3TextKey) {
      return res.status(500).json({ error: 'No se encontró la clave del texto del documento en Cellar.' });
    }

    // Descargar el contenido de texto completo del documento desde Cellar
    const textData = await downloadTextFromS3(documento.s3TextKey);
    
    if (!textData || !Array.isArray(textData.paginasContenido) || paginaNum > textData.paginasContenido.length) {
      return res.status(404).json({ 
        error: `La página ${paginaNum} no existe o no tiene contenido. El documento tiene ${textData ? textData.paginasContenido.length : 0} páginas` 
      });
    }
    
    const contenidoPagina = textData.paginasContenido[paginaNum - 1]; // Array es 0-indexed

    res.json({
      id: documento.id,
      nombre: documento.nombre,
      num_paginas: documento.num_paginas,
      numero_pagina: paginaNum,
      contenido_pagina: contenidoPagina
    });
  } catch (error) {
    console.error('Error en la búsqueda por número de página:', error);
    res.status(500).json({ error: 'Error al realizar la búsqueda por número de página' });
  }
});

// Ruta para buscar por texto - simplemente redirigir a otra búsqueda
app.get('/buscar', async (req, res) => {
  const { documentoId, pagina } = req.query;
  
  // Redirigir a la búsqueda por página si ambos parámetros están presentes
  if (documentoId && pagina) {
    return res.redirect(`/buscar/pagina?documentoId=${documentoId}&pagina=${pagina}`);
  }
  
  // De lo contrario, devolver un mensaje indicando que use las otras opciones de búsqueda
  res.status(400).json({ 
    error: 'La búsqueda por texto está deshabilitada. Por favor, use la búsqueda por número de serie o por página.' 
  });
});

// Vista de resultados en página separada
app.get('/resultados', (req, res) => {
  res.render('resultados', { 
    query: req.query.q || '',
    tipo: req.query.tipo || 'text',
    documentoId: req.query.doc || '',
    pagina: req.query.page || ''
  });
});

// Ruta para ver un PDF - Ahora obtiene la URL de Cellar de la DB y redirige/sirve directamente
app.get('/ver-pdf/:id', async (req, res) => {
  const documentoId = req.params.id;

  try {
    const [rows] = await pool.execute('SELECT ruta_archivo, nombre FROM documentos WHERE id = ?', [documentoId]);

    if (rows.length === 0) {
      return res.status(404).send('Documento no encontrado.');
    }

    const { ruta_archivo, nombre } = rows[0];

    if (!ruta_archivo) {
      return res.status(500).send('La ruta del archivo PDF no está disponible.');
    }

    // Redirigir al cliente directamente a la URL de Cellar
    res.redirect(ruta_archivo);

  } catch (error) {
    console.error('Error al obtener el PDF de la base de datos o Cellar:', error);
    res.status(500).send('Error al cargar el PDF.');
  }
});

// Ruta para ver páginas específicas del PDF (si se almacena contenido por página)
// Este endpoint se mantiene para la lógica de búsqueda, pero no para servir el PDF completo
app.get('/ver-pdf-directo/:documentoId/:pagina', async (req, res) => {
  const { documentoId, pagina } = req.params;

  try {
    const [rows] = await pool.execute(
      'SELECT d.ruta_archivo, p.contenido FROM documentos d JOIN paginas_documento p ON d.id = p.documento_id WHERE d.id = ? AND p.numero_pagina = ?',
      [documentoId, pagina]
    );

    if (rows.length === 0) {
      return res.status(404).send('Página no encontrada o documento no existe.');
    }
    
    const { ruta_archivo, contenido } = rows[0];

    // Puedes elegir cómo usar esto:
    // 1. Devolver solo el contenido de texto de la página:
    // res.send(contenido);
    
    // 2. O redirigir al PDF completo en Cellar y depender del visor para ir a la página
    res.redirect(ruta_archivo); // Redirigir al PDF completo

  } catch (error) {
    console.error('Error al obtener la página del PDF o Cellar:', error);
    res.status(500).send('Error al cargar la página del PDF.');
  }
});

// Manejo de errores 404
app.use((req, res, next) => {
  res.status(404).send('Lo siento, no puedo encontrar eso!');
});

// Exportar la aplicación Express para Vercel Serverless Functions
module.exports = app; 