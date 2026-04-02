/**
 * Evaluation metrics: Accuracy and MCC.
 */

export function accuracy(predictions: string[], actuals: string[]): number {
  if (!predictions.length) return 0;
  const correct = predictions.filter((p, i) => p === actuals[i]).length;
  return correct / predictions.length;
}

export function mcc(predictions: string[], actuals: string[]): number {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (let i = 0; i < predictions.length; i++) {
    if (predictions[i] === "up" && actuals[i] === "up") tp++;
    else if (predictions[i] === "up" && actuals[i] === "down") fp++;
    else if (predictions[i] === "down" && actuals[i] === "down") tn++;
    else if (predictions[i] === "down" && actuals[i] === "up") fn++;
  }
  const denom = Math.sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn));
  return denom === 0 ? 0 : (tp * tn - fp * fn) / denom;
}

export function evaluate(predictions: string[], actuals: string[]) {
  return {
    accuracy: Math.round(accuracy(predictions, actuals) * 10000) / 10000,
    mcc: Math.round(mcc(predictions, actuals) * 10000) / 10000,
    total: predictions.length,
    correct: predictions.filter((p, i) => p === actuals[i]).length,
  };
}
