// @ts-check
//
// ESLint-Konfiguration für die Ideendatenbank-Webkomponente.
//
// Konventionen, die hier abweichend zur Angular-Default-Empfehlung gesetzt
// sind, sind absichtlich so gewählt — Begründungen jeweils inline.
const eslint = require("@eslint/js");
const { defineConfig } = require("eslint/config");
const tseslint = require("typescript-eslint");
const angular = require("angular-eslint");

module.exports = defineConfig([
  {
    files: ["**/*.ts"],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      // Projekt-Prefix: `ideendb-app`, `ideendb-tile-grid`, …
      "@angular-eslint/directive-selector": [
        "error",
        { type: "attribute", prefix: "ideendb", style: "camelCase" },
      ],
      "@angular-eslint/component-selector": [
        "error",
        { type: "element", prefix: "ideendb", style: "kebab-case" },
      ],

      // Wir nutzen `@Input('view')`-Style bewusst, damit die App als
      // Web-Component HTML-Attribute (`<ideendb-app view="detail">`)
      // akzeptiert. Das wäre mit Camel-Case-Input-Namen nicht möglich.
      "@angular-eslint/no-input-rename": "off",

      // edu-sharing-Responses sind dynamisch typisiert und kommen ohne
      // OpenAPI-Schema rein — `any` ist hier oft die ehrliche Antwort.
      // Auf `warn` statt `error`, damit der Hinweis bleibt, aber nicht
      // jeden Build blockiert.
      "@typescript-eslint/no-explicit-any": "warn",

      // `subscribe({ next: () => {}, error: () => {} })`-Pattern wird
      // bewusst genutzt, um Errors zu schlucken. Hinweis behalten.
      "@typescript-eslint/no-empty-function": "warn",

      // Stylistic: `let foo: string = ''` → `let foo = ''`. Auto-Fix
      // verfügbar.
      "@typescript-eslint/no-inferrable-types": "warn",

      // Argumente und Variablen mit `_`-Prefix gelten als bewusst
      // ungenutzt — typische Konvention für Interface-Methoden, die
      // Parameter formal akzeptieren müssen, sie aber nicht brauchen.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.html"],
    extends: [
      angular.configs.templateRecommended,
      angular.configs.templateAccessibility,
    ],
    rules: {
      // Accessibility-Regeln auf `warn`: Die Templates haben viele
      // `(click)`-Handler auf <div>/<span> ohne tabindex (z.B. die
      // Tile-Karten, die als ganzes klickbar sind). Inhaltlich a11y-
      // verbesserungswürdig, aber kein Block für den Build. Iterativ
      // härten.
      "@angular-eslint/template/click-events-have-key-events": "warn",
      "@angular-eslint/template/interactive-supports-focus": "warn",
      "@angular-eslint/template/label-has-associated-control": "warn",
    },
  },
]);
