/**
 * Nested catalog shape (arbitrarily deep, leaves are ICU message strings).
 */
export type NestedMessages = {
  [key: string]: string | NestedMessages;
};

/**
 * Flattens a nested message catalog into a flat, dot-joined `Record<string,
 * string>`. This is the load-bearing invariant shared by the parity/ICU-arg
 * guard (which validates over the flat shape) and the mobile boundary
 * (react-intl consumes flat `id -> string` maps).
 */
export function flattenMessages(nested: NestedMessages): Record<string, string> {
  const flat: Record<string, string> = {};

  for (const [key, value] of Object.entries(nested)) {
    if (typeof value === "string") {
      flat[key] = value;
      continue;
    }

    const nestedFlat = flattenMessages(value);
    for (const [nestedKey, nestedValue] of Object.entries(nestedFlat)) {
      flat[`${key}.${nestedKey}`] = nestedValue;
    }
  }

  return flat;
}
