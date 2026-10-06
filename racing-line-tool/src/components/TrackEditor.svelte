<script lang="ts">
  import { onMount } from 'svelte';
  import { appState } from '../lib/store/appState.svelte';
  import { offsetBoundsAt, LINE_STATIONS, stationTau } from '../lib/core/racingLine';
  import type { Vec2 } from '../lib/core/types';

  /** 编辑模式：赛道控制点 / 赛车线站点 */
  let mode = $state<'track' | 'line'>('track');
  let canvas: HTMLCanvasElement;
  let wrap: HTMLDivElement;

  // 视图变换：世界 → 屏幕（y 轴翻转）
  const view = { cx: 0, cy: 0, scale: 1 };
  let fitted = false;

  interface DragState {
    kind: 'pan' | 'cp' | 'line';
    index: number;
    startX: number;
    startY: number;
    moved: boolean;
  }
  let drag: DragState | null = null;

  const HANDLE_EVERY = 16; // 线路手柄：每 16 个站点一个

  function toScreen(p: Vec2, w: number, h: number): Vec2 {
    return { x: (p.x - view.cx) * view.scale + w / 2, y: h / 2 - (p.y - view.cy) * view.scale };
  }
  function toWorld(sx: number, sy: number, w: number, h: number): Vec2 {
    return { x: (sx - w / 2) / view.scale + view.cx, y: (h / 2 - sy) / view.scale + view.cy };
  }

  function fitView() {
    const pts = appState.track.points;
    if (!pts.length || !canvas) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const w = canvas.clientWidth || 800;
    const h = canvas.clientHeight || 500;
    const bw = Math.max(50, maxX - minX + 60);
    const bh = Math.max(50, maxY - minY + 60);
    view.scale = Math.min(w / bw, h / bh);
    view.cx = (minX + maxX) / 2;
    view.cy = (minY + maxY) / 2;
  }

  function lineHandlePos(i: number): Vec2 {
    const L = appState.center.length;
    const s = stationTau(i, appState.center.closed) * L;
    const g = appState.center.eval(s);
    const o = appState.offsets[i];
    return { x: g.x + g.nx * o, y: g.y + g.ny * o };
  }

  function draw() {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = (canvas.width = canvas.clientWidth * devicePixelRatio);
    const h = (canvas.height = canvas.clientHeight * devicePixelRatio);
    ctx.scale(devicePixelRatio, devicePixelRatio);
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    if (!fitted) { fitView(); fitted = true; }

    ctx.fillStyle = '#191d24';
    ctx.fillRect(0, 0, W, H);

    const st = appState.trackSampled;
    // 赛道区域（边界多边形填充）
    ctx.beginPath();
    const { left, right } = boundariesOf(st);
    left.forEach((p, i) => { const s = toScreen(p, W, H); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
    for (let i = right.length - 1; i >= 0; i--) { const s = toScreen(right[i], W, H); ctx.lineTo(s.x, s.y); }
    ctx.closePath();
    ctx.fillStyle = '#3a3f4a';
    ctx.fill();
    ctx.strokeStyle = '#e8e8e8';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 中心线
    ctx.beginPath();
    st.pts.forEach((p, i) => { const s = toScreen(p, W, H); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
    if (st.closed) ctx.closePath();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = '#7a828f';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);

    // 赛车线
    const lp = appState.lineGeom.pts;
    ctx.beginPath();
    lp.forEach((p, i) => { const s = toScreen(p, W, H); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
    if (appState.lineGeom.closed) ctx.closePath();
    ctx.strokeStyle = '#ffcf40';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 控制点
    appState.track.points.forEach((p, i) => {
      const s = toScreen(p, W, H);
      ctx.beginPath();
      ctx.arc(s.x, s.y, i === appState.selectedCp ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = i === appState.selectedCp ? '#4da3ff' : '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#222';
      ctx.stroke();
      if (mode === 'track') {
        ctx.fillStyle = '#9fb4cc';
        ctx.font = '10px sans-serif';
        ctx.fillText(`${i}`, s.x + 8, s.y - 6);
      }
    });

    // 线路手柄
    if (mode === 'line') {
      for (let i = 0; i < LINE_STATIONS; i += HANDLE_EVERY) {
        const s = toScreen(lineHandlePos(i), W, H);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#ff9f40';
        ctx.fill();
        ctx.strokeStyle = '#222';
        ctx.stroke();
      }
    }
  }

  function boundariesOf(st: typeof appState.trackSampled) {
    const left: Vec2[] = [];
    const right: Vec2[] = [];
    for (const p of st.pts) {
      left.push({ x: p.x + p.nx * p.halfWidthL, y: p.y + p.ny * p.halfWidthL });
      right.push({ x: p.x - p.nx * p.halfWidthR, y: p.y - p.ny * p.halfWidthR });
    }
    return { left, right };
  }

  function hitCp(sx: number, sy: number, W: number, H: number): number {
    let best = -1;
    let bestD = 12;
    appState.track.points.forEach((p, i) => {
      const s = toScreen(p, W, H);
      const d = Math.hypot(s.x - sx, s.y - sy);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  function hitLineHandle(sx: number, sy: number, W: number, H: number): number {
    let best = -1;
    let bestD = 12;
    for (let i = 0; i < LINE_STATIONS; i += HANDLE_EVERY) {
      const s = toScreen(lineHandlePos(i), W, H);
      const d = Math.hypot(s.x - sx, s.y - sy);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function onPointerDown(e: PointerEvent) {
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (e.button === 2) return; // 右键删除在 contextmenu 处理
    if (mode === 'track') {
      const i = hitCp(e.offsetX, e.offsetY, W, H);
      if (i >= 0) {
        appState.selectedCp = i;
        drag = { kind: 'cp', index: i, startX: e.offsetX, startY: e.offsetY, moved: false };
        return;
      }
    } else {
      const i = hitLineHandle(e.offsetX, e.offsetY, W, H);
      if (i >= 0) {
        drag = { kind: 'line', index: i, startX: e.offsetX, startY: e.offsetY, moved: false };
        return;
      }
    }
    drag = { kind: 'pan', index: -1, startX: e.offsetX, startY: e.offsetY, moved: false };
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag) return;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const dx = e.offsetX - drag.startX;
    const dy = e.offsetY - drag.startY;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    if (drag.kind === 'pan') {
      view.cx -= dx / view.scale;
      view.cy += dy / view.scale;
      drag.startX = e.offsetX;
      drag.startY = e.offsetY;
    } else if (drag.kind === 'cp') {
      const p = toWorld(e.offsetX, e.offsetY, W, H);
      const pts = [...appState.track.points];
      pts[drag.index] = { ...pts[drag.index], x: p.x, y: p.y };
      appState.track = { ...appState.track, points: pts };
    } else if (drag.kind === 'line') {
      // 投影到该站点的法向上，钳制到边界内
      const L = appState.center.length;
      const s = stationTau(drag.index, appState.center.closed) * L;
      const g = appState.center.eval(s);
      const m = toWorld(e.offsetX, e.offsetY, W, H);
      const o = (m.x - g.x) * g.nx + (m.y - g.y) * g.ny;
      const [lo, hi] = offsetBoundsAt(appState.center, drag.index);
      const next = [...appState.offsets];
      next[drag.index] = Math.min(hi, Math.max(lo, o));
      appState.setOffsets(next);
    }
  }

  function onPointerUp() { drag = null; }

  function onDblClick(e: MouseEvent) {
    if (mode !== 'track') return;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const p = toWorld(e.offsetX, e.offsetY, W, H);
    const pts = appState.track.points;
    const closed = appState.track.closed;
    // 找最近控制点段，插入新点
    let best = 0;
    let bestD = Infinity;
    const segCount = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < segCount; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const vx = b.x - a.x, vy = b.y - a.y;
      const L2 = vx * vx + vy * vy || 1;
      const t = Math.min(1, Math.max(0, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2));
      const d = Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
      if (d < bestD) { bestD = d; best = i; }
    }
    const w0 = pts[best].width;
    const w1 = pts[(best + 1) % pts.length].width;
    const next = [...pts];
    next.splice(best + 1, 0, { x: p.x, y: p.y, width: (w0 + w1) / 2 });
    appState.track = { ...appState.track, points: next };
    appState.selectedCp = best + 1;
  }

  function onContextMenu(e: MouseEvent) {
    e.preventDefault();
    if (mode !== 'track') return;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const i = hitCp(e.offsetX, e.offsetY, W, H);
    const minPts = appState.track.closed ? 3 : 2;
    if (i >= 0 && appState.track.points.length > minPts) {
      const next = [...appState.track.points];
      next.splice(i, 1);
      appState.track = { ...appState.track, points: next };
      appState.selectedCp = null;
    }
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const k = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    view.scale = Math.min(50, Math.max(0.05, view.scale * k));
  }

  onMount(() => {
    const ro = new ResizeObserver(() => draw());
    ro.observe(wrap);
    return () => ro.disconnect();
  });

  $effect(() => {
    // 依赖追踪：任何相关状态变化都触发重绘
    appState.track;
    appState.offsets;
    appState.lineGeom;
    appState.trackSampled;
    appState.selectedCp;
    mode;
    draw();
  });

  // 切换样例 / 载入工程时重新取景
  $effect(() => {
    appState.fitToken;
    fitted = false;
  });
</script>

<div class="editor" bind:this={wrap}>
  <div class="toolbar">
    <button class:active={mode === 'track'} onclick={() => (mode = 'track')}>编辑赛道</button>
    <button class:active={mode === 'line'} onclick={() => (mode = 'line')}>编辑线路</button>
    <label class="closed-toggle" title={appState.track.points.length < 3 ? '闭合至少需要 3 个控制点' : ''}>
      <input
        type="checkbox"
        checked={appState.track.closed}
        disabled={!appState.track.closed && appState.track.points.length < 3}
        onchange={(e) => (appState.track = { ...appState.track, closed: e.currentTarget.checked })}
      />
      闭合首尾
    </label>
    <button onclick={() => { fitted = false; draw(); }}>适配视图</button>
    <span class="hint">拖动控点移动 · 双击加控点 · 右键删控点 · 滚轮缩放 · 空白拖拽平移</span>
  </div>
  <canvas
    bind:this={canvas}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    ondblclick={onDblClick}
    oncontextmenu={onContextMenu}
    onwheel={onWheel}
  ></canvas>
</div>

<style>
  .editor { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .toolbar { display: flex; gap: 8px; align-items: center; padding: 6px 8px; background: #21262f; font-size: 12px; flex-wrap: wrap; }
  .toolbar button { background: #2e3540; color: #dde3ec; border: 1px solid #3d4552; border-radius: 4px; padding: 3px 10px; cursor: pointer; }
  .toolbar button.active { background: #4da3ff; color: #10131a; border-color: #4da3ff; }
  .closed-toggle { display: flex; gap: 4px; align-items: center; color: #c6cedb; }
  .hint { color: #7a828f; margin-left: auto; }
  canvas { flex: 1; min-height: 0; touch-action: none; cursor: crosshair; }
</style>
