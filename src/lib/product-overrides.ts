import type { Json } from "@/lib/database.types";

export interface ProductSourceFields {
  title: string;
  description: string | null;
  featuredImageUrl: string | null;
}

export interface AdFactoryProductOverrides {
  name?: string;
  description?: string | null;
  imagePath?: string | null;
  updatedAt: string;
}

export interface EditableProductFields {
  name: string;
  description: string | null;
  imagePath: string | null;
}

type JsonObject = { [key: string]: Json | undefined };

function isObject(value: Json | undefined): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasOwn<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function readAdFactoryProductOverrides(context: Json | undefined): AdFactoryProductOverrides | null {
  if (!isObject(context) || !isObject(context.adFactoryOverrides)) return null;
  const raw = context.adFactoryOverrides;
  if (typeof raw.updatedAt !== "string") return null;

  const overrides: AdFactoryProductOverrides = { updatedAt: raw.updatedAt };
  if (typeof raw.name === "string") overrides.name = raw.name;
  if (hasOwn(raw, "description") && (typeof raw.description === "string" || raw.description === null)) {
    overrides.description = raw.description;
  }
  if (hasOwn(raw, "imagePath") && (typeof raw.imagePath === "string" || raw.imagePath === null)) {
    overrides.imagePath = raw.imagePath;
  }

  return hasOwn(overrides, "name") || hasOwn(overrides, "description") || hasOwn(overrides, "imagePath")
    ? overrides
    : null;
}

export function buildAdFactoryProductOverrides(
  fields: EditableProductFields,
  source: ProductSourceFields,
  updatedAt: string,
): AdFactoryProductOverrides | null {
  const overrides: AdFactoryProductOverrides = { updatedAt };
  if (fields.name !== source.title) overrides.name = fields.name;
  if (fields.description !== source.description) overrides.description = fields.description;
  if (fields.imagePath !== source.featuredImageUrl) overrides.imagePath = fields.imagePath;
  return hasOwn(overrides, "name") || hasOwn(overrides, "description") || hasOwn(overrides, "imagePath")
    ? overrides
    : null;
}

export function writeAdFactoryProductOverrides(
  context: Json | undefined,
  overrides: AdFactoryProductOverrides | null,
): Json {
  const base = isObject(context) ? context : {};
  const { adFactoryOverrides: _discarded, ...withoutOverrides } = base;
  return overrides
    ? { ...withoutOverrides, adFactoryOverrides: overrides as unknown as Json }
    : withoutOverrides;
}

export function resolveProductFields(
  source: ProductSourceFields,
  overrides: AdFactoryProductOverrides | null,
): EditableProductFields {
  if (!overrides) {
    return { name: source.title, description: source.description, imagePath: source.featuredImageUrl };
  }
  return {
    name: hasOwn(overrides, "name") ? overrides.name! : source.title,
    description: hasOwn(overrides, "description") ? overrides.description! : source.description,
    imagePath: hasOwn(overrides, "imagePath") ? overrides.imagePath! : source.featuredImageUrl,
  };
}
