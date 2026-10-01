// Visiting order for one day: nearest neighbour, then 2-opt improvement. A good,
// fast heuristic, NOT a guaranteed optimum. Pure: `cost(a, b)` returns travel seconds.

export const ROUTE_ALGORITHM = 'nearest-neighbor+2opt';

export function routeCost(start, order, cost, returnToStart) {
  let total = 0;
  let previous = start;
  for (const stop of order) {
    total += cost(previous, stop);
    previous = stop;
  }
  if (returnToStart && order.length > 0) total += cost(previous, start);
  return total;
}

export function nearestNeighbor(start, stops, cost) {
  const remaining = [...stops];
  const order = [];
  let current = start;
  while (remaining.length > 0) {
    let bestIndex = 0;
    for (let i = 1; i < remaining.length; i += 1) {
      if (cost(current, remaining[i]) < cost(current, remaining[bestIndex])) bestIndex = i;
    }
    [current] = remaining.splice(bestIndex, 1);
    order.push(current);
  }
  return order;
}

// Reverses segments while that shortens the route. Days have ≤ ~6 stops, so recomputing
// the whole route cost per candidate is cheap and works for asymmetric costs too.
export function twoOpt(start, order, cost, returnToStart) {
  let best = order;
  let bestCost = routeCost(start, best, cost, returnToStart);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i += 1) {
      for (let k = i + 1; k < best.length; k += 1) {
        const candidate = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
        const candidateCost = routeCost(start, candidate, cost, returnToStart);
        if (candidateCost < bestCost) {
          best = candidate;
          bestCost = candidateCost;
          improved = true;
        }
      }
    }
  }
  return best;
}

export function optimizeOrder(start, stops, cost, { returnToStart }) {
  return twoOpt(start, nearestNeighbor(start, stops, cost), cost, returnToStart);
}
