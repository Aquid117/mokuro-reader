import { describe, it, expect } from 'vitest';
import { detectPanel, generousCrop, type Gray } from './panel-crop';

/** White page with black-bordered panels (border 3 px) separated by white gutters. */
function page(w: number, h: number, panels: [number, number, number, number][], fill = 200): Gray {
  const data = new Uint8Array(w * h).fill(255);
  for (const [x0, y0, x1, y1] of panels) {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const border = x < x0 + 3 || x >= x1 - 3 || y < y0 + 3 || y >= y1 - 3;
        data[y * w + x] = border ? 0 : fill;
      }
  }
  return { data, width: w, height: h };
}

describe('panel detection', () => {
  // 600x900 page: top panel spanning the width, two panels below side by side
  const panels: [number, number, number, number][] = [
    [20, 20, 580, 300],
    [20, 320, 290, 880],
    [310, 320, 580, 880]
  ];

  it('finds the panel that contains the bubble', () => {
    const g = page(600, 900, panels);
    const r = detectPanel(g, [350, 400, 420, 520]);
    expect(r[0]).toBeGreaterThanOrEqual(300);
    expect(r[0]).toBeLessThanOrEqual(312);
    expect(r[2]).toBeGreaterThanOrEqual(578);
    expect(r[1]).toBeGreaterThanOrEqual(312);
    expect(r[1]).toBeLessThanOrEqual(322);
    expect(r[3]).toBeGreaterThanOrEqual(878);
  });

  it('finds the wide top panel', () => {
    const g = page(600, 900, panels);
    const r = detectPanel(g, [100, 60, 160, 200]);
    expect(r[1]).toBeLessThanOrEqual(22);
    expect(r[3]).toBeGreaterThanOrEqual(298);
    expect(r[3]).toBeLessThanOrEqual(310);
    expect(r[2] - r[0]).toBeGreaterThan(540);
  });

  it('keeps white panel interiors from stopping the search early', () => {
    const g = page(600, 900, panels, 255); // panel interiors are pure white
    const r = detectPanel(g, [350, 400, 420, 520]);
    expect(r[0]).toBeLessThanOrEqual(312);
    expect(r[2]).toBeGreaterThanOrEqual(578);
  });

  it('falls back to a generous crop on a borderless full-page image', () => {
    const g: Gray = { data: new Uint8Array(600 * 900).fill(128), width: 600, height: 900 };
    const r = detectPanel(g, [280, 400, 320, 480]);
    expect(r).toEqual(generousCrop(600, 900, [280, 400, 320, 480]));
    expect(r[2] - r[0]).toBeGreaterThanOrEqual(240);
  });
});
