/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_CHAIN_NAME?: string;
  readonly VITE_NATIVE_SYMBOL?: string;
  readonly VITE_EXPLORER_URL?: string;
  readonly VITE_USDC_ADDRESS?: string;
  readonly VITE_USDC_DECIMALS?: string;
  readonly VITE_LLM_BASE_URL?: string;
  readonly VITE_LLM_MODEL?: string;
  readonly VITE_LLM_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
