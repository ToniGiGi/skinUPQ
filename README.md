# SkinUPQ

Extensión de navegador que le da una interfaz moderna al **Sistema Integral de Información (SII)** de la UPQ
(`https://sistemaintegral.upq.edu.mx`). Solo cambia la apariencia: **no modifica el backend** ni las peticiones
que se envían al servidor.

## Cómo funciona

- El navegador carga la página original del SII como siempre.
- La extensión inyecta CSS (y un poco de JS) encima, como una "skin".
- En el login, "recuperar contraseña" y "actualizar contraseña", el `<form>` original se **mueve** dentro del nuevo diseño, así que el token CSRF, los nombres
  de campos y la URL de envío no cambian.
- Por dentro, el SII es una página con un iframe (`/alumnos.php/home/home`) que contiene la columna del
  perfil y las pestañas EasyUI. La barra superior controla esas pestañas (que quedan ocultas) y la columna
  del perfil se convierte en el módulo "Perfil". Las notificaciones se descargan de la misma URL que usa
  su pestaña original.
- Las páginas internas usan jQuery EasyUI; `styles/theme.css` re-estiliza sus componentes (paneles, pestañas,
  tablas, botones, diálogos) sin tocar tamaños, porque EasyUI los calcula con JavaScript.

## Instalar (modo desarrollador)

1. Abre `chrome://extensions` (o `edge://extensions` / `brave://extensions`).
2. Activa **Modo de desarrollador**.
3. Clic en **Cargar descomprimida** y elige esta carpeta (`C:\Poyectos\SKINUPQ`).
4. Entra a https://sistemaintegral.upq.edu.mx/alumnos.php/

Después de editar archivos: botón ⟳ de la extensión en `chrome://extensions` y recarga la página del SII.

El ícono de la extensión abre un popup para **activar/desactivar** la skin.

## Estructura

```
manifest.json        Configuración de la extensión (Manifest V3)
scripts/toggle.js    Apaga la skin si el usuario la desactivó (corre antes de pintar)
scripts/icons.js     Íconos compartidos (estilo lucide)
scripts/auth.js      Rediseña login, "recuperar" y "actualizar contraseña" reutilizando los formularios reales
scripts/app.js       Sistema por dentro: barra superior con módulos, notificaciones, usuario y módulo Perfil
scripts/trayectoria.js Módulo Trayectoria Escolar rediseñado (lee la página original y arma el tablero)
scripts/seguimiento.js Módulo Seguimiento Cuatrimestral (horario semanal, ahora/siguiente clase, parciales)
scripts/desempeno.js   Módulo Desempeño Escolar (boleta, historial con buscador, plan de estudios / kardex imprimible de consulta)
scripts/personal.js    Módulo Información Personal (lee los datos ya cargados; "Actualizar" abre el formulario original del SII)
scripts/becas.js       Módulo Becas (becas autorizadas como reconocimientos; las demás solicitudes aparte)
scripts/pagos.js       Módulo Pagos (pendientes, historial; "Solicitar" abre el formulario oficial del SII en una ventana)
scripts/panel.js       Panel Principal (iframe home/panelPrincipal): mueve los enlaces originales a mosaicos y muestra los accesos de biblioteca
scripts/bolsa.js       Bolsa de Trabajo: CV como hoja, ofertas como tarjetas; acciones con las mismas peticiones/formularios del SII
scripts/medico.js      Seguimiento Médico: seguro (NSS oculto), tipo de sangre con compatibilidad, condiciones; "Actualizar" abre el formulario oficial
scripts/orientacion.js Orientación Educativa: pasos, sesiones, solicitudes e historial; acciones con las mismas peticiones/formularios del SII
scripts/le.js          LE (Lenguas Extranjeras / CAAL): reservaciones, historial, materiales e intensivos
scripts/bridge.js    Corre en el mundo principal de la página para usar el EasyUI del SII (layout y pestañas)
styles/tokens.css    Colores, radios, sombras y tipografía
styles/theme.css     Tema general para las páginas internas (EasyUI)
styles/auth.css      Diseño de las 3 pantallas de acceso
styles/app.css       Barra superior, menús y módulo Perfil
styles/trayectoria.css Módulo Trayectoria Escolar
styles/seguimiento.css Módulo Seguimiento Cuatrimestral
styles/desempeno.css   Módulo Desempeño Escolar
styles/personal.css    Módulo Información Personal
styles/becas.css       Módulo Becas
styles/pagos.css       Módulo Pagos
styles/panel.css       Panel Principal
styles/bolsa.css       Bolsa de Trabajo
styles/medico.css      Seguimiento Médico
styles/orientacion.css Orientación Educativa
styles/le.css          LE (Lenguas Extranjeras / CAAL)
popup/               Interruptor on/off
assets/              Imágenes optimizadas que usa la extensión (foto del campus, logos recortados)
images/              Originales en alta resolución (no se usan directamente; no se sube al repositorio)
muestras/            HTML del SII guardado para pruebas locales (contiene datos personales; no se sube al repositorio)
```

Si cambias una imagen en `images/`, vuelve a generar la versión optimizada en `assets/`
(la foto se reduce a 1400 px de ancho; los logos se recortan al contenido y se dejan en 480 px).

La portada del perfil (imagen elegida por el alumno) se guarda solo en el navegador, en
`chrome.storage.local` de la extensión, con la clave `cover:<matrícula>`. Nunca se envía al SII.

Todo el CSS está bajo `html:not(.skinupq-off)`, de modo que al desactivar la skin se ve la página original.
