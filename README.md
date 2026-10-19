# Plugin KinoTV — Series Turcas TV

Versión inicial de desarrollo para `kaj.seriesturcastv.to`.

## Archivos
- `kino-plugin.json`: manifiesto de Kino.
- `plugin.js`: búsqueda, Inicio, navegación, episodios y resolución limitada a fuentes directas.

## Importante
La estructura HTML del sitio puede cambiar y esta versión requiere pruebas en el SDK oficial de Kino. La función `resolve` solo acepta URL directas `.m3u8` o `.mp4` que estén expuestas en la página; no evita DRM, CAPTCHA ni cifrado de reproductores. Si el titular proporciona una API/resolutor oficial, se puede integrar.

## Probar
1. Descarga la plantilla SDK oficial: https://github.com/kinotvapp/kino-plugin-sdk
2. Coloca estos archivos en la carpeta del plugin junto con el SDK/archivos de prueba necesarios.
3. Ejecuta `node sdk/validate.mjs .`
4. Ejecuta `node sdk/run.mjs . search "Arafta"`.

Si el validador informa diferencias de contrato, ajusta `plugin.js` a la versión de Kino instalada.
