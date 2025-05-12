const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const pdfParse = require('pdf-parse');
const pool = require('./config/database');

// Configurar Express
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Configurar acceso a la carpeta uploads para servir PDFs
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configurar EJS como motor de plantillas
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Configurar almacenamiento para archivos PDF
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + '.pdf');
  }
});

const upload = multer({
  storage: storage,
  fileFilter: function (req, file, cb) {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Solo se permiten archivos PDF'));
    }
    cb(null, true);
  },
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB límite
  }
});

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

// Subir PDF
app.post('/upload', upload.single('pdfFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se ha subido ningún archivo' });
    }

    const filePath = req.file.path;
    const dataBuffer = fs.readFileSync(filePath);
    
    // Extraer texto del PDF
    const pdfData = await pdfParse(dataBuffer);
    const numPaginas = pdfData.numpages;
    const contenidoCompleto = pdfData.text;
    
    // Guardar en la base de datos
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      
      // Insertar documento
      const [documentoResult] = await connection.execute(
        'INSERT INTO documentos (nombre, ruta_archivo, contenido, num_paginas) VALUES (?, ?, ?, ?)',
        [req.file.originalname, filePath, contenidoCompleto, numPaginas]
      );
      
      const documentoId = documentoResult.insertId;
      
      // Extraer y guardar contenido por página
      for (let i = 1; i <= numPaginas; i++) {
        const options = {
          max: i,
          min: i
        };
        
        const pageData = await pdfParse(dataBuffer, options);
        
        await connection.execute(
          'INSERT INTO paginas_documento (documento_id, numero_pagina, contenido) VALUES (?, ?, ?)',
          [documentoId, i, pageData.text]
        );
      }
      
      await connection.commit();
      res.json({ 
        success: true, 
        message: 'Archivo subido y procesado correctamente',
        documentId: documentoId,
        fileName: req.file.originalname,
        pages: numPaginas
      });
    } catch (error) {
      await connection.rollback();
      console.error('Error al guardar en la base de datos:', error);
      res.status(500).json({ error: 'Error al procesar el archivo' });
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error al procesar el PDF:', error);
    res.status(500).json({ error: 'Error al procesar el archivo PDF' });
  }
});

// Obtener todos los documentos
app.get('/documentos', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT id, nombre, num_paginas, fecha_subida FROM documentos ORDER BY fecha_subida DESC');
    res.json(rows);
  } catch (error) {
    console.error('Error al obtener documentos:', error);
    res.status(500).json({ error: 'Error al obtener los documentos' });
  }
});

// Eliminar documento
app.delete('/documentos/:id', async (req, res) => {
  const documentoId = req.params.id;
  
  try {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      
      // Obtener la ruta del archivo antes de eliminar
      const [documentos] = await connection.execute(
        'SELECT ruta_archivo FROM documentos WHERE id = ?',
        [documentoId]
      );
      
      if (documentos.length === 0) {
        return res.status(404).json({ error: 'Documento no encontrado' });
      }
      
      const rutaArchivo = documentos[0].ruta_archivo;
      
      // Eliminar el documento de la base de datos
      // (Las páginas se eliminarán automáticamente por la restricción de clave foránea ON DELETE CASCADE)
      await connection.execute(
        'DELETE FROM documentos WHERE id = ?',
        [documentoId]
      );
      
      // Eliminar el archivo físico
      try {
        fs.unlinkSync(rutaArchivo);
      } catch (fsError) {
        console.error('Error al eliminar el archivo físico:', fsError);
        // No interrumpimos la transacción por este error
      }
      
      await connection.commit();
      res.json({ success: true, message: 'Documento eliminado correctamente' });
    } catch (error) {
      await connection.rollback();
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
        WHERE d.id = ? AND (
          p.contenido LIKE ? OR 
          p.contenido LIKE ? OR 
          p.contenido LIKE ? OR
          p.contenido LIKE ?
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
    
    console.log('SQL:', sql, 'Params:', params);
    
    const [resultados] = await pool.execute(sql, params);
    console.log(`Se encontraron ${resultados.length} resultados`);
    
    // Si no encontramos resultados, intentar con una búsqueda más amplia
    if (resultados.length === 0) {
      console.log('No se encontraron resultados con búsqueda específica, intentando búsqueda más amplia...');
      
      // Segunda búsqueda más amplia
      let sql2, params2;
      
      if (documentoId) {
        sql2 = `
          SELECT d.id, d.nombre, d.num_paginas, p.id as pagina_id, p.numero_pagina, p.contenido 
          FROM documentos d 
          JOIN paginas_documento p ON d.id = p.documento_id 
          WHERE d.id = ? AND (
            p.contenido LIKE ? OR 
            p.contenido LIKE ?
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
            p.contenido LIKE ? OR 
            p.contenido LIKE ?
          ORDER BY d.id ASC, p.numero_pagina ASC
          LIMIT 20
        `;
        params2 = [
          `%N%${formattedSerial}%`,
          `%${formattedSerial}%`
        ];
      }
      
      const [resultadosAmpliados] = await pool.execute(sql2, params2);
      if (resultadosAmpliados.length > 0) {
        console.log(`Búsqueda ampliada encontró ${resultadosAmpliados.length} resultados`);
      }
      
      // Combinar resultados si encontramos algo
      if (resultadosAmpliados.length > 0) {
        resultados.push(...resultadosAmpliados);
      }
    }
    
    // Procesar cada resultado para encontrar y marcar la coincidencia exacta
    const results = resultados.map(result => {
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
              
              // Marcar esta como coincidencia exacta
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
    const [resultados] = await pool.execute(`
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

// Nueva ruta para ver PDF en página específica
app.get('/ver-pdf/:id', async (req, res) => {
  try {
    const documentoId = req.params.id;
    const pagina = req.query.pagina || 1;
    
    console.log(`Solicitando PDF del documento ${documentoId}, página ${pagina}`);
    
    // Obtener la ruta del archivo desde la base de datos
    const [documentos] = await pool.execute(
      'SELECT ruta_archivo, nombre FROM documentos WHERE id = ?',
      [documentoId]
    );
    
    if (documentos.length === 0) {
      return res.status(404).send('Documento no encontrado');
    }
    
    const rutaArchivo = documentos[0].ruta_archivo;
    const nombreArchivo = documentos[0].nombre;
    
    // Verificar si el archivo existe
    if (!fs.existsSync(rutaArchivo)) {
      return res.status(404).send('El archivo PDF no se encuentra en el servidor');
    }
    
    // Servir el PDF con la página específica
    // Creamos una página HTML que cargará el PDF en la página específica
    res.render('pdf-viewer', {
      rutaArchivo: path.basename(rutaArchivo),
      pagina: pagina,
      nombreArchivo: nombreArchivo
    });
  } catch (error) {
    console.error('Error al obtener el PDF:', error);
    res.status(500).send('Error al obtener el PDF');
  }
});

// Nueva ruta para ver el PDF directamente con la página correcta
app.get('/ver-pdf-directo/:documentoId/:pagina', async (req, res) => {
  try {
    const documentoId = req.params.documentoId;
    const pagina = parseInt(req.params.pagina) || 1;
    
    console.log(`Mostrando PDF directo del documento ${documentoId}, página ${pagina}`);
    
    // Obtener la ruta del archivo desde la base de datos
    const [documentos] = await pool.execute(
      'SELECT ruta_archivo, nombre FROM documentos WHERE id = ?',
      [documentoId]
    );
    
    if (documentos.length === 0) {
      return res.status(404).send('Documento no encontrado');
    }
    
    const rutaArchivo = documentos[0].ruta_archivo;
    
    // Verificar si el archivo existe
    if (!fs.existsSync(rutaArchivo)) {
      return res.status(404).send('El archivo PDF no se encuentra en el servidor');
    }
    
    // Configurar encabezados para mostrar el PDF en el navegador
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline');
    
    // Leer el archivo y enviarlo al cliente
    const fileStream = fs.createReadStream(rutaArchivo);
    
    // Agregar parámetro de página para que el navegador abra en la página específica
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(rutaArchivo)}#page=${pagina}"`);
    
    fileStream.pipe(res);
  } catch (error) {
    console.error('Error al mostrar el PDF directo:', error);
    res.status(500).send('Error al obtener el PDF');
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor iniciado en http://localhost:${PORT}`);
}); 