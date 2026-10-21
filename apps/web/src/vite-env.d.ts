/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BDIX_URL?: string;
  /** Only for local development against services/mock/src/msak.js. */
  readonly VITE_MLAB_LOCATE_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
