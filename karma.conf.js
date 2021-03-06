require('@babel/register')({
  extensions: ['.js', '.ts'],
  ignore: [/node_modules/],
  presets: [
    ['@4c/babel-preset/esm', { modules: true, debug: false }],
    '@babel/preset-typescript',
  ],
});

const rollupConfig = require('./rollup.config');
const karmaJest = require('./src');

module.exports = (config) => {
  config.set({
    browsers: ['Chrome'],
    // logLevel: 'error',
    files: [
      /**
       * Make sure to disable Karma’s file watcher
       * because the preprocessor will use its own.
       */
      { pattern: 'test/**/*.test.js', watched: false },
    ],
    plugins: [
      'karma-rollup-preprocessor',
      'karma-mocha-reporter',
      'karma-chrome-launcher',
      'karma-firefox-launcher',
      karmaJest,
    ],
    frameworks: ['jest'],
    reporters: ['jest'], // ['mocha'],
    preprocessors: {
      'test/**/*.test.js': ['rollup'],
      'src/circus-adapter.ts': ['rolluplib'],
    },
    jest: {
      snapshotPath: 'test/__snapshots__',
    },
    rollupPreprocessor: {
      ...rollupConfig[0],
      onwarn() {},
      output: {
        sourcemap: 'inline',
      },
    },
    // browserConsoleLogOptions: {
    //   level: 'warn',
    // },
    customPreprocessors: {
      rolluplib: {
        base: 'rollup',
        options: {
          output: {
            intro:
              'const process = { env: {}, cwd: () => "/", FORCE_COLOR: true };\n' +
              'const Buffer = () => {}',
            sourcemap: 'inline',
          },
        },
      },
    },
    customLaunchers: {
      FirefoxCustom: {
        base: 'Firefox',
        prefs: {
          'toolkit.telemetry.reportingpolicy.firstRun': false,
          'extensions.enabledScopes': 0,
        },
      },
    },
  });
};
