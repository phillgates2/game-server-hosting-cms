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

## Updating existing servers

The server's **Update** action supports both SteamCMD and non-Steam games, on
local nodes and remote node agents. Stop the server first. By default, the panel
creates a backup on the node that holds the files and aborts if that backup fails.
Concurrent Update requests for the same server are rejected.

Steam games run `app_update ... validate`. Non-Steam games rerun the current
bundled `installScript` (or the game definition's script for custom games), using
the server's saved variables and template defaults. Downloaders that resolve
`latest` fetch the latest available release; explicitly configured version pins
are retained. Custom games need a download/install script to enable updates.

Updating does not invoke the panel's config/start-script generation or migrate
the install directory. However, a downloader or upstream archive can itself
replace existing files, so keep the pre-update backup enabled. Local updates
record a file-change report; remote updates record the backup and update event
without a local filesystem report.

### Latest stable releases

ET:Legacy resolves its engine archives and Legacy mod pack together from the
current official stable-release page; the mod modules and PK3s are refreshed on
every update, not only when missing. Xonotic resolves its archive from the
current official download page. Vintage Story uses its public `stable.json`
metadata when `VS_VERSION` is empty or `latest`. These resolvers stop with an
error if upstream metadata cannot be understood; they do not silently fall back
to an old release. ET:Legacy and unpinned Vintage Story require **Python 3** on
the game node to parse metadata.

Existing explicit version settings are not rewritten. In particular, older
Vintage Story servers may still store the old default version: clear
`VS_VERSION` (or set it to `latest`) to follow stable releases. Fabric and
NeoForge pins likewise remain intentional. Third-party ET mods (Jaymod, ETPub,
N!tmod) retain their compatibility-specific downloads; the ET:Legacy engine and
Legacy mod pack follow the current stable release independently of those mods.
