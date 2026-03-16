import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function formatIcsDate(value: Date) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  const hours = String(value.getUTCHours()).padStart(2, "0");
  const minutes = String(value.getUTCMinutes()).padStart(2, "0");
  const seconds = String(value.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

function escapeIcsValue(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

export async function GET() {
  const events = await prisma.event.findMany({
    where: {
      calendarSourceId: null,
    },
    orderBy: [{ startAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      title: true,
      startAt: true,
      endAt: true,
      location: true,
      notes: true,
      externalUid: true,
      updatedAt: true,
    },
  });

  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//KAMtasks//Calendar Sync//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:KAMtasks",
    ...events.flatMap((event) => [
      "BEGIN:VEVENT",
      `UID:${escapeIcsValue(event.externalUid || `${event.id}@kamtasks`)}`,
      `DTSTAMP:${formatIcsDate(new Date(event.updatedAt))}`,
      `DTSTART:${formatIcsDate(new Date(event.startAt))}`,
      `DTEND:${formatIcsDate(new Date(event.endAt))}`,
      `SUMMARY:${escapeIcsValue(event.title)}`,
      ...(event.location ? [`LOCATION:${escapeIcsValue(event.location)}`] : []),
      ...(event.notes ? [`DESCRIPTION:${escapeIcsValue(event.notes)}`] : []),
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
    "",
  ].join("\r\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
