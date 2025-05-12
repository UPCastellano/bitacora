-- Crear la base de datos si no existe
CREATE DATABASE IF NOT EXISTS pdf_searcher;

-- Usar la base de datos
USE pdf_searcher;

-- Crear tabla para almacenar los documentos PDF
CREATE TABLE IF NOT EXISTS documentos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(255) NOT NULL,
  ruta_archivo VARCHAR(255) NOT NULL,
  contenido LONGTEXT,
  num_paginas INT,
  fecha_subida TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Crear tabla para almacenar información de páginas individuales
CREATE TABLE IF NOT EXISTS paginas_documento (
  id INT AUTO_INCREMENT PRIMARY KEY,
  documento_id INT NOT NULL,
  numero_pagina INT NOT NULL,
  contenido LONGTEXT,
  FOREIGN KEY (documento_id) REFERENCES documentos(id) ON DELETE CASCADE
);

-- Índices para mejorar la búsqueda
ALTER TABLE documentos ADD FULLTEXT(contenido);
ALTER TABLE paginas_documento ADD FULLTEXT(contenido); 