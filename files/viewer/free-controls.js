import { MOUSE, Vector3 } from 'three';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';

// Trackball rotation has no polar stops and lets the camera roll naturally.
export class FreeControls extends TrackballControls {
  constructor(camera, element) {
    super(camera, element);
    this.rotateSpeed = 4;
    this.dynamicDampingFactor = 0.2;
    this.autoRotate = false;
    this.autoRotateSpeed = 2 * Math.PI / 45;
    // Do not capture letter keys while editing a control-panel field.
    this.keys = [];
    this.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: -1, RIGHT: -1 };
    this._panAllowed = false;
    const beginMouseDrag = this._onMouseDown;
    const endMouseDrag = this._onMouseUp;
    this._onMouseDown = event => {
      this._panAllowed = event.button === 0 && event.shiftKey;
      this.mouseButtons.LEFT = this._panAllowed ? MOUSE.PAN : MOUSE.ROTATE;
      // A new rotation must never inherit movement from a previous pan.
      this._panStart.copy(this._panEnd);
      this._lastAngle = 0;
      beginMouseDrag(event);
    };
    this._onMouseUp = () => {
      this._panAllowed = false;
      this._panStart.copy(this._panEnd);
      endMouseDrag();
    };
  }

  saveState() {
    this._target0.copy(this.target);
    this._position0.copy(this.object.position);
    this._up0.copy(this.object.up);
    this._zoom0 = this.object.zoom;
  }

  clearMotion() {
    // Clear drag/zoom inertia before a preset, model load or smooth fit.
    this._lastAngle = 0;
    this._movePrev.copy(this._moveCurr);
    this._panStart.copy(this._panEnd);
    this._zoomStart.copy(this._zoomEnd);
  }

  reset() {
    this.clearMotion();
    super.reset();
  }

  update(delta = 0) {
    if (!this.enabled) return;
    if (this.autoRotate && !this._pointers.length && Math.abs(this._lastAngle) < 0.0001 && delta > 0) {
      const axis = this.object.up.clone().normalize();
      const offset = new Vector3().subVectors(this.object.position, this.target);
      offset.applyAxisAngle(axis, -this.autoRotateSpeed * delta);
      this.object.position.copy(this.target).add(offset);
    }
    super.update();
  }

  _panCamera() {
    if (this._panAllowed) super._panCamera();
    this._panStart.copy(this._panEnd);
  }
}
