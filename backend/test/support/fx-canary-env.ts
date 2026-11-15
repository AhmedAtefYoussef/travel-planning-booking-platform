/**
 * Import FIRST in a spec (before the app module): replaces FX_API_KEY with a distinctive canary that
 * contains URL-special characters, so a leak of the raw or URL-encoded key can be detected (TRVL-133).
 */
export const FX_CANARY_KEY = 'fx-CANARY-9q+Z/k=Leak';
export const PREVIOUS_FX_API_KEY = process.env.FX_API_KEY;
process.env.FX_API_KEY = FX_CANARY_KEY;
