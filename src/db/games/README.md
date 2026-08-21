# Game template library

Every built-in game lives in its own module in this folder. A template owns four
things:

| Field | Purpose |
| --- | --- |
| `installScript` | Bash that fetches/builds the server files |
| `startCommand` | How the panel launches the server |
| `variables[]` | Every option surfaced in the create-server wizard |
| `defaultConfig` | The config file contents the panel writes after install |

## Who writes config files

Install scripts **do not** write game config files. They install binaries and
create directories only. After the script exits, the panel renders
`defaultConfig` into the paths listed in `configFiles`, substituting `{{VAR}}`
placeholders from the wizard.

This keeps the wizard the single source of truth: an option that appears in the
UI always reaches the config file, and changing a default never means editing a
heredoc buried in a shell script.

Existing files are never overwritten, so a hand-edited config survives a
reinstall.

## Adding a game

1. Create `src/db/games/<slug>.ts` exporting a `GameTemplate`.
2. Register it in `src/db/games/index.ts` (`gameTemplates` and, if the install
   produces a known binary, `EXPECTED_ARTIFACTS_BY_SLUG`).
3. Run `npm run verify:templates`.

For a SteamCMD game, build the install script with `steamInstallScript()` rather
than copying another script — it already handles retries, the SDK shims and
fail-fast behaviour when SteamCMD is missing:

```ts
installScript: steamInstallScript({
  appId: "740",
  name: "Counter-Strike: Source",
  post: `mkdir -p "$INSTALL_DIR/cstrike/cfg"`,
}),
```

## Declaring variables

`V(name, env_variable, description, default, opts)` builds a variable. Wrap a
block with `group("Category", [...])` so the wizard can collapse it:

```ts
...group("Network", [
  V("Max Ping", "SV_MAXPING", "Reject clients above this ping, 0 = no maximum", "0", {
    required: false, type: "number", min_value: 0, max_value: 999,
  }),
  V("Region", "SV_REGION", "Master-server region", "255", {
    required: false, type: "select",
    enum_values: { "3": "3 — Europe", "255": "255 — World" },
  }),
]),
```

Types: `string`, `number`, `float`, `boolean`, `password`, `select`, `hidden`.
Validation rules are generated from the type plus `min_value`/`max_value`.

A variable default is substituted **once**, so a default must not itself contain
another `{{VAR}}` token.

## Config formats

`__gsm_format` selects the serializer; without it the file extension decides.

| Format | Output | Used by |
| --- | --- | --- |
| `properties` | `key=value` | Minecraft, Squad, Project Zomboid |
| `ini` | `[Section]` + `key=value` | ARK, Satisfactory, Insurgency, AC, DST |
| `json` | JSON document | Enshrouded, Factorio, V Rising, TShock |
| `xml` | `<property name= value=/>` | 7 Days to Die |
| `yaml` | `key: value` | Paper |
| `source` | `cvar "value"` | CS2, TF2, GMod, L4D2, Rust |
| `quake3` | `set cvar "value"` | Wolfenstein: ET |
| `q3seta` | `seta cvar "value"` | Quake Live, Xonotic |
| `arma` | `key = value;` | Arma 3 |
| `palworld` | `OptionSettings=(K=V,...)` | Palworld |

A game that ships several config files uses `__files`, keyed by the same paths
as `configFiles`:

```ts
configFiles: {
  "server.cfg": "server.cfg",
  "basic.cfg": "basic.cfg",
},
defaultConfig: {
  __files: {
    "server.cfg": { __gsm_format: "arma", hostname: "{{SERVER_NAME}}" },
    "basic.cfg":  { __gsm_format: "arma", MaxMsgSend: "{{MAX_MSG_SEND}}" },
  },
},
```

Use `csv("{{TAGS}}")` for a text field that must render as a list — it produces
an empty list when the field is blank rather than a list with one empty string.

## Verifying

```
npm run verify:templates          # summary + problems
npm run verify:templates -- --dump  # print every rendered config file
```

The check fails the build if a template has a `{{PLACEHOLDER}}` with no matching
variable, declares a variable nothing consumes, has a select whose default is
not one of its own options, has a numeric default outside its own min/max, or
renders a config that still contains unresolved tokens.
