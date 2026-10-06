<script lang="ts">
  import { appState } from '../lib/store/appState.svelte';
  import type { ConstraintKind } from '../lib/core/types';

  let chart: HTMLCanvasElement;

  const CONSTRAINT_META: Record<ConstraintKind, { label: string; color: string }> = {
    curvature: { label: '曲率', color: '#ff9f40' },
    acceleration: { label: '加速', color: '#6fce62' },
    braking: { label: '制动', color: '#ef5350' },
    topSpeed: { label: '极速', color: '#4da3ff' }
  };

  function drawChart() {
    if (!chart) return;
    const sol = appState.activeSol;
    const L = appState.center.length;
    const ctx = chart.getContext('2d');
    if (!ctx) return;
    const W = (chart.width = chart.clientWidth * devicePixelRatio);
    const H = (chart.height = chart.clientHeight * devicePixelRatio);
    ctx.scale(devicePixelRatio, devicePixelRatio);
    const w = chart.clientWidth;
    const h = chart.clientHeight;
    const padL = 42;
    const padB = 20;
    const padT = 8;
    const padR = 8;

    ctx.fillStyle = '#191d24';
    ctx.fillRect(0, 0, w, h);
    const n = sol.v.length;
    let vMax = 0;
    for (const v of sol.vCurve) vMax = Math.max(vMax, v);
    vMax = Math.max(vMax, 1) * 1.05;
    const x = (i: number) => padL + ((i * sol.ds) / L) * (w - padL - padR);
    const y = (v: number) => h - padB - (v / vMax) * (h - padB - padT);

    // 约束色带
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = CONSTRAINT_META[sol.constraint[i]].color + '2e';
      const x0 = x(i);
      ctx.fillRect(x0, padT, Math.max(1, x(i + 1) - x0), h - padB - padT);
    }
    // 坐标轴
    ctx.strokeStyle = '#3d4552';
    ctx.beginPath();
    ctx.moveTo(padL, padT);
    ctx.lineTo(padL, h - padB);
    ctx.lineTo(w - padR, h - padB);
    ctx.stroke();
    ctx.fillStyle = '#7a828f';
    ctx.font = '10px sans-serif';
    for (let vv = 0; vv <= vMax; vv += 10) {
      ctx.fillText(`${vv}`, 6, y(vv) + 3);
      ctx.strokeStyle = '#262c36';
      ctx.beginPath();
      ctx.moveTo(padL, y(vv));
      ctx.lineTo(w - padR, y(vv));
      ctx.stroke();
    }
    ctx.fillText('v (m/s)', 4, padT + 4);
    ctx.fillText('s (m) →', w - 60, h - 6);

    // 曲率上限（虚线）
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    for (let i = 0; i < n; i++) {
      const px = x(i);
      const py = y(sol.vCurve[i]);
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.strokeStyle = '#8a93a3';
    ctx.stroke();
    ctx.setLineDash([]);

    // 速度剖面
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const px = x(i);
      const py = y(sol.v[i]);
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.strokeStyle = '#ffcf40';
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  $effect(() => {
    appState.activeSol;
    appState.activeLine;
    drawChart();
  });

  const fmt = (t: number) => t.toFixed(3);
</script>

<div class="results">
  <div class="lapbar">
    <label>
      显示：
      <select bind:value={appState.activeLine}>
        <option value="racing">赛车线</option>
        <option value="center">中心线</option>
      </select>
    </label>
    <span class="lap">赛车线圈时 <b>{fmt(appState.lineSol.lapTime)} s</b></span>
    <span class="lap">中心线圈时 <b>{fmt(appState.centerSol.lapTime)} s</b></span>
    <span class="lap delta" class:good={appState.lineSol.lapTime <= appState.centerSol.lapTime}>
      Δ {fmt(appState.lineSol.lapTime - appState.centerSol.lapTime)} s
    </span>
    <span class="legend">
      {#each Object.entries(CONSTRAINT_META) as [k, m]}
        <i style="background:{m.color}"></i>{m.label}
      {/each}
      <i class="dash"></i>曲率上限
    </span>
  </div>
  <canvas bind:this={chart}></canvas>
  <div class="tablewrap">
    <table>
      <thead>
        <tr><th>段</th><th>长度 m</th><th>耗时 s</th><th>累计 s</th><th>主导约束</th><th>约束分布（采样点数）</th></tr>
      </thead>
      <tbody>
        {#each appState.segmentReport as seg}
          {@const cum = appState.segmentReport.slice(0, seg.index + 1).reduce((a, r) => a + r.time, 0)}
          <tr>
            <td>{seg.index}</td>
            <td>{seg.length.toFixed(1)}</td>
            <td>{fmt(seg.time)}</td>
            <td>{fmt(cum)}</td>
            <td>
              <span class="tag" style="background:{CONSTRAINT_META[seg.dominant].color}">
                {CONSTRAINT_META[seg.dominant].label}
              </span>
            </td>
            <td class="counts">
              {#each Object.entries(seg.counts) as [k, c]}
                {#if c > 0}
                  <span style="color:{CONSTRAINT_META[k as ConstraintKind].color}">{CONSTRAINT_META[k as ConstraintKind].label} {c}</span>
                {/if}
              {/each}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .results { display: flex; flex-direction: column; height: 100%; min-height: 0; font-size: 12px; color: #dde3ec; }
  .lapbar { display: flex; gap: 14px; align-items: center; padding: 6px 10px; background: #21262f; flex-wrap: wrap; }
  .lap b { color: #ffcf40; }
  .delta { color: #ef5350; }
  .delta.good { color: #6fce62; }
  .legend { display: flex; gap: 8px; align-items: center; margin-left: auto; color: #9fb4cc; }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 2px; }
  .legend i.dash { width: 14px; height: 0; border-top: 2px dashed #8a93a3; }
  select { background: #161a21; color: #dde3ec; border: 1px solid #3d4552; border-radius: 4px; padding: 2px 6px; }
  canvas { height: 150px; flex: none; }
  .tablewrap { flex: 1; overflow-y: auto; min-height: 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 3px 8px; text-align: left; border-bottom: 1px solid #262c36; white-space: nowrap; }
  th { position: sticky; top: 0; background: #21262f; color: #8fa1bb; }
  .tag { padding: 1px 8px; border-radius: 8px; color: #10131a; font-weight: 600; }
  .counts span { margin-right: 8px; }
</style>
