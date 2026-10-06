<script lang="ts">
  import { onMount } from 'svelte';
  import { appState } from '../lib/store/appState.svelte';
  import { TrackScene } from '../lib/three/scene';

  let container: HTMLDivElement;
  // 注意：scene 在 onMount 中创建，必须是响应式状态，否则首批 $effect 不会重跑
  let scene = $state<TrackScene | null>(null);
  let playing = $state(true);
  let timeScale = $state(1);

  onMount(() => {
    scene = new TrackScene(container);
    const ro = new ResizeObserver(() => scene?.resize());
    ro.observe(container);
    return () => {
      ro.disconnect();
      scene?.dispose();
      scene = null;
    };
  });

  $effect(() => {
    if (scene) {
      scene.playing = playing;
      scene.timeScale = timeScale;
    }
  });

  // 赛道几何变化 → 重建场景中的赛道；样例/工程切换时重新取景
  let lastFit = -1;
  $effect(() => {
    const st = appState.trackSampled;
    const ft = appState.fitToken;
    const frame = ft !== lastFit;
    lastFit = ft;
    scene?.setTrack(st, frame);
  });

  // 线路 / 速度解变化 → 更新着色线路与车辆路径
  $effect(() => {
    const lg = appState.lineGeom;
    const sol = appState.activeSol;
    scene?.setLine(lg, sol);
    scene?.setCarPath(lg, sol);
  });
</script>

<div class="view">
  <div class="overlay">
    <label><input type="checkbox" bind:checked={playing} /> 播放</label>
    <label>
      速度
      <input type="range" min="0.25" max="4" step="0.25" bind:value={timeScale} />
    </label>
    <span class="tip">拖拽旋转 · 滚轮缩放（动画仅作直观参考，数值以测试与报表为准）</span>
  </div>
  <div class="canvas" bind:this={container}></div>
</div>

<style>
  .view { position: relative; height: 100%; min-height: 0; display: flex; flex-direction: column; }
  .canvas { flex: 1; min-height: 0; }
  .overlay {
    position: absolute; top: 6px; left: 8px; z-index: 2;
    display: flex; gap: 12px; align-items: center;
    background: rgba(20, 23, 28, 0.75); border-radius: 6px; padding: 4px 10px;
    font-size: 12px; color: #c6cedb;
  }
  .tip { color: #7a828f; }
</style>
