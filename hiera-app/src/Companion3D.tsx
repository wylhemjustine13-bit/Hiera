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

    // New concept: compact space-explorer droid with a panoramic luminous visor
    const trim = mat(colors.trim, 0.92, 0.12);
    const ceramic = new THREE.MeshPhysicalMaterial({ color: colors.face, metalness: 0.26, roughness: 0.2, clearcoat: 1 });
    const visorMat = new THREE.MeshPhysicalMaterial({ color: '#071426', metalness: 0.58, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.04 });
    const joint = mat('#11182a', 0.7, 0.25);

    // Compact astronaut torso with layered chest armor
    add(new THREE.SphereGeometry(0.78, 48, 32), armor, [0, -1.04, 0], [1.08, 0.62, 0.62]);
    add(new THREE.SphereGeometry(0.62, 40, 28), ceramic, [0, -0.98, 0.28], [0.92, 0.5, 0.44]);
    add(new THREE.BoxGeometry(0.62, 0.34, 0.12), joint, [0, -1.02, 0.62]);
    add(new THREE.TorusGeometry(0.18, 0.035, 12, 40), trim, [0, -1.02, 0.7]);
    add(new THREE.SphereGeometry(0.105, 28, 20), glow, [0, -1.02, 0.72]);
    add(new THREE.CylinderGeometry(0.22, 0.26, 0.3, 32), joint, [0, -0.57, 0]);

    // Oversized explorer helmet with a broad curved glass faceplate
    add(new THREE.SphereGeometry(0.68, 56, 40), ceramic, [0, 0.34, 0], [0.94, 1.0, 0.82]);
    add(new THREE.SphereGeometry(0.52, 48, 32), armor, [0, 0.45, 0.08], [1.12, 0.9, 0.82]);
    add(new THREE.SphereGeometry(0.45, 48, 32), visorMat, [0, 0.34, 0.56], [1.16, 0.66, 0.32]);
    // Two expressive horizontal light eyes with a subtle center glint
    for (const x of [-0.19, 0.19]) {
      add(new THREE.CapsuleGeometry(0.045, 0.13, 6, 16), glow, [x, 0.38, 0.84]).rotation.z = Math.PI / 2;
      add(new THREE.SphereGeometry(0.018, 16, 12), ceramic, [x - 0.025, 0.41, 0.865]);
    }
    add(new THREE.TorusGeometry(0.075, 0.009, 8, 24, Math.PI), trim, [0, 0.12, 0.86]).rotation.z = Math.PI;

    // Chunky side communication pods with colored lenses
    for (const x of [-0.69, 0.69]) {
      const pod = add(new THREE.SphereGeometry(0.22, 32, 24), armor, [x, 0.22, 0], [0.78, 1.1, 0.82]);
      pod.rotation.z = x < 0 ? -0.12 : 0.12;
      add(new THREE.CylinderGeometry(0.095, 0.095, 0.08, 28), trim, [x * 1.04, 0.22, 0.13]).rotation.z = Math.PI / 2;
      add(new THREE.SphereGeometry(0.075, 24, 18), glow, [x * 1.04, 0.22, 0.19]);
    }

    // Twin short antenna fins and a bright navigation beacon
    for (const x of [-0.28, 0.28]) {
      const antenna = add(new THREE.ConeGeometry(0.105, 0.34, 6), trim, [x, 1.02, -0.02]);
      antenna.rotation.z = x < 0 ? -0.22 : 0.22;
    }
    add(new THREE.SphereGeometry(0.085, 24, 18), glow, [0, 1.18, 0.02]);

    // Floating shoulder guards, layered like a tiny space suit
    for (const x of [-0.7, 0.7]) {
      const guard = add(new THREE.SphereGeometry(0.31, 36, 24), ceramic, [x, -0.82, 0.02], [1.18, 0.8, 0.86]);
      guard.rotation.z = x < 0 ? -0.12 : 0.12;
      add(new THREE.TorusGeometry(0.12, 0.025, 10, 32), glow, [x, -0.84, 0.27]);
      add(new THREE.BoxGeometry(0.12, 0.2, 0.1), trim, [x * 1.08, -1.05, 0.2]);
    }

    // Small floating navigation rings and side thruster lights
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.018, 10, 72), trim);
    halo.position.set(0, 0.18, -0.38);
    halo.rotation.set(0.65, 0.2, 0.15);
    robot.add(halo);
    const halo2 = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.012, 8, 72), glow);
    halo2.position.set(0, -0.15, -0.42);
    halo2.rotation.set(1.2, -0.3, 0.1);
    robot.add(halo2);
    const thrusters: THREE.Mesh[] = [];
    for (const x of [-0.83, 0.83]) {
      const thruster = add(new THREE.ConeGeometry(0.07, 0.24, 20), glow, [x, -1.28, 0.08]);
      thruster.rotation.x = Math.PI;
      thrusters.push(thruster);
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
      robot.position.y = Math.sin(t * 1.55) * 0.055;
      robot.rotation.y = Math.sin(t * 0.7) * 0.17;
      robot.rotation.x = Math.sin(t * 0.9) * 0.025;
      halo.rotation.y = t * 0.58;
      halo.rotation.x = 0.65 + Math.sin(t * 0.8) * 0.1;
      halo2.rotation.z = t * -0.42;
      halo2.rotation.x = 1.2 + Math.sin(t * 0.65) * 0.08;
      thrusters.forEach((jet, index) => { jet.scale.y = 0.82 + (Math.sin(t * 5 + index) + 1) * 0.24; });
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
