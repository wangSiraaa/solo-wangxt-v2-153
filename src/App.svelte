<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type {
    AnalysisResult,
    EditLayer,
    SpeedLimitKind,
    StabilityResult,
    TrackControlPoint,
    TractionProject,
    VehicleModel
  } from './lib/types';
  import { buildTrackSurface } from './lib/geometry';
  import { analyzeRoute, checkSamplingStability } from './lib/speedProfile';
  import {
    closedLoopProject,
    makeRoutePoint,
    makeTrackPoint,
    straightHairpinProject,
    varyingWidthProject
  } from './lib/presets';
  import { deleteProject, downloadProject, importProjectFile, listProjects, saveProject } from './lib/storage';
  import { TrackScene } from './lib/trackScene';

  let project: TractionProject = straightHairpinProject();
  let savedProjects: TractionProject[] = [];
  let editLayer: EditLayer = 'route';
  let selectedId: string | null = null;
  let analysis: AnalysisResult | null = null;
  let stability: StabilityResult | null = null;
  let status = '';
  let viewport: HTMLDivElement;
  let scene: TrackScene;
  let playing = false;
  let animationTime = 0;
  let bindingFilter: SpeedLimitKind | 'all' = 'all';
  let segmentPage = 0;
  const pageSize = 120;
  let fileInput: HTMLInputElement;

  const limitLabels: Record<SpeedLimitKind, string> = {
    endpoint: '端点速度',
    maxSpeed: '车辆极速',
    curvature: '横向曲率',
    accelPropagation: '前方加速传播',
    brakePropagation: '前方制动传播'
  };

  const filterOptions: SpeedLimitKind[] = ['endpoint', 'maxSpeed', 'curvature', 'accelPropagation', 'brakePropagation'];

  const limitColors: Record<SpeedLimitKind, string> = {
    endpoint: '#7c3aed',
    maxSpeed: '#60a5fa',
    curvature: '#ef4444',
    accelPropagation: '#22c55e',
    brakePropagation: '#f97316'
  };

  function cloneProject(value: TractionProject): TractionProject {
    return {
      ...value,
      vehicle: { ...value.vehicle },
      trackPoints: value.trackPoints.map((p) => ({ ...p })),
      routePoints: value.routePoints.map((p) => ({ ...p }))
    };
  }

  function recompute(): void {
    if (!project) return;
    const closed = project.kind === 'closed';
    const surface = buildTrackSurface(project.trackPoints, project.samples, closed);
    analysis = analyzeRoute(surface, project.routePoints, project.vehicle, project.samples, closed);
    stability = null;
    scene?.update(project, surface, analysis);
    if (playing) setPlaying(false);
    animationTime = 0;
    scene?.setAnimationTime(0);
  }

  function patchProject(mutator: (draft: TractionProject) => void): void {
    const draft = cloneProject(project);
    mutator(draft);
    project = draft;
    recompute();
  }

  function updateVehicle(key: keyof VehicleModel, value: number): void {
    patchProject((draft) => {
      draft.vehicle[key] = value;
    });
  }

  function loadPreset(name: 'hairpin' | 'closed' | 'width'): void {
    selectedId = null;
    project =
      name === 'hairpin'
        ? straightHairpinProject()
        : name === 'closed'
          ? closedLoopProject()
          : varyingWidthProject();
    status = `已载入样例：${project.name}`;
    recompute();
  }

  async function persistProject(): Promise<void> {
    const saved = await saveProject(project);
    project = { ...project, updatedAt: saved.updatedAt };
    await refreshProjects();
    status = '工程已保存到 IndexedDB';
  }

  async function refreshProjects(): Promise<void> {
    savedProjects = await listProjects();
  }

  async function openProject(id: string): Promise<void> {
    const value = savedProjects.find((p) => p.id === id);
    if (!value) return;
    project = cloneProject(value);
    selectedId = null;
    status = `已打开：${project.name}`;
    recompute();
  }

  async function removeProject(id: string): Promise<void> {
    await deleteProject(id);
    await refreshProjects();
    status = '已删除工程';
  }

  function exportProject(): void {
    downloadProject(project);
  }

  async function importProject(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      project = await importProjectFile(file);
      selectedId = null;
      await refreshProjects();
      status = `已导入：${project.name}`;
      recompute();
    } catch (error) {
      status = error instanceof Error ? error.message : '导入失败';
    } finally {
      fileInput.value = '';
    }
  }

  function changeKind(value: string): void {
    patchProject((draft) => {
      draft.kind = value === 'closed' ? 'closed' : 'open';
    });
  }

  function addPoint(layer: EditLayer): void {
    const points = layer === 'track' ? project.trackPoints : project.routePoints;
    const anchor = points[points.length - 1] ?? { x: 0, y: 0 };
    patchProject((draft) => {
      if (layer === 'track') {
        draft.trackPoints.push(makeTrackPoint(anchor.x + 25, anchor.y + 10, (anchor as TrackControlPoint).width ?? 30));
        selectedId = draft.trackPoints.at(-1)!.id;
      } else {
        draft.routePoints.push(makeRoutePoint(anchor.x + 20, anchor.y));
        selectedId = draft.routePoints.at(-1)!.id;
      }
    });
  }

  function deleteSelected(): void {
    if (!selectedId) return;
    patchProject((draft) => {
      draft.trackPoints = draft.trackPoints.filter((p) => p.id !== selectedId);
      draft.routePoints = draft.routePoints.filter((p) => p.id !== selectedId);
    });
    selectedId = null;
  }

  function updateDraggedPoint(layer: EditLayer, id: string, x: number, y: number): void {
    const points = layer === 'track' ? project.trackPoints : project.routePoints;
    const point = points.find((p) => p.id === id);
    if (!point || (Math.abs(point.x - x) < 0.01 && Math.abs(point.y - y) < 0.01)) return;
    point.x = x;
    point.y = y;
    project = { ...project };
    recompute();
  }

  function setLayer(layer: EditLayer): void {
    editLayer = layer;
    scene.editLayer = layer;
    scene.renderOnce();
  }

  function setPlaying(value: boolean): void {
    playing = value;
    scene.setPlaying(value);
  }

  function setBindingFilter(kind: string): void {
    bindingFilter = kind as SpeedLimitKind | 'all';
    segmentPage = 0;
  }

  function runStability(): void {
    const surface = buildTrackSurface(project.trackPoints, project.samples, project.kind === 'closed');
    stability = checkSamplingStability(
      surface,
      project.routePoints,
      project.vehicle,
      project.samples,
      project.kind === 'closed',
      0.005
    );
  }

  $: tableRows = editLayer === 'track'
    ? project.trackPoints.map((point) => ({ id: point.id, x: point.x, y: point.y, width: point.width }))
    : project.routePoints.map((point) => ({ id: point.id, x: point.x, y: point.y, width: null }));

  $: selectedTrackPoint = project.trackPoints.find((p) => p.id === selectedId);
  $: selectedRoutePoint = project.routePoints.find((p) => p.id === selectedId);
  $: segments = analysis?.profile?.segments ?? [];
  $: allFilteredSegments = bindingFilter === 'all'
    ? segments
    : segments.filter((s) => s.binding === bindingFilter);
  $: segmentPageCount = Math.max(1, Math.ceil(allFilteredSegments.length / pageSize));
  $: segmentPage = Math.min(segmentPage, segmentPageCount - 1);
  $: filteredSegments = allFilteredSegments.slice(segmentPage * pageSize, (segmentPage + 1) * pageSize);

  $: bindingCounts = (() => {
    const counts = new Map<SpeedLimitKind, number>();
    for (const segment of segments) counts.set(segment.binding, (counts.get(segment.binding) ?? 0) + 1);
    return [...counts.entries()].map(([kind, count]) => ({ kind, count }));
  })();

  function numberOrZero(value: string): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function format(value: number | null | undefined, digits = 2): string {
    return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
  }

  function formatPercent(value: number | null | undefined): string {
    return typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(3)}%` : '—';
  }

  onMount(() => {
    scene = new TrackScene(viewport);
    scene.onPointDrag = updateDraggedPoint;
    scene.onSelect = (layer, id) => {
      editLayer = layer;
      selectedId = id;
    };
    scene.onPlayStateChange = (value, time) => {
      playing = value;
      animationTime = time;
    };
    recompute();
    refreshProjects();
  });

  onDestroy(() => scene?.dispose());

  $: if (scene) {
    scene.editLayer = editLayer;
    scene.selectedId = selectedId;
    scene.renderOnce();
  }
</script>

<div class="app-shell">
  <aside class="panel">
    <div class="section">
      <h2>离线赛线调参工具</h2>
      <div class="row-actions">
        <button on:click={() => loadPreset('hairpin')}>直道急弯</button>
        <button on:click={() => loadPreset('closed')}>闭合环道</button>
        <button on:click={() => loadPreset('width')}>宽窄变化</button>
      </div>
    </div>

    <div class="section">
      <h3>工程（IndexedDB，本地离线）</h3>
      <input bind:this={fileInput} type="file" accept="application/json" on:change={importProject} />
      <div class="row-actions">
        <button class="primary" on:click={persistProject}>保存</button>
        <button on:click={exportProject}>导出 JSON</button>
      </div>
      <div class="scroll-table">
        <table class="point-table">
          <tbody>
            {#each savedProjects as saved (saved.id)}
              <tr>
                <td>{saved.name}</td>
                <td><button on:click={() => openProject(saved.id)}>打开</button></td>
                <td><button class="danger" on:click={() => removeProject(saved.id)}>删</button></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if status}<p class="small muted">{status}</p>{/if}
    </div>

    <div class="section">
      <h3>工程与车辆模型</h3>
      <label>
        工程名称
        <input value={project.name} on:input={(e) => patchProject((d) => (d.name = e.currentTarget.value))} />
      </label>
      <label>
        路线类型
        <select value={project.kind} on:change={(e) => changeKind(e.currentTarget.value)}>
          <option value="open">开放路线（固定首尾速度）</option>
          <option value="closed">闭合圈道（周期传播）</option>
        </select>
      </label>
      <label>
        采样数：{project.samples}
        <input
          type="range"
          min="120"
          max="960"
          step="60"
          value={project.samples}
          on:input={(e) => patchProject((d) => (d.samples = Number(e.currentTarget.value)))}
        />
      </label>
      <div class="form-grid">
        <label>加速 m/s²<input type="number" value={project.vehicle.accel} on:input={(e) => updateVehicle('accel', numberOrZero(e.currentTarget.value))} /></label>
        <label>制动 m/s²<input type="number" value={project.vehicle.brake} on:input={(e) => updateVehicle('brake', numberOrZero(e.currentTarget.value))} /></label>
        <label>横向 m/s²<input type="number" value={project.vehicle.lateralG} on:input={(e) => updateVehicle('lateralG', numberOrZero(e.currentTarget.value))} /></label>
        <label>极速 m/s<input type="number" value={project.vehicle.maxSpeed} on:input={(e) => updateVehicle('maxSpeed', numberOrZero(e.currentTarget.value))} /></label>
        {#if project.kind === 'open'}
          <label>起点速度<input type="number" value={project.vehicle.startSpeed} on:input={(e) => updateVehicle('startSpeed', numberOrZero(e.currentTarget.value))} /></label>
          <label>终点速度<input type="number" value={project.vehicle.endSpeed} on:input={(e) => updateVehicle('endSpeed', numberOrZero(e.currentTarget.value))} /></label>
        {/if}
      </div>
    </div>

    <div class="section">
      <h3>选中点</h3>
      <div class="row-actions">
        <button class:primary={editLayer === 'track'} on:click={() => setLayer('track')}>赛道点层</button>
        <button class:primary={editLayer === 'route'} on:click={() => setLayer('route')}>赛线点层</button>
      </div>
      <div class="row-actions">
        <button on:click={() => addPoint('track')}>追加赛道点</button>
        <button on:click={() => addPoint('route')}>追加赛线点</button>
        <button class="danger" disabled={!selectedId} on:click={deleteSelected}>删除选中</button>
      </div>

      {#if editLayer === 'track' && selectedTrackPoint}
        <div class="form-grid">
          <label>X<input type="number" value={selectedTrackPoint.x} on:input={(e) => patchProject((d) => { const p = d.trackPoints.find((q) => q.id === selectedId); if (p) p.x = numberOrZero(e.currentTarget.value); })} /></label>
          <label>Y<input type="number" value={selectedTrackPoint.y} on:input={(e) => patchProject((d) => { const p = d.trackPoints.find((q) => q.id === selectedId); if (p) p.y = numberOrZero(e.currentTarget.value); })} /></label>
          <label class="wide">宽度 m<input type="number" value={selectedTrackPoint.width} on:input={(e) => patchProject((d) => { const p = d.trackPoints.find((q) => q.id === selectedId); if (p) p.width = numberOrZero(e.currentTarget.value); })} /></label>
        </div>
      {:else if editLayer === 'route' && selectedRoutePoint}
        <div class="form-grid">
          <label>X<input type="number" value={selectedRoutePoint.x} on:input={(e) => patchProject((d) => { const p = d.routePoints.find((q) => q.id === selectedId); if (p) p.x = numberOrZero(e.currentTarget.value); })} /></label>
          <label>Y<input type="number" value={selectedRoutePoint.y} on:input={(e) => patchProject((d) => { const p = d.routePoints.find((q) => q.id === selectedId); if (p) p.y = numberOrZero(e.currentTarget.value); })} /></label>
        </div>
      {:else}
        <p class="muted small">在画面中拖曳控制点，或用表格精确输入。</p>
      {/if}
    </div>

    <div class="section">
      <h3>{editLayer === 'track' ? '赛道控制点' : '赛线控制点'}</h3>
      <div class="scroll-table">
        <table class="point-table">
          <thead><tr><th>#</th><th>X</th><th>Y</th>{#if editLayer === 'track'}<th>宽</th>{/if}</tr></thead>
          <tbody>
            {#each tableRows as point, index (point.id)}
              <tr class:row-selected={selectedId === point.id}>
                <td><button on:click={() => { selectedId = point.id; setLayer(editLayer); }}>{index}</button></td>
                <td>{format(point.x, 1)}</td>
                <td>{format(point.y, 1)}</td>
                {#if point.width !== null}<td>{format(point.width, 1)}</td>{/if}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  </aside>

  <main class="panel viewport-panel">
    <div class="viewport-toolbar">
      <button class="primary" disabled={!analysis?.profile} on:click={() => setPlaying(!playing)}>{playing ? '暂停' : '播放代理'}</button>
      <button disabled={!analysis?.profile} on:click={() => { animationTime = 0; scene?.setAnimationTime(0); }}>重置</button>
      {#if analysis?.profile}
        <input
          type="range"
          min="0"
          max={analysis.profile.totalTime}
          step="0.01"
          value={Math.min(animationTime, analysis.profile.totalTime)}
          style="max-width:260px"
          on:input={(e) => { setPlaying(false); animationTime = Number(e.currentTarget.value); scene?.setAnimationTime(animationTime); }}
        />
        <span class="muted small">{format(Math.min(animationTime, analysis.profile.totalTime), 2)} / {format(analysis.profile.totalTime, 2)} s</span>
      {/if}
      <span class="muted small">动画只用于直观检查；圈时与约束以右侧数值表为准。</span>
    </div>
    <div class="viewport" bind:this={viewport}></div>
  </main>

  <aside class="panel">
    <div class="section">
      <h2>计算结果</h2>
      <div class="metrics">
        <div class="metric"><span>圈时 / 用时</span><strong>{format(analysis?.profile?.totalTime, 3)} s</strong></div>
        <div class="metric"><span>路线长度</span><strong>{format(analysis?.profile?.totalLength, 1)} m</strong></div>
        <div class="metric"><span>最低速度</span><strong>{format(analysis?.profile?.minSpeed, 2)} m/s</strong></div>
        <div class="metric"><span>最高到达</span><strong>{format(analysis?.profile?.maxReachedSpeed, 2)} m/s</strong></div>
        <div class="metric"><span>最大曲率</span><strong>{format(analysis?.profile?.maxCurvature, 4)} 1/m</strong></div>
        <div class="metric"><span>闭合传播迭代</span><strong>{analysis?.profile?.iterations ?? '—'}</strong></div>
      </div>
    </div>

    <div class="section">
      <h3>边界与可行性</h3>
      {#if analysis?.issues.length === 0}
        <div class="issue ok">路线全部采样点位于赛道边界内，速度约束可计算。</div>
      {:else}
        {#each analysis?.issues ?? [] as issue}
          <div class="issue error">{issue.message}</div>
        {/each}
      {/if}
      {#each analysis?.warnings ?? [] as warning}
        <div class="issue warning">{warning}</div>
      {/each}
    </div>

    <div class="section">
      <h3>约束图例与段数</h3>
      <div class="legend">
        {#each bindingCounts as item}
          <div class="legend-row">
            <span class="swatch" style={`background:${limitColors[item.kind]}`}></span>
            <span>{limitLabels[item.kind]}</span>
            <strong>{item.count}</strong>
          </div>
        {/each}
      </div>
      <div class="row-actions">
        <button class:primary={bindingFilter === 'all'} on:click={() => setBindingFilter('all')}>全部</button>
        {#each filterOptions as kind}
          <button class:primary={bindingFilter === kind} on:click={() => setBindingFilter(kind)}>{limitLabels[kind]}</button>
        {/each}
      </div>
    </div>

    <div class="section">
      <h3>采样加密稳定性（阈值 0.5%）</h3>
      <button on:click={runStability}>以 {Math.max(160, project.samples * 2)} 点复核</button>
      {#if stability}
        <div class="metrics" style="margin-top:8px">
          <div class="metric"><span>基准圈时</span><strong>{format(stability.baseTime, 3)}</strong></div>
          <div class="metric"><span>加密圈时</span><strong>{format(stability.refinedTime, 3)}</strong></div>
          <div class="metric"><span>圈时相对差</span><strong>{formatPercent(stability.timeRelativeError)}</strong></div>
          <div class="metric"><span>极速相对差</span><strong>{formatPercent(stability.maxSpeedRelativeError)}</strong></div>
        </div>
        <div class={`issue ${stability.passes ? 'ok' : 'error'}`} style="margin-top:8px">
          {stability.passes ? '通过：双倍采样后结果在阈值内。' : '未通过：请提高采样或检查控制点/曲率尖峰。'}
        </div>
      {/if}
    </div>

    <div class="section">
      <h3>逐段速度与限制来源</h3>
      <div class="row-actions" style="justify-content:space-between">
        <span class="muted small">第 {segmentPage + 1}/{segmentPageCount} 页，共 {allFilteredSegments.length} 段</span>
        <span>
          <button disabled={segmentPage === 0} on:click={() => (segmentPage -= 1)}>上一页</button>
          <button disabled={segmentPage >= segmentPageCount - 1} on:click={() => (segmentPage += 1)}>下一页</button>
        </span>
      </div>
      <div class="scroll-table">
        <table class="segment-table">
          <thead>
            <tr><th>段</th><th>s m</th><th>入速</th><th>出速</th><th>用时</th><th>限制</th></tr>
          </thead>
          <tbody>
            {#each filteredSegments as segment (segment.index)}
              <tr>
                <td>{segment.index}</td>
                <td>{format(segment.s0, 1)}</td>
                <td>{format(segment.speed0, 2)}</td>
                <td>{format(segment.speed1, 2)}</td>
                <td>{format(segment.segmentTime, 3)}</td>
                <td><span class="pill" style={`background:${limitColors[segment.binding]}22;color:${limitColors[segment.binding]}`}>{limitLabels[segment.binding]}</span></td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  </aside>
</div>
