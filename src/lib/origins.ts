export const departureOrigins = [
  {
    key: "home",
    label: "Zuhause",
    address: "Derentaler Straße 36, 37699 Fürstenberg",
  },
  {
    key: "work",
    label: "Arbeit",
    address: "Warburger Straße 65, 33034 Brakel",
  },
  {
    key: "holzminden",
    label: "Holzminden",
    address: "37603 Holzminden",
  },
] as const;

export type DepartureOriginKey = (typeof departureOrigins)[number]["key"];

export function getDepartureOriginAddress(originKey: string | undefined) {
  return departureOrigins.find((origin) => origin.key === originKey)?.address ?? departureOrigins[0].address;
}
