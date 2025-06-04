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
            <button class="btn btn-sm btn-info me-1" onclick="buscarEnDocumento(${row.id}, '${row.nombre}', ${row.num_paginas})">
              <i class="fas fa-search"></i> Buscar
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
  cargarDocumentos();
  
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
  document.getElementById('searchForm').addEventListener('submit', function(e) {
    const searchType = document.querySelector('input[name="searchType"]:checked').value;
    const documentoId = document.getElementById('documentSelect').value;
    
    // Actualizar campos ocultos
    document.getElementById('searchTypeHidden').value = searchType;
    document.getElementById('docHidden').value = documentoId;
    
    // Validación básica
    if (searchType === 'page') {
      const pagina = document.getElementById('pageNumber').value;
      document.getElementById('pageHidden').value = pagina;
      
      if (!documentoId) {
        e.preventDefault();
        alert('Por favor seleccione un documento para ver una página específica');
        document.getElementById('documentSelect').focus();
        return;
      }
      
      if (!pagina) {
        e.preventDefault();
        alert('Por favor ingrese un número de página');
        document.getElementById('pageNumber').focus();
        return;
      }
    } else if (searchType === 'serial') {
      const serial = document.getElementById('serialNumber').value.trim();
      
      if (!serial) {
        e.preventDefault();
        alert('Por favor ingrese un número de serie para buscar');
        document.getElementById('serialNumber').focus();
        return;
      }
      
      document.getElementById('queryHidden').value = serial;
    }
    
    // Todo está bien, el formulario se enviará a la página de resultados
    console.log("Enviando búsqueda:", {
      tipo: document.getElementById('searchTypeHidden').value,
      query: document.getElementById('queryHidden').value,
      doc: document.getElementById('docHidden').value,
      pagina: document.getElementById('pageHidden').value
    });
  });
  
  // Event Listener para formulario de subida
  document.getElementById('uploadForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const fileInput = document.getElementById('pdfFile');
    const pdfFile = fileInput.files[0];
    const uploadStatus = document.getElementById('uploadStatus');
    
    if (!pdfFile) {
      uploadStatus.innerHTML = '<div class="alert alert-warning">Por favor, seleccione un archivo PDF para subir.</div>';
      return;
    }

    uploadStatus.innerHTML = '<div class="alert alert-info">Iniciando subida...</div>';

    try {
      // Paso 1: Obtener la URL pre-firmada de S3 desde el backend
      const getSignedUrlResponse = await fetch(`/s3-signed-url?fileName=${encodeURIComponent(pdfFile.name)}&fileType=${encodeURIComponent(pdfFile.type)}`);
      
      if (!getSignedUrlResponse.ok) {
        const errorData = await getSignedUrlResponse.json();
        throw new Error(`Error al obtener URL pre-firmada: ${errorData.error || getSignedUrlResponse.statusText}`);
      }
      
      const { uploadURL, s3Key } = await getSignedUrlResponse.json();
      
      uploadStatus.innerHTML = '<div class="alert alert-info">Subiendo archivo directamente a S3...</div>';

      // Paso 2: Subir el archivo directamente a S3 usando la URL pre-firmada
      const s3UploadResponse = await fetch(uploadURL, {
        method: 'PUT',
        body: pdfFile,
        headers: {
          'Content-Type': pdfFile.type
        }
      });

      if (!s3UploadResponse.ok) {
        // S3 no devuelve JSON en errores PUT, así que solo usamos statusText
        throw new Error(`Error al subir a S3: ${s3UploadResponse.statusText}`);
      }
      
      uploadStatus.innerHTML = '<div class="alert alert-info">Archivo subido a S3. Procesando en el servidor...</div>';

      // Paso 3: Notificar a nuestro backend que el archivo está en S3
      const backendResponse = await fetch('/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          s3Key: s3Key,
          originalname: pdfFile.name
        })
      });
      
      const result = await backendResponse.json();
      
      if (result.success) {
        uploadStatus.innerHTML = `
          <div class="alert alert-success">
            <i class="fas fa-check-circle me-2"></i>
            Archivo "${result.fileName}" subido y procesado correctamente (${result.pages} páginas)
          </div>
        `;
        document.getElementById('uploadForm').reset();
        cargarDocumentos();
      } else {
        uploadStatus.innerHTML = `
          <div class="alert alert-danger">
            <i class="fas fa-times-circle me-2"></i>
            Error en el servidor: ${result.error}
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

// Función para cargar documentos
async function cargarDocumentos() {
  try {
    const response = await fetch('/documentos');
    const documentos = await response.json();
    
    // Actualizar la tabla
    const table = $('#documentosTable').DataTable();
    table.clear();
    
    // Formatear fecha de subida
    documentos.forEach(doc => {
      // Formatear la fecha para mostrarla en formato DD/MM/YYYY HH:MM
      const fecha = new Date(doc.fecha_subida);
      doc.fecha_subida = fecha.toLocaleString('es-ES');
    });
    
    table.rows.add(documentos).draw();
    
    // Actualizar el select de documentos para la búsqueda
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
    // Mostrar un mensaje de error al usuario si la carga falla
    const uploadStatus = document.getElementById('uploadStatus'); // Reutilizando este elemento para mensajes generales
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

// Función para buscar en un documento específico
function buscarEnDocumento(id, nombre, numPaginas) {
  // Seleccionar el documento en el dropdown
  const documentSelect = document.getElementById('documentSelect');
  documentSelect.value = id;
  
  // Disparar el evento change para actualizar los campos relacionados
  const event = new Event('change');
  documentSelect.dispatchEvent(event);
  
  // Hacer scroll hasta la sección de búsqueda
  document.querySelector('.card-header.bg-success').scrollIntoView({ behavior: 'smooth' });
  
  // Enfocar el campo de número de serie por defecto
  setTimeout(() => {
    document.getElementById('serialNumber').focus();
  }, 500);
}

// Función para confirmar eliminación
function confirmarEliminar(id, nombre) {
  if (confirm(`¿Está seguro que desea eliminar el documento "${nombre}"?`)) {
    eliminarDocumento(id);
  }
}

// Función para eliminar documento
async function eliminarDocumento(id) {
  try {
    const response = await fetch(`/documentos/${id}`, {
      method: 'DELETE'
    });
    
    const result = await response.json();
    
    if (result.success) {
      alert('Documento eliminado correctamente');
      cargarDocumentos();
    } else {
      alert(`Error: ${result.error}`);
    }
  } catch (error) {
    console.error('Error al eliminar documento:', error);
    alert('Error al eliminar el documento');
  }
}

/**
 * Funciones para mejorar la búsqueda por número de serie en documentos escaneados
 */

// Normalizar formatos de número de serie para búsqueda
function normalizarNumeroSerie(input) {
  if (!input) return '';
  
  // Eliminar espacios extra y convertir a mayúsculas
  let normalizado = input.trim().toUpperCase();
  
  // Eliminar prefijos comunes si el usuario los ingresó
  const prefijos = ['N⁰', 'N°', 'Nº', 'N.', 'NO.', 'NO ', 'N '];
  for (const prefijo of prefijos) {
    if (normalizado.startsWith(prefijo)) {
      normalizado = normalizado.substring(prefijo.length).trim();
      break;
    }
  }
  
  // Eliminar espacios dentro del número
  normalizado = normalizado.replace(/\s+/g, '');
  
  return normalizado;
}

// Añadir listener para el formulario de búsqueda por número de serie
document.addEventListener('DOMContentLoaded', function() {
  const serialForm = document.getElementById('serialForm');
  if (serialForm) {
    serialForm.addEventListener('submit', function(e) {
      const serialInput = document.getElementById('serial');
      if (serialInput) {
        // Normalizar el valor antes de enviar
        const valorNormalizado = normalizarNumeroSerie(serialInput.value);
        if (valorNormalizado) {
          serialInput.value = valorNormalizado;
        }
      }
    });
    
    // Manejar el checkbox de buscar en todos los documentos
    const buscarTodosSerial = document.getElementById('buscarTodosSerial');
    const selectorDocumentoSerial = document.getElementById('selectorDocumentoSerial');
    const documentoIdSerial = document.getElementById('documentoIdSerial');
    
    if (buscarTodosSerial && selectorDocumentoSerial && documentoIdSerial) {
      buscarTodosSerial.addEventListener('change', function() {
        if (this.checked) {
          selectorDocumentoSerial.classList.add('d-none');
          documentoIdSerial.value = '';
        } else {
          selectorDocumentoSerial.classList.remove('d-none');
        }
      });
    }
  }
  
  // Añadir explicación visual para el usuario
  const serialHelp = document.getElementById('serialHelp');
  if (serialHelp) {
    serialHelp.innerHTML = `
      <small class="text-muted">
        Ingresa el número sin prefijos como "N°" o "N⁰". 
        El sistema buscará todas las variantes posibles.
      </small>
    `;
  }
});

// Funciones para mostrar información sobre formatos de OCR en la interfaz
function mostrarAyudaOCR() {
  const ayudaModal = document.getElementById('ocrHelpModal');
  if (!ayudaModal) {
    // Crear modal de ayuda si no existe
    const modal = document.createElement('div');
    modal.id = 'ocrHelpModal';
    modal.className = 'modal fade';
    modal.setAttribute('tabindex', '-1');
    modal.setAttribute('aria-hidden', 'true');
    
    modal.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Ayuda para búsqueda en documentos escaneados</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <p>Al buscar números de serie en documentos escaneados, ten en cuenta:</p>
            <ul>
              <li>El sistema buscará automáticamente diferentes variaciones del formato (N⁰, N°, Nº, etc.)</li>
              <li>Ingresa solamente el número, sin necesidad de incluir prefijos</li>
              <li>Los resultados se ordenan por relevancia, mostrando primero las coincidencias exactas</li>
              <li>Las etiquetas de colores indican la calidad de la coincidencia:
                <ul>
                  <li><span class="badge bg-success">Coincidencia exacta</span> - Alta confianza</li>
                  <li><span class="badge bg-warning text-dark">Posible coincidencia</span> - Confianza media</li>
                  <li><span class="badge bg-secondary">Coincidencia parcial</span> - Baja confianza</li>
                </ul>
              </li>
            </ul>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cerrar</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Inicializar el modal de Bootstrap
    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();
  } else {
    // Mostrar el modal existente
    const bsModal = new bootstrap.Modal(ayudaModal);
    bsModal.show();
  }
}

// Agregar botón de ayuda si existe el formulario de búsqueda
document.addEventListener('DOMContentLoaded', function() {
  const serialForm = document.getElementById('serialForm');
  if (serialForm) {
    const helpButton = document.createElement('button');
    helpButton.type = 'button';
    helpButton.className = 'btn btn-outline-info btn-sm ms-2';
    helpButton.innerHTML = '<i class="fas fa-question-circle"></i> Ayuda';
    helpButton.addEventListener('click', function(e) {
      e.preventDefault();
      mostrarAyudaOCR();
    });
    
    const submitButton = serialForm.querySelector('button[type="submit"]');
    if (submitButton && submitButton.parentNode) {
      submitButton.parentNode.appendChild(helpButton);
    }
  }
}); 