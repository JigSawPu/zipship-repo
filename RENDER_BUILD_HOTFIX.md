# Render build hotfix (v1.0.2)

The previous Blueprint set `NODE_ENV=production` during the build. npm therefore omitted development dependencies such as TypeScript, Vite, `@types/react`, and `@types/react-dom`. This caused JSX and `ImportMeta.env` type errors.

Version 1.0.2 fixes the Blueprint build command:

```bash
npm ci --include=dev --no-audit --no-fund && npm run build
```

## Recommended update

Replace the complete repository contents with the v1.0.2 project, while keeping your existing Render service name in `render.yaml`. Commit and push, then use **Manual Deploy → Clear build cache & deploy** in Render.

For a minimal patch to an otherwise complete v1.0.1 repository, replacing only `render.yaml` is sufficient.
