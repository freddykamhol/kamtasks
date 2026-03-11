type Coordinates = {
  lat: number;
  lon: number;
};

const geocodeCache = new Map<string, Coordinates | null>();
const routeCache = new Map<string, number>();

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

async function geocodeAddress(address: string) {
  const normalized = normalizeAddress(address);

  if (!normalized) {
    return null;
  }

  if (geocodeCache.has(normalized)) {
    return geocodeCache.get(normalized) ?? null;
  }

  const queryVariants = normalized === address.trim() ? [normalized] : [normalized, address.trim()];

  for (const query of queryVariants) {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("countrycodes", "de");
    url.searchParams.set("q", query);

    const response = await fetch(url, {
      headers: {
        "User-Agent": "KAMTasks/1.0 (calendar suggestions)",
        Accept: "application/json",
      },
      next: { revalidate: 60 * 60 * 12 },
    });

    if (!response.ok) {
      continue;
    }

    const data = (await response.json()) as Array<{ lat: string; lon: string }>;
    const first = data[0];

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

  const response = await fetch(url, {
    headers: {
      "User-Agent": "KAMTasks/1.0 (calendar suggestions)",
      Accept: "application/json",
    },
    next: { revalidate: 60 * 60 * 12 },
  });

  if (!response.ok) {
    const estimatedMinutes = estimateTravelMinutes(fromCoordinates, toCoordinates);
    routeCache.set(cacheKey, estimatedMinutes);
    return estimatedMinutes;
  }

  const data = (await response.json()) as {
    routes?: Array<{ duration?: number }>;
  };
  const duration = data.routes?.[0]?.duration;
  const minutes =
    typeof duration === "number" && duration > 0
      ? Math.max(Math.round(duration / 60), 1)
      : estimateTravelMinutes(fromCoordinates, toCoordinates);

  routeCache.set(cacheKey, minutes);
  return minutes;
}
