module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'react' }]],
    plugins: [
      // Muss der letzte Eintrag bleiben (Vorgabe von react-native-reanimated).
      'react-native-reanimated/plugin',
    ],
  };
};
