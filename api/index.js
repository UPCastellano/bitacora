const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const pdfParse = require('pdf-parse');
const pool = require('../config/database');

// Este comentario es para forzar un nuevo despliegue en Vercel

// Configurar Express
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// No es necesario servir la carpeta 'uploads' localmente ya que los archivos estarán en la base de datos
// app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Configurar EJS como motor de plantillas
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Configurar almacenamiento para archivos PDF (usar memoryStorage para guardar en DB)
const upload = multer({
  storage: multer.memoryStorage(), // Almacenar en memoria temporalmente para leer el buffer
  fileFilter: function (req, file, cb) {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Solo se permiten archivos PDF'));
    }
    cb(null, true);
  },
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB límite, ajusta si es necesario
  }
});

// Rutas
app.get('/', async (req, res) => {
  try {
    // Obtenemos todos los documentos para pasarlos a la vista
    const [documentos] = await pool.query('SELECT id, nombre, num_paginas, fecha_subida FROM documentos ORDER BY fecha_subida DESC');
    
    // Renderizamos la vista con los documentos
    res.render('index', { documentos });
  } catch (error) {
    console.error('Error al obtener documentos para la vista principal:', error);
    // En caso de error, enviamos una lista vacía para evitar problemas en la vista
    res.render('index', { documentos: [] });
  }
});

// Ruta para obtener una URL pre-firmada para subida directa a S3 (¡Esta ruta ya no se usa y se eliminará!)
// app.get('/s3-signed-url', async (req, res) => {
//   const fileName = req.query.fileName;
//   const fileType = req.query.fileType;

//   if (!fileName || !fileType) {
//     return res.status(400).json({ error: 'Faltan parámetros: fileName o fileType' });
//   }

//   const s3Params = {
//     Bucket: S3_BUCKET_NAME,
//     Key: `pdfs/${Date.now()}-${fileName}`,
//     Expires: 60, // La URL expira en 60 segundos
//     ContentType: fileType,
//     ACL: 'public-read'
//   };

//   try {
//     const uploadURL = await s3.getSignedUrlPromise('putObject', s3Params);
//     res.json({ uploadURL: uploadURL, s3Key: s3Params.Key });
//   } catch (error) {
//     console.error('Error al obtener URL pre-firmada de S3:', error);
//     res.status(500).json({ error: 'Error al obtener la URL de subida de S3' });
//   }
// });

// Subir PDF (modificado para guardar directamente en PostgreSQL)
app.post('/upload', upload.single('pdfFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se ha subido ningún archivo' });
    }

    const fileBuffer = req.file.buffer; // Contenido binario del PDF
    const originalname = req.file.originalname;
    
    // Extraer texto del PDF desde el buffer en memoria
    const pdfData = await pdfParse(fileBuffer);
    const numPaginas = pdfData.numpages;
    const contenidoCompleto = pdfData.text;
    
    // Guardar en la base de datos
    const connection = await pool.connect(); // Usar pool.connect() para pg
    try {
      await connection.query('BEGIN'); // Iniciar transacción
      
      // Insertar documento con el contenido binario del PDF
      const documentoResult = await connection.query(
        'INSERT INTO documentos (nombre, contenido_pdf, contenido, num_paginas) VALUES ($1, $2, $3, $4) RETURNING id',
        [originalname, fileBuffer, contenidoCompleto, numPaginas]
      );
      
      const documentoId = documentoResult.rows[0].id; // Obtener el ID del documento insertado
      
      // Extraer y guardar contenido por página
      for (let i = 1; i <= numPaginas; i++) {
        const options = {
          max: i,
          min: i
        };
        
        const pageData = await pdfParse(fileBuffer, options);
        
        await connection.query(
          'INSERT INTO paginas_documento (documento_id, numero_pagina, contenido) VALUES ($1, $2, $3)',
          [documentoId, i, pageData.text]
        );
      }
      
      await connection.query('COMMIT'); // Confirmar transacción
      res.json({ 
        success: true, 
        message: 'Archivo subido y procesado correctamente',
        documentId: documentoId,
        fileName: originalname,
        pages: numPaginas
      });
    } catch (error) {
      await connection.query('ROLLBACK'); // Revertir transacción en caso de error
      console.error('Error al guardar en la base de datos:', error);
      res.status(500).json({ error: 'Error al procesar el archivo o guardar en la base de datos' });
    } finally {
      connection.release(); // Liberar la conexión al pool
    }
  } catch (error) {
    console.error('Error general en la subida:', error);
    res.status(500).json({ error: 'Error al procesar el archivo PDF' });
  }
});

// Obtener todos los documentos
app.get('/documentos', async (req, res) => {
  try {
    // Usar pool.query para PostgreSQL
    const result = await pool.query('SELECT id, nombre, num_paginas, fecha_subida FROM documentos ORDER BY fecha_subida DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener documentos:', error);
    // En caso de error, devolver un array vacío para evitar TypeError en el frontend
    res.status(500).json([]); // Devolver un array vacío para que el frontend no falle con .forEach
  }
});

// Eliminar documento (modificado para PostgreSQL y sin S3)
app.delete('/documentos/:id', async (req, res) => {
  const documentoId = req.params.id;
  
  try {
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      
      // No necesitamos obtener la ruta del archivo, el PDF está en la DB y se elimina con el registro.
      // La restricción ON DELETE CASCADE en paginas_documento se encargará de las páginas.
      await connection.query(
        'DELETE FROM documentos WHERE id = $1',
        [documentoId]
      );
      
      await connection.query('COMMIT');
      res.json({ success: true, message: 'Documento eliminado correctamente' });
    } catch (error) {
      await connection.query('ROLLBACK');
      console.error('Error al eliminar documento:', error);
      res.status(500).json({ error: 'Error al eliminar el documento' });
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error al conectar con la base de datos:', error);
    res.status(500).json({ error: 'Error de conexión con la base de datos' });
  }
});

// Buscar por número de serie - Versión mejorada con detección para documentos escaneados
app.get('/buscar/serial', async (req, res) => {
  const { serial, documentoId } = req.query;
  
  try {
    if (!serial || serial.trim() === '') {
      return res.status(400).json({ error: 'Se requiere un número de serie para realizar la búsqueda' });
    }
    
    // Formatear el número de serie para la búsqueda
    const formattedSerial = serial.trim();
    
    console.log('Buscando número de serie:', formattedSerial);
    console.log('Documento ID:', documentoId || 'Todos los documentos');
    
    let sql, params;
    
    // Búsqueda más específica y precisa - reducimos el uso de patrones muy genéricos
    if (documentoId) {
      // Búsqueda en documento específico con patrones más precisos
      sql = `
        SELECT d.id, d.nombre, d.num_paginas, p.id as pagina_id, p.numero_pagina, p.contenido 
        FROM documentos d 
        JOIN paginas_documento p ON d.id = p.documento_id 
        WHERE d.id = $1 AND (
          p.contenido ILIKE $2 OR 
          p.contenido ILIKE $3 OR 
          p.contenido ILIKE $4 OR
          p.contenido ILIKE $5
        )
        ORDER BY p.numero_pagina ASC
      `;
      // Patrones específicos para el número de serie con formato exacto
      params = [
        documentoId, 
        `%N⁰ ${formattedSerial}%`, 
        `%N° ${formattedSerial}%`,
        `%Nº ${formattedSerial}%`,
        `%N.${formattedSerial}%`
      ];
    } else {
      // Búsqueda en todos los documentos
      sql = `
        SELECT d.id, d.nombre, d.num_paginas, p.id as pagina_id, p.numero_pagina, p.contenido 
        FROM documentos d 
        JOIN paginas_documento p ON d.id = p.documento_id 
        WHERE 
          p.contenido ILIKE $1 OR 
          p.contenido ILIKE $2 OR 
          p.contenido ILIKE $3 OR
          p.contenido ILIKE $4
        ORDER BY d.id ASC, p.numero_pagina ASC
      `;
      params = [
        `%N⁰ ${formattedSerial}%`, 
        `%N° ${formattedSerial}%`,
        `%Nº ${formattedSerial}%`,
        `%N.${formattedSerial}%`
      ];
    }
    
    console.log('SQL:', sql, 'Params:', params);
    
    const resultados = await pool.query(sql, params);
    console.log(`Se encontraron ${resultados.rows.length} resultados`);
    
    // Si no encontramos resultados, intentar con una búsqueda más amplia
    if (resultados.rows.length === 0) {
      console.log('No se encontraron resultados con búsqueda específica, intentando búsqueda más amplia...');
      
      // Segunda búsqueda más amplia
      let sql2, params2;
      
      if (documentoId) {
        sql2 = `
          SELECT d.id, d.nombre, d.num_paginas, p.id as pagina_id, p.numero_pagina, p.contenido 
          FROM documentos d 
          JOIN paginas_documento p ON d.id = p.documento_id 
          WHERE d.id = $1 AND (
            p.contenido ILIKE $2 OR 
            p.contenido ILIKE $3
          )
          ORDER BY p.numero_pagina ASC
        `;
        params2 = [
          documentoId, 
          `%N%${formattedSerial}%`, 
          `%${formattedSerial}%`
        ];
      } else {
        sql2 = `
          SELECT d.id, d.nombre, d.num_paginas, p.id as pagina_id, p.numero_pagina, p.contenido 
          FROM documentos d 
          JOIN paginas_documento p ON d.id = p.documento_id 
          WHERE 
            p.contenido ILIKE $1 OR 
            p.contenido ILIKE $2
          ORDER BY d.id ASC, p.numero_pagina ASC
          LIMIT 20
        `;
        params2 = [
          `%N%${formattedSerial}%`,
          `%${formattedSerial}%`
        ];
      }
      
      const resultadosAmpliados = await pool.query(sql2, params2);
      if (resultadosAmpliados.rows.length > 0) {
        console.log(`Búsqueda ampliada encontró ${resultadosAmpliados.rows.length} resultados`);
      }
      
      // Combinar resultados si encontramos algo
      if (resultadosAmpliados.rows.length > 0) {
        resultados.rows.push(...resultadosAmpliados.rows);
      }
    }
    
    // Procesar cada resultado para encontrar y marcar la coincidencia exacta
    const results = resultados.rows.map(result => {
      if (result.contenido) {
        // Lista de patrones específicos para el número de serie
        const patrones = [
          `N⁰\\s*${formattedSerial}\\b`,
          `N°\\s*${formattedSerial}\\b`,
          `Nº\\s*${formattedSerial}\\b`,
          `N\\.\\s*${formattedSerial}\\b`,
          `N\\s+${formattedSerial}\\b`
        ];
        
        // Buscar cada patrón
        for (const patron of patrones) {
          try {
            const regex = new RegExp(patron, 'i');
            const match = result.contenido.match(regex);
            
            if (match) {
              console.log(`Coincidencia encontrada: "${match[0]}" en página ${result.numero_pagina} del documento ${result.id}`);
              result.matchedText = match[0];
              result.matchPosition = match.index;
              
              // Extraer un fragmento más grande para contexto
              const startPos = Math.max(0, match.index - 150);
              const endPos = Math.min(result.contenido.length, match.index + match[0].length + 150);
              result.matchContext = result.contenido.substring(startPos, endPos);
              
              result.exactMatch = true;
              break;
            }
          } catch (regexError) {
            console.error(`Error en regex '${patron}':`, regexError);
            continue;
          }
        }
        
        // Si no encontramos coincidencia exacta, buscar patrón más general
        if (!result.exactMatch) {
          try {
            const serialRegex = new RegExp(`(?:[Nn][°⁰º.]?\\s*)?${formattedSerial}\\b`, 'i');
            const match = result.contenido.match(serialRegex);
            
            if (match) {
              result.matchedText = match[0];
              result.matchPosition = match.index;
              
              const startPos = Math.max(0, match.index - 150);
              const endPos = Math.min(result.contenido.length, match.index + match[0].length + 150);
              result.matchContext = result.contenido.substring(startPos, endPos);
              
              result.possibleMatch = true;
            }
          } catch (error) {
            console.error('Error en búsqueda general:', error);
          }
        }
      }
      return result;
    });
    
    // Filtrar para mostrar primero los resultados con coincidencia exacta
    const exactMatches = results.filter(r => r.exactMatch);
    const possibleMatches = results.filter(r => !r.exactMatch && r.possibleMatch);
    const otherMatches = results.filter(r => !r.exactMatch && !r.possibleMatch);
    
    // Ordenar los resultados por relevancia
    const orderedResults = [...exactMatches, ...possibleMatches, ...otherMatches];
    
    // Limitar resultados para evitar sobrecarga
    const limitedResults = orderedResults.slice(0, 20);
    
    res.json(limitedResults);
  } catch (error) {
    console.error('Error en la búsqueda por número de serie:', error);
    res.status(500).json({ error: 'Error al realizar la búsqueda por número de serie' });
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
    const result = await pool.query(`
      SELECT 
        d.id, 
        d.nombre, 
        d.num_paginas, 
        p.id as pagina_id,
        p.numero_pagina, 
        p.contenido 
      FROM documentos d 
      LEFT JOIN paginas_documento p ON d.id = p.documento_id AND p.numero_pagina = $1
      WHERE d.id = $2
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

// Nueva ruta para ver PDF en página específica (ahora sirve el PDF desde la DB)
app.get('/ver-pdf/:id', async (req, res) => {
  try {
    const documentoId = req.params.id;
    
    console.log(`Solicitando PDF binario del documento ${documentoId}`);
    
    // Obtener el contenido binario del PDF desde la base de datos
    const result = await pool.query(
      'SELECT nombre, contenido_pdf FROM documentos WHERE id = $1',
      [documentoId]
    );
    
    const documentos = result.rows;

    if (documentos.length === 0 || !documentos[0].contenido_pdf) {
      return res.status(404).send('Documento no encontrado o contenido PDF vacío');
    }
    
    const pdfBuffer = documentos[0].contenido_pdf; // El contenido binario del PDF
    const nombreArchivo = documentos[0].nombre;

    // Establecer cabeceras para el archivo PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nombreArchivo.replace(/\s/g, '_')}.pdf"`);
    res.send(pdfBuffer); // Enviar el buffer binario directamente
    
  } catch (error) {
    console.error('Error al obtener el PDF desde la DB:', error);
    res.status(500).send('Error al obtener el PDF desde la base de datos');
  }
});

// Nueva ruta para ver el PDF directamente con la página correcta (ahora sirve el PDF desde la DB)
app.get('/ver-pdf-directo/:documentoId/:pagina', async (req, res) => {
  try {
    const documentoId = req.params.documentoId;
    const pagina = parseInt(req.params.pagina) || 1; // La página se usará solo para la redirección en el frontend
    
    console.log(`Mostrando PDF directo del documento ${documentoId}, página ${pagina}`);
    
    // Obtener el contenido binario del PDF desde la base de datos
    const result = await pool.query(
      'SELECT nombre, contenido_pdf FROM documentos WHERE id = $1',
      [documentoId]
    );
    
    const documentos = result.rows;

    if (documentos.length === 0 || !documentos[0].contenido_pdf) {
      return res.status(404).send('Documento no encontrado o contenido PDF vacío');
    }
    
    const pdfBuffer = documentos[0].contenido_pdf;
    const nombreArchivo = documentos[0].nombre;

    // Establecer cabeceras para el archivo PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nombreArchivo.replace(/\s/g, '_')}.pdf"`);
    
    // Para PDF.js y la navegación por página, es mejor redirigir a la ruta /ver-pdf/:id
    // y luego pasar el parámetro de página en el frontend.
    // Aquí, simplemente enviamos el PDF y el frontend lo manejará.
    res.send(pdfBuffer);
    
  } catch (error) {
    console.error('Error al mostrar el PDF directo desde la DB:', error);
    res.status(500).send('Error al obtener el PDF desde la base de datos');
  }
});

module.exports = app; 