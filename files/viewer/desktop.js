// Desktop adaptation of Don McCurdy's MIT-licensed three-gltf-viewer.
import { Vector2, Vector3, Box3 } from 'three';
import { Viewer } from './viewer.js';
import { valenceSelection } from './valence.js';
import { configurationGroups } from './configuration.js';
import { BohrModel, elementCategory } from './bohr-model.js';

const ELEMENT_SYMBOLS = (
  'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn ' +
  'Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce ' +
  'Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn ' +
  'Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'
).split(' ');

const PERIODIC_LAYOUT = [];
const addSequence = (row, column, symbols) => symbols.forEach((symbol, index) => {
  PERIODIC_LAYOUT.push({ symbol, row, column: column + index });
});
addSequence(1, 1, ['H']);
addSequence(1, 18, ['He']);
addSequence(2, 1, ['Li', 'Be']);
addSequence(2, 13, ['B', 'C', 'N', 'O', 'F', 'Ne']);
addSequence(3, 1, ['Na', 'Mg']);
addSequence(3, 13, ['Al', 'Si', 'P', 'S', 'Cl', 'Ar']);
addSequence(4, 1, ['K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr']);
addSequence(5, 1, ['Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn', 'Sb', 'Te', 'I', 'Xe']);
addSequence(6, 1, ['Cs', 'Ba']);
addSequence(6, 4, ['Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg', 'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn']);
addSequence(7, 1, ['Fr', 'Ra']);
addSequence(7, 4, ['Rf', 'Db', 'Sg', 'Bh', 'Hs', 'Mt', 'Ds', 'Rg', 'Cn', 'Nh', 'Fl', 'Mc', 'Lv', 'Ts', 'Og']);
addSequence(9, 3, ['La', 'Ce', 'Pr', 'Nd', 'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu']);
addSequence(10, 3, ['Ac', 'Th', 'Pa', 'U', 'Np', 'Pu', 'Am', 'Cm', 'Bk', 'Cf', 'Es', 'Fm', 'Md', 'No', 'Lr']);

const PERIODIC_SERIES_MARKERS = [
  { label: '*', row: 6, column: 3 },
  { label: '**', row: 7, column: 3 },
  { label: '*', row: 9, column: 2 },
  { label: '**', row: 10, column: 2 },
];

// Ratios measured from the reference layout in Screenshot 2026-09-07 002504.
// Every periodic-table text size is derived from the untransformed cell side;
// the common panel scale then preserves the same proportions on screen.
const PERIODIC_TYPOGRAPHY_RATIOS = {
  title: 0.4572,
  symbol: 0.294125,
  atomicNumber: 0.1775,
  seriesMarker: 0.3227,
  unavailableMessage: 0.2259,
};

// Canvas labels and identity text must be rendered only after the bundled
// variable font has loaded at every weight used by the interface.
await Promise.all([
  document.fonts.load('400 14px "Syne"'),
  document.fonts.load('700 20px "Syne"'),
  document.fonts.load('800 113px "Syne"'),
  document.fonts.load('400 13px "Fira Code"'),
  document.fonts.load('400 18px "Fira Code"'),
]);

let bridge;
document.addEventListener('contextmenu', event => event.preventDefault());
const channel = new Promise(resolve => new QWebChannel(qt.webChannelTransport, c => resolve(c.objects.desktop)));

class DesktopViewer extends Viewer {
  constructor(el) {
    super(el);
    this.loadId = 0;
    this.bohrModel = new BohrModel(
      el,
      (orbitals, focusOrbital) => this.showOnlyOrbitals(orbitals, focusOrbital),
      url => bridge.openExternal(url),
    );
    this.visibilityFolder = this.gui.addFolder('Electron configuration');
    this.visibilityFolder.open();
    this.visibilityFolder.__ul.firstElementChild.classList.add('panel-heading');
    this.visibilityFolder.__ul.classList.add('panel-stack');
    const createPanel = (name, label) => {
      const panel = document.createElement('li');
      panel.className = 'configuration-row';
      panel.dataset.panel = name;
      panel.setAttribute('role', 'group');
      panel.setAttribute('aria-label', label);
      this.visibilityFolder.__ul.append(panel);
      return panel;
    };
    const openPanel = createPanel('open', 'Open model');
    const displayPanel = createPanel('display', 'Rotation and axes');
    openPanel.classList.add('periodic-table-panel');
    const periodicTitle = document.createElement('div');
    periodicTitle.className = 'periodic-table-title';
    periodicTitle.setAttribute('aria-label', 'Seleziona un elemento per vederne la struttura atomica');
    for (const [text, emphasized] of [
      ['Seleziona un elemento', false],
      ['per vederne la', false],
      ['struttura atomica', true],
    ]) {
      const line = document.createElement('span');
      line.className = emphasized ? 'periodic-table-title-emphasis' : 'periodic-table-title-line';
      line.textContent = text;
      periodicTitle.append(line);
    }
    const periodicTable = document.createElement('div');
    periodicTable.className = 'periodic-table';
    periodicTable.setAttribute('role', 'group');
    periodicTable.setAttribute('aria-label', 'Tavola periodica degli elementi');
    periodicTable.append(periodicTitle);
    for (const { symbol, row, column } of PERIODIC_LAYOUT) {
      const atomicNumber = ELEMENT_SYMBOLS.indexOf(symbol) + 1;
      const category = elementCategory(symbol);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'periodic-element';
      button.style.gridRow = String(row);
      button.style.gridColumn = String(column);
      button.style.setProperty('--element-color', category.color);
      button.title = `${symbol} · ${category.singular}`;
      button.setAttribute('aria-label', `${symbol}, numero atomico ${atomicNumber}, ${category.singular}`);
      const number = document.createElement('span');
      number.className = 'periodic-element-number';
      number.textContent = String(atomicNumber);
      const label = document.createElement('strong');
      label.className = 'periodic-element-symbol';
      label.textContent = symbol;
      button.append(number, label);
      button.addEventListener('click', () => bridge.openElement(symbol));
      periodicTable.append(button);
    }
    for (const { label, row, column } of PERIODIC_SERIES_MARKERS) {
      const marker = document.createElement('span');
      marker.className = 'periodic-series-marker';
      marker.style.gridRow = String(row);
      marker.style.gridColumn = String(column);
      marker.textContent = label;
      marker.setAttribute('aria-hidden', 'true');
      periodicTable.append(marker);
    }
    openPanel.append(periodicTable);
    this.unavailableTimer = 0;
    this.unavailableMessage = document.createElement('div');
    this.unavailableMessage.className = 'model-unavailable-message';
    this.unavailableMessage.setAttribute('role', 'status');
    this.unavailableMessage.setAttribute('aria-live', 'polite');
    this.unavailableMessage.textContent = 'Il modello orbitalico di questo elemento non è ancora stato generato';
    el.append(this.unavailableMessage);
    const updatePeriodicTypography = () => {
      const referenceCell = periodicTable.querySelector('.periodic-element');
      const cellSize = Number.parseFloat(getComputedStyle(referenceCell).width);
      if (!(cellSize > 0)) return;
      for (const [name, ratio] of Object.entries(PERIODIC_TYPOGRAPHY_RATIOS)) {
        el.style.setProperty(`--periodic-${name}-font-size`, `${(cellSize * ratio).toFixed(3)}px`);
      }
    };
    this.periodicTypographyObserver = new ResizeObserver(updatePeriodicTypography);
    this.periodicTypographyObserver.observe(periodicTable);
    requestAnimationFrame(updatePeriodicTypography);
    const display = document.createElement('div');
    display.className = 'display-actions';
    this.displayButtons = [];
    for (const [property, offLabel, onLabel] of [
      ['autoRotate', 'Attiva rotazione automatica', 'Ferma rotazione automatica'],
      ['axes', 'Mostra gli assi', 'Nascondi gli assi'],
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'configuration-toggle display-toggle';
      button.dataset.display = property;
      button.lang = 'it';
      button.textContent = this.state[property] ? onLabel : offLabel;
      button.setAttribute('aria-pressed', String(this.state[property]));
      button.addEventListener('click', () => {
        this.state[property] = !this.state[property];
        this.updateDisplay();
      });
      this.displayButtons.push({ button, property, offLabel, onLabel });
      display.append(button);
    }
    displayPanel.append(display);
    const restore = this.restoreButton = document.createElement('button');
    restore.type = 'button';
    restore.lang = 'it';
    restore.className = 'configuration-toggle display-toggle restore-view';
    restore.dataset.command = 'restore';
    restore.textContent = 'Ripristina la visuale originale';
    restore.disabled = true;
    restore.addEventListener('click', () => this.fit('perspective'));
    displayPanel.append(restore);
    this.elementPickerPanel = document.createElement('li');
    this.elementPickerPanel.className = 'configuration-row element-picker-panel';
    this.elementPickerPanel.dataset.panel = 'element-picker';
    this.elementPickerPanel.setAttribute('role', 'group');
    this.elementPickerPanel.setAttribute('aria-label', 'Selezione elemento');
    const chooseElement = document.createElement('button');
    chooseElement.type = 'button';
    chooseElement.lang = 'it';
    chooseElement.className = 'configuration-toggle choose-element-button';
    chooseElement.textContent = 'Scegli un altro elemento';
    chooseElement.addEventListener('click', () => this.showElementPicker());
    this.elementPickerPanel.append(chooseElement);
    this.controlsFitFrame = 0;
    this.resizeFrame = 0;
    this.panelObserver = new ResizeObserver(() => this.fitControls());
    this.panelObserver.observe(this.gui.domElement);
    this.panelObserver.observe(this.el);
    this.panelObserver.observe(this.bohrModel.panelGroup);
    document.addEventListener('pointerdown', event => {
      if (this.orbitalMenu && !this.orbitalMenu.contains(event.target)) this.closeOrbitalMenu();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') this.closeOrbitalMenu(true);
    });
    window.addEventListener('resize', () => this.closeOrbitalMenu());
    this.controls.addEventListener('start', () => { this.fitAnimation = null; });
  }

  updateDisplay() {
    super.updateDisplay();
    this.el.classList.toggle('has-model', Boolean(this.content));
    for (const { button, property, offLabel, onLabel } of this.displayButtons || []) {
      button.setAttribute('aria-pressed', String(this.state[property]));
      button.textContent = this.state[property] ? onLabel : offLabel;
    }
  }

  fitControls() {
    // ResizeObserver and native window resizing may fire many times before the
    // next paint. Collapse them into one compositor update per frame.
    if (this.controlsFitFrame) return;
    this.controlsFitFrame = requestAnimationFrame(() => {
      this.controlsFitFrame = 0;
      this.applyControlFit();
    });
  }

  showMissingModelMessage() {
    clearTimeout(this.unavailableTimer);
    this.unavailableMessage.classList.add('is-visible');
    this.unavailableTimer = window.setTimeout(() => {
      this.unavailableMessage.classList.remove('is-visible');
      this.unavailableTimer = 0;
    }, 3000);
  }

  hideMissingModelMessage() {
    clearTimeout(this.unavailableTimer);
    this.unavailableTimer = 0;
    this.unavailableMessage.classList.remove('is-visible');
  }

  applyControlFit() {
    // Both sides use the smaller scale required by either group. Since their
    // unscaled widths are synchronized, their visible widths remain equal too.
    // Transforms do not change layout dimensions, avoiding resize feedback.
    const rightPanel = this.gui.domElement.parentElement;
    const leftPanel = this.bohrModel?.panelGroup;
    const availableHeight = Math.max(1, this.el.clientHeight - 20);
    let rightHeight = Math.max(1, this.gui.domElement.offsetHeight);
    let scale = Math.min(1, availableHeight / rightHeight);

    if (leftPanel && this.content && leftPanel.offsetHeight) {
      // Match the layout width before applying the common scale. This also
      // covers very narrow windows where .gui-wrap's max-width takes effect.
      const synchronizedWidth = rightPanel.offsetWidth;
      if (leftPanel.offsetWidth !== synchronizedWidth) {
        leftPanel.style.width = `${synchronizedWidth}px`;
        this.bohrModel.draw();
      }

      // Adjust every subshell-button row by the same amount until the total
      // right-hand stack is exactly as tall as the left-hand stack. The lower
      // bound leaves room for the element-picker panel without changing the
      // total height of the right-hand group.
      const leftHeight = leftPanel.offsetHeight;
      const orbitalButtons = [...rightPanel.querySelectorAll('.configuration-grid .configuration-toggle')];
      const orbitalRows = new Set(
        [...rightPanel.querySelectorAll('.configuration-grid .configuration-cell')]
          .map(cell => cell.style.gridRow)
          .filter(Boolean),
      ).size;
      if (orbitalButtons.length && orbitalRows) {
        const baseButtonHeight = 35;
        const minimumButtonHeight = 24;
        const currentButtonHeight = Number.parseFloat(getComputedStyle(orbitalButtons[0]).height)
          || baseButtonHeight;
        const baseRightHeight = rightHeight - orbitalRows * (currentButtonHeight - baseButtonHeight);
        let buttonHeight = Math.max(minimumButtonHeight,
          baseButtonHeight + (leftHeight - baseRightHeight) / orbitalRows);
        rightPanel.style.setProperty('--orbital-button-height', `${buttonHeight}px`);

        // Offset-height is integer-rounded. One correction removes the possible
        // final one-pixel difference without introducing a resize feedback loop.
        rightHeight = Math.max(1, this.gui.domElement.offsetHeight);
        buttonHeight = Math.max(minimumButtonHeight,
          buttonHeight + (leftHeight - rightHeight) / orbitalRows);
        rightPanel.style.setProperty('--orbital-button-height', `${buttonHeight}px`);
        rightHeight = Math.max(1, this.gui.domElement.offsetHeight);
      }

      const commonHeight = Math.max(leftHeight, rightHeight);
      scale = Math.min(1, availableHeight / commonHeight);
      leftPanel.style.setProperty('--panel-scale', scale);
    }
    rightPanel.style.setProperty('--panel-scale', scale);
  }

  resize(event) {
    // The base viewer forwards the native resize event here. WebGL buffer
    // allocation is expensive, so coalesce the event stream to animation frames.
    if (event?.type === 'resize') {
      if (this.resizeFrame) return;
      this.resizeFrame = requestAnimationFrame(() => {
        this.resizeFrame = 0;
        this.applyResize();
      });
      return;
    }
    this.applyResize();
  }

  applyResize() {
    // The floating controls overlay the full-width camera viewport.
    const width = Math.max(1, this.el.clientWidth);
    const height = Math.max(1, this.el.clientHeight);
    this.defaultCamera.aspect = width / height;
    this.defaultCamera.updateProjectionMatrix();
    this.updateZoomLimits();
    const current = this.renderer.getSize(new Vector2());
    if (current.x !== width || current.y !== height) {
      this.renderer.setSize(width, height);
      // Resizing clears the drawing buffer. Refill it in this same event.
      this.render();
    }
    this.controls.handleResize();
    this.fitControls();
  }

  async present() {
    const loadId = this.loadId;
    this.resize();
    await this.renderer.compileAsync(this.scene, this.activeCamera);
    if (loadId !== this.loadId) return;
    // Upload geometry and draw while hidden. Present both layers together once
    // the browser has had a frame to composite the completed scene and panel.
    this.render();
    await new Promise(requestAnimationFrame);
    if (loadId !== this.loadId) return;
    this.render();
    this.el.classList.remove('loading');
    await new Promise(requestAnimationFrame);
  }

  setContent(object, clips) {
    this.hideMissingModelMessage();
    this.fitAnimation = null;
    this.orbitalFade = null;
    this.closeOrbitalMenu();
    super.setContent(object, clips);
    this.configurationRow?.remove();
    this.objects = [];
    object.traverse(node => { if (node.geometry) this.objects.push(node); });
    this.prepareOrbitalMaterials();
    const valence = valenceSelection(this.objects);
    this.valenceObjects = valence.objects;
    this.valenceDescription = valence.description;
    this.bohrModel.update(this.modelMetadata);
    // The complete 3D model is the neutral starting view. Bohr electrons begin
    // inactive so the first click becomes an explicit orbital selection.
    this.bohrModel.setActiveOrbitals(new Set());
    this.buildConfiguration();
    this.restoreButton.disabled = false;
    this.fit('perspective');
    this.controls.saveState();
    this.updateDisplay();
  }

  buildConfiguration() {
    this.configurationGroups = configurationGroups(this.objects, this.modelMetadata);
    const row = this.configurationRow = document.createElement('li');
    row.className = 'configuration-row';
    row.dataset.panel = 'orbitals';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Electron configuration');
    // Two-state segmented toggles rather than four separate show/hide
    // buttons — "Tutti" flips between every orbital shown and none shown;
    // "Valenza" flips between isolating the valence set and restoring every
    // orbital. Their pressed state is derived from the actual node
    // visibility each time (see syncConfiguration()), so they stay correct
    // even when a grid cell changes visibility instead.
    const actions = document.createElement('div');
    actions.className = 'configuration-actions';

    const allToggle = this.allToggleButton = document.createElement('button');
    allToggle.type = 'button';
    allToggle.className = 'configuration-toggle selection-toggle';
    allToggle.dataset.selection = 'all';
    allToggle.lang = 'it';
    allToggle.textContent = 'Tutti';
    allToggle.setAttribute('aria-label', 'Mostra o nascondi tutti gli orbitali');
    allToggle.disabled = !this.objects.length;
    allToggle.addEventListener('click', () => {
      const showAll = !(this.objects.length && this.objects.every((node) => node.visible));
      this.setObjectsVisible(this.objects, showAll);
    });
    actions.append(allToggle);

    const valenceToggle = this.valenceToggleButton = document.createElement('button');
    valenceToggle.type = 'button';
    valenceToggle.className = 'configuration-toggle selection-toggle';
    valenceToggle.dataset.selection = 'valence';
    valenceToggle.lang = 'it';
    valenceToggle.textContent = 'Valenza';
    valenceToggle.setAttribute('aria-label', 'Mostra solo gli orbitali di valenza, o torna a mostrarli tutti');
    valenceToggle.disabled = !this.valenceObjects.length;
    valenceToggle.title = this.valenceDescription;
    valenceToggle.addEventListener('click', () => {
      if (this.isValenceOnlyVisible()) {
        this.setObjectsVisible(this.objects, true);
      } else {
        const valence = new Set(this.valenceObjects);
        this.setObjectsVisible(this.objects.filter((node) => !valence.has(node)), false);
        this.setObjectsVisible(this.valenceObjects, true);
      }
    });
    actions.append(valenceToggle);
    row.append(actions);
    const grid = document.createElement('div');
    grid.className = 'configuration-grid';
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', 'Electron configuration by shell and subshell');
    for (const group of this.configurationGroups) {
      const cell = document.createElement('div');
      cell.className = 'configuration-cell';
      cell.dataset.subshell = group.key;
      cell.dataset.type = group.l === null ? 'object' : 'spdf'[group.l];
      if (group.n !== null) {
        cell.style.gridRow = group.n;
        cell.style.gridColumn = group.l + 1;
      } else {
        cell.style.gridRow = Math.max(0, ...this.configurationGroups.map(g => g.n || 0)) + 1
          + Math.floor(this.configurationGroups.filter(g => g.n === null).indexOf(group) / 4);
      }
      const button = group.button = document.createElement('button');
      button.type = 'button';
      button.className = 'configuration-toggle';
      button.textContent = group.label;
      button.disabled = group.nodes.length === 0;
      if (group.electrons !== null) {
        const population = document.createElement('sup');
        population.textContent = group.electrons;
        button.append(population);
      }
      const description = group.electrons === null ? group.label
        : `${group.label}, ${group.electrons} electron${group.electrons === 1 ? '' : 's'}`;
      button.setAttribute('aria-label', description);
      button.title = `Show / hide ${description}\n${group.nodes.map(node => node.name).join(', ')}${group.n !== null && group.electrons === null ? '\nElectron count unavailable without matching model metadata.' : ''}\nPress and hold to isolate and zoom in.`;
      if (button.disabled) button.title = `${group.label}: unoccupied / not present in this model`;
      this.attachOrbitalControls(button, () => group.nodes, () => {
        const visible = !group.nodes.every(node => node.visible);
        this.setObjectsVisible(group.nodes, visible);
      });
      if (new Set(group.nodes.map(node => node.name)).size > 1) {
        button.setAttribute('aria-haspopup', 'dialog');
        button.setAttribute('aria-expanded', 'false');
        button.title += '\nRight-click to show or hide individual orbitals.';
        button.addEventListener('contextmenu', event => {
          event.preventDefault();
          event.stopPropagation();
          this.openOrbitalMenu(group, event.clientX, event.clientY);
        });
        button.addEventListener('keydown', event => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault();
            const rect = button.getBoundingClientRect();
            this.openOrbitalMenu(group, rect.left, rect.bottom);
          }
        });
      }
      cell.append(button);
      grid.append(cell);
    }
    row.append(grid);
    const hint = document.createElement('p');
    hint.className = 'configuration-hint';
    hint.textContent = 'Clicca sui riquadri per visualizzare\no nascondere i set di orbitali occupati';
    row.append(hint);
    const secondaryHint = document.createElement('p');
    secondaryHint.className = 'configuration-hint configuration-hint-secondary';
    secondaryHint.textContent = 'Click destro sui riquadri per\nscegliere i singoli orbitali';
    row.append(secondaryHint);
    this.visibilityFolder.__ul.append(row);
    // Appending an existing node moves it after the freshly rebuilt orbital
    // panel, keeping this action at the bottom after every model change.
    this.visibilityFolder.__ul.append(this.elementPickerPanel);
    this.syncConfiguration();
    this.fitControls();
  }

  showElementPicker() {
    this.loadId++;
    this.fitAnimation = null;
    this.completeOrbitalFade();
    this.closeOrbitalMenu();
    this.setClips([]);
    super.clear();
    this.content = null;
    this.modelMetadata = null;
    this.objects = [];
    this.valenceObjects = [];
    this.configurationGroups = [];
    if (this.axesHelper) {
      this.scene.remove(this.axesHelper);
      this.axesHelper.dispose();
      this.axesHelper = null;
    }
    this.restoreButton.disabled = true;
    this.updateDisplay();
    this.render();
    this.fitControls();
    bridge.elementPickerShown();
  }

  syncConfiguration() {
    for (const group of this.configurationGroups || []) {
      const shown = group.nodes.filter(node => node.visible).length;
      group.button.setAttribute('aria-pressed', shown > 0 && shown === group.nodes.length ? 'true' : shown ? 'mixed' : 'false');
    }
    for (const item of this.orbitalMenuItems || []) {
      item.button.setAttribute('aria-pressed', item.nodes.length && item.nodes.every(node => node.visible) ? 'true' : item.nodes.some(node => node.visible) ? 'mixed' : 'false');
    }
    if (this.allToggleButton) {
      const allVisible = this.objects.length > 0 && this.objects.every((node) => node.visible);
      this.allToggleButton.setAttribute('aria-pressed', String(allVisible));
    }
    if (this.valenceToggleButton) {
      this.valenceToggleButton.setAttribute('aria-pressed', String(this.isValenceOnlyVisible()));
    }
  }

  // True when exactly the valence set (and nothing else) is visible.
  isValenceOnlyVisible() {
    if (!this.valenceObjects.length) return false;
    const valence = new Set(this.valenceObjects);
    return this.objects.every((node) => node.visible === valence.has(node));
  }

  // Hides every orbital except `nodes` and fits the camera to what's left —
  // used by the press-and-hold gesture below.
  isolateNodes(nodes) {
    const keep = new Set(nodes);
    this.setObjectsVisible(this.objects.filter((node) => !keep.has(node)), false);
    this.setObjectsVisible(nodes, true);
  }

  // Press-and-hold on a configuration button isolates its orbitals (hiding
  // everything else) and zooms to them — a quick single-gesture shortcut,
  // and the touch-friendly counterpart to right-click's "pick individually"
  // menu, which has no touch equivalent. A plain click still just toggles
  // this button's own orbitals via `onToggle`, unchanged.
  attachOrbitalControls(button, getNodes, onToggle) {
    const LONG_PRESS_MS = 500;
    let timer = null;
    let longPressed = false;
    const cancelTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };
    button.addEventListener('pointerdown', (event) => {
      if (button.disabled || event.button > 0) return;
      longPressed = false;
      cancelTimer();
      timer = setTimeout(() => {
        longPressed = true;
        this.isolateNodes(getNodes());
      }, LONG_PRESS_MS);
    });
    button.addEventListener('pointerup', cancelTimer);
    button.addEventListener('pointerleave', cancelTimer);
    button.addEventListener('pointercancel', cancelTimer);
    button.addEventListener('click', () => {
      if (longPressed) { longPressed = false; return; }
      if (button.disabled) return;
      onToggle();
    });
  }

  setObjectsVisible(nodes, visible) {
    this.completeOrbitalFade();
    const newlyShown = visible ? nodes.filter(node => !node.visible) : [];
    const changed = nodes.some(node => node.visible !== visible);
    nodes.forEach(node => { node.visible = visible; });
    this.syncConfiguration();
    this.syncBohrElectrons();
    if (!changed) return;
    this.fitAnimation = null;
    if (visible) this.fitVisibleSmoothly(newlyShown);
    else this.updateZoomLimits();
  }

  syncBohrElectrons() {
    const visibleOrbitals = new Set(this.objects
      .filter(node => node.visible)
      .map(node => node.name));
    this.bohrModel.setActiveOrbitals(visibleOrbitals);
  }

  showOnlyOrbitals(orbitals, focusOrbital = null) {
    const selectedOrbitals = new Set(orbitals);
    const nodes = this.objects.filter(node => selectedOrbitals.has(node.name));
    const focusNodes = focusOrbital ? this.objects.filter(node => node.name === focusOrbital) : [];
    if (selectedOrbitals.size && !nodes.length) return false;
    if (focusOrbital && !focusNodes.length) return false;
    const selected = new Set(nodes);
    this.fitAnimation = null;
    const transitions = this.objects.map(node => {
      const from = node.visible ? this.orbitalOpacity(node) : 0;
      const to = selected.has(node) ? 1 : 0;
      node.visible = from > 0 || to > 0;
      return { node, from, to };
    });
    this.orbitalFade = { start: performance.now(), duration: 650, transitions };
    this.syncConfiguration();
    if (focusNodes.length) this.fitVisibleSmoothly(focusNodes);
    return true;
  }

  prepareOrbitalMaterials() {
    this.orbitalMaterialDefaults = new WeakMap();
    const originals = new Set();
    for (const node of this.objects) {
      if (!node.material) continue;
      const source = Array.isArray(node.material) ? node.material : [node.material];
      source.forEach(material => originals.add(material));
      const materials = source.map(material => {
        const clone = material.clone();
        this.orbitalMaterialDefaults.set(clone, {
          opacity: clone.opacity,
          transparent: clone.transparent,
          depthWrite: clone.depthWrite,
        });
        return clone;
      });
      node.material = Array.isArray(node.material) ? materials : materials[0];
    }
    originals.forEach(material => material.dispose());
  }

  orbitalMaterials(node) {
    if (!node.material) return [];
    return Array.isArray(node.material) ? node.material : [node.material];
  }

  orbitalOpacity(node) {
    const material = this.orbitalMaterials(node)[0];
    const defaults = material && this.orbitalMaterialDefaults.get(material);
    return material && defaults?.opacity ? material.opacity / defaults.opacity : 1;
  }

  setOrbitalOpacity(node, opacity) {
    const factor = Math.max(0, Math.min(1, opacity));
    for (const material of this.orbitalMaterials(node)) {
      const defaults = this.orbitalMaterialDefaults.get(material);
      if (!defaults) continue;
      const transparent = defaults.transparent || factor < 1;
      if (material.transparent !== transparent) material.needsUpdate = true;
      material.transparent = transparent;
      material.opacity = defaults.opacity * factor;
      material.depthWrite = factor < 1 ? false : defaults.depthWrite;
    }
  }

  completeOrbitalFade() {
    if (!this.orbitalFade) return;
    for (const { node, to } of this.orbitalFade.transitions) {
      node.visible = to > 0;
      this.setOrbitalOpacity(node, 1);
    }
    this.orbitalFade = null;
    this.syncConfiguration();
  }

  visibleBounds(nodes = this.objects) {
    if (!this.content) return [];
    this.content.updateWorldMatrix(true, true);
    const boxes = [];
    for (const node of nodes) {
      let visible = true;
      for (let parent = node; parent; parent = parent.parent) visible &&= parent.visible;
      if (!visible) continue;
      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      const box = node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld);
      if (!box.isEmpty()) boxes.push(box);
    }
    return boxes;
  }

  modelCenter() {
    if (!this.content) return new Vector3();
    this.content.updateWorldMatrix(true, true);
    const oneSBounds = new Box3();
    for (const node of this.objects.filter(node => node.name === '1s')) {
      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      oneSBounds.union(node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld));
    }
    if (!oneSBounds.isEmpty()) return oneSBounds.getCenter(new Vector3());
    return new Box3().setFromObject(this.content).getCenter(new Vector3());
  }

  framingDistance(radius) {
    const camera = this.defaultCamera;
    const vFov = camera.getEffectiveFOV() * Math.PI / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    return radius / Math.sin(Math.min(vFov, hFov) / 2) * 1.15;
  }

  updateZoomLimits() {
    const boxes = this.visibleBounds();
    if (!boxes.length) return;
    const combined = new Box3();
    let smallestRadius = Infinity;
    for (const box of boxes) {
      smallestRadius = Math.min(smallestRadius, Math.max(box.getSize(new Vector3()).length() / 2, 1e-6));
      combined.union(box);
    }
    // Include offsets from the current target, so off-centre visible objects fit too.
    const outerRadius = combined.getSize(new Vector3()).length() / 2
      + combined.getCenter(new Vector3()).distanceTo(this.controls.target);
    const camera = this.defaultCamera;
    const currentDistance = camera.position.distanceTo(this.controls.target);
    // Retain the current framing when hiding objects or starting a smooth fit.
    this.controls.minDistance = Math.min(this.framingDistance(smallestRadius) / 2, Math.max(currentDistance, 1e-9));
    this.controls.maxDistance = Math.max(this.framingDistance(Math.max(outerRadius, smallestRadius)) * 2, currentDistance);
    camera.near = Math.max(smallestRadius / 1000, 1e-9);
    camera.far = Math.max(this.controls.maxDistance + outerRadius * 2, camera.near * 1000);
    camera.updateProjectionMatrix();
  }

  fitVisibleSmoothly(nodes) {
    const box = new Box3();
    for (const bounds of this.visibleBounds(nodes)) box.union(bounds);
    if (box.isEmpty()) return;
    this.setCamera('[default]');
    this.state.camera = '[default]';
    const camera = this.defaultCamera;
    const radius = Math.max(box.getSize(new Vector3()).length() / 2, 0.000001);
    const distance = this.framingDistance(radius);
    const startDistance = camera.position.distanceTo(this.controls.target);
    this.controls.clearMotion();
    this.updateZoomLimits();
    this.fitAnimation = {
      start: performance.now(), duration: 650, startDistance: Math.max(startDistance, 1e-9),
      distance, from: this.controls.target.clone(), to: box.getCenter(new Vector3()),
    };
  }

  render() {
    const fade = this.orbitalFade;
    if (fade) {
      const t = Math.min(1, (performance.now() - fade.start) / fade.duration);
      const eased = t * t * (3 - 2 * t);
      for (const { node, from, to } of fade.transitions) {
        this.setOrbitalOpacity(node, from + (to - from) * eased);
      }
      if (t === 1) this.completeOrbitalFade();
    }
    const animation = this.fitAnimation;
    if (animation) {
      const t = Math.min(1, (performance.now() - animation.start) / animation.duration);
      const eased = t * t * (3 - 2 * t);
      const direction = this.defaultCamera.position.clone().sub(this.controls.target).normalize();
      const distance = Math.exp(Math.log(animation.startDistance) * (1 - eased) + Math.log(animation.distance) * eased);
      this.controls.target.lerpVectors(animation.from, animation.to, eased);
      this.defaultCamera.position.copy(this.controls.target).addScaledVector(direction, distance);
      this.defaultCamera.lookAt(this.controls.target);
      if (t === 1) {
        this.fitAnimation = null;
        this.updateZoomLimits();
      }
    }
    super.render();
  }

  closeOrbitalMenu(restoreFocus = false) {
    this.orbitalMenu?.remove();
    this.orbitalMenuGroup?.button.setAttribute('aria-expanded', 'false');
    if (restoreFocus) this.orbitalMenuGroup?.button.focus();
    this.orbitalMenu = null;
    this.orbitalMenuGroup = null;
    this.orbitalMenuItems = [];
  }

  openOrbitalMenu(group, x, y) {
    this.closeOrbitalMenu();
    this.orbitalMenuGroup = group;
    group.button.setAttribute('aria-expanded', 'true');
    const menu = this.orbitalMenu = document.createElement('div');
    menu.className = 'orbital-menu';
    const buttonRect = group.button.getBoundingClientRect();
    const scale = buttonRect.width / group.button.offsetWidth;
    menu.style.width = `${group.button.offsetWidth}px`;
    menu.style.transform = `scale(${scale})`;
    menu.style.setProperty('--button-height', `${group.button.offsetHeight}px`);
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', `${group.label} individual orbitals`);
    menu.style.setProperty('--orbital-color', getComputedStyle(group.button.parentElement).getPropertyValue('--orbital-color'));
    const title = document.createElement('div');
    title.className = 'orbital-menu-title';
    title.textContent = group.label;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close orbital menu');
    close.addEventListener('click', () => this.closeOrbitalMenu(true));
    title.append(close);
    const grid = document.createElement('div');
    grid.className = 'orbital-menu-grid';
    const orbitals = new Map();
    for (const node of group.nodes) {
      if (!orbitals.has(node.name)) orbitals.set(node.name, []);
      orbitals.get(node.name).push(node);
    }
    for (const [name, nodes] of orbitals) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'configuration-toggle';
      button.textContent = name;
      button.title = 'Press and hold to isolate and zoom in.';
      this.attachOrbitalControls(button, () => nodes, () => {
        const visible = !nodes.every(node => node.visible);
        this.setObjectsVisible(nodes, visible);
      });
      this.orbitalMenuItems.push({ button, nodes });
      grid.append(button);
    }
    menu.append(title, grid);
    document.body.append(menu);
    menu.addEventListener('contextmenu', event => event.preventDefault());
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
    this.syncConfiguration();
    this.orbitalMenuItems[0]?.button.focus();
  }

  fit(view = 'perspective') {
    this.fitAnimation = null;
    if (!this.content) return;
    this.setCamera('[default]');
    this.state.camera = '[default]';
    const box = new Box3().setFromObject(this.content);
    const center = this.modelCenter();
    const farthestCornerOffset = new Vector3(
      Math.max(Math.abs(box.min.x - center.x), Math.abs(box.max.x - center.x)),
      Math.max(Math.abs(box.min.y - center.y), Math.abs(box.max.y - center.y)),
      Math.max(Math.abs(box.min.z - center.z), Math.abs(box.max.z - center.z)),
    );
    const radius = Math.max(farthestCornerOffset.length(), 0.000001);
    const camera = this.defaultCamera;
    // The default perspective opens 4/3 larger on screen than the neutral
    // framing. Orthogonal presets retain their established full-model fit.
    const distance = this.framingDistance(radius) * (view === 'perspective' ? 0.75 : 1);
    const directions = { perspective: [0, -1, 0], front: [1, 0, 0], side: [0, 1, 0], top: [0, 0, 1] };
    this.controls.reset();
    // The default view uses Y as the viewing axis: Z remains vertical and X
    // points right on screen. Camera movement does not transform the orbital
    // geometry, so its Cartesian directions remain aligned with the axes.
    // Looking straight down Z requires Y as the top view's up direction.
    camera.up.set(0, view === 'top' ? 1 : 0, view === 'top' ? 0 : 1);
    camera.position.copy(center).addScaledVector(new Vector3(...directions[view]).normalize(), distance);
    this.controls.target.copy(center);
    this.updateZoomLimits();
    // A preset still fits the full model when every orbital is hidden.
    this.controls.minDistance = Math.min(this.controls.minDistance, distance);
    this.controls.maxDistance = Math.max(this.controls.maxDistance, distance);
    this.controls.update();
  }

}

try {
  bridge = await channel;
  const viewer = new DesktopViewer(document.getElementById('viewport'));
  window.desktopViewer = viewer;
  window.showOrbitalMenuAt = (x, y) => {
    const button = document.elementFromPoint(x, y)?.closest('.configuration-toggle');
    const group = viewer.configurationGroups?.find(group => group.button === button);
    if (group && !button.disabled && new Set(group.nodes.map(node => node.name)).size > 1) {
      viewer.openOrbitalMenu(group, x, y);
    } else if (!viewer.orbitalMenu?.contains(document.elementFromPoint(x, y))) {
      viewer.closeOrbitalMenu();
    }
  };
  window.showEmptyViewer = () => viewer.present();
  window.showMissingModelMessage = () => viewer.showMissingModelMessage();
  window.openModel = async (url, name) => {
    viewer.fitAnimation = null;
    viewer.closeOrbitalMenu();
    viewer.loadId++;
    viewer.el.classList.add('loading');
    try {
      viewer.modelMetadata = null;
      const metadataURL = new URL(url);
      const slash = metadataURL.pathname.lastIndexOf('/');
      const metadataName = decodeURIComponent(metadataURL.pathname.slice(slash + 1)).replace(/\.(glb|gltf)$/i, '.json');
      metadataURL.pathname = metadataURL.pathname.slice(0, slash + 1) + 'json/' + encodeURIComponent(metadataName);
      try {
        const response = await fetch(metadataURL);
        if (response.ok) viewer.modelMetadata = await response.json();
      } catch { /* Standalone GLB/glTF files need no metadata sidecar. */ }
      await viewer.load(url);
      await viewer.present();
      let points = 0;
      viewer.content.traverse(node => { if (node.isPoints) points += node.geometry.attributes.position.count; });
      bridge.modelLoaded(`${name}  |  ${viewer.objects.length} objects${points ? `  |  ${points.toLocaleString()} points` : ''}${viewer.loadWarnings.length ? '  |  Warning: some textures or resources could not be loaded' : ''}`);
    } catch (error) {
      viewer.render();
      viewer.el.classList.remove('loading');
      bridge.modelFailed(String(error.message || error));
    }
  };
  bridge.ready();
} catch (error) {
  if (bridge) bridge.modelFailed(`Viewer could not start: ${error.message || error}`);
  else console.error(error);
}
