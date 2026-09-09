# Generatore di orbitali atomici

[English](README.md) · **Italiano**

Questo progetto genera modelli tridimensionali a nuvola di punti degli orbitali atomici occupati degli elementi neutri da H a Og. È una visualizzazione didattica con base fisica, costruita con funzioni idrogenoidi e schermaggio di Slater; non è un calcolo quantistico multielettronico.

## Generazione di un elemento

Eseguire:

```text
python orbital_generator.py ELEMENTO [opzioni]
```

`ELEMENTO` può essere il simbolo chimico senza distinzione tra maiuscole e minuscole oppure il numero atomico da 1 a 118. Per esempio, `C`, `fe` e `26` sono validi. I nomi completi degli elementi non sono accettati.

Il comando più semplice è:

```powershell
python orbital_generator.py C
```

Quando `--output` viene omesso, il programma usa il simbolo canonico e scrive:

```text
output/C.glb
output/json/C.json
```

Il JSON associato contiene elemento, configurazione elettronica, metodo di generazione, occupazioni, cariche efficaci, quantità di punti, informazioni nodali e volumi stimati.

### Opzioni del comando

| Opzione | Funzione | Valore predefinito |
| --- | --- | --- |
| `--output FILE`, `-o FILE` | Seleziona un output `.glb`, `.gltf`, `.ply`, `.obj` o `.xyz` | `output/<Simbolo>.glb` |
| `--points N` | Punti di base per ogni orbitale spaziale occupato | `2000` |
| `--resolution N` | Risoluzione richiesta della griglia volumetrica per asse; minimo 16 | `72` |
| `--isovalue X` | Confine visivo relativo, con `0 < X < 1` | `0.5` |
| `--seed N` | Seme riproducibile per il posizionamento dei punti | `7` |
| `--parallel` | Genera in parallelo gli orbitali indipendenti | Disattivato |
| `--workers N` | Imposta il numero di processi e richiede `--parallel` | CPU rilevate, limitate dal numero di orbitali |
| `--no-progress` | Nasconde la barra di avanzamento nel terminale | Disattivato |
| `--open`, `--view` | Apre il GLB/glTF generato nel viewer | Disattivato |
| `--info` | Mostra descrizioni estese ed esempi | — |
| `--help` | Mostra la guida sintetica del comando | — |

Un semplice nome di file viene collocato in `output/`. Un percorso assoluto o contenente directory viene usato così come indicato. I metadati corrispondenti vengono sempre creati in una sottodirectory `json` accanto alla posizione di output.

### Esempi

Generare il ferro in modo sequenziale con il nome predefinito `output/Fe.glb`:

```powershell
python orbital_generator.py Fe
```

Generare tramite numero atomico, aumentare i punti e aprire il risultato:

```powershell
python orbital_generator.py 26 --points 5000 --open
```

Scegliere il nome e un confine visivo più esteso:

```powershell
python orbital_generator.py P --output phosphorus.glb --isovalue 0.08 --resolution 112
```

Generare gli orbitali indipendenti in parallelo:

```powershell
python orbital_generator.py Og --parallel
```

Limitare il parallelismo a quattro processi:

```powershell
python orbital_generator.py W --parallel --workers 4
```

Senza `--parallel`, gli orbitali vengono calcolati uno dopo l'altro. La modalità parallela non impone limiti applicativi a CPU o RAM, ma le attività simultanee non possono superare il numero degli orbitali spaziali occupati. Le griglie grandi possono richiedere molta memoria; scegliere meno worker o la modalità sequenziale se il sistema operativo inizia a usare intensamente il file di paging.

## Modello scientifico

### Configurazione elettronica

Il programma costruisce l'occupazione dello stato fondamentale dell'atomo neutro secondo l'ordine di Aufbau e distribuisce gli elettroni negli orbitali spaziali degeneri seguendo la regola di Hund prima dell'appaiamento. Sono incluse correzioni esplicite per gli stati fondamentali di Cr, Cu, Nb, Mo, Ru, Rh, Pd, Ag, Pt e Au. Le altre eccezioni degli elementi pesanti non sono modellate singolarmente.

Ogni orbitale spaziale occupato viene esportato una sola volta, sia quando contiene un elettrone sia quando ne contiene due. Di conseguenza, `--points` è una quantità di base per orbitale spaziale, non per elettrone e non per l'intero atomo.

### Funzioni orbitali e dimensioni

La funzione d'onda è rappresentata come prodotto tra una funzione radiale idrogenoide e un'armonica sferica reale normalizzata:

```text
ψ(n,l,m) = R(n,l,Z_eff,r) · Y(l,m,θ,φ)
```

La carica nucleare efficace `Z_eff` viene stimata con le regole di schermaggio di Slater. Sono supportati gli orbitali reali `s`, `px`, `py`, `pz`, i cinque orbitali reali `d` e i sette orbitali reali `f`. Tutti gli orbitali dello stesso atomo esportato condividono la medesima scala delle coordinate; né il generatore né il viewer ridimensionano i singoli orbitali. Le coordinate sono esportate in ångström usando `1 a0 = 0.529177210903 Å`.

Questa approssimazione può produrre grandi differenze tra le dimensioni dei sottolivelli. Per esempio, un orbitale esterno `4s` può risultare molto più diffuso di un orbitale `3d` schermato. Queste proporzioni sono coerenti internamente con il modello idrogenoide di Slater scelto, ma non sono densità multielettroniche sperimentali.

### Confine visivo e campionamento dei punti

Il programma valuta `|ψ|²`. Ogni regione nodale radiale e angolare viene normalizzata rispetto al proprio massimo locale prima di applicare `--isovalue`. Questo conserva nella visualizzazione i gusci interni più deboli e i lobi piccoli. Pertanto, `--isovalue 0.5` indica metà del massimo locale di ciascuna regione; non è una superficie che contiene il 50% della probabilità elettronica e non è un'unica soglia di densità fisica condivisa dall'atomo.

Valori più bassi mostrano regioni più estese, mentre valori più alti conservano le zone vicine ai massimi locali. I punti di base vengono campionati uniformemente nel volume accettato mediante una sequenza Sobol scrambled. Sono campioni grafici, non posizioni elettroniche simulate secondo la distribuzione di probabilità.

Ogni lobo connesso riceve almeno 16 punti di supporto. Altri punti evidenziano i bordi interni ed esterni con intensità CLI fissa pari a 5. Per questo il numero finale è normalmente maggiore di `--points × orbitali spaziali occupati`, e la densità visiva dei punti non deve essere interpretata come densità di probabilità.

La griglia volumetrica richiesta viene aumentata automaticamente almeno a `64 + 20l` campioni per asse, dove `l = 0, 1, 2, 3` per `s, p, d, f`. Il calcolo dei bordi usa una griglia separata di `128 + 32l` campioni per asse. Tempo e memoria di una griglia tridimensionale crescono approssimativamente con il cubo della risoluzione per asse.

Il JSON riporta stime voxel del volume visualizzato di ciascun orbitale in `a0³` e `Å³`. Questi valori dipendono da `--isovalue` e dalla risoluzione della griglia. I volumi di orbitali sovrapposti non sono parti disgiunte del volume atomico e non devono essere sommati come se lo fossero.

### Limiti dell'interpretazione

Il generatore non esegue calcoli Hartree–Fock o DFT e non include correlazione elettronica, correzioni relativistiche, accoppiamento spin-orbita, orbitali molecolari, carica ionica o dipendenza della struttura elettronica dall'isotopo. I colori identificano soltanto il momento angolare: `s` rosso, `p` giallo, `d` ciano e `f` verde. Non indicano la fase della funzione d'onda né lo spin elettronico.
