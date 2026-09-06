"""Desktop GLB/glTF viewer, using the bundled three-gltf-viewer renderer."""
from __future__ import annotations

import argparse
import functools
import json
import mimetypes
from pathlib import Path
import secrets
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote, unquote, urlsplit

ASSETS = Path(__file__).resolve().parent / 'viewer'
OUTPUT = Path(__file__).resolve().parent.parent / 'output'
ELEMENT_SYMBOLS = tuple(
    'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn '
    'Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce '
    'Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn '
    'Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'.split()
)


class AssetServer(ThreadingHTTPServer):
    """Serve only bundled UI and explicitly opened model folders on loopback."""
    daemon_threads = True

    def __init__(self):
        self.token = secrets.token_urlsafe(24)
        self.mounts = {'ui': ASSETS}
        super().__init__(('127.0.0.1', 0), AssetHandler)
        self.origin = f'http://127.0.0.1:{self.server_port}'
        self.base_url = f'{self.origin}/{self.token}/'

    def model_url(self, path: Path) -> str:
        mount = secrets.token_urlsafe(12)
        self.mounts[mount] = path.parent.resolve()
        return self.base_url + mount + '/' + quote(path.name)


class AssetHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.serve_file()

    def do_HEAD(self):
        self.serve_file(head=True)

    def serve_file(self, head=False):
        parts = unquote(urlsplit(self.path).path).split('/', 3)
        if len(parts) != 4 or parts[1] != self.server.token:
            self.send_error(404)
            return
        root = self.server.mounts.get(parts[2])
        if root is None:
            self.send_error(404)
            return
        try:
            path = (root / parts[3]).resolve()
            if not path.is_relative_to(root) or not path.is_file():
                self.send_error(404)
                return
            # No directory listing. Resolving first also prevents escaping via symlinks.
            with path.open('rb') as stream:
                mime = {'.js': 'text/javascript', '.gltf': 'model/gltf+json',
                        '.glb': 'model/gltf-binary', '.wasm': 'application/wasm'}.get(path.suffix.lower())
                self.send_response(200)
                self.send_header('Content-Type', mime or mimetypes.guess_type(path)[0] or 'application/octet-stream')
                self.send_header('Content-Length', str(path.stat().st_size))
                self.send_header('Cache-Control', 'no-store')
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.send_header('Content-Security-Policy',
                                 "default-src 'self' data: blob: qrc:; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: qrc:; "
                                 "style-src 'self' 'unsafe-inline'; connect-src 'self' data: blob:; object-src 'none'")
                self.end_headers()
                if not head:
                    while chunk := stream.read(1024 * 1024):
                        self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except OSError:
            self.send_error(404)

    def log_message(self, format, *args):
        pass


def launch_viewer(path: Path | None = None) -> int:
    try:
        from PySide6.QtCore import QObject, Qt, QUrl, Slot
        from PySide6.QtGui import QAction, QColor, QDesktopServices, QKeySequence, QFont, QFontDatabase
        from PySide6.QtWidgets import QApplication, QFileDialog, QMainWindow, QMessageBox
        from PySide6.QtWebChannel import QWebChannel
        from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineUrlRequestInterceptor
        from PySide6.QtWebEngineWidgets import QWebEngineView
    except ImportError as error:
        raise SystemExit('The desktop viewer needs PySide6. Install it with:\n'
                         f'  "{sys.executable}" -m pip install -r "{Path(__file__).with_name("requirements-viewer.txt")}"') from error

    if not (ASSETS / 'vendor/three/build/three.module.js').is_file():
        raise SystemExit('Bundled viewer libraries are missing. See files/viewer/README.md to restore them.')

    app = QApplication.instance() or QApplication(sys.argv[:1])
    app.setApplicationName('Orbital GLB / glTF Viewer')
    font_id = QFontDatabase.addApplicationFont(str(ASSETS / 'fonts' / 'Syne.ttf'))
    if font_id >= 0:
        families = QFontDatabase.applicationFontFamilies(font_id)
        if families:
            app.setFont(QFont(families[0], app.font().pointSize(), QFont.Weight.Normal))
    app.setStyle('Fusion')
    app.setStyleSheet('''
        QMainWindow { background: #171717; color: #e8e8e8; }
        QStatusBar { background: #171717; color: #aaa; }
    ''')
    server = AssetServer()
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    class LocalRequests(QWebEngineUrlRequestInterceptor):
        def interceptRequest(self, info):
            url = info.requestUrl()
            if url.scheme() in ('data', 'blob', 'qrc', 'about'):
                return
            if (url.scheme() != 'http' or url.host() != '127.0.0.1'
                    or url.port() != server.server_port
                    or not url.path().startswith('/' + server.token + '/')):
                info.block(True)

    class LocalPage(QWebEnginePage):
        def acceptNavigationRequest(self, url, navigation_type, is_main_frame):
            return not is_main_frame or url.toString() == server.base_url + 'ui/index.html'

        def javaScriptConsoleMessage(self, level, message, line, source):
            if level == QWebEnginePage.JavaScriptConsoleMessageLevel.ErrorMessageLevel:
                print(f'Viewer: {message} ({source}:{line})', file=sys.stderr)

    class Bridge(QObject):
        @Slot(str)
        def openExternal(self, url):
            source = QUrl(url)
            if (source.scheme() == 'https' and source.host() == 'physics.nist.gov'
                    and source.path() == '/cgi-bin/Compositions/stand_alone.pl'):
                QDesktopServices.openUrl(source)

        @Slot()
        def openFile(self):
            if window.is_ready and not window.loading:
                window.choose_file()

        @Slot(str)
        def openElement(self, symbol):
            if not window.is_ready or window.loading or symbol not in ELEMENT_SYMBOLS:
                return
            filename = OUTPUT / f'{symbol}.glb'
            if filename.is_file():
                window.open_model(filename)
            else:
                window.page.runJavaScript('window.showMissingModelMessage?.()')

        @Slot()
        def elementPickerShown(self):
            window.current_path = None
            window.loading = False
            window.open_action.setEnabled(window.is_ready)
            for action in window.view_actions:
                action.setEnabled(False)
            window.statusBar().showMessage('Seleziona un elemento dalla tavola periodica')
            window.setWindowTitle('Orbital Viewer')

        @Slot()
        def ready(self):
            window.is_ready = True
            window.open_action.setEnabled(True)
            window.statusBar().showMessage('Open a GLB/glTF file · Drag: rotate · Shift-drag: pan · Scroll: zoom')
            if path:
                window.open_model(path)
            else:
                window.page.runJavaScript('window.showEmptyViewer()')

        @Slot(str)
        def modelLoaded(self, description):
            window.loading = False
            window.open_action.setEnabled(True)
            for action in window.view_actions:
                action.setEnabled(True)
            window.statusBar().showMessage(description)
            window.setWindowTitle(f'{window.current_path.name} — Orbital Viewer')

        @Slot(str)
        def modelFailed(self, error):
            window.loading = False
            window.open_action.setEnabled(window.is_ready)
            window.statusBar().showMessage('Could not load model')
            QMessageBox.warning(window, 'Unable to open model', error + '\n\nFor .gltf files, keep the referenced .bin files and textures in the model folder. Remote resources and paths outside that folder are not loaded.')

    class Window(QMainWindow):
        def __init__(self):
            super().__init__()
            self.is_ready = False
            self.loading = False
            self.current_path = None
            self.setWindowTitle('Orbital GLB / glTF Viewer')
            self.resize(1280, 820)
            self.setMinimumSize(720, 480)
            self.setAcceptDrops(True)
            self.web = QWebEngineView(self)
            self.web.setAcceptDrops(False)
            # Forward native context-menu coordinates to the page's selector.
            self.web.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
            self.web.customContextMenuRequested.connect(self.show_orbital_menu)
            self.page = LocalPage(self.web)
            self.interceptor = LocalRequests(self.page)
            self.page.setUrlRequestInterceptor(self.interceptor)
            self.page.setBackgroundColor(QColor('black'))
            self.web.setPage(self.page)
            self.channel = QWebChannel(self.page)
            self.bridge = Bridge(self.channel)
            self.channel.registerObject('desktop', self.bridge)
            self.page.setWebChannel(self.channel)
            self.setCentralWidget(self.web)
            self.open_action = QAction('Open…', self)
            self.open_action.setShortcut(QKeySequence.StandardKey.Open)
            self.open_action.triggered.connect(self.choose_file)
            self.open_action.setEnabled(False)
            self.addAction(self.open_action)
            self.view_actions = []
            for label, view, shortcut in [('Fit', 'perspective', 'F'), ('Front', 'front', '1'),
                                          ('Side', 'side', '3'), ('Top', 'top', '7')]:
                action = QAction(label, self)
                action.setShortcut(QKeySequence(shortcut))
                action.setToolTip(f'{label} view ({shortcut})')
                action.triggered.connect(functools.partial(self.set_view, view))
                action.setEnabled(False)
                self.addAction(action)  # Keep keyboard shortcuts.
                self.view_actions.append(action)
            full = QAction('Full screen', self)
            full.setShortcut(QKeySequence('F11'))
            full.triggered.connect(lambda: self.showMaximized() if self.isFullScreen() else self.showFullScreen())
            self.addAction(full)
            self.statusBar().hide()
            self.web.loadFinished.connect(self.page_loaded)
            self.web.load(QUrl(server.base_url + 'ui/index.html'))

        def show_orbital_menu(self, position):
            self.page.runJavaScript(
                f'window.showOrbitalMenuAt?.({position.x()}, {position.y()})')

        def page_loaded(self, ok):
            if not ok:
                self.statusBar().showMessage('Viewer failed to start. Close the window and try again.')

        def set_view(self, view, checked=False):
            self.page.runJavaScript(f'window.desktopViewer.fit({json.dumps(view)})')

        def choose_file(self):
            initial = self.current_path.parent if self.current_path else Path(__file__).resolve().parent.parent / 'output'
            filename, _ = QFileDialog.getOpenFileName(self, 'Open GLB / glTF model', str(initial), 'glTF models (*.glb *.gltf)')
            if filename:
                self.open_model(Path(filename))

        def open_model(self, filename):
            if not self.is_ready or self.loading:
                return
            filename = Path(filename).expanduser().resolve()
            if filename.suffix.lower() not in ('.glb', '.gltf') or not filename.is_file():
                QMessageBox.warning(self, 'Invalid file', 'Choose an existing .glb or .gltf file.')
                return
            self.current_path = filename
            self.loading = True
            self.open_action.setEnabled(False)
            self.statusBar().showMessage(f'Loading {filename.name}…')
            url = server.model_url(filename)
            self.page.runJavaScript(f'window.openModel({json.dumps(url)}, {json.dumps(filename.name)})')

        def dragEnterEvent(self, event):
            if self.is_ready and not self.loading and event.mimeData().hasUrls():
                urls = event.mimeData().urls()
                if len(urls) == 1 and urls[0].isLocalFile() and Path(urls[0].toLocalFile()).suffix.lower() in ('.glb', '.gltf'):
                    event.acceptProposedAction()

        def dropEvent(self, event):
            self.open_model(Path(event.mimeData().urls()[0].toLocalFile()))
            event.acceptProposedAction()

    window = Window()
    window.showMaximized()
    try:
        return app.exec()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def main() -> int:
    parser = argparse.ArgumentParser(description='Open GLB/glTF models in a desktop window.')
    parser.add_argument('file', type=Path, nargs='?', help='Optional .glb or .gltf file to open')
    args = parser.parse_args()
    if args.file and (not args.file.is_file() or args.file.suffix.lower() not in ('.glb', '.gltf')):
        parser.error('Choose an existing .glb or .gltf file')
    return launch_viewer(args.file)


if __name__ == '__main__':
    sys.exit(main())
