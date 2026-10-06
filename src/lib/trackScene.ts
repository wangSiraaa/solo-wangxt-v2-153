import * as THREE from 'three';
import type { AnalysisResult, EditLayer, SpeedSegment, TrackSurface, TractionProject } from './types';

const limitColors: Record<string, number> = {
  endpoint: 0x7c3aed,
  maxSpeed: 0x60a5fa,
  curvature: 0xef4444,
  accelPropagation: 0x22c55e,
  brakePropagation: 0xf97316
};

interface DragState {
  layer: EditLayer;
  id: string;
  pointerId: number;
}

export class TrackScene {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private group = new THREE.Group();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private hitMeshes: THREE.Mesh[] = [];
  private drag: DragState | null = null;

  project: TractionProject | null = null;
  surface: TrackSurface | null = null;
  analysis: AnalysisResult | null = null;
  editLayer: EditLayer = 'route';
  selectedId: string | null = null;
  playing = false;
  animationTime = 0;
  onPointDrag: ((layer: EditLayer, id: string, x: number, y: number) => void) | null = null;
  onSelect: ((layer: EditLayer, id: string | null) => void) | null = null;
  onPlayStateChange: ((playing: boolean, time: number) => void) | null = null;

  private vehicle = new THREE.Group();
  private animationFrame = 0;
  private lastFrame = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene.background = new THREE.Color(0x0f172a);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
    this.camera.position.set(0, 0, 10);
    this.camera.up.set(0, 1, 0);

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    this.scene.add(this.group);
    this.setupVehicle();
    this.bindEvents();
    this.resize();
  }

  private setupVehicle(): void {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 1.55, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xfacc15 })
    );
    body.position.z = 0.45;
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.85, 1.4, 3),
      new THREE.MeshBasicMaterial({ color: 0xfef3c7 })
    );
    nose.rotation.z = -Math.PI / 2;
    nose.position.set(2.05, 0, 0.45);
    this.vehicle.add(body, nose);
    this.scene.add(this.vehicle);
  }

  private bindEvents(): void {
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('resize', this.resize);
  }

  private updatePointer(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (!this.project || event.button !== 0) return;
    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.hitMeshes, false);
    if (hits.length > 0) {
      const mesh = hits[0].object as THREE.Mesh;
      const layer = mesh.userData.layer as EditLayer;
      const id = mesh.userData.id as string;
      this.drag = { layer, id, pointerId: event.pointerId };
      this.editLayer = layer;
      this.selectedId = id;
      this.renderer.domElement.setPointerCapture(event.pointerId);
      this.onSelect?.(layer, id);
    } else {
      this.onSelect?.(this.editLayer, null);
    }
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.groundPlane, hit)) {
      this.onPointDrag?.(this.drag.layer, this.drag.id, hit.x, hit.y);
    }
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (this.drag && event.pointerId === this.drag.pointerId) {
      this.renderer.domElement.releasePointerCapture(event.pointerId);
      this.drag = null;
    }
  };

  resize = (): void => {
    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 600;
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    const viewSize = this.surface ? Math.max(
      this.surface.bounds.maxX - this.surface.bounds.minX,
      this.surface.bounds.maxY - this.surface.bounds.minY
    ) * 0.72 : 180;
    this.camera.left = -viewSize * aspect;
    this.camera.right = viewSize * aspect;
    this.camera.top = viewSize;
    this.camera.bottom = -viewSize;
    this.camera.updateProjectionMatrix();
  };

  update(project: TractionProject, surface: TrackSurface, analysis: AnalysisResult): void {
    this.project = project;
    this.surface = surface;
    this.analysis = analysis;
    this.rebuild();
    this.resize();
  }

  private clearGroup(): void {
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      }
    });
    this.group.clear();
    this.hitMeshes = [];
  }

  private rebuild(): void {
    if (!this.project || !this.surface) return;
    this.clearGroup();
    this.addGrid();
    this.addTrack();
    this.addProfile();
    this.addRoute();
    this.addControlPoints(this.project.trackPoints, 'track', 0x38bdf8, 0.62);
    this.addControlPoints(this.project.routePoints, 'route', 0xfde047, 0.72);
    this.updateVehicleVisibility();
  }

  private addGrid(): void {
    const grid = new THREE.GridHelper(500, 50, 0x334155, 0x1e293b);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.05;
    this.group.add(grid);
  }

  private addTrack(): void {
    const points = this.surface!.points.map((p) => ({ x: p.x, y: p.y, width: p.width }));
    const widths = points.map((p) => p.width / 2);
    const vertices: number[] = [];
    const indices: number[] = [];
    const colors: number[] = [];
    const n = points.length;
    const green = new THREE.Color(0x14532d);
    const light = new THREE.Color(0x4d7c0f);

    for (let i = 0; i < n; i++) {
      const p = points[i];
      const prev = points[(i - 1 + n) % n];
      const next = points[(i + 1) % n];
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      vertices.push(p.x + nx * widths[i], p.y + ny * widths[i], 0);
      vertices.push(p.x - nx * widths[i], p.y - ny * widths[i], 0);
      const c = i % 2 ? green : light;
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    for (let i = 0; i < n - (this.project!.kind === 'closed' ? 0 : 1); i++) {
      const j = (i + 1) % n;
      indices.push(i * 2, j * 2, i * 2 + 1, j * 2, j * 2 + 1, i * 2 + 1);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    this.group.add(mesh);

    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 15),
      new THREE.LineBasicMaterial({ color: 0xd9f99d })
    );
    this.group.add(edge);
  }

  private addProfile(): void {
    const segments = this.analysis?.profile?.segments ?? [];
    for (const segment of segments) {
      const color = limitColors[segment.binding] ?? 0xffffff;
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(segment.x0, segment.y0, 0.08),
        new THREE.Vector3(segment.x1, segment.y1, 0.08)
      ]);
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color }));
      this.group.add(line);
    }
  }

  private addRoute(): void {
    if (!this.analysis) return;
    const points = this.analysis.route;
    const geometry = new THREE.BufferGeometry().setFromPoints(
      points.map((p) => new THREE.Vector3(p.x, p.y, 0.11))
    );
    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color: 0xf8fafc, linewidth: 2 })
    );
    this.group.add(line);
  }

  private addControlPoints(points: { id: string; x: number; y: number }[], layer: EditLayer, color: number, z: number): void {
    const visible = this.editLayer === layer;
    for (const point of points) {
      const selected = this.selectedId === point.id;
      const mesh = new THREE.Mesh(
        new THREE.CircleGeometry(selected ? 2.1 : 1.45, 24),
        new THREE.MeshBasicMaterial({ color: selected ? 0xffffff : color, transparent: !visible, opacity: visible ? 1 : 0.25 })
      );
      mesh.position.set(point.x, point.y, z);
      mesh.userData = { layer, id: point.id };
      if (visible) this.hitMeshes.push(mesh);
      this.group.add(mesh);
    }
  }

  private updateVehicleVisibility(): void {
    this.vehicle.visible = Boolean(this.analysis?.profile);
  }

  private findVehiclePose(segments: SpeedSegment[], time: number): { x: number; y: number; angle: number } | null {
    let elapsed = 0;
    for (const segment of segments) {
      if (time <= elapsed + segment.segmentTime) {
        const t = segment.segmentTime <= Number.EPSILON ? 0 : (time - elapsed) / segment.segmentTime;
        return {
          x: segment.x0 + (segment.x1 - segment.x0) * t,
          y: segment.y0 + (segment.y1 - segment.y0) * t,
          angle: Math.atan2(segment.y1 - segment.y0, segment.x1 - segment.x0)
        };
      }
      elapsed += segment.segmentTime;
    }
    const last = segments.at(-1);
    return last ? { x: last.x1, y: last.y1, angle: Math.atan2(last.y1 - last.y0, last.x1 - last.x0) } : null;
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    if (playing && this.animationFrame === 0) {
      this.lastFrame = performance.now();
      this.animationFrame = requestAnimationFrame(this.animate);
    }
  }

  setAnimationTime(time: number): void {
    this.animationTime = time;
  }

  private animate = (now: number): void => {
    const profile = this.analysis?.profile;
    if (this.playing && profile) {
      const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
      this.animationTime += dt;
      if (profile.closed) this.animationTime %= profile.totalTime;
      else if (this.animationTime > profile.totalTime) {
        this.animationTime = profile.totalTime;
        this.playing = false;
        this.onPlayStateChange?.(false, this.animationTime);
      }
    }
    this.lastFrame = now;

    if (profile) {
      const pose = this.findVehiclePose(profile.segments, this.animationTime);
      if (pose) {
        this.vehicle.position.set(pose.x, pose.y, 0);
        this.vehicle.rotation.z = pose.angle;
        this.vehicle.visible = true;
      }
    } else {
      this.vehicle.visible = false;
    }

    this.renderer.render(this.scene, this.camera);
    if (this.playing) this.animationFrame = requestAnimationFrame(this.animate);
    else {
      this.animationFrame = 0;
      this.renderer.render(this.scene, this.camera);
    }
  };

  renderOnce(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    window.removeEventListener('resize', this.resize);
    cancelAnimationFrame(this.animationFrame);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
