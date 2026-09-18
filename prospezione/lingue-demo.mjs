/**
 * Le lingue delle demo, in un posto solo: le usano sia traduci-demo che
 * crea-demo. Scelte pensando a chi mangia fuori a Sydney.
 *
 * 'nome' e' come la lingua si chiama da se': un cinese cerca 中文, non
 * "Chinese". 'dir' e' il verso di scrittura: l'arabo va da destra a sinistra.
 */
export const LINGUE = {
  en: { nome: 'English',  groq: 'English',              dir: 'ltr' },
  zh: { nome: '中文',      groq: 'Chinese (Simplified)',  dir: 'ltr' },
  ja: { nome: '日本語',    groq: 'Japanese',              dir: 'ltr' },
  ko: { nome: '한국어',    groq: 'Korean',                dir: 'ltr' },
  es: { nome: 'Español',  groq: 'Spanish',               dir: 'ltr' },
  fr: { nome: 'Français', groq: 'French',                dir: 'ltr' },
  de: { nome: 'Deutsch',  groq: 'German',                dir: 'ltr' },
  it: { nome: 'Italiano', groq: 'Italian',               dir: 'ltr' },
  pt: { nome: 'Português',groq: 'Portuguese',            dir: 'ltr' },
  ar: { nome: 'العربية',   groq: 'Arabic',                dir: 'rtl' },
};

/** Quelle che traduciamo se non si dice altro. L'inglese e' gia' l'originale. */
export const PREDEFINITE = ['zh', 'ja', 'ko', 'es', 'fr', 'de', 'it', 'ar'];

/**
 * Le poche parole dell'interfaccia. Sono sempre le stesse, quindi le
 * scriviamo a mano: non ha senso spendere una chiamata all'IA per "Menu".
 */
export const PAROLE = {
  en: { menu: 'Menu',    lingua: 'Language', prezzi: 'Prices in AUD', anteprima: 'Preview prepared for', nonUfficiale: 'not the official website' },
  zh: { menu: '菜单',      lingua: '语言',      prezzi: '价格以澳元计', anteprima: '为以下餐厅制作的预览', nonUfficiale: '非官方网站' },
  ja: { menu: 'メニュー',  lingua: '言語',      prezzi: '価格はAUD', anteprima: 'こちらのお店のために作成したプレビュー', nonUfficiale: '公式サイトではありません' },
  ko: { menu: '메뉴',      lingua: '언어',      prezzi: '가격 단위 AUD', anteprima: '다음 레스토랑을 위한 미리보기', nonUfficiale: '공식 웹사이트가 아닙니다' },
  es: { menu: 'Carta',   lingua: 'Idioma',   prezzi: 'Precios en AUD', anteprima: 'Vista previa preparada para', nonUfficiale: 'no es el sitio oficial' },
  fr: { menu: 'Carte',   lingua: 'Langue',   prezzi: 'Prix en AUD', anteprima: 'Aperçu préparé pour', nonUfficiale: "ce n'est pas le site officiel" },
  de: { menu: 'Speisekarte', lingua: 'Sprache', prezzi: 'Preise in AUD', anteprima: 'Vorschau erstellt für', nonUfficiale: 'nicht die offizielle Website' },
  it: { menu: 'Menu',    lingua: 'Lingua',   prezzi: 'Prezzi in AUD', anteprima: 'Anteprima preparata per', nonUfficiale: 'non e\' il sito ufficiale' },
  pt: { menu: 'Menu',    lingua: 'Idioma',   prezzi: 'Preços em AUD', anteprima: 'Pré-visualização preparada para', nonUfficiale: 'não é o site oficial' },
  ar: { menu: 'قائمة الطعام', lingua: 'اللغة', prezzi: 'الأسعار بالدولار الأسترالي', anteprima: 'معاينة أُعدت لـ', nonUfficiale: 'ليس الموقع الرسمي' },
};
