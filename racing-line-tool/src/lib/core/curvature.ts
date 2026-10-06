import { matrix, multiply, add, subtract, dotDivide, dotMultiply, dotPow, type Matrix } from 'mathjs';
import type { Vec2 } from './types';

/**
 * 用 mathjs 矩阵运算在均匀弧长采样折线上计算有符号曲率。
 * 中心差分：x'、x''；κ = (x'·y'' − y'·x'') / (x'² + y'²)^(3/2)
 * 闭合曲线索引回绕；开放曲线端点用单侧差分。
 */
export function computeCurvature(pts: Vec2[], ds: number, closed: boolean): Float64Array {
  const n = pts.length;
  const xs = matrix(pts.map((p) => p.x));
  const ys = matrix(pts.map((p) => p.y));

  const roll = (m: Matrix, k: number): Matrix => {
    const a = m.toArray() as number[];
    const out = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      let j = i + k;
      if (closed) j = ((j % n) + n) % n;
      else j = Math.min(n - 1, Math.max(0, j));
      out[i] = a[j];
    }
    return matrix(out);
  };

  // 一阶中心差分 / (2ds)，二阶中心差分 / ds²
  const x1 = dotDivide(subtract(roll(xs, 1), roll(xs, -1)), 2 * ds) as Matrix;
  const y1 = dotDivide(subtract(roll(ys, 1), roll(ys, -1)), 2 * ds) as Matrix;
  const x2 = dotDivide(subtract(add(roll(xs, 1), roll(xs, -1)) as Matrix, multiply(2, xs) as Matrix), ds * ds) as Matrix;
  const y2 = dotDivide(subtract(add(roll(ys, 1), roll(ys, -1)) as Matrix, multiply(2, ys) as Matrix), ds * ds) as Matrix;

  const num = subtract(dotMultiply(x1, y2) as Matrix, dotMultiply(y1, x2) as Matrix);
  const speed2 = add(dotPow(x1, 2), dotPow(y1, 2)) as Matrix;
  const denom = dotPow(speed2, 1.5) as Matrix; // (x'²+y'²)^(3/2)
  const kappa = dotDivide(num, denom) as Matrix;

  return Float64Array.from(kappa.toArray() as number[]);
}
