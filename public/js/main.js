import { getDocument, GlobalWorkerOptions } from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs';

// Configurar la ruta del worker de PDF.js
GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';

// Función para extraer texto de un PDF en el cliente
async function extractPdfText(file) {
  const fileReader = new FileReader();
  
  return new Promise((resolve, reject) => {
    fileReader.onload = async () => {
      const typedarray = new Uint8Array(fileReader.result);
      
      try {
        const loadingTask = getDocument({ data: typedarray });
        const pdf = await loadingTask.promise;
        
        let fullText = '';
        const paginasContenido = [];
        
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map(s => s.str).join(' ');
          fullText += pageText + '\n';
          paginasContenido.push(pageText);
        }
        
        resolve({ numPages: pdf.numPages, fullText, paginasContenido });
      } catch (error) {
        console.error('Error al extraer texto del PDF:', error);
        reject(new Error('Error al extraer texto del PDF.'));
      }
    };
    
    fileReader.onerror = (error) => {
      reject(new Error('Error al leer el archivo PDF.'));
    };
    
    fileReader.readAsArrayBuffer(file);
  });
}

// Función para cargar documentos (GLOBAL)
window.cargarDocumentos = async function() {
  try {
    const response = await fetch('/documentos');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const documentos = await response.json();
    
    const table = $('#documentosTable').DataTable();
    table.clear();
    
    documentos.forEach(doc => {
      const fecha = new Date(doc.fecha_subida);
      doc.fecha_subida = fecha.toLocaleString('es-ES');
    });
    
    table.rows.add(documentos).draw();
    
    const documentSelect = document.getElementById('documentSelect');
    documentSelect.innerHTML = '<option value="">Todos los documentos</option>';
    
    documentos.forEach(doc => {
      const option = document.createElement('option');
      option.value = doc.id;
      option.textContent = doc.nombre;
      option.setAttribute('data-pages', doc.num_paginas);
      documentSelect.appendChild(option);
    });
  } catch (error) {
    console.error('Error al cargar documentos:', error);
    const uploadStatus = document.getElementById('uploadStatus');
    if (uploadStatus) {
      uploadStatus.innerHTML = `
        <div class="alert alert-danger">
          <i class="fas fa-times-circle me-2"></i>
          Error al cargar la lista de documentos: ${error.message || 'Por favor, recargue la página.'}
        </div>
      `;
    }
  }
}

// Función para ver PDF (abre en nueva pestaña) (GLOBAL)
window.verPdf = function(rutaArchivo) {
  if (rutaArchivo) {
    window.open(rutaArchivo, '_blank');
  } else {
    alert('Ruta del archivo PDF no disponible.');
  }
}

// Función para confirmar eliminación (GLOBAL)
window.confirmarEliminar = function(id, nombre) {
  if (confirm(`¿Estás seguro de que quieres eliminar el documento "${nombre}"? Esta acción es irreversible y eliminará el archivo de Cellar y la información de la base de datos.`)) {
    window.eliminarDocumento(id);
  }
}

// Función para eliminar documento (GLOBAL)
window.eliminarDocumento = async function(id) {
  try {
    const response = await fetch(`/documentos/${id}`, {
      method: 'DELETE'
    });
    // Manejo de respuesta para evitar SyntaxError si no es JSON
    const contentType = response.headers.get("content-type");
    let result;
    if (contentType && contentType.indexOf("application/json") !== -1) {
      result = await response.json();
    } else {
      result = { success: response.ok, message: await response.text() };
    }
    
    if (response.ok) {
      alert(result.message);
      window.cargarDocumentos();
    } else {
      alert(`Error al eliminar: ${result.error || result.message || 'Error desconocido'}`);
    }
  } catch (error) {
    console.error('Error en la eliminación:', error);
    alert('Error de conexión al intentar eliminar el documento.');
  }
}

// Función para normalizar número de serie (GLOBAL)
window.normalizarNumeroSerie = function(input) {
  return input.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

// Función para mostrar ayuda OCR (GLOBAL)
window.mostrarAyudaOCR = function() {
  alert("Para buscar en documentos escaneados, el sistema intenta reconocer texto (OCR). La precisión puede variar. Si no encuentras lo que buscas, revisa el PDF original.");
}

document.addEventListener('DOMContentLoaded', function() {
  // Inicializar DataTables
  const documentosTable = $('#documentosTable').DataTable({
    language: {
      url: '//cdn.datatables.net/plug-ins/1.13.5/i18n/es-ES.json'
    },
    responsive: true,
    columns: [
      { data: 'id' },
      { data: 'nombre' },
      { data: 'num_paginas' },
      { data: 'fecha_subida' },
      { 
        data: null,
        render: function(data, type, row) {
          return `
            <button class="btn btn-sm btn-primary me-1" onclick="verPdf('${row.ruta_archivo}')">
              <i class="fas fa-eye"></i> Ver PDF
            </button>
            <button class="btn btn-sm btn-danger" onclick="confirmarEliminar(${row.id}, '${row.nombre}')">
              <i class="fas fa-trash"></i> Eliminar
            </button>
          `;
        }
      }
    ]
  });
  
  // Cargar documentos al iniciar
  window.cargarDocumentos(); // Llamar a la función global
  
  // Toggle entre los diferentes tipos de búsqueda
  document.getElementById('searchBySerial').addEventListener('change', function() {
    if (this.checked) {
      document.getElementById('serialSearchRow').style.display = 'flex';
      document.getElementById('pageSearchRow').style.display = 'none';
      document.getElementById('searchTypeHidden').value = 'serial';
      
      // Focus al campo de número de serie
      setTimeout(() => document.getElementById('serialNumber').focus(), 100);
    }
  });
  
  document.getElementById('searchByPage').addEventListener('change', function() {
    if (this.checked) {
      document.getElementById('serialSearchRow').style.display = 'none';
      document.getElementById('pageSearchRow').style.display = 'flex';
      document.getElementById('searchTypeHidden').value = 'page';
      
      // Asegurarse que se seleccione un documento
      const documentSelect = document.getElementById('documentSelect');
      if (!documentSelect.value) {
        // Abrir el dropdown de documentos si no hay ninguno seleccionado
        documentSelect.focus();
      } else {
        // Focus al campo de número de página
        document.getElementById('pageNumber').focus();
      }
      
      // Asegurarse que el campo de página esté habilitado
      document.getElementById('pageNumber').disabled = false;
    }
  });
  
  // Event Listener para selección de documento
  document.getElementById('documentSelect').addEventListener('change', function() {
    const documentoId = this.value;
    const pageNumberInput = document.getElementById('pageNumber');
    const totalPagesInput = document.getElementById('totalPages');
    
    // Actualizar campo oculto para el formulario
    document.getElementById('docHidden').value = documentoId;
    
    if (documentoId) {
      // Habilitar el campo de número de página
      pageNumberInput.disabled = false;
      
      // Buscar el número total de páginas del documento seleccionado
      const option = this.options[this.selectedIndex];
      const numPaginas = option.getAttribute('data-pages');
      
      totalPagesInput.value = numPaginas;
      pageNumberInput.max = numPaginas;
      pageNumberInput.placeholder = `1-${numPaginas}`;
      
      // Si estamos en modo de búsqueda por página, enfocar el campo de página
      if (document.getElementById('searchByPage').checked) {
        pageNumberInput.focus();
      }
    } else {
      // Deshabilitamos el campo de número de página
      pageNumberInput.disabled = true;
      pageNumberInput.value = '';
      totalPagesInput.value = '';
      document.getElementById('pageHidden').value = '';
    }
  });
  
  // Event Listener para cambio en número de página
  document.getElementById('pageNumber').addEventListener('change', function() {
    document.getElementById('pageHidden').value = this.value;
  });
  
  // Event Listener para cambio en número de serie
  document.getElementById('serialNumber').addEventListener('input', function() {
    document.getElementById('queryHidden').value = this.value;
  });
  
  // Event Listener para formulario de búsqueda
  document.getElementById('searchForm').addEventListener('submit', async function(e) {
    e.preventDefault(); // Prevenir el envío directo del formulario

    const searchType = document.querySelector('input[name="searchType"]:checked').value;
    const documentoId = document.getElementById('documentSelect').value;
    let queryValue = '';
    let pageValue = '';

    if (searchType === 'page') {
      pageValue = document.getElementById('pageNumber').value;
      if (!documentoId || !pageValue) {
        alert('Por favor seleccione un documento e ingrese un número de página.');
        return;
      }
      window.open(`/buscar/pagina?documentoId=${documentoId}&pagina=${pageValue}`, '_blank');
    } else if (searchType === 'serial') {
      queryValue = document.getElementById('serialNumber').value.trim();
      if (!queryValue) {
        alert('Por favor ingrese un número de serie para buscar.');
        return;
      }
      const url = `/buscar/serial?serial=${encodeURIComponent(queryValue)}${documentoId ? `&documentoId=${documentoId}` : ''}`;
      window.open(url, '_blank');
    }
  });

  // Event Listener para formulario de subida (implementa la subida directa a S3/Cellar)
  document.getElementById('uploadForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const uploadStatus = document.getElementById('uploadStatus');
    const fileInput = document.getElementById('pdfFile');
    const file = fileInput.files[0];

    if (!file) {
      uploadStatus.innerHTML = '<div class="alert alert-warning">Por favor, seleccione un archivo PDF para subir.</div>';
      return;
    }

    console.log(`Tamaño del archivo PDF original: ${file.size} bytes`);

    uploadStatus.innerHTML = '<div class="alert alert-info">Iniciando subida y extracción de texto...</div>';
    
    try {
      // 1. Obtener URL pre-firmada de Cellar para el PDF
      const getSignedUrlResponse = await fetch(`/s3-signed-url?fileName=${encodeURIComponent(file.name)}&fileType=${encodeURIComponent(file.type)}`);
      if (!getSignedUrlResponse.ok) {
        const errorText = await getSignedUrlResponse.text();
        throw new Error(`Error al obtener URL pre-firmada para PDF: ${getSignedUrlResponse.status} - ${errorText.substring(0, 100)}...`);
      }
      const { uploadURL, s3Key } = await getSignedUrlResponse.json();

      uploadStatus.innerHTML = '<div class="alert alert-info">Subiendo archivo PDF a Cellar...</div>';

      // 2. Subir el archivo PDF directamente a Cellar
      const uploadToS3Response = await fetch(uploadURL, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type,
        },
      });

      if (!uploadToS3Response.ok) {
        const errorText = await uploadToS3Response.text();
        throw new Error(`Error al subir el archivo PDF a Cellar: ${uploadToS3Response.status} - ${errorText.substring(0, 100)}...`);
      }

      uploadStatus.innerHTML = '<div class="alert alert-info">Archivo PDF subido, extrayendo texto...</div>';

      // 3. Extraer texto del PDF en el cliente
      const { numPages, fullText, paginasContenido } = await extractPdfText(file);

      uploadStatus.innerHTML = '<div class="alert alert-info">Subiendo contenido de texto a Cellar...</div>';

      // 4. Preparar el contenido de texto como JSON para subirlo a Cellar
      const textContentJson = JSON.stringify({
        fullText: fullText,
        paginasContenido: paginasContenido
      });
      const textBlob = new Blob([textContentJson], { type: 'application/json' });

      console.log(`Tamaño del Blob de texto JSON a subir a Cellar: ${textBlob.size} bytes`);

      // 5. Obtener URL pre-firmada de Cellar para el JSON de texto
      const getSignedTextUrlResponse = await fetch(`/s3-signed-text-url?originalName=${encodeURIComponent(file.name)}`);
      if (!getSignedTextUrlResponse.ok) {
        const errorText = await getSignedTextUrlResponse.text();
        throw new Error(`Error al obtener URL pre-firmada para texto: ${getSignedTextUrlResponse.status} - ${errorText.substring(0, 100)}...`);
      }
      const { uploadURL: uploadTextURL, s3TextKey } = await getSignedTextUrlResponse.json();

      // 6. Subir el archivo JSON de texto directamente a Cellar
      const uploadTextToS3Response = await fetch(uploadTextURL, {
        method: 'PUT',
        body: textBlob,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!uploadTextToS3Response.ok) {
        const errorText = await uploadTextToS3Response.text();
        throw new Error(`Error al subir el archivo de texto a Cellar: ${uploadTextToS3Response.status} - ${errorText.substring(0, 100)}...`);
      }

      // 7. Enviar metadatos LIGEROS (claves S3) al backend
      uploadStatus.innerHTML = '<div class="alert alert-info">Enviando metadatos al servidor...</div>';
      
      const payloadToSend = {
        s3Key: s3Key,
        s3TextKey: s3TextKey, // <--- Enviamos la clave S3 del texto
        originalname: file.name,
        numPaginas: numPages
      };
      
      const stringifiedPayload = JSON.stringify(payloadToSend); // Convertir a string para medir el tamaño
      console.log(`Payload JSON a enviar al backend /upload:`, payloadToSend);
      console.log(`Tamaño del payload JSON a enviar al backend /upload: ${stringifiedPayload.length} bytes`);

      const sendMetadataResponse = await fetch('/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: stringifiedPayload, // Usar el payload stringificado
      });
      
      const contentType = sendMetadataResponse.headers.get("content-type");
      let result;
      if (contentType && contentType.indexOf("application/json") !== -1) {
        result = await sendMetadataResponse.json();
      } else {
        result = { success: sendMetadataResponse.ok, message: await sendMetadataResponse.text() };
      }

      if (sendMetadataResponse.ok) { 
        uploadStatus.innerHTML = `
          <div class="alert alert-success">
            <i class="fas fa-check-circle me-2"></i>
            Archivo "${result.fileName}" subido y procesado correctamente (${result.pages} páginas)
          </div>
        `;
        document.getElementById('uploadForm').reset();
        window.cargarDocumentos();
      } else {
        uploadStatus.innerHTML = `
          <div class="alert alert-danger">
            <i class="fas fa-times-circle me-2"></i>
            Error en el servidor al guardar metadatos: ${result.error || result.message || 'Error desconocido'}
          </div>
        `;
      }
    } catch (error) {
      console.error('Error en la subida:', error);
      uploadStatus.innerHTML = `
        <div class="alert alert-danger">
          <i class="fas fa-times-circle me-2"></i>
          Error al subir el archivo: ${error.message || 'Inténtelo de nuevo.'}
        </div>
      `;
    }
  });
}); 