import { total } from '../src/checkout.js';
if (total(10, 2) !== 12) throw new Error('Incorrect total');
