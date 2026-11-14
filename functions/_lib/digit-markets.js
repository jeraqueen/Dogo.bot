// Compatibility exports for the legacy execution modules. The Matches scanner
// discovers its real market list dynamically from Deriv on every scan.
export const DIGIT_MARKETS = [];
export const DIGIT_CONTRACT_TYPES = ["DIGITMATCH"];
export const VOLATILITY_NAME = /volatility\s*(10|15|25|30|50|75|90|100)/i;
export const ANALYSIS_WINDOWS = [100, 50, 25, 10];
export const DEFAULT_FREQUENCY_THRESHOLD = 11.8;
