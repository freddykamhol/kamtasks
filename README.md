KAMTasks ist ein funktionales Task-Tool auf Basis von Next.js, Prisma und SQLite.

## Node-Version

Das Projekt ist auf `Node 20` ausgelegt.

Für Hosts mit `nodenv` liegt deshalb eine `.node-version` im Projekt. Dadurch wird in diesem Ordner automatisch Node 20 gewählt, auch für `npm install`-Skripte wie Prisma.

## Setup

1. Prisma Client generieren:

```bash
npm run db:generate
```

2. SQLite-Datenbank anlegen:

```bash
npm run db:setup
```

3. Entwicklungsserver starten:

```bash
npm run dev
```

`npm ci` erzeugt den Prisma-Client zusätzlich automatisch über `postinstall`, damit Deployments ohne manuelles `prisma generate` bauen.

## Datenmodell

- `User`: Verantwortliche Personen
- `Task`: Aufgaben mit Eisenhower-Quadrant und separaten Gantt-Feldern
- `Event`: Termine für Kalender- und Planungsbezug

Gantt-relevante Felder wie `ganttStart`, `ganttEnd` und `ganttLane` sind bewusst unabhängig von der Eisenhower-Matrix modelliert. Eine Aufgabe kann also für Gantt geplant werden, ohne ihre Priorisierungslogik zu verändern.

## Deployment

Das Projekt ist für ein schlichtes Deployment ohne zusätzliche Cloud-Dienste ausgelegt:

- SQLite-Datei liegt lokal im Projekt
- Prisma läuft ohne externen Datenbankdienst
- geeignet für Node-fähige Webspaces, auf die das Projekt "nackt" hochgeladen wird

Vor dem Upload:

```bash
npm run db:setup
npm run build
```

Start auf dem Server:

```bash
npm run start
```

`npm run start` richtet die SQLite-Tabellen automatisch vor dem Serverstart ein.

Alternativ direkt:

```bash
node server.js
```

Der Server nutzt standardmäßig:

- `HOST=0.0.0.0`
- `PORT=3000`

Beides kann über Umgebungsvariablen auf dem Webspace überschrieben werden.
