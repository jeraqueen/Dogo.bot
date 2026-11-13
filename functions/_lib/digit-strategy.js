// The old DIGITDIFF strategy is deliberately disabled. Matches signal analysis
// lives in functions/api/signals.js; order execution remains disabled until
// the Matches proposal/buy/settlement lifecycle is separately validated.
export const DIGIT_STRATEGY = Object.freeze({
  contractType: "DIGITMATCH",
  stake: 1,
  currency: "USD",
  maximumTradesPerMarket: 0,
  cycleMarkets: 0,
  duration: 1,
  durationUnit: "t",
  sampleSize: 100,
  markets: []
});
export function evaluateDigitDiffers() {
  return { eligible: false, reason: "LEGACY_DIGITDIFF_DISABLED" };
}
