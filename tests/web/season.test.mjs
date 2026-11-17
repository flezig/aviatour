import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tripScores } from '../../web/js/lib/season-scores.js';

test('один маршрут, цена ниже медианы повышает балл только при достаточной выборке', () => {
  const walk = Array(12).fill(8), traffic = [100,100,100,100];
  const offers = [50,100,150].map((minor,i)=>['2027-0'+(i+1),{minor}]);
  assert.deepEqual([...tripScores(walk,traffic,offers).values()],[7,6,4]);
  assert.equal(tripScores(walk,traffic,offers.slice(0,2)).size,0);
  assert.equal(tripScores(walk,traffic,offers).has(4),false);
});
