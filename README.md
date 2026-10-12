# Mis gastos

App para registrar gastos por item, con presupuesto mensual por item, resumen de los últimos 6 meses y exportación a planilla.

- `index.html`: la app (sin build).
- `api/datos.js`: función de Vercel que lee y guarda los gastos en un archivo JSON **privado** de Vercel Blob (`gastos/datos.json`). Cada petición exige el PIN.

## Puesta en marcha en Vercel

1. **Importar el repositorio**: *Add New → Project*, elegir este repo. Framework: *Other*.
2. **Almacenamiento**: en el proyecto, pestaña *Storage*. Puedes conectar el mismo Blob privado que ya usas en otra app (los datos quedan en una ruta distinta) o crear uno nuevo con acceso **Private**.
3. **PIN**: en *Settings → Environment Variables*, agregar `APP_PIN` con el PIN que quieras.
4. **Redeploy**: *Deployments → ⋯ → Redeploy*.
