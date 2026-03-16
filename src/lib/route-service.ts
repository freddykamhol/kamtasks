type Coordinates = {
  lat: number;
  lon: number;
};

const geocodeCache = new Map<string, Coordinates | null>();
const geocodeRequestCache = new Map<string, Promise<Coordinates | null>>();
const routeCache = new Map<string, number>();
const routeRequestCache = new Map<string, Promise<number>>();
const GEOCODE_TIMEOUT_MS = 1_800;
const ROUTE_TIMEOUT_MS = 2_200;

function normalizeAddress(address: string) {
  return address
    .trim()
    .replace(/([A-Za-zÄÖÜäöüß])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-zÄÖÜäöüß])/g, "$1 $2")
    .replace(/\s+/g, " ");
}

function getDistanceInKilometers(from: Coordinates, to: Coordinates) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const latDelta = toRadians(to.lat - from.lat);
  const lonDelta = toRadians(to.lon - from.lon);
  const a =
    Math.sin(latDelta / 2) * Math.sin(latDelta / 2) +
    Math.cos(toRadians(from.lat)) *
      Math.cos(toRadians(to.lat)) *
      Math.sin(lonDelta / 2) *
      Math.sin(lonDelta / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function estimateTravelMinutes(from: Coordinates, to: Coordinates) {
  const distanceKm = getDistanceInKilometers(from, to);

  if (distanceKm < 0.35) {
    return 5;
  }

  // Conservative urban/suburban fallback if the routing API does not answer.
  return Math.max(Math.round((distanceKm / 38) * 60 + 4), 5);
}

async function fetchJsonWithTimeout<T>(url: URL, init: RequestInit, timeoutMs: number) {
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function geocodeAddress(address: string) {
  const normalized = normalizeAddress(address);

  if (!normalized) {
    return null;
  }

  if (geocodeCache.has(normalized)) {
    return geocodeCache.get(normalized) ?? null;
  }

  const inFlightLookup = geocodeRequestCache.get(normalized);

  if (inFlightLookup) {
    return inFlightLookup;
  }

  const queryVariants = normalized === address.trim() ? [normalized] : [normalized, address.trim()];
  const lookupPromise = (async () => {
    for (const query of queryVariants) {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("limit", "1");
      url.searchParams.set("countrycodes", "de");
      url.searchParams.set("q", query);

      const data = await fetchJsonWithTimeout<Array<{ lat: string; lon: string }>>(
        url,
        {
          headers: {
            "User-Agent": "KAMTasks/1.0 (calendar suggestions)",
            Accept: "application/json",
          },
          next: { revalidate: 60 * 60 * 12 },
        },
        GEOCODE_TIMEOUT_MS
      );
      const first = data?.[0];

      if (!first) {
        continue;
      }

      const coordinates = {
        lat: Number(first.lat),
        lon: Number(first.lon),
      };

      geocodeCache.set(normalized, coordinates);
      return coordinates;
    }

    geocodeCache.set(normalized, null);
    return null;
  })();

  geocodeRequestCache.set(normalized, lookupPromise);

  try {
    return await lookupPromise;
  } finally {
    geocodeRequestCache.delete(normalized);
  }
}

export async function getTravelMinutesBetweenAddresses(fromAddress: string, toAddress: string) {
  const normalizedFrom = normalizeAddress(fromAddress);
  const normalizedTo = normalizeAddress(toAddress);
  const cacheKey = `${normalizedFrom}__${normalizedTo}`;

  if (!normalizedFrom || !normalizedTo) {
    return 0;
  }

  if (routeCache.has(cacheKey)) {
    return routeCache.get(cacheKey) ?? 0;
  }

  const inFlightLookup = routeRequestCache.get(cacheKey);

  if (inFlightLookup) {
    return inFlightLookup;
  }

  const lookupPromise = (async () => {
    const [fromCoordinates, toCoordinates] = await Promise.all([
      geocodeAddress(normalizedFrom),
      geocodeAddress(normalizedTo),
    ]);

    if (!fromCoordinates || !toCoordinates) {
      routeCache.set(cacheKey, 0);
      return 0;
    }

    const url = new URL(
      `https://router.project-osrm.org/route/v1/driving/${fromCoordinates.lon},${fromCoordinates.lat};${toCoordinates.lon},${toCoordinates.lat}`
    );
    url.searchParams.set("overview", "false");

    const data = await fetchJsonWithTimeout<{
      routes?: Array<{ duration?: number }>;
    }>(
      url,
      {
        headers: {
          "User-Agent": "KAMTasks/1.0 (calendar suggestions)",
          Accept: "application/json",
        },
        next: { revalidate: 60 * 60 * 12 },
      },
      ROUTE_TIMEOUT_MS
    );
    const duration = data?.routes?.[0]?.duration;
    const minutes =
      typeof duration === "number" && duration > 0
        ? Math.max(Math.round(duration / 60), 1)
        : estimateTravelMinutes(fromCoordinates, toCoordinates);

    routeCache.set(cacheKey, minutes);
    return minutes;
  })();

  routeRequestCache.set(cacheKey, lookupPromise);

  try {
    return await lookupPromise;
  } finally {
    routeRequestCache.delete(cacheKey);
  }
}
