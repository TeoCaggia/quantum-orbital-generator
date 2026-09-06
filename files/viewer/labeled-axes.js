import { AxesHelper, CanvasTexture, ConeGeometry, Group, Mesh, MeshBasicMaterial,
  Sprite, SpriteMaterial, Vector3 } from 'three';

// These are the Cartesian coordinates used by orbital_generator.py and its exports:
// px -> X, py -> Y, pz -> Z. Camera movement never changes this model frame.
export class LabeledAxes extends Group {
  constructor(labelScale = 0.08) {
    super();
    this.add(new AxesHelper(1));
    for (const [label, color, direction] of [
      ['X', '#ff6666', [1, 0, 0]],
      ['Y', '#66ff66', [0, 1, 0]],
      ['Z', '#6688ff', [0, 0, 1]],
    ]) {
      const arrow = new Mesh(new ConeGeometry(0.025, 0.08, 16),
        new MeshBasicMaterial({ color, toneMapped: false }));
      arrow.name = `arrow-${label}`;
      arrow.position.fromArray(direction).multiplyScalar(0.96);
      arrow.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(...direction));
      this.add(arrow);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      const context = canvas.getContext('2d');
      context.font = '400 105.6px Syne, system-ui, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.lineWidth = 10;
      context.strokeStyle = '#000';
      context.strokeText(label, 64, 66);
      context.fillStyle = color;
      context.fillText(label, 64, 66);
      const material = new SpriteMaterial({ map: new CanvasTexture(canvas), depthTest: false,
        depthWrite: false, toneMapped: false });
      const sprite = new Sprite(material);
      sprite.name = `axis-${label}`;
      sprite.position.fromArray(direction).multiplyScalar(1.12);
      sprite.scale.setScalar(labelScale);
      this.add(sprite);
    }
    this.traverse(node => {
      node.renderOrder = 1000;
      if (node.material) {
        node.material.depthTest = false;
        node.material.depthWrite = false;
      }
    });
  }

  dispose() {
    this.traverse(node => {
      node.geometry?.dispose();
      node.material?.map?.dispose();
      node.material?.dispose();
    });
  }
}
