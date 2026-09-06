const TAU = Math.PI * 2;
import { elementAtomicNumber, elementNameIt } from './element-names-it.js';
import { elementAtomicMass } from './element-atomic-masses.js';
import { isotopicAbundancePercent, naturalIsotopes } from './element-natural-isotopes.js';

const NIST_ISOTOPE_SOURCE = 'https://physics.nist.gov/cgi-bin/Compositions/stand_alone.pl?isotype=all';
const ACTIVE_ELECTRON_GLOW_RADIUS = 32 / 3;
const BOHR_MAX_RADIUS = 142;

const SHELL_LABELS = ['K', 'L', 'M', 'N', 'O', 'P', 'Q'];
// This ray is reserved for shell labels. Electron angles are placed halfway
// between divisions measured from it, so no electron can lie on the ray.
const SHELL_LABEL_ANGLE = -3 * Math.PI / 4;
const ORBITAL_COLORS = {
  s: '#dc2626',
  p: '#facc15',
  d: '#06b6d4',
  f: '#22c55e',
};

const ELEMENT_CATEGORIES = [
  ['metalli alcalini', '#ff6b35', new Set(['Li', 'Na', 'K', 'Rb', 'Cs', 'Fr'])],
  ['metalli alcalino-terrosi', '#ffa94d', new Set(['Be', 'Mg', 'Ca', 'Sr', 'Ba', 'Ra'])],
  ['metalli di transizione', '#339af0', new Set([
    'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn',
    'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd',
    'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg',
    'Rf', 'Db', 'Sg', 'Bh', 'Hs', 'Mt', 'Ds', 'Rg', 'Cn',
  ])],
  ['metalli di post-transizione', '#74c0fc', new Set([
    'Al', 'Ga', 'In', 'Sn', 'Tl', 'Pb', 'Bi', 'Po', 'Nh', 'Fl', 'Mc', 'Lv',
  ])],
  ['metalloidi', '#51cf66', new Set(['B', 'Si', 'Ge', 'As', 'Sb', 'Te'])],
  ['non metalli', '#ffd43b', new Set(['H', 'C', 'N', 'O', 'P', 'S', 'Se'])],
  ['alogeni', '#e76f51', new Set(['F', 'Cl', 'Br', 'I', 'At', 'Ts'])],
  ['gas nobili', '#be4bdb', new Set(['He', 'Ne', 'Ar', 'Kr', 'Xe', 'Rn', 'Og'])],
  ['lantanidi', '#f06595', new Set(['La', 'Ce', 'Pr', 'Nd', 'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu'])],
  ['attinidi', '#d6336c', new Set(['Ac', 'Th', 'Pa', 'U', 'Np', 'Pu', 'Am', 'Cm', 'Bk', 'Cf', 'Es', 'Fm', 'Md', 'No', 'Lr'])],
];

const ELEMENT_CATEGORY_SINGULAR = Object.freeze({
  'metalli alcalini': 'metallo alcalino',
  'metalli alcalino-terrosi': 'metallo alcalino-terroso',
  'metalli di transizione': 'metallo di transizione',
  'metalli di post-transizione': 'metallo di post-transizione',
  metalloidi: 'metalloide',
  'non metalli': 'non metallo',
  alogeni: 'alogeno',
  'gas nobili': 'gas nobile',
  lantanidi: 'lantanide',
  attinidi: 'attinide',
});

export function elementCategory(symbol) {
  const match = ELEMENT_CATEGORIES.find(([, , elements]) => elements.has(symbol));
  return match
    ? { name: match[0], singular: ELEMENT_CATEGORY_SINGULAR[match[0]], color: match[1] }
    : { name: 'elemento', singular: 'elemento', color: '#d96b28' };
}

export function shellPopulations(metadata) {
  return shellElectronAssignments(metadata).map(([n, electrons]) => [n, electrons.length]);
}

export function electronConfiguration(metadata) {
  const subshells = new Map();
  for (const orbital of Array.isArray(metadata?.orbitals) ? metadata.orbitals : []) {
    const match = /^(\d+)([spdf])/i.exec(String(orbital?.label || ''));
    const electrons = Number(orbital?.electrons);
    if (!match || !Number.isInteger(electrons) || electrons <= 0) continue;
    const label = `${match[1]}${match[2].toLowerCase()}`;
    subshells.set(label, (subshells.get(label) || 0) + electrons);
  }
  return [...subshells].map(([label, electrons]) => ({ label, electrons }));
}

export function shellElectronAssignments(metadata) {
  const shells = new Map();
  for (const orbital of Array.isArray(metadata?.orbitals) ? metadata.orbitals : []) {
    const n = Number(orbital?.n);
    const electrons = Number(orbital?.electrons);
    const label = String(orbital?.label || '');
    const type = /^\d+([spdf])/i.exec(label)?.[1].toLowerCase();
    if (Number.isInteger(n) && n > 0 && Number.isInteger(electrons) && electrons > 0 && type) {
      if (!shells.has(n)) shells.set(n, []);
      for (let index = 0; index < electrons; index++) {
        shells.get(n).push({
          key: `${label}:${index}`,
          orbital: label,
          color: ORBITAL_COLORS[type],
        });
      }
    }
  }
  return [...shells].sort((a, b) => a[0] - b[0]);
}

export class BohrModel {
  constructor(container, onChangeSelection = null, openExternal = null) {
    this.onChangeSelection = onChangeSelection;
    this.openExternal = openExternal;
    this.activeElectronKeys = new Set();
    this.electronHitAreas = [];
    this.nucleusHitArea = null;
    this.nucleusClickScale = 1;
    this.nucleusClickFrame = 0;
    this.nucleusHoverScale = 1;
    this.nucleusHoverFrame = 0;
    this.nucleusHovered = false;

    this.panelGroup = document.createElement('div');
    this.panelGroup.className = 'left-panel-group';

    this.identity = document.createElement('section');
    this.identity.className = 'element-identity-card';
    this.identity.setAttribute('aria-label', 'Elemento visualizzato');
    this.identitySymbol = document.createElement('div');
    this.identitySymbol.className = 'element-identity-symbol';
    this.identityName = document.createElement('div');
    this.identityName.className = 'element-identity-name';
    this.identityNameText = document.createElement('span');
    this.identityNameText.className = 'element-identity-name-text';
    this.identityAtomicNumber = document.createElement('span');
    this.identityAtomicNumber.className = 'element-identity-atomic-number';
    this.identityName.append(this.identityNameText, this.identityAtomicNumber);
    this.identity.append(this.identitySymbol, this.identityName);

    this.typeCard = document.createElement('section');
    this.typeCard.className = 'element-type-card';
    this.typeCard.setAttribute('aria-label', 'Tipologia dell’elemento');
    this.typeLabel = document.createElement('div');
    this.typeLabel.className = 'element-type-label';
    this.typeLabel.textContent = 'TIPOLOGIA';
    this.typeValue = document.createElement('div');
    this.typeValue.className = 'element-type-value';
    this.massLabel = document.createElement('div');
    this.massLabel.className = 'element-type-label element-mass-label';
    this.massLabel.textContent = 'MASSA ATOMICA';
    this.massValue = document.createElement('div');
    this.massValue.className = 'element-type-value element-mass-value';
    this.configurationLabel = document.createElement('div');
    this.configurationLabel.className = 'element-type-label element-configuration-label';
    this.configurationLabel.textContent = 'CONFIGURAZIONE ELETTRONICA';
    this.configurationValue = document.createElement('div');
    this.configurationValue.className = 'element-type-value element-configuration-value';
    this.typeDetailsPage = document.createElement('div');
    this.typeDetailsPage.className = 'element-type-page element-type-details-page is-current';
    this.typeDetailsPage.setAttribute('aria-hidden', 'false');
    this.typeDetailsPage.append(
      this.typeLabel,
      this.typeValue,
      this.massLabel,
      this.massValue,
      this.configurationLabel,
      this.configurationValue,
    );
    this.isotopePage = document.createElement('div');
    this.isotopePage.className = 'element-type-page element-isotope-page';
    this.isotopePage.setAttribute('aria-hidden', 'true');
    this.isotopeLabel = document.createElement('div');
    this.isotopeLabel.className = 'element-type-label';
    this.isotopeLabel.textContent = 'COMPOSIZIONE ISOTOPICA';
    this.isotopeList = document.createElement('div');
    this.isotopeList.className = 'element-isotope-list';
    this.isotopeGrid = document.createElement('div');
    this.isotopeGrid.className = 'element-isotope-grid';
    this.isotopeSource = document.createElement('p');
    this.isotopeSource.className = 'element-isotope-source';
    this.isotopeSource.append('Fonte: ');
    this.isotopeSourceLink = document.createElement('a');
    this.isotopeSourceLink.href = NIST_ISOTOPE_SOURCE;
    this.isotopeSourceLink.textContent = NIST_ISOTOPE_SOURCE;
    this.isotopeSourceLink.target = '_blank';
    this.isotopeSourceLink.rel = 'noopener noreferrer';
    this.isotopeSourceLink.addEventListener('click', event => {
      if (!this.openExternal) return;
      event.preventDefault();
      this.openExternal(NIST_ISOTOPE_SOURCE);
    });
    this.isotopeSource.append(this.isotopeSourceLink);
    this.isotopeList.append(this.isotopeGrid, this.isotopeSource);
    this.isotopePage.append(this.isotopeLabel, this.isotopeList);
    this.typePages = [this.typeDetailsPage, this.isotopePage];
    this.typePageIndex = 0;
    this.typePageAnimating = false;
    this.typePagesContainer = document.createElement('div');
    this.typePagesContainer.className = 'element-type-pages';
    this.typePagesContainer.append(...this.typePages);
    this.typeViewport = document.createElement('div');
    this.typeViewport.className = 'element-type-viewport';
    this.typeViewport.append(this.typePagesContainer);
    this.typeNextButton = document.createElement('button');
    this.typeNextButton.type = 'button';
    this.typeNextButton.className = 'element-type-next';
    this.typeNextButton.dataset.direction = 'forward';
    this.typeNextButton.title = 'Mostra composizione isotopica';
    this.typeNextButton.setAttribute('aria-label', 'Mostra composizione isotopica');
    this.typeNextButton.addEventListener('click', () => this.advanceTypePage());
    this.typeCard.append(this.typeViewport, this.typeNextButton);

    this.drawer = document.createElement('aside');
    this.drawer.className = 'bohr-drawer open';
    this.drawer.setAttribute('aria-label', 'Modello atomico di Bohr');

    this.title = document.createElement('div');
    this.title.className = 'bohr-title';
    this.title.textContent = 'Modello a orbite di Bohr';

    this.content = document.createElement('div');
    this.content.className = 'bohr-content';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'bohr-canvas';
    this.canvas.setAttribute('role', 'img');
    this.canvas.addEventListener('pointermove', event => {
      const overNucleus = this.nucleusAt(event);
      this.canvas.style.cursor = this.electronAt(event) || overNucleus ? 'pointer' : 'default';
      this.setNucleusHovered(overNucleus);
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.canvas.style.cursor = 'default';
      this.setNucleusHovered(false);
    });
    this.canvas.addEventListener('click', event => {
      if (this.nucleusAt(event)) {
        this.animateNucleusClick();
        this.advanceTypePage();
        return;
      }
      const electron = this.electronAt(event);
      if (!electron) return;
      const wasActive = this.activeElectronKeys.has(electron.key);
      if (wasActive) this.activeElectronKeys.delete(electron.key);
      else this.activeElectronKeys.add(electron.key);
      const orbitals = [...new Set(this.electronHitAreas
        .filter(area => this.activeElectronKeys.has(area.key))
        .map(area => area.orbital))];
      const focusOrbital = wasActive ? null : electron.orbital;
      if (this.onChangeSelection?.(orbitals, focusOrbital) === false) {
        if (wasActive) this.activeElectronKeys.add(electron.key);
        else this.activeElectronKeys.delete(electron.key);
        return;
      }
      const activeCount = this.activeElectronKeys.size;
      this.canvas.setAttribute('aria-label', activeCount
        ? `${this.canvas.dataset.description}. ${activeCount} elettroni attivi`
        : this.canvas.dataset.description);
      this.draw();
    });
    this.content.append(this.canvas);

    this.hint = document.createElement('p');
    this.hint.className = 'bohr-hint';
    this.hint.textContent = 'Clicca gli elettroni per visualizzare\no nascondere gli orbitali corrispondenti';

    this.nucleusHint = document.createElement('p');
    this.nucleusHint.className = 'bohr-hint bohr-hint-secondary';
    this.nucleusHint.textContent = 'Clicca il nucleo per visualizzare\nla composizione isotopica';

    this.hints = document.createElement('div');
    this.hints.className = 'bohr-hints';
    this.hints.append(this.hint, this.nucleusHint);

    this.drawer.append(this.title, this.content, this.hints);
    this.panelGroup.append(this.identity, this.typeCard, this.drawer);
    container.append(this.panelGroup);
    this.metadata = null;
  }

  update(metadata) {
    this.metadata = metadata;
    this.activeElectronKeys.clear();
    const shells = shellPopulations(metadata);
    const symbol = metadata?.element || '?';
    const italianName = elementNameIt(symbol);
    const metadataAtomicNumber = Number(metadata?.atomic_number);
    const atomicNumber = Number.isInteger(metadataAtomicNumber) && metadataAtomicNumber > 0
      ? metadataAtomicNumber
      : elementAtomicNumber(symbol);
    this.identitySymbol.textContent = symbol;
    this.identityNameText.textContent = italianName;
    this.identityAtomicNumber.textContent = atomicNumber === null ? '' : ` (Z=${atomicNumber})`;
    this.identity.setAttribute('aria-label', `${symbol}, ${italianName}${atomicNumber === null ? '' : `, numero atomico ${atomicNumber}`}`);
    this.populateNaturalIsotopes(symbol, atomicNumber);
    const category = elementCategory(symbol);
    this.typeValue.textContent = category.singular;
    const atomicMass = elementAtomicMass(symbol);
    this.massValue.textContent = atomicMass ? `${atomicMass} Da` : '—';
    const configuration = electronConfiguration(metadata);
    this.configurationValue.replaceChildren();
    if (configuration.length) {
      for (const { label, electrons } of configuration) {
        const term = document.createElement('span');
        term.className = 'element-configuration-term';
        term.append(label);
        const exponent = document.createElement('sup');
        exponent.textContent = String(electrons);
        term.append(exponent);
        this.configurationValue.append(term);
      }
    } else {
      this.configurationValue.textContent = '—';
    }
    const configurationText = configuration.map(({ label, electrons }) => `${label}${electrons}`).join(' ');
    this.typeCard.setAttribute('aria-label', `Tipologia: ${category.singular}. Massa atomica: ${atomicMass || 'non disponibile'}. Configurazione elettronica: ${configurationText || 'non disponibile'}`);
    const count = shells.reduce((sum, [, electrons]) => sum + electrons, 0);
    const description = `Modello di Bohr di ${symbol}, ${category.name}: ${count} elettroni in ${shells.length} livelli`;
    this.canvas.dataset.description = description;
    this.canvas.setAttribute('aria-label', description);
    this.draw();
  }

  populateNaturalIsotopes(symbol, atomicNumber) {
    this.isotopeGrid.replaceChildren();
    const isotopes = naturalIsotopes(symbol);
    if (!isotopes.length || atomicNumber === null) {
      const empty = document.createElement('div');
      empty.className = 'element-isotope-empty';
      empty.textContent = 'Nessuna abbondanza naturale riportata dal NIST.';
      this.isotopeGrid.append(empty);
      this.isotopePage.setAttribute('aria-label', `${symbol}: nessuna abbondanza naturale riportata dal NIST`);
      return;
    }

    const descriptions = [];
    for (const [massNumber, abundance] of isotopes) {
      const neutronCount = massNumber - atomicNumber;
      const percentage = isotopicAbundancePercent(abundance);
      const row = document.createElement('div');
      row.className = 'element-isotope-row';
      const isotope = document.createElement('span');
      isotope.className = 'element-isotope-symbol';
      isotope.textContent = `${symbol}-${massNumber}`;
      const composition = document.createElement('span');
      composition.className = 'element-isotope-nucleus';
      const protons = document.createElement('span');
      protons.append(`${atomicNumber}p`);
      const protonCharge = document.createElement('sup');
      protonCharge.textContent = '+';
      protons.append(protonCharge);
      const neutrons = document.createElement('span');
      neutrons.append(`${neutronCount}n`);
      const neutronCharge = document.createElement('sup');
      neutronCharge.textContent = '0';
      neutrons.append(neutronCharge);
      composition.append(protons, document.createTextNode(' '), neutrons);
      const naturalAbundance = document.createElement('span');
      naturalAbundance.className = 'element-isotope-abundance';
      naturalAbundance.textContent = percentage;
      row.append(isotope, naturalAbundance, composition);
      this.isotopeGrid.append(row);
      descriptions.push(`${symbol}-${massNumber}: ${percentage}, ${atomicNumber} protoni e ${neutronCount} neutroni`);
    }
    this.isotopePage.setAttribute('aria-label', descriptions.join('. '));
    this.isotopeList.scrollTop = 0;
  }

  async advanceTypePage() {
    if (this.typePageAnimating) return;
    this.typePageAnimating = true;
    this.typeNextButton.disabled = true;
    const current = this.typePages[this.typePageIndex];
    const nextIndex = (this.typePageIndex + 1) % this.typePages.length;
    const next = this.typePages[nextIndex];
    const forward = this.typePageIndex === 0;
    const outgoingPosition = forward ? '-100%' : '100%';
    const incomingPosition = forward ? '100%' : '-100%';
    next.classList.add('is-entering');
    next.setAttribute('aria-hidden', 'false');
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 360;
    const timing = { duration, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' };
    try {
      await Promise.all([
        current.animate(
          [{ transform: 'translateX(0)' }, { transform: `translateX(${outgoingPosition})` }], timing,
        ).finished,
        next.animate(
          [{ transform: `translateX(${incomingPosition})` }, { transform: 'translateX(0)' }], timing,
        ).finished,
      ]);
    } finally {
      current.classList.remove('is-current');
      current.setAttribute('aria-hidden', 'true');
      next.classList.remove('is-entering');
      next.classList.add('is-current');
      next.getAnimations().forEach(animation => animation.cancel());
      current.getAnimations().forEach(animation => animation.cancel());
      this.typePageIndex = nextIndex;
      const label = nextIndex === 0
        ? 'Mostra composizione isotopica'
        : 'Torna alle caratteristiche dell’elemento';
      this.typeNextButton.dataset.direction = nextIndex === 0 ? 'forward' : 'back';
      this.typeNextButton.title = label;
      this.typeNextButton.setAttribute('aria-label', label);
      this.typeNextButton.disabled = false;
      this.typePageAnimating = false;
    }
  }

  setActiveOrbitals(orbitals) {
    const visibleOrbitals = orbitals instanceof Set ? orbitals : new Set(orbitals);
    this.activeElectronKeys.clear();
    for (const [, electrons] of shellElectronAssignments(this.metadata)) {
      for (const electron of electrons) {
        if (visibleOrbitals.has(electron.orbital)) this.activeElectronKeys.add(electron.key);
      }
    }
    const activeCount = this.activeElectronKeys.size;
    const description = this.canvas.dataset.description || 'Modello di Bohr';
    this.canvas.setAttribute('aria-label', activeCount
      ? `${description}. ${activeCount} elettroni attivi`
      : description);
    this.draw();
  }

  electronAt(event) {
    const bounds = this.canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    const x = (event.clientX - bounds.left) * (this.content.clientWidth || 300) / bounds.width;
    const y = (event.clientY - bounds.top) * (this.content.clientHeight || 300) / bounds.height;
    for (let index = this.electronHitAreas.length - 1; index >= 0; index--) {
      const area = this.electronHitAreas[index];
      if (Math.hypot(x - area.x, y - area.y) <= area.hitRadius) return area;
    }
    return null;
  }

  nucleusAt(event) {
    if (!this.nucleusHitArea) return false;
    const bounds = this.canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return false;
    const x = (event.clientX - bounds.left) * (this.content.clientWidth || 300) / bounds.width;
    const y = (event.clientY - bounds.top) * (this.content.clientHeight || 300) / bounds.height;
    const { x: centerX, y: centerY, radius } = this.nucleusHitArea;
    return Math.hypot(x - centerX, y - centerY) <= radius;
  }

  animateNucleusClick() {
    if (this.nucleusClickFrame) cancelAnimationFrame(this.nucleusClickFrame);
    const started = performance.now();
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180;
    const frame = now => {
      const progress = duration ? Math.min(1, (now - started) / duration) : 1;
      const press = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
      this.nucleusClickScale = 1 - 0.12 * press;
      this.draw();
      if (progress < 1) {
        this.nucleusClickFrame = requestAnimationFrame(frame);
      } else {
        this.nucleusClickScale = 1;
        this.nucleusClickFrame = 0;
        this.draw();
      }
    };
    this.nucleusClickFrame = requestAnimationFrame(frame);
  }

  setNucleusHovered(hovered) {
    if (hovered === this.nucleusHovered) return;
    this.nucleusHovered = hovered;
    if (this.nucleusHoverFrame) cancelAnimationFrame(this.nucleusHoverFrame);
    const initialScale = this.nucleusHoverScale;
    const targetScale = hovered ? 1.08 : 1;
    const started = performance.now();
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 140;
    const frame = now => {
      const progress = duration ? Math.min(1, (now - started) / duration) : 1;
      const eased = 1 - (1 - progress) ** 3;
      this.nucleusHoverScale = initialScale + (targetScale - initialScale) * eased;
      this.draw();
      if (progress < 1) {
        this.nucleusHoverFrame = requestAnimationFrame(frame);
      } else {
        this.nucleusHoverScale = targetScale;
        this.nucleusHoverFrame = 0;
      }
    };
    this.nucleusHoverFrame = requestAnimationFrame(frame);
  }

  draw() {
    const size = this.content.clientWidth || 300;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const pixels = Math.round(size * ratio);
    if (this.canvas.width !== pixels || this.canvas.height !== pixels) {
      this.canvas.width = pixels;
      this.canvas.height = pixels;
    }
    const context = this.canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size, size);

    const shells = shellElectronAssignments(this.metadata);
    this.electronHitAreas = [];
    this.nucleusHitArea = null;
    if (!shells.length) {
      context.fillStyle = '#aab2bd';
      context.font = '400 14px Syne, system-ui, sans-serif';
      context.textAlign = 'center';
      context.fillText('Configurazione elettronica non disponibile', size / 2, size / 2);
      return;
    }

    const center = size / 2;
    // Keep the complete active-electron glow inside the canvas. Glows are
    // redrawn on the final layer, above rings, labels, and the nucleus.
    const maxRadius = Math.min(BOHR_MAX_RADIUS, size / 2 - ACTIVE_ELECTRON_GLOW_RADIUS - 2);
    // Keep the nucleus visually identical across elements, regardless of the
    // number of occupied shells and therefore of the orbit spacing.
    const nucleusRadius = 44 / 3;
    // Measure the first gap from the nucleus edge. It is identical to every
    // following ring-to-ring gap.
    const orbitSpacing = (maxRadius - nucleusRadius) / shells.length;
    const displayedNucleusRadius = nucleusRadius * this.nucleusClickScale * this.nucleusHoverScale;
    this.nucleusHitArea = { x: center, y: center, radius: nucleusRadius + 3 };
    const symbol = this.metadata?.element || '?';
    const category = elementCategory(symbol);
    const shellLabelPositions = [];

    context.lineWidth = 1;
    context.globalAlpha = 0.5;
    context.strokeStyle = category.color;
    shells.forEach(([principalShell, electrons], index) => {
      const radius = nucleusRadius + orbitSpacing * (index + 1);
      context.beginPath();
      context.arc(center, center, radius, 0, TAU);
      context.stroke();
      shellLabelPositions.push({
        label: SHELL_LABELS[principalShell - 1] || String(principalShell),
        x: center + Math.cos(SHELL_LABEL_ANGLE) * radius,
        y: center + Math.sin(SHELL_LABEL_ANGLE) * radius,
      });

      const electronRadius = 4.5;
      context.globalAlpha = 1;
      electrons.forEach((assignment, electron) => {
        const angle = SHELL_LABEL_ANGLE + TAU * (electron + 0.5) / electrons.length;
        const x = center + Math.cos(angle) * radius;
        const y = center + Math.sin(angle) * radius;
        this.electronHitAreas.push({ ...assignment, x, y, hitRadius: electronRadius + 4 });
      });
      context.globalAlpha = 0.5;
      context.strokeStyle = category.color;
    });
    context.globalAlpha = 1;

    // Cut a genuinely transparent gap in each orbit before placing its label.
    // Labels precede particles and nucleus, which remain legible if they overlap.
    context.font = '400 12px Syne, system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';
    for (const { label, x, y } of shellLabelPositions) {
      const labelMetrics = context.measureText(label);
      const labelAscent = Number.isFinite(labelMetrics.actualBoundingBoxAscent) ? labelMetrics.actualBoundingBoxAscent : 9;
      const labelDescent = Number.isFinite(labelMetrics.actualBoundingBoxDescent) ? labelMetrics.actualBoundingBoxDescent : 3;
      const labelBaseline = y + (labelAscent - labelDescent) / 2;
      context.clearRect(x - labelMetrics.width / 2 - 3, y - (labelAscent + labelDescent) / 2 - 2,
        labelMetrics.width + 6, labelAscent + labelDescent + 4);
      context.fillStyle = category.color;
      context.fillText(label, x, labelBaseline);
    }

    // Draw every electron above the shell labels.
    for (const electron of this.electronHitAreas) {
      context.beginPath();
      context.arc(electron.x, electron.y, 4.5, 0, TAU);
      context.fillStyle = electron.color;
      context.fill();
      context.strokeStyle = '#ffffff';
      context.lineWidth = 1;
      context.stroke();
    }

    // Keep the nucleus above rings and labels as well.
    context.beginPath();
    context.arc(center, center, displayedNucleusRadius, 0, TAU);
    context.fillStyle = category.color;
    context.fill();
    context.strokeStyle = '#ffffffcc';
    context.lineWidth = 1.5;
    context.stroke();
    context.fillStyle = '#161616';
    const symbolSize = Math.max(8, displayedNucleusRadius * 0.92);
    context.font = `400 ${symbolSize}px Syne, system-ui, sans-serif`;
    context.textBaseline = 'alphabetic';
    context.textAlign = 'center';
    const metrics = context.measureText(symbol);
    const ascent = Number.isFinite(metrics.actualBoundingBoxAscent) ? metrics.actualBoundingBoxAscent : symbolSize * 0.72;
    const descent = Number.isFinite(metrics.actualBoundingBoxDescent) ? metrics.actualBoundingBoxDescent : symbolSize * 0.18;
    const left = Number.isFinite(metrics.actualBoundingBoxLeft) ? metrics.actualBoundingBoxLeft : metrics.width / 2;
    const right = Number.isFinite(metrics.actualBoundingBoxRight) ? metrics.actualBoundingBoxRight : metrics.width / 2;
    const symbolX = center + (left - right) / 2;
    const symbolBaseline = center + (ascent - descent) / 2;
    context.fillText(symbol, symbolX, symbolBaseline);

    const activeElectrons = this.electronHitAreas.filter(area => this.activeElectronKeys.has(area.key));
    // Glows are a dedicated top layer, so later-drawn rings, labels, nuclei,
    // or neighbouring electrons can never cut through them. The radial
    // gradient keeps the same color stops but reaches its transparent edge
    // one third sooner than the previous version.
    for (const electron of activeElectrons) {
      const glow = context.createRadialGradient(
        electron.x, electron.y, 4.5,
        electron.x, electron.y, ACTIVE_ELECTRON_GLOW_RADIUS,
      );
      glow.addColorStop(0, `${electron.color}99`);
      glow.addColorStop(0.35, `${electron.color}66`);
      glow.addColorStop(0.72, `${electron.color}24`);
      glow.addColorStop(1, `${electron.color}00`);
      context.beginPath();
      context.arc(electron.x, electron.y, ACTIVE_ELECTRON_GLOW_RADIUS, 0, TAU);
      context.fillStyle = glow;
      context.fill();
    }
    // Redraw active particles above every glow to keep their white outlines crisp.
    for (const electron of activeElectrons) {
      context.beginPath();
      context.arc(electron.x, electron.y, 4.5, 0, TAU);
      context.fillStyle = electron.color;
      context.fill();
      context.strokeStyle = '#ffffff';
      context.lineWidth = 1;
      context.stroke();
    }
  }
}
