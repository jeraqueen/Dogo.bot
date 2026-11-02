export const DIGIT_STRATEGY = Object.freeze({
  contractType: "DIGITDIFF",
  duration: 1,
  durationUnit: "t",
  sampleSize: 100,
  maxPredictedPercent: 9,
  minimumBarSeparation: 2,
  maximumTradesPerMarket: 4,
  markets: [
    "R_10", "R_25", "R_50", "R_75", "R_100",
    "1HZ10V", "1HZ25V", "1HZ50V", "1HZ75V", "1HZ100V"
  ]
});

/**
 * Builds a digit-frequency distribution from recent Deriv tick quote strings.
 * A unique minimum is the red/predicted digit; a unique maximum is the green
 * comparison bar. Ties are rejected because the user requires exactly one
 * red and one green bar.
 */
export function evaluateDigitDiffers(quotes, sampleSize = DIGIT_STRATEGY.sampleSize) {
  if (!Array.isArray(quotes) || quotes.length < sampleSize) {
    return { eligible: false, reason: "INSUFFICIENT_TICKS", requiredTicks: sampleSize };
  }

  const digits = quotes.slice(-sampleSize).map(lastDigitFromQuote);
  if (digits.some(d => d === null)) {
    return { eligible: false, reason: "INVALID_TICK_DATA" };
  }

  const counts = Array(10).fill(0);
  for (const digit of digits) counts[digit] += 1;
  const percentages = counts.map(count => count / sampleSize * 100);
  const min = Math.min(...percentages);
  const max = Math.max(...percentages);
  const redDigits = percentages.map((p, d) => p === min ? d : -1).filter(d => d >= 0);
  const greenDigits = percentages.map((p, d) => p === max ? d : -1).filter(d => d >= 0);

  if (redDigits.length !== 1 || greenDigits.length !== 1) {
    return { eligible: false, reason: "AMBIGUOUS_BARS", percentages, redDigits, greenDigits };
  }

  const predictedDigit = redDigits[0];
  const greenDigit = greenDigits[0];
  const separation = Math.abs(predictedDigit - greenDigit);

  if (predictedDigit === greenDigit) return { eligible: false, reason: "SAME_BAR" , percentages };
  if (separation < DIGIT_STRATEGY.minimumBarSeparation) {
    return { eligible: false, reason: "BARS_TOO_CLOSE", percentages, predictedDigit, greenDigit, separation };
  }
  if (percentages[predictedDigit] > DIGIT_STRATEGY.maxPredictedPercent) {
    return { eligible: false, reason: "PREDICTED_PERCENT_ABOVE_9", percentages, predictedDigit, greenDigit, separation };
  }

  return {
    eligible: true,
    contractType: DIGIT_STRATEGY.contractType,
    duration: DIGIT_STRATEGY.duration,
    durationUnit: DIGIT_STRATEGY.durationUnit,
    predictedDigit,
    predictedPercent: percentages[predictedDigit],
    greenDigit,
    greenPercent: percentages[greenDigit],
    separation,
    percentages,
    sampleSize
  };
}

function lastDigitFromQuote(value) {
  const quote = String(value ?? "").trim();
  if (!/^-?\\d+(?:\\.\\d+)?$/.test(quote)) return null;
  const decimal = quote.split(".")[1] || "";
  const relevant = decimal.length ? decimal : quote.replace("-", "");
  const char = relevant.slice(-1);
  return /^[0-9]$/.test(char) ? Number(char) : null;
}
