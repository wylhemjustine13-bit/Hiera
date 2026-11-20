import { useEffect, useRef } from 'react';
import * as THREE from 'three';

const palette: Record<string, { glow: string; armor: string; face: string; trim: string }> = {
  hiera: { glow: '#d58aff', armor: '#4a2a70', face: '#e8d8ff', trim: '#f0d6ff' },
  willy: { glow: '#77d8ff', armor: '#dce8f7', face: '#f4f7ff', trim: '#b8eaff' },
  nova: { glow: '#54aaff', armor: '#174b91', face: '#d9eaff', trim: '#9ccaff' },
  pixel: { glow: '#20e2ff', armor: '#16394b', face: '#c9faff', trim: '#8bffff' },
  luna: { glow: '#d7a1ff', armor: '#49305e', face: '#f0dcff', trim: '#e8c3ff' },
  atlas: { glow: '#ffc45d', armor: '#70502b', face: '#ffe6bd', trim: '#ffdb8b' },
};

export default function Companion3D({ id, name, activity = 'idle' }: { id: string; name: string; activity?: 'idle' | 'typing' | 'thinking' | 'speaking' | 'listening' }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = host.current;
    if (!root) return;
    const colors = palette[id] || palette.hiera;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 0.1, 6.6);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    root.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xe8ddff, 0x17102b, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 3.1);
    key.position.set(-3, 4, 5); scene.add(key);
    const rim = new THREE.PointLight(colors.glow, 24, 8);
    rim.position.set(2, 1, -1); scene.add(rim);
    const fill = new THREE.PointLight(0x8a75ff, 10, 7);
    fill.position.set(-2, -1, 3); scene.add(fill);

    const robot = new THREE.Group();
    scene.add(robot);
    const mat = (color: string, metalness = 0.72, roughness = 0.24) =>
      new THREE.MeshStandardMaterial({ color, metalness, roughness });
    const armor = mat(colors.armor, 0.82, 0.2);
    const bright = mat(colors.face, 0.58, 0.22);
    const dark = mat('#151329', 0.55, 0.3);
    const glow = new THREE.MeshStandardMaterial({ color: colors.glow, emissive: colors.glow, emissiveIntensity: 2.6, metalness: 0.25, roughness: 0.18 });
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material, position: [number,number,number], scale?: [number,number,number]) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(...position);
      if (scale) mesh.scale.set(...scale);
      robot.add(mesh); return mesh;
    };

    // Friendly orbital pilot: smooth ceramic shell, broad visor and compact mech details
    const trim = mat(colors.trim, 0.92, 0.16);
    const shell = new THREE.MeshPhysicalMaterial({ color: colors.face, metalness: 0.3, roughness: 0.2, clearcoat: 1 });
    const visor = new THREE.MeshPhysicalMaterial({ color: '#10182d', metalness: 0.58, roughness: 0.12, clearcoat: 1 });
    const joint = mat('#182033', 0.8, 0.24);

    // Rounded torso with a bright reactor window
    add(new THREE.SphereGeometry(0.72, 40, 32), armor, [0, -1.02, 0], [1.12, 0.82, 0.7]);
    add(new THREE.CylinderGeometry(0.23, 0.3, 0.3, 24), joint, [0, -0.48, 0]);
    add(new THREE.TorusGeometry(0.25, 0.045, 12, 48), trim, [0, -1.02, 0.57]);
    add(new THREE.SphereGeometry(0.18, 32, 24), glow, [0, -1.02, 0.62], [1, 1, 0.48]);
    add(new THREE.BoxGeometry(0.56, 0.07, 0.1), shell, [0, -0.76, 0.48]);

    // Large friendly helmet and panoramic dark visor
    add(new THREE.SphereGeometry(0.68, 48, 36), shell, [0, 0.34, 0], [0.94, 1.04, 0.82]);
    add(new THREE.SphereGeometry(0.47, 48, 32), visor, [0, 0.31, 0.48], [1.12, 0.68, 0.34]);
    add(new THREE.TorusGeometry(0.49, 0.035, 12, 64, Math.PI * 1.25), trim, [0, 0.31, 0.49]).rotation.z = Math.PI * 0.12;
    for (const x of [-0.2, 0.2]) {
      add(new THREE.SphereGeometry(0.075, 24, 20), glow, [x, 0.35, 0.79], [0.78, 1.25, 0.45]);
    }
    add(new THREE.SphereGeometry(0.045, 20, 16), trim, [0, 0.12, 0.81]);

    // Pilot antenna and side communication pods
    const antenna = add(new THREE.CylinderGeometry(0.025, 0.04, 0.28, 12), trim, [0.18, 1.02, 0]);
    antenna.rotation.z = -0.18;
    add(new THREE.SphereGeometry(0.09, 24, 18), glow, [0.15, 1.18, 0]);
    const pods: THREE.Mesh[] = [];
    for (const x of [-0.72, 0.72]) {
      const pod = add(new THREE.SphereGeometry(0.23, 32, 24), armor, [x, 0.28, 0], [0.72, 1.05, 0.8]);
      const disc = add(new THREE.CylinderGeometry(0.13, 0.13, 0.08, 32), trim, [x * 1.03, 0.28, 0]);
      disc.rotation.z = Math.PI / 2;
      const light = add(new THREE.SphereGeometry(0.055, 20, 16), glow, [x * 1.1, 0.28, 0.1]);
      const shoulder = add(new THREE.SphereGeometry(0.34, 32, 24), armor, [x * 0.92, -0.83, 0], [1.15, 0.82, 0.9]);
      shoulder.rotation.z = x < 0 ? -0.18 : 0.18;
      add(new THREE.TorusGeometry(0.12, 0.025, 8, 32), glow, [x * 0.95, -0.84, 0.29]);
      pods.push(pod, light);
    }
    // Small floating status lights instead of large orbit rings
    const sparks: THREE.Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const spark = add(new THREE.SphereGeometry(0.055 + (i % 2) * 0.018, 20, 16), i % 2 ? trim : glow,
        [Math.cos(i * Math.PI / 2) * 1.02, -0.1 + Math.sin(i * Math.PI / 2) * 0.62, -0.08]);
      sparks.push(spark);
    }
    const clock = new THREE.Clock();
    let frame = 0;
    let width = 0, height = 0;
    const resize = () => {
      const w = Math.max(root.clientWidth, 1), h = Math.max(root.clientHeight, 1);
      if (w === width && h === height) return;
      width = w; height = h;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(root); resize();
    const animate = () => {
      frame = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      const thinking = activity === 'thinking';
      const speaking = activity === 'speaking';
      const listening = activity === 'listening';
      const typing = activity === 'typing';
      const tempo = thinking ? 3.4 : speaking ? 5.2 : listening ? 2.2 : typing ? 2.8 : 1.55;
      const energy = thinking ? 0.16 : speaking ? 0.13 : listening ? 0.1 : typing ? 0.075 : 0.055;
      robot.position.y = Math.sin(t * tempo) * energy + (speaking ? Math.abs(Math.sin(t * 7)) * 0.035 : 0);
      robot.rotation.y = Math.sin(t * (thinking ? 1.7 : 0.7)) * (thinking ? 0.3 : listening ? 0.23 : 0.17);
      robot.rotation.x = Math.sin(t * (speaking ? 4.5 : 0.9)) * (speaking ? 0.09 : 0.025);
      robot.rotation.z = listening ? Math.sin(t * 1.8) * 0.07 : typing ? Math.sin(t * 2.4) * 0.035 : 0;
      pods.forEach((pod, index) => { pod.rotation.y = Math.sin(t * (thinking ? 3.2 : 1.2) + index) * (thinking ? 0.3 : 0.12); });
      sparks.forEach((spark, index) => {
        const pulse = Math.sin(t * (speaking ? 8 : thinking ? 5 : listening ? 3 : 2) + index * 1.4);
        spark.position.y += Math.sin(t * 1.7 + index * 1.4) * 0.0009;
        spark.scale.setScalar((speaking ? 1.05 : thinking ? 1 : 0.88) + (pulse + 1) * (speaking ? 0.22 : thinking ? 0.16 : 0.12));
      });
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) { obj.geometry.dispose(); const materials = Array.isArray(obj.material) ? obj.material : [obj.material]; materials.forEach(m => m.dispose()); }
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === root) root.removeChild(renderer.domElement);
    };
  }, [id, activity]);

  return <div ref={host} className="companion-real3d" role="img" aria-label={name + ' en 3D animé'} />;
}
