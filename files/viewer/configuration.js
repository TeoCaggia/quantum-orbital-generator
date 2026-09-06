// Group geometry by occupied subshell without guessing electron populations.
export function configurationGroups(objects, metadata = null) {
  const records = new Map((Array.isArray(metadata?.orbitals) ? metadata.orbitals : [])
    .map(orbital => [orbital.label, orbital]));
  const groups = new Map();
  objects.forEach((node, index) => {
    const match = /^(\d+)([spdf])/i.exec(node.name || '');
    const n = match ? Number(match[1]) : null;
    const letter = match?.[2].toLowerCase();
    const key = match ? `${n}${letter}` : `object-${index}`;
    if (!groups.has(key)) groups.set(key, {
      key, label: match ? key : node.name || `Object ${index + 1}`,
      n, l: match ? 'spdf'.indexOf(letter) : null, nodes: [],
    });
    groups.get(key).nodes.push(node);
  });
  // Rows and columns match the shell diagram, including its empty subshells.
  if ([...groups.values()].some(group => group.n !== null)) {
    [1, 2, 3, 4, 4, 3, 2].forEach((columns, row) => {
      for (let l = 0; l < columns; l++) {
        const n = row + 1;
        const key = `${n}${'spdf'[l]}`;
        if (!groups.has(key)) groups.set(key, { key, label: key, n, l, nodes: [] });
      }
    });
  }
  return [...groups.values()].sort((a, b) => {
    if (a.n === null || b.n === null) return (a.n === null) - (b.n === null);
    return a.n - b.n || a.l - b.l;
  }).map(group => {
    const populations = [...new Set(group.nodes.map(node => node.name))]
      .map(name => records.get(name)?.electrons);
    const known = group.n !== null && populations.every(count => count === 1 || count === 2);
    return { ...group, electrons: known ? populations.reduce((sum, count) => sum + count, 0) : null };
  });
}
