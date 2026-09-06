"""Create merged 3-D point-cloud models of occupied atomic orbitals.

The model uses hydrogen-like radial functions with a Slater-rule effective
nuclear charge.  It is intended for physically motivated visualisation, not
for quantitative many-electron wave-function calculations.
"""

from __future__ import annotations

import argparse
import ctypes
import json
import math
import os
import struct
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from functools import lru_cache
from pathlib import Path
from typing import Callable, Iterable

import numpy as np
from scipy import ndimage
from scipy.optimize import brentq, minimize_scalar
from scipy.special import eval_genlaguerre, factorial, roots_genlaguerre, roots_jacobi
from scipy.stats import qmc

try:  # SciPy < 1.17
    from scipy.special import sph_harm as _sph_harm

    def _complex_spherical_harmonic(m: int, l: int, theta: np.ndarray, phi: np.ndarray) -> np.ndarray:
        return _sph_harm(m, l, phi, theta)
except ImportError:  # SciPy >= 1.17 renamed and reordered the function.
    from scipy.special import sph_harm_y as _sph_harm_y

    def _complex_spherical_harmonic(m: int, l: int, theta: np.ndarray, phi: np.ndarray) -> np.ndarray:
        return _sph_harm_y(l, m, theta, phi)

BOHR_TO_ANGSTROM = 0.529177210903
DEFAULT_BORDER_HIGHLIGHT = 5.0
BORDER_AREA_EXPONENT = 0.75
DEFAULT_ISOVALUE = 0.5

ELEMENTS = (
    "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co "
    "Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb "
    "Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os "
    "Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md "
    "No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og"
).split()
SYMBOL_TO_Z = {symbol.lower(): index + 1 for index, symbol in enumerate(ELEMENTS)}

# Aufbau order is sufficient for the usual teaching examples.  The exception
# table adjusts the well-established transition-metal ground states.
AUFBAU: tuple[tuple[int, int], ...] = (
    (1, 0), (2, 0), (2, 1), (3, 0), (3, 1), (4, 0), (3, 2), (4, 1),
    (5, 0), (4, 2), (5, 1), (6, 0), (4, 3), (5, 2), (6, 1), (7, 0),
    (5, 3), (6, 2), (7, 1),
)
EXCEPTIONS: dict[str, dict[str, int]] = {
    "Cr": {"4s": 1, "3d": 5}, "Cu": {"4s": 1, "3d": 10},
    "Nb": {"5s": 1, "4d": 4}, "Mo": {"5s": 1, "4d": 5},
    "Ru": {"5s": 1, "4d": 7}, "Rh": {"5s": 1, "4d": 8},
    "Pd": {"5s": 0, "4d": 10}, "Ag": {"5s": 1, "4d": 10},
    "Pt": {"6s": 1, "4f": 14, "5d": 9}, "Au": {"6s": 1, "4f": 14, "5d": 10},
}

ORBITAL_NAMES = {
    0: (("s", 0),),
    1: (("px", 1), ("py", -1), ("pz", 0)),
    2: (("dz2", 0), ("dxz", 1), ("dyz", -1), ("dx2-y2", 2), ("dxy", -2)),
    3: (("fz3", 0), ("fxz2", 1), ("fyz2", -1), ("fzx2-y2", 2), ("fxyz", -2),
        ("fxx2-3y2", 3), ("fy3x2-y2", -3)),
}
# Orbital colour encodes angular momentum: s=red, p=yellow, d=cyan, f=green.
L_COLORS: dict[int, np.ndarray] = {
    0: np.array((220, 38, 38, 255), dtype=np.uint8),    # s: red
    1: np.array((250, 204, 21, 255), dtype=np.uint8),   # p: yellow
    2: np.array((6, 182, 212, 255), dtype=np.uint8),    # d: cyan
    3: np.array((34, 197, 94, 255), dtype=np.uint8),    # f: green
}


@dataclass(frozen=True)
class Orbital:
    label: str
    n: int
    l: int
    real_m: int
    electrons: int
    z_effective: float


@dataclass
class OrbitalResult:
    orbital: Orbital
    points: np.ndarray
    volume_bohr3: float
    volume_angstrom3: float
    lobe_support_points: int = 0
    border_support_points: int = 0
    border_surface_areas_bohr2: list[float] | None = None
    border_target_point_counts: list[float] | None = None


class TerminalProgress:
    """A single-row progress bar that redraws in place in Windows terminals."""

    def __init__(self, enabled: bool = True) -> None:
        self.enabled = enabled
        self.stream = sys.stdout
        self.console_handle: int | None = None
        self.console_origin: tuple[int, int] | None = None
        self.previous_length = 0
        if enabled and os.name == "nt" and self.stream.isatty():
            handle = ctypes.windll.kernel32.GetStdHandle(-11)  # STD_OUTPUT_HANDLE
            if handle not in (0, -1):
                self.console_handle = handle

    def _windows_write(self, text: str) -> bool:
        """Overwrite one native Windows Console row without ANSI escape codes."""
        if self.console_handle is None:
            return False

        class Coord(ctypes.Structure):
            _fields_ = [("X", ctypes.c_short), ("Y", ctypes.c_short)]

        class SmallRect(ctypes.Structure):
            _fields_ = [("Left", ctypes.c_short), ("Top", ctypes.c_short),
                        ("Right", ctypes.c_short), ("Bottom", ctypes.c_short)]

        class ConsoleScreenBufferInfo(ctypes.Structure):
            _fields_ = [("dwSize", Coord), ("dwCursorPosition", Coord),
                        ("wAttributes", ctypes.c_ushort), ("srWindow", SmallRect),
                        ("dwMaximumWindowSize", Coord)]

        info = ConsoleScreenBufferInfo()
        kernel32 = ctypes.windll.kernel32
        if not kernel32.GetConsoleScreenBufferInfo(self.console_handle, ctypes.byref(info)):
            self.console_handle = None
            return False
        if self.console_origin is None:
            self.console_origin = (info.dwCursorPosition.X, info.dwCursorPosition.Y)
        x, y = self.console_origin
        if not kernel32.SetConsoleCursorPosition(self.console_handle, Coord(x, y)):
            self.console_handle = None
            return False
        # Do not write into the final visible column: Windows moves to a new
        # row after writing that cell.  The old fixed 120-character padding
        # therefore wrapped in narrow terminals and left a cascade of lines.
        available_width = max(1, info.srWindow.Right - x)
        visible_text = text[:available_width]
        render_width = min(available_width, max(len(visible_text), self.previous_length))
        rendered_text = visible_text.ljust(render_width)
        written = ctypes.c_ulong()
        # Padding only up to the previous message clears stale characters while
        # keeping every update within this one console row.
        if not kernel32.WriteConsoleW(self.console_handle, rendered_text, render_width,
                                      ctypes.byref(written), None):
            self.console_handle = None
            return False
        self.previous_length = render_width
        return True

    def update(self, fraction: float, status: str) -> None:
        if not self.enabled:
            return
        fraction = min(1.0, max(0.0, fraction))
        width = 32
        filled = round(width * fraction)
        bar = "#" * filled + "-" * (width - filled)
        line = f"[{bar}] {fraction:>6.1%}  {status}"
        if not self._windows_write(line):
            # A carriage return works in PowerShell, Windows Terminal, and
            # standard POSIX terminals.  Avoid ANSI erase codes here: some
            # Windows hosts display or mishandle them instead of redrawing.
            render_width = max(len(line), self.previous_length)
            self.stream.write(f"\r{line.ljust(render_width)}")
            self.stream.flush()
            self.previous_length = render_width

    def finish(self) -> None:
        if self.enabled:
            if self.console_handle is not None and self.console_origin is not None:
                class Coord(ctypes.Structure):
                    _fields_ = [("X", ctypes.c_short), ("Y", ctypes.c_short)]

                x, y = self.console_origin
                ctypes.windll.kernel32.SetConsoleCursorPosition(self.console_handle, Coord(0, y + 1))
            else:
                self.stream.write("\n")
                self.stream.flush()


def atomic_number(element: str | int) -> int:
    """Convert an element symbol/name-like input or atomic number to Z."""
    try:
        z = int(element)
    except ValueError:
        key = str(element).strip().lower()
        if key not in SYMBOL_TO_Z:
            raise ValueError(f"Unknown element '{element}'. Use a symbol from H to Og or an atomic number.")
        z = SYMBOL_TO_Z[key]
    if not 1 <= z <= len(ELEMENTS):
        raise ValueError("Atomic number must be between 1 and 118.")
    return z


def electron_configuration(z: int) -> dict[tuple[int, int], int]:
    """Return ground-state subshell populations keyed by (n, l)."""
    remaining, populations = z, {}
    for n, l in AUFBAU:
        count = min(remaining, 2 * (2 * l + 1))
        populations[(n, l)] = count
        remaining -= count
        if remaining == 0:
            break
    if remaining:
        raise ValueError("Aufbau table does not cover this element.")
    overrides = EXCEPTIONS.get(ELEMENTS[z - 1], {})
    for name, count in overrides.items():
        n, letter = int(name[0]), name[1]
        populations[(n, "spdf".index(letter))] = count
    return {key: count for key, count in populations.items() if count}


def slater_effective_charge(z: int, populations: dict[tuple[int, int], int], n: int, l: int) -> float:
    """Approximate Z_eff for the requested subshell using Slater screening rules."""
    screening = 0.0
    if l <= 1:
        for (other_n, other_l), count in populations.items():
            if other_n == n and other_l <= 1:
                screening += (count - 1 if other_l == l else count) * (0.30 if n == 1 else 0.35)
            elif other_n == n - 1:
                screening += count * 0.85
            elif other_n < n - 1:
                screening += count
    else:
        for (other_n, other_l), count in populations.items():
            if other_n == n and other_l == l:
                screening += (count - 1) * 0.35
            elif other_n < n or (other_n == n and other_l < l):
                screening += count
    return max(0.7, z - screening)


def occupied_orbitals(element: str | int) -> list[Orbital]:
    """Select spatial orbitals occupied under Hund's rule (one model per orbital)."""
    z = atomic_number(element)
    populations = electron_configuration(z)
    result: list[Orbital] = []
    # Preserve the conventional Aufbau display order (… 4s, then 3d) rather
    # than sorting only by principal quantum number.
    for n, l in AUFBAU:
        electrons = populations.get((n, l), 0)
        if not electrons:
            continue
        if l not in ORBITAL_NAMES:
            continue
        z_eff = slater_effective_charge(z, populations, n, l)
        names = ORBITAL_NAMES[l]
        # Fill each degenerate spatial orbital once before pairing (Hund's rule).
        for index, (suffix, real_m) in enumerate(names):
            orbital_electrons = 2 if electrons > len(names) and index < electrons - len(names) else 1
            if index >= min(electrons, len(names)):
                break
            result.append(Orbital(f"{n}{suffix}", n, l, real_m, orbital_electrons, z_eff))
    return result


def real_spherical_harmonic(l: int, real_m: int, theta: np.ndarray, phi: np.ndarray) -> np.ndarray:
    """Real normalized spherical harmonic; theta is polar and phi azimuthal angle."""
    if real_m == 0:
        return _complex_spherical_harmonic(0, l, theta, phi).real
    m = abs(real_m)
    complex_y = _complex_spherical_harmonic(m, l, theta, phi)
    if real_m > 0:
        return math.sqrt(2) * (-1) ** m * complex_y.real
    return math.sqrt(2) * (-1) ** m * complex_y.imag


def radial_wavefunction(n: int, l: int, r: np.ndarray, z_eff: float) -> np.ndarray:
    """Normalized hydrogen-like radial function in atomic units (a0 = 1)."""
    rho = 2.0 * z_eff * r / n
    norm = math.sqrt((2.0 * z_eff / n) ** 3 * factorial(n - l - 1) /
                     (2.0 * n * factorial(n + l)))
    return norm * np.exp(-rho / 2) * rho ** l * eval_genlaguerre(n - l - 1, 2 * l + 1, rho)


def radial_density(orbital: Orbital, radius: np.ndarray | float) -> np.ndarray | float:
    """Return |R_nl(r)|², the radial part of the probability density."""
    radial = radial_wavefunction(orbital.n, orbital.l, np.asarray(radius), orbital.z_effective)
    return radial * radial


@lru_cache(maxsize=None)
def angular_lobes(l: int, real_m: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Cos(theta) nodes, local |Y|² peaks, and peak coordinates per polar band.

    Interior zeros of P_l^m are zeros of the Jacobi polynomial P_(l-m)^(m,m).
    All azimuthal sectors of a real harmonic have equal peaks within a band.
    """
    m = abs(real_m)
    nodes = roots_jacobi(l - m, m, m)[0] if l > m else np.empty(0)
    edges = np.r_[-1., nodes, 1.]
    phi = math.pi / (2 * m) if real_m < 0 else 0.
    def value(x):
        return float(real_spherical_harmonic(l, real_m, np.arccos(np.clip(x, -1, 1)), phi) ** 2)
    peaks, positions = [], []
    for low, high in zip(edges[:-1], edges[1:]):
        result = minimize_scalar(lambda x: -value(x), bounds=(low, high), method='bounded',
                                 options={'xatol': 1e-14})
        x = max((low, result.x, high), key=value)
        peaks.append(value(x))
        positions.append(x)
    return nodes, np.array(peaks), np.array(positions)


def angular_density_maximum(l: int, real_m: int) -> float:
    return float(angular_lobes(l, real_m)[1].max())


@lru_cache(maxsize=None)
def radial_lobes(orbital: Orbital) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Radial nodes, physical local density peaks, and peak radii in bohr."""
    count = orbital.n - orbital.l - 1
    nodes_rho = roots_genlaguerre(count, 2 * orbital.l + 1)[0] if count else np.empty(0)
    edges = np.r_[0., nodes_rho, 4 * orbital.n + 2 * orbital.l + 10.]
    scale = orbital.n / (2 * orbital.z_effective)
    def shape(rho):
        return float(rho ** (2 * orbital.l) * np.exp(-rho)
                     * eval_genlaguerre(count, 2 * orbital.l + 1, rho) ** 2)
    positions = []
    for low, high in zip(edges[:-1], edges[1:]):
        result = minimize_scalar(lambda rho: -shape(rho), bounds=(low, high), method='bounded',
                                 options={'xatol': 1e-13})
        positions.append(max((low, result.x, high), key=shape) * scale)
    positions = np.array(positions)
    return nodes_rho * scale, radial_density(orbital, positions), positions


def outer_radial_lobe_density_maximum(orbital: Orbital) -> float:
    return float(radial_lobes(orbital)[1][-1])


@lru_cache(maxsize=512)
def radial_contour_bounds(orbital: Orbital, isovalue: float) -> tuple[tuple[float, float], ...]:
    """Radial intervals enclosing every lobe at its own relative peak cutoff."""
    nodes, peaks, positions = radial_lobes(orbital)
    bounds = []
    for i, (peak, position) in enumerate(zip(peaks, positions)):
        low = nodes[i - 1] if i else 0.
        high = nodes[i] if i < len(nodes) else max(position * 2, orbital.n / orbital.z_effective)
        def contour(r):
            return float(radial_density(orbital, r) / peak - isovalue)
        while contour(high) > 0:
            high *= 2
        inner = low if contour(low) >= 0 else brentq(contour, low, position)
        outer = brentq(contour, position, high)
        bounds.append((inner, outer))
    return tuple(bounds)


def contour_parameters(orbital: Orbital, isovalue: float) -> tuple[float, float]:
    """Common reference threshold after every connected lobe is normalized."""
    angular_maximum = angular_density_maximum(orbital.l, orbital.real_m)
    maximum_density = outer_radial_lobe_density_maximum(orbital) * angular_maximum
    threshold = maximum_density * isovalue
    outer_radius = radial_contour_bounds(orbital, isovalue)[-1][1]
    return threshold, outer_radius * 1.0001


def adaptive_grid_resolution(orbital: Orbital, requested_resolution: int) -> int:
    """Raise volume-estimation detail for orbitals with more angular structure."""
    return max(requested_resolution, 64 + 20 * orbital.l)


def probability_density(orbital: Orbital, positions: np.ndarray) -> np.ndarray:
    """Evaluate |psi|² at arbitrary Cartesian positions in atomic units."""
    x, y, z = positions.T
    r = np.sqrt(x * x + y * y + z * z)
    theta = np.zeros_like(r)
    nonzero = r > 1e-14
    theta[nonzero] = np.arccos(np.clip(z[nonzero] / r[nonzero], -1.0, 1.0))
    phi = np.arctan2(y, x)
    psi = radial_wavefunction(orbital.n, orbital.l, r, orbital.z_effective)
    psi *= real_spherical_harmonic(orbital.l, orbital.real_m, theta, phi)
    return psi * psi


def contour_density(orbital: Orbital, positions: np.ndarray,
                    density: np.ndarray | None = None) -> np.ndarray:
    """Normalize each radial/polar nodal region; physical |psi|² is unchanged.

    Real harmonics are separable in radius, cos(theta), and azimuth. The latter
    has equally strong sectors, so radial and polar peak factors normalize
    every connected lobe, including rings and inner shells, without moving nodes.
    """
    if density is None:
        density = probability_density(orbital, positions.reshape(-1, 3)).reshape(positions.shape[:-1])
    radius = np.linalg.norm(positions, axis=-1)
    cosine = np.divide(positions[..., 2], radius, out=np.zeros_like(radius), where=radius > 0)
    radial_nodes, radial_peaks, _ = radial_lobes(orbital)
    polar_nodes, polar_peaks, _ = angular_lobes(orbital.l, orbital.real_m)
    radial_scale = radial_peaks[-1] / radial_peaks[np.searchsorted(radial_nodes, radius)]
    polar_scale = polar_peaks.max() / polar_peaks[np.searchsorted(polar_nodes, cosine)]
    return density * radial_scale * polar_scale


def lobe_ids(orbital: Orbital, positions: np.ndarray) -> np.ndarray:
    """Stable connected-lobe indices, from radial/polar nodes and azimuth sectors."""
    radius = np.linalg.norm(positions, axis=-1)
    cosine = np.divide(positions[..., 2], radius, out=np.zeros_like(radius), where=radius > 0)
    polar_nodes = angular_lobes(orbital.l, orbital.real_m)[0]
    radial = np.searchsorted(radial_lobes(orbital)[0], radius)
    polar = np.searchsorted(polar_nodes, cosine)
    sectors = max(1, 2 * abs(orbital.real_m))
    start = -math.pi / sectors if orbital.real_m > 0 else 0.
    phi = (np.arctan2(positions[..., 1], positions[..., 0]) - start) % (2 * math.pi)
    sector = np.minimum((phi * sectors / (2 * math.pi)).astype(int), sectors - 1)
    return (radial * (len(polar_nodes) + 1) + polar) * sectors + sector


def lobe_count(orbital: Orbital) -> int:
    return (orbital.n - orbital.l) * (orbital.l - abs(orbital.real_m) + 1) * max(1, 2 * abs(orbital.real_m))


def lobe_candidates(orbital: Orbital, isovalue: float, index: int,
                    draws: np.ndarray) -> np.ndarray:
    """Uniform-volume proposals within one radial/polar/azimuthal sector."""
    polar_edges = np.r_[-1., angular_lobes(orbital.l, orbital.real_m)[0], 1.]
    sectors = max(1, 2 * abs(orbital.real_m))
    start = -math.pi / sectors if orbital.real_m > 0 else 0.
    radial, angular = divmod(index, (len(polar_edges) - 1) * sectors)
    polar, sector = divmod(angular, sectors)
    inner, outer = radial_contour_bounds(orbital, isovalue)[radial]
    r = np.cbrt(inner ** 3 + draws[:, 0] * (outer ** 3 - inner ** 3))
    cosine = polar_edges[polar] + draws[:, 1] * (polar_edges[polar + 1] - polar_edges[polar])
    phi = start + (sector + draws[:, 2]) * 2 * math.pi / sectors
    xy = r * np.sqrt(np.maximum(0., 1 - cosine * cosine))
    return np.column_stack((xy * np.cos(phi), xy * np.sin(phi), r * cosine))


def ensure_lobe_points(orbital: Orbital, points: np.ndarray, isovalue: float,
                       seed: int, minimum: int = 16) -> np.ndarray:
    """Retain the uniform baseline and top up tiny lobes it may undersample."""
    total = lobe_count(orbital)
    counts = np.bincount(lobe_ids(orbital, points), minlength=total)
    threshold = contour_parameters(orbital, isovalue)[0]
    additions = [points]
    for index, count in enumerate(counts):
        remaining = minimum - count
        if remaining <= 0:
            continue
        sampler = qmc.Sobol(3, scramble=True, seed=int(np.random.SeedSequence([seed, index, 0x10BE]).generate_state(1)[0]))
        while remaining > 0:
            draws = sampler.random(1024)
            candidates = lobe_candidates(orbital, isovalue, index, draws)
            accepted = candidates[contour_density(orbital, candidates) >= threshold][:remaining]
            additions.append(accepted)
            remaining -= len(accepted)
    return np.concatenate(additions)


def _density_grid(orbital: Orbital, resolution: int, radius: float | None = None) -> tuple[np.ndarray, np.ndarray, float]:
    """Evaluate density on a cubic grid enclosing the requested orbital region."""
    if radius is None:
        radius = max(5.0, 10.0 * orbital.n * orbital.n / orbital.z_effective)
    axis = np.linspace(-radius, radius, resolution, dtype=np.float64)
    x, y, z = np.meshgrid(axis, axis, axis, indexing="ij")
    coordinates = np.stack((x, y, z), axis=-1)
    return coordinates, probability_density(orbital, coordinates.reshape(-1, 3)).reshape(x.shape), axis[1] - axis[0]


@dataclass
class BorderPlan:
    areas: np.ndarray
    expected: np.ndarray


def border_coverage_targets(areas: np.ndarray, reference_points: float) -> np.ndarray:
    """Balance surface fill (area) and outline continuity (linear size).

    Their geometric mean scales as area**0.75. This is a display heuristic:
    small lobes get denser coverage without a size-independent point floor.
    The largest surface retains the reference highlight budget.
    """
    return reference_points * (areas / areas.max()) ** BORDER_AREA_EXPONENT


@dataclass
class BorderProfile:
    """Approximate geometric depth, normalized separately in each connected region."""

    distance: np.ndarray
    region_depth: np.ndarray
    radius: float
    spacing: float
    areas: np.ndarray
    volumes: np.ndarray
    interior_ids: np.ndarray
    interior_gradients: np.ndarray
    plan: BorderPlan | None = None

    def statistics(self, multiplier: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        excess = np.expm1(math.log(multiplier) * self.interior_gradients)
        weights = np.bincount(self.interior_ids, weights=excess, minlength=len(self.areas)) * self.spacing**3
        return self.areas, self.volumes, weights

    def gradient(self, positions: np.ndarray) -> np.ndarray:
        indices = ((positions + self.radius) / self.spacing).T
        distance = ndimage.map_coordinates(self.distance, indices, order=1,
                                          mode="nearest", prefilter=False)
        depth = ndimage.map_coordinates(self.region_depth, indices, order=0,
                                       mode="nearest", prefilter=False)
        return np.clip(1.0 - distance / (0.2 * depth), 0.0, 1.0)


def _region_level_grid(orbital: Orbital, resolution: int, radius: float,
                       threshold: float, radial_index: int) -> tuple[np.ndarray, float]:
    """Continuous contour level in one radial region, at that region's scale."""
    coordinates, density, spacing = _density_grid(orbital, resolution, radius)
    level = contour_density(orbital, coordinates, density) / threshold - 1.
    nodes = radial_lobes(orbital)[0]
    if len(nodes):
        r = np.linalg.norm(coordinates, axis=-1)
        level[np.searchsorted(nodes, r) != radial_index] = -1.
    return level, spacing


def _region_grid(orbital: Orbital, resolution: int, radius: float,
                 threshold: float, radial_index: int) -> tuple[np.ndarray, float]:
    level, spacing = _region_level_grid(orbital, resolution, radius, threshold, radial_index)
    return level >= 0, spacing


def contour_surface_areas(orbital: Orbital, level: np.ndarray,
                          radius: float, spacing: float) -> np.ndarray:
    """Areas of the continuous zero contour, triangulating cut grid tetrahedra.

    Interpolating the scalar field avoids counting voxel faces, which would
    bias the area according to surface orientation. Both sides of shells and
    the complete toroidal surface are included.
    """
    corners = np.array([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
                        [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]])
    positive = level >= 0
    origin = positive[:-1, :-1, :-1]
    crossing = np.zeros_like(origin)
    shape = np.array(origin.shape)
    for corner in corners[1:]:
        slices = tuple(slice(int(c), int(c+s)) for c, s in zip(corner, shape))
        crossing |= positive[slices] != origin
    cells = np.argwhere(crossing)
    values = np.stack([level[tuple((cells + corner).T)] for corner in corners], axis=1)
    areas = np.zeros(lobe_count(orbital))
    tetrahedra = [(0, 1, 2, 6), (0, 2, 3, 6), (0, 3, 7, 6),
                  (0, 7, 4, 6), (0, 4, 5, 6), (0, 5, 1, 6)]
    for tetrahedron in tetrahedra:
        tetrahedron = np.array(tetrahedron)
        field = values[:, tetrahedron]
        cases = ((field >= 0) * np.array([1, 2, 4, 8])).sum(axis=1)
        for case in range(1, 15):
            selected = cases == case
            if not selected.any():
                continue
            inside = [i for i in range(4) if case & (1 << i)]
            outside = [i for i in range(4) if not case & (1 << i)]
            if len(inside) == 3:
                inside, outside = outside, inside
            intersections = []
            for a in inside:
                for b in outside:
                    fraction = field[selected, a] / (field[selected, a] - field[selected, b])
                    offset = corners[tetrahedron[a]] + fraction[:, None] * (
                        corners[tetrahedron[b]] - corners[tetrahedron[a]])
                    intersections.append((cells[selected] + offset) * spacing - radius)
            triangles = [(0, 1, 2)] if len(intersections) == 3 else [(0, 1, 2), (1, 3, 2)]
            for a, b, c in triangles:
                p, q, r = intersections[a], intersections[b], intersections[c]
                area = np.linalg.norm(np.cross(q-p, r-p), axis=1) * .5
                ids = lobe_ids(orbital, (p+q+r) / 3)
                areas += np.bincount(ids, weights=area, minlength=len(areas))
    return areas


def _border_profile_region(orbital: Orbital, threshold: float, outer_radius: float,
                           radial_index: int = 0) -> BorderProfile:
    """Include cavity surfaces as well as exterior surfaces in the distance field.

    A fixed grid keeps highlighting independent of the volume --resolution.
    Signed distances interpolate through zero between inside/outside voxels;
    nearest-region extension supplies a depth even for continuous interior
    points whose nearest grid vertex happens to be outside the contour.
    """
    resolution = 128 + 32 * orbital.l
    radius = outer_radius * 1.05
    level, spacing = _region_level_grid(orbital, resolution, radius, threshold, radial_index)
    areas = contour_surface_areas(orbital, level, radius, spacing)
    mask = level >= 0
    del level
    labels, count = ndimage.label(mask)
    if count == 0:
        raise RuntimeError(f"Border grid could not resolve {orbital.label}; lower --isovalue.")
    inside_distance = ndimage.distance_transform_edt(mask, sampling=spacing)
    inside_distance -= spacing / 2.0
    depths = np.zeros(count + 1)
    depths[1:] = ndimage.maximum(inside_distance, labels, np.arange(1, count + 1))
    outside_distance, nearest_inside = ndimage.distance_transform_edt(
        ~mask, sampling=spacing, return_indices=True)
    region_depth = depths[labels[tuple(nearest_inside)]].astype(np.float32)
    interior_ids = lobe_ids(orbital, np.argwhere(mask) * spacing - radius)
    volumes = np.bincount(interior_ids, minlength=len(areas)) * spacing**3
    interior_gradients = np.clip(1 - inside_distance[mask] / (0.2 * depths[labels[mask]]), 0, 1)
    del nearest_inside, labels
    inside_distance[~mask] = -(outside_distance[~mask] - spacing / 2.0)
    return BorderProfile(inside_distance.astype(np.float32), region_depth, radius, spacing,
                         areas, volumes, interior_ids, interior_gradients)


class RadialBorderProfiles:
    """Build shell-specific distance fields lazily, so inner shells are resolved."""
    def __init__(self, orbital: Orbital, threshold: float) -> None:
        self.orbital = orbital
        self.threshold = threshold
        self.profiles: dict[int, BorderProfile] = {}
        self.plan: BorderPlan | None = None
        isovalue = threshold / (outer_radial_lobe_density_maximum(orbital)
                               * angular_density_maximum(orbital.l, orbital.real_m))
        self.bounds = radial_contour_bounds(orbital, isovalue)

    def _profile(self, index: int) -> BorderProfile:
        if index not in self.profiles:
            self.profiles[index] = _border_profile_region(
                self.orbital, self.threshold, self.bounds[index][1] * 1.0001, index)
        return self.profiles[index]

    def statistics(self, multiplier: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        return tuple(np.sum(parts, axis=0) for parts in zip(*(
            self._profile(index).statistics(multiplier) for index in range(len(self.bounds)))))

    def gradient(self, positions: np.ndarray) -> np.ndarray:
        indices = np.searchsorted(radial_lobes(self.orbital)[0], np.linalg.norm(positions, axis=-1))
        result = np.empty(len(positions))
        for index in np.unique(indices):
            selected = indices == index
            result[selected] = self._profile(int(index)).gradient(positions[selected])
        return result


def border_profile(orbital: Orbital, threshold: float, outer_radius: float) -> BorderProfile | RadialBorderProfiles:
    if len(radial_lobes(orbital)[0]):
        return RadialBorderProfiles(orbital, threshold)
    return _border_profile_region(orbital, threshold, outer_radius)


def highlight_lobes(orbital: Orbital, baseline: np.ndarray, isovalue: float,
                     seed: int, multiplier: float,
                     profile: BorderProfile | RadialBorderProfiles,
                     report: Callable[[float, str], None]) -> tuple[np.ndarray, int]:
    """Balance border coverage across different lobe sizes.

    The largest surface anchors the requested highlight strength. Other lobes
    receive area**0.75-proportional counts, sampled with the same exponential depth
    profile. One point is retained for sub-point budgets; there is no fixed
    large minimum or special inner-lobe boost.
    """
    if not math.isfinite(len(baseline) * (multiplier - 1.0)):
        raise ValueError("border_highlight produces too many point proposals.")
    threshold = contour_parameters(orbital, isovalue)[0]
    ids = lobe_ids(orbital, baseline)
    counts = np.bincount(ids, minlength=lobe_count(orbital))
    report(0.67, f"Measuring lobe surfaces: {orbital.label}")
    areas, volumes, weights = profile.statistics(multiplier)
    if np.any(areas <= 0) or np.any(volumes <= 0):
        raise RuntimeError(f"Border grid could not resolve every lobe of {orbital.label}.")
    reference = int(np.argmax(areas))
    reference_points = counts[reference] / volumes[reference] * weights[reference]
    expected = border_coverage_targets(areas, reference_points)
    if not np.isfinite(expected).all() or np.any(expected >= np.iinfo(np.intp).max):
        raise ValueError("border_highlight produces too many points.")
    budgets = np.maximum(1, np.rint(expected)).astype(int)
    profile.plan = BorderPlan(areas, expected)
    additions = []
    log_highlight = math.log(multiplier)
    for index, budget in enumerate(budgets):
        border_seed = int(np.random.SeedSequence([seed, index, 0xB04D]).generate_state(1)[0])
        sampler = qmc.Sobol(d=4, scramble=True, seed=border_seed)
        added = 0
        report(0.70 + 0.28 * index / len(counts),
               f"Highlighting lobe {index + 1}/{len(counts)}: {orbital.label}")
        while added < budget:
            draws = sampler.random(1024)
            candidates = lobe_candidates(orbital, isovalue, index, draws)
            inside = contour_density(orbital, candidates) >= threshold
            candidates, trials = candidates[inside], draws[inside, 3]
            if not len(candidates):
                continue
            t = profile.gradient(candidates)
            probability = np.expm1(log_highlight * t) / (multiplier - 1.0)
            points = candidates[trials < probability][:budget - added]
            additions.append(points)
            added += len(points)
    return np.concatenate(additions), int(np.count_nonzero(expected < .5))


def sample_orbital(orbital: Orbital, points_per_orbital: int, resolution: int,
                   isovalue: float, rng: np.random.Generator | None,
                   report_progress: Callable[[float, str], None] | None = None,
                   border_highlight: float = DEFAULT_BORDER_HIGHLIGHT,
                   *, sampler_seed: int | None = None) -> OrbitalResult:
    """Uniformly fill an orbital, optionally adding an exponential border fill."""
    if not math.isfinite(border_highlight) or border_highlight < 1.0:
        raise ValueError("border_highlight must be finite and at least 1.")
    report = report_progress or (lambda _fraction, _status: None)
    report(0.02, f"Calculating contour: {orbital.label}")
    threshold, outer_radius = contour_parameters(orbital, isovalue)
    grid_resolution = adaptive_grid_resolution(orbital, resolution)
    # Separate radial grids prevent tiny inner lobes from disappearing in a
    # large outer shell's voxel spacing. Angular components share each grid.
    volume_bohr3 = 0.
    for index, (_, bound) in enumerate(radial_contour_bounds(orbital, isovalue)):
        mask, spacing = _region_grid(orbital, grid_resolution, bound * 1.002, threshold, index)
        volume_bohr3 += float(mask.sum() * spacing ** 3)
    del mask
    report(0.30, f"Defining boundary: {orbital.label}")
    if not volume_bohr3:
        raise RuntimeError(f"No volume remained for {orbital.label}; lower --isovalue.")
    volume_angstrom3 = volume_bohr3 * BOHR_TO_ANGSTROM ** 3
    # Sample uniformly in the enclosing rectangular box with a scrambled Sobol
    # sequence, then reject points outside the normalized display region. Sobol points
    # are low-discrepancy: they cover the volume far more evenly than ordinary
    # independent random choices, while retaining exactly the requested count.
    # The exact continuous radial bound, rather than the grid-cell extent,
    # determines where candidates are generated. Therefore --resolution cannot
    # change the displayed orbital shape.
    lower = np.full(3, -outer_radius)
    upper = np.full(3, outer_radius)
    bounding_volume = float(np.prod(upper - lower))
    fill_ratio = min(1.0, volume_bohr3 / bounding_volume)
    if sampler_seed is None:
        if rng is None:
            raise ValueError("rng is required when sampler_seed is not supplied.")
        sampler_seed = int(rng.integers(0, 2**32 - 1))
    sampler = qmc.Sobol(d=3, scramble=True, seed=sampler_seed)
    accepted: list[np.ndarray] = []
    count = 0
    while count < points_per_orbital:
        remaining = points_per_orbital - count
        candidate_count = max(1024, math.ceil(remaining * 1.25 / max(fill_ratio, 1e-4)))
        # Sobol sequences have their best balance when generated in powers of 2.
        candidate_count = 1 << math.ceil(math.log2(candidate_count))
        candidates = qmc.scale(sampler.random(candidate_count), lower, upper)
        candidate_density = contour_density(orbital, candidates)
        inside = candidates[candidate_density >= threshold]
        if len(inside):
            taken = min(len(inside), remaining)
            accepted.append(inside[:taken])
            count += min(len(inside), remaining)
            report(0.30 + (0.35 if border_highlight > 1 else 0.68) * count / points_per_orbital,
                   f"Filling cloud: {orbital.label} ({count:,}/{points_per_orbital:,})")
    report(0.65 if border_highlight > 1 else 0.98, f"Ensuring every lobe is represented: {orbital.label}")
    baseline = ensure_lobe_points(orbital, np.concatenate(accepted), isovalue, sampler_seed)
    support_points = len(baseline) - points_per_orbital
    border_support_points = 0
    border_areas = None
    border_targets = None
    accepted = [baseline]
    if border_highlight > 1.0:
        report(0.66, f"Measuring boundary distances: {orbital.label}")
        profile = border_profile(orbital, threshold, outer_radius)
        border_points, border_support_points = highlight_lobes(
            orbital, baseline, isovalue, sampler_seed, border_highlight, profile, report)
        accepted.append(border_points)
        border_areas = profile.plan.areas.tolist()
        border_targets = profile.plan.expected.tolist()
    points_bohr = np.concatenate(accepted, axis=0)
    report(1.0, f"Completed orbital: {orbital.label}")
    return OrbitalResult(
        orbital=orbital,
        points=points_bohr * BOHR_TO_ANGSTROM,
        volume_bohr3=volume_bohr3,
        volume_angstrom3=volume_angstrom3,
        lobe_support_points=support_points,
        border_support_points=border_support_points,
        border_surface_areas_bohr2=border_areas,
        border_target_point_counts=border_targets,
    )


def _sample_orbital_worker(task: tuple[int, Orbital, int, int, float, float, int]
                           ) -> tuple[int, OrbitalResult]:
    """Run one independent orbital calculation in a worker process."""
    index, orbital, points, resolution, isovalue, border_highlight, sampler_seed = task
    result = sample_orbital(
        orbital, points, resolution, isovalue, None,
        border_highlight=border_highlight, sampler_seed=sampler_seed,
    )
    return index, result


def _sample_orbitals_parallel(
        orbitals: list[Orbital], points_per_orbital: int, resolution: int,
        isovalue: float, border_highlight: float, sampler_seeds: list[int],
        progress: TerminalProgress, total_phases: int, max_workers: int | None,
) -> tuple[list[OrbitalResult], int]:
    """Use all detected CPUs by default, without memory-based throttling."""
    worker_count = min(len(orbitals), max_workers if max_workers is not None else (os.cpu_count() or 1))
    tasks = [
        (index, orbital, points_per_orbital, resolution, isovalue,
         border_highlight, sampler_seeds[index])
        for index, orbital in enumerate(orbitals)
    ]
    results: list[OrbitalResult | None] = [None] * len(orbitals)
    progress.update(
        0.0,
        f"Parallel generation ({worker_count} workers, no RAM cap)",
    )
    with ProcessPoolExecutor(max_workers=worker_count) as executor:
        futures = [executor.submit(_sample_orbital_worker, task) for task in tasks]
        for completed, future in enumerate(as_completed(futures), start=1):
            index, result = future.result()
            results[index] = result
            progress.update(
                completed / total_phases,
                f"Completed orbital {completed}/{len(orbitals)}: {result.orbital.label} ({worker_count} workers)",
            )

    if any(result is None for result in results):
        raise RuntimeError("Parallel generation ended before every orbital completed.")
    return [result for result in results if result is not None], worker_count


def _export_obj(path: Path, vertices: np.ndarray, colors: np.ndarray) -> None:
    with path.open("w", encoding="utf-8") as stream:
        stream.write("# Atomic orbital point cloud; vertices are in angstroms\n")
        for vertex, color in zip(vertices, colors, strict=True):
            r, g, b = color[:3] / 255.0
            stream.write(f"v {vertex[0]:.8f} {vertex[1]:.8f} {vertex[2]:.8f} {r:.5f} {g:.5f} {b:.5f}\n")
        stream.write("p " + " ".join(str(i) for i in range(1, len(vertices) + 1)) + "\n")


def set_gltf_vertex_buffer_targets(path: Path) -> None:
    """Mark glTF POSITION/COLOR buffers as ARRAY_BUFFER for strict validators.

    Trimesh writes valid buffer views but leaves their optional `target` field
    unset. Some glTF validators emit BUFFER_VIEW_TARGET_MISSING hints for that
    layout. The point clouds contain only vertex attributes, so target 34962
    (WebGL ARRAY_BUFFER) is the correct explicit value.
    """
    def update_document(document: dict[str, object]) -> None:
        accessors = document.get("accessors", [])
        buffer_views = document.get("bufferViews", [])
        for mesh in document.get("meshes", []):
            for primitive in mesh.get("primitives", []):
                for accessor_index in primitive.get("attributes", {}).values():
                    buffer_view_index = accessors[accessor_index].get("bufferView")
                    if buffer_view_index is not None:
                        buffer_views[buffer_view_index]["target"] = 34962  # ARRAY_BUFFER

    if path.suffix.lower() == ".gltf":
        document = json.loads(path.read_text(encoding="utf-8"))
        update_document(document)
        path.write_text(json.dumps(document, separators=(",", ":")), encoding="utf-8")
        return

    # GLB consists of a 12-byte header followed by JSON and BIN chunks. Rebuild
    # it because adding `target` changes the length of the compact JSON chunk.
    data = path.read_bytes()
    magic, version, _length = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67 or version != 2:
        raise ValueError(f"{path} is not a glTF 2.0 binary file.")
    chunks: list[tuple[int, bytes]] = []
    offset = 12
    while offset < len(data):
        chunk_length, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        chunks.append((chunk_type, data[offset:offset + chunk_length]))
        offset += chunk_length
    json_type = 0x4E4F534A
    for index, (chunk_type, content) in enumerate(chunks):
        if chunk_type == json_type:
            document = json.loads(content.decode("utf-8").rstrip(" \t\r\n\0"))
            update_document(document)
            encoded = json.dumps(document, separators=(",", ":")).encode("utf-8")
            chunks[index] = (json_type, encoded + b" " * ((-len(encoded)) % 4))
            break
    else:
        raise ValueError(f"{path} has no JSON chunk.")
    rebuilt = bytearray(struct.pack("<III", magic, version, 0))
    for chunk_type, content in chunks:
        rebuilt.extend(struct.pack("<II", len(content), chunk_type))
        rebuilt.extend(content)
    struct.pack_into("<I", rebuilt, 8, len(rebuilt))
    path.write_bytes(rebuilt)


def export_point_cloud(output: Path, results: Iterable[OrbitalResult]) -> None:
    """Export point clouds, using named orbital nodes in GLB/GLTF scenes."""
    results = list(results)
    vertices = np.concatenate([result.points for result in results])
    color_groups = []
    for result in results:
        base = L_COLORS[result.orbital.l]
        color_groups.append(np.repeat(base[None, :], len(result.points), axis=0))
    colors = np.concatenate(color_groups)
    suffix = output.suffix.lower()
    if suffix == ".obj":
        _export_obj(output, vertices, colors)
        return
    if suffix == ".xyz":
        with output.open("w", encoding="utf-8") as stream:
            stream.write(f"{len(vertices)}\nMerged atomic-orbital point cloud; coordinates in angstroms\n")
            for vertex in vertices:
                stream.write(f"X {vertex[0]:.8f} {vertex[1]:.8f} {vertex[2]:.8f}\n")
        return
    if suffix not in {".ply", ".glb", ".gltf"}:
        raise ValueError("Output format must be .glb, .gltf, .ply, .obj, or .xyz")
    import trimesh

    if suffix == ".ply":
        cloud = trimesh.points.PointCloud(vertices=vertices, colors=colors)
        cloud.export(output)
        return

    # Preserve each orbital as a separately named glTF node. GLB/glTF viewers
    # can then expose a scene tree for selecting, showing, or hiding `2px`,
    # `3dz2`, and other individual clouds without parsing point ranges.
    scene = trimesh.Scene()
    color_offset = 0
    for result in results:
        point_count = len(result.points)
        cloud = trimesh.points.PointCloud(
            vertices=result.points,
            colors=colors[color_offset:color_offset + point_count],
        )
        scene.add_geometry(cloud, node_name=result.orbital.label, geom_name=result.orbital.label)
        color_offset += point_count
    if suffix == ".glb":
        scene.export(output)
    else:  # .gltf
        # Embedded buffers make a .gltf export self-contained, just like GLB,
        # and prevent generic gltf_buffer_*.bin files from colliding.
        scene.export(output, embed_buffers=True)
    set_gltf_vertex_buffer_targets(output)


def build_model(element: str | int, output: Path, points_per_orbital: int = 2_000,
                resolution: int = 72, isovalue: float = DEFAULT_ISOVALUE, seed: int | None = 7,
                show_progress: bool = True, border_highlight: float = DEFAULT_BORDER_HIGHLIGHT,
                parallel: bool = False, max_workers: int | None = None) -> list[OrbitalResult]:
    """Generate all occupied spatial orbitals and write one merged point-cloud file."""
    if points_per_orbital < 1 or resolution < 16 or not 0 < isovalue < 1:
        raise ValueError("points must be positive, resolution >= 16, and isovalue must be in (0, 1).")
    if not math.isfinite(border_highlight) or border_highlight < 1.0:
        raise ValueError("border_highlight must be finite and at least 1.")
    if max_workers is not None and max_workers < 1:
        raise ValueError("max_workers must be at least 1.")
    rng = np.random.default_rng(seed)
    orbitals = occupied_orbitals(element)
    sampler_seeds = [int(rng.integers(0, 2**32 - 1)) for _ in orbitals]
    total_phases = len(orbitals) + 1  # one final phase is reserved for file export
    progress = TerminalProgress(show_progress)
    progress.update(0.0, f"Preparing {ELEMENTS[atomic_number(element) - 1]} orbitals")
    parallel_workers = 1
    if parallel:
        results, parallel_workers = _sample_orbitals_parallel(
            orbitals, points_per_orbital, resolution, isovalue, border_highlight,
            sampler_seeds, progress, total_phases, max_workers,
        )
    else:
        results = []
        for index, orbital in enumerate(orbitals):
            def report(local_fraction: float, status: str, phase: int = index) -> None:
                progress.update((phase + local_fraction) / total_phases, status)

            results.append(sample_orbital(
                orbital, points_per_orbital, resolution, isovalue, None, report,
                border_highlight=border_highlight, sampler_seed=sampler_seeds[index],
            ))
    output.parent.mkdir(parents=True, exist_ok=True)
    progress.update(len(orbitals) / total_phases, f"Writing {output.name}")
    export_point_cloud(output, results)
    metadata = {
        "element": ELEMENTS[atomic_number(element) - 1],
        "atomic_number": atomic_number(element),
        "units": {"coordinates": "angstrom", "volume": "bohr^3 and angstrom^3"},
        "method": {
            "radial": "hydrogen-like radial functions with Slater-rule Z_eff",
            "angular": "real normalized spherical harmonics",
            "colours": "s=red, p=yellow, d=cyan, f=green",
            "contour": "every radial and angular nodal region normalized to its own peak (s, p, d, f)",
            "volume": "adaptive voxel estimate per radial region above the lobe-normalized display cutoff",
            "lobe_normalization": "local radial peak times local polar peak; azimuthal sectors have equal peaks",
            "interpretation": "display normalization only; physical probability density and nodes are unchanged",
            "minimum_points_per_lobe": 16,
            "lobe_sampling": "uniform baseline plus support points where needed to reach 16 in every connected lobe",
            "isovalue": isovalue,
            "baseline_points_per_orbital": points_per_orbital,
            "border_highlight": border_highlight,
            "border_gradient": "within each lobe, sample proportional to H**t-1; t=clip(1-distance/(0.2*lobe_depth), 0, 1)",
            "border_sampling": "visual coverage proportional to surface_area**0.75, balancing surface fill and outline continuity; preserve baseline",
            "border_area_exponent": BORDER_AREA_EXPONENT,
            "border_surface_area": "marching tetrahedra of the continuous contour, including all inner and outer surfaces",
            "minimum_border_points_per_lobe": int(border_highlight > 1),
            "border_distance_grid": "128 + 32*l per axis per radial region, independent of volume resolution; approximate signed Euclidean distance",
            "grid_resolution": resolution,
            "adaptive_volume_grid": "max(requested resolution, 64 + 20*l) per orbital",
            "gltf_orbital_nodes": "GLB/glTF exports contain one named point-cloud node per orbital",
            "generation_mode": "parallel" if parallel else "serial",
            "parallel_workers": parallel_workers,
        },
        "orbitals": [{**asdict(result.orbital), "volume_bohr3": result.volume_bohr3,
                      "volume_angstrom3": result.volume_angstrom3,
                      "point_count": len(result.points),
                      "lobe_support_points": result.lobe_support_points,
                      "border_support_points": result.border_support_points,
                      "border_surface_areas_bohr2": result.border_surface_areas_bohr2,
                      "border_target_point_counts": result.border_target_point_counts,
                      "border_point_counts": np.bincount(lobe_ids(result.orbital,
                          result.points[points_per_orbital + result.lobe_support_points:] / BOHR_TO_ANGSTROM),
                          minlength=lobe_count(result.orbital)).tolist(),
                      "connected_lobes": lobe_count(result.orbital),
                      "lobe_point_counts": np.bincount(lobe_ids(result.orbital, result.points / BOHR_TO_ANGSTROM),
                                                       minlength=lobe_count(result.orbital)).tolist(),
                      "radial_nodes_bohr": radial_lobes(result.orbital)[0].tolist(),
                      "radial_peak_densities": radial_lobes(result.orbital)[1].tolist(),
                      "polar_nodes_cos_theta": angular_lobes(result.orbital.l, result.orbital.real_m)[0].tolist(),
                      "polar_peak_densities": angular_lobes(result.orbital.l, result.orbital.real_m)[1].tolist(),
                      } for result in results],
    }
    metadata_path = output.parent / "json" / output.with_suffix(".json").name
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    progress.update(1.0, "Complete")
    progress.finish()
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="Export occupied atomic orbitals as one point-cloud model. Border highlighting is always enabled at strength 5.")
    parser.add_argument("element", nargs="?", help="Element symbol (e.g. C, Cr) or atomic number")
    parser.add_argument("--output", "-o", type=Path, default=None,
                        help="Output .glb, .gltf, .ply, .obj, or .xyz file (default: output/<Symbol>.glb)")
    parser.add_argument("--points", type=int, default=2_000,
                        help="Baseline points per occupied orbital, before lobe-support and border additions (default: 2000)")
    parser.add_argument("--resolution", type=int, default=72,
                        help="Density-grid resolution per axis (at least 16; default: 72)")
    parser.add_argument("--isovalue", type=float, default=DEFAULT_ISOVALUE,
                        help="Relative display-density boundary; every radial/angular lobe normalized separately (0 < value < 1; default 0.5)")
    parser.add_argument("--no-progress", action="store_true",
                        help="Disable the live terminal progress bar")
    parser.add_argument("--parallel", action="store_true",
                        help="Generate independent orbitals in parallel using all detected CPUs, without a RAM cap")
    parser.add_argument("--workers", type=int, default=None,
                        help="Optional worker count override (default: all detected CPUs, up to the number of orbitals)")
    parser.add_argument("--open", "--view", dest="open_viewer", action="store_true",
                        help="Open the viewer, or open the generated GLB/glTF after generation")
    parser.add_argument("--seed", type=int, default=7, help="Random seed; use a different value for a new fill")
    parser.add_argument("--info", action="store_true",
                        help="Display all input options, defaults, and examples, then exit")
    args = parser.parse_args()
    if args.info:
        print("\nAtomic orbital generator input options\n")
        print("element")
        print("  Required for generation. Element symbol (for example C, Fe, Cr) or atomic number (1–118).\n")
        print("--output, -o FILE")
        print("  Output path. Bare filenames are written to output/. Formats: .glb, .gltf, .ply, .obj, .xyz.")
        print("  If omitted, the default is output/<Symbol>.glb (for example output/Xe.glb).")
        print("\n")
        print("--points NUMBER")
        print("  Baseline points per occupied orbital, before lobe-support and border additions (default: 2000).\n")
        print("Border highlighting")
        print("  Always enabled at strength 5. Adds points near every boundary.")
        print("  Exponential excess H**t-1 over the outer 20% of each lobe's maximum depth.")
        print("  Lobe budgets balance surface fill and outline continuity using surface area to the power 0.75.")
        print("  Counts are rounded to whole points, with one point for sub-point budgets.\n")
        print("--isovalue NUMBER")
        print("  Relative display-density cutoff: 0 < value < 1 (default: 0.5).")
        print("  Every radial/angular lobe uses its own peak density, preserving weaker lobes at 0.5.")
        print("  Tiny lobes receive extra support points if needed to reach 16 points per lobe.\n")
        print("--resolution INTEGER")
        print("  Density-grid resolution per axis; at least 16 (default: 72).\n")
        print("--seed INTEGER")
        print("  Reproducible point-placement seed (default: 7).\n")
        print("--no-progress")
        print("  Hide the terminal progress bar.\n")
        print("--parallel")
        print("  Generate independent orbitals using all detected CPUs.")
        print("  No application RAM cap or native-library thread overrides.\n")
        print("--workers INTEGER")
        print("  Optional worker count override; defaults to all detected CPUs, up to the number of orbitals.\n")
        print("--open (or --view)")
        print("  Used alone, open the empty desktop viewer. With an element, open the generated GLB/glTF after completion.")
        print("  Requires files/requirements-viewer.txt.\n")
        print("Examples")
        print("  python orbital_generator.py --open")
        print("  python orbital_generator.py Fe --output iron.glb --points 5000")
        print("  python orbital_generator.py Og --output Og.glb --points 5000 --open --parallel")
        print("  python orbital_generator.py C --output carbon.glb --open")
        print("  python orbital_generator.py P --output phosphorus.gltf --isovalue 0.08 --resolution 112")
        return
    if args.element is None:
        if args.open_viewer:
            from files.orbital_viewer import launch_viewer
            launch_viewer()
            return
        parser.error("the following argument is required: element (or use --open to open the viewer)")
    if args.workers is not None and not args.parallel:
        parser.error("--workers requires --parallel")
    if args.workers is not None and args.workers < 1:
        parser.error("--workers must be at least 1")
    z = atomic_number(args.element)
    output = args.output or Path(f"{ELEMENTS[z - 1]}.glb")
    # Keep generated artefacts separate from the source files.  An explicitly
    # nested or absolute path remains under the caller's control.
    if not output.is_absolute() and output.parent == Path("."):
        output = Path("output") / output
    if args.open_viewer and output.suffix.lower() not in (".glb", ".gltf"):
        parser.error("--open/--view requires a .glb or .gltf output file")
    results = build_model(
        args.element, output, args.points, args.resolution, args.isovalue, args.seed,
        not args.no_progress, parallel=args.parallel, max_workers=args.workers,
    )
    print(f"Wrote {output} with {len(results)} occupied spatial orbitals ({sum(len(r.points) for r in results):,} points).")
    print(f"Grid resolution: {args.resolution} cells per axis.")
    metadata_path = output.parent / "json" / output.with_suffix(".json").name
    print(f"Metadata and volumes: {metadata_path}")
    for result in results:
        print(f"  {result.orbital.label:8s} {result.volume_bohr3:10.3f} a0^3  {result.volume_angstrom3:10.3f} Å^3")
    if args.open_viewer:
        from files.orbital_viewer import launch_viewer
        launch_viewer(output)


if __name__ == "__main__":
    main()
