// Desktop adaptation of Don McCurdy's MIT-licensed three-gltf-viewer.
import { Vector2, Vector3, Box3 } from 'three';
import { Viewer } from './viewer.js';
import { valenceSelection } from './valence.js';
import { configurationGroups } from './configuration.js';
import { BohrModel, elementCategory } from './bohr-model.js';
import { elementAtomicRadius } from './element-atomic-radii.js';

const ELEMENT_SYMBOLS = (
  'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn ' +
  'Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce ' +
  'Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn ' +
  'Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'
).split(' ');

const ATOMIC_SCALE_UNITS = Object.freeze([
  { symbol: 'Å', factor: 1, metreExponent: -10, ariaName: 'ångström' },
  { symbol: 'pm', factor: 100, metreExponent: -12, ariaName: 'picometri' },
  { symbol: 'fm', factor: 100000, metreExponent: -15, ariaName: 'femtometri' },
]);
const ATOMIC_SCALE_RIGHT_EXTENT = 160;
const ATOMIC_SCALE_PANEL_GAP = 4;

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
// Prevent Chromium's page zoom everywhere, including over panels and the
// bottom action buttons. Ordinary wheel events still control the 3D model.
document.addEventListener('wheel', event => {
  if (!event.ctrlKey) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, { capture: true, passive: false });
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, event => event.preventDefault(), { passive: false });
}
const channel = new Promise(resolve => new QWebChannel(qt.webChannelTransport, c => resolve(c.objects.desktop)));

class DesktopViewer extends Viewer {
  constructor(el) {
    super(el);
    this.loadId = 0;
    this.createInformationPopup();
    this.bohrModel = new BohrModel(
      el,
      (orbitals, focusOrbital) => this.showOnlyOrbitals(orbitals, focusOrbital),
      url => bridge.openExternal(url),
      (label, messages, trigger) => this.openInformationPopup(label, messages, trigger),
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
    const modelFileActions = document.createElement('div');
    modelFileActions.className = 'model-file-actions';
    modelFileActions.dataset.panel = 'model-file-actions';
    modelFileActions.setAttribute('role', 'group');
    modelFileActions.setAttribute('aria-label', 'Salvataggio modello');
    const addModelFileAction = (label, icon, callback) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'configuration-toggle model-file-action';
      button.setAttribute('aria-label', label);
      button.innerHTML = icon;
      button.addEventListener('click', callback);
      modelFileActions.append(button);
      return button;
    };
    addModelFileAction(
      'Scarica il modello 3D',
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M5 20h14"/></svg>',
      () => bridge.saveModel(),
    );
    addModelFileAction(
      'Salva una foto del modello',
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5h3l1.5-2h7l1.5 2h3v11H4z"/><circle cx="12" cy="14" r="3.5"/></svg>',
      () => bridge.saveSnapshot(this.captureSquareSnapshot()),
    );
    this.el.append(modelFileActions);
    this.atomicScale = document.createElement('div');
    this.atomicScale.className = 'atomic-scale';
    this.atomicScale.setAttribute('role', 'group');
    this.atomicScale.setAttribute('aria-hidden', 'true');
    const scaleRuler = document.createElement('div');
    scaleRuler.className = 'atomic-scale-ruler';
    const arrow = document.createElement('span');
    arrow.className = 'atomic-scale-arrow';
    const topTick = document.createElement('span');
    topTick.className = 'atomic-scale-tick atomic-scale-tick-top';
    const centerTick = document.createElement('span');
    centerTick.className = 'atomic-scale-tick atomic-scale-tick-center';
    const bottomTick = document.createElement('span');
    bottomTick.className = 'atomic-scale-tick atomic-scale-tick-bottom';
    scaleRuler.append(arrow, topTick, centerTick, bottomTick);
    this.atomicScaleTopValue = document.createElement('span');
    this.atomicScaleTopValue.className = 'atomic-scale-number atomic-scale-number-top';
    const zero = document.createElement('span');
    zero.className = 'atomic-scale-number atomic-scale-number-center';
    zero.textContent = '0';
    this.atomicScaleBottomValue = document.createElement('span');
    this.atomicScaleBottomValue.className = 'atomic-scale-number atomic-scale-number-bottom';
    this.atomicScaleIntermediateTicks = document.createElement('div');
    this.atomicScaleIntermediateTicks.className = 'atomic-scale-intermediate-ticks';
    const unit = document.createElement('span');
    unit.className = 'atomic-scale-unit';
    const previousUnit = document.createElement('button');
    previousUnit.type = 'button';
    previousUnit.className = 'atomic-scale-unit-button atomic-scale-unit-previous';
    previousUnit.setAttribute('aria-label', 'Unità di misura precedente');
    previousUnit.textContent = '<';
    const unitLabel = document.createElement('span');
    unitLabel.className = 'atomic-scale-unit-label';
    unitLabel.setAttribute('aria-live', 'polite');
    const unitSymbol = document.createElement('span');
    unitSymbol.className = 'atomic-scale-unit-symbol';
    const unitConversion = document.createElement('span');
    unitConversion.className = 'atomic-scale-unit-conversion';
    unitLabel.append(unitSymbol, unitConversion);
    const nextUnit = document.createElement('button');
    nextUnit.type = 'button';
    nextUnit.className = 'atomic-scale-unit-button atomic-scale-unit-next';
    nextUnit.setAttribute('aria-label', 'Unità di misura successiva');
    nextUnit.textContent = '>';
    unit.append(previousUnit, unitLabel, nextUnit);
    this.atomicScale.append(
      scaleRuler,
      this.atomicScaleIntermediateTicks,
      this.atomicScaleTopValue,
      zero,
      this.atomicScaleBottomValue,
      unit,
    );
    this.el.append(this.atomicScale);
    this.atomicScaleLayout = '';
    this.atomicScaleReference = null;
    this.atomicScaleCenter = new Vector3();
    this.atomicScaleRadius = null;
    this.atomicScaleTickStep = null;
    this.atomicScaleUnitIndex = 0;
    this.atomicScaleUnitLabel = unitLabel;
    this.atomicScaleUnitSymbol = unitSymbol;
    this.atomicScaleUnitConversion = unitConversion;
    this.updateAtomicScaleUnitLabel();
    const changeUnit = direction => (event) => {
      event.stopPropagation();
      this.changeAtomicScaleUnit(direction);
    };
    previousUnit.addEventListener('pointerdown', event => event.stopPropagation());
    nextUnit.addEventListener('pointerdown', event => event.stopPropagation());
    previousUnit.addEventListener('click', changeUnit(-1));
    nextUnit.addEventListener('click', changeUnit(1));
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
      if (event.key !== 'Escape') return;
      if (this.informationOverlay.classList.contains('is-open')) {
        this.closeInformationPopup();
      } else {
        this.closeOrbitalMenu(true);
      }
    });
    window.addEventListener('resize', () => this.closeOrbitalMenu());
    this.controls.addEventListener('start', () => { this.fitAnimation = null; });
  }

  createInformationPopup() {
    this.informationOverlay = document.createElement('div');
    this.informationOverlay.className = 'information-overlay';
    this.informationOverlay.setAttribute('aria-hidden', 'true');
    this.informationDialog = document.createElement('section');
    this.informationDialog.className = 'information-dialog';
    this.informationDialog.setAttribute('role', 'dialog');
    this.informationDialog.setAttribute('aria-modal', 'true');
    this.informationClose = document.createElement('button');
    this.informationClose.type = 'button';
    this.informationClose.className = 'information-dialog-close';
    this.informationClose.setAttribute('aria-label', 'Chiudi informazioni');
    this.informationClose.textContent = '×';
    this.informationContent = document.createElement('div');
    this.informationContent.className = 'information-dialog-content';
    this.informationDialog.append(this.informationClose, this.informationContent);
    this.informationOverlay.append(this.informationDialog);
    this.el.append(this.informationOverlay);
    this.informationClose.addEventListener('click', () => this.closeInformationPopup());
    this.informationOverlay.addEventListener('click', (event) => {
      if (event.target === this.informationOverlay) this.closeInformationPopup();
    });
  }

  openInformationPopup(label, messages, trigger) {
    this.informationReturnFocus = trigger;
    this.informationDialog.setAttribute('aria-label', label);
    this.informationContent.replaceChildren(...messages.map((message) => {
      const paragraph = document.createElement('p');
      paragraph.textContent = message;
      return paragraph;
    }));
    this.informationOverlay.classList.add('is-open');
    this.informationOverlay.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => this.informationClose.focus());
  }

  closeInformationPopup() {
    if (!this.informationOverlay.classList.contains('is-open')) return;
    this.informationOverlay.classList.remove('is-open');
    this.informationOverlay.setAttribute('aria-hidden', 'true');
    this.informationReturnFocus?.focus();
    this.informationReturnFocus = null;
  }

  updateDisplay() {
    super.updateDisplay();
    this.el.classList.toggle('has-model', Boolean(this.content));
    for (const { button, property, offLabel, onLabel } of this.displayButtons || []) {
      button.setAttribute('aria-pressed', String(this.state[property]));
      button.textContent = this.state[property] ? onLabel : offLabel;
    }
  }

  captureSquareSnapshot() {
    // Capture immediately after a render so the WebGL buffer contains exactly
    // the current camera view. Drawing only the renderer canvas excludes every
    // HTML control and panel from the exported image.
    this.render();
    const source = this.renderer.domElement;
    const side = Math.min(source.width, source.height);
    const snapshot = document.createElement('canvas');
    snapshot.width = side;
    snapshot.height = side;
    const context = snapshot.getContext('2d');
    context.drawImage(
      source,
      Math.floor((source.width - side) / 2),
      Math.floor((source.height - side) / 2),
      side,
      side,
      0,
      0,
      side,
      side,
    );
    return snapshot.toDataURL('image/png');
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
    let centeredTop = 10;
    const setStableCustomProperty = (element, property, value, epsilon, unit = '') => {
      const current = Number.parseFloat(element.style.getPropertyValue(property));
      if (Number.isFinite(current) && Math.abs(current - value) <= epsilon) return false;
      element.style.setProperty(property, `${value}${unit}`);
      return true;
    };

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
      let leftHeight = leftPanel.offsetHeight;
      const elementSymbol = leftPanel.querySelector('.element-identity-symbol');
      if (elementSymbol) {
        const symbolStyle = getComputedStyle(elementSymbol);
        const currentFontSize = Number.parseFloat(symbolStyle.fontSize);
        const currentLineHeight = Number.parseFloat(symbolStyle.lineHeight);
        if (!this.elementSymbolBaseFontSize && currentFontSize > 0) {
          this.elementSymbolBaseFontSize = currentFontSize;
        }
        const baseFontSize = this.elementSymbolBaseFontSize || currentFontSize;
        if (baseFontSize > 0 && currentFontSize > 0 && currentLineHeight > 0) {
          const lineHeightRatio = currentLineHeight / currentFontSize;
          const heightWithoutSymbol = leftHeight - currentLineHeight;
          const availableSymbolHeight = Math.max(0, availableHeight - heightWithoutSymbol);
          const targetFontSize = Math.max(1,
            Math.min(baseFontSize, availableSymbolHeight / lineHeightRatio));
          if (setStableCustomProperty(
            leftPanel,
            '--element-symbol-font-size',
            targetFontSize,
            0.25,
            'px',
          )) {
            leftHeight = leftPanel.offsetHeight;
          }
        }
      }
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
        const buttonHeight = Math.max(minimumButtonHeight,
          baseButtonHeight + (leftHeight - baseRightHeight) / orbitalRows);
        // ResizeObserver reports integer-rounded layout sizes. Rewriting a
        // sub-pixel correction on every callback can alternate forever between
        // two values and continuously invalidate the composited panel layers.
        // A quarter-pixel dead band makes this calculation converge after the
        // first real layout change while remaining visually exact.
        if (setStableCustomProperty(rightPanel, '--orbital-button-height', buttonHeight, 0.25, 'px')) {
          rightHeight = Math.max(1, this.gui.domElement.offsetHeight);
        }
      }

      const commonHeight = Math.max(leftHeight, rightHeight);
      scale = Math.min(1, availableHeight / commonHeight);
      centeredTop = Math.max(0, (this.el.clientHeight - commonHeight * scale) / 2);
      setStableCustomProperty(leftPanel, '--panel-scale', scale, 0.001);
      setStableCustomProperty(leftPanel, '--panel-top', centeredTop, 0.25, 'px');
    }
    setStableCustomProperty(rightPanel, '--panel-scale', scale, 0.001);
    setStableCustomProperty(rightPanel, '--panel-top', centeredTop, 0.25, 'px');
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
    this.atomicScaleReference = null;
    this.atomicScaleCenter.copy(this.modelCenter());
    this.prepareOrbitalMaterials();
    const valence = valenceSelection(this.objects);
    this.valenceObjects = valence.objects;
    this.bohrModel.update(this.modelMetadata);
    this.updateAtomicScaleValue();
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
    const actionsRow = document.createElement('div');
    actionsRow.className = 'configuration-actions-row';
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
    const informationButton = document.createElement('button');
    informationButton.type = 'button';
    informationButton.className = 'panel-info-button configuration-info-button';
    informationButton.setAttribute('aria-label', 'Informazioni sui controlli della configurazione elettronica');
    informationButton.textContent = '?';
    informationButton.addEventListener('click', () => this.openInformationPopup(
      'Informazioni sulla configurazione elettronica',
      [
        'Clicca sui riquadri per visualizzare\no nascondere i set di orbitali occupati',
        'Click destro sui riquadri per\nscegliere i singoli orbitali',
        'Tieni premuto su un riquadro per\nisolare gli orbitali',
      ],
      informationButton,
    ));
    actionsRow.append(actions, informationButton);
    row.append(actionsRow);
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
      this.attachOrbitalControls(button, () => group.nodes, () => {
        const visible = !group.nodes.every(node => node.visible);
        this.setObjectsVisible(group.nodes, visible);
      });
      if (new Set(group.nodes.map(node => node.name)).size > 1) {
        button.setAttribute('aria-haspopup', 'dialog');
        button.setAttribute('aria-expanded', 'false');
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
    this.atomicScaleReference = null;
    this.hideAtomicScale();
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

  atomicScaleUnit() {
    return ATOMIC_SCALE_UNITS[this.atomicScaleUnitIndex];
  }

  updateAtomicScaleUnitLabel() {
    const unit = this.atomicScaleUnit();
    this.atomicScaleUnitSymbol.textContent = unit.symbol;
    this.atomicScaleUnitConversion.textContent = `(1e${unit.metreExponent} m)`;
  }

  changeAtomicScaleUnit(direction) {
    const previousStep = this.atomicScaleTickStep ?? 0.25;
    this.atomicScaleUnitIndex = (
      this.atomicScaleUnitIndex + direction + ATOMIC_SCALE_UNITS.length
    ) % ATOMIC_SCALE_UNITS.length;
    this.updateAtomicScaleUnitLabel();
    this.updateAtomicScaleValue(previousStep);
    for (const animation of this.atomicScaleUnitLabel.getAnimations?.() ?? []) animation.cancel();
    this.atomicScaleUnitLabel.animate?.([
      { opacity: 0, transform: `translateX(${direction * 18}px)` },
      { opacity: 1, transform: 'translateX(0)' },
    ], {
      duration: 220,
      easing: 'cubic-bezier(.2,.8,.2,1)',
    });
  }

  formatAtomicScaleMagnitude(valueInAngstroms) {
    const converted = Math.abs(valueInAngstroms) * this.atomicScaleUnit().factor;
    if (!converted) return '0';
    const exponent = Math.floor(Math.log10(converted));
    if (exponent > 3 || exponent < -3) {
      const coefficient = converted / (10 ** exponent);
      const coefficientText = coefficient.toLocaleString('it-IT', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
        useGrouping: false,
      });
      return `${coefficientText}e${exponent}`;
    }
    return converted.toLocaleString('it-IT', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
      useGrouping: false,
    });
  }

  updateAtomicScaleValue(initialStep = 0.25) {
    const symbol = this.modelMetadata?.element;
    const radius = elementAtomicRadius(symbol);
    this.atomicScaleRadius = radius;
    this.atomicScaleTickStep = null;
    if (radius === null) {
      this.atomicScaleIntermediateTicks.replaceChildren();
      this.atomicScaleTopValue.textContent = '—';
      this.atomicScaleBottomValue.textContent = '—';
      this.atomicScale.setAttribute('aria-label', `Raggio covalente a legame singolo di ${symbol || 'questo elemento'} non disponibile`);
      return;
    }
    const halfRadius = radius / 2;
    const halfValue = this.formatAtomicScaleMagnitude(halfRadius);
    this.atomicScaleTopValue.textContent = `+${halfValue}`;
    this.atomicScaleBottomValue.textContent = `−${halfValue}`;
    this.renderAtomicScaleTicks(initialStep);
    this.atomicScale.setAttribute('aria-label', `Scala del raggio covalente a legame singolo di ${symbol}: da meno ${halfValue} a più ${halfValue} ${this.atomicScaleUnit().ariaName}`);
  }

  renderAtomicScaleTicks(step) {
    const radius = this.atomicScaleRadius;
    if (!(radius > 0) || this.atomicScaleTickStep === step) return;
    this.atomicScaleTickStep = step;
    this.atomicScaleIntermediateTicks.replaceChildren();
    const halfRadius = radius / 2;
    // Once a finer level is active, the reference ticks of the previous level
    // are already outside (or crossing) the viewport. Do not create thousands
    // of farther, invisible DOM labels at the 0.005 and 0.001 Å levels.
    const previousStep = new Map([
      [0.05, 0.25],
      [0.01, 0.05],
      [0.005, 0.01],
      [0.001, 0.005],
    ]).get(step);
    const visibleLimit = previousStep ?? halfRadius;
    const addIntermediateTick = (value) => {
      const position = (halfRadius - value) / radius * 100;
      const tick = document.createElement('span');
      tick.className = 'atomic-scale-intermediate-tick';
      tick.style.top = `${position}%`;
      this.atomicScaleIntermediateTicks.append(tick);
      const label = document.createElement('span');
      label.className = 'atomic-scale-intermediate-label';
      label.style.top = `${position}%`;
      const magnitude = this.formatAtomicScaleMagnitude(value);
      label.textContent = value > 0 ? `+${magnitude}` : `−${magnitude}`;
      this.atomicScaleIntermediateTicks.append(label);
    };
    for (let index = 1; index * step < halfRadius - 1e-9
      && index * step <= visibleLimit + 1e-9; index += 1) {
      const value = Math.round(index * step * 1000) / 1000;
      addIntermediateTick(value);
      addIntermediateTick(-value);
    }
  }

  hideAtomicScale() {
    this.atomicScale?.classList.remove('is-visible');
    this.atomicScale?.setAttribute('aria-hidden', 'true');
    this.atomicScaleLayout = '';
  }

  updateAtomicScale() {
    if (!this.content || !this.objects?.length || !this.atomicScale) {
      this.hideAtomicScale();
      return;
    }
    const camera = this.activeCamera;
    camera.updateMatrixWorld();
    this.content.updateWorldMatrix(true, true);
    const point = new Vector3();
    const visibleNodes = [];
    let totalPoints = 0;
    for (const node of this.objects) {
      let visible = true;
      for (let parent = node; parent; parent = parent.parent) visible &&= parent.visible;
      if (!visible || !node.geometry) continue;
      const positions = node.geometry.attributes.position;
      if (!positions?.count) continue;
      visibleNodes.push({ node, positions });
      totalPoints += positions.count;
    }
    if (!visibleNodes.length) {
      this.hideAtomicScale();
      return;
    }
    if (!this.atomicScaleReference) {
      let top = Infinity;
      let bottom = -Infinity;
      // Measure the rendered cloud once. Subsequent frames derive the ruler
      // height only from camera distance, so orbiting the camera cannot resize
      // it while wheel zoom remains visually synchronized.
      const projectionBudget = 12000;
      for (const { node, positions } of visibleNodes) {
        const sampleCount = Math.max(128, Math.round(projectionBudget * positions.count / totalPoints));
        const step = Math.max(1, Math.ceil(positions.count / sampleCount));
        for (let index = 0; index < positions.count; index += step) {
          point.fromBufferAttribute(positions, index).applyMatrix4(node.matrixWorld).project(camera);
          const screenY = (1 - point.y) * this.el.clientHeight / 2;
          top = Math.min(top, screenY);
          bottom = Math.max(bottom, screenY);
        }
        const last = positions.count - 1;
        if (last % step) {
          point.fromBufferAttribute(positions, last).applyMatrix4(node.matrixWorld).project(camera);
          const screenY = (1 - point.y) * this.el.clientHeight / 2;
          top = Math.min(top, screenY);
          bottom = Math.max(bottom, screenY);
        }
      }
      const distance = camera.position.distanceTo(this.controls.target);
      if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= top || !(distance > 0)) {
        this.hideAtomicScale();
        return;
      }
      point.copy(this.atomicScaleCenter).project(camera);
      const projectedCenter = (1 - point.y) * this.el.clientHeight / 2;
      this.atomicScaleReference = {
        centerYRatio: projectedCenter / this.el.clientHeight,
        distance,
        height: 2 * Math.max(projectedCenter - top, bottom - projectedCenter),
        viewportHeight: this.el.clientHeight,
      };
    }
    const currentDistance = camera.position.distanceTo(this.controls.target);
    if (!(currentDistance > 0)) {
      this.hideAtomicScale();
      return;
    }
    const scaleHeight = this.atomicScaleReference.height
      * this.atomicScaleReference.distance / currentDistance
      * this.el.clientHeight / this.atomicScaleReference.viewportHeight;
    // Keep the zero tick at the original model center. Zoom changes only the
    // distance between ticks, never this vertical anchor.
    const centerY = this.atomicScaleReference.centerYRatio * this.el.clientHeight;
    if (this.atomicScaleRadius > 0) {
      const tickPairVisibility = (step) => {
        const offset = scaleHeight * step / this.atomicScaleRadius;
        const positiveY = centerY - offset;
        const negativeY = centerY + offset;
        return {
          bothOutside: positiveY < 0 && negativeY > this.el.clientHeight,
          bothVisible: positiveY >= 0 && negativeY <= this.el.clientHeight,
        };
      };
      const quarterTicks = tickPairVisibility(0.25);
      const fiveHundredthTicks = tickPairVisibility(0.05);
      const oneHundredthTicks = tickPairVisibility(0.01);
      const fiveThousandthTicks = tickPairVisibility(0.005);
      // Change level only after both reference ticks cross the viewport edge.
      // In each asymmetric transition zone keep the current step so it cannot
      // oscillate while the model is being zoomed.
      if (this.atomicScaleTickStep === 0.25 && quarterTicks.bothOutside) {
        this.renderAtomicScaleTicks(0.05);
      } else if (this.atomicScaleTickStep === 0.05 && fiveHundredthTicks.bothOutside) {
        this.renderAtomicScaleTicks(0.01);
      } else if (this.atomicScaleTickStep === 0.05 && quarterTicks.bothVisible) {
        this.renderAtomicScaleTicks(0.25);
      } else if (this.atomicScaleTickStep === 0.01 && oneHundredthTicks.bothOutside) {
        this.renderAtomicScaleTicks(0.005);
      } else if (this.atomicScaleTickStep === 0.01 && fiveHundredthTicks.bothVisible) {
        this.renderAtomicScaleTicks(0.05);
      } else if (this.atomicScaleTickStep === 0.005 && fiveThousandthTicks.bothOutside) {
        this.renderAtomicScaleTicks(0.001);
      } else if (this.atomicScaleTickStep === 0.005 && oneHundredthTicks.bothVisible) {
        this.renderAtomicScaleTicks(0.01);
      } else if (this.atomicScaleTickStep === 0.001 && fiveThousandthTicks.bothVisible) {
        this.renderAtomicScaleTicks(0.005);
      }
    }
    const top = centerY - scaleHeight / 2;
    const bottom = centerY + scaleHeight / 2;
    const panelRect = this.gui.domElement.parentElement.getBoundingClientRect();
    // Keep one fixed horizontal position sized for the widest femtometre label
    // and the 18 px unit-change animation, plus a small panel margin.
    const left = Math.max(
      0,
      panelRect.left - ATOMIC_SCALE_RIGHT_EXTENT - ATOMIC_SCALE_PANEL_GAP,
    );
    const rounded = [left, top, bottom - top].map(value => Math.round(value * 10) / 10);
    const layout = rounded.join('|');
    if (layout !== this.atomicScaleLayout) {
      this.atomicScale.style.left = `${rounded[0]}px`;
      this.atomicScale.style.top = `${rounded[1]}px`;
      this.atomicScale.style.height = `${rounded[2]}px`;
      this.atomicScaleLayout = layout;
    }
    this.atomicScale.classList.add('is-visible');
    this.atomicScale.setAttribute('aria-hidden', 'false');
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
    this.updateAtomicScale();
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
    // The default perspective opens 10% larger than its previous 4/3 framing.
    // Orthogonal presets retain their established full-model fit.
    const distance = this.framingDistance(radius) * (view === 'perspective' ? 0.75 / 1.1 : 1);
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
