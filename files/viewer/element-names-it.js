// Nomi italiani mostrati nella scheda dell'elemento sopra il modello di Bohr.
// Per correggere un nome, modifica soltanto il testo tra virgolette.
export const ELEMENT_NAMES_IT = Object.freeze({
  H: 'Idrogeno', He: 'Elio',
  Li: 'Litio', Be: 'Berillio', B: 'Boro', C: 'Carbonio', N: 'Azoto', O: 'Ossigeno', F: 'Fluoro', Ne: 'Neon',
  Na: 'Sodio', Mg: 'Magnesio', Al: 'Alluminio', Si: 'Silicio', P: 'Fosforo', S: 'Zolfo', Cl: 'Cloro', Ar: 'Argon',
  K: 'Potassio', Ca: 'Calcio', Sc: 'Scandio', Ti: 'Titanio', V: 'Vanadio', Cr: 'Cromo', Mn: 'Manganese', Fe: 'Ferro', Co: 'Cobalto', Ni: 'Nichel', Cu: 'Rame', Zn: 'Zinco', Ga: 'Gallio', Ge: 'Germanio', As: 'Arsenico', Se: 'Selenio', Br: 'Bromo', Kr: 'Kripton',
  Rb: 'Rubidio', Sr: 'Stronzio', Y: 'Ittrio', Zr: 'Zirconio', Nb: 'Niobio', Mo: 'Molibdeno', Tc: 'Tecnezio', Ru: 'Rutenio', Rh: 'Rodio', Pd: 'Palladio', Ag: 'Argento', Cd: 'Cadmio', In: 'Indio', Sn: 'Stagno', Sb: 'Antimonio', Te: 'Tellurio', I: 'Iodio', Xe: 'Xenon',
  Cs: 'Cesio', Ba: 'Bario', La: 'Lantanio', Ce: 'Cerio', Pr: 'Praseodimio', Nd: 'Neodimio', Pm: 'Promezio', Sm: 'Samario', Eu: 'Europio', Gd: 'Gadolinio', Tb: 'Terbio', Dy: 'Disprosio', Ho: 'Olmio', Er: 'Erbio', Tm: 'Tulio', Yb: 'Itterbio', Lu: 'Lutezio', Hf: 'Afnio', Ta: 'Tantalio', W: 'Tungsteno', Re: 'Renio', Os: 'Osmio', Ir: 'Iridio', Pt: 'Platino', Au: 'Oro', Hg: 'Mercurio', Tl: 'Tallio', Pb: 'Piombo', Bi: 'Bismuto', Po: 'Polonio', At: 'Astato', Rn: 'Radon',
  Fr: 'Francio', Ra: 'Radio', Ac: 'Attinio', Th: 'Torio', Pa: 'Protoattinio', U: 'Uranio', Np: 'Nettunio', Pu: 'Plutonio', Am: 'Americio', Cm: 'Curio', Bk: 'Berkelio', Cf: 'Californio', Es: 'Einsteinio', Fm: 'Fermio', Md: 'Mendelevio', No: 'Nobelio', Lr: 'Laurenzio', Rf: 'Rutherfordio', Db: 'Dubnio', Sg: 'Seaborgio', Bh: 'Bohrio', Hs: 'Hassio', Mt: 'Meitnerio', Ds: 'Darmstadtio', Rg: 'Roentgenio', Cn: 'Copernicio', Nh: 'Nihonio', Fl: 'Flerovio', Mc: 'Moscovio', Lv: 'Livermorio', Ts: 'Tennessio', Og: 'Oganesson',
});

export function elementNameIt(symbol) {
  return ELEMENT_NAMES_IT[symbol] || 'Elemento sconosciuto';
}

// Le proprietà dell'oggetto sono elencate in ordine di numero atomico.
export function elementAtomicNumber(symbol) {
  const index = Object.keys(ELEMENT_NAMES_IT).indexOf(symbol);
  return index < 0 ? null : index + 1;
}
