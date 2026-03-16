"use client";

import { useDeferredValue, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  WorkspaceHero,
  WorkspaceShell,
  WorkspaceStatCard,
  WorkspaceStatGrid,
} from "@/components/workspace-shell";
import type { CalendarSource, Event, Task, User } from "@/generated/prisma/client";
import {
  createCalendarSourceAction,
  createEventAction,
  deleteCalendarSourceAction,
  deleteEventAction,
  getEventSuggestionsAction,
  getTravelEstimateAction,
  syncCalendarSourcesIfNeededAction,
  syncCalendarSourceAction,
  updateCalendarSourceColorAction,
  updateEventAction,
} from "../actions";
import { departureOrigins } from "@/lib/origins";

type EventWithRelations = Event & {
  owner: User | null;
  tasks: Task[];
  calendarSource: CalendarSource | null;
};

type Props = {
  events: EventWithRelations[];
  users: User[];
  calendarSources: CalendarSource[];
};

type CalendarView = "day" | "week" | "month";
type SchedulingMode = "manual" | "suggested";
type DaySegment = {
  event: EventWithRelations;
  start: Date;
  end: Date;
  lane: number;
  laneCount: number;
};

type EventSuggestion = {
  startAt: string;
  endAt: string;
  travelMinutes: number;
  sourceLabel: string;
};

type TravelEstimate = {
  travelMinutes: number;
  sourceLabel: string;
};

const timeOfDayOptions = [
  { key: "early_morning", label: "Früh morgens" },
  { key: "morning", label: "Morgens" },
  { key: "midday", label: "Mittags" },
  { key: "afternoon", label: "Nachmittags" },
  { key: "evening", label: "Abends" },
] as const;

const schedulingModeOptions = [
  { key: "manual", label: "Feste Zeit" },
  { key: "suggested", label: "Termin finden" },
] as const;

const defaultDepartureOriginKey = departureOrigins[0]?.key ?? "home";
const hourRowHeight = 68;

function formatDateInput(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTimeInput(value: Date | string) {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatTime(value: Date | string) {
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDateLabel(value: Date | string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("de-DE", options ?? {
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function formatRangeLabel(start: Date, end: Date) {
  return `${formatDateLabel(start, { day: "2-digit", month: "short" })} - ${formatDateLabel(end, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })}`;
}

function formatSyncLabel(value: Date | string | null | undefined) {
  if (!value) {
    return "Noch nicht synchronisiert";
  }

  return `Zuletzt ${new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))}`;
}

function getEventAccentColor(event: EventWithRelations) {
  return event.calendarSource?.color || "#7dd3fc";
}

function buildManualTiming(isoDate: string, startTime: string, endTime: string) {
  if (!isoDate || !startTime || !endTime) {
    return null;
  }

  const startAt = new Date(`${isoDate}T${startTime}:00`);
  const endAt = new Date(`${isoDate}T${endTime}:00`);

  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
    return null;
  }

  return { startAt, endAt };
}

function getTimeOfDayForDate(value: Date) {
  if (value.getHours() < 8) {
    return "early_morning";
  }

  if (value.getHours() < 11) {
    return "morning";
  }

  if (value.getHours() < 14) {
    return "midday";
  }

  if (value.getHours() < 18) {
    return "afternoon";
  }

  return "evening";
}

function getDepartureOriginKeyFromSourceLabel(sourceLabel: string | null | undefined) {
  const normalized = sourceLabel?.trim();

  if (!normalized) {
    return defaultDepartureOriginKey;
  }

  return (
    departureOrigins.find((origin) => origin.address === normalized || origin.label === normalized)?.key ??
    defaultDepartureOriginKey
  );
}

function startOfDay(value: Date) {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(value: Date) {
  const next = new Date(value);
  next.setHours(23, 59, 59, 999);
  return next;
}

function addDays(value: Date, amount: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + amount);
  return next;
}

function startOfWeek(value: Date) {
  const next = startOfDay(value);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(next, diff);
}

function startOfMonth(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function endOfMonth(value: Date) {
  return new Date(value.getFullYear(), value.getMonth() + 1, 0, 23, 59, 59, 999);
}

function isSameDay(left: Date | string, right: Date | string) {
  const a = new Date(left);
  const b = new Date(right);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function overlapsDay(event: EventWithRelations, day: Date) {
  const eventStart = new Date(event.startAt);
  const eventEnd = new Date(event.endAt);
  return eventStart <= endOfDay(day) && eventEnd >= startOfDay(day);
}

function minutesSinceDayStart(value: Date) {
  return value.getHours() * 60 + value.getMinutes();
}

function clampSegmentToDay(event: EventWithRelations, day: Date) {
  const dayStart = startOfDay(day);
  const dayEnd = endOfDay(day);
  const eventStart = new Date(event.startAt);
  const eventEnd = new Date(event.endAt);

  return {
    start: eventStart > dayStart ? eventStart : dayStart,
    end: eventEnd < dayEnd ? eventEnd : dayEnd,
  };
}

function getFreeMinutesForDay(events: EventWithRelations[], day: Date) {
  const intervals = events
    .filter((event) => overlapsDay(event, day))
    .map((event) => clampSegmentToDay(event, day))
    .map((segment) => ({
      start: segment.start.getTime(),
      end: segment.end.getTime(),
    }))
    .sort((left, right) => left.start - right.start);

  if (intervals.length === 0) {
    return 24 * 60;
  }

  const merged: Array<{ start: number; end: number }> = [];

  intervals.forEach((interval) => {
    const last = merged[merged.length - 1];

    if (!last || interval.start > last.end) {
      merged.push({ ...interval });
      return;
    }

    last.end = Math.max(last.end, interval.end);
  });

  const occupiedMinutes = merged.reduce((total, interval) => {
    return total + Math.round((interval.end - interval.start) / 60_000);
  }, 0);

  return Math.max(24 * 60 - occupiedMinutes, 0);
}

function getDayAvailability(events: EventWithRelations[], day: Date) {
  const freeMinutes = getFreeMinutesForDay(events, day);

  return {
    isCompletelyFree: freeMinutes >= 24 * 60,
    isPartiallyFree: freeMinutes >= 120 && freeMinutes < 24 * 60,
    freeMinutes,
  };
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const nextRadius = Math.min(radius, width / 2, height / 2);

  context.beginPath();
  context.moveTo(x + nextRadius, y);
  context.lineTo(x + width - nextRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + nextRadius);
  context.lineTo(x + width, y + height - nextRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - nextRadius, y + height);
  context.lineTo(x + nextRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - nextRadius);
  context.lineTo(x, y + nextRadius);
  context.quadraticCurveTo(x, y, x + nextRadius, y);
  context.closePath();
}

function buildDaySegments(events: EventWithRelations[], day: Date) {
  const dayEvents = events
    .filter((event) => overlapsDay(event, day))
    .map((event) => {
      const segment = clampSegmentToDay(event, day);

      return {
        event,
        start: segment.start,
        end: segment.end,
      };
    })
    .sort((left, right) => left.start.getTime() - right.start.getTime());

  const lanes: Date[] = [];
  const results: DaySegment[] = [];

  dayEvents.forEach((segment) => {
    let laneIndex = lanes.findIndex((laneEnd) => laneEnd <= segment.start);

    if (laneIndex === -1) {
      laneIndex = lanes.length;
      lanes.push(segment.end);
    } else {
      lanes[laneIndex] = segment.end;
    }

    results.push({
      ...segment,
      lane: laneIndex,
      laneCount: 1,
    });
  });

  return results.map((segment) => ({
    ...segment,
    laneCount: lanes.length,
  }));
}

function getViewDays(currentDate: Date, view: CalendarView) {
  if (view === "day") {
    return [startOfDay(currentDate)];
  }

  if (view === "week") {
    const start = startOfWeek(currentDate);
    return Array.from({ length: 7 }, (_, index) => addDays(start, index));
  }

  const monthStart = startOfMonth(currentDate);
  const gridStart = startOfWeek(monthStart);
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

export function CalendarTool({ events, users, calendarSources }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [view, setView] = useState<CalendarView>("week");
  const [currentDate, setCurrentDate] = useState(() => startOfDay(new Date()));
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [eventTitle, setEventTitle] = useState("");
  const [eventOwnerId, setEventOwnerId] = useState(users[0]?.id ?? "");
  const [eventDate, setEventDate] = useState(() => formatDateInput(new Date()));
  const [eventSchedulingMode, setEventSchedulingMode] = useState<SchedulingMode>("manual");
  const [eventStartTime, setEventStartTime] = useState("09:00");
  const [eventEndTime, setEventEndTime] = useState("10:00");
  const [eventTimeOfDay, setEventTimeOfDay] = useState<"early_morning" | "morning" | "midday" | "afternoon" | "evening">("morning");
  const [eventDurationMinutes, setEventDurationMinutes] = useState("60");
  const [eventDepartureOriginKey, setEventDepartureOriginKey] = useState<string>(defaultDepartureOriginKey);
  const [eventLocation, setEventLocation] = useState("");
  const [eventInvites, setEventInvites] = useState("");
  const [eventNotes, setEventNotes] = useState("");
  const [suggestions, setSuggestions] = useState<EventSuggestion[]>([]);
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);
  const [selectedSuggestionStartAt, setSelectedSuggestionStartAt] = useState<string | null>(null);
  const [manualTravelEstimate, setManualTravelEstimate] = useState<TravelEstimate | null>(null);
  const [isManualTravelLoading, setIsManualTravelLoading] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editOwnerId, setEditOwnerId] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editSchedulingMode, setEditSchedulingMode] = useState<SchedulingMode>("manual");
  const [editStartTime, setEditStartTime] = useState("09:00");
  const [editEndTime, setEditEndTime] = useState("10:00");
  const [editTimeOfDay, setEditTimeOfDay] = useState<"early_morning" | "morning" | "midday" | "afternoon" | "evening">("morning");
  const [editDurationMinutes, setEditDurationMinutes] = useState("60");
  const [editDepartureOriginKey, setEditDepartureOriginKey] = useState<string>(defaultDepartureOriginKey);
  const [editLocation, setEditLocation] = useState("");
  const [editInvites, setEditInvites] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editSuggestions, setEditSuggestions] = useState<EventSuggestion[]>([]);
  const [isEditSuggestionsLoading, setIsEditSuggestionsLoading] = useState(false);
  const [selectedEditSuggestionStartAt, setSelectedEditSuggestionStartAt] = useState<string | null>(null);
  const [editTravelEstimate, setEditTravelEstimate] = useState<TravelEstimate | null>(null);
  const [isEditTravelLoading, setIsEditTravelLoading] = useState(false);
  const [showCalendarSourceForm, setShowCalendarSourceForm] = useState(false);
  const [calendarSourceName, setCalendarSourceName] = useState("");
  const [calendarSourceUrl, setCalendarSourceUrl] = useState("");
  const feedUrl = typeof window === "undefined" ? "" : `${window.location.origin}/api/calendar/feed`;
  const deferredEventLocation = useDeferredValue(eventLocation);
  const deferredEditLocation = useDeferredValue(editLocation);

  useEffect(() => {
    const interval = window.setInterval(() => {
      startTransition(async () => {
        await syncCalendarSourcesIfNeededAction();
        router.refresh();
      });
    }, 15 * 60_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [router, startTransition]);

  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedEventId) ?? null,
    [events, selectedEventId]
  );
  const createManualTiming = useMemo(
    () => buildManualTiming(eventDate, eventStartTime, eventEndTime),
    [eventDate, eventEndTime, eventStartTime]
  );
  const editManualTiming = useMemo(
    () => buildManualTiming(editDate, editStartTime, editEndTime),
    [editDate, editEndTime, editStartTime]
  );
  const selectedSuggestion = useMemo(
    () => suggestions.find((suggestion) => suggestion.startAt === selectedSuggestionStartAt) ?? suggestions[0] ?? null,
    [selectedSuggestionStartAt, suggestions]
  );
  const selectedEditSuggestion = useMemo(
    () =>
      editSuggestions.find((suggestion) => suggestion.startAt === selectedEditSuggestionStartAt) ??
      editSuggestions[0] ??
      null,
    [editSuggestions, selectedEditSuggestionStartAt]
  );
  const createDepartureAt = useMemo(() => {
    if (!createManualTiming || !manualTravelEstimate) {
      return null;
    }

    return new Date(createManualTiming.startAt.getTime() - manualTravelEstimate.travelMinutes * 60_000);
  }, [createManualTiming, manualTravelEstimate]);
  const editDepartureAt = useMemo(() => {
    if (!editManualTiming || !editTravelEstimate) {
      return null;
    }

    return new Date(editManualTiming.startAt.getTime() - editTravelEstimate.travelMinutes * 60_000);
  }, [editManualTiming, editTravelEstimate]);
  const canCreateEvent = Boolean(
    eventTitle.trim() &&
      (eventSchedulingMode === "manual" ? createManualTiming : selectedSuggestion)
  );
  const canUpdateEvent = Boolean(
    editTitle.trim() &&
      (editSchedulingMode === "manual" ? editManualTiming : selectedEditSuggestion)
  );

  const visibleDays = useMemo(() => getViewDays(currentDate, view), [currentDate, view]);
  const dayColumns = view === "day" ? 1 : view === "week" ? 7 : 7;

  const monthEvents = useMemo(() => {
    return events.filter((event) => {
      const currentStart = view === "month" ? visibleDays[0] : startOfMonth(currentDate);
      const currentEnd = view === "month" ? visibleDays[visibleDays.length - 1] : endOfMonth(currentDate);
      return new Date(event.startAt) <= endOfDay(currentEnd) && new Date(event.endAt) >= startOfDay(currentStart);
    });
  }, [currentDate, events, view, visibleDays]);

  const timelineDays = view === "month" ? [] : visibleDays;

  useEffect(() => {
    let cancelled = false;

    async function loadSuggestions() {
      if (eventSchedulingMode !== "suggested") {
        setIsSuggestionsLoading(false);
        return;
      }

      if (!eventDate) {
        setSuggestions([]);
        setSelectedSuggestionStartAt(null);
        setIsSuggestionsLoading(false);
        return;
      }

      setIsSuggestionsLoading(true);
      const nextSuggestions = await getEventSuggestionsAction({
        isoDate: eventDate,
        durationMinutes: Number(eventDurationMinutes) || 60,
        location: deferredEventLocation || undefined,
        departureOriginKey: eventDepartureOriginKey,
        timeOfDay: eventTimeOfDay,
      });

      if (!cancelled) {
        setSuggestions(nextSuggestions);
        setSelectedSuggestionStartAt((current) => {
          if (current && nextSuggestions.some((suggestion) => suggestion.startAt === current)) {
            return current;
          }

          return nextSuggestions[0]?.startAt ?? null;
        });
        setIsSuggestionsLoading(false);
      }
    }

    const timeoutId = window.setTimeout(() => {
      void loadSuggestions();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    deferredEventLocation,
    eventDate,
    eventDepartureOriginKey,
    eventDurationMinutes,
    eventSchedulingMode,
    eventTimeOfDay,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function loadEditSuggestions() {
      if (editSchedulingMode !== "suggested") {
        setIsEditSuggestionsLoading(false);
        return;
      }

      if (!selectedEventId || !editDate) {
        setEditSuggestions([]);
        setSelectedEditSuggestionStartAt(null);
        setIsEditSuggestionsLoading(false);
        return;
      }

      setIsEditSuggestionsLoading(true);
      const nextSuggestions = await getEventSuggestionsAction({
        isoDate: editDate,
        durationMinutes: Number(editDurationMinutes) || 60,
        location: deferredEditLocation || undefined,
        departureOriginKey: editDepartureOriginKey,
        timeOfDay: editTimeOfDay,
      });

      if (!cancelled) {
        setEditSuggestions(nextSuggestions);
        setSelectedEditSuggestionStartAt((current) => {
          if (current && nextSuggestions.some((suggestion) => suggestion.startAt === current)) {
            return current;
          }

          return nextSuggestions[0]?.startAt ?? null;
        });
        setIsEditSuggestionsLoading(false);
      }
    }

    const timeoutId = window.setTimeout(() => {
      void loadEditSuggestions();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    deferredEditLocation,
    editDate,
    editDepartureOriginKey,
    editDurationMinutes,
    editSchedulingMode,
    editTimeOfDay,
    selectedEventId,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function loadManualTravelEstimate() {
      if (eventSchedulingMode !== "manual") {
        setIsManualTravelLoading(false);
        return;
      }

      if (!deferredEventLocation.trim()) {
        setManualTravelEstimate(null);
        setIsManualTravelLoading(false);
        return;
      }

      setIsManualTravelLoading(true);
      const nextEstimate = await getTravelEstimateAction({
        location: deferredEventLocation,
        departureOriginKey: eventDepartureOriginKey,
      });

      if (!cancelled) {
        setManualTravelEstimate(nextEstimate);
        setIsManualTravelLoading(false);
      }
    }

    const timeoutId = window.setTimeout(() => {
      void loadManualTravelEstimate();
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [deferredEventLocation, eventDepartureOriginKey, eventSchedulingMode]);

  useEffect(() => {
    let cancelled = false;

    async function loadEditTravelEstimate() {
      if (editSchedulingMode !== "manual") {
        setIsEditTravelLoading(false);
        return;
      }

      if (!deferredEditLocation.trim()) {
        setEditTravelEstimate(null);
        setIsEditTravelLoading(false);
        return;
      }

      setIsEditTravelLoading(true);
      const nextEstimate = await getTravelEstimateAction({
        location: deferredEditLocation,
        departureOriginKey: editDepartureOriginKey,
      });

      if (!cancelled) {
        setEditTravelEstimate(nextEstimate);
        setIsEditTravelLoading(false);
      }
    }

    const timeoutId = window.setTimeout(() => {
      void loadEditTravelEstimate();
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [deferredEditLocation, editDepartureOriginKey, editSchedulingMode]);

  function runAction(action: () => Promise<void>) {
    startTransition(async () => {
      await action();
      router.refresh();
    });
  }

  function shiftRange(direction: -1 | 1) {
    setCurrentDate((previous) => {
      if (view === "day") {
        return addDays(previous, direction);
      }

      if (view === "week") {
        return addDays(previous, direction * 7);
      }

      return new Date(previous.getFullYear(), previous.getMonth() + direction, 1);
    });
  }

  function openEventModal(event: EventWithRelations) {
    setSelectedEventId(event.id);
    setEditTitle(event.title);
    setEditOwnerId(event.ownerId ?? "");
    setEditDate(formatDateInput(new Date(event.startAt)));
    setEditSchedulingMode("manual");
    setEditStartTime(formatTimeInput(event.startAt));
    setEditEndTime(formatTimeInput(event.endAt));
    setEditTimeOfDay(getTimeOfDayForDate(new Date(event.startAt)));
    setEditDurationMinutes(
      String(
        event.durationMinutes ??
          Math.round((new Date(event.endAt).getTime() - new Date(event.startAt).getTime()) / 60_000)
      )
    );
    setEditDepartureOriginKey(getDepartureOriginKeyFromSourceLabel(event.travelSourceLabel));
    setEditLocation(event.location ?? "");
    setEditInvites(event.invites ?? "");
    setEditNotes(event.notes ?? "");
    setEditTravelEstimate(
      event.travelSourceLabel
        ? {
            travelMinutes: event.travelMinutes ?? 0,
            sourceLabel: event.travelSourceLabel,
          }
        : null
    );
    setSelectedEditSuggestionStartAt(new Date(event.startAt).toISOString());
  }

  function handleCreateEvent() {
    if (eventSchedulingMode === "manual") {
      if (!createManualTiming) {
        return;
      }

      runAction(async () => {
        await createEventAction({
          title: eventTitle,
          startAt: createManualTiming.startAt.toISOString(),
          endAt: createManualTiming.endAt.toISOString(),
          travelMinutes: manualTravelEstimate?.travelMinutes || undefined,
          travelSourceLabel: manualTravelEstimate?.sourceLabel || undefined,
          ownerId: eventOwnerId || undefined,
          location: eventLocation || undefined,
          invites: eventInvites || undefined,
          notes: eventNotes || undefined,
        });
        setEventTitle("");
        setEventDate(formatDateInput(new Date()));
        setEventSchedulingMode("manual");
        setEventStartTime("09:00");
        setEventEndTime("10:00");
        setEventTimeOfDay("morning");
        setEventDurationMinutes("60");
        setEventLocation("");
        setEventInvites("");
        setEventNotes("");
        setManualTravelEstimate(null);
        setSuggestions([]);
        setSelectedSuggestionStartAt(null);
      });
      return;
    }

    if (!selectedSuggestion) {
      return;
    }

    runAction(async () => {
      await createEventAction({
        title: eventTitle,
        startAt: selectedSuggestion.startAt,
        durationMinutes: Number(eventDurationMinutes) || undefined,
        travelMinutes: selectedSuggestion.travelMinutes || undefined,
        travelSourceLabel: selectedSuggestion.sourceLabel || undefined,
        ownerId: eventOwnerId || undefined,
        location: eventLocation || undefined,
        invites: eventInvites || undefined,
        notes: eventNotes || undefined,
      });
      setEventTitle("");
      setEventDate(formatDateInput(new Date()));
      setEventTimeOfDay("morning");
      setEventDurationMinutes("60");
      setEventLocation("");
      setEventInvites("");
      setEventNotes("");
    });
  }

  function handleUpdateEvent() {
    if (!selectedEvent) {
      return;
    }

    if (editSchedulingMode === "manual") {
      if (!editManualTiming) {
        return;
      }

      runAction(async () => {
        await updateEventAction({
          eventId: selectedEvent.id,
          title: editTitle,
          startAt: editManualTiming.startAt.toISOString(),
          endAt: editManualTiming.endAt.toISOString(),
          travelMinutes: editTravelEstimate?.travelMinutes || undefined,
          travelSourceLabel: editTravelEstimate?.sourceLabel || undefined,
          ownerId: editOwnerId || undefined,
          location: editLocation || undefined,
          invites: editInvites || undefined,
          notes: editNotes || undefined,
        });
        setSelectedEventId(null);
      });
      return;
    }

    if (!selectedEditSuggestion) {
      return;
    }

    runAction(async () => {
      await updateEventAction({
        eventId: selectedEvent.id,
        title: editTitle,
        startAt: selectedEditSuggestion.startAt,
        durationMinutes: Number(editDurationMinutes) || undefined,
        travelMinutes: selectedEditSuggestion.travelMinutes || undefined,
        travelSourceLabel: selectedEditSuggestion.sourceLabel || undefined,
        ownerId: editOwnerId || undefined,
        location: editLocation || undefined,
        invites: editInvites || undefined,
        notes: editNotes || undefined,
      });
      setSelectedEventId(null);
    });
  }

  function handleDeleteEvent() {
    if (!selectedEvent) {
      return;
    }

    runAction(async () => {
      await deleteEventAction(selectedEvent.id);
      setSelectedEventId(null);
    });
  }

  function handleCreateCalendarSource() {
    runAction(async () => {
      await createCalendarSourceAction({
        name: calendarSourceName,
        url: calendarSourceUrl,
      });
      setCalendarSourceName("");
      setCalendarSourceUrl("");
      setShowCalendarSourceForm(false);
    });
  }

  function handleCalendarSourceColorChange(sourceId: string, color: string) {
    runAction(async () => {
      await updateCalendarSourceColorAction({ sourceId, color });
    });
  }

  function handleCalendarSourceDelete(sourceId: string) {
    runAction(async () => {
      await deleteCalendarSourceAction(sourceId);
    });
  }

  function handleCalendarSourceSync(sourceId: string) {
    runAction(async () => {
      await syncCalendarSourceAction(sourceId);
    });
  }

  function handleMonthExportJpeg() {
    const monthStart = startOfMonth(currentDate);
    const gridStart = startOfWeek(monthStart);
    const exportDays = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
    const width = 1600;
    const headerHeight = 150;
    const weekLabelHeight = 54;
    const cellHeight = 170;
    const padding = 32;
    const gridWidth = width - padding * 2;
    const cellWidth = gridWidth / 7;
    const height = headerHeight + weekLabelHeight + cellHeight * 6 + padding;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    context.fillStyle = "#08101f";
    context.fillRect(0, 0, width, height);

    drawRoundedRect(context, 10, 10, width - 20, height - 20, 28);
    context.strokeStyle = "rgba(255,255,255,0.08)";
    context.lineWidth = 1;
    context.stroke();

    context.fillStyle = "#ffffff";
    context.font = '600 42px sans-serif';
    context.textAlign = "left";
    context.fillText(
      formatDateLabel(currentDate, { month: "long", year: "numeric" }),
      padding,
      72
    );

    context.fillStyle = "#7dd3fc";
    context.font = '500 16px sans-serif';
    context.fillText("Monatsübersicht freie Tage", padding, 104);

    context.fillStyle = "#64748b";
    context.font = '600 14px sans-serif';
    ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].forEach((label, index) => {
      const centerX = padding + cellWidth * index + cellWidth / 2;
      context.textAlign = "center";
      context.fillText(label, centerX, headerHeight + 20);
    });

    exportDays.forEach((day, index) => {
      const column = index % 7;
      const row = Math.floor(index / 7);
      const x = padding + column * cellWidth;
      const y = headerHeight + weekLabelHeight + row * cellHeight;
      const inCurrentMonth = day.getMonth() === currentDate.getMonth();
      const availability = getDayAvailability(events, day);

      context.strokeStyle = "rgba(255,255,255,0.08)";
      context.strokeRect(x, y, cellWidth, cellHeight);

      if (!inCurrentMonth) {
        context.fillStyle = "rgba(148,163,184,0.08)";
        context.fillRect(x, y, cellWidth, cellHeight);
      }

      const centerX = x + cellWidth / 2;
      const dayY = y + 58;

      if (availability.isCompletelyFree && inCurrentMonth) {
        context.beginPath();
        context.strokeStyle = "#7dd3fc";
        context.lineWidth = 3;
        context.arc(centerX, dayY - 8, 28, 0, Math.PI * 2);
        context.stroke();
      }

      context.fillStyle = inCurrentMonth ? "#ffffff" : "#64748b";
      context.font = '600 34px sans-serif';
      context.textAlign = "center";
      context.fillText(String(day.getDate()), centerX, dayY + 4);

      if (availability.isPartiallyFree && inCurrentMonth) {
        context.beginPath();
        context.fillStyle = "#7dd3fc";
        context.arc(centerX, y + 112, 9, 0, Math.PI * 2);
        context.fill();
      }

      if (inCurrentMonth) {
        context.fillStyle = "#64748b";
        context.font = '500 13px sans-serif';
        context.fillText(
          availability.isCompletelyFree
            ? "frei"
            : availability.isPartiallyFree
              ? `${Math.floor(availability.freeMinutes / 60)}h frei`
              : "",
          centerX,
          y + 142
        );
      }
    });

    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/jpeg", 0.92);
    link.download = `kamtasks-kalender-${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}.jpg`;
    link.click();
  }

  const headerLabel =
    view === "day"
      ? formatDateLabel(currentDate, { weekday: "long", day: "2-digit", month: "long", year: "numeric" })
      : view === "week"
        ? formatRangeLabel(visibleDays[0], visibleDays[visibleDays.length - 1])
        : formatDateLabel(currentDate, { month: "long", year: "numeric" });

  const viewLabel = view === "day" ? "Tag" : view === "week" ? "7 Tage" : "Monat";

  return (
    <>
      <WorkspaceShell activeKey="calendar">
        <div className="grid gap-4">
          <WorkspaceHero
            eyebrow="Kalender"
            title={headerLabel}
            description="Tag, Woche und Monat folgen jetzt derselben Premium-Sprache wie der Rest von KAMTasks. Dazu kommen Vorschläge, manuelle Slots und Kalender-Sync in einer einzigen Fläche."
            meta={
              <WorkspaceStatGrid>
                <WorkspaceStatCard label="Ansicht" value={viewLabel} tone="cyan" />
                <WorkspaceStatCard label="Tage im Fokus" value={visibleDays.length} tone="amber" />
                <WorkspaceStatCard label="Quellen" value={calendarSources.length + 1} tone="slate" />
              </WorkspaceStatGrid>
            }
          />

          <div className="grid gap-4">
            <section className="rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,_rgba(12,19,36,0.96)_0%,_rgba(8,14,27,0.98)_100%)] p-5 shadow-[0_24px_90px_rgba(0,0,0,0.34)] md:p-6">
              <div className="flex flex-col gap-4 border-b border-white/8 pb-5 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Ansicht</p>
                  <h3 className="mt-2 text-2xl font-semibold text-white">Navigation und Darstellung</h3>
                  <p className="mt-2 max-w-2xl text-sm text-slate-400">
                    Tag-, 7-Tage- und Monatsansicht in einer ruhigen, iOS-inspirierten Kalenderdarstellung.
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                  <div className="grid grid-cols-3 rounded-2xl border border-white/10 bg-[#09101f] p-1 sm:flex">
                    {([
                      ["day", "Tag"],
                      ["week", "7 Tage"],
                      ["month", "Monat"],
                    ] as const).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setView(key)}
                        className={`rounded-xl px-4 py-2 text-sm transition ${
                          view === key ? "bg-cyan-300 text-slate-950" : "text-slate-300"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-3 gap-1 rounded-2xl border border-white/10 bg-[#09101f] p-1 sm:flex sm:items-center sm:gap-2">
                    <button
                      type="button"
                      onClick={() => shiftRange(-1)}
                      className="rounded-xl px-3 py-2 text-slate-300 transition hover:bg-white/5 hover:text-white"
                    >
                      Zurück
                    </button>
                    <button
                      type="button"
                      onClick={() => setCurrentDate(startOfDay(new Date()))}
                      className="rounded-xl px-3 py-2 text-slate-300 transition hover:bg-white/5 hover:text-white"
                    >
                      Heute
                    </button>
                    <button
                      type="button"
                      onClick={() => shiftRange(1)}
                      className="rounded-xl px-3 py-2 text-slate-300 transition hover:bg-white/5 hover:text-white"
                    >
                      Weiter
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleMonthExportJpeg}
                    className="rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3 text-sm text-white transition hover:border-white/20 hover:bg-white/5"
                  >
                    Monat als JPEG
                  </button>
                </div>
              </div>

              {view === "month" ? (
                <div className="mt-5 overflow-hidden rounded-[24px] border border-white/10 bg-[#09101f]">
                  <div className="grid grid-cols-7 border-b border-white/8 bg-[#0b1325]">
                    {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((label) => (
                      <div
                        key={label}
                        className="border-l border-white/8 px-1 py-2 text-center text-[10px] uppercase tracking-[0.16em] text-slate-500 first:border-l-0 md:px-3 md:py-3 md:text-[11px] md:tracking-[0.2em]"
                      >
                        {label}
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7">
                    {visibleDays.map((day, index) => {
                      const allDayEvents = monthEvents.filter((event) => overlapsDay(event, day));
                      const dayEvents = allDayEvents.slice(0, 2);
                      const inCurrentMonth = day.getMonth() === currentDate.getMonth();

                      return (
                        <div
                          key={index}
                          className="min-h-[84px] border-l border-t border-white/8 bg-[#09101f] p-2 first:border-l-0 md:min-h-[152px] md:p-3"
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs md:h-9 md:w-9 md:text-sm ${
                                isSameDay(day, new Date())
                                  ? "bg-cyan-300 text-slate-950"
                                  : inCurrentMonth
                                    ? "text-white"
                                    : "text-slate-600"
                              }`}
                            >
                              {day.getDate()}
                            </span>
                            {allDayEvents.length > 2 ? (
                              <span className="text-[10px] text-slate-500 md:text-xs">+{allDayEvents.length - 2}</span>
                            ) : null}
                          </div>

                          <div className="mt-2 md:hidden">
                            {allDayEvents.length > 0 ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setCurrentDate(startOfDay(day));
                                  setView("day");
                                }}
                                className="flex w-full items-center justify-between rounded-lg border border-white/8 bg-[#0c1324] px-2 py-1.5 text-left"
                              >
                                <span className="text-[10px] text-slate-400">{allDayEvents.length} Termine</span>
                                <span className="flex items-center gap-1">
                                  {allDayEvents.slice(0, 3).map((event) => (
                                    <span
                                      key={event.id}
                                      className="h-1.5 w-1.5 rounded-full"
                                      style={{ backgroundColor: getEventAccentColor(event) }}
                                    />
                                  ))}
                                </span>
                              </button>
                            ) : null}
                          </div>

                          <div className="mt-3 hidden space-y-2 md:block">
                            {dayEvents.map((event) => (
                              <button
                                key={event.id}
                                type="button"
                                onClick={() => openEventModal(event)}
                                className="block w-full rounded-xl border px-3 py-2 text-left transition"
                                style={{
                                  borderColor: `${getEventAccentColor(event)}33`,
                                  backgroundColor: "rgba(15, 23, 41, 0.94)",
                                }}
                              >
                                <p className="truncate text-xs font-semibold text-white">{event.title}</p>
                                <p
                                  className="mt-1 text-[11px]"
                                  style={{ color: `${getEventAccentColor(event)}cc` }}
                                >
                                  {formatTime(event.startAt)}
                                </p>
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="mt-5 overflow-hidden rounded-[24px] border border-white/10 bg-[#09101f]">
                  <div className="space-y-3 p-3 md:hidden">
                    {timelineDays.map((day) => {
                      const segments = buildDaySegments(events, day);

                      return (
                        <section key={day.toISOString()} className="rounded-[18px] border border-white/10 bg-[#0c1324] p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
                                {formatDateLabel(day, { weekday: "short" })}
                              </p>
                              <p className="mt-1 text-sm font-medium text-white">
                                {formatDateLabel(day, { day: "2-digit", month: "2-digit" })}
                              </p>
                            </div>
                            <span className="text-xs text-slate-500">{segments.length} Termine</span>
                          </div>

                          <div className="mt-3 space-y-2">
                            {segments.length === 0 ? (
                              <div className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-sm text-slate-500">
                                Keine Termine.
                              </div>
                            ) : (
                              segments.map((segment) => {
                                const accentColor = getEventAccentColor(segment.event);

                                return (
                                  <button
                                    key={`${segment.event.id}-${day.toISOString()}`}
                                    type="button"
                                    onClick={() => openEventModal(segment.event)}
                                    className="block w-full rounded-xl border px-3 py-3 text-left transition"
                                    style={{
                                      borderColor: `${accentColor}55`,
                                      background: `linear-gradient(180deg, ${accentColor}22 0%, rgba(12,19,36,0.95) 100%)`,
                                    }}
                                  >
                                    <p className="text-sm font-semibold text-white">{segment.event.title}</p>
                                    <p className="mt-1 text-xs" style={{ color: `${accentColor}dd` }}>
                                      {formatTime(segment.start)} - {formatTime(segment.end)}
                                    </p>
                                  </button>
                                );
                              })
                            )}
                          </div>
                        </section>
                      );
                    })}
                  </div>

                  <div
                    className="hidden border-b border-white/8 bg-[#0b1325] md:grid"
                    style={{ gridTemplateColumns: `72px repeat(${dayColumns}, minmax(0, 1fr))` }}
                  >
                    <div />
                    {timelineDays.map((day) => (
                      <div
                        key={day.toISOString()}
                        className="border-l border-white/8 px-3 py-3 text-center first:border-l-0"
                      >
                        <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                          {formatDateLabel(day, { weekday: "short" })}
                        </p>
                        <p className="mt-1 text-sm font-medium text-white">
                          {formatDateLabel(day, { day: "2-digit", month: "2-digit" })}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="hidden overflow-x-auto md:block">
                    <div
                      className="grid min-w-[880px]"
                      style={{ gridTemplateColumns: `72px repeat(${dayColumns}, minmax(0, 1fr))` }}
                    >
                      <div className="border-r border-white/8 bg-[#0c1324]">
                        {Array.from({ length: 24 }).map((_, hour) => (
                          <div
                            key={hour}
                            className="border-b border-white/6 px-3 pt-2 text-right text-[11px] text-slate-500"
                            style={{ height: `${hourRowHeight}px` }}
                          >
                            {String(hour).padStart(2, "0")}:00
                          </div>
                        ))}
                      </div>

                      {timelineDays.map((day) => {
                        const segments = buildDaySegments(events, day);

                        return (
                          <div
                            key={day.toISOString()}
                            className="relative border-l border-white/8 first:border-l-0"
                            style={{ height: `${24 * hourRowHeight}px` }}
                          >
                            {Array.from({ length: 24 }).map((_, hour) => (
                              <div
                                key={hour}
                                className="border-b border-white/6"
                                style={{ height: `${hourRowHeight}px` }}
                              />
                            ))}

                            {segments.map((segment) => {
                              const startMinutes = minutesSinceDayStart(segment.start);
                              const endMinutes = Math.max(minutesSinceDayStart(segment.end), startMinutes + 15);
                              const top = (startMinutes / 60) * hourRowHeight;
                              const height = ((endMinutes - startMinutes) / 60) * hourRowHeight;
                              const width = `calc(${100 / segment.laneCount}% - 6px)`;
                              const left = `calc(${(100 / segment.laneCount) * segment.lane}% + 3px)`;
                              const accentColor = getEventAccentColor(segment.event);

                              return (
                                <button
                                  key={`${segment.event.id}-${day.toISOString()}`}
                                  type="button"
                                  onClick={() => openEventModal(segment.event)}
                                  className="absolute rounded-2xl border px-3 py-2 text-left shadow-[0_16px_40px_rgba(0,0,0,0.18)] transition"
                                  style={{
                                    top,
                                    left,
                                    width,
                                    height: Math.max(height, 28),
                                    borderColor: `${accentColor}66`,
                                    background: `linear-gradient(180deg, ${accentColor}44 0%, ${accentColor}20 100%)`,
                                  }}
                                >
                                  <p className="truncate text-xs font-semibold text-white">
                                    {segment.event.title}
                                  </p>
                                  <p className="mt-1 truncate text-[11px]" style={{ color: `${accentColor}dd` }}>
                                    {formatTime(segment.start)} - {formatTime(segment.end)}
                                  </p>
                                </button>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </section>

            <section className="rounded-[28px] border border-white/10 bg-[#0c1324] p-5 shadow-[0_20px_80px_rgba(0,0,0,0.35)] md:p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm uppercase tracking-[0.35em] text-slate-500">Termin anlegen</p>
                  <h3 className="mt-2 text-xl font-semibold text-white">Neuer Kalendereintrag</h3>
                </div>
                <div className="text-xs text-slate-500">unter dem Hauptkalender</div>
              </div>

              <div className="mt-5 grid gap-3 lg:grid-cols-2">
                <input
                  value={eventTitle}
                  onChange={(event) => setEventTitle(event.target.value)}
                  placeholder="Terminname"
                  className="rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400/40"
                />
                <select
                  value={eventOwnerId}
                  onChange={(event) => setEventOwnerId(event.target.value)}
                  className="rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40"
                >
                  <option value="">Kein User</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
                <div className="rounded-[24px] border border-white/10 bg-[#09101f] p-4 lg:col-span-2">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Planung</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {schedulingModeOptions.map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setEventSchedulingMode(option.key)}
                        className={`rounded-2xl border px-4 py-3 text-sm transition ${
                          eventSchedulingMode === option.key
                            ? "border-cyan-300/40 bg-cyan-300/10 text-white"
                            : "border-white/10 bg-[#0c1324] text-slate-400 hover:border-cyan-300/30 hover:text-white"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  type="date"
                  value={eventDate}
                  onChange={(event) => setEventDate(event.target.value)}
                  className="rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40"
                />
                {eventSchedulingMode === "manual" ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <input
                      type="time"
                      value={eventStartTime}
                      onChange={(event) => setEventStartTime(event.target.value)}
                      className="rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40"
                    />
                    <input
                      type="time"
                      value={eventEndTime}
                      onChange={(event) => setEventEndTime(event.target.value)}
                      className="rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40"
                    />
                  </div>
                ) : (
                  <select
                    value={eventTimeOfDay}
                    onChange={(event) => setEventTimeOfDay(event.target.value as typeof eventTimeOfDay)}
                    className="rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40"
                  >
                    {timeOfDayOptions.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
                {eventSchedulingMode === "manual" ? (
                  <div className="rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3 text-sm text-slate-400">
                    Feste Start- und Endzeit. Die Anfahrt wird separat davor berechnet.
                  </div>
                ) : (
                  <div className="flex items-center rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3">
                    <input
                      value={eventDurationMinutes}
                      onChange={(event) => setEventDurationMinutes(event.target.value)}
                      inputMode="numeric"
                      placeholder="60"
                      className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
                    />
                    <span className="ml-3 shrink-0 text-sm text-slate-500">Minuten</span>
                  </div>
                )}
                <input
                  value={eventLocation}
                  onChange={(event) => setEventLocation(event.target.value)}
                  placeholder="Ort"
                  className="rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400/40"
                />
                <select
                  value={eventDepartureOriginKey}
                  onChange={(event) => setEventDepartureOriginKey(event.target.value)}
                  className="rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40"
                >
                  {departureOrigins.map((origin) => (
                    <option key={origin.key} value={origin.key}>
                      {origin.label} ({origin.address})
                    </option>
                  ))}
                </select>
                <input
                  value={eventInvites}
                  onChange={(event) => setEventInvites(event.target.value)}
                  placeholder="Einladungen (E-Mails, kommagetrennt)"
                  className="rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400/40"
                />
                <textarea
                  value={eventNotes}
                  onChange={(event) => setEventNotes(event.target.value)}
                  placeholder="Notizen"
                  rows={4}
                  className="rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400/40 lg:col-span-2"
                />
                {eventSchedulingMode === "manual" && !createManualTiming ? (
                  <div className="rounded-2xl border border-rose-400/20 bg-rose-400/[0.06] px-4 py-3 text-sm text-rose-200 lg:col-span-2">
                    Die Endzeit muss nach der Startzeit liegen.
                  </div>
                ) : null}
                <button
                  type="button"
                  disabled={isPending || !canCreateEvent}
                  onClick={handleCreateEvent}
                  className="rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-medium text-slate-950 transition hover:bg-cyan-200 disabled:opacity-60 lg:col-span-2"
                >
                  Termin speichern
                </button>
              </div>

              {eventSchedulingMode === "manual" ? (
                <div className="mt-5 rounded-[24px] border border-white/10 bg-[#09101f] p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Anfahrt</p>
                      <p className="mt-1 text-sm text-white">Die Terminzeit bleibt fix, die Anfahrt wird davor eingeplant.</p>
                    </div>
                    <p className="text-[11px] text-slate-500">Routing via OSM Nominatim + OSRM</p>
                  </div>

                  {!eventLocation.trim() ? (
                    <div className="mt-4 rounded-2xl border border-dashed border-white/10 px-4 py-5 text-sm text-slate-500">
                      Ort hinterlegen, um die Anfahrtszeit zu berechnen.
                    </div>
                  ) : isManualTravelLoading ? (
                    <div className="mt-4 rounded-2xl border border-white/10 px-4 py-5 text-sm text-slate-400">
                      Anfahrt wird berechnet...
                    </div>
                  ) : manualTravelEstimate ? (
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <div className="rounded-2xl border border-white/10 bg-[#0c1324] px-4 py-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Anfahrt</p>
                        <p className="mt-2 text-lg font-semibold text-white">{manualTravelEstimate.travelMinutes} Min.</p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-[#0c1324] px-4 py-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Abfahrt</p>
                        <p className="mt-2 text-lg font-semibold text-white">
                          {createDepartureAt ? formatTime(createDepartureAt) : "--:--"}
                        </p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-[#0c1324] px-4 py-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Von</p>
                        <p className="mt-2 text-sm text-slate-300">{manualTravelEstimate.sourceLabel}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-2xl border border-dashed border-white/10 px-4 py-5 text-sm text-slate-500">
                      Keine Anfahrtsdaten gefunden.
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-5 rounded-[24px] border border-white/10 bg-[#09101f] p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Vorschläge</p>
                      <p className="mt-1 text-sm text-white">3 Terminoptionen mit 15 Minuten Puffer</p>
                    </div>
                    <p className="text-[11px] text-slate-500">Routing via OSM Nominatim + OSRM</p>
                  </div>

                  <div className="mt-4 grid gap-3 xl:grid-cols-3">
                    {isSuggestionsLoading ? (
                      <div className="rounded-2xl border border-white/10 px-4 py-5 text-sm text-slate-400 lg:col-span-3">
                        Vorschläge werden berechnet...
                      </div>
                    ) : suggestions.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-white/10 px-4 py-5 text-sm text-slate-500 lg:col-span-3">
                        Keine Vorschläge gefunden.
                      </div>
                    ) : (
                      suggestions.map((suggestion, index) => (
                        <button
                          key={`${suggestion.startAt}-${index}`}
                          type="button"
                          onClick={() => {
                            setSelectedSuggestionStartAt(suggestion.startAt);
                          }}
                          className={`rounded-2xl border p-4 text-left transition ${
                            selectedSuggestionStartAt === suggestion.startAt
                              ? "border-cyan-300/40 bg-cyan-300/10"
                              : "border-white/10 bg-[#0c1324] hover:border-cyan-300/30"
                          }`}
                        >
                          <p className="text-xs text-slate-500">
                            {formatDateLabel(suggestion.startAt, {
                              weekday: "short",
                              day: "2-digit",
                              month: "2-digit",
                            })}
                          </p>
                          <p className="text-sm font-medium text-white">
                            {formatTime(suggestion.startAt)} - {formatTime(suggestion.endAt)}
                          </p>
                          <p className="mt-2 text-xs text-slate-400">
                            Anfahrt: {suggestion.travelMinutes} Min.
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            Von: {suggestion.sourceLabel}
                          </p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </section>

            <section className="rounded-[28px] border border-white/10 bg-[#0c1324] p-5 shadow-[0_20px_80px_rgba(0,0,0,0.35)] md:p-6">
              <div className="flex flex-col gap-4 border-b border-white/8 pb-5 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-sm uppercase tracking-[0.35em] text-slate-500">Kalender-Sync</p>
                  <h3 className="mt-2 text-xl font-semibold text-white">Eingebundene Kalender</h3>
                  <p className="mt-2 max-w-2xl text-sm text-slate-400">
                    Externe ICS- oder Webcal-Links werden beim Aufruf automatisch nachgezogen, sobald die letzte Synchronisation mehr als 15 Minuten zurückliegt.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setShowCalendarSourceForm((current) => !current)}
                  className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-[#09101f] text-2xl text-white transition hover:border-cyan-300/30 hover:text-cyan-200"
                >
                  +
                </button>
              </div>

              {showCalendarSourceForm ? (
                <div className="mt-5 grid gap-3 rounded-[24px] border border-white/10 bg-[#09101f] p-4 lg:grid-cols-[1fr_1.4fr_auto]">
                  <input
                    value={calendarSourceName}
                    onChange={(event) => setCalendarSourceName(event.target.value)}
                    placeholder="Kalendername"
                    className="rounded-2xl border border-white/10 bg-[#0c1324] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400/40"
                  />
                  <input
                    value={calendarSourceUrl}
                    onChange={(event) => setCalendarSourceUrl(event.target.value)}
                    placeholder="ICS- oder Webcal-Link"
                    className="rounded-2xl border border-white/10 bg-[#0c1324] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400/40"
                  />
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={handleCreateCalendarSource}
                    className="rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-medium text-slate-950 transition hover:bg-cyan-200 disabled:opacity-60"
                  >
                    Kalender anbinden
                  </button>
                </div>
              ) : null}

              <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.9fr)]">
                <div className="rounded-[24px] border border-white/10 bg-[#09101f] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Quellen</p>
                      <p className="mt-1 text-sm text-slate-300">Alle eingebundenen Kalender mit eigener Farbe und Sync-Status.</p>
                    </div>
                    <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-slate-400">
                      {calendarSources.length} aktiv
                    </span>
                  </div>

                  <div className="mt-4 space-y-3">
                    {calendarSources.length === 0 ? (
                      <div className="rounded-[22px] border border-dashed border-white/10 bg-[#0c1324] px-4 py-8 text-center text-sm text-slate-500">
                        Noch kein externer Kalender eingebunden.
                      </div>
                    ) : (
                      calendarSources.map((source) => (
                        <div
                          key={source.id}
                          className="rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,_rgba(12,19,36,0.96)_0%,_rgba(8,14,27,0.96)_100%)] p-4 shadow-[0_18px_48px_rgba(0,0,0,0.22)]"
                        >
                          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-3">
                                <span
                                  className="h-3 w-3 rounded-full ring-4"
                                  style={{
                                    backgroundColor: source.color,
                                    boxShadow: `0 0 0 4px ${source.color}22`,
                                  }}
                                />
                                <p className="text-base font-semibold text-white">{source.name}</p>
                                <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-400">
                                  ICS / Webcal
                                </span>
                              </div>

                              <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1.35fr)_minmax(220px,0.85fr)]">
                                <div className="rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-3">
                                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Link</p>
                                  <p className="mt-2 break-all text-sm text-slate-300">{source.url}</p>
                                </div>
                                <div className="rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-3">
                                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Sync</p>
                                  <p className="mt-2 text-sm text-white">{source.lastSyncStatus || "Warte auf ersten Import"}</p>
                                  <p className="mt-1 text-xs text-slate-500">{formatSyncLabel(source.lastSyncedAt)}</p>
                                </div>
                              </div>
                            </div>

                            <div className="flex shrink-0 flex-wrap items-center gap-3 xl:w-[240px] xl:justify-end">
                              <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
                                <span>Farbe</span>
                                <span
                                  className="relative h-11 w-11 overflow-hidden rounded-full border border-white/10 shadow-[0_0_0_1px_rgba(255,255,255,0.04)]"
                                  style={{ backgroundColor: source.color }}
                                >
                                  <input
                                    type="color"
                                    value={source.color}
                                    onChange={(event) => handleCalendarSourceColorChange(source.id, event.target.value)}
                                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                                  />
                                </span>
                              </label>
                              <button
                                type="button"
                                disabled={isPending}
                                onClick={() => handleCalendarSourceSync(source.id)}
                                className="rounded-2xl border border-cyan-300/15 bg-cyan-300/10 px-4 py-3 text-sm text-cyan-100 transition hover:border-cyan-300/35 hover:bg-cyan-300/14 hover:text-white disabled:opacity-60"
                              >
                                Jetzt syncen
                              </button>
                              <button
                                type="button"
                                disabled={isPending}
                                onClick={() => handleCalendarSourceDelete(source.id)}
                                className="rounded-2xl border border-rose-400/20 bg-rose-400/[0.06] px-4 py-3 text-sm text-rose-200 transition hover:bg-rose-400/10 disabled:opacity-60"
                              >
                                Entfernen
                              </button>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="rounded-[24px] border border-white/10 bg-[#09101f] p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Live Sync</p>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    Externe Geräte können den Feed unter dem Kalendernamen <span className="font-medium text-white">KAMtasks</span> abonnieren.
                  </p>

                  <div className="mt-4 rounded-[22px] border border-cyan-300/14 bg-[linear-gradient(180deg,_rgba(34,211,238,0.08)_0%,_rgba(12,19,36,0.75)_100%)] p-4">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-200/80">Webcal-Link</p>
                    {feedUrl ? (
                      <>
                        <a
                          href={feedUrl.replace(/^https?/, "webcal")}
                          className="mt-3 block break-all text-sm text-cyan-200 transition hover:text-cyan-100"
                        >
                          {feedUrl.replace(/^https?/, "webcal")}
                        </a>
                        <div className="mt-4 rounded-2xl border border-white/8 bg-[#0c1324] px-4 py-3">
                          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">HTTP-Fallback</p>
                          <a
                            href={feedUrl}
                            className="mt-2 block break-all text-xs text-slate-400 transition hover:text-slate-200"
                          >
                            {feedUrl}
                          </a>
                        </div>
                      </>
                    ) : (
                      <p className="mt-3 text-sm text-slate-500">Feed-Link wird geladen.</p>
                    )}
                  </div>

                  <div className="mt-4 rounded-[22px] border border-white/8 bg-white/[0.02] px-4 py-4">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Hinweis</p>
                    <p className="mt-2 text-sm leading-6 text-slate-400">
                      Die importierten Kalender werden beim Öffnen der Seite und danach bei geöffneter Ansicht im 15-Minuten-Takt aktualisiert.
                    </p>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </WorkspaceShell>

      {selectedEvent ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#020617]/70 p-4 backdrop-blur-sm">
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-[28px] border border-white/10 bg-[#0c1324] p-5 shadow-[0_30px_120px_rgba(0,0,0,0.45)] md:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Termin</p>
                <h3 className="mt-2 text-2xl font-semibold text-white">{selectedEvent.title}</h3>
                <p className="mt-2 text-sm text-slate-400">
                  {formatDateLabel(selectedEvent.startAt, {
                    weekday: "long",
                    day: "2-digit",
                    month: "long",
                    year: "numeric",
                  })}{" "}
                  {formatTime(selectedEvent.startAt)} - {formatTime(selectedEvent.endAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEventId(null)}
                className="rounded-2xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:border-white/20 hover:text-white"
              >
                Schließen
              </button>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <input
                value={editTitle}
                onChange={(event) => setEditTitle(event.target.value)}
                className="rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40"
              />
              <select
                value={editOwnerId}
                onChange={(event) => setEditOwnerId(event.target.value)}
                className="rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40"
              >
                <option value="">Kein User</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
              <div className="rounded-[24px] border border-white/10 bg-[#09101f] p-4 md:col-span-2">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Planung</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {schedulingModeOptions.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setEditSchedulingMode(option.key)}
                      className={`rounded-2xl border px-4 py-3 text-sm transition ${
                        editSchedulingMode === option.key
                          ? "border-cyan-300/40 bg-cyan-300/10 text-white"
                          : "border-white/10 bg-[#0c1324] text-slate-400 hover:border-cyan-300/30 hover:text-white"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <input
                type="date"
                value={editDate}
                onChange={(event) => setEditDate(event.target.value)}
                className="rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40"
              />
              {editSchedulingMode === "manual" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <input
                    type="time"
                    value={editStartTime}
                    onChange={(event) => setEditStartTime(event.target.value)}
                    className="rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40"
                  />
                  <input
                    type="time"
                    value={editEndTime}
                    onChange={(event) => setEditEndTime(event.target.value)}
                    className="rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40"
                  />
                </div>
              ) : (
                <select
                  value={editTimeOfDay}
                  onChange={(event) => setEditTimeOfDay(event.target.value as typeof editTimeOfDay)}
                  className="rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40"
                >
                  {timeOfDayOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}
              {editSchedulingMode === "manual" ? (
                <div className="rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3 text-sm text-slate-400">
                  Feste Start- und Endzeit. Die Anfahrt wird separat davor berechnet.
                </div>
              ) : (
                <div className="flex items-center rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3">
                  <input
                    value={editDurationMinutes}
                    onChange={(event) => setEditDurationMinutes(event.target.value)}
                    inputMode="numeric"
                    placeholder="60"
                    className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
                  />
                  <span className="ml-3 shrink-0 text-sm text-slate-500">Minuten</span>
                </div>
              )}
              <input
                value={editLocation}
                onChange={(event) => setEditLocation(event.target.value)}
                placeholder="Ort"
                className="rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400/40"
              />
              <select
                value={editDepartureOriginKey}
                onChange={(event) => setEditDepartureOriginKey(event.target.value)}
                className="rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40"
              >
                {departureOrigins.map((origin) => (
                  <option key={origin.key} value={origin.key}>
                    {origin.label} ({origin.address})
                  </option>
                ))}
              </select>
              <input
                value={editInvites}
                onChange={(event) => setEditInvites(event.target.value)}
                placeholder="Einladungen (E-Mails, kommagetrennt)"
                className="rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400/40"
              />
              <textarea
                value={editNotes}
                onChange={(event) => setEditNotes(event.target.value)}
                rows={4}
                className="rounded-2xl border border-white/10 bg-[#09101f] px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/40 md:col-span-2"
              />
              {editSchedulingMode === "manual" && !editManualTiming ? (
                <div className="rounded-2xl border border-rose-400/20 bg-rose-400/[0.06] px-4 py-3 text-sm text-rose-200 md:col-span-2">
                  Die Endzeit muss nach der Startzeit liegen.
                </div>
              ) : null}
            </div>

            {editSchedulingMode === "manual" ? (
              <div className="mt-5 rounded-[24px] border border-white/10 bg-[#09101f] p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Anfahrt</p>
                    <p className="mt-1 text-sm text-white">Die Terminzeit bleibt fix, die Anfahrt wird davor eingeplant.</p>
                  </div>
                  <p className="text-[11px] text-slate-500">Routing via OSM Nominatim + OSRM</p>
                </div>

                {!editLocation.trim() ? (
                  <div className="mt-4 rounded-2xl border border-dashed border-white/10 px-4 py-5 text-sm text-slate-500">
                    Ort hinterlegen, um die Anfahrtszeit zu berechnen.
                  </div>
                ) : isEditTravelLoading ? (
                  <div className="mt-4 rounded-2xl border border-white/10 px-4 py-5 text-sm text-slate-400">
                    Anfahrt wird berechnet...
                  </div>
                ) : editTravelEstimate ? (
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div className="rounded-2xl border border-white/10 bg-[#0c1324] px-4 py-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Anfahrt</p>
                      <p className="mt-2 text-lg font-semibold text-white">{editTravelEstimate.travelMinutes} Min.</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-[#0c1324] px-4 py-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Abfahrt</p>
                      <p className="mt-2 text-lg font-semibold text-white">
                        {editDepartureAt ? formatTime(editDepartureAt) : "--:--"}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-[#0c1324] px-4 py-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Von</p>
                      <p className="mt-2 text-sm text-slate-300">{editTravelEstimate.sourceLabel}</p>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-dashed border-white/10 px-4 py-5 text-sm text-slate-500">
                    Keine Anfahrtsdaten gefunden.
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                {isEditSuggestionsLoading ? (
                  <div className="rounded-2xl border border-white/10 px-4 py-5 text-sm text-slate-400 md:col-span-3">
                    Vorschläge werden berechnet...
                  </div>
                ) : editSuggestions.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 px-4 py-5 text-sm text-slate-500 md:col-span-3">
                    Keine Vorschläge gefunden.
                  </div>
                ) : (
                  editSuggestions.map((suggestion, index) => (
                    <button
                      key={`${suggestion.startAt}-${index}`}
                      type="button"
                      onClick={() => setSelectedEditSuggestionStartAt(suggestion.startAt)}
                      className={`rounded-2xl border p-4 text-left transition ${
                        selectedEditSuggestionStartAt === suggestion.startAt
                          ? "border-cyan-300/40 bg-cyan-300/10"
                          : "border-white/10 bg-[#09101f] hover:border-cyan-300/30"
                      }`}
                    >
                      <p className="text-xs text-slate-500">
                        {formatDateLabel(suggestion.startAt, {
                          weekday: "short",
                          day: "2-digit",
                          month: "2-digit",
                        })}
                      </p>
                      <p className="text-sm font-medium text-white">
                        {formatTime(suggestion.startAt)} - {formatTime(suggestion.endAt)}
                      </p>
                      <p className="mt-2 text-xs text-slate-400">
                        Anfahrt: {suggestion.travelMinutes} Min.
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Von: {suggestion.sourceLabel}
                      </p>
                    </button>
                  ))
                )}
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-2 text-xs text-slate-400">
              {selectedEvent.owner ? <span className="rounded-full border border-white/10 px-3 py-1">{selectedEvent.owner.name}</span> : null}
              {selectedEvent.travelMinutes ? <span className="rounded-full border border-white/10 px-3 py-1">{selectedEvent.travelMinutes} Min. Anfahrt</span> : null}
              {selectedEvent.location ? <span className="rounded-full border border-white/10 px-3 py-1">{selectedEvent.location}</span> : null}
              {selectedEvent.invites ? <span className="rounded-full border border-white/10 px-3 py-1">{selectedEvent.invites}</span> : null}
              {selectedEvent.calendarSource ? (
                <span
                  className="rounded-full border px-3 py-1"
                  style={{
                    borderColor: `${selectedEvent.calendarSource.color}66`,
                    color: selectedEvent.calendarSource.color,
                  }}
                >
                  {selectedEvent.calendarSource.name}
                </span>
              ) : null}
              <span className="rounded-full border border-white/10 px-3 py-1">{selectedEvent.tasks.length} verknüpfte Aufgaben</span>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-between">
              <button
                type="button"
                disabled={isPending}
                onClick={handleDeleteEvent}
                className="w-full rounded-2xl border border-rose-400/25 px-4 py-3 text-sm text-rose-200 transition hover:bg-rose-400/10 disabled:opacity-60 sm:w-auto"
              >
                Termin löschen
              </button>
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => setSelectedEventId(null)}
                  className="w-full rounded-2xl border border-white/10 px-4 py-3 text-sm text-slate-300 transition hover:border-white/20 hover:text-white sm:w-auto"
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  disabled={isPending || !canUpdateEvent}
                  onClick={handleUpdateEvent}
                  className="w-full rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-medium text-slate-950 transition hover:bg-cyan-200 disabled:opacity-60 sm:w-auto"
                >
                  Änderungen speichern
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
