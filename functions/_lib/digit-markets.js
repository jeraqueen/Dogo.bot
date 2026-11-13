// Market candidates are discovered from Deriv at scan time. Never assume a
// symbol is tradable until contracts_for confirms DIGITMATCH.
export const VOLATILITY_NAME = /volatility\s*(10|15|25|30|50|75|90|100)(?:\s*\(1s\))?/i;
export const REQUIRED_CONTRACT = "DIGITMATCH";
export const ANALYSIS_WINDOWS = [100, 50, 25, 10];
export const DEFAULT_FREQUENCY_THRESHOLD = 11.8;
