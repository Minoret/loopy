![](https://i.imgur.com/S8c7E8o.gif)

# LOOPY.ESP (v2)

**Herramienta Profesional de Pensamiento Sistémico para Análisis Clínico**

---

LOOPY.ESP es una herramienta interactiva basada en la web para el pensamiento sistémico. Permite crear simulaciones de sistemas complejos mediante diagramas visuales de forma fácil y lúdica.

Esta versión, **LOOPY.ESP**, es una adaptación profesional del [LOOPY original](https://ncase.me/loopy/) desarrollado por [Nicky Case](http://ncase.me/), diseñada específicamente para contextos clínicos y educativos.

## ✨ Características Profesionales

### 🎨 Tipografía Profesional - Figtree
- Tipografía Figtree (Google Fonts) implementada en toda la aplicación
- Pesos disponibles: 300 (Light), 400 (Regular), 700 (Bold)
- Consistencia visual en interfaz, nodos, etiquetas y elementos del canvas

### 🔗 Sistema de Links Cortos
- **Generar Link Corto**: Guarda modelos en el servidor y genera URLs cortas únicas
- **Carga Automática**: Los links con parámetro `?s=ID` cargan modelos directamente desde el servidor
- **Gestión de Modelos**: Los modelos se almacenan en archivos JSON con limpieza automática de modelos antiguos (30+ días)

### 📊 Exportación PNG con Grilla de Análisis
- Exportación de modelos como imágenes PNG
- Si la Grilla de Análisis Clínico está visible, se incluye en la exportación:
  - Líneas punteadas de la cuadrícula 3x3
  - Etiquetas de categorías clínicas (Atención, Cognición, Self, Afecto, Conducta, Motivación, Biofisiológico, Contexto, Sociocultural)

### 🔄 Señales de Intensidad Constante
- Las señales que viajan por los bordes mantienen un tamaño constante de 1.0x
- Dirección visual correcta según el signo del delta (+/-)

### 📋 Grilla de Análisis Clínico 3x3
- Cuadrícula basada en el **MetaModelo Evolutivo Extendido (MMEE)**:
  - **Fila 1**: Atención, Cognición, Self
  - **Fila 2**: Afecto, Conducta, Motivación  
  - **Fila 3**: Biofisiológico, Contexto, Sociocultural
- Botón de alternancia para mostrar/ocultar la grilla
- Útil para mapeo y análisis clínico de sistemas

### 🎯 Otras Funcionalidades
- **Traducción completa al español**: Toda la interfaz de usuario, menús y mensajes han sido traducidos.
- **Soporte para ajuste de línea (Word-wrap)**: Las etiquetas de los nodos admiten múltiples líneas de texto.
- **Fuerza de relación granular**: Definición precisa de la fuerza de los bordes (rango de -2.0 a +2.0).
- **Diferenciación visual de flechas**:
  - **Puntas sólidas**: Relaciones positivas (+)
  - **Puntas contorneadas (Outlined)**: Relaciones negativas (-)
- **Analizar Centralidad**: Visualización de la importancia relativa de cada nodo mediante "Mapa de Calor" (halos de colores).
- **Atajo de teclado**: Tecla **D** para activar rápidamente la herramienta de dibujo (Pencil).
- **Créditos de Adaptación**: Realizado por el **Lic. Mathias Nicolás Rojas de la Fuente**.

---

## 🚀 Cómo usar

### Modo Edición
1. **Dibujar nodos**: Usa el lápiz (Pencil) para crear círculos
2. **Crear relaciones**: Dibuja flechas entre círculos para crear bordes
3. **Editar elementos**: Haz clic en un nodo o flecha para cambiar nombre, color o fuerza
4. **Añadir etiquetas**: Usa la herramienta de texto para agregar descripciones
5. **Mover elementos**: Arrastra elementos para reposicionarlos

### Modo Simulación (Play)
1. Presiona el botón **PLAY** para activar el modo simulación
2. **Interactuar con nodos**: Haz clic en las flechas ↑↓ de cada nodo para aumentar o disminuir su valor
3. **Observar propagación**: Los cambios se propagan a través del sistema
4. **Reiniciar**: Presiona el botón RESET para volver al estado inicial

### Herramientas
- **Pencil (Lápiz)**: Herramienta principal para dibujar nodos y relaciones
- **Drag (Mano)**: Mover y reposicionar elementos
- **Eraser (Borrador)**: Eliminar elementos
- **Label (Texto)**: Añadir etiquetas de texto descriptivas

### Análisis
- **Activar Grilla Clínico**: Haz clic en el botón de grilla (esquina inferior derecha) para mostrar/ocultar la cuadrícula 3x3
- **Analizar Centralidad**: Haz clic en "analizar centralidad" en el panel lateral para ver el mapa de calor de nodos
- **Analizar Intervenciones (NIRA)**: NIRA permite identificar qué nodo, al ser intervenido, produce el mayor efecto cascada en el resto del sistema. Haz clic en "analizar intervenciones (NIRA)" en el panel lateral: verás el ranking de impacto en el resto del sistema (derrame) con auras en los 5 nodos de mayor impacto

### Guardar y Compartir
- **Guardar como Link**: Genera URL con datos del modelo codificados
- **Generar Link Corto**: Guarda el modelo en servidor y genera URL corta única (requiere PHP)
- **Guardar como Archivo**: Descarga el modelo como archivo `.loopy`
- **Guardar como PNG**: Exporta el modelo como imagen
- **Cargar Archivo**: Importa un modelo previamente guardado

---

## 💻 Requisitos Técnicos

### Ejecución Local (Básica)
- Abrir `index.html` en cualquier navegador moderno
- No requiere servidor ni procesos de compilación
- Requiere conexión a internet para cargar Google Fonts (Figtree)

### Funcionalidad de Links Cortos
- Requiere servidor web con soporte PHP
- Necesita permisos de escritura en el directorio `/models/`
- Configuración de ejemplo para Apache/Nginx

### Navegadores Compatibles
- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

---

## 📁 Estructura de Archivos

```
loopy/
├── index.html          # Página principal
├── save.php           # Script PHP para guardar/cargar modelos
├── models/            # Directorio para modelos guardados (creado automáticamente)
├── css/
│   └── loopy.css      # Estilos principales
├── js/
│   ├── Loopy.js       # Controlador principal
│   ├── Model.js       # Modelo de datos
│   ├── Node.js        # Nodos (círculos)
│   ├── Edge.js        # Bordes (flechas)
│   ├── Label.js       # Etiquetas de texto
│   ├── Sidebar.js     # Panel lateral
│   ├── Toolbar.js     # Barra de herramientas
│   ├── Modal.js       # Sistema de modales
│   └── ...
└── pages/
    ├── howto.html     # Tutorial
    ├── examples/      # Ejemplos
    └── credits/       # Créditos
```

---

## 🛠️ Instalación del Servidor PHP (Opcional)

Para habilitar la funcionalidad de **Links Cortos**:

### Apache (con mod_php)
1. Asegúrate de que PHP está instalado y habilitado
2. El directorio `/models/` se creará automáticamente con permisos de escritura

### Nginx con PHP-FPM
1. Configura un location para servir archivos PHP:
```nginx
location ~ \.php$ {
    fastcgi_pass unix:/run/php/php-fpm.sock;
    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    include fastcgi_params;
}
```

### Permisos
```bash
chmod 755 models/
chmod 644 models/*.json 2>/dev/null || true
```

---

## 📜 Licencia

LOOPY es software de dominio público (CC0). Eres libre de usarlo, modificarlo y compartirlo.

---

## 👨‍💻 Créditos

**Adaptación Profesional**: 
- Lic. Mathias Nicolás Rojas de la Fuente (M.N. 87001)

**Trabajo Original**:
- Nicky Case - [ncase.me](http://ncase.me/)

**Tipografía**:
- Figtree por [Google Fonts](https://fonts.google.com/specimen/Figtree)

---

*Adaptado para su uso en contextos clínicos y educativos*
