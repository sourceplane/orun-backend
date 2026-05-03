/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ORUN_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
