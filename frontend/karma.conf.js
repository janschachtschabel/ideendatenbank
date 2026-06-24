// Karma-Konfiguration für `ng test`.
//
// Lokal: `ng test` nutzt den ChromeHeadless-Browser.
// CI (Linux-Runner ohne Sandbox-Rechte): den NoSandbox-Launcher verwenden:
//   ng test --watch=false --browsers=ChromeHeadlessNoSandbox
module.exports = function (config) {
  config.set({
    basePath: '',
    frameworks: ['jasmine', '@angular-devkit/build-angular'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-jasmine-html-reporter'),
      require('@angular-devkit/build-angular/plugins/karma'),
    ],
    reporters: ['progress', 'kjhtml'],
    browsers: ['ChromeHeadless'],
    customLaunchers: {
      // `--no-sandbox` ist auf den meisten CI-Runnern nötig (kein User-Namespace).
      ChromeHeadlessNoSandbox: {
        base: 'ChromeHeadless',
        flags: ['--no-sandbox', '--disable-gpu'],
      },
    },
    restartOnFileChange: true,
  });
};
