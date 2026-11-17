// The same route, currency and stay-length rules apply to every monthly fare.
export function tripScores(walk, quarters, offers) {
  const scores = new Map();
  const ordered = offers.map(([,offer]) => offer.minor).filter(price => Number.isFinite(price) && price>0).sort((a,b)=>a-b);
  if (walk.length !== 12 || quarters.length !== 4 || !Math.max(...quarters) || ordered.length < 3) return scores;
  const middle = Math.floor(ordered.length/2);
  const median = ordered.length%2 ? ordered[middle] : (ordered[middle-1]+ordered[middle])/2;
  for (const [key, offer] of offers) {
    const month = Number(key.slice(5));
    if (!Number.isInteger(month) || month<1 || month>12 || !(offer.minor>0)) continue;
    const fare = Math.max(0,Math.min(10,5 + 10*(1-offer.minor/median)));
    const demand = 10*(1-quarters[Math.floor((month-1)/3)]/Math.max(...quarters));
    scores.set(month,Math.round(.5*walk[month-1]+.2*demand+.3*fare));
  }
  return scores;
}
