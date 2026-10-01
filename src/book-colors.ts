/** Shared, optional suggestions. The native picker accepts any valid six-digit colour. */
import type { Language } from "./i18n";
export const bookColors = [
  { name: { en: "Orange", es: "Naranja", it: "Arancione", fr: "Orange" }, value: "#cc5500" },
  { name: { en: "Red", es: "Rojo", it: "Rosso", fr: "Rouge" }, value: "#8b0000" },
  { name: { en: "Ochre", es: "Ocre", it: "Ocra", fr: "Ocre" }, value: "#996515" },
  { name: { en: "Olive", es: "Oliva", it: "Oliva", fr: "Olive" }, value: "#808000" },
  { name: { en: "Pumpkin", es: "Calabaza", it: "Zucca", fr: "Citrouille" }, value: "#b7410e" },
  { name: { en: "Wine", es: "Vino", it: "Vino", fr: "Vin" }, value: "#800020" },
  { name: { en: "Turquoise", es: "Turquesa", it: "Turchese", fr: "Turquoise" }, value: "#138c98" },
  { name: { en: "Blue", es: "Azul", it: "Blu", fr: "Bleu" }, value: "#326fca" },
  { name: { en: "Indigo", es: "Índigo", it: "Indaco", fr: "Indigo" }, value: "#514bb0" },
  { name: { en: "Violet", es: "Violeta", it: "Viola", fr: "Violet" }, value: "#8854ba" },
  { name: { en: "Pink", es: "Rosa", it: "Rosa", fr: "Rose" }, value: "#c84f90" },
  { name: { en: "Green", es: "Verde", it: "Verde", fr: "Vert" }, value: "#35865d" },
  { name: { en: "Cyan", es: "Cian", it: "Ciano", fr: "Cyan" }, value: "#198ca6" },
  { name: { en: "Gray", es: "Gris", it: "Grigio", fr: "Gris" }, value: "#596779" },
] as const;

export function colorName(value: string, language: Language): string {
  return bookColors.find(choice => choice.value === value)?.name[language] ?? value;
}

export function hexColor(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
}

/** Use the more readable label colour for arbitrary folder fills. */
export function folderInk(color: string): string {
  const channels = [1, 3, 5].map(index => {
    const channel = parseInt(color.slice(index, index + 2), 16) / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  // A dark near-black cannot guarantee 4.5:1 against mid-tone custom fills.
  return luminance >= .175 ? "#000000" : "#ffffff";
}
