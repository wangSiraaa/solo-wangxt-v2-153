import { describe, it, expect } from 'vitest';
import { appState } from '../src/lib/store/appState.svelte';
import { lineWithinBounds } from '../src/lib/core/racingLine';
import { CenterlineGeometry } from '../src/lib/core/geometry';

/**
 * 状态层集成测试：验证 runes 派生链（编辑 → 几何 → 求解 → 报表）联动正确。
 * 不依赖 DOM / WebGL。
 */
describe('应用状态派生链', () => {
  it('切换样例后求解结果自动更新', () => {
    appState.loadSample(0); // 直道接急弯
    expect(appState.track.closed).toBe(false);
    expect(appState.centerSol.lapTime).toBeGreaterThan(0);
    expect(appState.lineSol.lapTime).toBeGreaterThan(0);
    expect(appState.segmentReport.length).toBe(appState.track.points.length - 1);

    appState.loadSample(1); // 闭合环路
    expect(appState.track.closed).toBe(true);
    expect(appState.segmentReport.length).toBe(appState.track.points.length);
  });

  it('优化线路：偏移在边界内且圈时不劣于中心线', () => {
    appState.loadSample(2); // 宽窄变化
    appState.optimizeLine();
    expect(lineWithinBounds(appState.center, appState.offsets)).toBe(true);
    expect(appState.lineSol.lapTime).toBeLessThanOrEqual(appState.centerSol.lapTime * 1.001);
  });

  it('手动写入越界偏移会被钳制回边界', () => {
    appState.loadSample(2);
    const crazy = appState.offsets.map((_, i) => (i % 2 ? 1e6 : -1e6));
    appState.setOffsets(crazy);
    expect(lineWithinBounds(appState.center, appState.offsets)).toBe(true);
  });

  it('修改车辆参数与网格间距会改变求解结果', () => {
    appState.loadSample(1);
    const t0 = appState.lineSol.lapTime;
    appState.vehicle = { ...appState.vehicle, aLatMax: appState.vehicle.aLatMax * 1.5 };
    const t1 = appState.lineSol.lapTime;
    expect(t1).toBeLessThan(t0); // 横向极限提高 → 圈时下降
    appState.ds = 1;
    const t2 = appState.lineSol.lapTime;
    // 网格变化后结果仍在 2% 内稳定
    expect(Math.abs(t2 - t1) / t1).toBeLessThan(0.02);
  });

  it('逐段报表耗时之和等于当前解圈时', () => {
    appState.ds = 0.5;
    const sum = appState.segmentReport.reduce((a, r) => a + r.time, 0);
    expect(sum).toBeCloseTo(appState.activeSol.lapTime, 6);
  });

  it('编辑控制点（移动/宽度）后几何与解保持有效', () => {
    appState.loadSample(1);
    const pts = [...appState.track.points];
    pts[0] = { ...pts[0], x: pts[0].x + 30, width: 20 };
    appState.track = { ...appState.track, points: pts };
    expect(appState.center.length).toBeGreaterThan(0);
    expect(appState.lineSol.lapTime).toBeGreaterThan(0);
    // 线路仍然合法（钳制随几何自动重算）
    expect(lineWithinBounds(appState.center, appState.offsets)).toBe(true);
    const geom = new CenterlineGeometry(appState.track);
    expect(geom.length).toBeCloseTo(appState.center.length, 9);
  });
});
