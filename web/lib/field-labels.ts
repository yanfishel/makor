/** The API's field names (`first_name_he`, `children[0].id_number`) as printed labels.
 *
 * The names are the engine's own vocabulary and belong in the JSON tab, not in a table a
 * person reads: the label comes from `labels.fields`, the raw name travels beside it so a
 * row can still be found in the response. A name the messages do not know keeps its own
 * spelling — a new engine field then reads as itself instead of disappearing behind a
 * guess — and `translated` says which of the two happened, so the caller knows whether a
 * tooltip would repeat what is already on screen.
 *
 * A sheet's rows are nested: `address.city` is just a city (the rows around it are the rest
 * of the address), while `spouse.…` and `children[i].…` name a different person and keep a
 * group in front of them.
 */
export interface FieldLabel { text: string; raw: string; translated: boolean }

/** Just enough of next-intl's translator to look a key up and know whether it exists. */
export interface LabelTranslator {
  (key: string, values?: Record<string, string | number>): string;
  has(key: string): boolean;
}

const CHILD = /^children\[(\d+)\]\.(.+)$/;

function leaf(name: string, t: LabelTranslator): { text: string; translated: boolean } {
  return t.has(`fields.${name}`) ? { text: t(`fields.${name}`), translated: true } : { text: name, translated: false };
}

export function fieldLabel(name: string, t: LabelTranslator): FieldLabel {
  const child = CHILD.exec(name);
  if (child) {
    const { text, translated } = leaf(child[2], t);
    return { text: `${t("fieldGroups.child", { n: Number(child[1]) + 1 })} · ${text}`, raw: name, translated };
  }
  if (name.startsWith("spouse.")) {
    const { text, translated } = leaf(name.slice("spouse.".length), t);
    return { text: `${t("fieldGroups.spouse")} · ${text}`, raw: name, translated };
  }
  const { text, translated } = leaf(name.startsWith("address.") ? name.slice("address.".length) : name, t);
  return { text, raw: name, translated };
}
