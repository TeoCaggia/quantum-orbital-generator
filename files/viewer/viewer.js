import {
	AmbientLight,
	AnimationMixer,
	Box3,
	Cache,
	Color,
	DirectionalLight,
	LoadingManager,
	PMREMGenerator,
	PerspectiveCamera,
	PointsMaterial,
	Scene,
	Vector3,
	WebGLRenderer,
	LinearToneMapping,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { FreeControls } from './free-controls.js';
import { LabeledAxes } from './labeled-axes.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { GUI } from 'dat.gui';

const DEFAULT_CAMERA = '[default]';

const MANAGER = new LoadingManager();
const THREE_PATH = new URL('./vendor/three', import.meta.url).href;
const DRACO_LOADER = new DRACOLoader(MANAGER).setDecoderPath(
	`${THREE_PATH}/examples/jsm/libs/draco/gltf/`,
);
const KTX2_LOADER = new KTX2Loader(MANAGER).setTranscoderPath(
	`${THREE_PATH}/examples/jsm/libs/basis/`,
);

Cache.enabled = true;

export class Viewer {
	constructor(el) {
		this.el = el;

		this.lights = [];
		this.content = null;
		this.mixer = null;
		this.clips = [];
		this.gui = null;

		this.state = {
			playbackSpeed: 1.0,
			actionStates: {},
			camera: DEFAULT_CAMERA,
			axes: false,
			autoRotate: true,

		};

		this.prevTime = 0;

		this.scene = new Scene();
		this.scene.background = new Color(0x000000);

		const aspect = el.clientWidth / el.clientHeight;
		this.defaultCamera = new PerspectiveCamera(60, aspect, 0.01, 1000);
		this.activeCamera = this.defaultCamera;
		this.scene.add(this.defaultCamera);

		this.renderer = new WebGLRenderer({ antialias: true });
		this.renderer.setClearColor(0x000000);
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		this.renderer.setSize(el.clientWidth, el.clientHeight);

		this.renderer.toneMapping = LinearToneMapping;
		const environmentGenerator = new PMREMGenerator(this.renderer);
		const room = new RoomEnvironment();
		this.scene.environment = environmentGenerator.fromScene(room).texture;
		room.dispose();
		environmentGenerator.dispose();

		this.controls = new FreeControls(this.defaultCamera, this.renderer.domElement);

		this.el.appendChild(this.renderer.domElement);
		this.controls.handleResize();

		this.cameraCtrl = null;
		this.cameraFolder = null;
		this.animFolder = null;
		this.animCtrls = [];
		this.morphFolder = null;
		this.morphCtrls = [];
		this.axesHelper = null;

		this.addGUI();

		this.animate = this.animate.bind(this);
		requestAnimationFrame(this.animate);
		window.addEventListener('resize', this.resize.bind(this), false);
	}

	animate(time) {
		requestAnimationFrame(this.animate);

		const dt = Math.min((time - this.prevTime) / 1000, 0.1);

		this.controls.update(dt);
		this.mixer && this.mixer.update(dt);
		this.render();

		this.prevTime = time;
	}

	render() {
		this.renderer.render(this.scene, this.activeCamera);
	}

	async load(url) {
		this.loadWarnings = [];
		MANAGER.onError = failedURL => this.loadWarnings.push(failedURL);
		const loader = new GLTFLoader(MANAGER)
			.setDRACOLoader(DRACO_LOADER)
			.setKTX2Loader(KTX2_LOADER.detectSupport(this.renderer))
			.setMeshoptDecoder(MeshoptDecoder);
		const gltf = await loader.loadAsync(url);
		const scene = gltf.scene || gltf.scenes?.[0];
		if (!scene) throw new Error('This model contains no scene and cannot be viewed.');
		this.setContent(scene, gltf.animations || []);
		return gltf;
	}

	/**
	 * @param {THREE.Object3D} object
	 * @param {Array<THREE.AnimationClip} clips
	 */
	setContent(object, clips) {
		this.clear();

		object.updateMatrixWorld(); // donmccurdy/three-gltf-viewer#330

		const box = new Box3().setFromObject(object);
		const center = box.getCenter(new Vector3());

		object.position.x -= center.x;
		object.position.y -= center.y;
		object.position.z -= center.z;

		const dimensions = box.getSize(new Vector3());
		this.axesSize = Math.max(dimensions.x, dimensions.y, dimensions.z, 0.000001) * 0.65;

		this.scene.add(object);
		this.content = object;

		this.state.punctualLights = true;

		this.content.traverse((node) => {
			if (node.isLight) {
				this.state.punctualLights = false;
			}
		});

		this.setClips(clips);

		this.updateLights();
		this.updateGUI();
		this.updateDisplay();

	}

	/**
	 * @param {Array<THREE.AnimationClip} clips
	 */
	setClips(clips) {
		if (this.mixer) {
			this.mixer.stopAllAction();
			this.mixer.uncacheRoot(this.mixer.getRoot());
			this.mixer = null;
		}

		this.clips = clips;
		if (!clips.length) return;

		this.mixer = new AnimationMixer(this.content);
	}

	playAllClips() {
		this.clips.forEach((clip) => {
			this.mixer.clipAction(clip).reset().play();
			this.state.actionStates[clip.name] = true;
		});
	}

	/**
	 * @param {string} name
	 */
	setCamera(name) {
		if (name === DEFAULT_CAMERA) {
			this.controls.enabled = true;
			this.activeCamera = this.defaultCamera;
		} else {
			this.controls.enabled = false;
			this.content.traverse((node) => {
				if (node.isCamera && node.name === name) {
					this.activeCamera = node;
				}
			});
		}
	}

	updateLights() {
		if (this.state.punctualLights && !this.lights.length) {
			const ambient = new AmbientLight(0xffffff, 0.3);
			const direct = new DirectionalLight(0xffffff, 0.8 * Math.PI);
			direct.position.set(0.5, 0, 0.866);
			this.defaultCamera.add(ambient, direct);
			this.lights.push(ambient, direct);
		} else if (!this.state.punctualLights && this.lights.length) {
			this.lights.forEach(light => light.removeFromParent());
			this.lights.length = 0;
		}
	}

	updateDisplay() {
		if (!this.content) return;
		traverseMaterials(this.content, (material) => {
			if (material instanceof PointsMaterial) {
				material.size = 1;
			}
		});

		if (this.state.axes !== Boolean(this.axesHelper)) {
			if (this.state.axes) {
				this.axesHelper = new LabeledAxes();
				this.scene.add(this.axesHelper);
			} else {
				this.scene.remove(this.axesHelper);
				this.axesHelper.dispose();
				this.axesHelper = null;
			}
		}

		if (this.axesHelper) {
			this.axesHelper.scale.setScalar(this.axesSize);
			this.axesHelper.position.copy(this.content.position);
		}
		this.controls.autoRotate = this.state.autoRotate;
	}

	addGUI() {
		const gui = (this.gui = new GUI({
			autoPlace: false,
			scrollable: false, // The desktop overlay fits the available window height.
			width: 260,
			hideable: true,
		}));

		// Animation controls.
		this.animFolder = gui.addFolder('Animation');
		this.animFolder.domElement.style.display = 'none';
		const playbackSpeedCtrl = this.animFolder.add(this.state, 'playbackSpeed', 0, 1);
		playbackSpeedCtrl.onChange((speed) => {
			if (this.mixer) this.mixer.timeScale = speed;
		});
		this.animFolder.add({ playAll: () => this.playAllClips() }, 'playAll');

		// Morph target controls.
		this.morphFolder = gui.addFolder('Morph Targets');
		this.morphFolder.domElement.style.display = 'none';

		// Camera controls.
		this.cameraFolder = gui.addFolder('Cameras');
		this.cameraFolder.domElement.style.display = 'none';

		const guiWrap = document.createElement('div');
		this.el.appendChild(guiWrap);
		guiWrap.classList.add('gui-wrap');
		guiWrap.appendChild(gui.domElement);
		gui.open();
	}

	updateGUI() {
		this.cameraFolder.domElement.style.display = 'none';

		this.morphCtrls.forEach((ctrl) => ctrl.remove());
		this.morphCtrls.length = 0;
		this.morphFolder.domElement.style.display = 'none';

		this.animCtrls.forEach((ctrl) => ctrl.remove());
		this.animCtrls.length = 0;
		this.animFolder.domElement.style.display = 'none';

		const cameraNames = [];
		const morphMeshes = [];
		this.content.traverse((node) => {
			if (node.geometry && node.morphTargetInfluences) {
				morphMeshes.push(node);
			}
			if (node.isCamera) {
				node.name = node.name || `VIEWER__camera_${cameraNames.length + 1}`;
				cameraNames.push(node.name);
			}
		});

		if (cameraNames.length) {
			this.cameraFolder.domElement.style.display = '';
			if (this.cameraCtrl) this.cameraCtrl.remove();
			const cameraOptions = [DEFAULT_CAMERA].concat(cameraNames);
			this.cameraCtrl = this.cameraFolder.add(this.state, 'camera', cameraOptions);
			this.cameraCtrl.onChange((name) => this.setCamera(name));
		}

		if (morphMeshes.length) {
			this.morphFolder.domElement.style.display = '';
			morphMeshes.forEach((mesh) => {
				if (mesh.morphTargetInfluences.length) {
					const nameCtrl = this.morphFolder.add(
						{ name: mesh.name || 'Untitled' },
						'name',
					);
					this.morphCtrls.push(nameCtrl);
				}
				for (let i = 0; i < mesh.morphTargetInfluences.length; i++) {
					const ctrl = this.morphFolder
						.add(mesh.morphTargetInfluences, i, 0, 1, 0.01)
						.listen();
					Object.keys(mesh.morphTargetDictionary).forEach((key) => {
						if (key && mesh.morphTargetDictionary[key] === i) ctrl.name(key);
					});
					this.morphCtrls.push(ctrl);
				}
			});
		}

		if (this.clips.length) {
			this.animFolder.domElement.style.display = '';
			const actionStates = (this.state.actionStates = {});
			this.clips.forEach((clip, clipIndex) => {
				clip.name = `${clipIndex + 1}. ${clip.name}`;

				// Autoplay the first clip.
				let action;
				if (clipIndex === 0) {
					actionStates[clip.name] = true;
					action = this.mixer.clipAction(clip);
					action.play();
				} else {
					actionStates[clip.name] = false;
				}

				// Play other clips when enabled.
				const ctrl = this.animFolder.add(actionStates, clip.name).listen();
				ctrl.onChange((playAnimation) => {
					action = action || this.mixer.clipAction(clip);
					action.setEffectiveTimeScale(1);
					playAnimation ? action.play() : action.stop();
				});
				this.animCtrls.push(ctrl);
			});
		}
	}

	clear() {
		if (!this.content) return;

		this.scene.remove(this.content);

		// dispose geometry
		this.content.traverse((node) => {
			if (!node.geometry) return;

			node.geometry.dispose();
		});

		// dispose textures
		traverseMaterials(this.content, (material) => {
			for (const key in material) {
				if (key !== 'envMap' && material[key] && material[key].isTexture) {
					material[key].dispose();
				}
			}
			material.dispose();
		});
	}
}

function traverseMaterials(object, callback) {
	object.traverse((node) => {
		if (!node.geometry) return;
		const materials = Array.isArray(node.material) ? node.material : [node.material];
		materials.forEach(callback);
	});
}
