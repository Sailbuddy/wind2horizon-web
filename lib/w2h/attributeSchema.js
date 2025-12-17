// lib/w2h/attributeSchema.js
export async function fetchAttributeSchema(supabase) {
  const { data, error } = await supabase
    .from('attribute_definitions')
    .select(
      `
      attribute_id,
      category_id,
      key,
      input_type,
      options,
      sort_order,
      is_active,
      multilingual,
      update_frequency,
      name_de,name_en,name_it,name_fr,name_hr,
      description_de,description_en,description_it,description_fr,description_hr,
      show_in_infowindow,
      infowindow_group,
      infowindow_order,
      display_format,
      visibility_level
    `,
    );

  if (error) throw new Error(`attribute_definitions load failed: ${error.message}`);

  const rows = (data || []).filter((r) => r.is_active !== false);

  const byId = new Map();
  const byKey = new Map();
  for (const r of rows) {
    byId.set(Number(r.attribute_id), r);
    if (r.key) byKey.set(String(r.key), r);
  }

  return { rows, byId, byKey };
}

export function pickDefName(def, lang = 'de') {
  if (!def) return '';
  return (
    (lang === 'de' && def.name_de) ||
    (lang === 'en' && def.name_en) ||
    (lang === 'it' && def.name_it) ||
    (lang === 'fr' && def.name_fr) ||
    (lang === 'hr' && def.name_hr) ||
    def.name_en ||
    def.name_de ||
    def.key ||
    ''
  );
}

export function pickDefDescription(def, lang = 'de') {
  if (!def) return '';
  return (
    (lang === 'de' && def.description_de) ||
    (lang === 'en' && def.description_en) ||
    (lang === 'it' && def.description_it) ||
    (lang === 'fr' && def.description_fr) ||
    (lang === 'hr' && def.description_hr) ||
    def.description_en ||
    def.description_de ||
    ''
  );
}

export function isPubliclyVisible(def, maxVisibilityLevel = 0) {
  // 0=public, 1=internal, 2=admin
  const lvl = def && def.visibility_level !== null && def.visibility_level !== undefined
    ? Number(def.visibility_level)
    : 0;
  return lvl <= maxVisibilityLevel;
}
