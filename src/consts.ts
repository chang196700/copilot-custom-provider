/** Compile-time constants. */

export const VENDOR_ID = 'copilot-custom-provider';
export const PROVIDERS_STATE_KEY = 'copilot-custom-provider.providers';
export const SCHEMA_VERSION_KEY = 'copilot-custom-provider.schemaVersion';
export const WELCOME_SHOWN_KEY = 'copilot-custom-provider.welcomeShown';
export const SCHEMA_VERSION = 1;

export const SECRET_KEY_PREFIX = 'copilot-custom-provider.provider.';

/** Reasoning cache cap before LRU eviction kicks in. */
export const MAX_REASONING_CACHE = 200;

/** Image description fallback marker. */
export const IMAGE_DESCRIPTION_UNAVAILABLE = '[Image Description unavailable]';
