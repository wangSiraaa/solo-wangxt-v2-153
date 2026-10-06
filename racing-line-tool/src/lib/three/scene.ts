import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { SampledTrack, SpeedSolution, Vec2 } from '../core/types';
import type { LineGeometry } from '../core/racingLine';
import { trackBoundaries } from '../core/track';

/** 速度配色：慢=红，中=黄，快=绿。 */
export function speedColor(v: number, vMin: number, vMax: number, out: THREE.Color): THREE.Color {
  const t = vMax > vMin ? (v - vMin) / (vMax - vMin) : 0;
  return out.setHSL(0.33 * Math.min(1, Math.max(0, t)), 0.9, 0.5);
}

interface CarAnim {
  pts: Vec2[];
  dsGeom: number;
  cumTime: number[];
  lapTime: number;
  stations: number; // 求解站点数
  ds: number;
  closed: boolean;
}

/** Three.js 场景：赛道条带、按速度着色的赛车线、车辆代理动画。 */
export class TrackScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private trackGroup = new THREE.Group();
  private lineGroup = new THREE.Group();
  private car: THREE.Group;
  private carAnim: CarAnim | null = null;
  private carTime = 0;
  playing = true;
  timeScale = 1;
  private clock = new THREE.Clock();
  private raf = 0;
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x14171c);
    this.scene.fog = new THREE.Fog(0x14171c, 400, 1600);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(120, 200, 80);
    this.scene.add(ambient, sun);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(6000, 6000),
      new THREE.MeshLambertMaterial({ color: 0x1d2129 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    this.scene.add(ground);

    // 车辆代理：车身 + 座舱
    this.car = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.7, 4.2),
      new THREE.MeshStandardMaterial({ color: 0xd8352a, roughness: 0.4, metalness: 0.3 })
    );
    body.position.y = 0.45;
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.5, 1.6),
      new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 0.2, metalness: 0.6 })
    );
    cabin.position.set(0, 0.95, 0.3);
    this.car.add(body, cabin);
    this.scene.add(this.car);

    this.scene.add(this.trackGroup, this.lineGroup);
    this.resize();
    this.animate();
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** 重建赛道几何（条带 + 边界线 + 起终点标记）；frame 为真时相机重新取景。 */
  setTrack(track: SampledTrack, frame = false) {
    this.trackGroup.clear();
    const { left, right } = trackBoundaries(track);
    const n = track.pts.length;
    const wrap = track.closed;

    // 条带
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      pos.push(left[i].x, 0, left[i].y, right[i].x, 0, right[i].y);
    }
    const segCount = wrap ? n : n - 1;
    for (let i = 0; i < segCount; i++) {
      const a = 2 * i;
      const b = 2 * ((i + 1) % n);
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const ribbon = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x3a3f4a, side: THREE.DoubleSide }));
    this.trackGroup.add(ribbon);

    // 边界线
    for (const [pts, color] of [
      [left, 0xf0f0f0],
      [right, 0xf0f0f0]
    ] as const) {
      const lg = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p.x, 0.02, p.y)));
      const line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color }));
      this.trackGroup.add(line);
    }

    // 起终点线
    const p0 = track.pts[0];
    const sf = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(p0.x + p0.nx * p0.halfWidthL, 0.03, p0.y + p0.ny * p0.halfWidthL),
      new THREE.Vector3(p0.x - p0.nx * p0.halfWidthR, 0.03, p0.y - p0.ny * p0.halfWidthR)
    ]);
    this.trackGroup.add(new THREE.Line(sf, new THREE.LineBasicMaterial({ color: 0x00e5ff })));

    // 相机对准赛道中心（仅在请求时，避免编辑过程中视角被打断）
    if (frame || !this.framed) {
      const box = new THREE.Box3().setFromObject(ribbon);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).length();
      this.controls.target.copy(center);
      this.camera.position.set(center.x, size * 0.75, center.z + size * 0.45);
      this.controls.update();
      this.framed = true;
    }
  }

  private framed = false;

  /** 更新赛车线（按速度着色的窄条带）。 */
  setLine(line: LineGeometry, sol: SpeedSolution) {
    this.lineGroup.clear();
    const pts = line.pts;
    const n = pts.length;
    const wrap = line.closed;
    // 求解站点速度 → 按弧长插值到几何细网格
    const vAt = (s: number) => {
      const x = s / sol.ds;
      const i0 = Math.floor(x);
      const f = x - i0;
      const m = sol.v.length;
      const a = wrap ? i0 % m : Math.min(m - 1, i0);
      const b = wrap ? (i0 + 1) % m : Math.min(m - 1, i0 + 1);
      return sol.v[a] * (1 - f) + sol.v[b] * f;
    };
    let vMin = Infinity;
    let vMax = -Infinity;
    for (const v of sol.v) {
      vMin = Math.min(vMin, v);
      vMax = Math.max(vMax, v);
    }
    const halfW = 0.45;
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const prev = pts[wrap ? (i - 1 + n) % n : Math.max(0, i - 1)];
      const next = pts[wrap ? (i + 1) % n : Math.min(n - 1, i + 1)];
      let tx = next.x - prev.x;
      let ty = next.y - prev.y;
      const L = Math.hypot(tx, ty) || 1;
      tx /= L;
      ty /= L;
      const nx = -ty;
      const ny = tx;
      pos.push(pts[i].x + nx * halfW, 0.06, pts[i].y + ny * halfW, pts[i].x - nx * halfW, 0.06, pts[i].y - ny * halfW);
      speedColor(vAt(i * line.dsGeom), vMin, vMax, c);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    const segCount = wrap ? n : n - 1;
    for (let i = 0; i < segCount; i++) {
      const a = 2 * i;
      const b = 2 * ((i + 1) % n);
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    this.lineGroup.add(mesh);
  }

  /** 设置车辆动画路径（按求解速度剖面行驶）。 */
  setCarPath(line: LineGeometry, sol: SpeedSolution) {
    const cumTime: number[] = [0];
    for (let i = 0; i < sol.segTime.length; i++) cumTime.push(cumTime[i] + sol.segTime[i]);
    this.carAnim = {
      pts: line.pts,
      dsGeom: line.dsGeom,
      cumTime,
      lapTime: sol.lapTime,
      stations: sol.v.length,
      ds: sol.ds,
      closed: line.closed
    };
  }

  private carPose(t: number): { x: number; y: number; tx: number; ty: number } | null {
    const anim = this.carAnim;
    if (!anim || anim.lapTime <= 0) return null;
    const tt = ((t % anim.lapTime) + anim.lapTime) % anim.lapTime;
    // 二分查找所在求解段
    let lo = 0;
    let hi = anim.cumTime.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (anim.cumTime[mid] <= tt) lo = mid;
      else hi = mid;
    }
    const segT = anim.cumTime[lo + 1] - anim.cumTime[lo] || 1;
    const f = (tt - anim.cumTime[lo]) / segT;
    const s = (lo + f) * anim.ds;
    // 弧长 → 几何细网格位置与切向
    const x = s / anim.dsGeom;
    const i0 = Math.floor(x);
    const fr = x - i0;
    const n = anim.pts.length;
    const closed = anim.closed;
    const A = anim.pts[closed ? i0 % n : Math.min(n - 1, i0)];
    const B = anim.pts[closed ? (i0 + 1) % n : Math.min(n - 1, i0 + 1)];
    const px = A.x + (B.x - A.x) * fr;
    const py = A.y + (B.y - A.y) * fr;
    const tl = Math.hypot(B.x - A.x, B.y - A.y) || 1;
    return { x: px, y: py, tx: (B.x - A.x) / tl, ty: (B.y - A.y) / tl };
  }

  private animate = () => {
    this.raf = requestAnimationFrame(this.animate);
    const dt = Math.min(0.1, this.clock.getDelta());
    if (this.playing && this.carAnim) {
      this.carTime += dt * this.timeScale;
      const pose = this.carPose(this.carTime);
      if (pose) {
        this.car.position.set(pose.x, 0, pose.y);
        this.car.rotation.y = Math.atan2(pose.tx, pose.ty);
      }
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
