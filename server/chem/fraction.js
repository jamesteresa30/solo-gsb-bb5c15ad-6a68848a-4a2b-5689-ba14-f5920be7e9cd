// 精确有理数（基于 BigInt），用于高斯消元，避免浮点误差。

export function gcdAbs(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

export class Frac {
  constructor(n, d = 1n) {
    n = BigInt(n);
    d = BigInt(d);
    if (d === 0n) throw new Error('分母不能为 0');
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcdAbs(n, d) || 1n;
    this.n = n / g;
    this.d = d / g;
  }

  static of(x) {
    return x instanceof Frac ? x : new Frac(x);
  }

  add(o) {
    o = Frac.of(o);
    return new Frac(this.n * o.d + o.n * this.d, this.d * o.d);
  }

  sub(o) {
    o = Frac.of(o);
    return new Frac(this.n * o.d - o.n * this.d, this.d * o.d);
  }

  mul(o) {
    o = Frac.of(o);
    return new Frac(this.n * o.n, this.d * o.d);
  }

  div(o) {
    o = Frac.of(o);
    if (o.n === 0n) throw new Error('除以零');
    return new Frac(this.n * o.d, this.d * o.n);
  }

  neg() {
    return new Frac(-this.n, this.d);
  }

  isZero() {
    return this.n === 0n;
  }

  sign() {
    return this.n > 0n ? 1 : this.n < 0n ? -1 : 0;
  }
}
