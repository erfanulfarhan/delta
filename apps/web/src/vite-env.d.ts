/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BDIX_URL?: string;
  readonly VITE_RAW_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
