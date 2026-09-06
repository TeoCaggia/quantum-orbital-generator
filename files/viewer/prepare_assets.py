"""Extract the required runtime files from the pinned upstream npm archives.

Download three-0.176.0.tgz as vendor/three.tgz and dat.gui-0.7.9.tgz as
vendor/dat.gui.tgz first; no npm/Node build is needed at runtime.
"""
from pathlib import Path
import posixpath
import re
import tarfile

ROOT = Path(__file__).resolve().parent / 'vendor'


def prepare():
    with tarfile.open(ROOT / 'three.tgz') as archive:
        entries = [
            'build/three.module.js', 'LICENSE',
            'examples/jsm/controls/TrackballControls.js',
            'examples/jsm/environments/RoomEnvironment.js',
            'examples/jsm/libs/meshopt_decoder.module.js',
            *[f'examples/jsm/loaders/{name}Loader.js' for name in ('GLTF', 'DRACO', 'KTX2')],
        ]
        # The viewer only decodes glTF; generic Draco decoders and encoders
        # are unnecessary. Keep the required runtime files and upstream notices.
        entries += [
            'examples/jsm/libs/draco/README.md',
            *[f'examples/jsm/libs/draco/gltf/{name}' for name in (
                'draco_decoder.js', 'draco_decoder.wasm', 'draco_wasm_wrapper.js')],
            *[f'examples/jsm/libs/basis/{name}' for name in (
                'basis_transcoder.js', 'basis_transcoder.wasm', 'README.md')],
        ]
        written = set()
        while entries:
            entry = entries.pop()
            if entry in written:
                continue
            target = (ROOT / 'three' / entry).resolve()
            if not target.is_relative_to((ROOT / 'three').resolve()):
                raise ValueError(f'Invalid archive path: {entry}')
            data = archive.extractfile('package/' + entry).read()
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            written.add(entry)
            if entry.endswith('.js'):
                for relative in re.findall(r'''(?:from\s*|import\s*)['"](\.[^'"]+)['"]''', data.decode('utf-8')):
                    entries.append(posixpath.normpath(posixpath.join(posixpath.dirname(entry), relative)))
    with tarfile.open(ROOT / 'dat.gui.tgz') as archive:
        for entry in ('build/dat.gui.module.js', 'LICENSE'):
            target = ROOT / 'dat.gui' / entry
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.extractfile('package/' + entry).read())
    print(f'Bundled {len(written)} Three.js files plus dat.gui and licenses.')


if __name__ == '__main__':
    prepare()
