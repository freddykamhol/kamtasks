import { prisma } from "@/lib/prisma";

const SYNC_INTERVAL_MS = 15 * 60_000;

type ParsedIcsEvent = {
  uid: string;
  title: string;
  startAt: Date;
  endAt: Date;
  location: string | null;
  notes: string | null;
};

function normalizeCalendarUrl(url: string) {
  const trimmed = url.trim();

  if (trimmed.startsWith("webcal://")) {
    return `https://${trimmed.slice("webcal://".length)}`;
  }

  return trimmed;
}

function unfoldIcsLines(content: string) {
  return content.replace(/\r?\n[ \t]/g, "");
}

function unescapeIcsValue(value: string) {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function parseIcsDate(rawValue: string, isDateOnly: boolean) {
  if (isDateOnly) {
    const year = Number(rawValue.slice(0, 4));
    const month = Number(rawValue.slice(4, 6)) - 1;
    const day = Number(rawValue.slice(6, 8));
    return new Date(year, month, day, 0, 0, 0, 0);
  }

  if (rawValue.endsWith("Z")) {
    const year = Number(rawValue.slice(0, 4));
    const month = Number(rawValue.slice(4, 6)) - 1;
    const day = Number(rawValue.slice(6, 8));
    const hour = Number(rawValue.slice(9, 11));
    const minute = Number(rawValue.slice(11, 13));
    const second = Number(rawValue.slice(13, 15) || "0");
    return new Date(Date.UTC(year, month, day, hour, minute, second));
  }

  const year = Number(rawValue.slice(0, 4));
  const month = Number(rawValue.slice(4, 6)) - 1;
  const day = Number(rawValue.slice(6, 8));
  const hour = Number(rawValue.slice(9, 11));
  const minute = Number(rawValue.slice(11, 13));
  const second = Number(rawValue.slice(13, 15) || "0");
  return new Date(year, month, day, hour, minute, second, 0);
}

function parseIcsEvents(content: string) {
  const lines = unfoldIcsLines(content).split(/\r?\n/);
  const events: ParsedIcsEvent[] = [];
  let current: Partial<ParsedIcsEvent> & { startDateOnly?: boolean; endDateOnly?: boolean } | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }

    if (line === "END:VEVENT") {
      if (
        current?.uid &&
        current.title &&
        current.startAt instanceof Date &&
        current.endAt instanceof Date &&
        !Number.isNaN(current.startAt.getTime()) &&
        !Number.isNaN(current.endAt.getTime())
      ) {
        events.push({
          uid: current.uid,
          title: current.title,
          startAt: current.startAt,
          endAt: current.endAt > current.startAt ? current.endAt : new Date(current.startAt.getTime() + 30 * 60_000),
          location: current.location ?? null,
          notes: current.notes ?? null,
        });
      }

      current = null;
      continue;
    }

    if (!current) {
      continue;
    }

    const separatorIndex = line.indexOf(":");

    if (separatorIndex === -1) {
      continue;
    }

    const keyPart = line.slice(0, separatorIndex);
    const rawValue = line.slice(separatorIndex + 1);
    const [propertyName, ...paramParts] = keyPart.split(";");
    const params = new Map(
      paramParts.map((part) => {
        const [paramKey, paramValue = ""] = part.split("=");
        return [paramKey.toUpperCase(), paramValue.toUpperCase()];
      })
    );

    switch (propertyName.toUpperCase()) {
      case "UID":
        current.uid = rawValue.trim();
        break;
      case "SUMMARY":
        current.title = unescapeIcsValue(rawValue.trim());
        break;
      case "DESCRIPTION":
        current.notes = unescapeIcsValue(rawValue.trim());
        break;
      case "LOCATION":
        current.location = unescapeIcsValue(rawValue.trim());
        break;
      case "DTSTART":
        current.startDateOnly = params.get("VALUE") === "DATE";
        current.startAt = parseIcsDate(rawValue.trim(), current.startDateOnly);
        break;
      case "DTEND":
        current.endDateOnly = params.get("VALUE") === "DATE";
        current.endAt = parseIcsDate(rawValue.trim(), current.endDateOnly);
        break;
      default:
        break;
    }
  }

  return events;
}

export async function syncCalendarSource(sourceId: string) {
  const source = await prisma.calendarSource.findUnique({
    where: { id: sourceId },
  });

  if (!source) {
    return;
  }

  const normalizedUrl = normalizeCalendarUrl(source.url);

  try {
    const response = await fetch(normalizedUrl, {
      headers: {
        "User-Agent": "KAMTasks/1.0 (calendar sync)",
        Accept: "text/calendar, text/plain;q=0.9, */*;q=0.1",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const content = await response.text();
    const parsedEvents = parseIcsEvents(content);
    const seenUids = new Set<string>();

    for (const entry of parsedEvents) {
      seenUids.add(entry.uid);

      await prisma.event.upsert({
        where: {
          calendarSourceId_externalUid: {
            calendarSourceId: source.id,
            externalUid: entry.uid,
          },
        },
        update: {
          title: entry.title,
          startAt: entry.startAt,
          endAt: entry.endAt,
          durationMinutes: Math.max(Math.round((entry.endAt.getTime() - entry.startAt.getTime()) / 60_000), 15),
          location: entry.location,
          notes: entry.notes,
        },
        create: {
          title: entry.title,
          startAt: entry.startAt,
          endAt: entry.endAt,
          durationMinutes: Math.max(Math.round((entry.endAt.getTime() - entry.startAt.getTime()) / 60_000), 15),
          location: entry.location,
          notes: entry.notes,
          calendarSourceId: source.id,
          externalUid: entry.uid,
        },
      });
    }

    await prisma.event.deleteMany({
      where: {
        calendarSourceId: source.id,
        externalUid: {
          notIn: [...seenUids, "__keep_none__"],
        },
      },
    });

    await prisma.calendarSource.update({
      where: { id: source.id },
      data: {
        lastSyncedAt: new Date(),
        lastSyncStatus: `OK • ${parsedEvents.length} Termine`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync fehlgeschlagen";

    await prisma.calendarSource.update({
      where: { id: source.id },
      data: {
        lastSyncedAt: new Date(),
        lastSyncStatus: `Fehler • ${message}`,
      },
    });
  }
}

export async function syncStaleCalendarSources() {
  const sources = await prisma.calendarSource.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      lastSyncedAt: true,
    },
  });

  for (const source of sources) {
    if (!source.lastSyncedAt || Date.now() - source.lastSyncedAt.getTime() >= SYNC_INTERVAL_MS) {
      await syncCalendarSource(source.id);
    }
  }
}

