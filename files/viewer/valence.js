// Valence is the highest occupied principal shell in the loaded model.
export function valenceSelection(objects) {
  const orbitals = objects.map(node => {
    const match = /^(\d+)([spdf])/i.exec(node.name || '');
    return match ? { node, n: Number(match[1]) } : null;
  }).filter(Boolean);
  if (!orbitals.length) return { objects: [], description: 'No named atomic orbitals in this model.' };
  const n = Math.max(...orbitals.map(orbital => orbital.n));
  return {
    objects: orbitals.filter(orbital => orbital.n === n).map(orbital => orbital.node),
    description: `Valence: outermost occupied shell, n=${n}. Lower shells are unchanged.`,
  };
}
