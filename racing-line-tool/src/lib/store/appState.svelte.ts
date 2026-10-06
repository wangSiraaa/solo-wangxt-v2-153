import { CenterlineGeometry } from '../core/geometry';
import { sampleTrack } from '../core/track';
import { solveSpeed } from '../core/solver';
import {
  LINE_STATIONS,
  clampOffsets,
  optimizeLine,
  buildLineGeometry,
  sampleLineKappa
} from '../core/racingLine';
import { buildSegmentReport } from '../core/report';
import { DEFAULT_VEHICLE, SAMPLES } from '../core/samples';
import { saveProject, loadProject, listProjects, deleteProject } from './db';
import type { Project, TrackSpec, VehicleParams } from '../core/types';

/** 全局应用状态（Svelte 5 runes）。所有昂贵计算均为派生值，输入变化自动重算。 */
class AppState {
  track = $state<TrackSpec>(structuredClone(SAMPLES[1]));
  vehicle = $state<VehicleParams>({ ...DEFAULT_VEHICLE });
  /** 线路站点偏移（左正右负），任何写入都会钳制到边界内 */
  rawOffsets = $state<number[]>(new Array(LINE_STATIONS).fill(0));
  /** 求解网格间距 */
  ds = $state(0.5);
  /** 结果显示对象：赛车线或中心线 */
  activeLine = $state<'racing' | 'center'>('racing');
  projectName = $state('未命名工程');
  savedProjects = $state<string[]>([]);
  statusMsg = $state('');
  /** 编辑器中选中的控制点 */
  selectedCp = $state<number | null>(null);
  /** 视图适配令牌：切换样例 / 载入工程时自增，通知编辑器与 3D 视图重新取景 */
  fitToken = $state(0);

  // ---- 派生：几何与求解 ----
  center = $derived(new CenterlineGeometry(this.track));
  offsets = $derived(clampOffsets(this.center, this.rawOffsets));
  trackSampled = $derived(sampleTrack(this.center, this.ds));
  centerKappa = $derived(Float64Array.from(this.trackSampled.pts.map((p) => p.kappa)));
  centerSol = $derived(solveSpeed(this.centerKappa, this.trackSampled.ds, this.trackSampled.closed, this.vehicle));

  lineGeom = $derived(buildLineGeometry(this.center, this.offsets));
  lineKappa = $derived(sampleLineKappa(this.lineGeom, this.ds));
  lineSol = $derived(solveSpeed(this.lineKappa.kappa, this.lineKappa.ds, this.lineGeom.closed, this.vehicle));

  activeSol = $derived(this.activeLine === 'racing' ? this.lineSol : this.centerSol);
  segmentReport = $derived(buildSegmentReport(this.track, this.center, this.activeSol));

  setOffsets(next: number[]) {
    this.rawOffsets = clampOffsets(this.center, next);
  }

  optimizeLine() {
    this.rawOffsets = optimizeLine(this.center, 400);
    this.statusMsg = '线路已优化（拉普拉斯平滑 + 边界钳制）';
  }

  resetLine() {
    this.rawOffsets = new Array(LINE_STATIONS).fill(0);
  }

  loadSample(i: number) {
    this.track = structuredClone(SAMPLES[i]);
    this.projectName = SAMPLES[i].name;
    this.selectedCp = null;
    this.fitToken++;
    this.resetLine();
  }

  // ---- IndexedDB 持久化 ----
  async refreshList() {
    this.savedProjects = await listProjects();
  }

  async save() {
    const p: Project = {
      name: this.projectName,
      savedAt: Date.now(),
      track: structuredClone(this.track),
      lineOffsets: [...this.offsets],
      vehicle: { ...this.vehicle }
    };
    await saveProject(p);
    await this.refreshList();
    this.statusMsg = `已保存「${p.name}」到 IndexedDB`;
  }

  async load(name: string) {
    const p = await loadProject(name);
    if (!p) return;
    this.track = p.track;
    this.vehicle = p.vehicle;
    this.projectName = p.name;
    this.selectedCp = null;
    this.fitToken++;
    this.rawOffsets = p.lineOffsets ?? new Array(LINE_STATIONS).fill(0);
    this.statusMsg = `已载入「${name}」`;
  }

  async remove(name: string) {
    await deleteProject(name);
    await this.refreshList();
  }
}

export const appState = new AppState();
