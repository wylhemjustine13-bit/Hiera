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

    // Friendly compact sci-fi companion: layered metallic armor and glass visor
    const trim = mat(colors.trim, 0.88, 0.16);
    const visorMat = new THREE.MeshPhysicalMaterial({ color: '#101326', metalness: 0.65, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.08 });
    const shell = add(new THREE.SphereGeometry(0.66, 48, 36), armor, [0, 0.34, 0], [0.92, 1.08, 0.78]);
    // Broad shoulder silhouette and chest plate
    add(new THREE.SphereGeometry(0.78, 48, 32), armor, [0, -1.03, 0], [1.12, 0.62, 0.62]);
    add(new THREE.BoxGeometry(0.92, 0.58, 0.16, 4, 3, 1), trim, [0, -1.12, 0.43]);
    add(new THREE.BoxGeometry(0.78, 0.43, 0.18, 4, 3, 1), dark, [0, -1.1, 0.54]);
    add(new THREE.OctahedronGeometry(0.14, 2), glow, [0, -1.1, 0.66]);
    add(new THREE.CylinderGeometry(0.24, 0.28, 0.32, 32), bright, [0, -0.58, 0]);

    // Oversized rounded helmet with a curved dark visor
    add(new THREE.SphereGeometry(0.58, 48, 36), bright, [0, 0.35, 0.02], [0.98, 1.02, 0.82]);
    add(new THREE.SphereGeometry(0.61, 48, 32, 0, Math.PI * 2, 0, Math.PI * 0.56), armor, [0, 0.51, -0.02], [1.04, 1.03, 0.9]);
    add(new THREE.SphereGeometry(0.405, 48, 32), visorMat, [0, 0.31, 0.48], [1.05, 0.64, 0.28]);
    // Soft glowing eyes with highlights
    for (const x of [-0.18, 0.18]) {
      add(new THREE.SphereGeometry(0.075, 24, 18), glow, [x, 0.34, 0.72], [0.82, 1.12, 0.48]);
      add(new THREE.SphereGeometry(0.022, 16, 12), bright, [x - 0.018, 0.37, 0.755]);
    }
    // Side audio / sensor pods
    for (const x of [-0.59, 0.59]) {
      const pod = add(new THREE.CylinderGeometry(0.16, 0.16, 0.18, 32), trim, [x, 0.23, 0.02]);
      pod.rotation.z = Math.PI / 2;
      add(new THREE.SphereGeometry(0.115, 24, 20), glow, [x * 1.04, 0.23, 0.13]);
    }
    // Helmet crest and small illuminated details
    add(new THREE.BoxGeometry(0.28, 0.055, 0.12), glow, [0, 1.03, 0.02]);
    for (const x of [-0.68, 0.68]) {
      add(new THREE.SphereGeometry(0.075, 20, 16), glow, [x, -0.86, 0.42]);
      add(new THREE.BoxGeometry(0.12, 0.035, 0.08), trim, [x, -1.04, 0.56]);
    }
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.025, 12, 64), glow);
    halo.position.set(0, 1.16, -0.1); robot.add(halo);
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
