const langs = [
  {code: 'af', name: 'Afrikaans'},
  {code: 'ar', name: 'Arabic'},
  {code: 'de', name: 'German'},
  {code: 'en', name: 'English'},
  {code: 'es', name: 'Spanish'},
  {code: 'fr', name: 'French'},
  {code: 'hi', name: 'Hindi'},
  {code: 'ja', name: 'Japanese'},
  {code: 'pt', name: 'Portuguese'},
  {code: 'ru', name: 'Russian'},
  {code: 'zh', name: 'Chinese'},
];
if (typeof window !== 'undefined') {
  window.qwenLanguages = langs;
}
if (typeof module !== 'undefined') {
  module.exports = { langs };
}
