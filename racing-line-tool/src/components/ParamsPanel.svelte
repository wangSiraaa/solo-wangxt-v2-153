<script lang="ts">
  import { onMount } from 'svelte';
  import { appState } from '../lib/store/appState.svelte';
  import { SAMPLES } from '../lib/core/samples';

  const v = $derived(appState.vehicle);

  function setVeh(key: keyof typeof v, value: number | boolean) {
    appState.vehicle = { ...appState.vehicle, [key]: value };
  }

  onMount(() => {
    appState.refreshList().catch(() => (appState.statusMsg = 'IndexedDB 不可用'));
  });
</script>

<div class="panel">
  <section>
    <h3>样例赛道</h3>
    <div class="row">
      {#each SAMPLES as s, i}
        <button onclick={() => appState.loadSample(i)}>{s.name}</button>
      {/each}
    </div>
  </section>

  <section>
    <h3>车辆参数（质点模型）</h3>
    <label>横向加速度 a_lat (m/s²) <input type="number" step="0.5" value={v.aLatMax} oninput={(e) => setVeh('aLatMax', +e.currentTarget.value)} /></label>
    <label>纵向加速 a_acc (m/s²) <input type="number" step="0.5" value={v.aAccel} oninput={(e) => setVeh('aAccel', +e.currentTarget.value)} /></label>
    <label>制动减速 a_brk (m/s²) <input type="number" step="0.5" value={v.aBrake} oninput={(e) => setVeh('aBrake', +e.currentTarget.value)} /></label>
    <label>极速 v_max (m/s) <input type="number" step="1" value={v.vMax} oninput={(e) => setVeh('vMax', +e.currentTarget.value)} /></label>
    <label class="chk"><input type="checkbox" checked={v.frictionEllipse} onchange={(e) => setVeh('frictionEllipse', e.currentTarget.checked)} /> 摩擦圆（横纵耦合）</label>
    <label>求解网格 ds (m)
      <select value={appState.ds} onchange={(e) => (appState.ds = +e.currentTarget.value)}>
        <option value={2}>2.0</option>
        <option value={1}>1.0</option>
        <option value={0.5}>0.5</option>
        <option value={0.25}>0.25</option>
      </select>
    </label>
  </section>

  {#if appState.selectedCp !== null && appState.track.points[appState.selectedCp]}
    <section>
      <h3>选中控制点 #{appState.selectedCp}</h3>
      <label>
        赛道宽度 (m)
        <input
          type="number"
          step="0.5"
          min="4"
          value={appState.track.points[appState.selectedCp].width}
          oninput={(e) => {
            const i = appState.selectedCp!;
            const pts = [...appState.track.points];
            pts[i] = { ...pts[i], width: Math.max(2, +e.currentTarget.value) };
            appState.track = { ...appState.track, points: pts };
          }}
        />
      </label>
    </section>
  {/if}

  <section>
    <h3>赛车线</h3>
    <div class="row">
      <button onclick={() => appState.optimizeLine()}>优化线路</button>
      <button onclick={() => appState.resetLine()}>重置为中心线</button>
    </div>
  </section>

  <section>
    <h3>工程（IndexedDB）</h3>
    <label>工程名 <input type="text" bind:value={appState.projectName} /></label>
    <div class="row">
      <button onclick={() => appState.save()}>保存</button>
    </div>
    <ul class="projects">
      {#each appState.savedProjects as name}
        <li>
          <span>{name}</span>
          <button onclick={() => appState.load(name)}>载入</button>
          <button onclick={() => appState.remove(name)}>删除</button>
        </li>
      {:else}
        <li class="empty">暂无已存工程</li>
      {/each}
    </ul>
    {#if appState.statusMsg}<p class="status">{appState.statusMsg}</p>{/if}
  </section>
</div>

<style>
  .panel { overflow-y: auto; height: 100%; padding: 10px; font-size: 13px; color: #dde3ec; }
  section { margin-bottom: 14px; border-bottom: 1px solid #2c333f; padding-bottom: 10px; }
  h3 { margin: 0 0 8px; font-size: 12px; color: #8fa1bb; text-transform: uppercase; letter-spacing: 0.05em; }
  label { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin: 5px 0; }
  label.chk { justify-content: flex-start; }
  input[type='number'], input[type='text'], select {
    width: 90px; background: #161a21; color: #dde3ec; border: 1px solid #3d4552; border-radius: 4px; padding: 3px 6px;
  }
  input[type='text'] { width: 130px; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; }
  button { background: #2e3540; color: #dde3ec; border: 1px solid #3d4552; border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
  button:hover { background: #39424f; }
  .projects { list-style: none; margin: 8px 0 0; padding: 0; }
  .projects li { display: flex; gap: 6px; align-items: center; margin: 4px 0; }
  .projects li span { flex: 1; overflow: hidden; text-overflow: ellipsis; }
  .projects .empty { color: #7a828f; }
  .status { color: #7fd08a; font-size: 12px; margin: 6px 0 0; }
</style>
