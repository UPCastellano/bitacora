CREATE TABLE IF NOT EXISTS documentos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    contenido_pdf BYTEA, -- Nueva columna para el contenido binario del PDF
    contenido TEXT, -- Contenido textual extraído del PDF
    num_paginas INT,
    fecha_subida TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS paginas_documento (
    id SERIAL PRIMARY KEY,
    documento_id INT NOT NULL,
    numero_pagina INT NOT NULL,
    contenido TEXT,
    FOREIGN KEY (documento_id) REFERENCES documentos(id) ON DELETE CASCADE
);

-- Índices para mejorar el rendimiento de búsqueda
CREATE INDEX IF NOT EXISTS idx_documentos_nombre ON documentos(nombre);
CREATE INDEX IF NOT EXISTS idx_paginas_documento_contenido ON paginas_documento USING GIN (to_tsvector('spanish', contenido)); -- Para búsqueda de texto completo en español
CREATE INDEX IF NOT EXISTS idx_paginas_documento_documento_id_pagina ON paginas_documento(documento_id, numero_pagina);

-- Si necesitas una tabla para usuarios o cualquier otra cosa, agrégala aquí. 