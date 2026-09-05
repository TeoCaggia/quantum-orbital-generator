# Atomic Orbital Generator and Viewer

Generate three-dimensional point clouds of occupied atomic orbitals and explore them in a desktop viewer. The generator accepts all 118 element symbols from H to Og, or their atomic numbers. The viewer combines the 3D scene with an interactive electron configuration, a schematic Bohr model, element information in Italian, and natural isotopic abundances.

The calculation uses hydrogen-like radial functions, Slater effective nuclear charges, and real spherical harmonics. It is an educational visualization with a defined display convention. Read [Scientific interpretation](#scientific-interpretation) before interpreting shapes, volumes, or electron configurations quantitatively.

## Contents

- [Requirements and installation](#requirements-and-installation)
- [Quick start](#quick-start)
- [Generator commands](#generator-commands)
- [Sequential and parallel calculation](#sequential-and-parallel-calculation)
- [Output files and metadata](#output-files-and-metadata)
- [Using the desktop viewer](#using-the-desktop-viewer)
- [Editing names and reference data](#editing-names-and-reference-data)
- [Scientific interpretation](#scientific-interpretation)
- [Using the generator from Python](#using-the-generator-from-python)
- [Project structure and maintenance](#project-structure-and-maintenance)
- [Troubleshooting](#troubleshooting)

## Requirements and installation

Run commands from the project directory, which contains `orbital_generator.py`. Examples use PowerShell on Windows. Use Python 3.10 or newer, with compatible versions of the dependencies below; a 64-bit interpreter is appropriate for the large numerical arrays. The viewer also needs a desktop session capable of running Qt WebEngine and WebGL.

| Component | Dependencies | Installation file |
| --- | --- | --- |
| Generator | NumPy `>=1.26`, SciPy `>=1.11`, trimesh `>=4.0` | `files/requirements.txt` |
| Desktop viewer | PySide6 `>=6.10,<7` | `files/requirements-viewer.txt` |

Install both components with the same interpreter:

```powershell
python -m pip install -r files/requirements.txt
python -m pip install -r files/requirements-viewer.txt
```

For generation alone, install only the first file. To open existing GLB/glTF files directly, the viewer launcher needs only the second file. The command `python orbital_generator.py --open` also imports the generator's scientific dependencies.

An optional virtual environment keeps dependencies separate:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r files/requirements.txt
.\.venv\Scripts\python.exe -m pip install -r files/requirements-viewer.txt
.\.venv\Scripts\python.exe orbital_generator.py C --open
```

When using this environment, replace `python` in other examples with `.\.venv\Scripts\python.exe`. Activation is unnecessary when calling the interpreter explicitly. `viewer.cmd` chooses its own Python installation and does not explicitly select `.venv`.

Installation requires access to the Python packages. Once dependencies and bundled assets are present, generation and viewing work offline. Three.js, dat.gui, decoders, and fonts are local; no npm build or Node.js installation is required to use the application. Clicking the NIST source link opens the external website in the system browser.

## Quick start

Generate carbon with default settings and open it:

```powershell
python orbital_generator.py C --open
```

This creates:

```text
output/
├── c_orbitals.glb
└── json/
    └── c_orbitals.json
```

Generate a named model, then open it separately:

```powershell
python orbital_generator.py Kr --output krypton.glb
python files/orbital_viewer.py output/krypton.glb
```

To start an empty viewer:

```powershell
python files/orbital_viewer.py
```

On Windows, you can also double-click `viewer.cmd`, or run:

```powershell
.\viewer.cmd output/krypton.glb
```

The shortcut changes the working directory to the project folder and forwards its arguments to the viewer.

## Generator commands

```text
python orbital_generator.py ELEMENT [options]
python orbital_generator.py --open
python orbital_generator.py --help
python orbital_generator.py --info
```

`ELEMENT` is a case-insensitive symbol or integer atomic number from 1 to 118: `C`, `fe`, and `26` are valid. Full names such as `Carbonio` or `Iron` are not accepted. The generator constructs neutral-atom occupations; there are no CLI options for ionic charge, isotope selection, or custom occupations.

| Argument or option | Meaning | Default / accepted values |
| --- | --- | --- |
| `ELEMENT` | Element to generate | Required for generation; H–Og or 1–118 |
| `--output FILE`, `-o FILE` | Output filename or path | `output/<lowercase-symbol>_orbitals.glb` |
| `--points N` | Baseline points per occupied spatial orbital, before lobe and border additions | `2000`; integer `>=1` |
| `--resolution N` | Requested grid size per axis for volume estimation | `72`; integer `>=16` |
| `--isovalue X` | Relative boundary after separate normalization of each radial/angular lobe | `0.5`; strictly `0<X<1` |
| `--seed N` | Seed controlling point placement | `7`; nonnegative integer |
| `--parallel` | Calculate independent orbitals in worker processes | Off; sequential by default |
| `--workers N` | Maximum worker processes, used with `--parallel` | Detected logical CPUs, capped at occupied orbital count; explicit `N>=1` |
| `--no-progress` | Hide the live progress bar | Off; completion summary still printed |
| `--open`, `--view` | Open the generated model; without an element, open an empty viewer | Off; generated output must be GLB or glTF |
| `-h`, `--help` | Print compact command help and exit | No calculation |
| `--info` | Print expanded parameter descriptions and examples, then exit | No calculation |

The table gives the actual output naming behavior. The short `--output` help text currently abbreviates the default as `<element>.glb`; the implemented filename is `<lowercase-symbol>_orbitals.glb`.

### Choosing points, boundary, and resolution

- Increase `--points` for a denser cloud. This is a baseline per spatial orbital, not a total for the atom or a count per electron. Support and border points increase the exported total.
- Lower `--isovalue` for more extended regions; raise it for regions nearer each lobe's local maximum. `0.5` is a relative display threshold, not a surface enclosing 50% of electron probability.
- Increase `--resolution` to refine the voxel-based volume estimate. The effective grid is `max(requested resolution, 64 + 20*l)`, with `l=0,1,2,3` for `s,p,d,f`. At the default, these use at least 72, 84, 104, and 124 samples per axis respectively.
- Border calculations use a separate grid of `128 + 32*l` per axis for each radial region. Reducing `--resolution` does not reduce every expensive calculation. Grid work and memory grow roughly with the cube of their per-axis size.

The analytical display boundary and baseline sampling are independent of `--resolution`. Border highlighting is always enabled at strength 5 in the CLI; there is no CLI option to disable it. The current CLI exposes no surface-mesh, opacity, smoothness, or point-density options.

Examples:

```powershell
# Use an atomic number and export glTF with embedded buffers.
python orbital_generator.py 8 --output oxygen.gltf

# Increase point density with the default display threshold.
python orbital_generator.py Fe --output iron.glb --points 5000 --open

# Include more extended regions and refine the volume grid.
python orbital_generator.py P --output phosphorus.glb --isovalue 0.08 --resolution 112

# Change point placement and hide the live progress bar.
python orbital_generator.py C --output carbon_seed42.glb --seed 42 --no-progress
```

## Sequential and parallel calculation

Without `--parallel`, orbitals are calculated one after another. Enable parallel calculation explicitly for each command:

```powershell
python orbital_generator.py Og --output Og.glb --points 5000 --parallel --open
```

The default process count is `min(number of occupied spatial orbitals, os.cpu_count() or 1)`. An atom with four occupied spatial orbitals cannot run more than four orbital tasks at once, even with more logical CPUs.

To choose the process count explicitly:

```powershell
python orbital_generator.py W --output tungsten.glb --parallel --workers 4
```

`--workers` requires `--parallel`. Its value is capped at the occupied orbital count, but an explicit value is not capped at detected CPUs. `--parallel --workers 1` uses one worker process; omitting `--parallel` uses the original in-process sequential path.

Parallel mode imposes no application RAM percentage ceiling, memory-based throttling, CPU utilization quota, or numerical-library thread overrides. Operating-system constraints and externally configured library settings still apply. Full RAM or CPU utilization is not a target: usage depends on task count and size, calculation stages, process startup, result transfer, and export. The generator does not use GPU acceleration; the viewer uses WebGL for rendering.

Several workers can hold large grids simultaneously. If memory pressure causes heavy paging or worker failures, explicitly choose fewer workers or sequential mode. More workers are not guaranteed to finish faster, especially for small atoms.

Sequential progress reports stages within an orbital. Parallel progress advances when complete orbital tasks return, so it can remain at one percentage during a long calculation. Export and metadata writing follow orbital sampling.

Per-orbital seeds and output ordering are assigned before dispatch. With the same element, parameters, seed, and software environment, changing worker count or execution mode preserves the sampled orbital results. Execution-mode metadata differs. The seed itself is not saved in the JSON; retain the command for reproducibility.

## Output files and metadata

### Paths and overwriting

A bare filename goes under `output/`, relative to the working directory. Explicit nested or absolute paths are used as supplied. Missing parent directories are created.

| Command fragment | Model path | Metadata path |
| --- | --- | --- |
| `C` | `output/c_orbitals.glb` | `output/json/c_orbitals.json` |
| `C -o carbon.glb` | `output/carbon.glb` | `output/json/carbon.json` |
| `C -o models/carbon.glb` | `models/carbon.glb` | `models/json/carbon.json` |

Existing model and matching JSON files are overwritten without a prompt. Use distinct names to retain variants. Quote paths containing spaces: `--output "output/my models/carbon.glb"`.

### Export formats

| Extension | Contents | Bundled viewer support |
| --- | --- | --- |
| `.glb` | Binary glTF 2.0 scene; one named point-cloud node per orbital | Yes; recommended |
| `.gltf` | JSON glTF scene with embedded buffers in this generator's exports; preserves orbital nodes | Yes |
| `.ply` | One merged point cloud with vertex colors | No |
| `.obj` | Point vertices with RGB values and point indices; importer color support varies | No |
| `.xyz` | Point-count header, comment, then `X x y z` rows; no colors or orbital nodes | No |

All exported coordinates are in ångströms (Å). GLB/glTF nodes use labels such as `1s`, `2px`, `3dz2`, or `4fxyz`, which the viewer uses for selection. Exports are point clouds, not triangulated orbital surfaces. In XYZ, `X` marks a cloud point, not an actual atom. Use an external compatible tool for PLY, OBJ, or XYZ; `--open` rejects them.

Generated glTF geometry buffers are embedded. A glTF from another program can reference external `.bin` files or textures: keep them alongside that model or in its subdirectories.

### JSON sidecar

Every export receives `<model directory>/json/<model stem>.json`. Move or rename the model and sidecar together, retaining this relative layout. The viewer does not search for a JSON next to the model or elsewhere.

| JSON section | Information |
| --- | --- |
| `element`, `atomic_number`, `units` | Element identity and coordinate/volume units |
| `method` | Radial/angular model, normalization, isovalue, baseline point count, grids, border settings, execution mode and worker count |
| `orbitals[]` identity | `label`, `n`, `l`, `real_m`, `electrons`, `z_effective` |
| `orbitals[]` measurements | `volume_bohr3`, `volume_angstrom3`, `point_count`, lobe-support counts, border counts/budgets, surface areas and per-lobe counts |
| `orbitals[]` nodal data | Radial nodes and peak densities, polar nodes and peak densities, connected-lobe count |

Electron configuration is reconstructed from orbital entries, not stored as a separate string. The sidecar is not a complete invocation log: it omits the seed and dependency versions. `border_support_points` counts minimum-budget border additions, not all border points; the total border additions are the sum of `border_point_counts`.

A GLB/glTF can load without its JSON, but element information, electron-count superscripts, and the Bohr diagram may be missing or incomplete. Geometry names can still support orbital grouping. Atomic masses and isotope abundances come from local viewer reference files, not the generated JSON.

## Using the desktop viewer

### Starting and opening files

```powershell
python files/orbital_viewer.py
python files/orbital_viewer.py output/c_orbitals.glb
python orbital_generator.py --open
.\viewer.cmd output/c_orbitals.glb
```

The interface currently uses Italian element names and most control labels, including when following this English manual. An empty viewer shows **Apri file .glb/.gltf** in the center. After loading, that button is hidden. Open another model with **Ctrl+O**, or drag one local GLB/glTF into the window. Wait for the current load to finish first.

### Camera and display controls

| Input | Action |
| --- | --- |
| Left-button drag on the 3D scene | Free rotation |
| Shift + left-button drag | Pan |
| Mouse wheel | Zoom |
| `F` | Restore full-model perspective framing |
| `1` | Front view from positive X |
| `3` | Side view from positive Y |
| `7` | Top view from positive Z |
| `F11` | Toggle full screen; leaving returns to a maximized window |
| `Ctrl+O` | Open another model |
| `Esc` | Close the individual-orbital popup |

Upper-right buttons toggle automatic rotation and labeled scene axes, and restore the original view. Presets frame the entire model, including when orbitals are hidden. Enabling axes adds labeled axes in the scene, with no separate corner widget.

### Electron configuration on the right

The grid organizes subshells by principal shell and `s`, `p`, `d`, `f` type. Superscripts show occupations from the JSON. Empty entries are disabled and show zero.

- Click an occupied subshell to show or hide its orbital group. A dashed border means partial visibility; clicking it shows the whole group.
- Right-click a group with multiple occupied orbitals for individual controls. You can also focus its button and use the Menu key or Shift+F10. Close with `×`, Esc, or an outside click.
- **Mostra tutti gli orbitali** and **Nascondi tutti gli orbitali** show and hide all geometry respectively.
- **Mostra gli orbitali di valenza** and **Nascondi gli orbitali di valenza** use the highest occupied principal shell. Showing valence isolates it, hiding lower-shell orbitals. Hiding valence hides that outer shell and leaves other visibility states unchanged.

Here, “valence” means the largest occupied `n` in the model. This simple selector excludes lower-shell `d` and `f` orbitals even when relevant to bonding. Showing orbital geometry triggers smooth camera framing; selections and the Bohr diagram remain synchronized.

### Element information and isotopes on the left

The first card shows the element symbol, its editable Italian name, and `(Z=...)`. The next card has two pages:

1. **TIPOLOGIA**, **MASSA ATOMICA** with displayed unit `Da`, and **CONFIGURAZIONE ELETTRONICA**.
2. **COMPOSIZIONE ISOTOPICA**, listing isotope symbol, natural abundance percentage, and proton/neutron counts. For mass number `A`, the nucleus has `Z` protons and `A-Z` neutrons; for example `C-13` has `6p⁺ 7n⁰`.

Use the circular triangle button, or click the Bohr nucleus, to alternate pages. Returning reverses the slide direction. Isotopes are sorted by decreasing abundance. Long lists scroll vertically with a left scrollbar; the navigation arrow remains fixed. The source below the list wraps as needed and opens the [NIST database](https://physics.nist.gov/cgi-bin/Compositions/stand_alone.pl?isotype=all) in the system browser.

The local isotope dataset records a retrieval date of 2026-09-05. It contains only entries for which NIST reports an abundance; uncertainty annotations are omitted. Elements without such entries show a message. This is an offline snapshot, not a live query or a complete inventory of every isotope that can occur in nature. The page is informational and does not regenerate orbitals.

### Bohr diagram

The diagram shows occupied shells labeled `K` through `Q`. Electron colors match orbital types: `s` red, `p` yellow, `d` cyan, `f` green. Nucleus and shell colors identify the element category. The equally spaced rings are schematic, not electron trajectories or the 3D model's length scale.

Each electron circle is associated with a spatial orbital. Click circles to add/remove them from the selection; the 3D view shows the union of associated orbitals. Paired electrons share one orbital, so deselecting one can leave that orbital visible. Multiple selections are supported. Active circles have a colored glow; enabling an electron focuses its orbital smoothly. Right-panel changes update these circles in return.

Clicking the nucleus changes the information page, with a brief click animation and small hover response. Its base size is identical for all elements.

Left/right panel groups share their visible width and a common scale as window height changes. Orbital-button heights adjust to align the total stacks. Long isotope lists scroll within their card instead of enlarging the stack.

## Editing names and reference data

Edit these files with a text editor, then close and relaunch the viewer. Display-name or reference-data corrections do not require regenerating geometry.

| File | Controls |
| --- | --- |
| `files/viewer/element-names-it.js` | Italian names, for example `Xe: 'Xenon'` |
| `files/viewer/element-atomic-masses.js` | Atomic-mass strings |
| `files/viewer/element-natural-isotopes.js` | Isotope mass numbers and fractional abundances |
| `files/viewer/bohr-model.js` | Element categories/colors, Bohr and isotope interactions |
| `files/viewer/index.html` | Panel CSS, dimensions, typography, spacing and colors |
| `files/viewer/desktop.js` | Desktop labels and selection/camera behavior |

For names, change only the quoted text. Preserve symbol keys, their order, commas, and JavaScript syntax: the fallback atomic-number lookup depends on the name object's insertion order.

Isotope entries are `[massNumber, 'fractionalAbundance']`, such as `C: [[12, '0.9893'], [13, '0.0107']]`. Store fractions as strings, not percentages; display converts them to percentages. Retain source attribution when correcting values.

The mass file identifies its source as the abbreviated IUPAC table of 2022-05-04; consult the [IUPAC periodic-table page](https://iupac.org/what-we-do/periodic-table-of-elements/) for reference updates. Bracketed values denote an isotope mass number for elements without standard atomic weight, not a precise measured isotope mass; the viewer currently appends `Da` to those strings too.

Typography uses Syne Regular for ordinary text, Syne ExtraBold for the symbol, Syne Bold for the name and Bohr title, and Fira Code for atomic numbers and property headings. Fonts and licenses are in `files/viewer/fonts/`.

## Scientific interpretation

1. **Occupations:** Aufbau filling and Hund-style single occupation before pairing, with overrides for Cr, Cu, Nb, Mo, Ru, Rh, Pd, Ag, Pt, and Au. Support for all 118 symbols does not mean every known ground-state exception, particularly for heavy elements, is implemented.
2. **Functions:** hydrogen-like radial functions with Slater screening and real spherical harmonics for `s`, `p`, `d`, `f`. Each occupied spatial orbital is exported once, whether it holds one or two electrons.
3. **Display region:** each radial/angular nodal region is normalized to its own local peak before applying `--isovalue`. This preserves weak inner shells and small lobes, but is not one common physical-density isosurface.
4. **Points:** a scrambled Sobol baseline samples the accepted region uniformly, not as probability-weighted electron positions. Small connected lobes receive support to reach 16 points. Additional points highlight inner/outer borders, with CLI strength 5 and budgets weighted by surface area to the power 0.75. Visual point density is therefore not a direct probability-density measurement.
5. **Volumes:** voxel estimates of accepted display regions, per orbital, in `a0³` and `Å³`. Coordinates use `1 a0 = 0.529177210903 Å`. Volumes depend on threshold and resolution; overlapping orbital volumes must not be summed as a non-overlapping atomic volume.

The code does not solve a self-consistent Hartree–Fock or density-functional problem, include electron correlation or relativistic corrections, or compute molecular orbitals. Colors encode orbital type, not wavefunction sign or spin. The Bohr diagram and isotope table supplement the visualization; neither is an additional quantum or nuclear simulation.

## Using the generator from Python

Import `build_model` from a script in the project directory, or put that directory on Python's import path. It takes a `pathlib.Path`, writes model and JSON files, and returns `OrbitalResult` objects:

```python
from pathlib import Path
from orbital_generator import build_model


def main():
    results = build_model(
        element="C",
        output=Path("output/carbon_api.glb"),
        points_per_orbital=2000,
        resolution=72,
        isovalue=0.5,
        seed=7,
        show_progress=True,
        parallel=True,
        max_workers=4,
    )
    for result in results:
        print(result.orbital.label, len(result.points), result.volume_angstrom3)


if __name__ == "__main__":
    main()
```

Keep the `if __name__ == "__main__":` guard for multiprocessing, particularly on Windows, and run the example as a `.py` script. Unlike the CLI, `build_model` uses the path exactly as supplied without redirecting bare filenames into `output/`. Set `parallel=False` for sequential calculation; `max_workers` does not enable parallelism by itself.

The API also accepts `border_highlight` (finite, at least 1; default 5). A value of 1 removes extra border highlighting but retains baseline and lobe support. This option is not exposed by the CLI. `seed=None` permits non-fixed random initialization through the API.

`occupied_orbitals("C")` returns labels, quantum numbers, occupations, and effective charges without generating a cloud. `electron_configuration(z)` accepts an atomic number and returns populations keyed by `(n, l)`.

## Project structure and maintenance

```text
orbital_generator.py              Numerical model, sampling, export and CLI
README.md                        English guide
README.it.md                     Italian guide
viewer.cmd                       Windows launcher
test_parallel_generation.py     Parallel/sequential regression checks
files/
├── requirements.txt             Generator dependencies
├── requirements-viewer.txt      Qt desktop dependency
├── orbital_viewer.py            Qt window, local server and Python/JS bridge
└── viewer/
    ├── index.html               Markup, CSS and font declarations
    ├── desktop.js               Panels, selections, resizing and camera
    ├── viewer.js                Three.js scene, loading and rendering
    ├── bohr-model.js            Element cards, isotopes and Bohr diagram
    ├── configuration.js         Subshell grouping
    ├── valence.js               Highest-shell selection
    ├── free-controls.js         Rotation, pan and zoom
    ├── labeled-axes.js          Scene axes and labels
    ├── element-names-it.js      Editable names
    ├── element-atomic-masses.js Atomic-mass data
    ├── element-natural-isotopes.js  Isotope data
    ├── fonts/                  Syne and Fira Code
    ├── vendor/                 Three.js, dat.gui and decoders
    ├── prepare_assets.py       Restore assets from pinned archives
    └── README.md               Asset maintenance notes
output/                         Default generated files
└── json/                       Matching metadata
```

The desktop host embeds HTML/JavaScript in Qt WebEngine. Its Python server uses `127.0.0.1`, an automatic port, and a session token, serving the interface and directories of explicitly opened models. Resource paths must remain within those directories. Remote resources and navigation away from the interface are blocked; the NIST link is handed to the system browser. Opening `index.html` directly in a browser is not a supported launch method: the adapter expects Qt WebChannel.

The rendering code is adapted from Don McCurdy's three-gltf-viewer. Bundled versions are Three.js 0.176.0 and dat.gui 0.7.9, with Draco, KTX2/Basis, and Meshopt decoding. Included library licenses are `files/viewer/vendor/three/LICENSE` and `files/viewer/vendor/dat.gui/LICENSE`; font notices are `OFL.txt` and `OFL-FiraCode.txt` under `fonts/`.

For restoration, use [the viewer asset notes](files/viewer/README.md). No asset rebuild is needed after editing project JavaScript, CSS, or data tables; relaunch the viewer.

Run included generation regression checks from the project directory:

```powershell
python -m unittest -v test_parallel_generation
```

These cover opt-in parallelism, explicit worker behavior, preservation of numerical-library environment settings, and agreement with sequential sampling. They include a small real calculation and temporary output files. They do not verify graphical layout.

## Troubleshooting

| Symptom | What to check or do |
| --- | --- |
| `python` is not found | Use the interpreter's full path or `py -3` if the Windows launcher is installed. Use the same interpreter for `-m pip` and execution. |
| Missing NumPy, SciPy, trimesh, or PySide6 | Install the corresponding requirements with the interpreter running the command. The generator imports scientific packages even for `--help` or `--open`. |
| `viewer.cmd` fails but direct commands work | It tries `py -3`, then a local Python 3.14 installation if present, then `python`. Run the viewer with your working interpreter or explicit virtual-environment path. |
| `--workers requires --parallel` | Add `--parallel`, or remove `--workers` for sequential calculation. |
| Unknown arguments | Consult `--help` or `--info`; use the options above, not older project options. |
| Parallel progress pauses | Updates arrive at completed-orbital boundaries. Border grids remain expensive even with few points. |
| High RAM, heavy paging, or terminated worker | Explicitly reduce `--workers` or use sequential mode; there is no automatic memory limiter. |
| Point count exceeds `--points` | It is per occupied spatial orbital and excludes support/border additions. Inspect JSON `point_count`. |
| Incomplete element/Bohr information | Check `<model folder>/json/<model stem>.json`; its name must match and it must contain valid orbital metadata. |
| Missing glTF resources | Keep buffers/textures within the model folder or its subfolders. Remote and parent-folder resources cannot load. |
| All orbitals disappeared | Use **Mostra tutti gli orbitali**, then `F` to reframe. |
| No isotope rows | The snapshot may have no reported abundance for that element; a message is displayed. |
| Missing viewer libraries | Follow `files/viewer/README.md` and restore the pinned assets with `prepare_assets.py`. |
| Viewer fails to start or load | Launch from a terminal to read Qt/JavaScript errors. Check PySide6, assets, and model/resource paths; retry after correcting them. |
| Display edits do not appear | Close and reopen the viewer; scripts and tables are already loaded in the current session. |

For a reproducible issue report, record the exact command, element, Python/package versions, terminal error, and presence of the JSON sidecar. Keep model and JSON together when comparing results.
