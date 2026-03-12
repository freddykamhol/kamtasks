KAMTasks ist ein funktionales Task-Tool auf Basis von Next.js, Prisma und SQLite.

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
npm run db:generate
npm run db:setup
npm run build
```

Start auf dem Server:

```bash
npm run start
```

Alternativ direkt:

```bash
node server.js
```

Der Server nutzt standardmäßig:

- `HOSTNAME=0.0.0.0`
- `PORT=3000`

Beides kann über Umgebungsvariablen auf dem Webspace überschrieben werden.
