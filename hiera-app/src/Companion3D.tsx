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

export default function Companion3D({ id, name }: { id: string; name: string }) {
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

    // Crystal guardian concept: faceted silhouette, floating shards and luminous core
    const trim = mat(colors.trim, 0.95, 0.12);
    const crystal = new THREE.MeshPhysicalMaterial({ color: colors.face, metalness: 0.42, roughness: 0.12, clearcoat: 1, transmission: 0.08 });
    const glass = new THREE.MeshPhysicalMaterial({ color: '#07101f', metalness: 0.52, roughness: 0.08, clearcoat: 1 });
    const joint = mat('#111827', 0.78, 0.2);

    // Sculpted chest and luminous central crystal
    add(new THREE.IcosahedronGeometry(0.72, 1), armor, [0, -1.02, 0], [1.12, 0.62, 0.65]);
    add(new THREE.CylinderGeometry(0.24, 0.34, 0.34, 6), joint, [0, -0.58, 0]);
    add(new THREE.OctahedronGeometry(0.27, 1), trim, [0, -1.02, 0.53]);
    add(new THREE.OctahedronGeometry(0.15, 2), glow, [0, -1.02, 0.68]);
    add(new THREE.BoxGeometry(0.72, 0.08, 0.12), crystal, [0, -0.78, 0.42]);

    // Angular head with a faceted crown and dark curved faceplate
    add(new THREE.IcosahedronGeometry(0.62, 2), crystal, [0, 0.34, 0], [0.88, 1.08, 0.78]);
    add(new THREE.IcosahedronGeometry(0.43, 2), glass, [0, 0.31, 0.46], [1.1, 0.72, 0.38]);
    add(new THREE.ConeGeometry(0.32, 0.42, 5), armor, [0, 0.92, -0.02]);
    add(new THREE.OctahedronGeometry(0.13, 1), glow, [0, 1.16, 0.02]);
    for (const x of [-0.18, 0.18]) {
      const eye = add(new THREE.SphereGeometry(0.07, 24, 18), glow, [x, 0.36, 0.78], [0.68, 1.35, 0.45]);
      eye.rotation.z = x < 0 ? 0.12 : -0.12;
    }
    add(new THREE.TorusGeometry(0.08, 0.012, 8, 24, Math.PI), trim, [0, 0.12, 0.82]).rotation.z = Math.PI;

    // Floating crystal ear pieces and asymmetric shoulder armor
    const shards: THREE.Mesh[] = [];
    for (const x of [-0.72, 0.72]) {
      const ear = add(new THREE.OctahedronGeometry(0.23, 1), trim, [x, 0.22, 0.02]);
      ear.scale.set(0.7, 1.35, 0.7);
      const shoulder = add(new THREE.IcosahedronGeometry(0.34, 1), armor, [x * 0.94, -0.84, 0.02], [1.2, 0.8, 0.85]);
      shoulder.rotation.z = x < 0 ? -0.22 : 0.22;
      add(new THREE.TorusGeometry(0.11, 0.022, 8, 28), glow, [x, -0.84, 0.28]);
      const shard = add(new THREE.OctahedronGeometry(0.16, 1), glow, [x * 1.22, -0.45, -0.05]);
      shards.push(shard);
    }
    // Two orbiting crystal fragments
    for (let i = 0; i < 3; i++) {
      const shard = add(new THREE.OctahedronGeometry(0.09 + i * 0.018, 1), i === 1 ? trim : glow, [Math.cos(i * 2.1) * 0.95, 0.2 + i * 0.34, -0.12]);
      shards.push(shard);
    }
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.014, 8, 96), glow);
    halo.position.set(0, 0.12, -0.35); halo.rotation.set(0.8, 0.2, 0.1); robot.add(halo);
    const halo2 = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.009, 8, 96), trim);
    halo2.position.set(0, -0.12, -0.4); halo2.rotation.set(1.15, -0.3, 0.1); robot.add(halo2);
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
      robot.position.y = Math.sin(t * 1.55) * 0.055;
      robot.rotation.y = Math.sin(t * 0.7) * 0.17;
      robot.rotation.x = Math.sin(t * 0.9) * 0.025;
      halo.rotation.y = t * 0.62;
      halo.rotation.x = 0.8 + Math.sin(t * 0.8) * 0.12;
      halo2.rotation.z = t * -0.46;
      halo2.rotation.x = 1.15 + Math.sin(t * 0.65) * 0.1;
      shards.forEach((shard, index) => { shard.rotation.x = t * (0.45 + index * 0.08); shard.rotation.y = t * (0.6 + index * 0.06); shard.position.y += Math.sin(t * 1.8 + index) * 0.0008; });
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
  }, [id]);

  return <div ref={host} className="companion-real3d" role="img" aria-label={name + ' en 3D animé'} />;
}
