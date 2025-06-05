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
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// No es necesario servir la carpeta 'uploads' localmente ya que los archivos estarán en Cellar
// app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Configurar EJS como motor de plantillas
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Rutas
app.get('/', async (req, res) => {
  try {
    // Obtenemos todos los documentos para pasarlos a la vista
    const [documentos] = await pool.execute('SELECT id, nombre, num_paginas, fecha_subida FROM documentos ORDER BY fecha_subida DESC');
    
    // Renderizamos la vista con los documentos
    res.render('index', { documentos });
  } catch (error) {
    console.error('Error al obtener documentos para la vista principal:', error);
    // En caso de error, enviamos una lista vacía para evitar problemas en la vista
    res.render('index', { documentos: [] });
  }
});

// Ruta para obtener una URL pre-firmada para subida directa a Cellar
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

// Subir PDF (ahora recibe solo metadatos y la clave S3 del cliente)
app.post('/upload', async (req, res) => {
  try {
    const { s3Key, originalname, numPaginas, contenidoCompleto, paginasContenido } = req.body;

    if (!s3Key || !originalname || !numPaginas || !contenidoCompleto) {
      return res.status(400).json({ error: 'Faltan datos de la subida (s3Key, originalname, numPaginas, contenidoCompleto)' });
    }

    const connection = await pool.getConnection(); // Obtener una conexión del pool para MySQL
    try {
      await connection.beginTransaction(); // Iniciar transacción para MySQL

      // Insertar documento con la URL de S3 y el contenido completo
      const [documentoResult] = await connection.execute(
        'INSERT INTO documentos (nombre, ruta_archivo, contenido, num_paginas) VALUES (?, ?, ?, ?)',
        [originalname, s3Key, contenidoCompleto, numPaginas]
      );

      const documentoId = documentoResult.insertId; // Obtener el ID del documento insertado para MySQL

      // Insertar contenido por página si se envía desde el cliente
      if (paginasContenido && Array.isArray(paginasContenido)) {
        for (let i = 0; i < paginasContenido.length; i++) {
          await connection.execute(
            'INSERT INTO paginas_documento (documento_id, numero_pagina, contenido) VALUES (?, ?, ?)',
            [documentoId, i + 1, paginasContenido[i]]
          );
        }
      }

      await connection.commit(); // Confirmar transacción
      res.json({
        success: true,
        message: 'Archivo subido y procesado correctamente',
        documentId: documentoId,
        fileName: originalname,
        s3Url: s3Key,
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
    // Usar pool.execute para MySQL
    const [rows] = await pool.execute('SELECT id, nombre, num_paginas, fecha_subida FROM documentos ORDER BY fecha_subida DESC');
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

    // Obtener la ruta del archivo de S3/Cellar antes de eliminar el registro de la DB
    const [rows] = await connection.execute(
      'SELECT ruta_archivo FROM documentos WHERE id = ?',
      [documentoId]
    );

    if (rows.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ error: 'Documento no encontrado' });
    }

    const s3KeyToDelete = rows[0].ruta_archivo;

    // Eliminar de la base de datos (ON DELETE CASCADE se encargará de paginas_documento)
    await connection.execute(
      'DELETE FROM documentos WHERE id = ?',
      [documentoId]
    );

    // Eliminar el archivo de S3/Cellar
    if (s3KeyToDelete) {
      const params = {
        Bucket: S3_BUCKET_NAME,
        Key: s3KeyToDelete
      };
      await s3.deleteObject(params).promise();
      console.log(`Archivo ${s3KeyToDelete} eliminado de S3/Cellar.`);
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

// Buscar por número de serie - Versión mejorada
app.get('/buscar/serial', async (req, res) => {
  const { serial, documentoId } = req.query;
  
  try {
    if (!serial || serial.trim() === '') {
      return res.status(400).json({ error: 'Se requiere un número de serie para realizar la búsqueda' });
    }
    
    const formattedSerial = serial.trim();
    
    console.log('Buscando número de serie:', formattedSerial);
    console.log('Documento ID:', documentoId || 'Todos los documentos');
    
    let sql, params;
    
    if (documentoId) {
      sql = `
        SELECT d.id, d.nombre, d.num_paginas, p.id as pagina_id, p.numero_pagina, p.contenido 
        FROM documentos d 
        JOIN paginas_documento p ON d.id = p.documento_id 
        WHERE d.id = ? AND (
          p.contenido LIKE ? OR 
          p.contenido LIKE ? OR 
          p.contenido LIKE ? OR
          p.contenido LIKE ?
        )
        ORDER BY p.numero_pagina ASC
      `;
      params = [
        documentoId,
        `%N⁰ ${formattedSerial}%`,
        `%N° ${formattedSerial}%`,
        `%Nº ${formattedSerial}%`,
        `%N.${formattedSerial}%`
      ];
    } else {
      sql = `
        SELECT d.id, d.nombre, d.num_paginas, p.id as pagina_id, p.numero_pagina, p.contenido 
        FROM documentos d 
        JOIN paginas_documento p ON d.id = p.documento_id 
        WHERE 
          p.contenido LIKE ? OR 
          p.contenido LIKE ? OR 
          p.contenido LIKE ? OR
          p.contenido LIKE ?
        ORDER BY d.id ASC, p.numero_pagina ASC
      `;
      params = [
        `%N⁰ ${formattedSerial}%`,
        `%N° ${formattedSerial}%`,
        `%Nº ${formattedSerial}%`,
        `%N.${formattedSerial}%`
      ];
    }
    
    const [rows] = await pool.execute(sql, params);
    
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Número de serie no encontrado en el documento o documentos especificados.' });
    }
    
    // Estructurar los resultados para la respuesta
    const resultados = rows.map(row => ({
      id: row.id,
      nombre: row.nombre,
      num_paginas: row.num_paginas,
      pagina_id: row.pagina_id,
      numero_pagina: row.numero_pagina,
      contenido_pagina: row.contenido // Contenido de la página donde se encontró
    }));

    res.json(resultados);
  } catch (error) {
    console.error('Error en la búsqueda por número de serie:', error);
    res.status(500).json({ error: 'Error al realizar la búsqueda' });
  }
});

// Buscar por número de página - Versión simplificada y mejorada
app.get('/buscar/pagina', async (req, res) => {
  const { documentoId, pagina } = req.query;
  
  try {
    if (!documentoId) {
      return res.status(400).json({ error: 'Se requiere un documento para ver una página específica' });
    }
    
    if (!pagina) {
      return res.status(400).json({ error: 'Se requiere especificar un número de página' });
    }
    
    // Asegurarnos que pagina sea un número entero
    const paginaNum = parseInt(pagina, 10);
    if (isNaN(paginaNum) || paginaNum <= 0) {
      return res.status(400).json({ error: 'El número de página debe ser un número positivo' });
    }
    
    console.log(`Buscando página ${paginaNum} del documento ${documentoId}`);
    
    // Obtener información del documento y la página en una consulta
    const result = await pool.execute(`
      SELECT 
        d.id, 
        d.nombre, 
        d.num_paginas, 
        p.id as pagina_id,
        p.numero_pagina, 
        p.contenido 
      FROM documentos d 
      LEFT JOIN paginas_documento p ON d.id = p.documento_id AND p.numero_pagina = ?
      WHERE d.id = ?
    `, [paginaNum, documentoId]);
    
    const resultados = result.rows;

    if (resultados.length === 0) {
      return res.status(404).json({ error: 'No se encontró el documento especificado' });
    }
    
    const documento = resultados[0];
    
    // Verificar si se encontró la página
    if (!documento.pagina_id) {
      return res.status(404).json({ 
        error: `La página ${paginaNum} no existe o no tiene contenido. El documento tiene ${documento.num_paginas} páginas` 
      });
    }
    
    // Retornar el resultado
    console.log(`Página ${paginaNum} encontrada para el documento ${documentoId}`);
    res.json(resultados);
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