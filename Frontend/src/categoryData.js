export const CATEGORY_TREE = [
  {
    key: "dresses",
    label: "Dresses",
    subcategories: [
      { value: "dresses", label: "All dresses" },
      { value: "bodycons", label: "Bodycons" },
      { value: "corset dresses", label: "Corset dresses" },
      { value: "knee length dresses", label: "Knee length dresses" },
      { value: "midi & capri dresses", label: "Midi & capri dresses" },
      { value: "maxi dresses", label: "Maxi dresses" },
      { value: "short dresses", label: "Short dresses" },
      { value: "mini dresses", label: "Mini dresses" },
      { value: "shirt dresses", label: "Shirt dresses" },
    ],
  },
  {
    key: "skirts",
    label: "Skirts",
    subcategories: [
      { value: "skirts", label: "All skirts" },
      { value: "denim skirts", label: "Denim skirts" },
      { value: "knee length skirts", label: "Knee length skirts" },
      { value: "midi & capri skirts", label: "Midi & capri skirts" },
      { value: "mini skirts", label: "Mini skirts" },
      { value: "maxi skirts", label: "Maxi skirts" },
      { value: "skirt suits", label: "Skirt suits" },
    ],
  },
  {
    key: "bottoms",
    label: "Bottoms",
    subcategories: [
      { value: "bottoms", label: "All bottoms" },
      { value: "culottes & capri pants", label: "Culottes & capri pants" },
      { value: "denim bottoms", label: "Denim bottoms" },
      { value: "full length pants", label: "Full length pants" },
      { value: "jumpsuits & playsuits", label: "Jumpsuits & playsuits" },
      { value: "leggings", label: "Leggings" },
      { value: "loungewear", label: "Loungewear" },
      { value: "midi & capri pants", label: "Midi & capri pants" },
      { value: "pant sets", label: "Pant sets" },
      { value: "short sets", label: "Short sets" },
      { value: "shorts & skorts", label: "Shorts & skorts" },
    ],
  },
  {
    key: "tops",
    label: "Tops",
    subcategories: [
      { value: "tops", label: "All tops" },
      { value: "beachwear", label: "Beachwear" },
      { value: "bodysuits", label: "Bodysuits" },
      { value: "corset tops", label: "Corset tops" },
      { value: "crop shirts", label: "Crop shirts" },
      { value: "fitted tops", label: "Fitted tops" },
      { value: "midriff & crop tops", label: "Midriff & crop tops" },
      { value: "loose tops", label: "Loose tops" },
      { value: "shirt tops", label: "Shirt tops" },
      { value: "t-shirts & tank tops", label: "T-shirts & tank tops" },
    ],
  },
  {
    key: "innerwear",
    label: "Innerwear",
    subcategories: [
      { value: "innerwear", label: "All innerwear" },
      { value: "bra & panty sets", label: "Bra & panty sets" },
      { value: "bralettes", label: "Bralettes" },
      { value: "bras", label: "Bras" },
      { value: "lingerie", label: "Lingerie" },
      { value: "panties", label: "Panties" },
      { value: "shapewear", label: "Shapewear" },
    ],
  },
];

export function flattenCategoryOptions() {
  return CATEGORY_TREE.flatMap((category) =>
    category.subcategories.map((sub) => ({
      label: sub.label,
      value: sub.value,
      group: category.label,
    }))
  );
}
