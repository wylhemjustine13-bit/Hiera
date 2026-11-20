import { useEffect, useRef } from 'react';
import * as THREE from 'three';

const palette: Record<string, { glow: string; armor: string; face: string }> = {
  hiera: { glow: '#d58aff', armor: '#4a2a70', face: '#e8d8ff' },
  willy: { glow: '#77d8ff', armor: '#dce8f7', face: '#f4f7ff' },
  nova: { glow: '#54aaff', armor: '#174b91', face: '#d9eaff' },
  pixel: { glow: '#20e2ff', armor: '#16394b', face: '#c9faff' },
  luna: { glow: '#d7a1ff', armor: '#49305e', face: '#f0dcff' },
  atlas: { glow: '#ffc45d', armor: '#70502b', face: '#ffe6bd' },
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

    // Rounded shoulders and chest armour
    add(new THREE.SphereGeometry(0.83, 40, 28), armor, [0, -1.05, 0], [1.08, 0.64, 0.58]);
    add(new THREE.CylinderGeometry(0.23, 0.28, 0.38, 32), bright, [0, -0.56, 0]);
    add(new THREE.SphereGeometry(0.43, 40, 32), bright, [0, 0.32, 0.02], [0.91, 1.12, 0.82]);

    // Helmet shell with a polished crown
    add(new THREE.SphereGeometry(0.47, 40, 24, 0, Math.PI * 2, 0, Math.PI * 0.62), armor, [0, 0.53, -0.015], [1.08, 1, 1]);
    const visor = add(new THREE.SphereGeometry(0.34, 40, 24, 0, Math.PI, 0.45, 1.15), dark, [0, 0.35, 0.37], [1.05, 0.72, 0.35]);
    visor.rotation.z = Math.PI;
    // Eyes
    for (const x of [-0.17, 0.17]) {
      add(new THREE.SphereGeometry(0.055, 20, 16), glow, [x, 0.39, 0.69], [1.25, 0.82, 0.5]);
    }
    // Side ear-pods
    for (const x of [-0.47, 0.47]) {
      add(new THREE.CylinderGeometry(0.105, 0.105, 0.16, 24), glow, [x, 0.28, 0.02]).rotation.z = Math.PI / 2;
      add(new THREE.SphereGeometry(0.12, 24, 16), armor, [x, 0.28, 0]);
    }
    // Chest panel and illuminated core
    add(new THREE.BoxGeometry(0.48, 0.34, 0.12), dark, [0, -1.03, 0.49]);
    add(new THREE.OctahedronGeometry(0.105, 1), glow, [0, -1.03, 0.57]);
    // Shoulder lights
    for (const x of [-0.69, 0.69]) add(new THREE.SphereGeometry(0.07, 18, 14), glow, [x, -0.83, 0.37]);

    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.018, 10, 64), glow);
    halo.position.set(0, 1.05, -0.1); robot.add(halo);
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
      halo.rotation.y = t * 0.8;
      halo.rotation.x = 0.35 + Math.sin(t) * 0.08;
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
