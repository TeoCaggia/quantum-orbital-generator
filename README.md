# Atomic Orbital Generator

**English** · [Italiano](README.it.md)

This project generates three-dimensional point-cloud models of the occupied atomic orbitals of neutral elements from H to Og. It is an educational, physically motivated visualization based on hydrogen-like functions and Slater screening; it is not a many-electron quantum-chemistry calculation.

## Generating an element

Run:

```text
python orbital_generator.py ELEMENT [options]
```

`ELEMENT` can be a case-insensitive chemical symbol or an atomic number from 1 to 118. For example, `C`, `fe`, and `26` are valid. Full element names are not accepted.

The simplest command is:

```powershell
python orbital_generator.py C
```

When `--output` is omitted, the program uses the canonical symbol and writes:

```text
output/C.glb
output/json/C.json
```

The JSON sidecar contains the element, electron configuration, generation method, orbital occupations, effective charges, point counts, nodal information, and estimated volumes.

### Command options

| Option | Function | Default |
| --- | --- | --- |
| `--output FILE`, `-o FILE` | Selects `.glb`, `.gltf`, `.ply`, `.obj`, or `.xyz` output | `output/<Symbol>.glb` |
| `--points N` | Baseline points for each occupied spatial orbital | `2000` |
| `--resolution N` | Requested volume-grid resolution per axis; minimum 16 | `72` |
| `--isovalue X` | Relative display boundary, with `0 < X < 1` | `0.5` |
| `--seed N` | Reproducible point-placement seed | `7` |
| `--parallel` | Generates independent orbitals in parallel | Disabled |
| `--workers N` | Sets the process count and requires `--parallel` | Detected CPUs, capped by orbital count |
| `--no-progress` | Hides the live terminal progress bar | Disabled |
| `--open`, `--view` | Opens the generated GLB/glTF in the viewer | Disabled |
| `--info` | Prints expanded option descriptions and examples | — |
| `--help` | Prints compact command help | — |

A bare output filename is placed in `output/`. An explicit absolute path or a path containing directories is used as supplied. The matching metadata is always created in a `json` subdirectory next to the output location.

### Examples

Generate iron sequentially and use the default name `output/Fe.glb`:

```powershell
python orbital_generator.py Fe
```

Generate by atomic number with more points and open the result:

```powershell
python orbital_generator.py 26 --points 5000 --open
```

Choose a filename and a more extended display boundary:

```powershell
python orbital_generator.py P --output phosphorus.glb --isovalue 0.08 --resolution 112
```

Generate independent orbitals in parallel:

```powershell
python orbital_generator.py Og --parallel
```

Limit parallel execution to four worker processes:

```powershell
python orbital_generator.py W --parallel --workers 4
```

Without `--parallel`, orbitals are calculated one after another. Parallel mode has no application-level CPU or RAM limit, but the number of simultaneous tasks cannot exceed the number of occupied spatial orbitals. Large grids can use substantial memory; select fewer workers or sequential mode if the operating system begins paging.

## Scientific model

### Electron configuration

The program builds neutral-atom ground-state occupations in Aufbau order and distributes electrons across degenerate spatial orbitals according to Hund's rule before pairing them. Explicit ground-state corrections are included for Cr, Cu, Nb, Mo, Ru, Rh, Pd, Ag, Pt, and Au. Other heavy-element exceptions are not modeled individually.

Each occupied spatial orbital is exported once, whether it contains one or two electrons. Consequently, `--points` is a baseline per spatial orbital, not per electron and not for the whole atom.

### Orbital functions and dimensions

The wavefunction is represented as a hydrogen-like radial function multiplied by a real normalized spherical harmonic:

```text
ψ(n,l,m) = R(n,l,Z_eff,r) · Y(l,m,θ,φ)
```

The effective nuclear charge `Z_eff` is estimated using Slater screening rules. The supported real orbitals are `s`, `px`, `py`, `pz`, the five real `d` orbitals, and the seven real `f` orbitals. All orbitals in one exported atom share the same coordinate scale; the generator and viewer do not resize individual orbitals. Coordinates are exported in ångström using `1 a0 = 0.529177210903 Å`.

This approximation can produce large size differences between subshells. For example, an outer `4s` orbital may be much more diffuse than a screened `3d` orbital. Such proportions are internally consistent with the selected hydrogen-like Slater model, but they are not experimental many-electron densities.

### Display boundary and point sampling

The program evaluates `|ψ|²`. Each radial and angular nodal region is normalized to its own local maximum before applying `--isovalue`. This preserves weaker inner shells and small lobes in the display. Therefore, `--isovalue 0.5` means half of each region's local maximum; it is not a surface containing 50% of the electron probability and is not one shared physical-density threshold for the atom.

Lower values show more extended regions, while higher values retain regions closer to their local maxima. Baseline points are sampled uniformly inside the accepted volume with a scrambled Sobol sequence. They are display samples, not simulated electron positions drawn from the probability distribution.

Every connected lobe receives at least 16 support points. Additional points emphasize inner and outer boundaries at the fixed CLI strength of 5. For this reason, the final count is normally greater than `--points × occupied spatial orbitals`, and apparent point density must not be interpreted as probability density.

The requested volume grid is increased automatically to at least `64 + 20l` samples per axis, where `l = 0, 1, 2, 3` for `s, p, d, f`. Boundary calculations use a separate grid of `128 + 32l` samples per axis. Time and memory for a three-dimensional grid grow approximately with the cube of its per-axis resolution.

The JSON reports voxel estimates of each displayed orbital volume in `a0³` and `Å³`. These values depend on `--isovalue` and grid resolution. Overlapping orbital volumes are not disjoint parts of an atomic volume and should not be added as though they were.

### Limits of interpretation

The generator does not perform Hartree–Fock or density-functional calculations and does not include electron correlation, relativistic corrections, spin-orbit coupling, molecular orbitals, ionic charge, or isotope-dependent electronic structure. Colors identify angular momentum only: `s` red, `p` yellow, `d` cyan, and `f` green. They do not encode wavefunction phase or electron spin.
