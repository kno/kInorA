/**
 * The generated catalog is a multi-megabyte JSON file. Letting `tsc` infer its
 * literal type (via `resolveJsonModule`) would produce an unusable declaration
 * output and a very slow type-check, and would additionally drag a file living
 * outside `rootDir` into the compilation.
 *
 * It is therefore declared as opaque here and narrowed once, explicitly, in
 * `catalog.ts`. The shape is guaranteed at generation time by
 * `scripts/import-exercise-catalog.ts`.
 */
declare module "*.json" {
  const value: unknown;
  export default value;
}
